import type { SeasonContext } from './seasonContext';
import { selectResolvedStandingsWeeks } from './historyResolution';
import type { InsightCategory, LifecycleState, NewsHook } from '../insights/types';
import type { InsightDecay } from '../insights/variants';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

export type InsightType =
  | 'movement'
  | 'toilet_bowl'
  | 'surge'
  | 'collapse'
  | 'race'
  | 'champion_margin'
  | 'failed_chase'
  | 'tight_cluster'
  | 'drought'
  | 'dynasty'
  | 'improvement'
  | 'consistency'
  | 'lopsided_rivalry'
  | 'even_rivalry'
  | 'dominance_streak'
  | 'career_points_leader'
  | 'career_turnover_margin'
  | 'volatility'
  | 'never_last'
  | 'title_chaser'
  | 'rookie_benchmark'
  | 'greatest_season'
  | 'trending_up'
  | 'trending_down'
  | 'ball_security'
  | 'takeaway_king'
  | 'yards_per_win'
  | 'clock_crusher'
  | 'third_down'
  | 'team_identity'
  | 'milestone_watch'
  | 'perfect_against'
  | 'self_schedule_heavy'
  | 'self_schedule_clean'
  | 'owners_joined'
  | 'owner_returned'
  | 'owners_left';

export type Insight = {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  owner?: string;
  relatedOwners?: string[];
  priorityScore: number;
  week?: number;
  navigationTarget?: 'standings' | 'trends' | 'matchup' | 'history';
  category?: InsightCategory;
  lifecycle?: LifecycleState[];
  stat?: { label: string; value: string };
  // News hook drives copy variation and suppression.
  newsHook: NewsHook;
  // The numeric stat the suppression gate tracks for this insight. Meaning is
  // generator-specific (e.g. career points, streak length, win differential).
  statValue: number;
  /**
   * INSIGHTS-031 — alternate wordings of the SAME fact, one of which `description`
   * already holds.
   *
   * The generator emits every variant and picks none. Choosing here would bake a
   * week's choice into the `unstable_cache` entry, which AGENTS.md invariant 3
   * forbids: time-dependent classification belongs in consumers, because a
   * `Date.now()` inside a tagged cache closure produces stale classification that
   * survives until someone manually invalidates. `selectInsightVariant` runs at
   * request time instead.
   *
   * Absent or single-entry means there is nothing to rotate and `description`
   * stands as written.
   */
  descriptionVariants?: string[];
  /**
   * INSIGHTS-031 — how this insight ages.
   *
   * `draft` means the fact is fixed but its RELEVANCE falls as the season moves
   * away from the draft. The generator declares the policy and never applies it:
   * a decayed score inside the cache would freeze at whatever lifecycle warmed
   * the entry. `applyInsightDecay` runs at request time.
   */
  decay?: InsightDecay;
  /**
   * The season this insight DESCRIBES, when that is not the season being viewed.
   * Set only by completed-season recaps served from an archive; navigation reads
   * it so a card about 2025 does not land the reader on 2026.
   */
  season?: number;
  // Backward-compatible aliases used by existing tests/UI until full migration.
  score?: number;
  owners?: string[];
};

const NO_CLAIM_OWNER = 'NoClaim';
const MIN_MEANINGFUL_MOVEMENT = 2;
const MIN_TOILET_BOWL_FINISHES = 2;
const TIGHT_RACE_GAP_THRESHOLD = 1;
const MIN_SURGE_WINS = 2;
const OVERVIEW_INSIGHT_LIMIT = 3;
const STANDINGS_INSIGHT_LIMIT = 3;
const FINAL_WEEKS_WINDOW = 3;
const FINAL_SURGE_MIN_WINS = 3;
const FINAL_SURGE_MIN_GAMES_BACK_GAIN = 2;
const STANDINGS_MIN_RACE_PRIORITY = 76;

/**
 * Type bonuses for the LEGACY standings-derived insights only.
 *
 * `deriveOverviewInsights` and `deriveStandingsInsights` are called exclusively
 * on `deriveLeagueInsights` output (`OverviewPanel.tsx`, `StandingsPanel.tsx`),
 * which is the standings-derived set. **ENGINE insights never pass through
 * here** — `OverviewPanel` sorts them by raw `priorityScore` and merges them
 * ahead of this set.
 *
 * INSIGHTS-031 registered two generator types in this map on the belief that an
 * unregistered type would rank last and never surface. That was wrong: the map
 * is real, but it is not on the engine path, so the entries did nothing and a
 * test pinned a mechanism that does not run. They were removed rather than left
 * as a decoration. A generator's rank is its `priorityScore`, full stop —
 * anything else needs the engine feed routed through a ranker first, which is a
 * separate decision recorded in docs/next-tasks.md.
 */
