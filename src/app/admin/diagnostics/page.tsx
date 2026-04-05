import Link from 'next/link';

import AdminUsagePanel from '@/components/AdminUsagePanel';
import AdminTeamDatabasePanel from '@/components/AdminTeamDatabasePanel';
import AdminStorageStatusPanel from '@/components/AdminStorageStatusPanel';
import DiagnosticsScorePanel from '@/components/admin/DiagnosticsScorePanel';
import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminDiagnosticsPage() {
  const leagues = await getLeagues();
  const season = leagues[0]?.year ?? new Date().getUTCFullYear();

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Link href="/admin" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-100">Diagnostics</h1>
        </div>

        <div className="space-y-4 rounded-lg border border-zinc-700 bg-zinc-900 p-5">
          <AdminUsagePanel />
          <AdminTeamDatabasePanel />
          <AdminStorageStatusPanel />
          <DiagnosticsScorePanel season={season} />
        </div>
      </div>
    </main>
  );
}
