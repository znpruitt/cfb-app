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

export function isTransientScheduleIssue(issue: string): boolean {
  return issue.startsWith('out-of-scope-postseason-row:');
}

export function isLiveIssue(issue: string): boolean {
  return (
    issue.startsWith('No games loaded. CFBD schedule load may have failed.') ||
    issue.startsWith('Odds error ') ||
    issue.startsWith('Odds fetch failed:') ||
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