const OVERVIEW_TYPE_PRIORITY: Partial<Record<InsightType, number>> = {
  champion_margin: 120,
  failed_chase: 110,
  collapse: 105,
  surge: 102,
  tight_cluster: 98,
  race: 96,
  toilet_bowl: 92,
  movement: 90,
  dynasty: 85,
  lopsided_rivalry: 82,
  dominance_streak: 80,
  drought: 78,
  improvement: 74,
  consistency: 72,
  even_rivalry: 70,
};

const STANDINGS_TYPE_PRIORITY: Partial<Record<InsightType, number>> = {
  toilet_bowl: 120,
  collapse: 116,
  surge: 112,
  tight_cluster: 108,
  race: 104,
  failed_chase: 96,
  movement: 92,
  champion_margin: 88,
  dynasty: 70,
  lopsided_rivalry: 66,
  dominance_streak: 64,
  drought: 62,
  improvement: 58,
  consistency: 56,
  even_rivalry: 54,
};

const IN_SEASON_LIFECYCLES: LifecycleState[] = ['early_season', 'mid_season', 'late_season'];
const RACE_LIFECYCLES: LifecycleState[] = [
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
];
/**
 * Where a COMPLETED-season story may appear. Exported so the generator gates on
 * this exact list rather than keeping its own copy.
 *
 * `postseason` is included but is NOT sufficient on its own: `deriveLifecycleState`
 * maps BOTH `seasonContext === 'postseason'` and `'final'` onto it, so the
 * generator additionally requires `seasonContext === 'final'` there. Without
 * that, a recap announces "How 2026 finished" mid-bracket; without the lifecycle,
 * it goes dark for the seven-plus days between the championship and rollover
 * (`ROLLOVER_DELAY_MS`), which is when it is the freshest news there is.
 *
 * `offseason` is included for the same reason in the other direction: the
 * lifecycle flips `fresh_offseason` -> `offseason` on a date cutoff, so omitting
 * it makes the recap appear, vanish mid-offseason, and reappear in preseason.
 */
export const SEASON_WRAP_LIFECYCLES: LifecycleState[] = [
  'preseason',
  'postseason',
  'fresh_offseason',
  'offseason',
];

/**
 * Which ranked criterion actually separated these two. Mirrors the sort in
 * `src/lib/standings.ts` (wins, win percentage, point differential, points
 * scored, then owner name). `null` means only the alphabetical fallback did,
 * which is a deterministic tiebreak for display and not a reason anyone won.
 */
function titleDecider(leader: OwnerStandingsRow, runnerUp: OwnerStandingsRow): string | null {
  if (leader.wins !== runnerUp.wins) return 'wins';
  if (leader.winPct !== runnerUp.winPct) return 'win percentage';
  if (leader.pointDifferential !== runnerUp.pointDifferential) return 'point differential';
  if (leader.pointsFor !== runnerUp.pointsFor) return 'points scored';
  return null;
}

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
}

export function isNarrativeEligibleOwner(owner: string): boolean {
  return owner !== NO_CLAIM_OWNER;
}

// Reference owners can include synthetic buckets like NoClaim; only the
// primary narrative subject must pass isNarrativeEligibleOwner.
function canUseReferenceOwner(owner: string | null | undefined): boolean {
  if (!owner) return false;
  return owner !== NO_CLAIM_OWNER;
}

