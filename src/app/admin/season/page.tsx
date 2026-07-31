import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import RolloverPanel from '@/components/RolloverPanel';
import BackfillPanel from '@/components/admin/BackfillPanel';
import ArchiveListPanel from '@/components/admin/ArchiveListPanel';
import SeasonRolloverPanel from '@/components/admin/SeasonRolloverPanel';
import { getLeagues } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';

export const dynamic = 'force-dynamic';

export default async function AdminSeasonPage() {
  const leagues = await getLeagues();

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

        <RolloverPanel />
        {/* PLATFORM-086F2C — the per-year rollover status/maintenance panel
            moved here from Data Maintenance & Recovery: Season Management owns
            lifecycle rollover, and this panel is the only surface showing
            ineligible/unavailable years with reasons and due dates. The
            RolloverPanel above renders only when a year is eligible; final
            consolidation of the two panels remains F2H. */}
        <SeasonRolloverPanel />
        <BackfillPanel leagues={sanitizeLeagues(leagues)} />
        <ArchiveListPanel />
      </div>
    </main>
  );
}
