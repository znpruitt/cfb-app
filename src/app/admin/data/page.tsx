import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminDataPage() {
  const leagues = await getLeagues();

  if (leagues.length === 1) {
    redirect(`/admin/${leagues[0]!.slug}/data`);
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-100">Data Management</h1>
          <Link href="/admin" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            ← Admin
          </Link>
        </div>

        {leagues.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No leagues configured.{' '}
            <Link href="/admin/leagues" className="text-blue-400 hover:underline">
              Add a league →
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Select a league to manage its schedule, scores, and aliases.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {leagues.map((league) => (
                <Link
                  key={league.slug}
                  href={`/admin/${league.slug}/data`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-600 transition-colors"
                >
                  <div className="font-semibold text-zinc-100">{league.displayName}</div>
                  <div className="mt-1 font-mono text-xs text-zinc-500">{league.slug}</div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