function toInsight(params: {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  owner?: string;
  relatedOwners?: string[];
  priorityScore: number;
  week?: number;
  navigationTarget?: 'standings' | 'trends' | 'matchup' | 'history';
  category?: InsightCategory;
  lifecycle?: LifecycleState[];
  stat?: { label: string; value: string };
  newsHook: NewsHook;
  statValue: number;
}): Insight {
  const { owner, relatedOwners = [], priorityScore } = params;
  return {
    ...params,
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

function rankByOwner(rows: OwnerStandingsRow[]): Map<string, number> {
  return new Map(rows.map((row, index) => [row.owner, index + 1]));
}

function pushInsightUnique(
  insights: Insight[],
  seenIds: Set<string>,
  insight: Insight | null
): void {
  if (!insight || seenIds.has(insight.id)) return;
  seenIds.add(insight.id);
  insights.push(insight);
}

function uniqueInsightsById(insights: Insight[]): Insight[] {
  const seenIds = new Set<string>();
  return insights.filter((insight) => {
    if (seenIds.has(insight.id)) return false;
    seenIds.add(insight.id);
    return true;
  });
}

export function deriveMovementInsights(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
}): Insight[] {
  const { standingsHistory, resolvedWeeks } = args;
  if (resolvedWeeks.length < 2) return [];

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const previousWeek = resolvedWeeks[resolvedWeeks.length - 2]!;
  const latestSnapshot = standingsHistory.byWeek[latestWeek];
  const previousSnapshot = standingsHistory.byWeek[previousWeek];
  if (!latestSnapshot || !previousSnapshot) return [];

  const latestRankByOwner = rankByOwner(latestSnapshot.standings);
  const previousRankByOwner = rankByOwner(previousSnapshot.standings);

  const movements = Array.from(latestRankByOwner.entries())
    .map(([owner, currentRank]) => {
      if (!isNarrativeEligibleOwner(owner)) return null;
      const previousRank = previousRankByOwner.get(owner);
      if (previousRank == null) return null;
      return { owner, rankDelta: previousRank - currentRank };
    })
    .filter((movement): movement is { owner: string; rankDelta: number } => movement !== null);

  const biggestRise = [...movements]
    .filter((movement) => movement.rankDelta >= MIN_MEANINGFUL_MOVEMENT)
    .sort((left, right) => {
      if (right.rankDelta !== left.rankDelta) return right.rankDelta - left.rankDelta;
      return left.owner.localeCompare(right.owner);
    })[0];

  const biggestDrop = [...movements]
    .filter((movement) => movement.rankDelta <= -MIN_MEANINGFUL_MOVEMENT)
    .sort((left, right) => {
      const leftMagnitude = Math.abs(left.rankDelta);
      const rightMagnitude = Math.abs(right.rankDelta);
      if (rightMagnitude !== leftMagnitude) return rightMagnitude - leftMagnitude;
      return left.owner.localeCompare(right.owner);
    })[0];

  const insights: Insight[] = [];
  const localSeen = new Set<string>();

  if (biggestRise) {
    pushInsightUnique(
      insights,
      localSeen,
      toInsight({
        id: `biggest-rise-${ownerSlug(biggestRise.owner)}-wk${latestWeek}`,
        type: 'movement',
        title: 'Biggest rise',
        description: `${biggestRise.owner} climbed ${biggestRise.rankDelta} spots in the standings.`,
        owner: biggestRise.owner,
        priorityScore: 55 + biggestRise.rankDelta * 10,
        week: latestWeek,
        navigationTarget: 'standings',
        category: 'trajectory',
        lifecycle: IN_SEASON_LIFECYCLES,
        newsHook: 'streak_started',
        statValue: biggestRise.rankDelta,
      })
    );
  }

  if (biggestDrop) {
    const dropMagnitude = Math.abs(biggestDrop.rankDelta);
    pushInsightUnique(
      insights,
      localSeen,
      toInsight({
        id: `biggest-drop-${ownerSlug(biggestDrop.owner)}-wk${latestWeek}`,
        type: 'collapse',
        title: 'Biggest drop',
        description: `${biggestDrop.owner} fell ${dropMagnitude} spots in the standings.`,
        owner: biggestDrop.owner,
        priorityScore: 54 + dropMagnitude * 10,
        week: latestWeek,
        navigationTarget: 'standings',
        category: 'trajectory',
        lifecycle: IN_SEASON_LIFECYCLES,
        newsHook: 'streak_extended',
        statValue: dropMagnitude,
      })
    );
  }

  return insights;
}

export function deriveToiletBowlInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
  completedSeason?: number;
}): Insight | null {
  const { standingsHistory, resolvedWeeks, completedSeason } = args;
  if (resolvedWeeks.length === 0) return null;

  const finishesByOwner = new Map<string, number>();
  for (const week of resolvedWeeks) {
    const snapshot = standingsHistory.byWeek[week];
    const lastRow = snapshot?.standings[snapshot.standings.length - 1];
    if (!lastRow || !isNarrativeEligibleOwner(lastRow.owner)) continue;
    finishesByOwner.set(lastRow.owner, (finishesByOwner.get(lastRow.owner) ?? 0) + 1);
  }

  const leader = Array.from(finishesByOwner.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  })[0];
  if (!leader) return null;

  const [owner, lastPlaceCount] = leader;
  if (lastPlaceCount < MIN_TOILET_BOWL_FINISHES) return null;

  return toInsight({
    id: `toilet-bowl-${ownerSlug(owner)}`,
    type: 'toilet_bowl',
    title: completedSeason
      ? `Who owns the porcelain throne in ${completedSeason}?`
      : 'Toilet bowl leader',
    // The UNIT stays in the sentence. `lastPlaceCount` counts WEEKS spent last,
    // not titles, and "captured the toilet bowl 5 times" under a "who owns the
    // throne" headline reads as five seasons. Invariant 5's exemption for
    // completed-season copy is conditioned on the copy being unambiguous.
    description: completedSeason
      ? `${owner} spent ${lastPlaceCount} week${lastPlaceCount === 1 ? '' : 's'} of ${completedSeason} in last place.`
      : `${owner} recorded ${lastPlaceCount} last-place week${lastPlaceCount === 1 ? '' : 's'}.`,
    owner,
    priorityScore: 50 + lastPlaceCount * 6,
    navigationTarget: 'trends',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
    newsHook: 'streak_extended',
    statValue: lastPlaceCount,
  });
}

