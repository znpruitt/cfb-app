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

/** Completed slates (latest kickoff > 6h ago), newest first. */
function deriveCompletedSlates(items: ScheduleCacheEntry['items'], now: number): CompletedSlate[] {
  const latestByKey = new Map<SlateKey, CompletedSlate>();
  for (const item of items) {
    if (!item.startDate) continue;
    const kickoff = new Date(item.startDate).getTime();
    if (!Number.isFinite(kickoff)) continue;
    if (kickoff > now - SLATE_COMPLETE_AFTER_MS) continue;
    const seasonType = normalizeSeasonType(item.seasonType);
    const key = slateKey(item.week, seasonType);
    const prev = latestByKey.get(key);
    if (!prev || kickoff > prev.latestKickoff) {
      latestByKey.set(key, { week: item.week, seasonType, latestKickoff: kickoff });
    }
  }
  return [...latestByKey.values()].sort((a, b) => b.latestKickoff - a.latestKickoff);
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
  now: number = Date.now()
): Promise<ProviderDataDiagnosticsResult> {
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
    const oddsUsage = await getLatestKnownOddsUsage();
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

  return { year, generatedAt: new Date(now).toISOString(), diagnostics };
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
