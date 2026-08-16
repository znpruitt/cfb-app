import type { Insight } from '../../selectors/insights';
import { registerGenerator } from '../engine';
import {
  formatOwnerList,
  membershipIsKnown,
  resolveSuperlative,
  type RecordHolder,
} from '../superlative';
import type {
  InsightContext,
  InsightGenerator,
  LifecycleState,
  NewsHook,
  OwnerCareerStats,
} from '../types';

const NO_CLAIM_OWNER = 'NoClaim';
const TIE_SUPPRESSION_THRESHOLD = 4;

const POINTS_LEADER_LIFECYCLES: LifecycleState[] = ['fresh_offseason', 'offseason', 'postseason'];
const TURNOVER_LEADER_LIFECYCLES: LifecycleState[] = ['fresh_offseason', 'offseason', 'postseason'];
const VOLATILITY_LIFECYCLES: LifecycleState[] = ['fresh_offseason', 'offseason', 'preseason'];
const NEVER_LAST_LIFECYCLES: LifecycleState[] = ['fresh_offseason', 'offseason', 'preseason'];
const TITLE_CHASER_LIFECYCLES: LifecycleState[] = [
  'fresh_offseason',
  'offseason',
  'late_season',
  'postseason',
  'preseason',
];
// INSIGHTS-022 — `offseason` included deliberately. The rookie benchmark is
// RETROSPECTIVE: it identifies owners whose first archived season is the most
// recent one, which is a fact about a COMPLETED season and does not decay when
// the fresh-offseason window closes. Omitting `offseason` made it disappear for
// the entire stretch between the fresh cutoff and preseason for no reason the
// data supports. The archived-roster suppression below is what actually keeps it
// honest, and it is unchanged.
const ROOKIE_LIFECYCLES: LifecycleState[] = ['fresh_offseason', 'offseason', 'preseason'];
const GREATEST_SEASON_LIFECYCLES: LifecycleState[] = [
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
];
const TRENDING_LIFECYCLES: LifecycleState[] = [
  'preseason',
  'fresh_offseason',
  'offseason',
  'early_season',
];

const MIN_CAREER_SEASONS = 2;
const MIN_VARIANCE_SEASONS = 3;
const MIN_FLOOR_SEASONS = 3;
const MIN_TOP3_FOR_CHASER = 2;
const MIN_GAMES_GREATEST_SEASON = 100;
const MIN_TRENDING_SEASONS = 3;
const POINTS_CLOSE_RATIO = 0.05;
const MIN_TURNOVER_MARGIN = 20;

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
}

/**
 * INSIGHTS-030 — the record clause, in the register the league's membership
 * state licenses.
 *
 * When membership is known we may speak about who is active. When it is only
 * last season's roster standing in, we may not — so the neutral form states both
 * figures and claims nothing about participation.
 */
function recordClause(
  holders: RecordHolder[],
  render: (value: number) => string
): { active: string; neutral: string } | null {
  if (holders.length === 0) return null;
  const names = formatOwnerList(holders.map((h) => h.owner));
  const figure = render(holders[0]!.value);
  return {
    active: ` — ${names}'s ${figure} still stands as the league record.`,
    neutral: `; ${names}'s ${figure} is the league record.`,
  };
}

