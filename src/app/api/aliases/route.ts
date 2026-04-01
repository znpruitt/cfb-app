import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import { isValidSlug, getLeague } from '../../../lib/leagueRegistry.ts';

/** Canonical alias map type */
type AliasMap = Record<string, string>;

/** Accepted PUT body shapes:
 * - Replace all: { map: AliasMap }
 * - Patch: { upserts?: AliasMap, deletes?: string[] }
 */
type PutBody =
  | { map: AliasMap; upserts?: never; deletes?: never }
  | { map?: never; upserts?: AliasMap; deletes?: string[] };

function clampYearMaybe(s: string | null): number {
  const fallback = new Date().getFullYear();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function aliasesScope(year: number, leagueSlug?: string): string {
  if (leagueSlug) return `aliases:${leagueSlug}:${year}`;
  return `aliases:${year}`;
}

async function readAliases(year: number, league?: string): Promise<AliasMap> {
  // Try league-scoped key first; fall back to legacy key for migration
  // TRANSITION FALLBACK: legacy fallback removed after migration confirmed complete
  let record = league ? await getAppState<AliasMap>(aliasesScope(year, league), 'map') : null;

  if (!record) {
    record = await getAppState<AliasMap>(aliasesScope(year), 'map');
  }

  const map = record?.value;
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

async function writeAliases(year: number, map: AliasMap, league?: string): Promise<void> {
  await setAppState(aliasesScope(year, league), 'map', map);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const leagueParam = url.searchParams.get('league') ?? undefined;
  const league = leagueParam && isValidSlug(leagueParam) ? leagueParam : undefined;

  const map = await readAliases(year, league);
  return Response.json({ year, league: league ?? null, map });
}

export async function PUT(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const leagueParam = url.searchParams.get('league') ?? undefined;
  const league = leagueParam && isValidSlug(leagueParam) ? leagueParam : undefined;

  if (league) {
    const registered = await getLeague(league);
    if (!registered)
      return new Response(`League '${league}' not found in registry`, { status: 404 });
  }

  let bodyUnknown: unknown;
  try {
    bodyUnknown = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const isAliasMap = (x: unknown): x is AliasMap =>
    !!x &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    Object.entries(x as Record<string, unknown>).every(
      ([k, v]) => typeof k === 'string' && typeof v === 'string'
    );

  const isStringArray = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((v) => typeof v === 'string');

  let body: PutBody | null = null;
  if (bodyUnknown && typeof bodyUnknown === 'object') {
    const obj = bodyUnknown as Record<string, unknown>;
    if ('map' in obj && isAliasMap(obj.map)) {
      body = { map: obj.map };
    } else if (
      ('upserts' in obj || 'deletes' in obj) &&
      (obj.upserts === undefined || isAliasMap(obj.upserts)) &&
      (obj.deletes === undefined || isStringArray(obj.deletes))
    ) {
      body = {
        upserts: (obj.upserts as AliasMap | undefined) ?? {},
        deletes: (obj.deletes as string[] | undefined) ?? [],
      };
    }
  }

  if (!body) {
    return new Response('Body must be { map } or { upserts, deletes }', {
      status: 400,
    });
  }

  const current = await readAliases(year, league);

  let next: AliasMap;
  if ('map' in body) {
    next = body.map ?? {};
  } else {
    next = { ...current };

    const upserts = body.upserts ?? {};
    for (const [k, v] of Object.entries(upserts)) {
      next[String(k).toLowerCase()] = String(v);
    }

    const deletes = body.deletes ?? [];
    for (const k of deletes) {
      const key = String(k).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
      }
    }
  }

  await writeAliases(year, next, league);
  return Response.json({ year, league: league ?? null, map: next });
}
