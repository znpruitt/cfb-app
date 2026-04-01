import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import { isValidSlug, getLeague } from '../../../lib/leagueRegistry.ts';

function clampYearMaybe(s: string | null): number {
  const fallback = new Date().getFullYear();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ownersScope(year: number, leagueSlug?: string): string {
  if (leagueSlug) return `owners:${leagueSlug}:${year}`;
  return `owners:${year}`;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const leagueParam = url.searchParams.get('league') ?? undefined;
  const league = leagueParam && isValidSlug(leagueParam) ? leagueParam : undefined;

  const record = await getAppState<string>(ownersScope(year, league), 'csv');

  return Response.json({
    year,
    league: league ?? null,
    csvText: typeof record?.value === 'string' ? record.value : null,
    hasStoredValue: Boolean(record),
  });
}

export async function PUT(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
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

  const csvText =
    body && typeof body === 'object' && 'csvText' in (body as Record<string, unknown>)
      ? (body as { csvText?: unknown }).csvText
      : undefined;

  if (csvText !== null && csvText !== undefined && typeof csvText !== 'string') {
    return new Response('csvText must be a string or null', { status: 400 });
  }

  const scope = ownersScope(year, league);

  if (typeof csvText === 'string' && csvText.trim()) {
    await setAppState(scope, 'csv', csvText);
    return Response.json({ year, league: league ?? null, csvText, hasStoredValue: true });
  }

  await setAppState(scope, 'csv', null);
  return Response.json({ year, league: league ?? null, csvText: null, hasStoredValue: true });
}
