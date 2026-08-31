/**
 * Cache-only provider-data diagnostics (PLATFORM-086A).
 *
 * Derives actionable "missing / stale data" warnings for the admin status panel
 * purely from canonical schedule + durable caches. It NEVER makes a provider
 * call — determining status must not itself spend quota. Each dataset's checks
 * are individually guarded so one failing read cannot sink the whole report.
 */

import type { CacheEntry as ScheduleCacheEntry } from '@/app/api/schedule/cache';
import { defaultOddsCacheKey } from '@/app/api/odds/routeInternals';
import { getAppState } from './appStateStore.ts';
import { GAME_STATS_SCOPE, getGameStatsKey } from '../gameStats/cache.ts';
import {
  loadCanonicalGameStatsSlate,
  type CanonicalSlateResult,
} from '../gameStats/canonicalSlate.ts';
import type { SeasonRelation } from '../gameStats/contract.ts';
import { evaluatePartitionCoverage } from '../gameStats/partitionCoverage.ts';
import { validateGameStatsEnvelope } from '../gameStats/publicProjection.ts';
import type { WeeklyGameStats } from '../gameStats/types.ts';
import { deriveApplicableScoreSeasonTypes } from './scoreApplicability.ts';
import { loadCachedScheduleItems } from './canonicalScheduleCache.ts';
import {
  parseSchedulerExecutionReceipt,
  SCHEDULER_EXECUTION_STATUS_SCOPE,
} from './schedulerExecutionStatus.ts';
import { isWithinEarlyOddsPollingHorizon } from '../odds/pollingPolicy.ts';
import { isDisruptedStatusLabel } from '../gameStatus.ts';
import { formatRelativeTimestamp } from '../freshness.ts';
import {
  getProviderDatasetDescriptor,
  PROVIDER_DATASETS,
  type ProviderDataset,
} from '../providerDatasets.ts';
import type { CfbdSeasonType } from '../cfbd.ts';
import { loadLiveScoreContext } from '../liveScores/canonicalContext.ts';
import type { ProviderDiagnosticGameRef } from './scoreGapDiagnostics.ts';
import { deriveScoreHealthDiagnostics } from './scoreHealthDiagnostics.ts';
import { readTeamRecordsCache } from '../teamRecords/teamRecordsCache.ts';

/**
 * Minimal shape of a durable `odds-cache` entry — only its capture times matter
 * here. `observedAt` is the provider OBSERVATION time and `lastFetch` the
 * commit/TTL clock; the polling policy prefers the former, so reading only
 * `lastFetch` would judge freshness on a different clock than the cron does.
 */
type OddsCacheFreshness = { lastFetch?: number | null; observedAt?: string | null };

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

/**
 * Stable, machine-readable diagnostic code (PLATFORM-086F2F). The closed
 * vocabulary lets the System Health issue model consume the diagnostic's
 * IDENTITY and structured fields rather than parse its human `message`. Each
 * code maps 1:1 to an existing diagnostic branch below; adding a code never
 * changes the domain logic or freshness policy that emits it.
 */
export type ProviderDiagnosticCode =
  | 'schedule-cache-missing'
  | 'schedule-refresh-partial'
  | 'schedule-cache-stale'
  | 'schedule-diagnostics-unavailable'
  | 'scores-terminal-coverage-missing'
  | 'scores-terminal-coverage-partial'
  | 'scores-elapsed-time-conclusions'
  | 'scores-diagnostics-unavailable'
  | 'game-stats-context-unavailable'
  | 'game-stats-latest-slate-missing'
  | 'game-stats-older-slate-missing'
  | 'game-stats-evidence-partial'
  | 'game-stats-duplicate-conflict'
  | 'game-stats-identity-mismatch'
  | 'game-stats-participant-validation-unavailable'
  | 'game-stats-record-unservable'
  | 'game-stats-diagnostics-unavailable'
  | 'rankings-cache-missing'
  | 'rankings-cache-stale'
  | 'rankings-diagnostics-unavailable'
  | 'records-cache-stale'
  | 'records-diagnostics-unavailable'
  | 'odds-cache-missing'
  | 'odds-cache-stale'
  | 'odds-diagnostics-unavailable';

/**
 * The in-app operator surface that can act on a diagnostic, or `null` when no
 * in-app repair exists (e.g. an observability read that merely failed). This is
 * only a SURFACE hint; the System Health model materializes the full repair
 * destination (href + label) so this module stays free of any UI/route detail.
 */
export type ProviderDiagnosticRepairSurface = 'data-maintenance' | 'team-identity';

export type ProviderDiagnostic = {
  dataset: ProviderDataset;
  severity: DiagnosticSeverity;
  message: string;
  /** Stable identity of this diagnostic branch (PLATFORM-086F2F). */
  code: ProviderDiagnosticCode;
  /** In-app repair surface hint, or `null` when no in-app repair applies. */
  repair: ProviderDiagnosticRepairSurface | null;
  /** Bounded canonical game identities for a game-granular diagnostic. */
  gameRefs?: ProviderDiagnosticGameRef[];
  /** Total affected games when `gameRefs` is bounded. */
  affectedGameCount?: number;
};

