import Link from 'next/link';

import RolloverPanel from '@/components/RolloverPanel';
import BackfillPanel from '@/components/admin/BackfillPanel';
import ArchiveListPanel from '@/components/admin/ArchiveListPanel';
import { getLeagues } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';

export const dynamic = 'force-dynamic';

export default async function AdminSeasonPage() {
  const leagues = await getLeagues();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Link
            href="/admin"
            className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold">Season Management</h1>
        </div>

        <RolloverPanel />
        <BackfillPanel leagues={sanitizeLeagues(leagues)} />
        <ArchiveListPanel />
      </div>
    </main>
  );
}
