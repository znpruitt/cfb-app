import Link from 'next/link';

import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import WinTotalsUploadPanel from '@/components/WinTotalsUploadPanel';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminDataCachePage() {
  const leagues = await getLeagues();

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Link href="/admin" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-100">Data Cache</h1>
        </div>

        <SpRatingsCachePanel />
        <WinTotalsUploadPanel />
        <HistoricalCachePanel leagues={leagues} />
      </div>
    </main>
  );
}
