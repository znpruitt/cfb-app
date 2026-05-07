import { notFound } from 'next/navigation';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { getAppState } from '@/lib/server/appStateStore';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { NO_CLAIM_OWNER } from '@/lib/standings';
import {
  selectRecordRankings,
  type RecordId,
  type RankedRecord,
} from '@/lib/selectors/leagueRecords';
import { HistorySubNav } from '@/components/history/HistorySubNav';
import LeaguePageShell from '@/components/LeaguePageShell';
import { RecordSection } from '@/components/history/stats/RecordSection';
import type { SeasonArchive } from '@/lib/seasonArchive';
import { renderLeagueGateIfBlocked } from '../../leagueGate';

export const dynamic = 'force-dynamic';

const LOCKED_ACTIVE_ONLY_IDS: ReadonlySet<RecordId> = new Set<RecordId>(['career_drought']);

const CATEGORY_NOTES: Record<'career' | 'season' | 'event', string | undefined> = {
  career: undefined,
  season: 'Best or worst single season per owner',
  event: 'Ranked by event, not by owner',
};

export default async function HistoryStatsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;

  const [isAdmin, league] = await Promise.all([isPlatformAdminSession(), getLeague(slug)]);
  if (!league) notFound();

  const years = await listSeasonArchives(slug);

  if (years.length === 0) {
    return (
      <main>
        <LeaguePageShell
          leagueSlug={slug}
          leagueDisplayName={league.displayName}
          leagueYear={league.year}
          foundedYear={league.foundedYear}
          isAdmin={isAdmin}
          activeTab="history"
        >
          <div className="mx-auto max-w-5xl">
            <HistorySubNav slug={slug} />
            <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
              <p className="text-lg font-semibold text-gray-800 dark:text-zinc-100">
                No records yet — play a season to start filling the leaderboards.
              </p>
            </div>
          </div>
        </LeaguePageShell>
      </main>
    );
  }

  const archiveResults = await Promise.all(years.map((year) => getSeasonArchive(slug, year)));
  const archives: SeasonArchive[] = archiveResults.filter((a): a is SeasonArchive => a !== null);

  const ownersRecord = await getAppState<string>(`owners:${slug}:${league.year}`, 'csv');
  const ownersCsv = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';
  const currentRosterRows = parseOwnersCsv(ownersCsv);
  const csvRoster = new Map(currentRosterRows.map((r) => [r.team, r.owner]));

  const allArchiveOwners = new Set<string>();
  for (const archive of archives) {
    for (const row of archive.finalStandings) {
      if (row.owner && row.owner !== NO_CLAIM_OWNER) allArchiveOwners.add(row.owner);
    }
  }

  // Roster fallback when the season's owners CSV is missing/empty (post-reset,
  // storage miss, pre-rollover). Without it every owner reads as "former":
  // career_drought renders empty, all rows show the former badge, the
  // Active-only toggle clears every ranking. Mirrors the Overview page's
  // archive-union pattern. Synthetic keys are fine — the selector reads only
  // Map.values() (see activeOwnerSet in leagueRecords).
  const currentRoster: Map<string, string> =
    csvRoster.size > 0
      ? csvRoster
      : new Map([...allArchiveOwners].map((owner) => [`__archive:${owner}`, owner]));

  const rankings = selectRecordRankings(archives, currentRoster);

  const qualifierNotesById = buildQualifierNotes(rankings, allArchiveOwners);

  const ordered: RankedRecord[] = Object.values(rankings);
  const career = ordered.filter((r) => r.category === 'career');
  const season = ordered.filter((r) => r.category === 'season');
  const event = ordered.filter((r) => r.category === 'event');

  return (
    <main>
      <LeaguePageShell
        leagueSlug={slug}
        leagueDisplayName={league.displayName}
        leagueYear={league.year}
        foundedYear={league.foundedYear}
        isAdmin={isAdmin}
        activeTab="history"
      >
        <div className="mx-auto max-w-5xl">
          <HistorySubNav slug={slug} />
          <div className="mt-6 mb-8">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400">
              League records
            </p>
            <h1 className="mt-1 text-[22px] font-medium text-gray-900 dark:text-zinc-100">Stats</h1>
          </div>
          <div className="space-y-10">
            <RecordSection
              title="Career"
              records={career}
              categoryNote={CATEGORY_NOTES.career}
              qualifierNotesById={qualifierNotesById}
              lockedActiveOnlyIds={LOCKED_ACTIVE_ONLY_IDS}
            />
            <RecordSection
              title="Season"
              records={season}
              categoryNote={CATEGORY_NOTES.season}
              qualifierNotesById={qualifierNotesById}
            />
            <RecordSection
              title="Event"
              records={event}
              categoryNote={CATEGORY_NOTES.event}
              qualifierNotesById={qualifierNotesById}
            />
          </div>
        </div>
      </LeaguePageShell>
    </main>
  );
}

/**
 * Computes per-record qualifier notes by counting the set of owners present
 * in the archives against the set surfaced by each ranking. Count-based
 * notes ("N of M qualify") avoid wall-of-names exclusion lists when many
 * owners fail the filter.
 */
function buildQualifierNotes(
  rankings: Record<RecordId, RankedRecord>,
  allArchiveOwners: Set<string>
): Partial<Record<RecordId, string>> {
  const ownersIn = (record: RankedRecord): Set<string> => {
    const set = new Set<string>();
    for (const row of record.rows) for (const o of row.owners) set.add(o);
    return set;
  };

  const notes: Partial<Record<RecordId, string>> = {};
  const total = allArchiveOwners.size;

  // career_win_pct + career_avg_finish share the >=3-seasons gate. Count
  // owners surfaced by each ranking; the count is what passed the filter.
  const winPctCount = ownersIn(rankings.career_win_pct).size;
  notes.career_win_pct = `Min. 3 seasons · ${winPctCount} of ${total} qualify`;

  const avgFinishCount = ownersIn(rankings.career_avg_finish).size;
  notes.career_avg_finish = `Min. 3 seasons · lower is better · ${avgFinishCount} of ${total} qualify`;

  // career_titles: count of owners with archive presence but no titles
  const titlesOwners = ownersIn(rankings.career_titles);
  const zeroTitleCount = [...allArchiveOwners].filter((o) => !titlesOwners.has(o)).length;
  if (zeroTitleCount > 0) {
    notes.career_titles = `${zeroTitleCount} owner${zeroTitleCount === 1 ? '' : 's'} with 0 titles not shown`;
  }

  return notes;
}
