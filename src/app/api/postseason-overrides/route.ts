import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import { isValidSlug, getLeague } from '../../../lib/leagueRegistry.ts';

function clampYearMaybe(s: string | null): number {
  const fallback = new Date().getFullYear();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function overridesScope(year: number, leagueSlug?: string): string {
  if (leagueSlug) return `postseason-overrides:${leagueSlug}:${year}`;
  return `postseason-overrides:${year}`;
}

type OverridesMap = Record<string, unknown>;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const leagueParam = url.searchParams.get('league') ?? undefined;
  const league = leagueParam && isValidSlug(leagueParam) ? leagueParam : undefined;

  const record = await getAppState<OverridesMap>(overridesScope(year, league), 'map');

  const map = record?.value;
  return Response.json({
    year,
    league: league ?? null,
    map: map && typeof map === 'object' && !Array.isArray(map) ? map : {},
    hasStoredValue: Boolean(record),
  });
}

export async function PUT(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const leagueParam = url.searchParams.get('league') ?? undefined;
  const league = leagueParam && isValidSlug(leagueParam) ? leagueParam : undefined;

  if (leagueParam && !league) {
    return new Response(
      `Invalid league slug format: '${leagueParam}'. Slugs must be lowercase alphanumeric words separated by hyphens.`,
      { status: 400 }
    );
  }

  if (league) {
    const registered = await getLeague(league);
    if (!registered)
      return new Response(`League '${league}' not found in registry`, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const map =
    body && typeof body === 'object' && 'map' in (body as Record<string, unknown>)
      ? (body as { map?: unknown }).map
      : undefined;

  if (map !== null && map !== undefined && (typeof map !== 'object' || Array.isArray(map))) {
    return new Response('map must be an object or null', { status: 400 });
  }

  const scope = overridesScope(year, league);

  if (map && typeof map === 'object') {
    await setAppState(scope, 'map', map);
    return Response.json({ year, league: league ?? null, map, hasStoredValue: true });
  }

  await setAppState(scope, 'map', {});
  return Response.json({ year, league: league ?? null, map: {}, hasStoredValue: true });
}
