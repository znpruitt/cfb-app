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
};

export function computeChampionshipSummary(
  championOwnerRows: ChampionshipOwnerRow[],
  history: ChampionshipEntry[]
): ChampionshipSummaryStats {
  return {
    championCount: championOwnerRows.length,
    seasonCount: history.length,
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

// ---------------------------------------------------------------------------
// Championships line-2 enrichment (career context + editorial tag)
// ---------------------------------------------------------------------------

export type ChampionshipEditorialTag = 'all-time wins leader' | "league's first champion" | null;

export type ChampionshipRowWithContext = ChampionshipOwnerRow & {
  seasonsPlayed: number;
  careerWinPct: number;
  editorialTag: ChampionshipEditorialTag;
};

/**
 * Enriches championship rows with line-2 context per the History Overview's
 * multi-line row pattern. Editorial tag rules:
 *   - "all-time wins leader": the champion holding the highest totalWins
 *     value across ALL owners (active or former). If the wins leader is
 *     not a champion, no champion gets this tag.
 *   - "league's first champion": the champion of the earliest archived year.
 *   - When both apply, "all-time wins leader" wins (the more current claim).
 */
export function selectChampionshipsWithContext(args: {
  championOwnerRows: ChampionshipOwnerRow[];
  allTimeStandings: AllTimeStandingRow[];
  championshipHistory: ChampionshipEntry[];
}): ChampionshipRowWithContext[] {
  const standingsByOwner = new Map(args.allTimeStandings.map((row) => [row.owner, row]));

  const winsLeaderOwner = args.allTimeStandings.reduce<string | null>((best, row) => {
    if (best === null) return row.owner;
    const bestWins = standingsByOwner.get(best)?.totalWins ?? -1;
    return row.totalWins > bestWins ? row.owner : best;
  }, null);

  const firstChampion = (() => {
    if (args.championshipHistory.length === 0) return null;
    const earliest = args.championshipHistory.reduce(
      (acc, entry) => (entry.year < acc.year ? entry : acc),
      args.championshipHistory[0]!
    );
    return earliest.champion === 'Unknown' ? null : earliest.champion;
  })();

  return args.championOwnerRows.map((row) => {
    const standing = standingsByOwner.get(row.owner);
    let editorialTag: ChampionshipEditorialTag = null;
    if (winsLeaderOwner === row.owner) {
      editorialTag = 'all-time wins leader';
    } else if (firstChampion === row.owner) {
      editorialTag = "league's first champion";
    }
    return {
      ...row,
      seasonsPlayed: standing?.seasonsPlayed ?? 0,
      careerWinPct: standing?.winPct ?? 0,
      editorialTag,
    };
  });
}

// ---------------------------------------------------------------------------
// Title droughts line-2 enrichment (top-3 count + best rank/year)
// ---------------------------------------------------------------------------

export type TitleDroughtRowWithContext = TitleDroughtRow & {
  top3Count: number;
  /** Best (lowest) rank ever achieved; null when the owner never appears in any archive. */
  bestRank: number | null;
  /** Year that bestRank was achieved; null when bestRank is null. */
  bestRankYear: number | null;
};

export function selectDroughtsWithContext(args: {
  droughts: TitleDroughtRow[];
  archives: SeasonArchive[];
}): TitleDroughtRowWithContext[] {
  type Stats = { top3Count: number; bestRank: number; bestRankYear: number };
  const stats = new Map<string, Stats>();

  for (const archive of args.archives) {
    const standings = selectFinalStandings(archive);
    for (const row of standings) {
      if (row.owner === NO_CLAIM_OWNER) continue;
      const cur = stats.get(row.owner) ?? {
        top3Count: 0,
        bestRank: Infinity,
        bestRankYear: 0,
      };
      if (row.rank <= 3) cur.top3Count += 1;
      if (row.rank < cur.bestRank) {
        cur.bestRank = row.rank;
        cur.bestRankYear = archive.year;
      }
      stats.set(row.owner, cur);
    }
  }

  return args.droughts.map((row) => {
    const s = stats.get(row.owner);
    if (!s || s.bestRank === Infinity) {
      return { ...row, top3Count: 0, bestRank: null, bestRankYear: null };
    }
    return {
      ...row,
      top3Count: s.top3Count,
      bestRank: s.bestRank,
      bestRankYear: s.bestRankYear,
    };
  });
}

// ---------------------------------------------------------------------------
// Movers line-2 enrichment (won-title flag)
// ---------------------------------------------------------------------------

export type MoverRowWithContext = MostImprovedEntry & {
  /** True when the destination season's rank-1 finish belongs to this owner. */
  wonTitle: boolean;
};

export type MoversBucketsWithContext = {
  climbs: MoverRowWithContext[];
  drops: MoverRowWithContext[];
};

export function selectMoversWithContext(args: {
  movers: MoversBuckets;
  championshipHistory: ChampionshipEntry[];
}): MoversBucketsWithContext {
  const championByYear = new Map(
    args.championshipHistory.map((entry) => [entry.year, entry.champion])
  );
  const decorate = (entry: MostImprovedEntry): MoverRowWithContext => ({
    ...entry,
    wonTitle: entry.toFinish === 1 && championByYear.get(entry.toYear) === entry.owner,
  });
  return {
    climbs: args.movers.climbs.map(decorate),
    drops: args.movers.drops.map(decorate),
  };
}

// ---------------------------------------------------------------------------
// Recent finish trend (per-owner ranks across the last N seasons)
// ---------------------------------------------------------------------------

export type RecentFinish = {
  year: number;
  /** Final-standings rank in this season; null when the owner did not play. */
  rank: number | null;
};

export type StandingRowWithRecentFinishes = AllTimeStandingRow & {
  /** Chronological order, oldest first. Length matches the recent-season window. */
  recentFinishes: RecentFinish[];
};

/**
 * Enriches each standings row with a chronological window of recent-season
 * finishes. Window is the most recent N archive years where N defaults to 5.
 * Owners who did not play a given year in the window get a `null` rank for
 * that year — the array is dense-with-nulls, never sparse.
 *
 * NoClaim is filtered before deriving rank (matches the convention from the
 * archiveChampion fix in commit 5fdcd59); a NoClaim row at index 0 of an
 * archive's finalStandings would otherwise shift every real owner's rank.
 */
export function selectStandingsWithRecentFinishes(args: {
  allTimeStandings: AllTimeStandingRow[];
  archives: SeasonArchive[];
  recentSeasonCount?: number;
}): StandingRowWithRecentFinishes[] {
  const { allTimeStandings, archives, recentSeasonCount = 5 } = args;
  const sorted = [...archives].sort((a, b) => a.year - b.year);
  const windowArchives = sorted.slice(-recentSeasonCount);

  const rankByOwnerByYear = windowArchives.map((archive) => {
    const eligible = archive.finalStandings.filter((row) => row.owner !== NO_CLAIM_OWNER);
    const ranks = new Map<string, number>();
    eligible.forEach((row, idx) => ranks.set(row.owner, idx + 1));
    return { year: archive.year, ranks };
  });

  return allTimeStandings.map((row) => ({
    ...row,
    recentFinishes: rankByOwnerByYear.map(({ year, ranks }) => ({
      year,
      rank: ranks.get(row.owner) ?? null,
    })),
  }));
}