export function deriveTightRaceInsight(args: {
  rows: OwnerStandingsRow[];
  seasonContext: SeasonContext | null | undefined;
}): Insight | null {
  const { rows, seasonContext } = args;
  if (rows.length < 2 || seasonContext === 'final') return null;
  // Defensive: a zero-game row set produces "Title race dead heat" (every
  // gamesBack is 0) which is meaningless before any games have been played.
  if (rows.every((row) => row.wins + row.losses === 0)) return null;

  const leader = rows[0];
  if (!leader || !isNarrativeEligibleOwner(leader.owner)) return null;

  const runnerUp = rows.find(
    (row, index) => index > 0 && row.gamesBack <= TIGHT_RACE_GAP_THRESHOLD
  );
  if (!runnerUp || !canUseReferenceOwner(runnerUp.owner)) return null;

  const gap = runnerUp.gamesBack;
  return toInsight({
    id: `tight-race-${ownerSlug(leader.owner)}-${ownerSlug(runnerUp.owner)}`,
    type: 'race',
    title: gap === 0 ? 'Title race dead heat' : 'Tight title race',
    description:
      gap === 0
        ? `${leader.owner} and ${runnerUp.owner} are tied for first.`
        : `${leader.owner} leads ${runnerUp.owner} by ${gap} game${gap === 1 ? '' : 's'}.`,
    owner: leader.owner,
    relatedOwners: [runnerUp.owner],
    priorityScore: 76 - gap * 8,
    navigationTarget: 'standings',
    category: 'championship_race',
    lifecycle: RACE_LIFECYCLES,
    newsHook: 'challenger_emerging',
    statValue: gap,
  });
}

export function deriveRecentSurgeInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
  rows?: OwnerStandingsRow[];
  finalOnly?: boolean;
  minWinsRequired?: number;
  minGamesBackGain?: number;
}): Insight | null {
  const {
    standingsHistory,
    resolvedWeeks,
    rows = [],
    finalOnly = false,
    minWinsRequired = MIN_SURGE_WINS,
    minGamesBackGain = 1,
  } = args;
  if (resolvedWeeks.length < 3) return null;

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const baselineWeek = resolvedWeeks[Math.max(0, resolvedWeeks.length - FINAL_WEEKS_WINDOW)]!;
  const rankByOwnerNow = new Map(rows.map((row, index) => [row.owner, index + 1]));

  const deltas = Object.entries(standingsHistory.byOwner)
    .map(([owner, series]) => {
      if (!isNarrativeEligibleOwner(owner)) return null;
      const latestPoint = series.find((point) => point.week === latestWeek);
      const baselinePoint = series.find((point) => point.week === baselineWeek);
      if (!latestPoint || !baselinePoint) return null;

      return {
        owner,
        deltaWins: latestPoint.wins - baselinePoint.wins,
        deltaGamesBack: baselinePoint.gamesBack - latestPoint.gamesBack,
        finalRank: rankByOwnerNow.get(owner) ?? Number.POSITIVE_INFINITY,
      };
    })
    .filter(
      (
        entry
      ): entry is { owner: string; deltaWins: number; deltaGamesBack: number; finalRank: number } =>
        entry !== null
    )
    .filter(
      (entry) => entry.deltaWins >= minWinsRequired || entry.deltaGamesBack >= minGamesBackGain
    )
    .filter((entry) => (finalOnly ? entry.finalRank > 1 : true));

  if (deltas.length === 0) return null;

  deltas.sort((left, right) => {
    if (right.deltaWins !== left.deltaWins) return right.deltaWins - left.deltaWins;
    if (right.deltaGamesBack !== left.deltaGamesBack)
      return right.deltaGamesBack - left.deltaGamesBack;
    return left.owner.localeCompare(right.owner);
  });

  const top = deltas[0];
  if (!top) return null;

  const isLateStory = finalOnly;
  return toInsight({
    id: `${isLateStory ? 'late-surge-short' : 'recent-surge'}-${ownerSlug(top.owner)}-wk${latestWeek}`,
    type: 'surge',
    title: isLateStory ? 'Late surge fell short' : 'Recent surge',
    description: isLateStory
      ? `${top.owner} surged late (+${top.deltaWins} wins over the last ${latestWeek - baselineWeek} weeks) but fell short.`
      : `${top.owner} gained ${top.deltaWins} wins over the last ${latestWeek - baselineWeek} weeks.`,
    owner: top.owner,
    priorityScore:
      (isLateStory ? 96 : 58) + top.deltaWins * 9 + Math.max(0, top.deltaGamesBack) * 4,
    week: latestWeek,
    navigationTarget: 'trends',
    category: isLateStory ? 'season_wrap' : 'trajectory',
    lifecycle: isLateStory ? SEASON_WRAP_LIFECYCLES : IN_SEASON_LIFECYCLES,
    newsHook: 'streak_started',
    statValue: top.deltaWins,
  });
}

