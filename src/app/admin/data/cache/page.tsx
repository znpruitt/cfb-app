import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import GlobalRefreshPanel from '@/components/admin/GlobalRefreshPanel';
import GameStatsCachePanel from '@/components/admin/GameStatsCachePanel';
import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import WinTotalsUploadPanel from '@/components/WinTotalsUploadPanel';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import SeasonRolloverPanel from '@/components/admin/SeasonRolloverPanel';
import { getLeagues } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';

export const dynamic = 'force-dynamic';

export default async function AdminDataCachePage() {
  const leagues = await getLeagues();

  // If any league is in preseason, default the refresh panel to that year
  const preseasonLeague = leagues.find((l) => l.status?.state === 'preseason');
  const leagueAwareYear =
    preseasonLeague?.status?.state === 'preseason' ? preseasonLeague.status.year : undefined;

  // PLATFORM-086F2B (Codex review): the panel no longer takes a page-computed
  // "next rollover" date — that estimate came from the FIRST season league plus
  // the weaker latest-postseason fallback, so with multiple active years (or a
  // date the strict gate would refuse) it could mislabel the panel. The panel
  // renders the authoritative per-year dates from the rollover status API.

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Breadcrumbs
            segments={[
              { label: 'Home', href: '/' },
              { label: 'Admin', href: '/admin' },
              { label: 'Data Cache' },
            ]}
          />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-zinc-100">Data Cache</h1>
        </div>

        <SeasonRolloverPanel />
        <GlobalRefreshPanel defaultYear={leagueAwareYear} />
        <GameStatsCachePanel defaultYear={leagueAwareYear} />
        <SpRatingsCachePanel />
        <WinTotalsUploadPanel />
        <HistoricalCachePanel leagues={sanitizeLeagues(leagues)} />
      </div>
    </main>
  );
}
