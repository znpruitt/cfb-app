import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import ArchiveListPanel from '@/components/admin/ArchiveListPanel';
import SeasonRolloverPanel from '@/components/admin/SeasonRolloverPanel';

export const dynamic = 'force-dynamic';

export default async function AdminSeasonPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Breadcrumbs
            segments={[
              { label: 'Home', href: '/' },
              { label: 'Admin', href: '/admin' },
              { label: 'Season Management' },
            ]}
          />
          <h1 className="text-2xl font-semibold">Season Management</h1>
        </div>

        {/* PLATFORM-086F2H3A — ONE rollover surface. The eligible-year execution
            panel (`RolloverPanel`) was deleted with manual rollover execution;
            its unique preview detail — the owners whose outcomes flip, by name,
            and the standings positions that move — was ported into this panel
            first, so consolidation preserved capability rather than discarding
            it. F2C had moved the per-year status panel here from Data
            Maintenance & Recovery; the two have now converged. */}
        <SeasonRolloverPanel />
        <ArchiveListPanel />
      </div>
    </main>
  );
}
