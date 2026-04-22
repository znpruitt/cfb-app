import Breadcrumbs from '@/components/navigation/Breadcrumbs';
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
        <BackfillPanel leagues={sanitizeLeagues(leagues)} />
        <ArchiveListPanel />
      </div>
    </main>
  );
}
