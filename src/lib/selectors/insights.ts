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
  /**
   * INSIGHTS-032 — the season this insight DESCRIBES, when that is not the
   * season being viewed. Set only by completed-season recap cards served from
   * an archive; navigation reads it so a card about 2025 does not land the
   * reader on 2026.
   */
  season?: number;
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
   *
   * `season_recap` is the same shape pointed the other way (INSIGHTS-032): a
   * finished season is the headline while it is the most recent thing that
   * happened, and background once the next one is being set up.
   */
  decay?: InsightDecay;
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
 * Where a COMPLETED-season story may appear. Exported because
 * `generators/existing.ts` gates the recap on the same list — it kept its own
 * copy until INSIGHTS-032, and only one of the two was updated, so every
 * archive-served card carried metadata saying it must not appear in the state it
 * was being served in.
 *
 * `postseason` was REMOVED (Codex review P1, owner ruling 2026-08-18).
 * `lifecycleState` becomes `postseason` the moment `seasonContext` does — that
 * is, when the postseason STARTS — so the recap was free to announce "How 2026
 * finished" and name a champion while those games were still being played.
 * A card that says a season finished may only appear once it has.
 */
export const SEASON_WRAP_LIFECYCLES: LifecycleState[] = ['preseason', 'fresh_offseason'];

