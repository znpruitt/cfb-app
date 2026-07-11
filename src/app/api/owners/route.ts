import { getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import { isAuthorizedForLeague } from '../../../lib/leagueAuth.ts';
import { isValidSlug, getLeague } from '../../../lib/leagueRegistry.ts';
import type { League } from '../../../lib/league.ts';
import { OWNER_ROSTER_OVERWRITE_ERROR } from '../../../lib/ownerRosterGuard.ts';
import { parseOwnersCsv } from '../../../lib/parseOwnersCsv.ts';
import { invalidateStandings } from '../../../lib/selectors/leagueStandings.ts';
import { getTeamDatabaseItems } from '../../../lib/server/teamDatabaseStore.ts';
import { getScopedAliasMap } from '../../../lib/server/globalAliasStore.ts';
import { validateRosterCSV } from '../../../lib/rosterUploadValidator.ts';

/**
 * PLATFORM-083 — active-season owner-roster overwrite guard.
 *
 * `owners:${slug}:${year}` is the same state the confirmed-draft and manual
 * roster-assignment flows write. A league-scoped write to the league's active
 * season (`year >= league.year` — past years are historical backfill) that
 * would replace an already-populated roster requires an explicit
 * `?override=1` repair confirmation, so a CSV import or inline editor save can
 * never silently clobber a confirmed current-season roster. This is a
 * data-safety guard, NOT an authorization change: the route stays
 * platform-admin-only via `requireAdminRequest`.
 */
function existingRosterIsPopulated(value: unknown): boolean {
  // Only a non-empty string that parses to >=1 owner/team row counts as
  // populated. A header-only / empty CSV is treated as unpopulated so initial
  // roster creation is never gated. The only writers to this scope
  // (draft confirm, post-confirm pick edit, this route) always emit validated
  // header+rows CSV, so a non-empty value that parses to zero rows does not
  // arise in practice — we deliberately do not silently treat arbitrary
  // non-empty junk as empty, but there is no such producer to defend against.
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return parseOwnersCsv(value).length > 0;
}

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

  let registeredLeague: League | null = null;
  if (league) {
    registeredLeague = await getLeague(league);
    if (!registeredLeague)
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
  const override = url.searchParams.get('override') === '1';

  // Active-season overwrite guard (league-scoped writes only). A past-season
  // write (`year < league.year`) is historical/backfill and always allowed;
  // otherwise, replacing an already-populated roster requires `?override=1`.
  //
  // The check is re-run immediately before each write (not once up front) so
  // the roster read that decides "populated?" is adjacent to the write, closing
  // the window where the CSV path's async team-name validation would otherwise
  // let a concurrent draft-confirm / manual-assignment populate the scope
  // between an early check and the write. This narrows — but, like every other
  // owner-scope writer (draft confirm, pick edit), does not distributed-lock —
  // the last-write-wins app-state store; it is best-effort accidental-overwrite
  // protection for a single-operator admin surface, not a mutual-exclusion lock.
  async function overwriteGuardResponse(): Promise<Response | null> {
    if (!league || !registeredLeague) return null;
    if (year < registeredLeague.year) return null; // historical / backfill
    if (override) return null;
    const existing = await getAppState<string>(scope, 'csv');
    if (!existingRosterIsPopulated(existing?.value)) return null;
    return Response.json(
      {
        error: OWNER_ROSTER_OVERWRITE_ERROR,
        message:
          'This would overwrite an existing active-season owner roster. Current-season ownership is normally managed through the draft / manual assignment flow. Confirm repair override to continue.',
      },
      { status: 409 }
    );
  }

  if (typeof csvText === 'string' && csvText.trim()) {
    // Server-side safety guard: reject uploads that contain unresolved team names.
    // The UI enforces this too, but the API must enforce it independently.
    const [teams, mergedAliases] = await Promise.all([
      getTeamDatabaseItems(),
      // Effective precedence (stored global > year > seed defaults). Must NOT be
      // built by spreading getGlobalAliases() after the scoped map — that would
      // let a seed default override a year repair.
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

    // Re-check the guard AFTER validation, immediately before the write.
    const guard = await overwriteGuardResponse();
    if (guard) return guard;

    await setAppState(scope, 'csv', csvText);
    if (league) invalidateStandingsSafely(league, year);
    return Response.json({ year, league: league ?? null, csvText, hasStoredValue: true });
  }

  const clearGuard = await overwriteGuardResponse();
  if (clearGuard) return clearGuard;

  await setAppState(scope, 'csv', null);
  if (league) invalidateStandingsSafely(league, year);
  return Response.json({ year, league: league ?? null, csvText: null, hasStoredValue: true });
}

/**
 * Invalidate standings after a successful write, tolerating only the benign
 * out-of-request-context `revalidateTag` Invariant (`static generation store
 * missing`, NEXT code `E263`) raised when the handler runs outside a request —
 * i.e. scripts and `node:test`, where there is no data cache to bust. In
 * production the PUT handler always has a request context, so invalidation runs
 * exactly as before; any other (real) failure still surfaces.
 */
function invalidateStandingsSafely(league: string, year: number): void {
  try {
    invalidateStandings(league, year);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('static generation store missing') ||
        (err as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE === 'E263')
    ) {
      return;
    }
    throw err;
  }
}
