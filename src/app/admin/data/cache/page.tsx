import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import GlobalRefreshPanel from '@/components/admin/GlobalRefreshPanel';
import GameStatsCachePanel from '@/components/admin/GameStatsCachePanel';
import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import WinTotalsUploadPanel from '@/components/WinTotalsUploadPanel';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import SeasonRolloverPanel from '@/components/admin/SeasonRolloverPanel';
import { getLeagues } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';
import { findNationalChampionshipGameDate } from '@/lib/seasonRollover';

export const dynamic = 'force-dynamic';

const TEST_LEAGUE_SLUG = 'test';
const ROLLOVER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export default async function AdminDataCachePage() {
  const leagues = await getLeagues();

  // If any league is in preseason, default the refresh panel to that year
  const preseasonLeague = leagues.find((l) => l.status?.state === 'preseason');
  const leagueAwareYear =
    preseasonLeague?.status?.state === 'preseason' ? preseasonLeague.status.year : undefined;

  // Estimate the next automatic rollover date: championship + 7 days for the season year
  const seasonLeague = leagues.find(
    (l) => l.slug !== TEST_LEAGUE_SLUG && l.status?.state === 'season'
  );
  const seasonYear = seasonLeague?.status?.state === 'season' ? seasonLeague.status.year : null;
  const championshipDate = seasonYear ? await findNationalChampionshipGameDate(seasonYear) : null;
  const nextRolloverDate = championshipDate
    ? new Date(new Date(championshipDate).getTime() + ROLLOVER_DELAY_MS).toISOString()
    : null;

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

        <SeasonRolloverPanel nextRolloverDate={nextRolloverDate} />
        <GlobalRefreshPanel defaultYear={leagueAwareYear} />
        <GameStatsCachePanel defaultYear={leagueAwareYear} />
        <SpRatingsCachePanel />
        <WinTotalsUploadPanel />
        <HistoricalCachePanel leagues={sanitizeLeagues(leagues)} />
      </div>
    </main>
  );
}
