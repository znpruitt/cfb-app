import type { LeagueStatus } from '@/lib/league';
import { describeLeagueLifecycle } from '@/lib/selectors/leagueLifecycle';

/**
 * PLATFORM-086F2H3B1 — the league page's lifecycle summary: two labelled facts,
 * never one merged "status".
 *
 * The page previously rendered a single label ("2026 Season") plus, in exactly
 * one branch, an ownership sentence. That left an operator unable to tell where
 * a league is from what will move it — and the one ownership sentence it did
 * render ("Season will go live automatically before the first game") had been
 * FALSE for the demo league since F2H1T2 removed it from the season-transition
 * cron.
 *
 * All derivation lives in `describeLeagueLifecycle`, which is pure and testable
 * without rendering. This component maps its output to markup and decides
 * nothing.
 */
export default function LeagueLifecycleSummary({
  storedStatus,
  fallbackYear,
  isDemo,
}: {
  /** The PERSISTED status — `null` for a legacy record with none. */
  storedStatus: LeagueStatus | null;
  /** `league.year`, used only to label a missing-status record. */
  fallbackYear: number;
  isDemo: boolean;
}) {
  const { stateLabel, nextStep, ownership } = describeLeagueLifecycle({
    storedStatus,
    fallbackYear,
    isDemo,
  });

  return (
    <dl className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-5 sm:grid-cols-[10rem_1fr] dark:border-zinc-700 dark:bg-zinc-900">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-zinc-400">
        Current state
      </dt>
      <dd className="text-sm font-medium text-gray-900 dark:text-zinc-100">{stateLabel}</dd>

      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-zinc-400">
        Next step
      </dt>
      <dd className="text-sm text-gray-700 dark:text-zinc-300">
        {nextStep}
        {/* Three ownership values, three treatments. A boolean here would badge
            an UNOWNED record "Manual", claiming an operator-owned path that does
            not exist — there is no supported operation that writes a lifecycle
            status onto a production record. `automatic` stays unbadged so the
            ordinary case is quiet. */}
        {ownership === 'operator' && (
          <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-zinc-700 dark:text-zinc-300">
            Manual
          </span>
        )}
        {ownership === 'unowned' && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Needs attention
          </span>
        )}
      </dd>
    </dl>
  );
}