/**
 * PLATFORM-090 — whether canonical schedule/slate semantics say a dataset's
 * evidence SHOULD EXIST yet.
 *
 *   expected        → canonical semantics require evidence now; an absent cache
 *                     is an actionable gap (the ordinary case)
 *   not-yet-expected→ nothing has happened that would produce this data, so an
 *                     absent cache is a healthy lifecycle state, not a fault
 *   unknown         → the inputs that would decide it could not be read; never
 *                     assert expected absence from an unreadable input
 *
 * This is the SAME decision the game-stats diagnostics already make when they
 * choose whether to emit a missing-evidence diagnostic — published so the
 * System Health presentation can distinguish expected from unexpected absence
 * instead of inferring it. It is NOT a redefinition of cache availability.
 *
 * `game-stats` is the only dataset GIVEN an applicability state here, which is
 * deliberately narrower than "the only dataset that could have one" — a claim
 * this module does not establish and which review showed to be false. On a
 * genuinely cold preseason deployment `scores` (its cron skips
 * `no-polling-target`, and its diagnostics are gated on a completed slate),
 * `odds`, and `rankings` (whose absence diagnostics are `info`, which the
 * freshness stoplight does not consult) can each show the same absent cache
 * with no actionable diagnostic. Extending the concept to them is deliberately
 * out of this task's scope: each needs its own canonical applicability
 * authority, and none may borrow game-stats' slate semantics. Tracked in
 * `docs/next-tasks.md` → "Unresolved decisions & known deferrals". Until then
 * every other dataset is `expected` by construction and its absence stays
 * actionable exactly as before.
 */
export type ProviderDataExpectation = 'expected' | 'not-yet-expected' | 'unknown';

export type ProviderDataExpectations = Record<ProviderDataset, ProviderDataExpectation>;

/**
 * A conservative all-`unknown` map, for when the diagnostics pass itself fails.
 *
 * Today this is a SECOND guard, not the operative one: the same failed pass also
 * makes `diagnosticsAvailable` false, and `deriveDatasetFreshness` short-circuits
 * to Unknown before it ever reads an expectation. It is kept because the two
 * signals are independent inputs to that function and nothing forces them to
 * stay coupled — but do not mistake a passing freshness test for proof that this
 * fallback is what produced the result (review finding; mutating this helper's
 * return value does not move any freshness assertion).
 */
export function unknownProviderDataExpectations(): ProviderDataExpectations {
  return PROVIDER_DATASETS.reduce((acc, dataset) => {
    acc[dataset] = 'unknown';
    return acc;
  }, {} as ProviderDataExpectations);
}

