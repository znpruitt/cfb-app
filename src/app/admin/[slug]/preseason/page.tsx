import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getLeague } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { getPreseasonOwners } from '@/lib/preseasonOwnerStore';
import { draftScope, type DraftPhase } from '@/lib/draft';
import AssignmentMethodCard from '../components/AssignmentMethodCard';
import { completeSetup } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PreseasonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  // Gate: only accessible while league is in preseason
  if (!league.status || league.status.state !== 'preseason') {
    redirect(`/admin/${slug}`);
  }

  const year = league.status.year;

  // Fetch checklist data for the preseason year
  let hasRoster = false;
  let teamsAssigned = false;

  try {
    const [preseasonOwners, draftRecord] = await Promise.all([
      getPreseasonOwners(slug, year),
      getAppState<{ phase: DraftPhase }>(draftScope(slug), String(year)),
    ]);

    hasRoster = preseasonOwners !== null && preseasonOwners.length >= 2;

    const draftPhase = draftRecord?.value?.phase ?? null;
    if (league.assignmentMethod === 'draft') {
      teamsAssigned = draftPhase === 'complete';
    } else if (league.assignmentMethod === 'manual') {
      teamsAssigned = league.manualAssignmentComplete === true;
    } else {
      teamsAssigned = false;
    }
  } catch {
    // Storage unavailable — checklist shows incomplete
  }

  const canGoLive = hasRoster && teamsAssigned;

  // Teams assigned link target depends on chosen assignment method
  const teamsHref =
    league.assignmentMethod === 'draft'
      ? `/league/${slug}/draft/setup`
      : league.assignmentMethod === 'manual'
        ? `/admin/${slug}/preseason`
        : `/admin/${slug}/preseason`;

  const completeSetupAction = completeSetup.bind(null, slug, year);

  // Helper text for disabled Go Live button
  const blockers = [
    !hasRoster && 'owners',
    !teamsAssigned && 'team assignment',
  ].filter(Boolean);
  const blockerText =
    blockers.length === 2
      ? 'Complete owners and team assignment before going live.'
      : blockers.length === 1
        ? `Complete ${blockers[0]} before going live.`
        : '';

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <Link
          href={`/admin/${slug}`}
          className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← {league.displayName}
        </Link>
        <h1 className="text-2xl font-semibold">{year} Pre-Season Setup</h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Complete the steps below to get the {year} season ready.
        </p>
      </div>

      {/* Checklist */}
      <section className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
        <ol className="space-y-3 text-sm">
          {/* Owners confirmed */}
          <li className="flex items-center gap-2">
            <span
              className={
                hasRoster ? 'text-green-600 dark:text-green-400' : 'text-gray-300 dark:text-zinc-600'
              }
            >
              {hasRoster ? '✓' : '○'}
            </span>
            {hasRoster ? (
              <Link
                href={`/admin/${slug}/preseason/owners`}
                className="text-gray-700 hover:underline dark:text-zinc-300"
              >
                Owners confirmed
              </Link>
            ) : (
              <Link
                href={`/admin/${slug}/preseason/owners`}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Owners confirmed
              </Link>
            )}
          </li>

          {/* Teams assigned */}
          <li className="flex items-center gap-2">
            <span
              className={
                teamsAssigned
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-300 dark:text-zinc-600'
              }
            >
              {teamsAssigned ? '✓' : '○'}
            </span>
            {teamsAssigned ? (
              <span className="text-gray-700 dark:text-zinc-300">Teams assigned</span>
            ) : league.assignmentMethod ? (
              <Link
                href={teamsHref}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Teams assigned
              </Link>
            ) : (
              <span className="text-gray-400 dark:text-zinc-500">Teams assigned</span>
            )}
          </li>
        </ol>
      </section>

      {/* Assignment method — hidden once teams are assigned */}
      {!teamsAssigned && (
        <AssignmentMethodCard
          slug={slug}
          currentMethod={league.assignmentMethod ?? null}
        />
      )}

      {/* Manual assignment coming soon notice */}
      {!teamsAssigned && league.assignmentMethod === 'manual' && (
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Manual team assignment is coming soon. Once available, you&apos;ll be able to assign teams directly from this page.
        </p>
      )}

      {/* Go Live */}
      <div className="space-y-2">
        <form action={completeSetupAction}>
          <button
            type="submit"
            disabled={!canGoLive}
            className={
              canGoLive
                ? 'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700'
                : 'px-4 py-2 rounded border border-gray-200 bg-gray-100 text-sm text-gray-400 cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500'
            }
          >
            Complete Setup
          </button>
        </form>
        {!canGoLive && blockerText && (
          <p className="text-xs text-gray-400 dark:text-zinc-500">{blockerText}</p>
        )}
      </div>
    </main>
  );
}
