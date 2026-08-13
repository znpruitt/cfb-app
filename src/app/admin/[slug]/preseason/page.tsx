import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { getLeague } from '@/lib/leagueRegistry';
import { describeLeagueLifecycle } from '@/lib/selectors/leagueLifecycle';
import { TEST_LEAGUE_SLUG } from '@/lib/league';
import { getConfirmedRoster } from '@/lib/server/confirmedRosterStore';
import { getTeamAssignment } from '@/lib/server/teamAssignmentStore';
import { getAppState } from '@/lib/server/appStateStore';
import { draftScope, type DraftState } from '@/lib/draft';
import { draftPicksAreComplete } from '@/lib/selectors/draftPublication';
import type { TeamAssignmentBlocker } from '@/lib/selectors/teamAssignment';
import AssignmentMethodCard from '../components/AssignmentMethodCard';
import { completeSetup } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PreseasonPage({ params }: { params: Promise<{ slug: string }> }) {
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
  let assignmentBlocker: TeamAssignmentBlocker | null = null;
  let draftPicksComplete = false;
  let draftHasPicks = false;

  try {
    // PLATFORM-092 — one derivation answers "is there a confirmed roster",
    // shared with the draft-setup page and the create-draft gate. This counted
    // CSV LINES, so a header plus two malformed rows read as a roster and this
    // checklist could show ✓ while the draft gate refused.
    // PLATFORM-094 — team assignment is decided by ONE derivation, shared with
    // the Complete Setup action, so the page a commissioner reads and the action
    // that writes `setupComplete` cannot disagree. `draftPhase === 'complete'`
    // alone was not evidence: it fires on the final pick, while the roster is
    // written separately at confirmation.
    const [roster, assignment] = await Promise.all([
      getConfirmedRoster(slug, year),
      getTeamAssignment(slug, year, league),
    ]);

    hasRoster = roster.isConfirmed;
    teamsAssigned = assignment.isAssigned;
    assignmentBlocker = assignment.blocker;
    const draftRecord =
      (await getAppState<DraftState>(draftScope(slug), String(year)))?.value ?? null;
    draftPicksComplete = draftPicksAreComplete(draftRecord);
    draftHasPicks = Array.isArray(draftRecord?.picks) && draftRecord.picks.length > 0;
  } catch {
    // Storage unavailable — checklist shows incomplete
  }

  const canCompleteSetup = hasRoster && teamsAssigned;
  const isSetupComplete = league.status.setupComplete === true;

  // Teams assigned link target depends on the chosen assignment method — and,
  // for a draft, on how far along it is.
  //
  // PLATFORM-094: this always pointed at the draft SETUP page, which was
  // harmless while the step ticked at `phase === 'complete'` (the link never
  // rendered in that state). Now that the step requires publication, the normal
  // post-draft state — every pick made, nothing confirmed — renders this link,
  // and setup is a settings screen with no publish control. The commissioner was
  // sent to configure a draft that had already finished. The summary page is
  // where Confirm lives, so an existing draft points there and only a league
  // with no draft yet is sent to setup.
  // `draft-not-published` and `published-roster-missing` both mean the picks are
  // in and the remaining step is Confirm, which lives on the summary page.
  // Anything else — no draft yet, or one still running — belongs at setup.
  const needsPublishing =
    assignmentBlocker === 'draft-not-published' || assignmentBlocker === 'published-roster-missing';
  const teamsHref =
    league.assignmentMethod === 'draft'
      ? needsPublishing
        ? `/league/${slug}/draft/summary`
        : `/league/${slug}/draft/setup`
      : `/admin/${slug}/preseason`;

  // Who starts this league's season, decided by the one lifecycle-ownership
  // authority. `league.status` is passed through as stored — the selector owns
  // the missing-status case too.
  const seasonStartIsAutomatic =
    describeLeagueLifecycle({
      storedStatus: league.status ?? null,
      fallbackYear: league.year,
      isDemo: slug === TEST_LEAGUE_SLUG,
    }).ownership === 'automatic';

  const completeSetupAction = completeSetup.bind(null, slug, year);

  // Helper text for the disabled Complete Setup button.
  //
  // PLATFORM-095 — this named the CATEGORY that was unfinished and never the
  // step. "Complete team assignment before finishing setup." read identically
  // whether the draft had not started, had finished without being confirmed, or
  // had lost its roster — and in the finished-but-unconfirmed case it told the
  // commissioner to do the one thing they had just done. `assignmentBlocker`
  // already distinguishes all four, so say the true thing and name the action.
  const assignmentText =
    assignmentBlocker === 'draft-not-published'
      ? 'Your draft is complete. Confirm the results to assign teams.'
      : assignmentBlocker === 'draft-incomplete'
        ? 'Finish the draft to assign teams.'
        : assignmentBlocker === 'published-roster-missing'
          ? 'The published roster is missing. Confirm the draft again.'
          : assignmentBlocker === 'manual-assignment-incomplete'
            ? 'Assign every team to an owner to finish setup.'
            : 'Choose how teams are assigned.';

  const blockerText = !hasRoster
    ? teamsAssigned
      ? 'Confirm the owners before finishing setup.'
      : `Confirm the owners before finishing setup. ${assignmentText}`
    : teamsAssigned
      ? ''
      : assignmentText;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <Breadcrumbs
          segments={[
            { label: 'Home', href: '/' },
            { label: 'Admin', href: '/admin' },
            { label: league.displayName, href: `/admin/${slug}` },
            { label: 'Preseason' },
          ]}
        />
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
                hasRoster
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-300 dark:text-zinc-600'
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
              <Link href={teamsHref} className="text-blue-600 hover:underline dark:text-blue-400">
                Teams assigned
              </Link>
            ) : (
              <span className="text-gray-400 dark:text-zinc-500">Teams assigned</span>
            )}
          </li>

          {/* Setup complete — satisfied by Complete Setup action */}
          <li className="flex items-center gap-2">
            <span
              className={
                isSetupComplete
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-300 dark:text-zinc-600'
              }
            >
              {isSetupComplete ? '✓' : '○'}
            </span>
            <span
              className={
                isSetupComplete
                  ? 'text-gray-700 dark:text-zinc-300'
                  : 'text-gray-400 dark:text-zinc-500'
              }
            >
              Setup complete
            </span>
          </li>
        </ol>
      </section>

      {/* Assignment method — hidden once teams are assigned, AND once the draft
          has every pick in.

          PLATFORM-095: tightening `teamsAssigned` left this visible through the
          whole finished-but-unpublished window — the very screen the
          commissioner is on to go and publish. One click on "Assign Manually"
          reached `manual-assignment-incomplete`, a state with no writer
          anywhere in the app, blocking Complete Setup until they switched back.
          `setAssignmentMethod` refuses the same case server-side; hiding the
          control is presentation, and the action is the guard. */}
      {!teamsAssigned && !draftPicksComplete && (
        <AssignmentMethodCard
          slug={slug}
          currentMethod={league.assignmentMethod ?? null}
          draftHasPicks={draftHasPicks}
        />
      )}

      {/* Manual assignment coming soon notice */}
      {!teamsAssigned && league.assignmentMethod === 'manual' && (
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Manual team assignment is coming soon. Once available, you&apos;ll be able to assign teams
          directly from this page.
        </p>
      )}

      {/* Complete Setup */}
      <div className="space-y-2">
        {isSetupComplete ? (
          <div className="flex items-center gap-2">
            <span className="px-4 py-2 rounded border border-green-600 bg-green-50 text-sm font-medium text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-400">
              Setup Complete ✓
            </span>
            {/* PLATFORM-086F2H3B1 — the same sentence the league page carried,
                and false for the demo league on this surface too: F2H1T2
                removed it from the season-transition cron, so nothing automatic
                moves it. Closing the demo-copy deferral means closing it on
                EVERY surface that makes the claim.

                The decision comes from the SELECTOR, not from a second
                `slug === TEST_LEAGUE_SLUG` test inlined here. Two surfaces
                deciding the same policy independently is how they drift, and
                AGENTS.md invariant 9 forbids deriving league data outside
                `src/lib/selectors/`. */}
            <span className="text-xs text-gray-500 dark:text-zinc-400">
              {seasonStartIsAutomatic
                ? 'Season will go live automatically before the first game.'
                : 'This demo league is manually controlled — use the Test Controls to start the season.'}
            </span>
          </div>
        ) : (
          <>
            <form action={completeSetupAction}>
              <button
                type="submit"
                disabled={!canCompleteSetup}
                className={
                  canCompleteSetup
                    ? 'px-4 py-2 rounded border border-blue-600 bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700'
                    : 'px-4 py-2 rounded border border-gray-200 bg-gray-100 text-sm text-gray-400 cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500'
                }
              >
                Complete Setup
              </button>
            </form>
            {!canCompleteSetup && blockerText && (
              <p className="text-xs text-gray-400 dark:text-zinc-500">{blockerText}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