/**
 * `completedSeason` means "this table is FINAL, and this is its year". Supplying
 * it switches to completed-season copy that names the year; omitting it keeps
 * the live-table wording, because `deriveLeagueInsights` serves the panels a
 * table that may still be in progress and "How 2026 finished" would be false
 * there.
 */
export function deriveChampionMarginInsight(
  rows: OwnerStandingsRow[],
  completedSeason?: number
): Insight | null {
  if (rows.length < 2) return null;
  const leader = rows[0];
  const runnerUp = rows[1];
  if (
    !leader ||
    !runnerUp ||
    !isNarrativeEligibleOwner(leader.owner) ||
    !canUseReferenceOwner(runnerUp.owner)
  ) {
    return null;
  }

  const margin = runnerUp.gamesBack;
  const variant =
    margin <= 1 ? 'tight finish' : margin <= 3 ? 'comfortable margin' : 'dominant season';

  // `gamesBack` is `leaderWins - wins`, so a title between two owners level on
  // wins has a margin of ZERO and the naive sentence is "by 0 games" — the
  // commonest shape of a close finish. The standings sort is the authority on
  // what actually separated them.
  const decider = titleDecider(leader, runnerUp);
  if (margin === 0 && decider === null) {
    // Level on every RANKED criterion; only the owner name separates them. That
    // is a display tiebreak, not a reason anyone won, so there is no honest
    // champion to report here.
    return null;
  }

  // Built ONCE and shared by both sentences below. Computing it per copy path is
  // how the first attempt at this slice shipped the corrected wording to the
  // engine feed while the Standings tab kept printing "by 0 games".
  const marginPhrase = margin > 0 ? `by ${margin} game${margin === 1 ? '' : 's'}` : `on ${decider}`;

  return toInsight({
    id: `champion-margin-${ownerSlug(leader.owner)}-${ownerSlug(runnerUp.owner)}`,
    type: 'champion_margin',
    title: completedSeason ? `How ${completedSeason} finished` : 'Champion margin',
    description: completedSeason
      ? `${leader.owner} took it ${marginPhrase} over ${runnerUp.owner}.`
      : `Title secured by ${leader.owner} over ${runnerUp.owner} ${marginPhrase} (${variant}).`,
    owner: leader.owner,
    relatedOwners: [runnerUp.owner],
    priorityScore: 125 + margin * 4,
    navigationTarget: 'standings',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
    newsHook: 'new_record',
    statValue: margin,
  });
}

/**
 * Who was actually CLOSING, not merely who placed second.
 *
 * A finishing-position reading ("best record among rows 2-4 that finished two or
 * more back") is blind to the thing that makes a chase worth reporting: an owner
 * who trailed by eight in October and closed to two scores identically to one
 * who sat two back all year. Owner ruling (2026-08-18): "it's more interesting
 * when framed as a look at the slope of the games-back line to see if anyone was
 * actively closing the gap to the leader but came up short."
 *
 * `standingsHistory.byOwner[owner]` carries `gamesBack` per week, so the
 * baseline deficit comes from the weekly series — the only place a historical
 * deficit exists — and the END of the measurement is the FINAL TABLE. Both the
 * ground gained and the shortfall therefore reference the same endpoint, so the
 * sentence cannot contradict itself when the last week's coverage is incomplete
 * and `selectResolvedStandingsWeeks` drops it.
 *
 * SCOPE: the baseline is `FINAL_WEEKS_WINDOW` back, so this is the LATE CHARGE.
 * A season-long climb that finished early scores zero here and produces no card;
 * the owner's answer was that both stories are worth telling, and the
 * biggest-turnaround card is queued separately rather than widening this window,
 * which would silently change which owner this one names.
 */
const MIN_CHASE_GAIN = 2;

