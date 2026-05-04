/**
 * League Records Selector
 *
 * Computes the current record holder for every tracked record category.
 * Records are atemporal facts ("who currently holds X") — distinct from insights,
 * which are temporal events ("X just took the lead").
 *
 * Architecture:
 * - This selector is the single source of truth for record holders.
 * - The insights engine may reference records as input when generating
 *   "record changed" insights, rather than re-deriving record holders inline.
 * - Records derive from archived season data directly — NOT from OwnerCareerStats
 *   (which is scoped to active owners only, excluding former members).
 * - Former owners are eligible record holders for all categories except
 *   career_drought, which by definition tracks only currently active owners.
 *
 * Tie suppression:
 * - RECORDS_TIE_SUPPRESSION_THRESHOLD = 6 (higher than the insights engine's 4).
 * - When ties exceed this threshold the record is omitted from results entirely.
 * - The higher threshold reflects that records are static facts displayed in a
 *   dashboard, not narrative insights; a tie of 5 is still meaningful to show.
 */

import { parseOwnersCsv } from '../parseOwnersCsv';
import type { SeasonArchive } from '../seasonArchive';
import type { OwnerStandingsSeriesPoint } from '../standingsHistory';
import type { ScorePack } from '../scores';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RecordEntry = {
  id: string;
  category: 'career' | 'season' | 'rivalry' | 'event';
  label: string;
  /** Record holders, lex-sorted. May contain 2+ if tied. */
  holders: string[];
  /** Raw numeric value driving the record (wins, points, streak length, etc.). */
  value: number;
  /** Display-ready string including units and optional context (e.g. year). */
  formattedValue: string;
  /** Absolute gap between leader value and second-place value; null when no second. */
  gapToSecond: number | null;
  secondPlace: { owners: string[]; value: number } | null;
  /**
   * Per-row context that is NOT the holder name and NOT the value — e.g.,
   * "2024 season", "2025 · Week 8", "over Crittenden · 2024". Used by ranking
   * displays where year/week/opponent context belongs in a separate visual
   * slot from the numeric value. Single-holder records may omit this.
   */
  contextString?: string;
  // TODO(INSIGHTS-020-RECORD-CHANGE-v1): populated by future record-change insights pipeline; see docs/next-tasks.md
  /** Set when the record holder(s) or value changed since the prior request. */
  recentChange?: { previousHolders: string[]; previousValue: number };
};

export type LeagueRecords = {
  career: RecordEntry[];
  season: RecordEntry[];
  rivalry: RecordEntry[];
  event: RecordEntry[];
};

