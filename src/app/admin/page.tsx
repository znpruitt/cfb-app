import Link from 'next/link';

import { getLeagues } from '@/lib/leagueRegistry';

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

const commissionerTools = [
  { key: 'roster', title: 'Roster', desc: 'Manage team ownership for this season' },
  { key: 'draft', title: 'Draft', desc: 'Set up and run the season draft', external: true },
  { key: 'settings', title: 'Settings', desc: 'League name, season year, and founded year' },
] as const;

export default async function AdminPage() {
  const leagues = await getLeagues();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-10">
        <div className="space-y-1">
          <Link
            href="/"
            className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Home
          </Link>
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

          {leagues.map((league) => (
            <div key={league.slug} className="space-y-3">
              <Link href={`/admin/${league.slug}`} className="flex items-center gap-2 group">
                <span className="text-sm font-semibold text-blue-600 group-hover:underline dark:text-blue-400">
                  {league.displayName}
                </span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {league.slug}
                </span>
              </Link>
              <div className="grid gap-3 sm:grid-cols-2">
                {commissionerTools.map((tool) => {
                  const href =
                    tool.key === 'draft'
                      ? `/league/${league.slug}/draft/setup`
                      : `/admin/${league.slug}/${tool.key}`;
                  return (
                    <Link
                      key={tool.key}
                      href={href}
                      className="block rounded-lg border border-gray-200 bg-gray-50 p-4 transition-colors hover:border-gray-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                    >
                      <div className="font-medium">{tool.title}</div>
                      <div className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
                        {tool.desc}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