export function deriveClosingChaseInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
  rows: OwnerStandingsRow[];
  completedSeason?: number;
}): Insight | null {
  const { standingsHistory, resolvedWeeks, rows, completedSeason } = args;
  if (resolvedWeeks.length < 3 || rows.length < 2) return null;

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const baselineWeek = resolvedWeeks[Math.max(0, resolvedWeeks.length - FINAL_WEEKS_WINDOW)]!;
  if (baselineWeek === latestWeek) return null;

  const leader = rows[0];
  if (!leader || !canUseReferenceOwner(leader.owner)) return null;

  const chases = rows
    .slice(1)
    .filter((row) => isNarrativeEligibleOwner(row.owner))
    .map((row) => {
      const start = standingsHistory.byOwner[row.owner]?.find(
        (point) => point.week === baselineWeek
      );
      if (!start) return null;
      return {
        owner: row.owner,
        closed: start.gamesBack - row.gamesBack,
        finishedBack: row.gamesBack,
      };
    })
    .filter((entry): entry is { owner: string; closed: number; finishedBack: number } =>
      // Ground actually gained, and the owner still ended behind: a chase that
      // SUCCEEDS is the champion, and that story already has its own card.
      Boolean(entry && entry.closed >= MIN_CHASE_GAIN && entry.finishedBack > 0)
    );

  chases.sort((left, right) => {
    if (right.closed !== left.closed) return right.closed - left.closed;
    if (left.finishedBack !== right.finishedBack) return left.finishedBack - right.finishedBack;
    return left.owner.localeCompare(right.owner);
  });

  const top = chases[0];
  if (!top) return null;

  // `gamesBack` is measured against whoever led IN THAT WEEK. If the lead changed
  // inside the window, ground gained on an earlier leader is not ground gained on
  // the eventual champion, and crediting it to them is a false claim about two
  // named people. Name the leader only when the same owner led at both ends.
  const baselineLeader = standingsHistory.byWeek[baselineWeek]?.standings[0]?.owner ?? null;
  const leaderHeld = baselineLeader !== null && baselineLeader === leader.owner;

  // The DURATION must share the amount's endpoint. `closed` and `finishedBack`
  // are measured baseline -> FINAL TABLE, so counting weeks to the last RESOLVED
  // week understates the span whenever the final week's coverage is incomplete:
  // the card would report a three-week change "over the final 2 weeks". The
  // history's own last week is the final table's week, resolved or not.
  const finalWeek = standingsHistory.weeks[standingsHistory.weeks.length - 1] ?? latestWeek;
  const weeks = finalWeek - baselineWeek;
  const gained = `${top.closed} game${top.closed === 1 ? '' : 's'}`;
  const short = `${top.finishedBack} game${top.finishedBack === 1 ? '' : 's'}`;
  return toInsight({
    id: `closing-chase-${ownerSlug(top.owner)}-wk${latestWeek}`,
    type: 'failed_chase',
    title: completedSeason ? `Who was closing in ${completedSeason}?` : 'Closing the gap',
    description: leaderHeld
      ? `${top.owner} cut ${gained} off ${leader.owner}'s lead over the final ${weeks} weeks and still finished ${short} back.`
      : `${top.owner} cut ${gained} off the lead over the final ${weeks} weeks and still finished ${short} back.`,
    owner: top.owner,
    relatedOwners: leaderHeld ? [leader.owner] : [],
    priorityScore: 104 + top.closed * 5,
    week: latestWeek,
    navigationTarget: 'trends',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
    newsHook: 'narrowing_gap',
    statValue: top.closed,
  });
}

export function deriveFinalCollapseInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
  rows: OwnerStandingsRow[];
  completedSeason?: number;
}): Insight | null {
  const { standingsHistory, resolvedWeeks, rows, completedSeason } = args;
  if (resolvedWeeks.length < 3 || rows.length === 0) return null;

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const baselineWeek = resolvedWeeks[Math.max(0, resolvedWeeks.length - FINAL_WEEKS_WINDOW)]!;
  const baselineSnapshot = standingsHistory.byWeek[baselineWeek];
  if (!baselineSnapshot) return null;

  const baselineRank = rankByOwner(baselineSnapshot.standings);
  const finalRank = new Map(rows.map((row, index) => [row.owner, index + 1]));

  const collapses = rows
    .filter((row) => isNarrativeEligibleOwner(row.owner))
    .map((row) => {
      const start = baselineRank.get(row.owner);
      const finish = finalRank.get(row.owner);
      if (start == null || finish == null) return null;
      return { owner: row.owner, dropSpots: finish - start };
    })
    .filter((entry): entry is { owner: string; dropSpots: number } =>
      Boolean(entry && entry.dropSpots >= 2)
    );

  collapses.sort((left, right) => {
    if (right.dropSpots !== left.dropSpots) return right.dropSpots - left.dropSpots;
    return left.owner.localeCompare(right.owner);
  });

  const top = collapses[0];
  if (!top) return null;

  const weeks = latestWeek - baselineWeek;
  return toInsight({
    id: `final-collapse-${ownerSlug(top.owner)}-wk${latestWeek}`,
    type: 'collapse',
    title: completedSeason
      ? `How ${completedSeason} slipped away for ${top.owner}`
      : 'Late collapse',
    description: completedSeason
      ? `Dropped ${top.dropSpots} spots over the final ${weeks} weeks.`
      : `${top.owner} dropped ${top.dropSpots} spots over the final ${weeks} weeks.`,
    owner: top.owner,
    priorityScore: 100 + top.dropSpots * 7,
    week: latestWeek,
    navigationTarget: 'trends',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
    newsHook: 'streak_extended',
    statValue: top.dropSpots,
  });
}

