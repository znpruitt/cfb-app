'use client';

import Link from 'next/link';
import { Show, UserButton } from '@clerk/nextjs';
import type { PublicLeague } from '@/lib/league';

type Props = {
  leagues: PublicLeague[];
  ownerCountBySlug: Record<string, number | null>;
};

function ownerLabel(count: number | null): string | null {
  if (count === null) return null;
  if (count === 0) return 'No owners';
  return `${count} owner${count === 1 ? '' : 's'}`;
}

export default function RootPageClient({ leagues, ownerCountBySlug }: Props) {
  return (
    <>
      {/* Public landing — shown when signed out */}
      <Show when="signed-out">
        <main className="relative flex min-h-screen flex-col items-center justify-center bg-white px-6 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
          <div className="max-w-lg space-y-5 text-center">
            <h1 className="text-4xl font-bold tracking-tight">Turf War</h1>
            <p className="text-lg text-gray-500 dark:text-zinc-400">
              College football pool management for your league
            </p>
            <p className="text-sm text-gray-400 dark:text-zinc-500">
              Enter your league URL to get started
            </p>
            <code className="block rounded border border-gray-300 bg-gray-100 px-4 py-2 font-mono text-sm text-gray-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              turfwar.games/league/your-league-slug
            </code>
          </div>

          {/* Discrete commissioner login — bottom right */}
          <div className="fixed bottom-6 right-6">
            <Link
              href="/login"
              className="text-xs text-gray-400 transition-colors hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              Commissioner login
            </Link>
          </div>
        </main>
      </Show>

      {/* Admin dashboard — shown when signed in */}
      <Show when="signed-in">
        <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Turf War</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Platform admin</p>
              </div>
              <UserButton />
            </div>

            {/* League cards */}
            {leagues.length === 0 ? (
              <div className="rounded-lg border border-gray-300 bg-gray-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-gray-500 dark:text-zinc-400">No leagues configured.</p>
                <Link
                  href="/admin/leagues"
                  className="mt-3 inline-block text-sm text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Go to League Management to set up your first league →
                </Link>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {leagues.map((league) => {
                  const label = ownerLabel(ownerCountBySlug[league.slug] ?? null);
                  return (
                    <div
                      key={league.slug}
                      className="space-y-3 rounded-lg border border-gray-300 bg-gray-50 p-5 transition-colors hover:border-gray-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                    >
                      <div>
                        <div className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                          {league.displayName}
                        </div>
                        <div className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
                          /{league.slug} &middot;{' '}
                          {league.status?.state === 'season'
                            ? `${league.status.year} season`
                            : league.status?.state === 'preseason'
                              ? `${league.status.year} pre-season`
                              : league.status?.state === 'offseason'
                                ? 'offseason'
                                : `${league.year} season`}
                          {label !== null && <> &middot; {label}</>}
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <Link
                          href={`/league/${league.slug}`}
                          className="text-sm text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          View League →
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer links */}
            <div className="mt-8 flex items-center justify-between border-t border-gray-200 pt-6 dark:border-zinc-800">
              <Link
                href="/admin"
                className="text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Platform admin tools →
              </Link>
              <Link
                href="/admin/leagues"
                className="text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Add League →
              </Link>
            </div>
          </div>
        </main>
      </Show>
    </>
  );
}
