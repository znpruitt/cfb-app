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
  const currentRoster = new Map(currentRosterRows.map((r) => [r.team, r.owner]));

  const rankings = selectRecordRankings(archives, currentRoster);

  const allArchiveOwners = new Set<string>();
  for (const archive of archives) {
    for (const row of archive.finalStandings) {
      if (row.owner && row.owner !== NO_CLAIM_OWNER) allArchiveOwners.add(row.owner);
    }
  }

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
 * Computes per-record qualifier notes by comparing the set of owners present
 * in the archives against the set of owners surfaced by each ranking. The
 * difference is the set excluded by qualifier filters (e.g. <3 seasons for
 * career_win_pct, no titles for career_titles).
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

  // career_win_pct: excluded = appeared in archives but not in win_pct ranking
  const winPctOwners = ownersIn(rankings.career_win_pct);
  const winPctExcluded = [...allArchiveOwners].filter((o) => !winPctOwners.has(o)).sort();
  notes.career_win_pct =
    winPctExcluded.length > 0
      ? `Min. 3 seasons — ${winPctExcluded.join(', ')} excluded`
      : 'Min. 3 seasons';

  notes.career_avg_finish = 'Min. 3 seasons · lower is better';

  // career_titles: count of owners with archive presence but no titles
  const titlesOwners = ownersIn(rankings.career_titles);
  const zeroTitleCount = [...allArchiveOwners].filter((o) => !titlesOwners.has(o)).length;
  if (zeroTitleCount > 0) {
    notes.career_titles = `${zeroTitleCount} owner${zeroTitleCount === 1 ? '' : 's'} with 0 titles not shown`;
  }

  return notes;
}