/**
 * PLATFORM-105 — the copy follows the season, because the season can now be
 * mid-flight when this fires.
 *
 * `RACE_LIFECYCLES` has always included `early_season`, but that lifecycle was
 * UNREACHABLE until this slice: an unplayed week counted as resolved, so every
 * season read as `final` from its first Saturday. This card therefore ran only
 * ever in states where "finished" was true, and its hardcoded past tense was
 * never wrong on screen. Making the lifecycle reachable is what exposes it —
 * verified on production data at week 3: "7 owners finished within 2 games".
 *
 * The sibling `deriveTightRaceInsight` already takes `seasonContext` for the
 * same reason; this follows that shape rather than inventing one.
 */
export function deriveTightClusterInsight(args: {
  rows: OwnerStandingsRow[];
  seasonContext?: SeasonContext | null;
}): Insight | null {
  const { rows, seasonContext } = args;
  const eligible = rows.filter((row) => isNarrativeEligibleOwner(row.owner));
  if (eligible.length < 3) return null;
  // Defensive: every owner at 0-0 produces "N owners finished within 0 games"
  // which is meaningless. The check on the eligible set (NoClaim already
  // stripped) avoids penalising a real leader who has games while NoClaim's
  // synthetic row is still 0-0.
  if (eligible.every((row) => row.wins + row.losses === 0)) return null;

  let bestCluster: { count: number; gap: number; owners: string[] } | null = null;
  for (let start = 0; start < eligible.length; start += 1) {
    for (let end = start + 2; end < eligible.length; end += 1) {
      const subset = eligible.slice(start, end + 1);
      const gap = subset[subset.length - 1]!.gamesBack - subset[0]!.gamesBack;
      if (gap > 2) break;
      const candidate = { count: subset.length, gap, owners: subset.map((row) => row.owner) };
      if (!bestCluster) {
        bestCluster = candidate;
        continue;
      }
      if (candidate.count > bestCluster.count) {
        bestCluster = candidate;
        continue;
      }
      if (candidate.count === bestCluster.count && candidate.gap < bestCluster.gap) {
        bestCluster = candidate;
      }
    }
  }

  if (!bestCluster) return null;

  // ONLY `final` is settled. I first treated `postseason` as finished too, and
  // review corrected it: `postseason` means a postseason week has been played
  // while scheduled weeks REMAIN, so bowl and playoff results can still move
  // this table. Worse, `deriveTightRaceInsight` keeps reporting an ACTIVE title
  // race in that same state, so the two cards would have contradicted each other
  // on one screen.
  const settled = seasonContext === 'final';
  // "the top" is a claim about WHERE the cluster is, and the search above scans
  // every contiguous subset — standings at 0, 10, 20, 20.5, 21 games back select
  // the last three. The old past-tense copy never said "top", so this is a claim
  // I introduced; it is only made when the cluster actually contains the leader.
  const includesLeader = bestCluster.owners.includes(eligible[0]!.owner);
  const games = `game${bestCluster.gap === 1 ? '' : 's'}`;
  return toInsight({
    id: `tight-cluster-${bestCluster.owners.map(ownerSlug).join('-')}`,
    type: 'tight_cluster',
    title: settled ? 'Crowded finish' : includesLeader ? 'Crowded at the top' : 'Tight cluster',
    description: settled
      ? `${bestCluster.count} owners finished within ${bestCluster.gap} ${games}.`
      : `${bestCluster.count} owners are within ${bestCluster.gap} ${games}.`,
    owner: bestCluster.owners[0],
    relatedOwners: bestCluster.owners.slice(1),
    priorityScore: 95 + bestCluster.count * 3 - bestCluster.gap,
    navigationTarget: 'standings',
    category: 'championship_race',
    lifecycle: RACE_LIFECYCLES,
    newsHook: 'challenger_emerging',
    statValue: bestCluster.count,
  });
}

