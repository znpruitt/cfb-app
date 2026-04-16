import { getAppState, setAppState, listAppStateKeys } from './server/appStateStore.ts';
import type {
  StandingsHistory,
  StandingsHistoryStandingRow,
  OwnerStandingsSeriesPoint,
} from './standingsHistory.ts';
import type { AppGame } from './schedule.ts';
import type { ScorePack } from './scores.ts';

export type { AppGame } from './schedule.ts';

export type SeasonArchive = {
  leagueSlug: string;
  year: number;
  archivedAt: string;
  ownerRosterSnapshot: string;
  standingsHistory: StandingsHistory;
  finalStandings: StandingsHistoryStandingRow[];
  /** Full game list at archive time — both regular season and postseason. */
  games: AppGame[];
  /**
   * Scores keyed by game.key, as attached at archive time.
   * Used for superlative derivation and head-to-head matchup details.
   */
  scoresByKey: Record<string, ScorePack>;
};

export type SeasonArchiveDiff = {
  scoresChanged: number;
  outcomesFlipped: number;
  ownersAffectedByFlip: string[];
  standingsOrderChanged: boolean;
  standingsMovement: Array<{
    ownerName: string;
    previousPosition: number;
    newPosition: number;
  }>;
};

function archiveScope(leagueSlug: string): string {
  return `standings-archive:${leagueSlug}`;
}

export async function getSeasonArchive(
  leagueSlug: string,
  year: number
): Promise<SeasonArchive | null> {
  try {
    const record = await getAppState<SeasonArchive>(archiveScope(leagueSlug), String(year));
    return record?.value ?? null;
  } catch {
    return null;
  }
}

export async function listSeasonArchives(leagueSlug: string): Promise<number[]> {
  try {
    const keys = await listAppStateKeys(archiveScope(leagueSlug));
    return keys
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && n >= 2000)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function saveSeasonArchive(archive: SeasonArchive): Promise<void> {
  await setAppState<SeasonArchive>(archiveScope(archive.leagueSlug), String(archive.year), archive);
}

function weeklyStats(
  series: OwnerStandingsSeriesPoint[]
): Map<number, { pointsFor: number; won: boolean }> {
  const result = new Map<number, { pointsFor: number; won: boolean }>();
  for (let i = 0; i < series.length; i++) {
    const cur = series[i]!;
    const prev = i > 0 ? series[i - 1]! : null;
    const weekPointsFor = prev ? cur.pointsFor - prev.pointsFor : cur.pointsFor;
    const weekWins = prev ? cur.wins - prev.wins : cur.wins;
    result.set(cur.week, { pointsFor: weekPointsFor, won: weekWins > 0 });
  }
  return result;
}

export function diffSeasonArchives(
  existing: SeasonArchive,
  proposed: SeasonArchive
): SeasonArchiveDiff {
  let scoresChanged = 0;
  let outcomesFlipped = 0;
  const ownersAffectedByFlip = new Set<string>();

  const allOwners = new Set([
    ...Object.keys(existing.standingsHistory.byOwner),
    ...Object.keys(proposed.standingsHistory.byOwner),
  ]);

  for (const owner of allOwners) {
    const existingSeries = existing.standingsHistory.byOwner[owner] ?? [];
    const proposedSeries = proposed.standingsHistory.byOwner[owner] ?? [];
    const existingByWeek = weeklyStats(existingSeries);
    const proposedByWeek = weeklyStats(proposedSeries);

    const allWeeks = new Set([...existingByWeek.keys(), ...proposedByWeek.keys()]);
    for (const week of allWeeks) {
      const eWeek = existingByWeek.get(week);
      const pWeek = proposedByWeek.get(week);
      if (eWeek && pWeek) {
        if (Math.abs(eWeek.pointsFor - pWeek.pointsFor) > 0.001) {
          scoresChanged++;
        }
        if (eWeek.won !== pWeek.won) {
          outcomesFlipped++;
          ownersAffectedByFlip.add(owner);
        }
      }
    }
  }

  const existingPositions = new Map<string, number>();
  existing.finalStandings.forEach((r, i) => existingPositions.set(r.owner, i + 1));
  const proposedPositions = new Map<string, number>();
  proposed.finalStandings.forEach((r, i) => proposedPositions.set(r.owner, i + 1));

  const standingsOrderChanged =
    existing.finalStandings.map((r) => r.owner).join('|') !==
    proposed.finalStandings.map((r) => r.owner).join('|');

  const allFinalOwners = new Set([...existingPositions.keys(), ...proposedPositions.keys()]);
  const standingsMovement: SeasonArchiveDiff['standingsMovement'] = [];
  for (const owner of allFinalOwners) {
    const prev = existingPositions.get(owner);
    const next = proposedPositions.get(owner);
    if (prev !== undefined && next !== undefined && prev !== next) {
      standingsMovement.push({ ownerName: owner, previousPosition: prev, newPosition: next });
    }
  }
  standingsMovement.sort((a, b) => a.previousPosition - b.previousPosition);

  return {
    scoresChanged,
    outcomesFlipped,
    ownersAffectedByFlip: Array.from(ownersAffectedByFlip).sort(),
    standingsOrderChanged,
    standingsMovement,
  };
}
