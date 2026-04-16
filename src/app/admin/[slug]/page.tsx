import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import type { LeagueStatus } from '@/lib/league';
import LeagueStatusPanel from '@/components/admin/LeagueStatusPanel';
import TestLeagueControls from './components/TestLeagueControls';
import { beginPreseason } from './actions';

export const dynamic = 'force-dynamic';

const tools = [
  {
    key: 'roster',
    title: 'Roster',
    desc: 'Manage team ownership for this season',
  },
  {
    key: 'settings',
    title: 'Settings',
    desc: 'League name, season year, and founded year',
  },
] as const;

export default async function AdminLeaguePage({ params }: { params: Promise<{ slug: string }> }) {
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

  // Derive lookup year from lifecycle state:
  // season/preseason → use status.year; offseason → fall back to league.year
  const year =
    leagueStatus.state === 'season' || leagueStatus.state === 'preseason'
      ? leagueStatus.year
      : league.year;

  const statusLabel =
    leagueStatus.state === 'season'
      ? `${leagueStatus.year} Season`
      : leagueStatus.state === 'offseason'
        ? 'Offseason'
        : `${leagueStatus.year} Pre-Season`;

  const beginPreseasonAction = beginPreseason.bind(null, slug);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <div className="space-y-1">
        <Link
          href={`/league/${slug}`}
          className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to league
        </Link>
        <h1 className="text-2xl font-semibold">{league.displayName} — Commissioner Tools</h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">{statusLabel}</p>
      </div>

      {/* Status action card — offseason and preseason only */}
      {leagueStatus.state === 'offseason' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-base font-medium">Ready for next season?</h2>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            The season has been archived. Start pre-season setup to configure the next season.
          </p>
          <form action={beginPreseasonAction}>
            <button
              type="submit"
              className="px-4 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
            >
              Begin Pre-Season Setup
            </button>
          </form>
        </div>
      )}
      {leagueStatus.state === 'preseason' && !leagueStatus.setupComplete && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-base font-medium">
            {leagueStatus.year} Pre-Season Setup in Progress
          </h2>
          <Link
            href={`/admin/${slug}/preseason`}
            className="inline-block px-4 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
          >
            Continue Setup
          </Link>
        </div>
      )}
      {leagueStatus.state === 'preseason' && leagueStatus.setupComplete === true && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-5 space-y-1 dark:border-green-900 dark:bg-green-950/30">
          <h2 className="text-base font-medium text-green-800 dark:text-green-300">
            {leagueStatus.year} Pre-Season Setup Complete ✓
          </h2>
          <p className="text-sm text-green-700 dark:text-green-400">
            Season will go live automatically before the first game.
          </p>
        </div>
      )}

      {/* Status panel */}
      <LeagueStatusPanel slug={slug} year={year} />

      {/* Tool cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => {
          const href = `/admin/${slug}/${tool.key}`;
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
