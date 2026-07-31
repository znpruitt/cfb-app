import Link from 'next/link';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import GlobalRefreshPanel from '@/components/admin/GlobalRefreshPanel';
import GameStatsCachePanel from '@/components/admin/GameStatsCachePanel';
import ProviderMaintenancePanel from '@/components/admin/ProviderMaintenancePanel';
import ReferenceDataPanel from '@/components/admin/ReferenceDataPanel';
import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import WinTotalsUploadPanel from '@/components/WinTotalsUploadPanel';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import { MAINTENANCE_COST_CAVEAT } from '@/lib/admin/maintenanceActions';
import { getLeagues } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';

export const dynamic = 'force-dynamic';

const sectionHeadingClass = 'text-lg font-semibold text-gray-900 dark:text-zinc-100';

/**
 * PLATFORM-086F2C — Data Maintenance & Recovery (the stable /admin/data/cache
 * route). Explicit maintenance, imports, repair, and recovery only; automatic
 * jobs own normal provider freshness. Lifecycle rollover lives on Season
 * Management (`/admin/season`), not here.
 */
export default async function AdminDataCachePage() {
  const leagues = await getLeagues();

  // If any league is in preseason, default the refresh panels to that year
  const preseasonLeague = leagues.find((l) => l.status?.state === 'preseason');
  const leagueAwareYear =
    preseasonLeague?.status?.state === 'preseason' ? preseasonLeague.status.year : undefined;

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="space-y-2">
          <Breadcrumbs
            segments={[
              { label: 'Home', href: '/' },
              { label: 'Admin', href: '/admin' },
              { label: 'Data Maintenance & Recovery' },
            ]}
          />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-zinc-100">
            Data Maintenance &amp; Recovery
          </h1>
          <p className="max-w-2xl text-sm text-gray-600 dark:text-zinc-300">
            Automatic jobs own normal provider freshness — this page is for explicit maintenance,
            imports, repair, and recovery. Each action states its provider cost, target, and durable
            effects. {MAINTENANCE_COST_CAVEAT} Season lifecycle and rollover live in{' '}
            <Link href="/admin/season" className="text-blue-600 hover:underline dark:text-blue-400">
              Season Management
            </Link>
            .
          </p>
        </div>

        <section className="space-y-4">
          <h2 className={sectionHeadingClass}>Provider maintenance &amp; recovery</h2>
          <GlobalRefreshPanel defaultYear={leagueAwareYear} />
          <GameStatsCachePanel defaultYear={leagueAwareYear} />
          <ProviderMaintenancePanel defaultYear={leagueAwareYear} />
        </section>

        <section className="space-y-4">
          <h2 className={sectionHeadingClass}>Season inputs</h2>
          <SpRatingsCachePanel />
          <WinTotalsUploadPanel />
        </section>

        <section className="space-y-4">
          <h2 className={sectionHeadingClass}>Reference data</h2>
          <ReferenceDataPanel />
        </section>

        <section className="space-y-4">
          <h2 className={sectionHeadingClass}>Historical recovery</h2>
          <HistoricalCachePanel leagues={sanitizeLeagues(leagues)} />
        </section>
      </div>
    </main>
  );
}
