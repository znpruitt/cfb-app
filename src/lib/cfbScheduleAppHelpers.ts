import { deriveRegularWeekTabs } from './activeView.ts';
import type { BuiltSchedule } from './schedule.ts';
import {
  derivePostLoadDefaultWeekTabSelection,
  type PostLoadDefaultWeekTabSelectionDecision,
} from './weekSelection.ts';
import type { AppGame } from './schedule.ts';

export function dedupeIssues(items: string[]): string[] {
  return Array.from(new Set(items));
}

export function isScheduleIssue(issue: string): boolean {
  return (
    issue.startsWith('invalid-schedule-row:') ||
    issue.startsWith('identity-unresolved:') ||
    issue.startsWith('out-of-scope-postseason-row:') ||
    issue.startsWith('hydrate:') ||
    issue.startsWith('CFBD schedule load failed:')
  );
}

/**
 * Can retrying possibly help?
 *
 * `isScheduleIssue` mixes two very different causes. `invalid-schedule-row:`,
 * `identity-unresolved:` and `out-of-scope-postseason-row:` are defects in the
 * CACHED data — re-reading the same cache returns the same result forever, so a
 * retry is a dead loop. `CFBD schedule load failed:` and `hydrate:` are FETCH
 * failures: a transient upstream blip, where a plain retry succeeds.
 *
 * POLISH-005 first dropped the retry entirely on the reasoning that the fatal
 * state is always a cached-data defect. That was wrong — the list plainly
 * includes the fetch failure, and the slice's own test fixture was
 * `upstream CFBD returned 503`. A retry is offered only when EVERY fatal issue
 * is retryable; one unfixable row means the button could never work.
 *
 * The retry is cache-only. The old control forced `bypassCache: true`, which
 * `/api/schedule` refuses without admin — which is why it always failed for
 * members, not because retrying is inherently useless.
 */
export function isRetryableScheduleIssue(issue: string): boolean {
  return issue.startsWith('CFBD schedule load failed:') || issue.startsWith('hydrate:');
}

export function isTransientScheduleIssue(issue: string): boolean {
  return issue.startsWith('out-of-scope-postseason-row:');
}

/**
 * The generic, body-free issue surfaced when a cache-only Odds hydration fails
 * (PLATFORM-086C3). Co-located with `isLiveOddsIssue` — which matches it by exact
 * VALUE below, not a fragile prefix — so rewording this copy can never silently
 * declassify it (a score-only tick would otherwise wrongly wipe, or wrongly retain,
 * the "odds unavailable" warning). Never contains a response body, URL, or credential.
 */
export const ODDS_HYDRATION_ISSUE = 'Odds fetch failed: unable to load current odds.';

/**
 * Odds-specific live issues (a failed or errored odds fetch). Split out so a
 * score-only live poll can clear its own transient issues WITHOUT wiping an
 * unresolved odds-failure warning it is not retrying (PLATFORM-086B2B): a
 * `includeOdds: false` tick must not silently hide that displayed odds are stale.
 * The hydration issue is matched by exact value (not just the shared prefixes) so
 * classification cannot drift from its copy (PLATFORM-086C3).
 */
export function isLiveOddsIssue(issue: string): boolean {
  return (
    issue === ODDS_HYDRATION_ISSUE ||
    issue.startsWith('Odds error ') ||
    issue.startsWith('Odds fetch failed:')
  );
}

export function isLiveIssue(issue: string): boolean {
  return (
    issue.startsWith('No games loaded. CFBD schedule load may have failed.') ||
    isLiveOddsIssue(issue) ||
    issue.startsWith('Scores fetch failed:') ||
    issue.startsWith('Scores season ') ||
    issue.startsWith('Scores week ') ||
    issue.startsWith('missing-score-match:')
  );
}

export function summarizeGames(label: string, games: AppGame[]): void {
  const weeks = Array.from(
    new Set(games.map((g) => g.week).filter((w) => Number.isFinite(w)))
  ).sort((a, b) => a - b);
  const regular = games.filter((g) => g.stage === 'regular' && !g.isPlaceholder).length;
  const placeholder = games.filter((g) => g.isPlaceholder).length;
  const postseasonReal = games.filter((g) => g.stage !== 'regular' && !g.isPlaceholder).length;

  console.log(label, {
    count: games.length,
    weeks,
    regular,
    placeholder,
    postseasonReal,
    sample: games.slice(0, 10).map((g) => ({
      key: g.key,
      week: g.week,
      away: g.csvAway ?? g.canAway,
      home: g.csvHome ?? g.canHome,
      isPostseasonPlaceholder: !!g.isPlaceholder,
      postseason: g.stage !== 'regular',
    })),
  });
}

export type ScheduleLoadApplicationResult = {
  nextScheduleIssues: string[];
  hasGames: boolean;
  regularWeeks: number[];
  postLoadSelection: PostLoadDefaultWeekTabSelectionDecision;
};

export function deriveScheduleLoadApplicationResult(params: {
  built: BuiltSchedule;
  selectedWeek: number | null;
  selectedTab: number | 'postseason' | null;
  isDebug: boolean;
}): ScheduleLoadApplicationResult {
  const { built, selectedWeek, selectedTab, isDebug } = params;
  const nextScheduleIssues = built.issues.filter((issue) => !isTransientScheduleIssue(issue));

  if (isDebug && built.hydrationDiagnostics.length) {
    const actionableDiagnostics = built.hydrationDiagnostics.filter(
      (diagnostic) => diagnostic.action !== 'template-preserved'
    );
    if (actionableDiagnostics.length) {
      nextScheduleIssues.push(
        ...actionableDiagnostics
          .slice(0, 8)
          .map(
            (diagnostic) =>
              `hydrate:${diagnostic.action}:${diagnostic.eventId}:${diagnostic.reason}`
          )
      );
    }
  }

  const hasGames = built.games.length > 0;
  const regularWeeks = hasGames ? deriveRegularWeekTabs(built.games) : [];
  const postLoadSelection = derivePostLoadDefaultWeekTabSelection({
    games: built.games,
    regularWeeks,
    selectedWeek,
    selectedTab,
  });

  return {
    nextScheduleIssues,
    hasGames,
    regularWeeks,
    postLoadSelection,
  };
}
