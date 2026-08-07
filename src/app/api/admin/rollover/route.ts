import { requireAdminAuth } from '@/lib/server/adminAuth';
import { readLeagueRegistry } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';
import { getSeasonArchive, diffSeasonArchives } from '@/lib/seasonArchive';
import { buildSeasonArchive } from '@/lib/seasonRollover';
import { groupRolloverTargets, type RolloverYearGroup } from '@/lib/rolloverTargeting';
import {
  resolveNationalChampionshipRollover,
  type ChampionshipRolloverDecision,
} from '@/lib/schedule/nationalChampionshipRollover';
import type {
  ManualRolloverLeaguePreview,
  ManualRolloverPreviewResponse,
  ManualRolloverStatusResponse,
  ManualRolloverYearStatus,
} from '@/lib/manualRollover';
import type { League } from '@/lib/league';

/**
 * PLATFORM-086F2B — per-year season-rollover STATUS and PREVIEW, behind the
 * SAME strict eligibility authority as the automatic cron
 * (`resolveNationalChampionshipRollover`: structured CFP national championship
 * + confirmed complete final + seven-day delay; cache-only, no provider calls).
 *
 * Target selection is the shared `groupRolloverTargets` policy (non-test
 * leagues in `season`, grouped exclusively by `status.year`), so a preview can
 * never describe an offseason/preseason/test/missing-status league or
 * contaminate a sibling year.
 *
 * PLATFORM-086F2H3A — this route is PREVIEW-ONLY. It performs no durable write
 * of any kind: no archive, no lifecycle status, no standings invalidation, no
 * suppression clearing. `GET /api/cron/season-rollover` is the sole rollover
 * executor.
 *
 * Manual execution was retired because it had no unique authority and no unique
 * recovery behavior: it sat behind the identical gate as the daily cron with no
 * force bypass, so its only effect was advancing an ALREADY-ELIGIBLE rollover by
 * less than 24 hours. That convenience did not justify a second permanent
 * lifecycle-write surface. The preview is the capability worth keeping — it is
 * the only way to see which owners' final standings would flip before anything
 * is written, and the cron has no equivalent.
 *
 * An exceptional forced recovery would still require a separately reviewed
 * operation with explicit semantics — never a restored generic execute button.
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

  // PLATFORM-086F2H1R4 — a local sink: this handler has no run-scoped execution
  // state, and each request is its own scope. The grouping policy publishes
  // refusals into it as it counts them; the try/catch below is what makes that
  // durability real on this surface, since without it a corrupt record throwing
  // mid-loop would escape the handler and the observed count would be lost to a
  // framework-generated 500 with no body at all.
  const refusals = { invalidLifecycleTargets: 0, excludedDemoCandidate: false };
  let registry: Awaited<ReturnType<typeof readLeagueRegistry>>;
  try {
    registry = await readLeagueRegistry();
  } catch {
    // Store-read failures keep their existing server-error behavior (500); only
    // the body becomes typed, so the count survives.
    return Response.json(
      {
        error: 'rollover-registry-unavailable',
        detail: 'The league registry could not be read.',
        invalidLifecycleTargets: refusals.invalidLifecycleTargets,
      },
      { status: 500 }
    );
  }
  if (registry.kind === 'malformed') {
    // 409, not 400 or 503: the request is well-formed and no dependency is
    // down — stored state prevents the operation. Sanitized: the corrupt value
    // is never echoed. Refused before any championship/cache resolution.
    return Response.json(
      {
        error: 'rollover-registry-malformed',
        detail: 'The league registry record exists but does not hold a list of leagues.',
      },
      { status: 409 }
    );
  }
  let groups;
  try {
    groups = groupRolloverTargets(registry.kind === 'ok' ? registry.leagues : [], refusals);
  } catch {
    // A corrupt RECORD inside an otherwise valid container. The refusals the
    // loop already published survive on `refusals` — that is the whole point of
    // the sink — so report them rather than losing them to a bare 500.
    return Response.json(
      {
        error: 'rollover-registry-unavailable',
        detail: 'The league registry contains an unreadable record.',
        invalidLifecycleTargets: refusals.invalidLifecycleTargets,
      },
      { status: 500 }
    );
  }
  const now = Date.now();

  const years: ManualRolloverYearStatus[] = [];
  for (const group of groups) {
    const decision = await resolveNationalChampionshipRollover(group.year, now);
    years.push(yearStatusFromDecision(group, decision));
  }

  const body: ManualRolloverStatusResponse = {
    generatedAt: new Date().toISOString(),
    years,
    // Valid groups stay fully usable when unrelated unusable candidates coexist:
    // the count reports them without withholding work an operator can do.
    invalidLifecycleTargets: refusals.invalidLifecycleTargets,
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

// POST — per-year archive PREVIEW ({ year }). Read-only: no durable write of any
// kind. Eligibility is re-evaluated on every POST, so a preview always describes
// the gate's current answer rather than a cached one.
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
  // PLATFORM-086F2H3A — `confirmed` is retired but deliberately still VALIDATED
  // and still REJECTED when true, rather than deleted from the contract.
  //
  // Deleting the field would make a stale client's `{ year, confirmed: true }`
  // body VALID — unknown properties are ignored — so an execute request would
  // silently receive a PREVIEW. That client decodes the response as an execute
  // result, reads `success` as `undefined`, and tells the operator "Rollover did
  // not fully complete." No write occurs, but the operator is told a rollover
  // was attempted and failed when none was attempted. The realistic case is a
  // browser still holding the pre-deploy bundle; a bookmarked `curl` is the
  // same shape.
  //
  // Refused BEFORE any registry, championship, or archive work: a retired verb
  // does no work.
  if (obj.confirmed !== undefined && typeof obj.confirmed !== 'boolean') {
    return Response.json(
      { error: 'rollover-invalid-request', detail: 'confirmed must be a boolean.' },
      { status: 400 }
    );
  }
  if (obj.confirmed === true) {
    return Response.json(
      {
        error: 'rollover-execution-retired',
        detail:
          'Manual rollover execution has been retired. The daily rollover cron is the only ' +
          'executor; this route previews the archive without writing.',
      },
      { status: 409 }
    );
  }
  const year = obj.year;

  // The requested year must be a CURRENT lifecycle-year group (non-test leagues
  // in `season` whose status.year matches exactly).
  const refusals = { invalidLifecycleTargets: 0, excludedDemoCandidate: false };
  let registry: Awaited<ReturnType<typeof readLeagueRegistry>>;
  let groups;
  try {
    registry = await readLeagueRegistry();
    if (registry.kind === 'malformed') {
      // Flagged, not returned from inside the try: returning here would put the
      // refusal under a catch that relabels everything as unavailable.
      groups = null;
    } else {
      groups = groupRolloverTargets(registry.kind === 'ok' ? registry.leagues : [], refusals);
    }
  } catch {
    return Response.json(
      {
        error: 'rollover-registry-unavailable',
        detail: 'The league registry could not be read.',
        invalidLifecycleTargets: refusals.invalidLifecycleTargets,
      },
      { status: 500 }
    );
  }
  if (groups === null) {
    return Response.json(
      {
        error: 'rollover-registry-malformed',
        detail: 'The league registry record exists but does not hold a list of leagues.',
      },
      { status: 409 }
    );
  }
  const group = groups.find((g) => g.year === year);
  if (!group) {
    // A refused production record makes `rollover-year-not-active` FALSE: the
    // league exists and is in season, its year is merely unusable. Naming the
    // integrity condition is what tells an operator the repair is a data fix,
    // not a wait.
    if (refusals.invalidLifecycleTargets > 0) {
      return Response.json(
        {
          error: 'rollover-unusable-lifecycle-year',
          // RUN-scoped, and worded to stay within what the route knows. A
          // refused record has no usable year, so it cannot be attributed to
          // the requested one; claiming this year is blocked on a repair would
          // overstate the case when the requested year was never rollable.
          detail:
            `No non-test league is currently in season for year ${year}, and ` +
            `${refusals.invalidLifecycleTargets} league record(s) in season were refused for an ` +
            `unusable season year — one of them may be the year you meant.`,
          invalidLifecycleTargets: refusals.invalidLifecycleTargets,
        },
        { status: 409 }
      );
    }
    return Response.json(
      {
        error: 'rollover-year-not-active',
        detail: `No non-test league is currently in season for year ${year}.`,
        invalidLifecycleTargets: refusals.invalidLifecycleTargets,
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

  // The archive preview: per-league existing/proposed comparison. Every read is
  // cache-only (`getSeasonArchive`, `buildSeasonArchive`), and nothing on this
  // path writes — that is the route's whole contract since F2H3A.
  const previews = await Promise.all(group.leagues.map((l) => buildLeaguePreview(l, year)));
  const body: ManualRolloverPreviewResponse = {
    invalidLifecycleTargets: refusals.invalidLifecycleTargets,
    preview: {
      year,
      championshipDate: decision.championshipDate,
      rolloverDate: decision.rolloverDate,
      leagues: previews,
    },
  };
  return Response.json(body);
}