export type SelectAllRecordsInput = {
  archives: SeasonArchive[];
  /** historicalRosters[year] maps team names → owner names for that season. */
  historicalRosters: Record<number, Map<string, string>>;
  currentYear: number;
  /** Active owners from the current season's owners CSV. Used for drought only. */
  currentRoster: Map<string, string>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum tie count before a record is suppressed from results entirely.
 * Intentionally higher than the insights engine threshold (4) because records
 * are displayed as facts, not curated narratives.
 */
export const RECORDS_TIE_SUPPRESSION_THRESHOLD = 6;

const NO_CLAIM_OWNER = 'NoClaim';
const MIN_CAREER_SEASONS = 3;
const MIN_RIVALRY_MEETINGS = 2;

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Returns all items tied at the maximum value according to valueFn.
 * Returns [] when items is empty.
 */
export function tiedAtMax<T>(items: T[], valueFn: (item: T) => number): T[] {
  if (items.length === 0) return [];
  let max = -Infinity;
  for (const item of items) {
    const v = valueFn(item);
    if (v > max) max = v;
  }
  return items.filter((item) => valueFn(item) === max);
}

/**
 * Returns all items tied at the minimum value according to valueFn.
 * Returns [] when items is empty.
 */
export function tiedAtMin<T>(items: T[], valueFn: (item: T) => number): T[] {
  if (items.length === 0) return [];
  let min = Infinity;
  for (const item of items) {
    const v = valueFn(item);
    if (v < min) min = v;
  }
  return items.filter((item) => valueFn(item) === min);
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type OwnerAccum = {
  owner: string;
  totalPoints: number;
  totalWins: number;
  totalLosses: number;
  titles: number;
  titleYears: number[];
  seasonsPlayed: number;
  top3Count: number;
  finishHistory: { year: number; rank: number }[];
};

/** A value bucket used for grouping tied owners. */
type RankedBucket = { value: number; owners: string[] };

type H2HResult = { year: number; winner: string; loser: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatNum(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function isEligibleOwner(owner: string): boolean {
  return Boolean(owner) && owner !== NO_CLAIM_OWNER;
}

function activeOwnerSet(currentRoster: Map<string, string>): Set<string> {
  const set = new Set(currentRoster.values());
  set.delete(NO_CLAIM_OWNER);
  return set;
}

/**
 * Groups items by value and returns buckets sorted best-first.
 * For 'desc' records (higher = better): sorted high → low.
 * For 'asc' records (lower = better): sorted low → high.
 * Owners within each bucket are lex-sorted.
 */
function groupByValue<T>(
  items: T[],
  valueFn: (item: T) => number,
  ownerFn: (item: T) => string,
  order: 'desc' | 'asc'
): RankedBucket[] {
  const map = new Map<number, string[]>();
  for (const item of items) {
    const v = valueFn(item);
    const owner = ownerFn(item);
    const existing = map.get(v) ?? [];
    existing.push(owner);
    map.set(v, existing);
  }
  return Array.from(map.entries())
    .map(([value, owners]) => ({ value, owners: [...owners].sort() }))
    .sort((a, b) => (order === 'desc' ? b.value - a.value : a.value - b.value));
}

/**
 * Converts a sorted bucket list into a RecordEntry, applying tie suppression.
 * Returns null when: no buckets, top bucket has no positive-value holders, or
 * tie count exceeds RECORDS_TIE_SUPPRESSION_THRESHOLD.
 */
function makeRecord(
  id: string,
  category: RecordEntry['category'],
  label: string,
  sorted: RankedBucket[],
  formatValue: (v: number) => string
): RecordEntry | null {
  if (sorted.length === 0) return null;
  const top = sorted[0]!;
  if (top.owners.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;
  const second = sorted[1] ?? null;
  return {
    id,
    category,
    label,
    holders: top.owners,
    value: top.value,
    formattedValue: formatValue(top.value),
    gapToSecond: second !== null ? Math.abs(top.value - second.value) : null,
    secondPlace: second ? { owners: second.owners, value: second.value } : null,
  };
}

/**
 * Builds per-owner career accumulator from all archives.
 * Includes former owners — not filtered to active roster.
 */
function buildCareerAccumulator(sortedArchives: SeasonArchive[]): Map<string, OwnerAccum> {
  const accum = new Map<string, OwnerAccum>();

  for (const archive of sortedArchives) {
    const eligibleRows = archive.finalStandings.filter((row) => isEligibleOwner(row.owner));
    const champion = eligibleRows.length > 0 ? (eligibleRows[0]?.owner ?? null) : null;

    eligibleRows.forEach((row, idx) => {
      const rank = idx + 1;

      if (!accum.has(row.owner)) {
        accum.set(row.owner, {
          owner: row.owner,
          totalPoints: 0,
          totalWins: 0,
          totalLosses: 0,
          titles: 0,
          titleYears: [],
          seasonsPlayed: 0,
          top3Count: 0,
          finishHistory: [],
        });
      }

      const a = accum.get(row.owner)!;
      a.totalPoints += row.pointsFor ?? 0;
      a.totalWins += row.wins;
      a.totalLosses += row.losses;
      a.seasonsPlayed += 1;
      a.finishHistory.push({ year: archive.year, rank });
      if (rank <= 3) a.top3Count += 1;
      if (champion && row.owner === champion && rank === 1) {
        a.titles += 1;
        a.titleYears.push(archive.year);
      }
    });
  }

  return accum;
}

/**
 * Collects all-time head-to-head results per pairing, sorted chronologically.
 * Each element records year, winner, and loser for a single owned-vs-owned game.
 */
function collectAllTimeH2H(
  archives: SeasonArchive[],
  historicalRosters: Record<number, Map<string, string>>
): Map<string, H2HResult[]> {
  const pairs = new Map<string, H2HResult[]>();

  const sortedArchives = [...archives].sort((a, b) => a.year - b.year);

  for (const archive of sortedArchives) {
    const roster = historicalRosters[archive.year];
    if (!roster) continue;

    for (const game of archive.games) {
      if (game.isPlaceholder) continue;
      const homeOwner = roster.get(game.csvHome) ?? roster.get(game.canHome);
      const awayOwner = roster.get(game.csvAway) ?? roster.get(game.canAway);
      if (!homeOwner || !awayOwner) continue;
      if (!isEligibleOwner(homeOwner) || !isEligibleOwner(awayOwner)) continue;
      if (homeOwner === awayOwner) continue;

      const score: ScorePack | undefined = archive.scoresByKey[game.key];
      if (!score) continue;
      const homeScore = score.home.score;
      const awayScore = score.away.score;
      if (homeScore === null || awayScore === null) continue;
      if (!score.status.toLowerCase().includes('final')) continue;
      if (homeScore === awayScore) continue;

      const winner = homeScore > awayScore ? homeOwner : awayOwner;
      const loser = homeScore > awayScore ? awayOwner : homeOwner;
      const key = homeOwner < awayOwner ? `${homeOwner}|${awayOwner}` : `${awayOwner}|${homeOwner}`;

      const list = pairs.get(key) ?? [];
      list.push({ year: archive.year, winner, loser });
      pairs.set(key, list);
    }
  }

  return pairs;
}

/** Returns per-week points scored by each owner, derived from cumulative series. */
function weeklyPointsForOwner(series: OwnerStandingsSeriesPoint[]): Map<number, number> {
  const result = new Map<number, number>();
  for (let i = 0; i < series.length; i++) {
    const cur = series[i]!;
    const prev = i > 0 ? series[i - 1]! : null;
    const weekPts = prev ? cur.pointsFor - prev.pointsFor : cur.pointsFor;
    result.set(cur.week, weekPts);
  }
  return result;
}

/** Pairs of (homeOwner, awayOwner, margin) for all owned-vs-owned final games in an archive. */
type OwnedFinalMatchup = {
  winner: string;
  loser: string;
  margin: number;
  year: number;
};

function getOwnedFinalMatchups(archive: SeasonArchive): OwnedFinalMatchup[] {
  const ownerRows = parseOwnersCsv(archive.ownerRosterSnapshot);
  const rosterByTeam = new Map(ownerRows.map((r) => [r.team, r.owner]));
  const results: OwnedFinalMatchup[] = [];

  for (const game of archive.games) {
    if (game.isPlaceholder) continue;
    const homeOwner = rosterByTeam.get(game.csvHome);
    const awayOwner = rosterByTeam.get(game.csvAway);
    if (!homeOwner || !awayOwner) continue;
    if (!isEligibleOwner(homeOwner) || !isEligibleOwner(awayOwner)) continue;
    if (homeOwner === awayOwner) continue;

    const score: ScorePack | undefined = archive.scoresByKey[game.key];
    if (!score) continue;
    const homeScore = score.home.score;
    const awayScore = score.away.score;
    if (homeScore === null || awayScore === null) continue;
    if (!score.status.toLowerCase().includes('final')) continue;

    const margin = Math.abs(homeScore - awayScore);
    const winner = homeScore > awayScore ? homeOwner : awayOwner;
    const loser = homeScore > awayScore ? awayOwner : homeOwner;
    results.push({ winner, loser, margin, year: archive.year });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Career record selectors
// ---------------------------------------------------------------------------

function selectCareerPointsRecord(accum: Map<string, OwnerAccum>): RecordEntry | null {
  const items = Array.from(accum.values()).filter((a) => a.totalPoints > 0);
  const buckets = groupByValue(
    items,
    (a) => a.totalPoints,
    (a) => a.owner,
    'desc'
  );
  return makeRecord(
    'career_points',
    'career',
    'Career Points',
    buckets,
    (v) => `${formatNum(v)} pts`
  );
}

function selectCareerWinsRecord(accum: Map<string, OwnerAccum>): RecordEntry | null {
  const items = Array.from(accum.values()).filter((a) => a.totalWins > 0);
  const buckets = groupByValue(
    items,
    (a) => a.totalWins,
    (a) => a.owner,
    'desc'
  );
  return makeRecord('career_wins', 'career', 'Career Wins', buckets, (v) => `${v} wins`);
}

function selectCareerWinPctRecord(accum: Map<string, OwnerAccum>): RecordEntry | null {
  const items = Array.from(accum.values())
    .filter((a) => a.seasonsPlayed >= MIN_CAREER_SEASONS && a.totalWins + a.totalLosses > 0)
    .map((a) => ({
      owner: a.owner,
      winPct: a.totalWins / (a.totalWins + a.totalLosses),
    }));
  const buckets = groupByValue(
    items,
    (a) => a.winPct,
    (a) => a.owner,
    'desc'
  );
  if (buckets.length === 0) return null;
  // Build the record using rounded pct for stable equality
  const top = buckets[0]!;
  const second = buckets[1] ?? null;
  if (top.owners.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;
  return {
    id: 'career_win_pct',
    category: 'career',
    label: 'Career Win %',
    holders: top.owners,
    value: top.value,
    formattedValue: `${(top.value * 100).toFixed(1)}%`,
    gapToSecond: second !== null ? Math.abs(top.value - second.value) : null,
    secondPlace: second ? { owners: second.owners, value: second.value } : null,
  };
}

function selectCareerTitlesRecord(accum: Map<string, OwnerAccum>): RecordEntry | null {
  const items = Array.from(accum.values()).filter((a) => a.titles >= 1);
  if (items.length === 0) return null;
  const buckets = groupByValue(
    items,
    (a) => a.titles,
    (a) => a.owner,
    'desc'
  );
  const base = makeRecord(
    'career_titles',
    'career',
    'Most Titles',
    buckets,
    (v) => `${v} title${v !== 1 ? 's' : ''}`
  );
  if (!base) return null;
  // Single-holder case: list championship years. Tied holders have differing
  // year sets, so context is omitted to avoid mis-attributing one owner's
  // years to the others.
  if (base.holders.length === 1) {
    const holder = base.holders[0]!;
    const years = accum.get(holder)?.titleYears ?? [];
    if (years.length > 0) {
      base.contextString = [...years].sort((a, b) => a - b).join(', ');
    }
  }
  return base;
}

function selectCareerAvgFinishRecord(accum: Map<string, OwnerAccum>): RecordEntry | null {
  const items = Array.from(accum.values())
    .filter((a) => a.seasonsPlayed >= MIN_CAREER_SEASONS)
    .map((a) => ({
      owner: a.owner,
      avgFinish: a.finishHistory.reduce((s, f) => s + f.rank, 0) / a.finishHistory.length,
    }));
  // Lower avgFinish is better (rank 1 = best); sort asc
  const buckets = groupByValue(
    items,
    (a) => a.avgFinish,
    (a) => a.owner,
    'asc'
  );
  if (buckets.length === 0) return null;
  const top = buckets[0]!;
  const second = buckets[1] ?? null;
  if (top.owners.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;
  return {
    id: 'career_avg_finish',
    category: 'career',
    label: 'Best Avg Finish',
    holders: top.owners,
    value: top.value,
    formattedValue: `#${top.value.toFixed(1)} avg`,
    gapToSecond: second !== null ? Math.abs(top.value - second.value) : null,
    secondPlace: second ? { owners: second.owners, value: second.value } : null,
  };
}

function selectCareerConsistencyRecord(accum: Map<string, OwnerAccum>): RecordEntry | null {
  const items = Array.from(accum.values()).filter((a) => a.top3Count >= 1);
  const buckets = groupByValue(
    items,
    (a) => a.top3Count,
    (a) => a.owner,
    'desc'
  );
  return makeRecord(
    'career_consistency',
    'career',
    'Most Top-3 Finishes',
    buckets,
    (v) => `${v} top-3${v !== 1 ? 's' : ''}`
  );
}

function selectCareerDroughtRecord(
  sortedArchives: SeasonArchive[],
  accum: Map<string, OwnerAccum>,
  activeOwners: Set<string>
): RecordEntry | null {
  if (sortedArchives.length === 0) return null;
  const latestYear = sortedArchives[sortedArchives.length - 1]!.year;

  type DroughtEntry = { owner: string; drought: number };
  const entries: DroughtEntry[] = [];

  for (const owner of activeOwners) {
    const data = accum.get(owner);
    if (!data || data.seasonsPlayed === 0) continue;

    const lastTitleYear = data.titleYears.length > 0 ? Math.max(...data.titleYears) : null;

    const drought = lastTitleYear !== null ? latestYear - lastTitleYear : data.seasonsPlayed;

    if (drought <= 0) continue;
    entries.push({ owner, drought });
  }

  if (entries.length === 0) return null;
  const buckets = groupByValue(
    entries,
    (e) => e.drought,
    (e) => e.owner,
    'desc'
  );
  return makeRecord(
    'career_drought',
    'career',
    'Longest Title Drought',
    buckets,
    (v) => `${v} season${v !== 1 ? 's' : ''}`
  );
}

function selectCareerDynastyRecord(
  sortedArchives: SeasonArchive[],
  accum: Map<string, OwnerAccum>
): RecordEntry | null {
  const archiveYears = sortedArchives.map((a) => a.year);

  type DynastyEntry = { owner: string; streak: number };
  const entries: DynastyEntry[] = [];

  for (const [, data] of accum) {
    const titleYearSet = new Set(data.titleYears);
    const participatedYears = new Set(data.finishHistory.map((f) => f.year));

    let maxStreak = 0;
    let curStreak = 0;

    for (const year of archiveYears) {
      if (!participatedYears.has(year)) {
        curStreak = 0;
        continue;
      }
      if (titleYearSet.has(year)) {
        curStreak++;
        if (curStreak > maxStreak) maxStreak = curStreak;
      } else {
        curStreak = 0;
      }
    }

    if (maxStreak >= 2) entries.push({ owner: data.owner, streak: maxStreak });
  }

  if (entries.length === 0) return null;
  const buckets = groupByValue(
    entries,
    (e) => e.streak,
    (e) => e.owner,
    'desc'
  );
  return makeRecord(
    'career_dynasty',
    'career',
    'Championship Dynasty',
    buckets,
    (v) => `${v} in a row`
  );
}

// ---------------------------------------------------------------------------
// Season record selectors
// ---------------------------------------------------------------------------

function selectSingleSeasonPointsHighRecord(sortedArchives: SeasonArchive[]): RecordEntry | null {
  type Entry = { owner: string; value: number; year: number };
  const entries: Entry[] = [];

  for (const archive of sortedArchives) {
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      if ((row.pointsFor ?? 0) <= 0) continue;
      entries.push({ owner: row.owner, value: row.pointsFor ?? 0, year: archive.year });
    }
  }

  if (entries.length === 0) return null;

  const maxValue = Math.max(...entries.map((e) => e.value));
  const topEntries = entries.filter((e) => e.value === maxValue);
  const holders = [...new Set(topEntries.map((e) => e.owner))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  // Year context: most recent archive among the top entries
  const topYear = Math.max(...topEntries.map((e) => e.year));

  const secondMaxValue = Math.max(...entries.filter((e) => e.value < maxValue).map((e) => e.value));
  const gap = Number.isFinite(secondMaxValue) ? maxValue - secondMaxValue : null;
  const secondOwners = Number.isFinite(secondMaxValue)
    ? [...new Set(entries.filter((e) => e.value === secondMaxValue).map((e) => e.owner))].sort()
    : null;

  return {
    id: 'single_season_points_high',
    category: 'season',
    label: 'Highest Season Points',
    holders,
    value: maxValue,
    formattedValue: `${formatNum(maxValue)} pts (${topYear})`,
    gapToSecond: gap,
    secondPlace: secondOwners ? { owners: secondOwners, value: secondMaxValue } : null,
    contextString: `${topYear} season`,
  };
}

function selectSingleSeasonPointsLowRecord(sortedArchives: SeasonArchive[]): RecordEntry | null {
  type Entry = { owner: string; value: number; year: number };
  const entries: Entry[] = [];

  for (const archive of sortedArchives) {
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      if ((row.pointsFor ?? 0) <= 0) continue;
      entries.push({ owner: row.owner, value: row.pointsFor ?? 0, year: archive.year });
    }
  }

  if (entries.length === 0) return null;

  const minValue = Math.min(...entries.map((e) => e.value));
  const bottomEntries = entries.filter((e) => e.value === minValue);
  const holders = [...new Set(bottomEntries.map((e) => e.owner))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const bottomYear = Math.min(...bottomEntries.map((e) => e.year));

  const secondMinValue = Math.min(...entries.filter((e) => e.value > minValue).map((e) => e.value));
  const gap = Number.isFinite(secondMinValue) ? secondMinValue - minValue : null;
  const secondOwners = Number.isFinite(secondMinValue)
    ? [...new Set(entries.filter((e) => e.value === secondMinValue).map((e) => e.owner))].sort()
    : null;

  return {
    id: 'single_season_points_low',
    category: 'season',
    label: 'Lowest Season Points',
    holders,
    value: minValue,
    formattedValue: `${formatNum(minValue)} pts (${bottomYear})`,
    gapToSecond: gap,
    secondPlace: secondOwners ? { owners: secondOwners, value: secondMinValue } : null,
    contextString: `${bottomYear} season`,
  };
}

function selectSingleSeasonHighScoreRecord(sortedArchives: SeasonArchive[]): RecordEntry | null {
  type Entry = { owner: string; score: number; year: number; week: number };
  const entries: Entry[] = [];

  for (const archive of sortedArchives) {
    for (const [owner, series] of Object.entries(archive.standingsHistory.byOwner)) {
      if (!isEligibleOwner(owner)) continue;
      const weekly = weeklyPointsForOwner(series);
      for (const [week, pts] of weekly) {
        if (pts > 0) entries.push({ owner, score: pts, year: archive.year, week });
      }
    }
  }

  if (entries.length === 0) return null;

  const maxScore = Math.max(...entries.map((e) => e.score));
  const topEntries = entries.filter((e) => e.score === maxScore);
  const holders = [...new Set(topEntries.map((e) => e.owner))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const top = topEntries[0]!;
  const secondMax = Math.max(...entries.filter((e) => e.score < maxScore).map((e) => e.score));
  const gap = Number.isFinite(secondMax) ? maxScore - secondMax : null;
  const secondOwners = Number.isFinite(secondMax)
    ? [...new Set(entries.filter((e) => e.score === secondMax).map((e) => e.owner))].sort()
    : null;

  return {
    id: 'single_season_high_score',
    category: 'season',
    label: 'Highest Single-Week Score',
    holders,
    value: maxScore,
    formattedValue: `${formatNum(maxScore)} pts (${top.year} Wk ${top.week})`,
    gapToSecond: gap,
    secondPlace: secondOwners ? { owners: secondOwners, value: secondMax } : null,
    contextString: `${top.year} · Week ${top.week}`,
  };
}

function selectSingleSeasonBlowoutRecord(sortedArchives: SeasonArchive[]): RecordEntry | null {
  const all: OwnedFinalMatchup[] = [];
  for (const archive of sortedArchives) {
    all.push(...getOwnedFinalMatchups(archive));
  }

  if (all.length === 0) return null;

  const maxMargin = Math.max(...all.map((m) => m.margin));
  const topMatchups = all.filter((m) => m.margin === maxMargin);
  const winners = [...new Set(topMatchups.map((m) => m.winner))].sort();
  if (winners.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const top = topMatchups[0]!;
  const secondMax = Math.max(...all.filter((m) => m.margin < maxMargin).map((m) => m.margin));
  const gap = Number.isFinite(secondMax) ? maxMargin - secondMax : null;
  const secondWinners = Number.isFinite(secondMax)
    ? [...new Set(all.filter((m) => m.margin === secondMax).map((m) => m.winner))].sort()
    : null;

  return {
    id: 'single_season_blowout',
    category: 'season',
    label: 'Largest Single-Game Blowout',
    holders: winners,
    value: maxMargin,
    formattedValue: `${formatNum(maxMargin)} pts (${top.year})`,
    gapToSecond: gap,
    secondPlace: secondWinners ? { owners: secondWinners, value: secondMax } : null,
    contextString: `over ${top.loser} · ${top.year}`,
  };
}

// ---------------------------------------------------------------------------
// Rivalry record selectors
// ---------------------------------------------------------------------------

function selectLopsidedRivalryRecord(h2hPairs: Map<string, H2HResult[]>): RecordEntry | null {
  type Entry = {
    dominant: string;
    loser: string;
    diff: number;
    dominantWins: number;
    loserWins: number;
  };
  const entries: Entry[] = [];

  for (const [key, results] of h2hPairs) {
    if (results.length < MIN_RIVALRY_MEETINGS) continue;
    const sep = key.indexOf('|');
    const ownerA = key.slice(0, sep);
    const ownerB = key.slice(sep + 1);

    const winsA = results.filter((r) => r.winner === ownerA).length;
    const winsB = results.length - winsA;
    const diff = Math.abs(winsA - winsB);

    if (diff < 2) continue;

    const dominant = winsA >= winsB ? ownerA : ownerB;
    const loser = winsA >= winsB ? ownerB : ownerA;
    const dominantWins = Math.max(winsA, winsB);
    const loserWins = Math.min(winsA, winsB);
    entries.push({ dominant, loser, diff, dominantWins, loserWins });
  }

  if (entries.length === 0) return null;

  const maxDiff = Math.max(...entries.map((e) => e.diff));
  const topEntries = entries.filter((e) => e.diff === maxDiff);
  const holders = [...new Set(topEntries.flatMap((e) => [e.dominant, e.loser]))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const top = topEntries[0]!;
  const secondMax = Math.max(...entries.filter((e) => e.diff < maxDiff).map((e) => e.diff));
  const gap = Number.isFinite(secondMax) ? maxDiff - secondMax : null;

  return {
    id: 'lopsided_rivalry',
    category: 'rivalry',
    label: 'Most Lopsided Rivalry',
    holders,
    value: maxDiff,
    formattedValue: `${top.dominantWins}–${top.loserWins}`,
    gapToSecond: gap,
    secondPlace: Number.isFinite(secondMax)
      ? {
          owners: [
            ...new Set(
              entries.filter((e) => e.diff === secondMax).flatMap((e) => [e.dominant, e.loser])
            ),
          ].sort(),
          value: secondMax,
        }
      : null,
  };
}

function selectEvenRivalryRecord(h2hPairs: Map<string, H2HResult[]>): RecordEntry | null {
  type Entry = {
    ownerA: string;
    ownerB: string;
    meetings: number;
    winDiff: number;
    winsA: number;
    winsB: number;
  };
  const entries: Entry[] = [];

  for (const [key, results] of h2hPairs) {
    if (results.length < MIN_RIVALRY_MEETINGS) continue;
    const sep = key.indexOf('|');
    const ownerA = key.slice(0, sep);
    const ownerB = key.slice(sep + 1);

    const winsA = results.filter((r) => r.winner === ownerA).length;
    const winsB = results.length - winsA;
    const winDiff = Math.abs(winsA - winsB);
    entries.push({ ownerA, ownerB, meetings: results.length, winDiff, winsA, winsB });
  }

  if (entries.length === 0) return null;

  // Even rivalry: smallest win diff, then most meetings
  const minDiff = Math.min(...entries.map((e) => e.winDiff));
  const evenEntries = entries.filter((e) => e.winDiff === minDiff);
  const maxMeetings = Math.max(...evenEntries.map((e) => e.meetings));
  const topEntries = evenEntries.filter((e) => e.meetings === maxMeetings);

  const holders = [...new Set(topEntries.flatMap((e) => [e.ownerA, e.ownerB]))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const top = topEntries[0]!;
  return {
    id: 'even_rivalry',
    category: 'rivalry',
    label: 'Most Even Rivalry',
    holders,
    value: top.meetings,
    formattedValue: `${top.winsA}–${top.winsB} (${top.meetings} games)`,
    gapToSecond: null,
    secondPlace: null,
  };
}

function selectDominanceStreakRecord(h2hPairs: Map<string, H2HResult[]>): RecordEntry | null {
  type Entry = { winner: string; loser: string; streak: number };
  const entries: Entry[] = [];

  for (const [key, results] of h2hPairs) {
    if (results.length === 0) continue;
    const sep = key.indexOf('|');
    const ownerA = key.slice(0, sep);
    const ownerB = key.slice(sep + 1);

    // Active streak = consecutive wins by the most recent winner
    const last = results[results.length - 1]!;
    let streak = 1;
    for (let i = results.length - 2; i >= 0; i--) {
      if (results[i]!.winner === last.winner) {
        streak++;
      } else {
        break;
      }
    }

    if (streak < 2) continue;

    const loser = last.winner === ownerA ? ownerB : ownerA;
    entries.push({ winner: last.winner, loser, streak });
  }

  if (entries.length === 0) return null;

  const maxStreak = Math.max(...entries.map((e) => e.streak));
  const topEntries = entries.filter((e) => e.streak === maxStreak);
  const holders = [...new Set(topEntries.flatMap((e) => [e.winner, e.loser]))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const secondMax = Math.max(...entries.filter((e) => e.streak < maxStreak).map((e) => e.streak));
  const gap = Number.isFinite(secondMax) ? maxStreak - secondMax : null;

  return {
    id: 'dominance_streak',
    category: 'rivalry',
    label: 'Longest Dominance Streak',
    holders,
    value: maxStreak,
    formattedValue: `${maxStreak} straight`,
    gapToSecond: gap,
    secondPlace: Number.isFinite(secondMax)
      ? {
          owners: [
            ...new Set(
              entries.filter((e) => e.streak === secondMax).flatMap((e) => [e.winner, e.loser])
            ),
          ].sort(),
          value: secondMax,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Event record selectors
// ---------------------------------------------------------------------------

function selectClosestTitleRaceRecord(sortedArchives: SeasonArchive[]): RecordEntry | null {
  type Entry = { champion: string; runnerUp: string; gamesBack: number; year: number };
  const entries: Entry[] = [];

  for (const archive of sortedArchives) {
    const eligible = archive.finalStandings.filter((r) => isEligibleOwner(r.owner));
    if (eligible.length < 2) continue;
    const champion = eligible[0]!.owner;
    const runnerUp = eligible[1]!;
    // gamesBack of runner-up: how many games behind the leader
    const gb = runnerUp.gamesBack ?? 0;
    entries.push({ champion, runnerUp: runnerUp.owner, gamesBack: gb, year: archive.year });
  }

  if (entries.length === 0) return null;

  const minGB = Math.min(...entries.map((e) => e.gamesBack));
  const topEntries = entries.filter((e) => e.gamesBack === minGB);
  const holders = [...new Set(topEntries.flatMap((e) => [e.champion, e.runnerUp]))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const top = topEntries[topEntries.length - 1]!; // most recent closest race
  const secondMin = Math.min(...entries.filter((e) => e.gamesBack > minGB).map((e) => e.gamesBack));
  const gap = Number.isFinite(secondMin) ? secondMin - minGB : null;
  const secondOwners = Number.isFinite(secondMin)
    ? [
        ...new Set(
          entries.filter((e) => e.gamesBack === secondMin).flatMap((e) => [e.champion, e.runnerUp])
        ),
      ].sort()
    : null;

  return {
    id: 'closest_title_race',
    category: 'event',
    label: 'Closest Title Race',
    holders,
    value: minGB,
    formattedValue: `${minGB.toFixed(1)} GB (${top.year})`,
    gapToSecond: gap,
    secondPlace: secondOwners ? { owners: secondOwners, value: secondMin } : null,
  };
}

function selectBiggestCollapseRecord(sortedArchives: SeasonArchive[]): RecordEntry | null {
  type Entry = { owner: string; drop: number; fromYear: number; toYear: number };
  const entries: Entry[] = [];

  for (let i = 1; i < sortedArchives.length; i++) {
    const prev = sortedArchives[i - 1]!;
    const curr = sortedArchives[i]!;

    const prevRanks = new Map<string, number>();
    prev.finalStandings
      .filter((row) => isEligibleOwner(row.owner))
      .forEach((row, idx) => {
        prevRanks.set(row.owner, idx + 1);
      });

    curr.finalStandings
      .filter((row) => isEligibleOwner(row.owner))
      .forEach((row, idx) => {
        const prevRank = prevRanks.get(row.owner);
        if (prevRank === undefined) return;
        const currRank = idx + 1;
        const drop = currRank - prevRank; // positive = dropped positions
        if (drop > 0)
          entries.push({ owner: row.owner, drop, fromYear: prev.year, toYear: curr.year });
      });
  }

  if (entries.length === 0) return null;

  const maxDrop = Math.max(...entries.map((e) => e.drop));
  const topEntries = entries.filter((e) => e.drop === maxDrop);
  const holders = [...new Set(topEntries.map((e) => e.owner))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const top = topEntries[0]!;
  const secondMax = Math.max(...entries.filter((e) => e.drop < maxDrop).map((e) => e.drop));
  const gap = Number.isFinite(secondMax) ? maxDrop - secondMax : null;
  const secondOwners = Number.isFinite(secondMax)
    ? [...new Set(entries.filter((e) => e.drop === secondMax).map((e) => e.owner))].sort()
    : null;

  return {
    id: 'biggest_collapse',
    category: 'event',
    label: 'Biggest Season Collapse',
    holders,
    value: maxDrop,
    formattedValue: `${maxDrop} spots (${top.fromYear}→${top.toYear})`,
    gapToSecond: gap,
    secondPlace: secondOwners ? { owners: secondOwners, value: secondMax } : null,
  };
}

function selectBiggestClimbRecord(sortedArchives: SeasonArchive[]): RecordEntry | null {
  type Entry = { owner: string; climb: number; fromYear: number; toYear: number };
  const entries: Entry[] = [];

  for (let i = 1; i < sortedArchives.length; i++) {
    const prev = sortedArchives[i - 1]!;
    const curr = sortedArchives[i]!;

    const prevRanks = new Map<string, number>();
    prev.finalStandings
      .filter((row) => isEligibleOwner(row.owner))
      .forEach((row, idx) => {
        prevRanks.set(row.owner, idx + 1);
      });

    curr.finalStandings
      .filter((row) => isEligibleOwner(row.owner))
      .forEach((row, idx) => {
        const prevRank = prevRanks.get(row.owner);
        if (prevRank === undefined) return;
        const currRank = idx + 1;
        const climb = prevRank - currRank; // positive = improved
        if (climb > 0)
          entries.push({ owner: row.owner, climb, fromYear: prev.year, toYear: curr.year });
      });
  }

  if (entries.length === 0) return null;

  const maxClimb = Math.max(...entries.map((e) => e.climb));
  const topEntries = entries.filter((e) => e.climb === maxClimb);
  const holders = [...new Set(topEntries.map((e) => e.owner))].sort();
  if (holders.length > RECORDS_TIE_SUPPRESSION_THRESHOLD) return null;

  const top = topEntries[0]!;
  const secondMax = Math.max(...entries.filter((e) => e.climb < maxClimb).map((e) => e.climb));
  const gap = Number.isFinite(secondMax) ? maxClimb - secondMax : null;
  const secondOwners = Number.isFinite(secondMax)
    ? [...new Set(entries.filter((e) => e.climb === secondMax).map((e) => e.owner))].sort()
    : null;

  return {
    id: 'biggest_climb',
    category: 'event',
    label: 'Biggest Season Climb',
    holders,
    value: maxClimb,
    formattedValue: `${maxClimb} spots (${top.fromYear}→${top.toYear})`,
    gapToSecond: gap,
    secondPlace: secondOwners ? { owners: secondOwners, value: secondMax } : null,
  };
}

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

/**
 * Computes all league records from archived season data.
 *
 * Pure transformation — performs no I/O. Callers (page RSC or buildInsightContext)
 * are responsible for sourcing archives and rosters before calling this function.
 */
export function selectAllRecords(input: SelectAllRecordsInput): LeagueRecords {
  const { archives, historicalRosters, currentRoster } = input;

  if (archives.length === 0) {
    return { career: [], season: [], rivalry: [], event: [] };
  }

  const sortedArchives = [...archives].sort((a, b) => a.year - b.year);
  const accum = buildCareerAccumulator(sortedArchives);
  const h2hPairs = collectAllTimeH2H(sortedArchives, historicalRosters);
  const activeOwners = activeOwnerSet(currentRoster);

  // Career records
  const careerRecords: RecordEntry[] = [
    selectCareerPointsRecord(accum),
    selectCareerWinsRecord(accum),
    selectCareerWinPctRecord(accum),
    selectCareerTitlesRecord(accum),
    selectCareerAvgFinishRecord(accum),
    selectCareerConsistencyRecord(accum),
    selectCareerDroughtRecord(sortedArchives, accum, activeOwners),
    selectCareerDynastyRecord(sortedArchives, accum),
  ].filter((r): r is RecordEntry => r !== null);

  // Season records
  const seasonRecords: RecordEntry[] = [
    selectSingleSeasonPointsHighRecord(sortedArchives),
    selectSingleSeasonPointsLowRecord(sortedArchives),
    selectSingleSeasonHighScoreRecord(sortedArchives),
    selectSingleSeasonBlowoutRecord(sortedArchives),
  ].filter((r): r is RecordEntry => r !== null);

  // Rivalry records
  const rivalryRecords: RecordEntry[] = [
    selectLopsidedRivalryRecord(h2hPairs),
    selectEvenRivalryRecord(h2hPairs),
    selectDominanceStreakRecord(h2hPairs),
  ].filter((r): r is RecordEntry => r !== null);

  // Event records
  const eventRecords: RecordEntry[] = [
    selectClosestTitleRaceRecord(sortedArchives),
    selectBiggestCollapseRecord(sortedArchives),
    selectBiggestClimbRecord(sortedArchives),
  ].filter((r): r is RecordEntry => r !== null);

  return {
    career: careerRecords,
    season: seasonRecords,
    rivalry: rivalryRecords,
    event: eventRecords,
  };
}

// ---------------------------------------------------------------------------
// Ranked records (Stats subtab)
// ---------------------------------------------------------------------------

/**
 * Identifiers for records that produce per-league rankings on the Stats subtab.
 *
 * Excludes rivalry records (lopsided_rivalry, even_rivalry, dominance_streak):
 * those are pair-shaped, not owner-shaped, and surface on the Rivalries subtab.
 */
export type RecordId =
  | 'career_points'
  | 'career_wins'
  | 'career_win_pct'
  | 'career_titles'
  | 'career_avg_finish'
  | 'career_consistency'
  | 'career_drought'
  | 'career_dynasty'
  | 'single_season_points_high'
  | 'single_season_points_low'
  | 'single_season_high_score'
  | 'single_season_blowout'
  | 'closest_title_race'
  | 'biggest_collapse'
  | 'biggest_climb';

/** Categories surfaced on the Stats subtab. Excludes 'rivalry'. */
export type RecordCategory = 'career' | 'season' | 'event';

export type RankedRecordRow = {
  /** Standard competition rank (1, 2, 2, 4). Ties share rank; next rank skips. */
  rank: number;
  /** Lex-sorted; multiple owners only on tie. */
  owners: string[];
  value: number;
  formattedValue: string;
  contextString?: string;
  /** True only when every owner in this row is absent from currentRoster. */
  isFormer: boolean;
};

export type RankedRecord = {
  id: RecordId;
  label: string;
  category: RecordCategory;
  rows: RankedRecordRow[];
};

const RANKED_RECORD_META: Record<RecordId, { label: string; category: RecordCategory }> = {
  career_points: { label: 'Career Points', category: 'career' },
  career_wins: { label: 'Career Wins', category: 'career' },
  career_win_pct: { label: 'Career Win %', category: 'career' },
  career_titles: { label: 'Most Titles', category: 'career' },
  career_avg_finish: { label: 'Best Avg Finish', category: 'career' },
  career_consistency: { label: 'Most Top-3 Finishes', category: 'career' },
  career_drought: { label: 'Longest Title Drought', category: 'career' },
  career_dynasty: { label: 'Championship Dynasty', category: 'career' },
  single_season_points_high: { label: 'Highest Season Points', category: 'season' },
  single_season_points_low: { label: 'Lowest Season Points', category: 'season' },
  single_season_high_score: { label: 'Highest Single-Week Score', category: 'season' },
  single_season_blowout: { label: 'Largest Single-Game Blowout', category: 'season' },
  closest_title_race: { label: 'Closest Title Race', category: 'event' },
  biggest_collapse: { label: 'Biggest Season Collapse', category: 'event' },
  biggest_climb: { label: 'Biggest Season Climb', category: 'event' },
};

export const RANKED_RECORD_IDS: readonly RecordId[] = Object.keys(RANKED_RECORD_META) as RecordId[];

function emptyRanked(id: RecordId): RankedRecord {
  return {
    id,
    label: RANKED_RECORD_META[id].label,
    category: RANKED_RECORD_META[id].category,
    rows: [],
  };
}

/**
 * Converts pre-sorted buckets into ranked rows with standard competition ranking.
 * `contextByValue` looks up a per-bucket context string keyed by the bucket value.
 */
function bucketsToRows(
  buckets: RankedBucket[],
  formatValue: (v: number) => string,
  activeOwners: Set<string>,
  contextByValue?: Map<number, string>
): RankedRecordRow[] {
  const rows: RankedRecordRow[] = [];
  let nextRank = 1;
  for (const bucket of buckets) {
    const isFormer = bucket.owners.every((o) => !activeOwners.has(o));
    rows.push({
      rank: nextRank,
      owners: bucket.owners,
      value: bucket.value,
      formattedValue: formatValue(bucket.value),
      ...(contextByValue?.has(bucket.value)
        ? { contextString: contextByValue.get(bucket.value) }
        : {}),
      isFormer,
    });
    nextRank += bucket.owners.length;
  }
  return rows;
}

// --- Career rankings -------------------------------------------------------

function rankCareerPoints(accum: Map<string, OwnerAccum>, activeOwners: Set<string>): RankedRecord {
  const items = Array.from(accum.values()).filter((a) => a.totalPoints > 0);
  const buckets = groupByValue(
    items,
    (a) => a.totalPoints,
    (a) => a.owner,
    'desc'
  );
  return {
    ...emptyRanked('career_points'),
    rows: bucketsToRows(buckets, (v) => `${formatNum(v)} pts`, activeOwners),
  };
}

function rankCareerWins(accum: Map<string, OwnerAccum>, activeOwners: Set<string>): RankedRecord {
  const items = Array.from(accum.values()).filter((a) => a.totalWins > 0);
  const buckets = groupByValue(
    items,
    (a) => a.totalWins,
    (a) => a.owner,
    'desc'
  );
  return {
    ...emptyRanked('career_wins'),
    rows: bucketsToRows(buckets, (v) => `${v} wins`, activeOwners),
  };
}

function rankCareerWinPct(accum: Map<string, OwnerAccum>, activeOwners: Set<string>): RankedRecord {
  const items = Array.from(accum.values())
    .filter((a) => a.seasonsPlayed >= MIN_CAREER_SEASONS && a.totalWins + a.totalLosses > 0)
    .map((a) => ({ owner: a.owner, winPct: a.totalWins / (a.totalWins + a.totalLosses) }));
  const buckets = groupByValue(
    items,
    (a) => a.winPct,
    (a) => a.owner,
    'desc'
  );
  return {
    ...emptyRanked('career_win_pct'),
    rows: bucketsToRows(buckets, (v) => `${(v * 100).toFixed(1)}%`, activeOwners),
  };
}

function rankCareerTitles(accum: Map<string, OwnerAccum>, activeOwners: Set<string>): RankedRecord {
  const items = Array.from(accum.values()).filter((a) => a.titles >= 1);
  const buckets = groupByValue(
    items,
    (a) => a.titles,
    (a) => a.owner,
    'desc'
  );
  const yearsByOwner = new Map<string, number[]>();
  for (const a of items) yearsByOwner.set(a.owner, a.titleYears);
  // career_titles emits ONE ROW PER TIED OWNER (not grouped) so each owner's
  // championship years appear as their own contextString — tied entries
  // surface as "T-1 Whited 2022, 2024" / "T-1 Pruitt 2023, 2025" rather than
  // a single grouped row that would mis-attribute years across owners.
  // Standard competition ranking still applies: the next bucket's rank skips
  // by the size of the prior tied group.
  const rows: RankedRecordRow[] = [];
  let nextRank = 1;
  for (const bucket of buckets) {
    for (const owner of bucket.owners) {
      const years = [...(yearsByOwner.get(owner) ?? [])].sort((a, b) => a - b);
      rows.push({
        rank: nextRank,
        owners: [owner],
        value: bucket.value,
        formattedValue: `${bucket.value} title${bucket.value !== 1 ? 's' : ''}`,
        ...(years.length > 0 ? { contextString: years.join(', ') } : {}),
        isFormer: !activeOwners.has(owner),
      });
    }
    nextRank += bucket.owners.length;
  }
  return { ...emptyRanked('career_titles'), rows };
}

function rankCareerAvgFinish(
  accum: Map<string, OwnerAccum>,
  activeOwners: Set<string>
): RankedRecord {
  const items = Array.from(accum.values())
    .filter((a) => a.seasonsPlayed >= MIN_CAREER_SEASONS)
    .map((a) => ({
      owner: a.owner,
      avgFinish: a.finishHistory.reduce((s, f) => s + f.rank, 0) / a.finishHistory.length,
    }));
  const buckets = groupByValue(
    items,
    (a) => a.avgFinish,
    (a) => a.owner,
    'asc'
  );
  return {
    ...emptyRanked('career_avg_finish'),
    rows: bucketsToRows(buckets, (v) => `#${v.toFixed(1)} avg`, activeOwners),
  };
}

function rankCareerConsistency(
  accum: Map<string, OwnerAccum>,
  activeOwners: Set<string>
): RankedRecord {
  const items = Array.from(accum.values()).filter((a) => a.top3Count >= 1);
  const buckets = groupByValue(
    items,
    (a) => a.top3Count,
    (a) => a.owner,
    'desc'
  );
  return {
    ...emptyRanked('career_consistency'),
    rows: bucketsToRows(buckets, (v) => `${v} top-3${v !== 1 ? 's' : ''}`, activeOwners),
  };
}

function rankCareerDrought(
  sortedArchives: SeasonArchive[],
  accum: Map<string, OwnerAccum>,
  activeOwners: Set<string>
): RankedRecord {
  if (sortedArchives.length === 0) return emptyRanked('career_drought');
  const latestYear = sortedArchives[sortedArchives.length - 1]!.year;

  type DroughtEntry = { owner: string; drought: number };
  const entries: DroughtEntry[] = [];
  for (const owner of activeOwners) {
    const data = accum.get(owner);
    if (!data || data.seasonsPlayed === 0) continue;
    const lastTitleYear = data.titleYears.length > 0 ? Math.max(...data.titleYears) : null;
    const drought = lastTitleYear !== null ? latestYear - lastTitleYear : data.seasonsPlayed;
    if (drought <= 0) continue;
    entries.push({ owner, drought });
  }

  const buckets = groupByValue(
    entries,
    (e) => e.drought,
    (e) => e.owner,
    'desc'
  );
  return {
    ...emptyRanked('career_drought'),
    rows: bucketsToRows(buckets, (v) => `${v} season${v !== 1 ? 's' : ''}`, activeOwners),
  };
}

function rankCareerDynasty(
  sortedArchives: SeasonArchive[],
  accum: Map<string, OwnerAccum>,
  activeOwners: Set<string>
): RankedRecord {
  const archiveYears = sortedArchives.map((a) => a.year);

  type DynastyEntry = { owner: string; streak: number };
  const entries: DynastyEntry[] = [];
  for (const [, data] of accum) {
    const titleYearSet = new Set(data.titleYears);
    const participatedYears = new Set(data.finishHistory.map((f) => f.year));
    let maxStreak = 0;
    let curStreak = 0;
    for (const year of archiveYears) {
      if (!participatedYears.has(year)) {
        curStreak = 0;
        continue;
      }
      if (titleYearSet.has(year)) {
        curStreak++;
        if (curStreak > maxStreak) maxStreak = curStreak;
      } else {
        curStreak = 0;
      }
    }
    if (maxStreak >= 2) entries.push({ owner: data.owner, streak: maxStreak });
  }

  const buckets = groupByValue(
    entries,
    (e) => e.streak,
    (e) => e.owner,
    'desc'
  );
  return {
    ...emptyRanked('career_dynasty'),
    rows: bucketsToRows(buckets, (v) => `${v} in a row`, activeOwners),
  };
}

// --- Season rankings (dedupe to per-owner best) ----------------------------

function rankSingleSeasonPointsHigh(
  sortedArchives: SeasonArchive[],
  activeOwners: Set<string>
): RankedRecord {
  type Entry = { owner: string; value: number; year: number };
  const all: Entry[] = [];
  for (const archive of sortedArchives) {
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      const pts = row.pointsFor ?? 0;
      if (pts <= 0) continue;
      all.push({ owner: row.owner, value: pts, year: archive.year });
    }
  }
  const bestByOwner = new Map<string, Entry>();
  for (const e of all) {
    const ex = bestByOwner.get(e.owner);
    if (!ex || e.value > ex.value || (e.value === ex.value && e.year > ex.year)) {
      bestByOwner.set(e.owner, e);
    }
  }
  const items = Array.from(bestByOwner.values());
  const buckets = groupByValue(
    items,
    (e) => e.value,
    (e) => e.owner,
    'desc'
  );
  // Per-bucket context: most-recent year among tied owners.
  const yearByValue = new Map<number, number>();
  for (const e of items) {
    const cur = yearByValue.get(e.value);
    if (cur === undefined || e.year > cur) yearByValue.set(e.value, e.year);
  }
  const ctxByValue = new Map<number, string>();
  for (const [v, y] of yearByValue) ctxByValue.set(v, `${y} season`);
  return {
    ...emptyRanked('single_season_points_high'),
    rows: bucketsToRows(buckets, (v) => `${formatNum(v)} pts`, activeOwners, ctxByValue),
  };
}

function rankSingleSeasonPointsLow(
  sortedArchives: SeasonArchive[],
  activeOwners: Set<string>
): RankedRecord {
  type Entry = { owner: string; value: number; year: number };
  const all: Entry[] = [];
  for (const archive of sortedArchives) {
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      const pts = row.pointsFor ?? 0;
      if (pts <= 0) continue;
      all.push({ owner: row.owner, value: pts, year: archive.year });
    }
  }
  // Lower is "worse"; rank ascending. Per-owner worst (lowest) season.
  const worstByOwner = new Map<string, Entry>();
  for (const e of all) {
    const ex = worstByOwner.get(e.owner);
    if (!ex || e.value < ex.value || (e.value === ex.value && e.year < ex.year)) {
      worstByOwner.set(e.owner, e);
    }
  }
  const items = Array.from(worstByOwner.values());
  const buckets = groupByValue(
    items,
    (e) => e.value,
    (e) => e.owner,
    'asc'
  );
  const yearByValue = new Map<number, number>();
  for (const e of items) {
    const cur = yearByValue.get(e.value);
    if (cur === undefined || e.year < cur) yearByValue.set(e.value, e.year);
  }
  const ctxByValue = new Map<number, string>();
  for (const [v, y] of yearByValue) ctxByValue.set(v, `${y} season`);
  return {
    ...emptyRanked('single_season_points_low'),
    rows: bucketsToRows(buckets, (v) => `${formatNum(v)} pts`, activeOwners, ctxByValue),
  };
}

function rankSingleSeasonHighScore(
  sortedArchives: SeasonArchive[],
  activeOwners: Set<string>
): RankedRecord {
  type Entry = { owner: string; score: number; year: number; week: number };
  const all: Entry[] = [];
  for (const archive of sortedArchives) {
    for (const [owner, series] of Object.entries(archive.standingsHistory.byOwner)) {
      if (!isEligibleOwner(owner)) continue;
      for (const [week, pts] of weeklyPointsForOwner(series)) {
        if (pts > 0) all.push({ owner, score: pts, year: archive.year, week });
      }
    }
  }
  const bestByOwner = new Map<string, Entry>();
  for (const e of all) {
    const ex = bestByOwner.get(e.owner);
    if (
      !ex ||
      e.score > ex.score ||
      (e.score === ex.score && e.year > ex.year) ||
      (e.score === ex.score && e.year === ex.year && e.week > ex.week)
    ) {
      bestByOwner.set(e.owner, e);
    }
  }
  const items = Array.from(bestByOwner.values());
  const buckets = groupByValue(
    items,
    (e) => e.score,
    (e) => e.owner,
    'desc'
  );
  // Per-bucket context: most-recent (year, week) among tied owners.
  const ctxByValue = new Map<number, string>();
  const bestEntryByValue = new Map<number, Entry>();
  for (const e of items) {
    const cur = bestEntryByValue.get(e.score);
    if (!cur || e.year > cur.year || (e.year === cur.year && e.week > cur.week)) {
      bestEntryByValue.set(e.score, e);
    }
  }
  for (const [v, e] of bestEntryByValue) ctxByValue.set(v, `${e.year} · Week ${e.week}`);
  return {
    ...emptyRanked('single_season_high_score'),
    rows: bucketsToRows(buckets, (v) => `${formatNum(v)} pts`, activeOwners, ctxByValue),
  };
}

function rankSingleSeasonBlowout(
  sortedArchives: SeasonArchive[],
  activeOwners: Set<string>
): RankedRecord {
  const all: OwnedFinalMatchup[] = [];
  for (const archive of sortedArchives) {
    all.push(...getOwnedFinalMatchups(archive));
  }
  // Per-winner best blowout (largest margin; on tie, most recent year).
  const bestByWinner = new Map<string, OwnedFinalMatchup>();
  for (const m of all) {
    const ex = bestByWinner.get(m.winner);
    if (!ex || m.margin > ex.margin || (m.margin === ex.margin && m.year > ex.year)) {
      bestByWinner.set(m.winner, m);
    }
  }
  const items = Array.from(bestByWinner.values());
  const buckets = groupByValue(
    items,
    (m) => m.margin,
    (m) => m.winner,
    'desc'
  );
  // Per-bucket context: representative matchup (most-recent year among tied owners).
  const repByValue = new Map<number, OwnedFinalMatchup>();
  for (const m of items) {
    const cur = repByValue.get(m.margin);
    if (!cur || m.year > cur.year) repByValue.set(m.margin, m);
  }
  const ctxByValue = new Map<number, string>();
  for (const [v, m] of repByValue) ctxByValue.set(v, `over ${m.loser} · ${m.year}`);
  return {
    ...emptyRanked('single_season_blowout'),
    rows: bucketsToRows(buckets, (v) => `${formatNum(v)} pts`, activeOwners, ctxByValue),
  };
}

// --- Event rankings (no dedupe — each event is its own row) ----------------

function rankClosestTitleRace(
  sortedArchives: SeasonArchive[],
  activeOwners: Set<string>
): RankedRecord {
  type Entry = { champion: string; runnerUp: string; gamesBack: number; year: number };
  const entries: Entry[] = [];
  for (const archive of sortedArchives) {
    const eligible = archive.finalStandings.filter((r) => isEligibleOwner(r.owner));
    if (eligible.length < 2) continue;
    entries.push({
      champion: eligible[0]!.owner,
      runnerUp: eligible[1]!.owner,
      gamesBack: eligible[1]!.gamesBack ?? 0,
      year: archive.year,
    });
  }
  // Rank events asc by gamesBack (closest first). Standard competition ranking.
  const sorted = [...entries].sort((a, b) => a.gamesBack - b.gamesBack || b.year - a.year);
  const rows: RankedRecordRow[] = [];
  let nextRank = 1;
  let lastValue: number | null = null;
  let bucketCount = 0;
  for (const e of sorted) {
    const owners = [...new Set([e.champion, e.runnerUp])].sort();
    if (lastValue !== null && e.gamesBack !== lastValue) {
      nextRank += bucketCount;
      bucketCount = 0;
    }
    rows.push({
      rank: nextRank,
      owners,
      value: e.gamesBack,
      formattedValue: `${e.gamesBack.toFixed(1)} GB`,
      contextString: `${e.year} season`,
      isFormer: owners.every((o) => !activeOwners.has(o)),
    });
    bucketCount += 1;
    lastValue = e.gamesBack;
  }
  return { ...emptyRanked('closest_title_race'), rows };
}

function rankBiggestRankChange(
  sortedArchives: SeasonArchive[],
  activeOwners: Set<string>,
  direction: 'collapse' | 'climb'
): RankedRecord {
  type Entry = { owner: string; delta: number; fromYear: number; toYear: number };
  const entries: Entry[] = [];
  for (let i = 1; i < sortedArchives.length; i++) {
    const prev = sortedArchives[i - 1]!;
    const curr = sortedArchives[i]!;
    const prevRanks = new Map<string, number>();
    prev.finalStandings
      .filter((row) => isEligibleOwner(row.owner))
      .forEach((row, idx) => prevRanks.set(row.owner, idx + 1));
    curr.finalStandings
      .filter((row) => isEligibleOwner(row.owner))
      .forEach((row, idx) => {
        const prevRank = prevRanks.get(row.owner);
        if (prevRank === undefined) return;
        const currRank = idx + 1;
        const delta = direction === 'collapse' ? currRank - prevRank : prevRank - currRank;
        if (delta > 0)
          entries.push({ owner: row.owner, delta, fromYear: prev.year, toYear: curr.year });
      });
  }

  const sorted = [...entries].sort((a, b) => b.delta - a.delta || b.toYear - a.toYear);
  const rows: RankedRecordRow[] = [];
  let nextRank = 1;
  let lastValue: number | null = null;
  let bucketCount = 0;
  for (const e of sorted) {
    if (lastValue !== null && e.delta !== lastValue) {
      nextRank += bucketCount;
      bucketCount = 0;
    }
    rows.push({
      rank: nextRank,
      owners: [e.owner],
      value: e.delta,
      formattedValue: `${e.delta} spots`,
      contextString: `${e.fromYear}→${e.toYear}`,
      isFormer: !activeOwners.has(e.owner),
    });
    bucketCount += 1;
    lastValue = e.delta;
  }
  const id: RecordId = direction === 'collapse' ? 'biggest_collapse' : 'biggest_climb';
  return { ...emptyRanked(id), rows };
}

/**
 * Returns full league rankings for every record id surfaced on the Stats subtab.
 *
 * Ranks owners (or events) by record value with standard competition ranking
 * (1, 2, 2, 4). Records with no qualifying entries return an empty rows array
 * rather than being omitted from the result.
 *
 * Owner-shaped records (career_*, single_season_*) dedupe to per-owner best —
 * each owner appears at most once per record. Event-shaped records
 * (closest_title_race, biggest_collapse, biggest_climb) emit one row per event.
 *
 * Rivalry records (lopsided_rivalry, even_rivalry, dominance_streak) are NOT
 * included; they belong on the Rivalries subtab and are pair-shaped, not
 * owner-shaped.
 */
export function selectRecordRankings(
  archives: SeasonArchive[],
  currentRoster: Map<string, string>
): Record<RecordId, RankedRecord> {
  const result = {} as Record<RecordId, RankedRecord>;
  if (archives.length === 0) {
    for (const id of RANKED_RECORD_IDS) result[id] = emptyRanked(id);
    return result;
  }

  const sortedArchives = [...archives].sort((a, b) => a.year - b.year);
  const accum = buildCareerAccumulator(sortedArchives);
  const activeOwners = activeOwnerSet(currentRoster);

  result.career_points = rankCareerPoints(accum, activeOwners);
  result.career_wins = rankCareerWins(accum, activeOwners);
  result.career_win_pct = rankCareerWinPct(accum, activeOwners);
  result.career_titles = rankCareerTitles(accum, activeOwners);
  result.career_avg_finish = rankCareerAvgFinish(accum, activeOwners);
  result.career_consistency = rankCareerConsistency(accum, activeOwners);
  result.career_drought = rankCareerDrought(sortedArchives, accum, activeOwners);
  result.career_dynasty = rankCareerDynasty(sortedArchives, accum, activeOwners);

  result.single_season_points_high = rankSingleSeasonPointsHigh(sortedArchives, activeOwners);
  result.single_season_points_low = rankSingleSeasonPointsLow(sortedArchives, activeOwners);
  result.single_season_high_score = rankSingleSeasonHighScore(sortedArchives, activeOwners);
  result.single_season_blowout = rankSingleSeasonBlowout(sortedArchives, activeOwners);

  result.closest_title_race = rankClosestTitleRace(sortedArchives, activeOwners);
  result.biggest_collapse = rankBiggestRankChange(sortedArchives, activeOwners, 'collapse');
  result.biggest_climb = rankBiggestRankChange(sortedArchives, activeOwners, 'climb');

  return result;
}
