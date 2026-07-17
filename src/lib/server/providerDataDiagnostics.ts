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
import { listCachedGameStats } from '../gameStats/cache.ts';
import {
  deriveExpectedGameStatsIds,
  expectsGameStats,
  usableGameStatsGameIds,
} from '../gameStats/coverage.ts';
import { deriveApplicableScoreSeasonTypes } from './scoreApplicability.ts';
import { classifyStatusLabel, isCanceledStatusLabel } from '../gameStatus.ts';
import { formatRelativeTimestamp } from '../freshness.ts';
import type { ProviderDataset } from '../providerDatasets.ts';
import type { CfbdSeasonType } from '../cfbd.ts';

/** Minimal shape of a durable `odds-cache` entry — only its capture time matters here. */
type OddsCacheFreshness = { lastFetch?: number | null };

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export type ProviderDiagnostic = {
  dataset: ProviderDataset;
  severity: DiagnosticSeverity;
  message: string;
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

export type CompletedSlate = { week: number; seasonType: CfbdSeasonType; latestKickoff: number };

/** Structural slice both `ScheduleItem` and `ScheduleWireItem` satisfy. */
type SlateSourceItem = {
  week: number;
  seasonType?: string | null;
  startDate?: string | null;
  status?: string | null;
};

/**
 * One private grouped-cutoff core behind BOTH exported slate helpers: group the
 * relevant games by (week, seasonType), track each slate's MAX kickoff, and
 * apply the completion threshold to that per-slate maximum AFTER grouping —
 * never per-game. This is the PLATFORM-086A remediation for split slates: a week
 * with an early Thursday game and later Saturday games is not "complete" until
 * the Saturday games are old — no false missing-data warnings mid-slate, and no
 * mid-slate provider fetches (a per-game cutoff would let the old Thursday final
 * make the whole week look finished). What counts as a RELEVANT game is the only
 * consumer-specific decision, supplied by the named exports below.
 */
function deriveCompletedSlatesWith(
  items: readonly SlateSourceItem[],
  now: number,
  isRelevantGame: (item: SlateSourceItem) => boolean
): CompletedSlate[] {
  const latestByKey = new Map<SlateKey, CompletedSlate>();
  for (const item of items) {
    if (!item.startDate) continue;
    if (!isRelevantGame(item)) continue;
    const kickoff = new Date(item.startDate).getTime();
    if (!Number.isFinite(kickoff)) continue;
    const seasonType = normalizeSeasonType(item.seasonType);
    const key = slateKey(item.week, seasonType);
    const prev = latestByKey.get(key);
    if (!prev || kickoff > prev.latestKickoff) {
      latestByKey.set(key, { week: item.week, seasonType, latestKickoff: kickoff });
    }
  }
  return [...latestByKey.values()]
    .filter((slate) => slate.latestKickoff <= now - SLATE_COMPLETE_AFTER_MS)
    .sort((a, b) => b.latestKickoff - a.latestKickoff);
}

/**
 * Completed slates for SCORE diagnostics (whole-slate latest kickoff > 6h ago),
 * newest first, over ALL games with parseable kickoffs — including disrupted
 * ones. Postponed/suspended/delayed games are unresolved but NOT terminal
 * (`gameStatus.ts`), so their slates must stay visible to the missing-final
 * checks (review remediation: filtering them here silently suppressed score
 * diagnostics); a canceled game still resolves score coverage terminally
 * downstream via `isCanceledStatusLabel`.
 */
export function deriveCompletedSlates(
  items: readonly SlateSourceItem[],
  now: number
): CompletedSlate[] {
  return deriveCompletedSlatesWith(items, now, () => true);
}

/**
 * Completed STAT-PRODUCING slates — the shared candidate definition for
 * game-stats recovery (the cron) AND the game-stats diagnostics section, so the
 * two cannot drift. Disrupted games (canceled/postponed/…, via the shared
 * `expectsGameStats`) are excluded from the grouping: they never produce team
 * stats, so a disrupted-only slate is never a candidate (5th-review finding #1)
 * and a disrupted game's stale or rescheduled kickoff never decides whether the
 * played games' stats may be ingested.
 */
export function deriveCompletedStatSlates(
  items: readonly SlateSourceItem[],
  now: number
): CompletedSlate[] {
  return deriveCompletedSlatesWith(items, now, (item) => expectsGameStats(item.status));
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
  const push = (dataset: ProviderDataset, severity: DiagnosticSeverity, message: string) => {
    diagnostics.push({ dataset, severity, message });
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
      push('schedule', 'error', `No current-season schedule cached for ${year}.`);
    } else {
      if (entry.partialFailure) {
        const missing = entry.failedSeasonTypes?.length
          ? ` (missing: ${entry.failedSeasonTypes.join(', ')})`
          : '';
        push(
          'schedule',
          'warning',
          `Last schedule refresh was partial${missing}; some partitions are uncertain.`
        );
      }
      const ageMs = now - entry.at;
      if (seasonActive && ageMs > STALE_SCHEDULE_AFTER_MS) {
        push(
          'schedule',
          'warning',
          `Schedule last refreshed ${formatRelativeTimestamp(entry.at, now)} — older than the weekly policy.`
        );
      }
    }
  } catch (error) {
    push('schedule', 'warning', `Schedule diagnostics unavailable: ${errText(error)}`);
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
          `No cached scores for any of ${completedSlates.length} completed slate(s).`
        );
      } else if (missingScoreSlates.length > 0) {
        push(
          'scores',
          'warning',
          `${describeSlates(missingScoreSlates)} complete but missing cached scores.`
        );
      }
    }
  } catch (error) {
    push('scores', 'warning', `Score diagnostics unavailable: ${errText(error)}`);
  }

  // ---- Game stats: completed STAT slates missing usable game-stats CONTENT ----
  // Uses the stat-producing slate helper (shared with the cron) — NOT the score
  // diagnostics' generic completed set — so a disrupted game's kickoff never
  // delays or manufactures a game-stats expectation while score diagnostics
  // above still see every slate.
  try {
    const completedStatSlates = deriveCompletedStatSlates(scheduleItems, now);
    if (completedStatSlates.length > 0) {
      // Coverage is judged by CONTENT resolved through canonical game identity, not
      // key existence: a record with `games: []` — or one whose every row was
      // dropped during normalization — is NOT coverage (4th-review finding #3). A
      // bare key must never suppress the warning.
      const coveredIdsBySlate = new Map<SlateKey, Set<string>>();
      for (const record of await listCachedGameStats(year)) {
        coveredIdsBySlate.set(
          slateKey(record.week, normalizeSeasonType(record.seasonType)),
          usableGameStatsGameIds(record)
        );
      }
      // Expected (canonical) STAT-PRODUCING games per completed slate, from the
      // schedule, via the ONE shared derivation the game-stats cron uses
      // (PLATFORM-086H): disrupted games, positively placeholder-labeled
      // matchups, and static-policy FCS-vs-FCS pairings are excluded, so they
      // neither manufacture a partial gap nor, when a whole slate has no
      // expected games, a permanent missing warning (5th-review findings #1/#3).
      // The derivation is deterministic — pure schedule inputs plus the bundled
      // static conference policy; there is no identity-evidence load path.
      const expectedIdsBySlate = new Map<SlateKey, Set<string>>();
      for (const slate of completedStatSlates) {
        const { expectedIds } = deriveExpectedGameStatsIds(
          scheduleItems,
          slate.week,
          slate.seasonType
        );
        expectedIdsBySlate.set(slateKey(slate.week, slate.seasonType), expectedIds);
      }

      const missing: CompletedSlate[] = [];
      const partial: CompletedSlate[] = [];
      for (const slate of completedStatSlates) {
        const key = slateKey(slate.week, slate.seasonType);
        // Determine applicability BEFORE checking coverage: a slate with zero
        // expected stat-producing games (e.g. entirely disrupted) is not applicable,
        // so it must not be reported as missing (5th-review finding #3).
        const expected = expectedIdsBySlate.get(key);
        if (!expected || expected.size === 0) continue;
        const covered = coveredIdsBySlate.get(key);
        if (!covered || covered.size === 0) {
          missing.push(slate);
          continue;
        }
        if ([...expected].some((id) => !covered.has(id))) {
          partial.push(slate);
        }
      }

      if (missing.length > 0) {
        const latest = completedStatSlates[0];
        const latestMissing = missing.some(
          (s) => s.week === latest.week && s.seasonType === latest.seasonType
        );
        if (latestMissing) {
          push(
            'game-stats',
            'warning',
            `Latest completed slate (week ${latest.week} ${latest.seasonType}) has no cached game stats.`
          );
        }
        const older = missing.filter(
          (s) => !(s.week === latest.week && s.seasonType === latest.seasonType)
        );
        if (older.length > 0) {
          push(
            'game-stats',
            'info',
            `${describeSlates(older)} missing game stats (recoverable via backfill).`
          );
        }
      }
      if (partial.length > 0) {
        push(
          'game-stats',
          'info',
          `${describeSlates(partial)} partially cached game stats (some games still missing; recoverable via backfill).`
        );
      }
    }
  } catch (error) {
    push('game-stats', 'warning', `Game-stats diagnostics unavailable: ${errText(error)}`);
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
      push('rankings', 'info', `No rankings cached for ${year}.`);
    } else if (seasonActive) {
      const ageMs = now - rankingsRec!.value.at;
      if (ageMs > STALE_RANKINGS_AFTER_MS) {
        push(
          'rankings',
          'warning',
          `Rankings last refreshed ${formatRelativeTimestamp(rankingsRec!.value.at, now)} — older than the weekly policy.`
        );
      }
    }
  } catch (error) {
    push('rankings', 'warning', `Rankings diagnostics unavailable: ${errText(error)}`);
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
  try {
    const oddsRec = await getAppState<OddsCacheFreshness>('odds-cache', defaultOddsCacheKey(year));
    const latestFetch = oddsRec?.value?.lastFetch;
    if (typeof latestFetch !== 'number' || !Number.isFinite(latestFetch)) {
      push('odds', 'info', `No odds snapshot cached for ${year} yet.`);
    } else if (seasonActive) {
      const ageMs = now - latestFetch;
      if (Number.isFinite(ageMs) && ageMs > STALE_ODDS_AFTER_MS) {
        push(
          'odds',
          'warning',
          `Odds snapshot last captured ${formatRelativeTimestamp(latestFetch, now)}.`
        );
      }
    }
  } catch (error) {
    push('odds', 'warning', `Odds diagnostics unavailable: ${errText(error)}`);
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
