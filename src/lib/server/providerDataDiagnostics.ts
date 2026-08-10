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
import type { CacheEntry as ScoresCacheEntry } from '@/lib/scores/cache';
import { getAppState, getAppStateEntries } from './appStateStore.ts';
import { GAME_STATS_SCOPE, getGameStatsKey } from '../gameStats/cache.ts';
import { loadCanonicalGameStatsSlate } from '../gameStats/canonicalSlate.ts';
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
import {
  classifyStatusLabel,
  isCanceledStatusLabel,
  isDisruptedStatusLabel,
} from '../gameStatus.ts';
import { formatRelativeTimestamp } from '../freshness.ts';
import type { ProviderDataset } from '../providerDatasets.ts';
import type { CfbdSeasonType } from '../cfbd.ts';

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
};

export type ProviderDataDiagnosticsResult = {
  year: number;
  generatedAt: string;
  diagnostics: ProviderDiagnostic[];
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
const STALE_ODDS_AFTER_MS = 2 * DAY_MS;
const MAX_LISTED_SLATES = 6;

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
function deriveCompletedSlates(items: ScheduleCacheEntry['items'], now: number): CompletedSlate[] {
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
    repair: ProviderDiagnosticRepairSurface | null
  ) => {
    diagnostics.push({ dataset, severity, code, message, repair });
  };

  // ---- Schedule (also the source of "completed slate" expectations) ----
  let scheduleItems: ScheduleCacheEntry['items'] = [];
  let seasonActive = false;
  try {
    const scheduleRec = await getAppState<ScheduleCacheEntry>('schedule', `${year}-all-all`);
    const entry = scheduleRec?.value;
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

  // ---- Scores: completed slates lacking any cached TERMINAL score ----
  try {
    if (completedSlates.length > 0) {
      const scoredSlates = new Set<SlateKey>();
      const scoreEntries = await getAppStateEntries<ScoresCacheEntry>('scores', `${year}-`);
      for (const entry of scoreEntries) {
        for (const pack of entry.value.items ?? []) {
          if (pack.week == null) continue;
          // A completed slate is only "covered" by a TERMINAL cached row (4th-review
          // finding #2). A mid-game refresh leaves numeric scores on an in-progress
          // row; counting that as covered would suppress the missing-final warning
          // forever if no later poll ever writes finals. Canonical status buckets
          // (never raw-string matching) decide terminality:
          //   - final  → covered (requires both numeric scores to be present)
          //   - canceled → terminal; will never have a final score, so it resolves
          //     the game without a numeric result (no impossible missing-final)
          //   - in-progress / scheduled / postponed / suspended / delayed / unknown
          //     → NOT terminal, does not satisfy coverage
          const hasBothScores = pack.home.score != null && pack.away.score != null;
          const isFinal = classifyStatusLabel(pack.status) === 'final' && hasBothScores;
          const isCanceled = isCanceledStatusLabel(pack.status);
          if (!isFinal && !isCanceled) continue;
          scoredSlates.add(slateKey(pack.week, normalizeSeasonType(pack.seasonType)));
        }
      }

      const missingScoreSlates = completedSlates.filter(
        (s) => !scoredSlates.has(slateKey(s.week, s.seasonType))
      );
      if (missingScoreSlates.length === completedSlates.length) {
        push(
          'scores',
          'error',
          'scores-terminal-coverage-missing',
          `No cached scores for any of ${completedSlates.length} completed slate(s).`,
          'data-maintenance'
        );
      } else if (missingScoreSlates.length > 0) {
        push(
          'scores',
          'warning',
          'scores-terminal-coverage-partial',
          `${describeSlates(missingScoreSlates)} complete but missing cached scores.`,
          'data-maintenance'
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
      const slateResult = await loadCanonicalGameStatsSlate({ year, now: new Date(now) });
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