export type ProviderDataDiagnosticsResult = {
  year: number;
  generatedAt: string;
  diagnostics: ProviderDiagnostic[];
  /**
   * PLATFORM-090 — per-dataset evidence expectation (see above). Derived from
   * the canonical schedule/slate authorities only; never from the calendar.
   */
  expectations: ProviderDataExpectations;
  /**
   * Score season-types worth a manual refresh for this year, derived cache-only
   * from the canonical schedule (rereview finding #1). Postseason is included
   * only once the schedule actually carries postseason games, so a mid-regular-
   * season manual score refresh does not fire a doomed postseason request before
   * bowls are published.
   */
  scoreSeasonTypes: CfbdSeasonType[];
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A slate counts as "complete" once its latest kickoff is > 6h in the past —
// the same threshold the game-stats cron uses to pick the latest finished week.
const SLATE_COMPLETE_AFTER_MS = 6 * HOUR_MS;
const STALE_SCHEDULE_AFTER_MS = 8 * DAY_MS;
const STALE_RANKINGS_AFTER_MS = 8 * DAY_MS;
const STALE_RECORDS_AFTER_MS = getProviderDatasetDescriptor('records').staleAfterMs;
const STALE_ODDS_AFTER_MS = 2 * DAY_MS;
const MAX_LISTED_SLATES = 6;
const MAX_LISTED_GAME_REFS = 6;

type SlateKey = string; // `${week}:${seasonType}`

function slateKey(week: number, seasonType: CfbdSeasonType): SlateKey {
  return `${week}:${seasonType}`;
}

function normalizeSeasonType(value: unknown): CfbdSeasonType {
  return value === 'postseason' ? 'postseason' : 'regular';
}

type CompletedSlate = { week: number; seasonType: CfbdSeasonType; latestKickoff: number };

/**
 * Completed slates (whole-slate latest kickoff > 6h ago), newest first.
 *
 * A slate is grouped by (year — implicit in the caller, week, seasonType) and its
 * `latestKickoff` is the MAX kickoff across ALL its games. The completion
 * threshold is applied to that per-slate maximum, AFTER grouping — never
 * per-game. This is the PLATFORM-086A remediation for split slates: a week with
 * an early Thursday game and later Saturday games is not "complete" until the
 * Saturday games are old, so it no longer raises false missing-score /
 * missing-game-stats warnings while the slate is still underway.
 */
function deriveCompletedSlates(
  items: ReadonlyArray<{
    startDate?: string | null;
    week: number;
    seasonType?: string | null;
  }>,
  now: number
): CompletedSlate[] {
  // 1) Group EVERY game by slate; track each slate's max kickoff across all games.
  const latestByKey = new Map<SlateKey, CompletedSlate>();
  for (const item of items) {
    if (!item.startDate) continue;
    const kickoff = new Date(item.startDate).getTime();
    if (!Number.isFinite(kickoff)) continue;
    const seasonType = normalizeSeasonType(item.seasonType);
    const key = slateKey(item.week, seasonType);
    const prev = latestByKey.get(key);
    if (!prev || kickoff > prev.latestKickoff) {
      latestByKey.set(key, { week: item.week, seasonType, latestKickoff: kickoff });
    }
  }
  // 2) A slate is complete only once its WHOLE-slate latest kickoff is old enough.
  return [...latestByKey.values()]
    .filter((slate) => slate.latestKickoff <= now - SLATE_COMPLETE_AFTER_MS)
    .sort((a, b) => b.latestKickoff - a.latestKickoff);
}

/**
 * Whether the LAST automatic Odds run confirmed the provider simply has no lines
 * for this season right now — `no-op / early-lines-withdrawn`, recent enough to
 * still describe the current state.
 *
 * This is the ONE case where an unmoving cache entry does not mean maintenance is
 * behind. The provider was asked, answered "nothing", and the prior rows were
 * retained by policy rather than by neglect, so the entry's timestamp cannot
 * advance no matter how healthy the loop is. Without this the Odds card warns
 * every day of a preseason book withdrawal, with no operator action that clears
 * it — the standing false alarm PLATFORM-089 exists to remove, relocated from the
 * provider-fault channel to the staleness channel.
 *
 * DELIBERATELY NARROW, keyed on the REASON rather than on "a check completed".
 * The sibling no-op — `empty-response` over rows that could not be proven
 * obsolete — leaves the entry untouched too, but there the served data really is
 * unverified and the warning is right. Reading `lastCompletedCheckAt` alone
 * cannot tell them apart, which is exactly why that broader rule was rejected.
 *
 * Fail-closed at every step: no receipt, an unparseable one, a different job,
 * another year, or any other reason ⇒ the ordinary entry-based rule applies.
 */
async function providerConfirmedNoLines(year: number, now: number): Promise<boolean> {
  try {
    const record = await getAppState<unknown>(SCHEDULER_EXECUTION_STATUS_SCOPE, 'odds');
    const receipt = parseSchedulerExecutionReceipt(record?.value, 'odds', now);
    if (!receipt) return false;
    if (receipt.result !== 'no-op' || receipt.reason !== 'early-lines-withdrawn') return false;
    if (receipt.target.kind !== 'odds' || receipt.target.year !== year) return false;
    const completedMs = Date.parse(receipt.completedAt);
    // The confirmation expires on the SAME clock as staleness: once it is older
    // than a snapshot would be allowed to be, it no longer describes now.
    return Number.isFinite(completedMs) && now - completedMs <= STALE_ODDS_AFTER_MS;
  } catch {
    return false;
  }
}

/**
 * Whether the Odds cron has anything to poll: some non-disrupted schedule game
 * kicks off inside the 45-day polling horizon.
 *
 * Deliberately NOT the ±45-day `isSeasonActive` window below, which is symmetric
 * and so counts games already played. It is also deliberately a SUPERSET of true
 * eligibility — it does not re-derive canonical identity, because doing so here
 * would mean a second resolution path in a cache-only read. Superset is the safe
 * direction: it can leave a warning standing that the cron would skip for an
 * unresolved participant, but it can never suppress one the cron could act on.
 *
 * Reads through `loadCachedScheduleItems` — the SAME authority the cron's
 * canonical context uses — rather than the `${year}-all-all` items this module
 * already loaded. That entry is only the first of three keys: the loader falls
 * back to the `-all-regular` + `-all-postseason` pair when it is absent or empty.
 * On that durable shape the caller's list is empty, so a check against it would
 * see NO pollable target and could never warn, while the cron polled normally —
 * reintroducing the health-vs-cron disagreement this whole change removes. The
 * caller's items are still used when they are populated, so the common path
 * costs no extra read.
 */
async function hasPollableOddsTarget(
  year: number,
  loadedItems: ScheduleCacheEntry['items'],
  now: number
): Promise<boolean> {
  const items = loadedItems.length > 0 ? loadedItems : await loadCachedScheduleItems(year);
  for (const item of items) {
    if (!item.startDate) continue;
    if (isDisruptedStatusLabel(item.status)) continue;
    if (isWithinEarlyOddsPollingHorizon(new Date(item.startDate).getTime(), now)) return true;
  }
  return false;
}

/** Whether the season is "active" around now (any game within ±45 days). */
function isSeasonActive(items: ScheduleCacheEntry['items'], now: number): boolean {
  const windowMs = 45 * DAY_MS;
  for (const item of items) {
    if (!item.startDate) continue;
    const kickoff = new Date(item.startDate).getTime();
    if (!Number.isFinite(kickoff)) continue;
    if (Math.abs(kickoff - now) <= windowMs) return true;
  }
  return false;
}

/**
 * `loadCanonicalGameStatsSlate`, guarded.
 *
 * The loader wraps every one of its own boundaries and so cannot currently
 * throw — this catch is UNREACHABLE today (review finding, confirmed). It is
 * kept because this call sits OUTSIDE the per-dataset try blocks, so a future
 * throw here would sink the entire diagnostics pass and degrade every row to
 * Unknown, breaking this module's stated isolation invariant ("one failing read
 * cannot sink the whole report"). It is a structural guard, not a live one; the
 * reason it reports is a best guess and should not be read as a diagnosis.
 */
async function loadGameStatsSlate(year: number, now: number): Promise<CanonicalSlateResult> {
  try {
    return await loadCanonicalGameStatsSlate({ year, now: new Date(now) });
  } catch {
    return { status: 'unavailable', reason: 'canonical-build-failed' };
  }
}

/**
 * Whether the schedule the CANONICAL SLATE is built from is known to be missing
 * part of the season (review round 5).
 *
 * This MUST mirror `loadCachedScheduleItems`' key precedence, because that is
 * what the slate reads. Round 4 derived completeness from the `${year}-all-all`
 * aggregate alone while moving the slate onto the broader loader — two inputs to
 * one predicate, read from two different places. On the fallback shape
 * (`all-all` absent/empty, children serving) the flag stayed false, so a cache
 * holding only future postseason rows could report `not-yet-expected` while an
 * entire played regular season was simply absent.
 *
 * Asymmetry is deliberate and load-bearing: a missing REGULAR partition is
 * dangerous (it is where a played season lives), while a missing POSTSEASON
 * partition is the ordinary state for most of the year — bowls are not published
 * until late, and a postseason game is always LATER than the regular games we
 * can see, so it cannot hide a played game while every regular game is still
 * pending. Treating an absent postseason partition as incomplete would report
 * `unknown` for most of a normal season and defeat the feature.
 */
async function isScheduleIncomplete(
  year: number,
  aggregate: ScheduleCacheEntry | undefined
): Promise<boolean> {
  // The aggregate serves only when it actually carries rows — the exact
  // precedence `loadCachedScheduleItems` applies.
  if ((aggregate?.items?.length ?? 0) > 0) {
    return aggregate?.partialFailure === true || (aggregate?.failedSeasonTypes?.length ?? 0) > 0;
  }
  // GUARDED, and this is the only durable read on the function's top-level path
  // (round 6, found independently by both reviewers). `getAppState` THROWS on a
  // real store error, and this helper is called outside every per-dataset try
  // block — so an unguarded rejection escaped `getProviderDataDiagnostics`
  // entirely, 500ing `/api/admin/provider-status` and degrading all six System
  // Health rows to Unknown. That breaks this module's stated isolation rule
  // ("one failing read cannot sink the whole report") and is strictly worse than
  // the warning this branch exists to remove.
  //
  // Fails closed to INCOMPLETE: an unreadable partition cannot prove the season
  // is fully accounted for, so the expectation resolves `unknown` and the
  // ordinary absence warning stands.
  try {
    const regular = await getAppState<ScheduleCacheEntry>('schedule', `${year}-all-regular`);
    const value = regular?.value;
    if ((value?.items?.length ?? 0) === 0) return true;
    return value?.partialFailure === true || (value?.failedSeasonTypes?.length ?? 0) > 0;
  } catch {
    return true;
  }
}

/**
 * PLATFORM-090 v2 — whether game-stat evidence should exist yet.
 *
 * RE-DERIVED (review round 4). Rounds 1–3 inferred this from coverage
 * denominators over COMPLETED SLATES, and then accreted a guard per round to
 * patch the edges of that basis: unreadable kickoffs, dropped rows, per-partition
 * raw-vs-canonical accounting, unservable records. All of it existed because the
 * basis was wrong, not because the question is hard.
 *
 * The canonical slate answers the question DIRECTLY. `CanonicalGame.applicability`
 * is the schedule-authoritative "is evidence owed for this game" decision —
 * `expected` once a stat-producing game's own kickoff is ≥6h old, `pending`
 * before that, `not-expected` for disrupted/placeholder games — and it is the
 * same authority `evaluatePartitionCoverage` counts and the polling target
 * selects from. Asking it directly removes every accumulated guard:
 *
 *   - a DROPPED row is not "missing evidence" — it is outside the canonical
 *     system entirely (never polled, never counted by coverage, never warned
 *     about), so it cannot make evidence owed. The total-drift case, where the
 *     whole slate drops out, is caught by the empty-slate rule below.
 *   - an UNSERVABLE stored record says nothing about whether evidence is owed;
 *     it raises its own warning, which outranks the absent-cache branch in the
 *     freshness stoplight anyway.
 *   - per-partition accounting is unnecessary when nothing is inferred from a
 *     partition's coverage count.
 *
 * `not-yet-expected` remains a POSITIVE claim, so it still requires positively
 * trustworthy inputs — an available, non-empty slate, a schedule not known to be
 * missing a partition, and no game left `pending` by an unreadable kickoff
 * (which could be hiding a played game). Everything else is `unknown`, which
 * keeps the ordinary absence warning.
 *
 * Known and stated: the polling window opens at kickoff+3h while `expected`
 * begins at +6h, so for three hours after the season's first kickoff the cron may
 * poll a game this reports as not yet owed. That is not a discrepancy to fix
 * here — `expected` is the coverage authority's own threshold, and matching the
 * poll window instead would make this row disagree with the diagnostics.
 */
function deriveGameStatsExpectation(
  slateResult: CanonicalSlateResult,
  scheduleIncomplete: boolean
): ProviderDataExpectation {
  if (slateResult.status === 'unavailable') return 'unknown';
  const games = slateResult.slate.games;
  // An empty canonical slate proves nothing: no schedule cached, or a build that
  // dropped everything. Never "no games are expected".
  if (games.length === 0) return 'unknown';
  if (games.some((game) => game.applicability === 'expected')) return 'expected';
  if (scheduleIncomplete) return 'unknown';
  const hasUnreadablePending = games.some(
    (game) =>
      game.applicability === 'pending' &&
      !(typeof game.kickoff === 'string' && Number.isFinite(Date.parse(game.kickoff)))
  );
  return hasUnreadablePending ? 'unknown' : 'not-yet-expected';
}

export async function getProviderDataDiagnostics(
  year: number,
  options: {
    now?: number;
  } = {}
): Promise<ProviderDataDiagnosticsResult> {
  const now = options.now ?? Date.now();
  const diagnostics: ProviderDiagnostic[] = [];
  const push = (
    dataset: ProviderDataset,
    severity: DiagnosticSeverity,
    code: ProviderDiagnosticCode,
    message: string,
    repair: ProviderDiagnosticRepairSurface | null,
    details?: Pick<ProviderDiagnostic, 'gameRefs' | 'affectedGameCount'>
  ) => {
    diagnostics.push({ dataset, severity, code, message, repair, ...details });
  };

  // ---- Schedule (also the source of "completed slate" expectations) ----
  let scheduleItems: ScheduleCacheEntry['items'] = [];
  let seasonActive = false;
  // The `${year}-all-all` entry, retained so the expectation's completeness check
  // can apply the SAME key precedence the canonical slate loader uses (round 5).
  let scheduleAggregate: ScheduleCacheEntry | undefined;
  try {
    const scheduleRec = await getAppState<ScheduleCacheEntry>('schedule', `${year}-all-all`);
    const entry = scheduleRec?.value;
    scheduleAggregate = entry;
    scheduleItems = entry?.items ?? [];
    seasonActive = isSeasonActive(scheduleItems, now);

    if (!entry || scheduleItems.length === 0) {
      push(
        'schedule',
        'error',
        'schedule-cache-missing',
        `No current-season schedule cached for ${year}.`,
        'data-maintenance'
      );
    } else {
      if (entry.partialFailure) {
        const missing = entry.failedSeasonTypes?.length
          ? ` (missing: ${entry.failedSeasonTypes.join(', ')})`
          : '';
        push(
          'schedule',
          'warning',
          'schedule-refresh-partial',
          `Last schedule refresh was partial${missing}; some partitions are uncertain.`,
          'data-maintenance'
        );
      }
      const ageMs = now - entry.at;
      if (seasonActive && ageMs > STALE_SCHEDULE_AFTER_MS) {
        push(
          'schedule',
          'warning',
          'schedule-cache-stale',
          `Schedule last refreshed ${formatRelativeTimestamp(entry.at, now)} — older than the weekly policy.`,
          'data-maintenance'
        );
      }
    }
  } catch (error) {
    push(
      'schedule',
      'warning',
      'schedule-diagnostics-unavailable',
      `Schedule diagnostics unavailable: ${errText(error)}`,
      null
    );
  }

  const completedSlates = deriveCompletedSlates(scheduleItems, now);

  /**
   * PLATFORM-090 — the game-stats expectation, and the canonical slate it and the
   * coverage pass below share (loaded ONCE).
   *
   * Round 5 — completeness is read through `isScheduleIncomplete`, which mirrors
   * the slate loader's key precedence, so the two inputs to the predicate always
   * describe the SAME schedule. When that check reports incomplete AND the
   * aggregate held nothing, the slate would be built from a partial (or absent)
   * schedule and can only produce `unknown`, so the build is skipped entirely —
   * this restores the preseason/offseason cheapness the v2 re-derivation gave up
   * for a year with no usable cached schedule (catalog + alias reads and a full
   * `buildScheduleFromApi` are the expensive part, not the app-state reads).
   */
  const scheduleIncomplete = await isScheduleIncomplete(year, scheduleAggregate);
  const skipSlate = scheduleIncomplete && scheduleItems.length === 0;
  const slateResult: CanonicalSlateResult = skipSlate
    ? { status: 'unavailable', reason: 'schedule-load-failed' }
    : await loadGameStatsSlate(year, now);
  const gameStatsExpectation = skipSlate
    ? 'unknown'
    : deriveGameStatsExpectation(slateResult, scheduleIncomplete);

  // ---- Scores: game-granular terminal coverage for completed slates ----
  try {
    // The aggregate is only the first supported canonical schedule shape. When
    // it is absent/empty, use the same regular + postseason child fallback as
    // canonical standings and the live-score context; otherwise conclusions
    // accepted from that schedule would be invisible to System Health.
    const usesAggregateSchedule = scheduleItems.length > 0;
    const scoreScheduleItems = usesAggregateSchedule
      ? scheduleItems
      : await loadCachedScheduleItems(year);
    const scoreCompletedSlates = usesAggregateSchedule
      ? completedSlates
      : deriveCompletedSlates(scoreScheduleItems, now);
    if (scoreScheduleItems.length > 0) {
      // Supply the SAME schedule snapshot that established the completed slates.
      // The live-score context still owns canonical identity, reconciled cache
      // loading, and score attachment, with no third schedule read. Load it even
      // when no whole slate is complete: the completed-slate list constrains
      // terminal score-gap coverage only, while elapsed-time conclusions follow
      // their independent all-pending finality gate.
      const contextResult = await loadLiveScoreContext({
        year,
        now: new Date(now),
        scheduleItems: scoreScheduleItems,
      });
      if (contextResult.status === 'unavailable') {
        throw new Error(`canonical score context unavailable (${contextResult.reason})`);
      }
      const scoreDiagnostics = deriveScoreHealthDiagnostics({
        context: contextResult.context,
        completedSlates: scoreCompletedSlates,
        now: new Date(now),
        maxGameRefs: MAX_LISTED_GAME_REFS,
      });
      for (const diagnostic of scoreDiagnostics) {
        push(
          'scores',
          diagnostic.severity,
          diagnostic.code,
          diagnostic.message,
          'data-maintenance',
          {
            gameRefs: diagnostic.gameRefs,
            affectedGameCount: diagnostic.affectedGameCount,
          }
        );
      }
    }
  } catch (error) {
    push(
      'scores',
      'warning',
      'scores-diagnostics-unavailable',
      `Score diagnostics unavailable: ${errText(error)}`,
      null
    );
  }

  // ---- Game stats: PARTICIPANT-VERIFIED evidence coverage through the shared
  // canonical slate/evidence/coverage authorities (PLATFORM-086H3E3). Coverage
  // is no longer a raw providerGameId/nonempty-row count: a game counts only
  // when the evidence authority classifies its stored evidence `satisfied`
  // (complete, participant-verified), and the distinct fail-closed classes —
  // absence, incomplete, duplicate conflict, identity mismatch,
  // participant-validation unavailable, malformed/unreadable context — are all
  // reported distinctly. ----
  try {
    if (completedSlates.length > 0) {
      if (slateResult.status === 'unavailable') {
        push(
          'game-stats',
          'warning',
          'game-stats-context-unavailable',
          `Game-stats canonical context unavailable (${slateResult.reason}).`,
          null
        );
      } else {
        const nowDate = new Date(now);
        const currentSeason =
          nowDate.getUTCMonth() >= 6 ? nowDate.getUTCFullYear() : nowDate.getUTCFullYear() - 1;
        const seasonRelation: SeasonRelation = year < currentSeason ? 'historical' : 'current';

        const missing: CompletedSlate[] = [];
        const unservable: CompletedSlate[] = [];
        const partialSummaries: string[] = [];
        // Defect streams are kept SEPARATE (PLATFORM-086F2F) so each routes to its
        // correct repair surface: duplicate/conflict recovery is a Data Maintenance
        // action, an identity mismatch is a Team Identity fix, and a
        // participant-validation gap is recoverable via a full-year schedule refresh.
        const duplicateConflictSummaries: string[] = [];
        const identityMismatchSummaries: string[] = [];
        const participantUnavailableSummaries: string[] = [];
        // Whether ANY partial slate has a genuinely REPAIRABLE gap (incomplete or
        // absent evidence a refresh could fill). A partial made up only of
        // satisfied + manual-only evidence is an accepted upstream limitation with
        // NO repair path (AGENTS.md game-stats deferral), so its diagnostic must
        // not offer a known-ineffective Data Maintenance action.
        let partialRepairable = false;

        for (const slate of completedSlates) {
          // Raw durable read + the ONE shared envelope validation: only an
          // exactly-valid envelope for THIS partition resolves games.
          let record: WeeklyGameStats | null = null;
          let servable = true;
          try {
            const raw = await getAppState<unknown>(
              GAME_STATS_SCOPE,
              getGameStatsKey(year, slate.week, slate.seasonType)
            );
            const validation = validateGameStatsEnvelope(
              raw?.value ?? null,
              year,
              slate.week,
              slate.seasonType
            );
            if (validation.status === 'ok') record = validation.record;
            else if (validation.status !== 'absent') servable = false;
          } catch {
            servable = false;
          }
          if (!servable) {
            unservable.push(slate);
            continue;
          }

          const coverage = evaluatePartitionCoverage(
            slateResult.slate,
            slate.week,
            slate.seasonType,
            record,
            seasonRelation
          );
          // Zero expected stat-producing games (e.g. entirely disrupted): not
          // applicable — never a missing warning.
          if (coverage.games.length === 0) continue;

          const count = (state: string): number =>
            coverage.games.filter((g) => g.decision.state === state).length;
          const satisfied = count('satisfied');
          const incomplete = count('incomplete');
          const absent = count('absent');
          const duplicateConflict = count('duplicate-conflict');
          const identityMismatch = count('identity-mismatch');
          const participantUnavailable = count('participant-validation-unavailable');
          const manualOnly = count('manual-only');

          if (duplicateConflict > 0) {
            duplicateConflictSummaries.push(
              `week ${slate.week} ${slate.seasonType}: ${duplicateConflict} duplicate-conflict`
            );
          }
          if (identityMismatch > 0) {
            identityMismatchSummaries.push(
              `week ${slate.week} ${slate.seasonType}: ${identityMismatch} identity-mismatch`
            );
          }
          if (participantUnavailable > 0) {
            participantUnavailableSummaries.push(
              `week ${slate.week} ${slate.seasonType}: ${participantUnavailable} participant-validation-unavailable`
            );
          }

          if (coverage.state === 'complete') continue;
          if (satisfied === 0 && incomplete === 0 && manualOnly === 0) {
            // "Missing" is reserved for a genuinely refresh-repairable absence
            // (`absent > 0`). A slate whose only gaps are specialized defects —
            // identity-mismatch, duplicate-conflict, or participant-validation-
            // unavailable — is already reported under its own code with the
            // correct repair surface (Team Identity / Data Maintenance), so it
            // must NOT also emit the generic Data-Maintenance "missing"
            // diagnostic, which would offer a known-ineffective refresh.
            if (absent > 0) missing.push(slate);
            continue;
          }
          if (incomplete > 0 || absent > 0) partialRepairable = true;
          partialSummaries.push(
            `week ${slate.week} ${slate.seasonType}: ${satisfied}/${coverage.games.length} verified-complete` +
              `${incomplete > 0 ? `, ${incomplete} incomplete` : ''}` +
              `${absent > 0 ? `, ${absent} absent` : ''}` +
              `${manualOnly > 0 ? `, ${manualOnly} manual-only` : ''}`
          );
        }

        if (missing.length > 0) {
          const latest = completedSlates[0];
          const latestMissing = missing.some(
            (s) => s.week === latest.week && s.seasonType === latest.seasonType
          );
          if (latestMissing) {
            push(
              'game-stats',
              'warning',
              'game-stats-latest-slate-missing',
              `Latest completed slate (week ${latest.week} ${latest.seasonType}) has no verified game-stat evidence.`,
              'data-maintenance'
            );
          }
          const older = missing.filter(
            (s) => !(s.week === latest.week && s.seasonType === latest.seasonType)
          );
          if (older.length > 0) {
            push(
              'game-stats',
              'info',
              'game-stats-older-slate-missing',
              `${describeSlates(older)} missing verified game-stat evidence (recoverable via manual refresh).`,
              'data-maintenance'
            );
          }
        }
        if (partialSummaries.length > 0) {
          push(
            'game-stats',
            'info',
            'game-stats-evidence-partial',
            `Partially verified game-stat evidence — ${partialSummaries.slice(0, MAX_LISTED_SLATES).join('; ')}.`,
            // Only offer a repair when at least one partial slate is actually
            // refresh-repairable; a purely satisfied + manual-only partial is an
            // accepted upstream limitation with no effective repair.
            partialRepairable ? 'data-maintenance' : null
          );
        }
        if (duplicateConflictSummaries.length > 0) {
          push(
            'game-stats',
            'warning',
            'game-stats-duplicate-conflict',
            `Game-stat evidence conflicts — ${duplicateConflictSummaries.slice(0, MAX_LISTED_SLATES).join('; ')}.`,
            'data-maintenance'
          );
        }
        if (identityMismatchSummaries.length > 0) {
          push(
            'game-stats',
            'warning',
            'game-stats-identity-mismatch',
            `Game-stat identity mismatches — ${identityMismatchSummaries.slice(0, MAX_LISTED_SLATES).join('; ')}.`,
            'team-identity'
          );
        }
        if (participantUnavailableSummaries.length > 0) {
          push(
            'game-stats',
            'warning',
            'game-stats-participant-validation-unavailable',
            `Game-stat participant validation unavailable — ${participantUnavailableSummaries
              .slice(0, MAX_LISTED_SLATES)
              .join('; ')} (full-year schedule refresh required).`,
            'data-maintenance'
          );
        }
        if (unservable.length > 0) {
          push(
            'game-stats',
            'warning',
            'game-stats-record-unservable',
            `${describeSlates(unservable)} stored game-stat records are malformed or unreadable.`,
            'data-maintenance'
          );
        }
      }
    }
  } catch (error) {
    // The COVERAGE pass failed. The expectation is unaffected: it is derived from
    // the canonical slate above, independently of any stored record (v2).
    push(
      'game-stats',
      'warning',
      'game-stats-diagnostics-unavailable',
      `Game-stats diagnostics unavailable: ${errText(error)}`,
      null
    );
  }

  // ---- Rankings: usable CONTENT + staleness during an active season ----
  // Coverage requires at least one usable week (5th-review finding #6). A durable
  // record whose `response.weeks` is empty (pre-poll or schema-drifted) is NOT
  // coverage — checking record presence alone would suppress the "no rankings"
  // diagnostic for an effectively-empty snapshot.
  try {
    const rankingsRec = await getAppState<{ at: number; response?: { weeks?: unknown[] } }>(
      'rankings',
      String(year)
    );
    const weeks = rankingsRec?.value?.response?.weeks;
    const hasUsableRankings = Array.isArray(weeks) && weeks.length > 0;
    if (!hasUsableRankings) {
      push(
        'rankings',
        'info',
        'rankings-cache-missing',
        `No rankings cached for ${year}.`,
        'data-maintenance'
      );
    } else if (seasonActive) {
      const ageMs = now - rankingsRec!.value.at;
      if (ageMs > STALE_RANKINGS_AFTER_MS) {
        push(
          'rankings',
          'warning',
          'rankings-cache-stale',
          `Rankings last refreshed ${formatRelativeTimestamp(rankingsRec!.value.at, now)} — older than the weekly policy.`,
          'data-maintenance'
        );
      }
    }
  } catch (error) {
    push(
      'rankings',
      'warning',
      'rankings-diagnostics-unavailable',
      `Rankings diagnostics unavailable: ${errText(error)}`,
      null
    );
  }

  // ---- Team records: year-wide cache age, independent of game context. ----
  // Records can be refreshed directly for any year and have no canonical-game,
  // active-season, or registry dependency. Their declared eight-day ceiling is
  // therefore enforced directly from the normalized cache entry's observation
  // clock, including during a no-final stretch when automation makes no call.
  try {
    const records = await readTeamRecordsCache(year);
    if (records && records.items.length > 0 && now - records.at > STALE_RECORDS_AFTER_MS) {
      push(
        'records',
        'warning',
        'records-cache-stale',
        `Team records last refreshed ${formatRelativeTimestamp(records.at, now)} — older than the eight-day policy.`,
        null
      );
    }
  } catch (error) {
    push(
      'records',
      'warning',
      'records-diagnostics-unavailable',
      `Team-record diagnostics unavailable: ${errText(error)}`,
      null
    );
  }

  // ---- Odds: freshness of the SELECTED SEASON's CANONICAL served odds cache. ----
  // A game without odds is NOT a failure; only staleness of THIS season's snapshot
  // is actionable. Freshness derives from the CANONICAL/DEFAULT season-scoped
  // `odds-cache` entry — the exact key the ordinary served UI reads — NOT the newest
  // `lastFetch` across all filtered query variants (5th-review finding #2: a filtered
  // markets/bookmakers refresh writes a separate key and would otherwise make the
  // canonical snapshot look fresh), and NOT the global quota-observation timestamp
  // (4th-review finding #4). Quota usage stays a separate panel display. Absence of
  // the canonical entry is reported as unknown, never treated as fresh.
  //
  // PLATFORM-089 — APPLICABILITY now agrees with the cron; FRESHNESS deliberately
  // still comes from the cache entry, per binding invariant 1 ("odds staleness
  // derives from the canonical/default season-scoped `odds-cache` entry").
  //
  // Applicability is the 45-day POLLING horizon, not the generic ±45-day
  // `seasonActive` window. The latter is symmetric: a game 40 days in the PAST
  // kept the season "active", so an old snapshot warned while the cron had
  // nothing to poll and no operator action existed. That warning is what this
  // task was reported for.
  //
  // FRESHNESS was briefly widened to `max(snapshot, lastCompletedCheckAt)` — the
  // idea being that a valid no-op proves the data is being maintained even when
  // the payload does not move. Both reviewers rejected it and the code agrees:
  // every no-op that leaves the entry untouched is the `preserved` branch of
  // `commitEmptyOddsRefresh`, which retains prior rows it CANNOT PROVE OBSOLETE
  // and keeps serving them. Counting the check clock there would have cleared
  // `odds-cache-stale` permanently — a fresh no-op every day — while `/api/odds`
  // served the same old lines. The scenario it was insuring against does not
  // arise: an unchanged non-empty payload still commits a fresh `lastFetch`, and
  // an empty response with no prior rows (or provably dead ones) writes a fresh
  // empty entry. The one remaining case is the one where the warning is right.
  //
  try {
    const oddsRec = await getAppState<OddsCacheFreshness>('odds-cache', defaultOddsCacheKey(year));
    const cached = oddsRec?.value;
    const lastFetch = cached?.lastFetch;
    // The ENTRY's own clock, preferring the provider OBSERVATION time when the
    // entry carries one — the same clock the polling cadence measures, so the two
    // surfaces cannot disagree by measuring different things about the same
    // record. `observedAt` is captured before the request and `lastFetch` at
    // commit, so this only ever reads slightly OLDER, never fresher.
    const observedMs = cached?.observedAt ? Date.parse(cached.observedAt) : Number.NaN;
    const snapshotMs = Number.isFinite(observedMs)
      ? observedMs
      : typeof lastFetch === 'number' && Number.isFinite(lastFetch)
        ? lastFetch
        : null;

    if (typeof lastFetch !== 'number' || !Number.isFinite(lastFetch)) {
      push(
        'odds',
        'info',
        'odds-cache-missing',
        `No odds snapshot cached for ${year} yet.`,
        'data-maintenance'
      );
    } else if (await hasPollableOddsTarget(year, scheduleItems, now)) {
      const ageMs = snapshotMs === null ? Number.POSITIVE_INFINITY : now - snapshotMs;
      if (ageMs > STALE_ODDS_AFTER_MS && !(await providerConfirmedNoLines(year, now))) {
        push(
          'odds',
          'warning',
          'odds-cache-stale',
          `Odds snapshot last captured ${formatRelativeTimestamp(lastFetch, now)}.`,
          'data-maintenance'
        );
      }
    }
  } catch (error) {
    push(
      'odds',
      'warning',
      'odds-diagnostics-unavailable',
      `Odds diagnostics unavailable: ${errText(error)}`,
      null
    );
  }

  return {
    year,
    generatedAt: new Date(now).toISOString(),
    diagnostics,
    // Only `game-stats` has a lifecycle condition its data cannot precede; every
    // other dataset's absence stays actionable exactly as before (PLATFORM-090).
    expectations: PROVIDER_DATASETS.reduce((acc, dataset) => {
      acc[dataset] = dataset === 'game-stats' ? gameStatsExpectation : 'expected';
      return acc;
    }, {} as ProviderDataExpectations),
    scoreSeasonTypes: deriveApplicableScoreSeasonTypes(scheduleItems),
  };
}

function describeSlates(slates: CompletedSlate[]): string {
  const shown = slates.slice(0, MAX_LISTED_SLATES);
  const labels = shown.map((s) => `wk ${s.week}${s.seasonType === 'postseason' ? ' (post)' : ''}`);
  const suffix = slates.length > shown.length ? ` +${slates.length - shown.length} more` : '';
  const noun = slates.length === 1 ? 'slate' : 'slates';
  return `${labels.join(', ')}${suffix} ${noun}`;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
