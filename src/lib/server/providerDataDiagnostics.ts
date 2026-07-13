/**
 * Cache-only provider-data diagnostics (PLATFORM-086A).
 *
 * Derives actionable "missing / stale data" warnings for the admin status panel
 * purely from canonical schedule + durable caches. It NEVER makes a provider
 * call — determining status must not itself spend quota. Each dataset's checks
 * are individually guarded so one failing read cannot sink the whole report.
 */

import type { CacheEntry as ScheduleCacheEntry } from '@/app/api/schedule/cache';
import type { CacheEntry as ScoresCacheEntry } from '@/lib/scores/cache';
import { getAppState, getAppStateEntries } from './appStateStore.ts';
import { listCachedGameStatsWeeks } from '../gameStats/cache.ts';
import { getLatestKnownOddsUsage } from './oddsUsageStore.ts';
import type { OddsUsageSnapshot } from '../api/oddsUsage.ts';
import { formatRelativeTimestamp } from '../freshness.ts';
import type { ProviderDataset } from '../providerDatasets.ts';
import type { CfbdSeasonType } from '../cfbd.ts';

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
 * Score season-types worth requesting for a manual refresh, derived cache-only
 * from the schedule (rereview finding #1). Regular is the baseline (also the safe
 * default when nothing is cached, so a manual refresh still does something);
 * postseason is added ONLY once the schedule carries postseason games — before
 * then a postseason score request is a doomed no-op that should be skipped.
 */
function deriveApplicableScoreSeasonTypes(items: ScheduleCacheEntry['items']): CfbdSeasonType[] {
  let hasRegular = false;
  let hasPostseason = false;
  for (const item of items) {
    if (normalizeSeasonType(item.seasonType) === 'postseason') hasPostseason = true;
    else hasRegular = true;
    if (hasRegular && hasPostseason) break;
  }
  const types: CfbdSeasonType[] = [];
  if (hasRegular || !hasPostseason) types.push('regular');
  if (hasPostseason) types.push('postseason');
  return types;
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
    /**
     * Pre-read durable odds usage snapshot, shared with the caller so the odds
     * diagnostic does not re-read (and does not fall back to the stale
     * process-local memo — rereview finding #4). Pass `null` to mean "durable
     * read failed / no snapshot". Omit entirely to let this function read it.
     */
    oddsUsage?: OddsUsageSnapshot | null;
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

  // ---- Scores: completed slates lacking any cached final score ----
  try {
    if (completedSlates.length > 0) {
      const scoredSlates = new Set<SlateKey>();
      const scoreEntries = await getAppStateEntries<ScoresCacheEntry>('scores', `${year}-`);
      for (const entry of scoreEntries) {
        for (const pack of entry.value.items ?? []) {
          if (pack.week == null) continue;
          if (pack.home.score == null || pack.away.score == null) continue;
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

  // ---- Game stats: completed slates with no cached game-stats record ----
  try {
    if (completedSlates.length > 0) {
      const cachedWeekKeys = new Set(await listCachedGameStatsWeeks(year));
      const missing: CompletedSlate[] = [];
      for (const slate of completedSlates) {
        const key = `${year}:${slate.week}:${slate.seasonType}`;
        if (!cachedWeekKeys.has(key)) missing.push(slate);
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
    }
  } catch (error) {
    push('game-stats', 'warning', `Game-stats diagnostics unavailable: ${errText(error)}`);
  }

  // ---- Rankings: presence + staleness during an active season ----
  try {
    const rankingsRec = await getAppState<{ at: number }>('rankings', String(year));
    if (!rankingsRec?.value) {
      push('rankings', 'info', `No rankings cached for ${year}.`);
    } else if (seasonActive) {
      const ageMs = now - rankingsRec.value.at;
      if (ageMs > STALE_RANKINGS_AFTER_MS) {
        push(
          'rankings',
          'warning',
          `Rankings last refreshed ${formatRelativeTimestamp(rankingsRec.value.at, now)} — older than the weekly policy.`
        );
      }
    }
  } catch (error) {
    push('rankings', 'warning', `Rankings diagnostics unavailable: ${errText(error)}`);
  }

  // ---- Odds: snapshot recency only. A game without odds is NOT a failure. ----
  try {
    // Prefer the caller's shared durable read (finding #4); only read here when it
    // was not provided (standalone callers). `null` explicitly means "no snapshot".
    const oddsUsage =
      options.oddsUsage !== undefined ? options.oddsUsage : await getLatestKnownOddsUsage();
    if (!oddsUsage) {
      push('odds', 'info', 'No odds snapshot captured yet.');
    } else if (seasonActive) {
      const ageMs = now - new Date(oddsUsage.capturedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > STALE_ODDS_AFTER_MS) {
        push(
          'odds',
          'warning',
          `Odds snapshot last captured ${formatRelativeTimestamp(oddsUsage.capturedAt, now)}.`
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
