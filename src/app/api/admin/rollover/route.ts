import { requireAdminAuth } from '@/lib/server/adminAuth';
import { clearAllSuppressionRecords } from '@/lib/insights/suppression';
import { getLeagues, updateLeagueStatus } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { getSeasonArchive, saveSeasonArchive, diffSeasonArchives } from '@/lib/seasonArchive';
import { buildSeasonArchive } from '@/lib/seasonRollover';
import { groupRolloverTargets, type RolloverYearGroup } from '@/lib/rolloverTargeting';
import {
  resolveNationalChampionshipRollover,
  type ChampionshipRolloverDecision,
} from '@/lib/schedule/nationalChampionshipRollover';
import type {
  ManualRolloverExecuteResponse,
  ManualRolloverLeaguePreview,
  ManualRolloverPreviewResponse,
  ManualRolloverStatusResponse,
  ManualRolloverYearStatus,
} from '@/lib/manualRollover';
import type { League } from '@/lib/league';

/**
 * PLATFORM-086F2B — manual season rollover, narrowed to explicit per-year
 * operation behind the SAME strict eligibility authority as the automatic cron
 * (`resolveNationalChampionshipRollover`: structured CFP national championship
 * + confirmed complete final + seven-day delay; cache-only, no provider calls).
 *
 * Target selection is the shared `groupRolloverTargets` policy (non-test
 * leagues in `season`, grouped exclusively by `status.year`), so a manual
 * request can never roll an offseason/preseason/test/missing-status league or
 * contaminate a sibling year. There is no force/emergency bypass.
 */

function yearStatusFromDecision(
  group: RolloverYearGroup,
  decision: ChampionshipRolloverDecision
): ManualRolloverYearStatus {
  const base = {
    year: group.year,
    leagues: sanitizeLeagues(group.leagues),
  };
  if (decision.kind === 'eligible') {
    return {
      ...base,
      eligibility: 'eligible',
      reason: null,
      championshipDate: decision.championshipDate,
      rolloverDate: decision.rolloverDate,
    };
  }
  if (decision.kind === 'skip') {
    return {
      ...base,
      eligibility: 'not-eligible',
      reason: decision.reason,
      championshipDate: null,
      rolloverDate: null,
    };
  }
  // A durable/context read failure — sanitized: the decision's detail (raw
  // thrown-error text) is never exposed.
  return {
    ...base,
    eligibility: 'unavailable',
    reason: 'read-failed',
    championshipDate: null,
    rolloverDate: null,
  };
}

// GET — per-year eligibility status for every active non-test season year.
export async function GET(req: Request): Promise<Response> {
  // Authenticate before any registry/cache work.
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const groups = groupRolloverTargets(await getLeagues());
  const now = Date.now();

  const years: ManualRolloverYearStatus[] = [];
  for (const group of groups) {
    const decision = await resolveNationalChampionshipRollover(group.year, now);
    years.push(yearStatusFromDecision(group, decision));
  }

  const body: ManualRolloverStatusResponse = {
    generatedAt: new Date().toISOString(),
    years,
  };
  return Response.json(body);
}

