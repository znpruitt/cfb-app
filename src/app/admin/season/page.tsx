import Link from 'next/link';

import RolloverPanel from '@/components/RolloverPanel';
import BackfillPanel from '@/components/admin/BackfillPanel';
import ArchiveListPanel from '@/components/admin/ArchiveListPanel';
import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminSeasonPage() {
  const leagues = await getLeagues();

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-100">Season Management</h1>
          <Link href="/admin" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            ← Admin
          </Link>
        </div>

        <RolloverPanel />
        <BackfillPanel leagues={leagues} />
        <ArchiveListPanel />
      </div>
    </main>
  );
}
