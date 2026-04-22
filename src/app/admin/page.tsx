import Link from 'next/link';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { getLeagues } from '@/lib/leagueRegistry';
import type { LeagueStatus } from '@/lib/league';

export const dynamic = 'force-dynamic';

const platformCards = [
  {
    href: '/admin/season',
    title: 'Season Management',
    desc: 'Rollover, backfill, archive tools',
  },
  {
    href: '/admin/diagnostics',
    title: 'Diagnostics',
    desc: 'API usage, storage, score attachment',
  },
  {
    href: '/admin/leagues',
    title: 'League Management',
    desc: 'Configure leagues and settings',
  },
  {
    href: '/admin/data/cache',
    title: 'Data Cache',
    desc: 'SP+ ratings, win totals, schedule, scores, historical data',
  },
  {
    href: '/admin/aliases',
    title: 'Aliases',
    desc: 'Manage team name corrections across all leagues',
  },
];

function lifecycleLabel(status: LeagueStatus | undefined): string {
  if (!status) return 'Season';
  if (status.state === 'season') return 'Season';
  if (status.state === 'preseason') return 'Pre-Season';
  return 'Offseason';
}

export default async function AdminPage() {
  const leagues = await getLeagues();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-10">
        <div className="space-y-1">
          <Breadcrumbs segments={[{ label: 'Home', href: '/' }, { label: 'Admin' }]} />
          <h1 className="text-2xl font-semibold">Platform Admin</h1>
        </div>

        {/* ---- Platform Admin ---- */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-500">
            Platform Admin
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {platformCards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="block rounded-lg border border-gray-200 bg-gray-50 p-5 transition-colors hover:border-gray-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="font-semibold">{card.title}</div>
                <div className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{card.desc}</div>
              </Link>
            ))}
          </div>
        </section>

        {/* ---- Commissioner Tools ---- */}
        <section className="space-y-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-500">
              Commissioner Tools
            </h2>
            <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">
              League-scoped tools — one section per league
            </p>
          </div>

          {leagues.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-zinc-500">
              No leagues configured.{' '}
              <Link
                href="/admin/leagues"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Add a league →
              </Link>
            </p>
          )}

          {leagues.length > 0 && (
            <ul className="divide-y divide-gray-200 dark:divide-zinc-800">
              {leagues.map((league) => (
                <li
                  key={league.slug}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/league/${league.slug}`}
                        className="text-sm font-semibold text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {league.displayName}
                      </Link>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {league.slug}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
                      {lifecycleLabel(league.status)}
                    </p>
                  </div>
                  <Link
                    href={`/admin/${league.slug}`}
                    className="shrink-0 text-sm text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Commissioner Tools →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