function sortByPriority(insights: Insight[]): Insight[] {
  return insights.sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
    if ((right.week ?? -1) !== (left.week ?? -1)) return (right.week ?? -1) - (left.week ?? -1);
    return left.id.localeCompare(right.id);
  });
}

export function deriveLeagueInsights(args: {
  rows: OwnerStandingsRow[];
  standingsHistory: StandingsHistory | null;
  seasonContext?: SeasonContext | null;
}): Insight[] {
  const { rows, standingsHistory, seasonContext = null } = args;
  const insights: Insight[] = [];
  const seenIds = new Set<string>();

  // Lifecycle awareness for the legacy direct path. StandingsPanel and
  // OverviewPanel call this without lifecycle plumbing, so we fall back to a
  // row-content check: when no owner has played a single game (preseason,
  // cold-start, fresh-rollover with zero data), every derived insight here
  // would be meaningless ("X recorded 0 last-place weeks", "Title race dead
  // heat" at 0-0). Bail out before any derivation runs.
  const eligibleRows = rows.filter((row) => isNarrativeEligibleOwner(row.owner));
  const hasGames = eligibleRows.some((row) => row.wins + row.losses > 0);
  if (!hasGames) return [];

  const resolvedWeeks = standingsHistory
    ? selectResolvedStandingsWeeks(standingsHistory).resolvedWeeks
    : [];

  if (seasonContext === 'final') {
    pushInsightUnique(insights, seenIds, deriveChampionMarginInsight(rows));
    pushInsightUnique(insights, seenIds, deriveTightClusterInsight({ rows, seasonContext }));

    if (standingsHistory && resolvedWeeks.length > 0) {
      pushInsightUnique(
        insights,
        seenIds,
        deriveRecentSurgeInsight({
          standingsHistory,
          resolvedWeeks,
          rows,
          finalOnly: true,
          minWinsRequired: FINAL_SURGE_MIN_WINS,
          minGamesBackGain: FINAL_SURGE_MIN_GAMES_BACK_GAIN,
        })
      );
      pushInsightUnique(
        insights,
        seenIds,
        deriveFinalCollapseInsight({ standingsHistory, resolvedWeeks, rows })
      );
      pushInsightUnique(
        insights,
        seenIds,
        deriveClosingChaseInsight({ standingsHistory, resolvedWeeks, rows })
      );
      pushInsightUnique(
        insights,
        seenIds,
        deriveToiletBowlInsight({ standingsHistory, resolvedWeeks })
      );
    }
  } else {
    if (standingsHistory && resolvedWeeks.length > 0) {
      for (const movementInsight of deriveMovementInsights({ standingsHistory, resolvedWeeks })) {
        pushInsightUnique(insights, seenIds, movementInsight);
      }
      pushInsightUnique(
        insights,
        seenIds,
        deriveRecentSurgeInsight({ standingsHistory, resolvedWeeks, rows })
      );
      pushInsightUnique(
        insights,
        seenIds,
        deriveToiletBowlInsight({ standingsHistory, resolvedWeeks })
      );
    }
    pushInsightUnique(insights, seenIds, deriveTightRaceInsight({ rows, seasonContext }));
  }

  return uniqueInsightsById(sortByPriority(insights));
}

export function deriveOverviewInsights(insights: Insight[]): Insight[] {
  const unique = uniqueInsightsById(insights);
  const ranked = [...unique].sort((left, right) => {
    const leftScore = left.priorityScore + (OVERVIEW_TYPE_PRIORITY[left.type] ?? 0);
    const rightScore = right.priorityScore + (OVERVIEW_TYPE_PRIORITY[right.type] ?? 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.id.localeCompare(right.id);
  });
  return ranked.slice(0, OVERVIEW_INSIGHT_LIMIT);
}

export function deriveStandingsInsights(insights: Insight[]): Insight[] {
  const unique = uniqueInsightsById(insights);
  const ranked = [...unique].sort((left, right) => {
    const leftScore = left.priorityScore + (STANDINGS_TYPE_PRIORITY[left.type] ?? 0);
    const rightScore = right.priorityScore + (STANDINGS_TYPE_PRIORITY[right.type] ?? 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.id.localeCompare(right.id);
  });

  const contextual = ranked.filter((insight) => {
    if (insight.type === 'race') return insight.priorityScore >= STANDINGS_MIN_RACE_PRIORITY;
    return insight.type !== 'movement';
  });

  return contextual.slice(0, STANDINGS_INSIGHT_LIMIT);
}
