'use client';

import Link from 'next/link';
import { Show, UserButton } from '@clerk/nextjs';
import type { League } from '@/lib/league';

type Props = {
  leagues: League[];
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
        <main className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100">
          <div className="max-w-lg space-y-5 text-center">
            <h1 className="text-4xl font-bold tracking-tight">CFB League Dashboard</h1>
            <p className="text-lg text-zinc-400">
              College football pool management for your league
            </p>
            <p className="text-sm text-zinc-500">Enter your league URL to get started</p>
            <code className="block rounded bg-zinc-900 border border-zinc-800 px-4 py-2 text-sm text-zinc-300 font-mono">
              cfb-app.vercel.app/league/your-league-slug
            </code>
          </div>

          {/* Discrete commissioner login — bottom right */}
          <div className="fixed bottom-6 right-6">
            <Link
              href="/login"
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Commissioner login
            </Link>
          </div>
        </main>
      </Show>

      {/* Admin dashboard — shown when signed in */}
      <Show when="signed-in">
        <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">CFB League Dashboard</h1>
                <p className="mt-1 text-sm text-zinc-400">Platform admin</p>
              </div>
              <UserButton />
            </div>

            {/* League cards */}
            {leagues.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
                <p className="text-zinc-400">No leagues configured.</p>
                <Link
                  href="/admin/leagues"
                  className="mt-3 inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
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
                      className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 space-y-3 hover:border-zinc-600 transition-colors"
                    >
                      <div>
                        <div className="text-lg font-semibold text-zinc-100">
                          {league.displayName}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          /{league.slug} &middot; {league.year} season
                          {label !== null && <> &middot; {label}</>}
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <Link
                          href={`/league/${league.slug}`}
                          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          View League →
                        </Link>
                        <Link
                          href={`/league/${league.slug}/draft/setup`}
                          className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Draft Setup →
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer links */}
            <div className="mt-8 border-t border-zinc-800 pt-6 flex items-center justify-between">
              <Link href="/admin" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
                Platform admin tools →
              </Link>
              <Link href="/admin/leagues" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
                Add League →
              </Link>
            </div>
          </div>
        </main>
      </Show>
    </>
  );
}
