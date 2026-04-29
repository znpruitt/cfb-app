import type { SeasonArchive } from '../seasonArchive';
import type { LeagueRecords, RecordEntry } from './leagueRecords';
import {
  selectFinalStandings,
  type AllTimeStandingRow,
  type ChampionshipEntry,
  type DynastyDroughtRow,
  type MostImprovedEntry,
} from './historySelectors';

// ---------------------------------------------------------------------------
// Championships grouping
// ---------------------------------------------------------------------------

export type ChampionshipOwnerRow = {
  owner: string;
  titleCount: number;
  years: number[];
  isReigning: boolean;
};

export function groupChampionsByOwner(history: ChampionshipEntry[]): ChampionshipOwnerRow[] {
  if (history.length === 0) return [];

  const reigningYear = Math.max(...history.map((entry) => entry.year));
  const map = new Map<string, { years: number[] }>();
  for (const entry of history) {
    if (entry.champion === 'Unknown') continue;
    const bucket = map.get(entry.champion) ?? { years: [] };
    bucket.years.push(entry.year);
    map.set(entry.champion, bucket);
  }

  return Array.from(map.entries())
    .map(([owner, { years }]) => {
      const sortedYears = [...years].sort((a, b) => a - b);
      return {
        owner,
        titleCount: sortedYears.length,
        years: sortedYears,
        isReigning: sortedYears.includes(reigningYear),
      };
    })
    .sort((a, b) => {
      if (b.titleCount !== a.titleCount) return b.titleCount - a.titleCount;
      const aMostRecent = a.years[a.years.length - 1] ?? 0;
      const bMostRecent = b.years[b.years.length - 1] ?? 0;
      if (bMostRecent !== aMostRecent) return bMostRecent - aMostRecent;
      return a.owner.localeCompare(b.owner);
    });
}

export type ChampionshipSummaryStats = {
  championCount: number;
  seasonCount: number;
  stillChasingCount: number;
};

export function computeChampionshipSummary(
  championOwnerRows: ChampionshipOwnerRow[],
  history: ChampionshipEntry[],
  allTimeStandings: AllTimeStandingRow[],
  activeOwners: Set<string>
): ChampionshipSummaryStats {
  return {
    championCount: championOwnerRows.length,
    seasonCount: history.length,
    stillChasingCount: allTimeStandings.filter(
      (row) => row.championships === 0 && activeOwners.has(row.owner)
    ).length,
  };
}

// ---------------------------------------------------------------------------
// Recent podiums (last 3 seasons, top 3 each)
// ---------------------------------------------------------------------------

export type PodiumSlot = {
  place: 1 | 2 | 3;
  owner: string;
  /** Wins for 1st place. */
  wins: number;
  /** Games-back from leader, only meaningful for 2nd/3rd. */
  gamesBack: number;
};

export type PodiumBlock = {
  year: number;
  slots: PodiumSlot[];
};

const NO_CLAIM_OWNER = 'NoClaim';

export function selectRecentPodiums(
  archives: SeasonArchive[],
  seasonsToShow: number = 3
): PodiumBlock[] {
  const sorted = [...archives].sort((a, b) => b.year - a.year);
  const recent = sorted.slice(0, seasonsToShow);

  return recent.map((archive) => {
    const eligible = selectFinalStandings(archive).filter((row) => row.owner !== NO_CLAIM_OWNER);
    const slots: PodiumSlot[] = eligible.slice(0, 3).map((row, idx) => ({
      place: (idx + 1) as 1 | 2 | 3,
      owner: row.owner,
      wins: row.wins,
      gamesBack: row.gamesBack,
    }));
    return { year: archive.year, slots };
  });
}

// ---------------------------------------------------------------------------
// Marquee records (5 surfaced for the dashboard column)
// ---------------------------------------------------------------------------

const RECORD_CATEGORIES: ReadonlyArray<keyof LeagueRecords> = [
  'career',
  'season',
  'rivalry',
  'event',
];

/**
 * Picks 5 records to surface on the Overview Records column. Selection rule:
 * one record from each of the four categories (career / season / rivalry /
 * event), then one extra picked by category-priority order from whichever
 * category has additional entries.
 *
 * `selectAllRecords()` already orders entries within each category by
 * narrative priority, so we take the first record of each category as the
 * representative.
 */
