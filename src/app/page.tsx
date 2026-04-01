import { redirect } from 'next/navigation';

import { getLeagues } from '../lib/leagueRegistry';

export default async function Page(): Promise<React.ReactElement> {
  const leagues = await getLeagues();

  if (leagues.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-8 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-2xl font-bold">No leagues configured</h1>
          <p className="text-sm text-gray-600 dark:text-zinc-400">
            Please contact your commissioner to set up the league.
          </p>
        </div>
      </main>
    );
  }

  redirect(`/league/${leagues[0].slug}`);
}