function clauseFor(
  holders: RecordHolder[],
  render: (value: number) => string,
  known: boolean
): string {
  const clause = recordClause(holders, render);
  if (!clause) return '';
  return known ? clause.active : clause.neutral;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function toInsight(params: {
  id: string;
  type: Insight['type'];
  title: string;
  description: string;
  owner?: string;
  relatedOwners?: string[];
  priorityScore: number;
  lifecycle: LifecycleState[];
  newsHook: NewsHook;
  statValue: number;
}): Insight {
  const { owner, relatedOwners = [], priorityScore } = params;
  return {
    ...params,
    category: 'historical',
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

// Compute year-by-year cumulative points leader using archives only. Returns the
// owner who led in career points through end of prior season. Used to detect
// new_leader / returning_leader / extending_lead / narrowing_gap transitions.
function priorLeaderByPoints(
  context: InsightContext
): { owner: string; points: number; gap: number } | null {
  const NO_CLAIM = 'NoClaim';
  const archives = [...context.archives].sort((a, b) => a.year - b.year);
  if (archives.length < 2) return null;

  const cumulativePoints = new Map<string, number>();
  // Sum points through all archives EXCEPT the most recent one.
  for (let i = 0; i < archives.length - 1; i += 1) {
    const archive = archives[i]!;
    for (const row of archive.finalStandings) {
      if (!row.owner || row.owner === NO_CLAIM) continue;
      cumulativePoints.set(row.owner, (cumulativePoints.get(row.owner) ?? 0) + row.pointsFor);
    }
  }

  let leader: { owner: string; points: number } | null = null;
  let second = 0;
  for (const [owner, pts] of cumulativePoints) {
    if (!leader || pts > leader.points) {
      if (leader) second = Math.max(second, leader.points);
      leader = { owner, points: pts };
    } else if (pts > second) {
      second = pts;
    }
  }
  if (!leader) return null;
  return { owner: leader.owner, points: leader.points, gap: leader.points - second };
}

// Compute cumulative turnover margin leader through end of prior season.
function priorLeaderByTurnoverMargin(
  context: InsightContext,
  currentStats: OwnerCareerStats[]
): { owner: string; margin: number } | null {
  // Approximation: subtract this season's single-season stats from current career
  // totals for each owner that played this year.
  const active = context.leagueMembers;
  const currentYearStats = context.ownerGameStats ?? [];
  const currentByOwner = new Map(currentYearStats.map((s) => [s.owner, s]));

  let leader: { owner: string; margin: number } | null = null;
  for (const stats of currentStats) {
    if (!active.has(stats.owner)) continue;
    const thisYearMargin = currentByOwner.get(stats.owner)?.turnoverMargin ?? 0;
    const priorMargin = stats.totalTurnoverMargin - thisYearMargin;
    if (!leader || priorMargin > leader.margin) {
      leader = { owner: stats.owner, margin: priorMargin };
    }
  }
  return leader;
}

function activeCareerStats(context: InsightContext, minSeasons = 0): OwnerCareerStats[] {
  const active = context.leagueMembers;
  return context.ownerCareerStats.filter((s) => active.has(s.owner) && s.seasons >= minSeasons);
}

function tiedAtMax<T>(entries: T[], value: (t: T) => number): T[] {
  if (entries.length === 0) return [];
  const max = entries.reduce((m, e) => Math.max(m, value(e)), -Infinity);
  return entries.filter((e) => value(e) === max);
}

// === A. Career Points Leader ===

const POINT_MILESTONES = [5_000, 10_000, 15_000, 20_000, 25_000, 30_000];

function mostRecentMilestoneCrossed(
  current: number,
  prior: number,
  milestones: number[]
): number | null {
  for (let i = milestones.length - 1; i >= 0; i -= 1) {
    const m = milestones[i]!;
    if (current >= m && prior < m) return m;
  }
  return null;
}

function deriveCareerPointsLeader(context: InsightContext): Insight | null {
  const eligible = activeCareerStats(context, MIN_CAREER_SEASONS).filter((s) => s.totalPoints > 0);
  if (eligible.length === 0) return null;

  const tied = tiedAtMax(eligible, (s) => s.totalPoints).sort((a, b) =>
    a.owner.localeCompare(b.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const leaderPoints = tied[0]!.totalPoints;
  const ownerNames = tied.map((s) => s.owner);
  const leaderOwner = ownerNames[0]!;

  // INSIGHTS-030 — every "all-time" phrase below was measured against MEMBERS.
  // When the real leader has left, the copy crowned whoever remained.
  //
  // ONE eligibility filter, applied to everyone: the same `MIN_CAREER_SEASONS`
  // and points floor that `eligible` uses. Filtering the record population
  // differently from the naming list is what let a one-season CURRENT member be
  // cited as a departed record holder.
  const standing = resolveSuperlative({
    population: context.ownerCareerStats.filter(
      (s) => s.seasons >= MIN_CAREER_SEASONS && s.totalPoints > 0
    ),
    isMember: (s) => context.leagueMembers.has(s.owner),
    value: (s) => s.totalPoints,
    owner: (s) => s.owner,
  });
  const membersKnown = membershipIsKnown(context.leagueMembersSource);
  const others = eligible
    .filter((s) => !ownerNames.includes(s.owner))
    .sort((a, b) => b.totalPoints - a.totalPoints);
  const second = others[0] ?? null;
  const gap = second ? leaderPoints - second.totalPoints : leaderPoints;

  // Determine hook from archive data.
  const prior = priorLeaderByPoints(context);
  let hook: NewsHook = 'new_leader';
  if (tied.length === 1 && prior) {
    if (prior.owner === leaderOwner) {
      // Same leader as last year: extending_lead if gap grew, narrowing_gap if shrank.
      hook = gap >= prior.gap ? 'extending_lead' : 'narrowing_gap';
    } else {
      // Leader changed. Was this owner ever the leader previously?
      // Walk archives year-by-year to check.
      const archives = [...context.archives].sort((a, b) => a.year - b.year);
      const cumulative = new Map<string, number>();
      let wasLeader = false;
      for (const archive of archives) {
        for (const row of archive.finalStandings) {
          if (!row.owner || row.owner === 'NoClaim') continue;
          cumulative.set(row.owner, (cumulative.get(row.owner) ?? 0) + row.pointsFor);
        }
        let yearLeader: string | null = null;
        let best = -Infinity;
        for (const [o, p] of cumulative) {
          if (p > best) {
            best = p;
            yearLeader = o;
          }
        }
        if (yearLeader === leaderOwner) wasLeader = true;
      }
      hook = wasLeader ? 'returning_leader' : 'new_leader';
    }
  }

  // Milestone check takes priority if a round-number threshold was just crossed.
  if (tied.length === 1 && prior && prior.owner === leaderOwner) {
    const crossed = mostRecentMilestoneCrossed(leaderPoints, prior.points, POINT_MILESTONES);
    if (crossed) hook = 'milestone_crossed';
  }

  let description: string;
  const holders = standing && standing.standing !== 'holds' ? standing.recordHolders : [];
  const pointsClause = clauseFor(holders, formatNumber, membersKnown);
  if (standing?.standing === 'shares') {
    // Tied with someone outside the league. Neither "takes the all-time lead"
    // nor "someone beat you" is true, which is why `shares` is its own state.
    // ONE wording for both registers. The first version had a `membersKnown`
    // split whose known branch read "Alice share the all-time scoring lead" —
    // ungrammatical for a single owner — and matched none of the sweep's
    // allowlist because it phrased the shared state differently from the other
    // three sites. A shared record needs no membership register: naming both
    // holders as level asserts nothing about who is playing.
    const names = formatOwnerList(ownerNames);
    const withNames = formatOwnerList(holders.map((h) => h.owner));
    description = `${names} ${tied.length > 1 ? 'are' : 'is'} level with ${withNames} at ${formatNumber(leaderPoints)} career league points, the most in league history.`;
  } else if (pointsClause) {
    // The five movement hooks below all narrate the ALL-TIME race — "extends the
    // lead", "reclaims", "the closest it's ever been". Every one is false when
    // the all-time leader is not in this comparison, so this case gets ONE
    // sentence rather than a rephrasing of each.
    const names = tied.length > 1 ? formatOwnerList(ownerNames) : leaderOwner;
    const verb = tied.length > 1 ? 'lead' : 'leads';
    description = membersKnown
      ? `${names} ${verb} active owners with ${formatNumber(leaderPoints)} career league points${pointsClause}`
      : `${names} ${tied.length > 1 ? 'have' : 'has'} ${formatNumber(leaderPoints)} career league points${pointsClause}`;
  } else if (tied.length > 1) {
    description = `${formatOwnerList(ownerNames)} are tied for the all-time lead with ${formatNumber(leaderPoints)} career league points each.`;
  } else {
    switch (hook) {
      case 'extending_lead':
        description = second
          ? `${leaderOwner} is pulling away — ${formatNumber(gap)} career points clear of ${second.owner} in the all-time scoring race.`
          : `${leaderOwner} extends the all-time scoring lead with ${formatNumber(leaderPoints)} career league points.`;
        break;
      case 'narrowing_gap':
        if (second) {
          const ratio = gap / leaderPoints;
          description =
            ratio <= POINTS_CLOSE_RATIO
              ? `${second.owner} is closing in — just ${formatNumber(gap)} career points behind ${leaderOwner} in the all-time scoring race — the closest it's ever been.`
              : `${second.owner} is closing in — just ${formatNumber(gap)} career points behind ${leaderOwner} in the all-time scoring race.`;
        } else {
          description = `${leaderOwner} still leads all-time with ${formatNumber(leaderPoints)} career league points.`;
        }
        break;
      case 'returning_leader':
        description = `${leaderOwner} reclaims the all-time scoring lead with ${formatNumber(leaderPoints)} career points.`;
        break;
      case 'milestone_crossed':
        description = `${leaderOwner} crosses ${formatNumber(leaderPoints)} career league points — leading the all-time scoring race.`;
        break;
      case 'new_leader':
      default:
        description = `${leaderOwner} takes the all-time scoring lead with ${formatNumber(leaderPoints)} career points.`;
        break;
    }
  }

  return toInsight({
    id: `career-points-leader-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'career_points_leader',
    // The TITLE follows the standing. It is rendered directly above the
    // description on the Overview card, so a static "Career points leader" over
    // a body that says Dave holds the record had the headline re-asserting the
    // exact claim the body retracts.
    title: standing?.standing === 'holds' ? 'Career points leader' : 'Career points',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 70,
    lifecycle: POINTS_LEADER_LIFECYCLES,
    newsHook: hook,
    statValue: leaderPoints,
  });
}

// === B. Career Turnover Margin Leader ===

const CHALLENGER_RATIO = 0.2;

function deriveCareerTurnoverMarginLeader(context: InsightContext): Insight | null {
  const eligible = activeCareerStats(context, MIN_CAREER_SEASONS).filter(
    (s) => s.totalTurnoverMargin >= MIN_TURNOVER_MARGIN
  );
  if (eligible.length === 0) return null;

  const tied = tiedAtMax(eligible, (s) => s.totalTurnoverMargin).sort((a, b) =>
    a.owner.localeCompare(b.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const leaderMargin = tied[0]!.totalTurnoverMargin;
  const marginText = leaderMargin > 0 ? `+${leaderMargin}` : String(leaderMargin);
  const ownerNames = tied.map((s) => s.owner);
  const leaderOwner = ownerNames[0]!;

  // INSIGHTS-030 — NOT FIXED HERE, deliberately, and this comment is the record
  // of why. `career:turnover_margin` carries the same defect as the four sites
  // this slice does fix: "the largest career turnover margin on record" is
  // measured against members only.
  //
  // It is omitted because it cannot be covered. `totalTurnoverMargin`
  // accumulates from cached game-stats partitions gated behind archive slate
  // provenance — a different subsystem from the archives the other four read —
  // so reaching it needs a fixture this slice does not otherwise require.
  // AGENTS.md → Scope and sizing gives two options for a surface a PR touches,
  // cover it or omit it, and a version of this file shipped a third: a test
  // wrapped in `if (margin)` that passed on a null every time. Omitting leaves
  // the claim exactly as `main` already has it. Filed in docs/next-tasks.md.
  const others = eligible
    .filter((s) => !ownerNames.includes(s.owner))
    .sort((a, b) => b.totalTurnoverMargin - a.totalTurnoverMargin);
  const second = others[0] ?? null;
  const gap = second ? leaderMargin - second.totalTurnoverMargin : leaderMargin;

  const prior = priorLeaderByTurnoverMargin(context, eligible);
  let hook: NewsHook = 'new_leader';
  if (tied.length === 1 && prior) {
    if (prior.owner === leaderOwner) {
      hook = leaderMargin >= prior.margin ? 'extending_lead' : 'narrowing_gap';
      if (
        second &&
        leaderMargin > 0 &&
        gap / Math.max(1, leaderMargin) <= CHALLENGER_RATIO &&
        hook !== 'narrowing_gap'
      ) {
        hook = 'challenger_emerging';
      }
    } else {
      hook = 'new_leader';
    }
  }

  let description: string;
  if (tied.length > 1) {
    description = `${formatOwnerList(ownerNames)} share the largest career turnover margin on record at ${marginText}.`;
  } else {
    switch (hook) {
      case 'extending_lead':
        description = second
          ? `${leaderOwner}'s career turnover margin lead grows to ${marginText} — ${gap} ahead of ${second.owner}.`
          : `${leaderOwner}'s ${marginText} career turnover margin is the largest on record.`;
        break;
      case 'narrowing_gap':
        description = second
          ? `${second.owner} is closing in on ${leaderOwner}'s career turnover margin lead — now just ${gap} apart.`
          : `${leaderOwner}'s ${marginText} career turnover margin is the largest on record.`;
        break;
      case 'challenger_emerging': {
        const secondMargin =
          second && second.totalTurnoverMargin > 0
            ? `+${second.totalTurnoverMargin}`
            : String(second?.totalTurnoverMargin ?? 0);
        description = `${leaderOwner} leads career turnover margin at ${marginText} but ${second?.owner ?? ''} (${secondMargin}) is within striking distance.`;
        break;
      }
      case 'new_leader':
      default:
        description = `${leaderOwner} takes over the career turnover margin lead at ${marginText}.`;
        break;
    }
  }

  return toInsight({
    id: `career-turnover-margin-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'career_turnover_margin',
    title: 'Career turnover margin leader',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 68,
    lifecycle: TURNOVER_LEADER_LIFECYCLES,
    newsHook: hook,
    statValue: leaderMargin,
  });
}

// === C. Volatility Award (playful) ===

function deriveVolatilityAward(context: InsightContext): Insight | null {
  const eligible = activeCareerStats(context, MIN_VARIANCE_SEASONS);
  if (eligible.length === 0) return null;

  type Entry = { stats: OwnerCareerStats; range: number; best: number; worst: number };
  const entries: Entry[] = eligible
    .map((stats) => {
      const ranks = stats.finishHistory.map((f) => f.rank);
      if (ranks.length < MIN_VARIANCE_SEASONS) return null;
      const best = Math.min(...ranks);
      const worst = Math.max(...ranks);
      return { stats, range: worst - best, best, worst } as Entry;
    })
    .filter((e): e is Entry => e !== null && e.range > 0);

  if (entries.length === 0) return null;

  const tied = tiedAtMax(entries, (e) => e.range).sort((a, b) =>
    a.stats.owner.localeCompare(b.stats.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner);

  // Max range across ALL owners (including non-active) for record determination.
  let allTimeMaxRange = 0;
  for (const stats of context.ownerCareerStats) {
    const ranks = stats.finishHistory.map((f) => f.rank);
    if (ranks.length < MIN_VARIANCE_SEASONS) continue;
    const range = Math.max(...ranks) - Math.min(...ranks);
    if (range > allTimeMaxRange) allTimeMaxRange = range;
  }
  const leaderRange = tied[0]!.range;
  const hook: NewsHook = leaderRange >= allTimeMaxRange ? 'new_record' : 'snapshot';

  let description: string;
  if (tied.length === 1) {
    const only = tied[0]!;
    const sortedFinishes = [...only.stats.finishHistory].sort((a, b) => a.year - b.year);
    const rankList = sortedFinishes.map((f) => ordinal(f.rank)).join(', ');
    description =
      hook === 'new_record'
        ? `${only.stats.owner} has finished ${rankList} — nobody swings harder year to year.`
        : `${only.stats.owner} has finished ${rankList} — pick a lane.`;
  } else {
    const parts = tied.map(
      (e) =>
        `${e.stats.owner} swings from ${ordinal(e.best)} to ${ordinal(e.worst)} across ${e.stats.seasons} seasons`
    );
    description = `${parts.join('; ')}.`;
  }

  return toInsight({
    id: `volatility-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'volatility',
    title: 'Volatility award',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 65,
    lifecycle: VOLATILITY_LIFECYCLES,
    newsHook: hook,
    statValue: leaderRange,
  });
}

// === D. Never Finished Last ===

function deriveNeverFinishedLast(context: InsightContext): Insight | null {
  const fieldSizesByYear: Record<number, number> = {};
  for (const archive of context.archives) {
    fieldSizesByYear[archive.year] = archive.finalStandings.filter(
      (row) => row.owner && row.owner !== NO_CLAIM_OWNER
    ).length;
  }

  const eligible = activeCareerStats(context, MIN_FLOOR_SEASONS);
  type Entry = { stats: OwnerCareerStats; worstRank: number };
  const entries: Entry[] = [];

  for (const stats of eligible) {
    if (stats.finishHistory.length < MIN_FLOOR_SEASONS) continue;
    let qualifies = true;
    let worstRank = 0;
    for (const f of stats.finishHistory) {
      const fieldSize = fieldSizesByYear[f.year];
      if (!fieldSize) continue;
      // "Bottom 3" = last three positions in the field
      if (f.rank > fieldSize - 3) {
        qualifies = false;
        break;
      }
      if (f.rank > worstRank) worstRank = f.rank;
    }
    if (qualifies && worstRank > 0) entries.push({ stats, worstRank });
  }

  if (entries.length === 0) return null;

  // Prefer the owner with the lowest worstRank (deepest floor = highest quality).
  entries.sort((a, b) => a.worstRank - b.worstRank || a.stats.owner.localeCompare(b.stats.owner));
  const bestWorstRank = entries[0]!.worstRank;
  const tied = entries.filter((e) => e.worstRank === bestWorstRank);
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner);
  const worstX = tied[0]!.worstRank;
  const seasons = tied[0]!.stats.seasons;
  const seasonsText = tied.length === 1 ? `${seasons} seasons` : 'their league history';
  const verb = tied.length === 1 ? 'has' : 'have each';

  // Hook: streak_extended if just added another qualifying season, else snapshot.
  const latestArchiveYear = context.archives.map((a) => a.year).reduce((m, y) => Math.max(m, y), 0);
  const justAddedSeason = tied[0]!.stats.finishHistory.some((f) => f.year === latestArchiveYear);
  const hook: NewsHook = justAddedSeason ? 'streak_extended' : 'snapshot';

  const description =
    hook === 'streak_extended'
      ? `${formatOwnerList(ownerNames)} ${verb} never finished outside the top ${worstX} — ${seasonsText} and counting.`
      : `${formatOwnerList(ownerNames)} ${verb} never finished in the bottom three in ${seasonsText}.`;

  return toInsight({
    id: `never-last-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'never_last',
    title: 'Never finished last',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 60,
    lifecycle: NEVER_LAST_LIFECYCLES,
    newsHook: hook,
    statValue: seasons,
  });
}

// === E. Title Chaser / Bridesmaid (playful) ===

function deriveTitleChaser(context: InsightContext): Insight | null {
  const eligible = activeCareerStats(context).filter((s) => s.titles === 0);
  type Entry = { stats: OwnerCareerStats; top3Count: number };
  const entries: Entry[] = eligible
    .map((stats) => ({
      stats,
      top3Count: stats.finishHistory.filter((f) => f.rank <= 3).length,
    }))
    .filter((e) => e.top3Count >= MIN_TOP3_FOR_CHASER);

  if (entries.length === 0) return null;

  const tied = tiedAtMax(entries, (e) => e.top3Count).sort((a, b) =>
    a.stats.owner.localeCompare(b.stats.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner);
  const top3Count = tied[0]!.top3Count;

  // Hook: streak_extended if just added a top-3 this most recent archive year.
  const latestArchiveYear = context.archives.map((a) => a.year).reduce((m, y) => Math.max(m, y), 0);
  const justAddedTop3 = tied[0]!.stats.finishHistory.some(
    (f) => f.year === latestArchiveYear && f.rank <= 3
  );
  const hook: NewsHook = justAddedTop3 ? 'streak_extended' : 'never_won';

  let description: string;
  if (hook === 'streak_extended') {
    description =
      tied.length === 1
        ? `${ownerNames[0]} adds another top-3 finish — now ${top3Count} podiums with zero titles.`
        : `${formatOwnerList(ownerNames)} each add another top-3 — now ${top3Count} podiums apiece with zero titles.`;
  } else if (tied.length === 1) {
    description =
      top3Count >= 3
        ? `${ownerNames[0]} owns ${top3Count} top-3 finishes but zero titles — the trophy case is immaculate. And empty.`
        : `${ownerNames[0]} owns ${top3Count} top-3 finishes but zero titles — always the runner-up, never the winner.`;
  } else {
    description = `${formatOwnerList(ownerNames)} have each finished top-3 ${top3Count} times without a ring — the league's reigning bridesmaids.`;
  }

  return toInsight({
    id: `title-chaser-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'title_chaser',
    title: 'Title chaser',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 75,
    lifecycle: TITLE_CHASER_LIFECYCLES,
    newsHook: hook,
    statValue: top3Count,
  });
}

// === F. Rookie Owner Benchmark ===

function deriveRookieBenchmark(context: InsightContext): Insight | null {
  const active = context.leagueMembers;
  const rookies = context.ownerCareerStats.filter(
    (s) => active.has(s.owner) && s.isRookie && s.finishHistory.length >= 1
  );
  if (rookies.length === 0) return null;

  // Build distribution of all historical debut ranks (first appearance for every owner in archives).
  const debutRanks: number[] = [];
  const firstSeen = new Set<string>();
  const sortedArchives = [...context.archives].sort((a, b) => a.year - b.year);
  for (const archive of sortedArchives) {
    for (let i = 0; i < archive.finalStandings.length; i++) {
      const row = archive.finalStandings[i]!;
      if (!row.owner || row.owner === NO_CLAIM_OWNER) continue;
      if (firstSeen.has(row.owner)) continue;
      firstSeen.add(row.owner);
      debutRanks.push(i + 1);
    }
  }

  const sortedRookies = rookies
    .map((stats) => {
      const debut = [...stats.finishHistory].sort((a, b) => a.year - b.year)[0]!;
      return { stats, debutRank: debut.rank, debutYear: debut.year };
    })
    .sort((a, b) => a.debutRank - b.debutRank || a.stats.owner.localeCompare(b.stats.owner));

  const best = sortedRookies[0]!;

  // Qualitative framing: top quartile of debuts is "strongest", top half is "solid".
  const below = debutRanks.filter((r) => r > best.debutRank).length;
  const percentile = debutRanks.length > 0 ? below / debutRanks.length : 0;
  let framing: string;
  if (percentile >= 0.75) framing = 'one of the strongest debuts in league history';
  else if (percentile >= 0.5) framing = 'a solid showing relative to prior debuts';
  else framing = 'a tough introduction to the league';

  const description = `${best.stats.owner} finished ${ordinal(best.debutRank)} as a rookie in ${best.debutYear} — ${framing}.`;

  return toInsight({
    id: `rookie-benchmark-${ownerSlug(best.stats.owner)}-${best.debutYear}`,
    type: 'rookie_benchmark',
    title: 'Rookie owner benchmark',
    description,
    owner: best.stats.owner,
    priorityScore: 65,
    lifecycle: ROOKIE_LIFECYCLES,
    newsHook: 'new_record',
    statValue: best.debutRank,
  });
}

// === G. Greatest Single Season ===

function deriveGreatestSingleSeason(context: InsightContext): Insight | null {
  type Candidate = { owner: string; year: number; winPct: number; games: number };
  const candidates: Candidate[] = [];
  const activeOwners = context.leagueMembers;

  // INSIGHTS-030 — `population` collects the SAME rows without the membership
  // filter, so "the best single-season performance on record" is measured
  // against every season anyone ever played.
  const population: Candidate[] = [];
  for (const archive of context.archives) {
    for (const row of archive.finalStandings) {
      if (!row.owner || row.owner === NO_CLAIM_OWNER) continue;
      const games = row.wins + row.losses + row.ties;
      if (games < MIN_GAMES_GREATEST_SEASON) continue;
      const winPct = games > 0 ? row.wins / games : 0;
      const candidate = { owner: row.owner, year: archive.year, winPct, games };
      population.push(candidate);
      if (activeOwners.has(row.owner)) candidates.push(candidate);
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => b.winPct - a.winPct || b.year - a.year || a.owner.localeCompare(b.owner)
  );
  const best = candidates[0]!;

  const winRate = (pct: number): string =>
    `.${Math.round(pct * 1000)
      .toString()
      .padStart(3, '0')}`;
  const displayedRate = (pct: number): number => Math.round(pct * 1000);

  // Compared on the DISPLAYED rate, not the raw one. .859504 and .860000 both
  // print `.860`, and comparing raw values produced "Alice's .860 … Dave's .860
  // remains the league record" — two identical figures, one said to beat the
  // other.
  const seasonStanding = resolveSuperlative({
    population,
    isMember: (c) => activeOwners.has(c.owner),
    value: (c) => c.winPct,
    owner: (c) => c.owner,
    compareOn: (c) => displayedRate(c.winPct),
  });
  const seasonKnown = membershipIsKnown(context.leagueMembersSource);
  // From `recordHolders`, and NOT gated on `trails`. Gating it there left the
  // `shares` state falling through to the untouched "remains the best
  // single-season performance on record" — the very defect this module documents
  // — and because the comparison is on the DISPLAYED rate, a departed owner with
  // a strictly higher raw rate that rounds the same took a member with it.
  const recordSeasons = seasonStanding?.recordHolders.map((h) => h.entry) ?? [];
  const recordSeason = recordSeasons[0] ?? null;
  const seasonShares = seasonStanding?.standing === 'shares';
  // All of them. Four owners level at .727 read as a two-way tie.
  const recordSeasonText = formatOwnerList(recordSeasons.map((c) => `${c.owner}'s ${c.year}`));

  const bestSeason = `${best.owner}'s ${best.year} season (${winRate(best.winPct)} win rate across ${best.games} games)`;
  const description = !recordSeason
    ? `${bestSeason} remains the best single-season performance on record.`
    : seasonShares
      ? `${bestSeason} is level with ${recordSeasonText} as the best single-season performance in league history.`
      : seasonKnown
        ? `${bestSeason} is the best by any active owner — ${recordSeasonText} at ${winRate(recordSeason.winPct)} remains the league record.`
        : `${bestSeason}; ${recordSeasonText} at ${winRate(recordSeason.winPct)} is the league record.`;

  return toInsight({
    id: `greatest-season-${ownerSlug(best.owner)}-${best.year}`,
    type: 'greatest_season',
    title: seasonStanding?.standing === 'holds' ? 'Greatest single season' : 'Standout season',
    description,
    owner: best.owner,
    priorityScore: 62,
    lifecycle: GREATEST_SEASON_LIFECYCLES,
    newsHook: 'snapshot',
    statValue: Math.round(best.winPct * 1000),
  });
}

// === H. Trending Up / Trending Down ===

function renderFinishArrow(finishes: { year: number; rank: number }[]): string {
  return finishes
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((f) => ordinal(f.rank))
    .join(' → ');
}

/**
 * Qualifies as a trend only when every adjacent transition across the owner's
 * full finishHistory is consistent with `direction`: non-increasing ranks for
 * 'up', non-decreasing ranks for 'down'. A history containing any reversal
 * (e.g. 4th → 9th → 5th → 3rd) does not qualify.
 */
function deriveTrending(context: InsightContext, direction: 'up' | 'down'): Insight | null {
  const eligible = activeCareerStats(context, MIN_TRENDING_SEASONS);
  type Entry = {
    stats: OwnerCareerStats;
    history: { year: number; rank: number }[];
    netChange: number;
  };

  // INSIGHTS-023a — "the steepest decline in league history" has to be judged
  // against league history, not against the current roster.
  //
  // This generator runs in PRESEASON, which is exactly where this slice changed
  // membership: before it, the preseason population was the borrowed last-season
  // roster and a departed record-holder was still in the comparison. Narrowing
  // to members promoted the best remaining owner and kept the superlative
  // wording, which is false. Same defect the slice fixed in `volatility` and
  // `milestones` — applied here too, rather than to the two sites a reviewer
  // happened to name.
  const buildEntry = (stats: OwnerCareerStats): Entry | null => {
    const history = [...stats.finishHistory].sort((a, b) => a.year - b.year);
    if (history.length < MIN_TRENDING_SEASONS) return null;

    let consistent = true;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]!.rank;
      const curr = history[i]!.rank;
      if (direction === 'up' && curr > prev) {
        consistent = false;
        break;
      }
      if (direction === 'down' && curr < prev) {
        consistent = false;
        break;
      }
    }
    if (!consistent) return null;

    const netChange = history[history.length - 1]!.rank - history[0]!.rank;
    if (netChange === 0) return null;

    return { stats, history, netChange } as Entry;
  };

  const entries: Entry[] = eligible.map(buildEntry).filter((e): e is Entry => e !== null);

  if (entries.length === 0) return null;

  // The record across EVERY owner in league history, members or not.
  const allEntries: Entry[] = context.ownerCareerStats
    .map(buildEntry)
    .filter((e): e is Entry => e !== null);
  // Seeded at 0 in BOTH directions, which is correct rather than an unfinished
  // edit — it was written as `direction === 'up' ? 0 : 0`, a no-op ternary that
  // read like a mistake. `buildEntry` rejects `netChange === 0`, so up-entries
  // are strictly negative and down-entries strictly positive, and 0 is the
  // identity for `min` and `max` respectively. If that guard is ever relaxed,
  // this seed pins `recordChange` at 0 and `holdsRecord` goes wrong.
  const recordChange = allEntries.reduce(
    (acc, e) => (direction === 'up' ? Math.min(acc, e.netChange) : Math.max(acc, e.netChange)),
    0
  );

  // Sort by magnitude of net change: trending up wants most negative netChange
  // (largest improvement); trending down wants most positive netChange.
  entries.sort((a, b) =>
    direction === 'up' ? a.netChange - b.netChange : b.netChange - a.netChange
  );
  const best = entries[0]!;
  const targetChange = best.netChange;
  const tied = entries.filter((e) => e.netChange === targetChange);
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner).sort((a, b) => a.localeCompare(b));
  const arrow = renderFinishArrow(best.history);
  const span = best.history.length;

  // The superlative fires ONLY when this member actually holds the league record.
  // When a departed owner's run was steeper, the copy states the run without
  // claiming a record — the fact is still worth saying, the ranking is not ours
  // to assert.
  const holdsRecord = targetChange === recordChange;

  let description: string;
  if (direction === 'up') {
    description =
      tied.length === 1
        ? holdsRecord
          ? `${best.stats.owner} has climbed from ${arrow} — the league's steadiest ascent.`
          : `${best.stats.owner} has climbed from ${arrow}, improving every season.`
        : `${formatOwnerList(ownerNames)} have each climbed the standings every season over ${span} seasons.`;
  } else {
    description =
      tied.length === 1
        ? holdsRecord
          ? `${best.stats.owner} has fallen from ${arrow} — the steepest decline in league history.`
          : `${best.stats.owner} has fallen from ${arrow}, slipping every season.`
        : `${formatOwnerList(ownerNames)} have each slipped every season over ${span} seasons.`;
  }

  return toInsight({
    id: `trending-${direction}-${ownerNames.map(ownerSlug).join('-')}`,
    type: direction === 'up' ? 'trending_up' : 'trending_down',
    title: direction === 'up' ? 'Trending up' : 'Trending down',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: direction === 'up' ? 70 : 68,
    lifecycle: TRENDING_LIFECYCLES,
    newsHook: 'streak_extended',
    statValue: Math.abs(targetChange),
  });
}

// === Generator registrations ===

export const careerPointsLeaderGenerator: InsightGenerator = {
  id: 'career:points_leader',
  category: 'historical',
  supportedLifecycles: POINTS_LEADER_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insight = deriveCareerPointsLeader(context);
    return insight ? [insight] : [];
  },
};

export const careerTurnoverMarginGenerator: InsightGenerator = {
  id: 'career:turnover_margin',
  category: 'historical',
  supportedLifecycles: TURNOVER_LEADER_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insight = deriveCareerTurnoverMarginLeader(context);
    return insight ? [insight] : [];
  },
};

export const volatilityGenerator: InsightGenerator = {
  id: 'career:volatility',
  category: 'historical',
  supportedLifecycles: VOLATILITY_LIFECYCLES,
  tone: 'playful',
  generate(context) {
    const insight = deriveVolatilityAward(context);
    if (!insight) return [];
    // INSIGHTS-022 — no returning-owner framing. A borrowed prior-season roster
    // proves someone PLAYED, never that they will play again, so calling them a
    // "returning owner" asserted a future fact from past data. The neutral
    // description already says what is true: this is their historical record.
    return [insight];
  },
};

export const neverFinishedLastGenerator: InsightGenerator = {
  id: 'career:never_last',
  category: 'historical',
  supportedLifecycles: NEVER_LAST_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insight = deriveNeverFinishedLast(context);
    if (!insight) return [];
    // INSIGHTS-022 — see `volatilityGenerator`: no returning-owner framing.
    return [insight];
  },
};

export const titleChaserGenerator: InsightGenerator = {
  id: 'career:title_chaser',
  category: 'historical',
  supportedLifecycles: TITLE_CHASER_LIFECYCLES,
  tone: 'playful',
  generate(context) {
    const insight = deriveTitleChaser(context);
    if (!insight) return [];
    // INSIGHTS-022 — see `volatilityGenerator`: no returning-owner framing.
    return [insight];
  },
};

export const rookieBenchmarkGenerator: InsightGenerator = {
  id: 'career:rookie_benchmark',
  category: 'historical',
  supportedLifecycles: ROOKIE_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    // Engine-level suppression already filters this out when usingArchivedRoster
    // is set (rookie detection on a borrowed roster is wrong); the duplicate
    // guard here keeps the generator safe if invoked directly.
    //
    // INSIGHTS-022 kept this. Widening the lifecycle list is what makes the card
    // visible in ordinary offseason, and it needs no help from here: `league.year`
    // stays on the COMPLETED season through offseason and that season's owners CSV
    // is never deleted, so `usingArchivedRoster` is FALSE for that whole stretch
    // and this guard does not fire. It fires in preseason, which is what
    // AGENTS.md invariant 5 requires — there is no valid framing for a
    // first-archive-owner comparison drawn from a borrowed roster.
    if (context.usingArchivedRoster) return [];
    const insight = deriveRookieBenchmark(context);
    return insight ? [insight] : [];
  },
};

