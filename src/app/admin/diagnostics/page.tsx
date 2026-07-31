import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import AdminUsagePanel from '@/components/AdminUsagePanel';
import AdminStorageStatusPanel from '@/components/AdminStorageStatusPanel';
import ProviderDataStatusPanel from '@/components/admin/ProviderDataStatusPanel';
import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminDiagnosticsPage() {
  const leagues = await getLeagues();
  const season = leagues[0]?.year ?? new Date().getUTCFullYear();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Breadcrumbs
            segments={[
              { label: 'Home', href: '/' },
              { label: 'Admin', href: '/admin' },
              { label: 'Diagnostics' },
            ]}
          />
          <h1 className="text-2xl font-semibold">Diagnostics</h1>
        </div>

        <ProviderDataStatusPanel defaultYear={season} />

        {/* PLATFORM-086F2D1/D2 — every provider-data repair mutation moved to
            Data Maintenance & Recovery. Diagnostics keeps operational
            observation (status, quota, storage) plus the automation safety
            controls inside the provider panel. */}
        <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <AdminUsagePanel />
          <AdminStorageStatusPanel />
        </div>
      </div>
    </main>
  );
}