async function buildLeaguePreview(
  league: League,
  year: number
): Promise<ManualRolloverLeaguePreview> {
  try {
    const [existing, proposed] = await Promise.all([
      getSeasonArchive(league.slug, year),
      buildSeasonArchive(league.slug, year),
    ]);
    const top3 = proposed.finalStandings.slice(0, 3).map((row, i) => ({
      position: i + 1,
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
    }));
    return {
      leagueSlug: league.slug,
      displayName: league.displayName,
      status: league.status,
      hasExistingArchive: existing !== null,
      champion: top3[0]?.owner ?? null,
      top3,
      diff: existing !== null ? diffSeasonArchives(existing, proposed) : null,
      error: null,
    };
  } catch (err) {
    return {
      leagueSlug: league.slug,
      displayName: league.displayName,
      status: league.status,
      hasExistingArchive: false,
      champion: null,
      top3: [],
      diff: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// POST — two-phase per-year operation: preview ({year, confirmed:false}) or
// execute ({year, confirmed:true}). Eligibility is re-evaluated on EVERY POST —
// a previously generated preview is never authorization to bypass a changed gate.
export async function POST(req: Request): Promise<Response> {
  // Authenticate before any registry/cache work.
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(
      { error: 'rollover-invalid-request', detail: 'Body must be valid JSON.' },
      { status: 400 }
    );
  }
  if (!raw || typeof raw !== 'object') {
    return Response.json(
      { error: 'rollover-invalid-request', detail: 'Body must be an object.' },
      { status: 400 }
    );
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.year !== 'number' || !Number.isInteger(obj.year) || obj.year < 2000) {
    return Response.json(
      { error: 'rollover-invalid-request', detail: 'year must be a valid integer season year.' },
      { status: 400 }
    );
  }
  if (typeof obj.confirmed !== 'boolean') {
    return Response.json(
      { error: 'rollover-invalid-request', detail: 'confirmed must be a boolean.' },
      { status: 400 }
    );
  }
  const year = obj.year;
  const confirmed = obj.confirmed;

  // The requested year must be a CURRENT lifecycle-year group (non-test leagues
  // in `season` whose status.year matches exactly).
  const groups = groupRolloverTargets(await getLeagues());
  const group = groups.find((g) => g.year === year);
  if (!group) {
    return Response.json(
      {
        error: 'rollover-year-not-active',
        detail: `No non-test league is currently in season for year ${year}.`,
      },
      { status: 409 }
    );
  }

  // Mandatory strict-gate re-evaluation for BOTH preview and execution. No
  // preview or execution work may proceed after a refused/unavailable decision.
  const decision = await resolveNationalChampionshipRollover(year, Date.now());
  if (decision.kind === 'read-failed') {
    return Response.json(
      {
        error: 'rollover-eligibility-unavailable',
        reason: 'read-failed',
        detail: 'Rollover eligibility could not be determined — a durable store read failed.',
      },
      { status: 503 }
    );
  }
  if (decision.kind === 'skip') {
    return Response.json(
      { error: 'rollover-not-eligible', reason: decision.reason },
      { status: 409 }
    );
  }

  // Phase 1 — Preview: per-league archive status and diff, no durable mutation.
  if (!confirmed) {
    const previews = await Promise.all(group.leagues.map((l) => buildLeaguePreview(l, year)));
    const body: ManualRolloverPreviewResponse = {
      preview: {
        year,
        championshipDate: decision.championshipDate,
        rolloverDate: decision.rolloverDate,
        leagues: previews,
      },
    };
    return Response.json(body);
  }

  // Phase 2 — Confirmed execution, two-stage archive-first safety.
  // Stage 1: build and save ALL archives; any failure prevents every status
  // transition for this year group.
  const archivedLeagues: string[] = [];
  const errors: ManualRolloverExecuteResponse['errors'] = [];

  for (const league of group.leagues) {
    try {
      const archive = await buildSeasonArchive(league.slug, year);
      await saveSeasonArchive(archive);
      archivedLeagues.push(league.slug);
    } catch (err) {
      errors.push({
        leagueSlug: league.slug,
        stage: 'archive',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  if (errors.length > 0) {
    const body: ManualRolloverExecuteResponse = {
      success: false,
      year,
      archivedLeagues,
      rolledOverLeagues: [],
      errors,
      message:
        'One or more leagues failed to archive. No status transitions were made. Resolve errors and retry.',
    };
    return Response.json(body);
  }

  // Stage 2: transition each archived league to offseason. Status-write
  // failures are reported truthfully — a partial outcome is never a success.
  const rolledOverLeagues: string[] = [];
  for (const league of group.leagues) {
    try {
      await updateLeagueStatus(league.slug, { state: 'offseason' });
      rolledOverLeagues.push(league.slug);
    } catch (err) {
      errors.push({
        leagueSlug: league.slug,
        stage: 'status',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      continue;
    }

    // Season→offseason changes this league's standings surface (live → archived
    // final). Invalidate only leagues whose status transition succeeded.
    try {
      invalidateStandings(league.slug);
    } catch {
      // Non-fatal — archive and status are already durable.
    }

    // Suppression clearing is best-effort and only after archive + status success.
    try {
      await clearAllSuppressionRecords(league.slug, year);
    } catch {
      // Best-effort; rollover already succeeded for this league.
    }
  }

  const body: ManualRolloverExecuteResponse = {
    success: errors.length === 0,
    year,
    archivedLeagues,
    rolledOverLeagues,
    errors,
    ...(errors.length > 0
      ? { message: 'One or more status transitions failed. See errors for detail.' }
      : {}),
  };
  return Response.json(body);
}
