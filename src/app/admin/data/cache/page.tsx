import Link from 'next/link';

import GlobalRefreshPanel from '@/components/admin/GlobalRefreshPanel';
import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import WinTotalsUploadPanel from '@/components/WinTotalsUploadPanel';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminDataCachePage() {
  const leagues = await getLeagues();

  // If any league is in preseason, default the refresh panel to that year
  const preseasonLeague = leagues.find((l) => l.status?.state === 'preseason');
  const leagueAwareYear =
    preseasonLeague?.status?.state === 'preseason' ? preseasonLeague.status.year : undefined;

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Link href="/admin" className="text-sm text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-zinc-100">Data Cache</h1>
        </div>

        <GlobalRefreshPanel defaultYear={leagueAwareYear} />
        <SpRatingsCachePanel />
        <WinTotalsUploadPanel />
        <HistoricalCachePanel leagues={leagues} />
      </div>
    </main>
  );
}
