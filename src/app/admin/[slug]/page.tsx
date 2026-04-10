import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import { draftScope, type DraftPhase } from '@/lib/draft';
import type { LeagueStatus } from '@/lib/league';
import { getAppState } from '@/lib/server/appStateStore';
import LeagueStatusPanel from '@/components/admin/LeagueStatusPanel';
import TestLeagueControls from './components/TestLeagueControls';

export const dynamic = 'force-dynamic';

const tools = [
  {
    key: 'roster',
    title: 'Roster',
    desc: 'Manage team ownership for this season',
  },
  {
    key: 'draft',
    title: 'Draft',
    desc: 'Set up and run the season draft',
    external: true,
  },
  {
    key: 'settings',
    title: 'Settings',
    desc: 'League name, season year, and founded year',
  },
] as const;

type SetupStep = {
  label: string;
  done: boolean;
  href: string | null;
};

export default async function AdminLeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  const leagueStatus: LeagueStatus = league.status ?? { state: 'season', year: league.year };

  // Seed status if absent — fire-and-forget; display uses in-memory value, write does not block render
  if (!league.status) {
    updateLeagueStatus(slug, leagueStatus).catch(() => {
      // Non-fatal
    });
  }

  const year = league.year;

  // Fetch status data for the checklist (same data LeagueStatusPanel uses)
  let hasRoster = false;
  let hasSchedule = false;
  let hasScores = false;
  let draftPhase: DraftPhase | null = null;

  try {
    const [rosterRecord, scheduleRecord, scoresRecord, draftRecord] = await Promise.all([
      getAppState<string>(`owners:${slug}:${year}`, 'csv'),
      getAppState<unknown>('schedule', `${year}-all-all`).then(
        (r) => r ?? getAppState<unknown>('schedule', `${year}-all-regular`)
      ),
      getAppState<unknown>('scores', `${year}-all-regular`),
      getAppState<{ phase: DraftPhase }>(draftScope(slug), String(year)),
    ]);

    const csvText = typeof rosterRecord?.value === 'string' ? rosterRecord.value : '';
    hasRoster = csvText.trim().split('\n').filter((l, i) => i > 0 && l.trim().length > 0).length > 0;
    hasSchedule = Boolean(scheduleRecord);
    hasScores = Boolean(scoresRecord);
    draftPhase = draftRecord?.value?.phase ?? null;
  } catch {
    // Storage unavailable — checklist will show all incomplete
  }

  const steps: SetupStep[] = [
    { label: 'League created', done: true, href: null },
    {
      label: 'Owners configured',
      done: hasRoster,
      href: hasRoster ? null : `/admin/${slug}/roster`,
    },
    {
      label: 'Teams assigned',
      done: draftPhase === 'complete' && hasRoster,
      href: draftPhase === 'complete' && hasRoster ? null : `/league/${slug}/draft/setup`,
    },
    {
      label: 'Season live',
      done: hasSchedule && hasScores,
      href: hasSchedule && hasScores ? null : '/admin/data/cache',
    },
  ];

  const statusLabel =
    leagueStatus.state === 'season'
      ? `${leagueStatus.year} Season`
      : leagueStatus.state === 'offseason'
        ? 'Offseason'
        : `${leagueStatus.year} Pre-Season`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <div className="space-y-1">
        <Link
          href={`/league/${slug}`}
          className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to league
        </Link>
        <h1 className="text-2xl font-semibold">
          {league.displayName} — Commissioner Tools
        </h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">{statusLabel}</p>
      </div>

      {/* Status action panel — offseason and preseason only */}
      {leagueStatus.state === 'offseason' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-base font-medium">Ready for next season?</h2>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            The season has been archived. Start pre-season setup to configure the next season.
          </p>
          <button
            disabled
            className="px-4 py-2 rounded border border-gray-200 bg-gray-100 text-sm text-gray-400 cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500"
          >
            Coming in next update
          </button>
        </div>
      )}
      {leagueStatus.state === 'preseason' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-base font-medium">{leagueStatus.year} Pre-Season Setup</h2>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Complete the steps below to get the season ready.
          </p>
        </div>
      )}

      {/* Status panel */}
      <LeagueStatusPanel slug={slug} year={year} />

      {/* Setup checklist */}
      <section className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-base font-medium">Setup Progress</h2>
        <ol className="space-y-2 text-sm">
          {steps.map((step, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={step.done ? 'text-green-600 dark:text-green-400' : 'text-gray-300 dark:text-zinc-600'}>
                {step.done ? '✓' : '○'}
              </span>
              {step.done || !step.href ? (
                <span className={step.done ? 'text-gray-700 dark:text-zinc-300' : 'text-gray-400 dark:text-zinc-500'}>
                  {step.label}
                </span>
              ) : (
                <Link href={step.href} className="text-blue-600 hover:underline dark:text-blue-400">
                  {step.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Tool cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => {
          const href =
            tool.key === 'draft'
              ? `/league/${league.slug}/draft/setup`
              : `/admin/${slug}/${tool.key}`;
          return (
            <Link
              key={tool.key}
              href={href}
              className="block rounded-lg border border-gray-200 bg-gray-50 p-5 transition-colors hover:border-gray-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <div className="font-medium">{tool.title}</div>
              <div className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{tool.desc}</div>
            </Link>
          );
        })}
      </div>
      {/* Test league lifecycle controls — hardcoded to slug='test', never shown for production leagues */}
      {slug === 'test' && <TestLeagueControls />}
    </main>
  );
}