export const greatestSingleSeasonGenerator: InsightGenerator = {
  id: 'career:greatest_season',
  category: 'historical',
  supportedLifecycles: GREATEST_SEASON_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insight = deriveGreatestSingleSeason(context);
    return insight ? [insight] : [];
  },
};

export const trendingGenerator: InsightGenerator = {
  id: 'career:trending',
  category: 'historical',
  supportedLifecycles: TRENDING_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insights: Insight[] = [];
    const up = deriveTrending(context, 'up');
    if (up) insights.push(up);
    const down = deriveTrending(context, 'down');
    if (down) insights.push(down);
    // INSIGHTS-022 — no returning-owner framing. Trending was ALWAYS eligible in
    // ordinary offseason (`TRENDING_LIFECYCLES` includes it); only the framing was
    // lifecycle-gated. The backlog claim that this content "went dark" was wrong.
    return insights;
  },
};

registerGenerator(careerPointsLeaderGenerator);
registerGenerator(careerTurnoverMarginGenerator);
registerGenerator(volatilityGenerator);
registerGenerator(neverFinishedLastGenerator);
registerGenerator(titleChaserGenerator);
registerGenerator(rookieBenchmarkGenerator);
registerGenerator(greatestSingleSeasonGenerator);
registerGenerator(trendingGenerator);