/**
 * Which ranked criterion actually separated these two, phrased for copy. Mirrors
 * the standings sort in `src/lib/standings.ts`; `null` means only the
 * alphabetical fallback did, which is not a winning factor.
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
  /**
   * INSIGHTS-032 — the season this insight DESCRIBES, when that is not the
   * season being viewed. Set only by completed-season recap cards served from
   * an archive; navigation reads it so a card about 2025 does not land the
   * reader on 2026.
   */
  season?: number;
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
    description: completedSeason
      ? `${owner} captured the toilet bowl ${lastPlaceCount} time${lastPlaceCount === 1 ? '' : 's'}.`
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

  const marginCheck = runnerUp.gamesBack;
  if (marginCheck === 0 && titleDecider(leader, runnerUp) === null) {
    // Level on every ranked criterion: the standings sort separates them by
    // owner NAME. That is a deterministic tiebreak for display, not a reason
    // anyone won, so there is no honest way to report a champion here.
    return null;
  }
  const margin = runnerUp.gamesBack;
  const variant =
    margin <= 1 ? 'tight finish' : margin <= 3 ? 'comfortable margin' : 'dominant season';
  const games = `${margin} game${margin === 1 ? '' : 's'}`;

  // `gamesBack` is `leaderWins - wins`, so a title decided between two owners
  // level on wins has a margin of ZERO and "took it by 0 games" is the result.
  // Owner ruling (2026-08-18): "we should explain what the winning factor was."
  // The standings sort is the authority on that — wins, then win percentage,
  // then point differential, then points scored — so the deciding factor is the
  // first of those the two owners actually differ on.
  const decider = titleDecider(leader, runnerUp);
  return toInsight({
    id: `champion-margin-${ownerSlug(leader.owner)}-${ownerSlug(runnerUp.owner)}`,
    type: 'champion_margin',
    title: completedSeason ? `How ${completedSeason} finished` : 'Champion margin',
    description: completedSeason
      ? margin > 0
        ? `${leader.owner} took it by ${games} over ${runnerUp.owner}.`
        : `${leader.owner} and ${runnerUp.owner} finished level on wins; ${leader.owner} took it on ${decider}.`
      : `Title secured by ${leader.owner} over ${runnerUp.owner} by ${games} (${variant}).`,
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
 * INSIGHTS-032 — who was actually CLOSING, not merely who placed second.
 *
 * The previous derivation read the final table alone: it took the best record
 * among rows 2-4 that finished at least two back. That is a FINISHING-POSITION
 * fact wearing a chase's name — it can only restate the champion card from the
 * other side, and it is structurally blind to the thing that makes a chase worth
 * reporting. An owner who trailed by eight in October and closed to two by the
 * end never scored differently from one who sat two back all year.
 *
 * Owner ruling (2026-08-18): "it's more interesting when framed as a look at the
 * slope of the games-back line to see if anyone was actively closing the gap to
 * the leader but came up short."
 *
 * So this reads the SLOPE. `standingsHistory.byOwner[owner]` carries `gamesBack`
 * per week, so the ground an owner made up is the difference between the
 * baseline week and the last one. Two conditions make it a chase rather than a
 * finish: ground was actually gained (`MIN_CHASE_GAIN`), and the owner still
 * ended behind — a chase that SUCCEEDS is the champion, and that story already
 * has a card.
 *
 * SCOPE, stated precisely because an earlier version of this note oversold it:
 * the window is `FINAL_WEEKS_WINDOW`, so this is the LATE CHARGE, not the
 * season-long climb. An owner who closed six games between October and late
 * November and then held steady scores zero here and produces no card. That is
 * a real gap and it is deliberate for now — the owner's answer was that both
 * stories are worth telling ("the final chase and the biggest turnaround"), and
 * the season-long turnaround is queued as its own card rather than folded in
 * here, because widening this window would silently change which owner the
 * existing card names. The copy says "over the final N weeks", so what ships is
 * truthful about what it measured.
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
      const series = standingsHistory.byOwner[row.owner];
      const start = series?.find((point) => point.week === baselineWeek);
      const end = series?.find((point) => point.week === latestWeek);
      if (!start || !end) return null;
      return {
        owner: row.owner,
        // The SLOPE is measured across resolved weeks...
        closed: start.gamesBack - end.gamesBack,
        // ...but "finished N back" is a statement about the FINISH, so it reads
        // the final table. The two disagree whenever the last week's coverage is
        // incomplete: `selectResolvedStandingsWeeks` drops that week, so
        // `end.gamesBack` is an earlier week's deficit and the champion card in
        // the same feed would state a different number for the same owner.
        finishedBack: row.gamesBack,
      };
    })
    .filter((entry): entry is { owner: string; closed: number; finishedBack: number } =>
      Boolean(entry && entry.closed >= MIN_CHASE_GAIN && entry.finishedBack > 0)
    );

  chases.sort((left, right) => {
    if (right.closed !== left.closed) return right.closed - left.closed;
    if (left.finishedBack !== right.finishedBack) return left.finishedBack - right.finishedBack;
    return left.owner.localeCompare(right.owner);
  });

  const top = chases[0];
  if (!top) return null;

  const weeks = latestWeek - baselineWeek;
  const gained = `${top.closed} game${top.closed === 1 ? '' : 's'}`;
  const short = `${top.finishedBack} game${top.finishedBack === 1 ? '' : 's'}`;

  // `gamesBack` is measured against whoever led IN THAT WEEK, not against the
  // owner who eventually won. When the lead changed hands inside the window,
  // "cut 3 games off Zoe's lead" attributes ground gained on someone else to
  // the final champion — a false claim about two named people. So the leader is
  // named only when the SAME owner led at both ends of the window; otherwise the
  // copy states the deficit, which is true regardless of who held the lead.
  const baselineSnapshot = standingsHistory.byWeek[baselineWeek];
  const baselineLeader = baselineSnapshot?.standings[0]?.owner ?? null;
  const leaderHeldThroughout = baselineLeader !== null && baselineLeader === leader.owner;
  return toInsight({
    id: `closing-chase-${ownerSlug(top.owner)}-wk${latestWeek}`,
    type: 'failed_chase',
    title: completedSeason ? `Who was closing in ${completedSeason}?` : 'Closing the gap',
    description: leaderHeldThroughout
      ? `${top.owner} cut ${gained} off ${leader.owner}'s lead over the final ${weeks} weeks and still finished ${short} back.`
      : `${top.owner} cut ${gained} off the lead over the final ${weeks} weeks and still finished ${short} back.`,
    owner: top.owner,
    relatedOwners: leaderHeldThroughout ? [leader.owner] : [],
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

export function deriveTightClusterInsight(rows: OwnerStandingsRow[]): Insight | null {
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

  return toInsight({
    id: `tight-cluster-${bestCluster.owners.map(ownerSlug).join('-')}`,
    type: 'tight_cluster',
    title: 'Crowded finish',
    description: `${bestCluster.count} owners finished within ${bestCluster.gap} game${bestCluster.gap === 1 ? '' : 's'}.`,
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
    pushInsightUnique(insights, seenIds, deriveTightClusterInsight(rows));

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
