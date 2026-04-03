import Link from 'next/link';

import CFBScheduleApp from '@/components/CFBScheduleApp';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminDataPage() {
  const leagues = await getLeagues();

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-lg font-bold text-zinc-100">Data Management</h1>
        <Link href="/admin" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
          ← Admin
        </Link>
      </div>
      <div className="px-6 py-6 space-y-4 max-w-3xl mx-auto">
        <HistoricalCachePanel leagues={leagues} />
      </div>
      <CFBScheduleApp surface="admin" />
    </div>
  );
}
