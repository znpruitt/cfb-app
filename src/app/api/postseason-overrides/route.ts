import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';

function clampYearMaybe(s: string | null): number {
  const fallback = new Date().getFullYear();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function overridesScope(year: number): string {
  return `postseason-overrides:${year}`;
}

type OverridesMap = Record<string, unknown>;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const record = await getAppState<OverridesMap>(overridesScope(year), 'map');
  const map = record?.value;
  return Response.json({
    year,
    map: map && typeof map === 'object' && !Array.isArray(map) ? map : {},
    hasStoredValue: Boolean(record),
  });
}

export async function PUT(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));

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

  if (map && typeof map === 'object') {
    await setAppState(overridesScope(year), 'map', map);
    return Response.json({ year, map, hasStoredValue: true });
  }

  await setAppState(overridesScope(year), 'map', {});
  return Response.json({ year, map: {}, hasStoredValue: true });
}
