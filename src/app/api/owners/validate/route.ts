import { requireAdminRequest } from '../../../../lib/server/adminAuth.ts';
import { getTeamDatabaseItems } from '../../../../lib/server/teamDatabaseStore.ts';
import { getScopedAliasMap } from '../../../../lib/server/globalAliasStore.ts';
import { isValidSlug, getLeague } from '../../../../lib/leagueRegistry.ts';
import { validateRosterCSV, getFBSTeams } from '../../../../lib/rosterUploadValidator.ts';

function clampYearMaybe(s: string | null): number {
  const fallback = new Date().getFullYear();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * POST /api/owners/validate
 *
 * Validates a roster CSV against the FBS team catalog and the existing alias
 * store without writing anything. Returns a RosterValidationResult plus the
 * full FBS team list for the admin UI picker.
 *
 * Admin-gated. Query params: ?year=YYYY&league=SLUG (both optional).
 * Body: { csvText: string }
 */
export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const leagueParam = url.searchParams.get('league') ?? undefined;
  const league = leagueParam && isValidSlug(leagueParam) ? leagueParam : undefined;

  if (leagueParam && !league) {
    return new Response(`Invalid league slug format: '${leagueParam}'.`, { status: 400 });
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

  if (typeof csvText !== 'string' || !csvText.trim()) {
    return new Response('csvText is required and must be a non-empty string', { status: 400 });
  }

  const [teams, mergedAliases] = await Promise.all([
    getTeamDatabaseItems(),
    // Effective precedence (stored global > year > seed defaults) in one map —
    // NOT scoped-then-global-spread, which would let a seed default override a
    // year repair.
    getScopedAliasMap(league ?? '', year),
  ]);

  const result = validateRosterCSV(csvText, mergedAliases, teams);
  const fbsTeams = getFBSTeams(teams);

  return Response.json({ ...result, fbsTeams });
}
