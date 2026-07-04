import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import { isAuthorizedForLeague } from '../../../lib/leagueAuth.ts';
import { isValidSlug, getLeague } from '../../../lib/leagueRegistry.ts';
import { invalidateStandings } from '../../../lib/selectors/leagueStandings.ts';
import { getTeamDatabaseItems } from '../../../lib/server/teamDatabaseStore.ts';
import { getScopedAliasMap } from '../../../lib/server/globalAliasStore.ts';
import { validateRosterCSV } from '../../../lib/rosterUploadValidator.ts';

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

  // Password-gate league-scoped reads (roster CSVs include owner names).
  // Blend into 404 so callers can't distinguish "passworded" from "missing".
  // Pass req so the gate honors ADMIN_API_TOKEN in addition to Clerk session.
  if (league && !(await isAuthorizedForLeague(league, req))) {
    return new Response(null, { status: 404 });
  }

  const record = await getAppState<string>(ownersScope(year, league), 'csv');

  return Response.json({
    year,
    league: league ?? null,
    csvText: typeof record?.value === 'string' ? record.value : null,
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

  const csvText =
    body && typeof body === 'object' && 'csvText' in (body as Record<string, unknown>)
      ? (body as { csvText?: unknown }).csvText
      : undefined;

  if (csvText !== null && csvText !== undefined && typeof csvText !== 'string') {
    return new Response('csvText must be a string or null', { status: 400 });
  }

  const scope = ownersScope(year, league);

  if (typeof csvText === 'string' && csvText.trim()) {
    // Server-side safety guard: reject uploads that contain unresolved team names.
    // The UI enforces this too, but the API must enforce it independently.
    const [teams, mergedAliases] = await Promise.all([
      getTeamDatabaseItems(),
      // Effective, league-aware precedence (stored global > league+year > year >
      // seed defaults). Must NOT be built by spreading getGlobalAliases() after
      // the scoped map — that would let a seed default override a scoped repair.
      getScopedAliasMap(league ?? '', year),
    ]);
    const validation = validateRosterCSV(csvText, mergedAliases, teams);
    if (!validation.isComplete) {
      const unresolvedTeams = validation.needsConfirmation.map((u) => u.inputName);
      return Response.json(
        {
          error: 'unresolved-teams',
          detail:
            'One or more team names could not be resolved to FBS canonical names. Validate and confirm all team names before uploading.',
          unresolvedTeams,
        },
        { status: 400 }
      );
    }

    await setAppState(scope, 'csv', csvText);
    if (league) invalidateStandings(league, year);
    return Response.json({ year, league: league ?? null, csvText, hasStoredValue: true });
  }

  await setAppState(scope, 'csv', null);
  if (league) invalidateStandings(league, year);
  return Response.json({ year, league: league ?? null, csvText: null, hasStoredValue: true });
}
