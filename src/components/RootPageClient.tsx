'use client';

import Link from 'next/link';
import { Show, UserButton } from '@clerk/nextjs';
import type { League } from '@/lib/league';

type Props = {
  leagues: League[];
};

export default function RootPageClient({ leagues }: Props) {
  return (
    <>
      {/* Public landing — shown when signed out */}
      <Show when="signed-out">
        <main className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100">
          <div className="max-w-lg space-y-4 text-center">
            <h1 className="text-4xl font-bold tracking-tight">CFB League Dashboard</h1>
            <p className="text-lg text-zinc-400">
              College football pool management for your league
            </p>
            <p className="text-sm text-zinc-500">
              Enter your league URL to get started —{' '}
              <span className="font-mono text-zinc-400">
                cfb-app.vercel.app/league/your-league-slug
              </span>
            </p>
          </div>

          {/* Discrete admin login — bottom right */}
          <div className="fixed bottom-6 right-6">
            <Link
              href="/login"
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Admin login
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
                  href="/admin"
                  className="mt-3 inline-block text-sm text-blue-400 hover:text-blue-300"
                >
                  Go to Admin to set up your first league →
                </Link>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {leagues.map((league) => (
                  <Link
                    key={league.slug}
                    href={`/league/${league.slug}`}
                    className="block rounded-lg border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-600 transition-colors"
                  >
                    <div className="font-semibold text-zinc-100">{league.displayName}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      /{league.slug} &middot; {league.year} season
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Admin tools link */}
            <div className="mt-8 border-t border-zinc-800 pt-6">
              <Link href="/admin" className="text-sm text-zinc-400 hover:text-zinc-200">
                Platform admin tools →
              </Link>
            </div>
          </div>
        </main>
      </Show>
    </>
  );
}