export function selectMarqueeRecords(records: LeagueRecords): RecordEntry[] {
  const picked: RecordEntry[] = [];
  const taken = new Set<string>();

  for (const category of RECORD_CATEGORIES) {
    const first = records[category][0];
    if (first) {
      picked.push(first);
      taken.add(first.id);
    }
  }

  if (picked.length < 5) {
    for (const category of RECORD_CATEGORIES) {
      for (const entry of records[category]) {
        if (!taken.has(entry.id)) {
          picked.push(entry);
          taken.add(entry.id);
          break;
        }
      }
      if (picked.length >= 5) break;
    }
  }

  return picked.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Movers (climbs + drops)
// ---------------------------------------------------------------------------

export type MoversBuckets = {
  climbs: MostImprovedEntry[];
  drops: MostImprovedEntry[];
};

export function selectMovers(
  mostImproved: MostImprovedEntry[],
  limitEach: number = 4
): MoversBuckets {
  const climbs = mostImproved
    .filter((entry) => entry.improvement > 0)
    .sort((a, b) => {
      if (b.improvement !== a.improvement) return b.improvement - a.improvement;
      if (b.toYear !== a.toYear) return b.toYear - a.toYear;
      return a.owner.localeCompare(b.owner);
    })
    .slice(0, limitEach);

  const drops = mostImproved
    .filter((entry) => entry.improvement < 0)
    .sort((a, b) => {
      if (a.improvement !== b.improvement) return a.improvement - b.improvement;
      if (b.toYear !== a.toYear) return b.toYear - a.toYear;
      return a.owner.localeCompare(b.owner);
    })
    .slice(0, limitEach);

  return { climbs, drops };
}

// ---------------------------------------------------------------------------
// Title streaks (real streaks: ≥ 2 consecutive championship years)
// ---------------------------------------------------------------------------

export type TitleStreakRow = {
  owner: string;
  streak: number;
  years: number[];
};

const REAL_STREAK_MIN = 2;

export function selectTitleStreaks(rows: DynastyDroughtRow[]): TitleStreakRow[] {
  return rows
    .filter((row) => row.longestWinStreak >= REAL_STREAK_MIN)
    .map((row) => ({
      owner: row.owner,
      streak: row.longestWinStreak,
      years: row.longestWinStreakYears,
    }))
    .sort((a, b) => {
      if (b.streak !== a.streak) return b.streak - a.streak;
      const aMostRecent = a.years[a.years.length - 1] ?? 0;
      const bMostRecent = b.years[b.years.length - 1] ?? 0;
      if (bMostRecent !== aMostRecent) return bMostRecent - aMostRecent;
      return a.owner.localeCompare(b.owner);
    });
}

// ---------------------------------------------------------------------------
// Title droughts (fallback when no real streak exists)
// ---------------------------------------------------------------------------

export type TitleDroughtRow = {
  owner: string;
  /** Seasons since last title; for never-champions, equals seasonsPlayed. */
  drought: number;
  /** Most recent year the owner won; null when never a champion. */
  lastTitleYear: number | null;
};

export function selectTitleDroughts(args: {
  history: ChampionshipEntry[];
  allTimeStandings: AllTimeStandingRow[];
  activeOwners: Set<string>;
}): TitleDroughtRow[] {
  const { history, allTimeStandings, activeOwners } = args;
  const sortedYears = [...new Set(history.map((entry) => entry.year))].sort((a, b) => a - b);

  const lastTitleByOwner = new Map<string, number>();
  for (const entry of history) {
    if (entry.champion === 'Unknown') continue;
    const prev = lastTitleByOwner.get(entry.champion);
    if (prev === undefined || entry.year > prev) {
      lastTitleByOwner.set(entry.champion, entry.year);
    }
  }

  return allTimeStandings
    .filter((row) => activeOwners.has(row.owner))
    .map((row) => {
      const lastTitle = lastTitleByOwner.get(row.owner);
      if (lastTitle === undefined) {
        return { owner: row.owner, drought: row.seasonsPlayed, lastTitleYear: null };
      }
      const drought = sortedYears.filter((year) => year > lastTitle).length;
      return { owner: row.owner, drought, lastTitleYear: lastTitle };
    });
}

// ---------------------------------------------------------------------------
// Streaks-or-droughts conditional surface
// ---------------------------------------------------------------------------

export type StreaksOrDroughts =
  | { mode: 'streaks'; rows: TitleStreakRow[] }
  | { mode: 'droughts'; rows: TitleDroughtRow[] };

export function selectStreaksOrDroughts(args: {
  dynastyDroughtRows: DynastyDroughtRow[];
  history: ChampionshipEntry[];
  allTimeStandings: AllTimeStandingRow[];
  activeOwners: Set<string>;
  limit?: number;
}): StreaksOrDroughts {
  const { dynastyDroughtRows, history, allTimeStandings, activeOwners, limit = 4 } = args;

  const streaks = selectTitleStreaks(dynastyDroughtRows).slice(0, limit);
  if (streaks.length > 0) {
    return { mode: 'streaks', rows: streaks };
  }

  const droughts = selectTitleDroughts({ history, allTimeStandings, activeOwners })
    .sort((a, b) => {
      if (b.drought !== a.drought) return b.drought - a.drought;
      return a.owner.localeCompare(b.owner);
    })
    .slice(0, limit);

  return { mode: 'droughts', rows: droughts };
}

// ---------------------------------------------------------------------------
// Season archive (year + champion strip, most recent first)
// ---------------------------------------------------------------------------

export type SeasonArchiveItem = {
  year: number;
  champion: string;
};

export function selectSeasonArchiveStrip(history: ChampionshipEntry[]): SeasonArchiveItem[] {
  return [...history]
    .sort((a, b) => b.year - a.year)
    .map((entry) => ({ year: entry.year, champion: entry.champion }));
}
