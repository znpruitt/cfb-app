import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import { isValidSlug, getLeague } from '../../../lib/leagueRegistry.ts';
import { getTeamDatabaseItems } from '../../../lib/server/teamDatabaseStore.ts';
import { getGlobalAliases } from '../../../lib/server/globalAliasStore.ts';
import { validateRosterCSV } from '../../../lib/rosterUploadValidator.ts';
import type { AliasMap } from '../../../lib/teamNames.ts';

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
    const [teams, globalAliases, leagueAliasRecord] = await Promise.all([
      getTeamDatabaseItems(),
      getGlobalAliases(),
      getAppState<AliasMap>(league ? `aliases:${league}:${year}` : `aliases:${year}`, 'map'),
    ]);
    const leagueAliasMap = leagueAliasRecord?.value;
    const mergedAliases: AliasMap = {
      ...(leagueAliasMap && typeof leagueAliasMap === 'object' && !Array.isArray(leagueAliasMap)
        ? (leagueAliasMap as AliasMap)
        : {}),
      ...globalAliases,
    };
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
    return Response.json({ year, league: league ?? null, csvText, hasStoredValue: true });
  }

  await setAppState(scope, 'csv', null);
  return Response.json({ year, league: league ?? null, csvText: null, hasStoredValue: true });
}
