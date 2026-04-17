import type { Insight } from '../../selectors/insights';
import { registerGenerator } from '../engine';
import type { InsightContext, InsightGenerator, LifecycleState, OwnerCareerStats } from '../types';

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
const ROOKIE_LIFECYCLES: LifecycleState[] = ['fresh_offseason', 'preseason'];
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

function activeOwnerSet(currentRoster: Map<string, string>): Set<string> {
  const set = new Set(currentRoster.values());
  set.delete(NO_CLAIM_OWNER);
  return set;
}

function formatOwnerList(owners: string[]): string {
  if (owners.length === 0) return '';
  if (owners.length === 1) return owners[0]!;
  if (owners.length === 2) return `${owners[0]} and ${owners[1]}`;
  return `${owners.slice(0, -1).join(', ')}, and ${owners[owners.length - 1]}`;
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
}): Insight {
  const { owner, relatedOwners = [], priorityScore } = params;
  return {
    ...params,
    category: 'historical',
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

function activeCareerStats(context: InsightContext, minSeasons = 0): OwnerCareerStats[] {
  const active = activeOwnerSet(context.currentRoster);
  return context.ownerCareerStats.filter((s) => active.has(s.owner) && s.seasons >= minSeasons);
}

function tiedAtMax<T>(entries: T[], value: (t: T) => number): T[] {
  if (entries.length === 0) return [];
  const max = entries.reduce((m, e) => Math.max(m, value(e)), -Infinity);
  return entries.filter((e) => value(e) === max);
}

// === A. Career Points Leader ===

function deriveCareerPointsLeader(context: InsightContext): Insight | null {
  const eligible = activeCareerStats(context, MIN_CAREER_SEASONS).filter((s) => s.totalPoints > 0);
  if (eligible.length === 0) return null;

  const tied = tiedAtMax(eligible, (s) => s.totalPoints).sort((a, b) =>
    a.owner.localeCompare(b.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const leaderPoints = tied[0]!.totalPoints;
  const ownerNames = tied.map((s) => s.owner);

  let description: string;
  if (tied.length === 1) {
    const leader = tied[0]!;
    const others = eligible
      .filter((s) => s.owner !== leader.owner)
      .sort((a, b) => b.totalPoints - a.totalPoints);
    const second = others[0];
    if (second) {
      const gap = leader.totalPoints - second.totalPoints;
      const ratio = gap / leader.totalPoints;
      if (ratio <= POINTS_CLOSE_RATIO && gap > 0) {
        description = `${leader.owner} leads ${second.owner} ${formatNumber(leader.totalPoints)} to ${formatNumber(second.totalPoints)} in the all-time scoring race — the closest it's ever been.`;
      } else {
        description = `${leader.owner} leads all-time with ${formatNumber(leader.totalPoints)} career league points — ${formatNumber(gap)} ahead of ${second.owner}.`;
      }
    } else {
      description = `${leader.owner} leads all-time with ${formatNumber(leader.totalPoints)} career league points.`;
    }
  } else {
    description = `${formatOwnerList(ownerNames)} are tied for the all-time lead with ${formatNumber(leaderPoints)} career league points each.`;
  }

  return toInsight({
    id: `career-points-leader-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'career_points_leader',
    title: 'Career points leader',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 70,
    lifecycle: POINTS_LEADER_LIFECYCLES,
  });
}

// === B. Career Turnover Margin Leader ===

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

  let description: string;
  if (tied.length === 1) {
    const leader = tied[0]!;
    const others = eligible
      .filter((s) => s.owner !== leader.owner)
      .sort((a, b) => b.totalTurnoverMargin - a.totalTurnoverMargin);
    const second = others[0];
    if (second) {
      const gap = leader.totalTurnoverMargin - second.totalTurnoverMargin;
      description = `${leader.owner}'s ${marginText} career turnover margin is the largest on record — ${gap} ahead of ${second.owner}.`;
    } else {
      description = `${leader.owner}'s ${marginText} career turnover margin is the largest on record.`;
    }
  } else {
    description = `${formatOwnerList(ownerNames)} share the largest career turnover margin on record at ${marginText}.`;
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

  let description: string;
  if (tied.length === 1) {
    const only = tied[0]!;
    const sortedFinishes = [...only.stats.finishHistory].sort((a, b) => a.year - b.year);
    const rankList = sortedFinishes.map((f) => ordinal(f.rank)).join(', ');
    description = `${only.stats.owner} has finished ${rankList} — pick a lane.`;
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
  const seasonsText =
    tied.length === 1 ? `${tied[0]!.stats.seasons} seasons` : 'their league history';
  const verb = tied.length === 1 ? 'has' : 'have each';

  const description = `${formatOwnerList(ownerNames)} ${verb} never finished outside the top ${worstX} in ${seasonsText} — the league's most reliable floor.`;

  return toInsight({
    id: `never-last-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'never_last',
    title: 'Never finished last',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 60,
    lifecycle: NEVER_LAST_LIFECYCLES,
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

  let description: string;
  if (tied.length === 1) {
    description = `${ownerNames[0]} owns ${top3Count} top-3 finishes but zero titles — the trophy case is immaculate. And empty.`;
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
  });
}

// === F. Rookie Owner Benchmark ===

function deriveRookieBenchmark(context: InsightContext): Insight | null {
  const active = activeOwnerSet(context.currentRoster);
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
  });
}

// === G. Greatest Single Season ===

function deriveGreatestSingleSeason(context: InsightContext): Insight | null {
  type Candidate = { owner: string; year: number; winPct: number; games: number };
  const candidates: Candidate[] = [];
  const activeOwners = activeOwnerSet(context.currentRoster);

  for (const archive of context.archives) {
    for (const row of archive.finalStandings) {
      if (!row.owner || row.owner === NO_CLAIM_OWNER) continue;
      if (!activeOwners.has(row.owner)) continue;
      const games = row.wins + row.losses + row.ties;
      if (games < MIN_GAMES_GREATEST_SEASON) continue;
      const winPct = games > 0 ? row.wins / games : 0;
      candidates.push({ owner: row.owner, year: archive.year, winPct, games });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => b.winPct - a.winPct || b.year - a.year || a.owner.localeCompare(b.owner)
  );
  const best = candidates[0]!;

  const description = `${best.owner}'s ${best.year} season (.${Math.round(best.winPct * 1000)
    .toString()
    .padStart(
      3,
      '0'
    )} win rate across ${best.games} games) remains the best single-season performance on record.`;

  return toInsight({
    id: `greatest-season-${ownerSlug(best.owner)}-${best.year}`,
    type: 'greatest_season',
    title: 'Greatest single season',
    description,
    owner: best.owner,
    priorityScore: 62,
    lifecycle: GREATEST_SEASON_LIFECYCLES,
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
  const entries: Entry[] = eligible
    .map((stats) => {
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
    })
    .filter((e): e is Entry => e !== null);

  if (entries.length === 0) return null;

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

  let description: string;
  if (direction === 'up') {
    description =
      tied.length === 1
        ? `${best.stats.owner} has climbed from ${arrow} — the league's steadiest ascent.`
        : `${formatOwnerList(ownerNames)} have each climbed the standings every season over ${span} seasons.`;
  } else {
    description =
      tied.length === 1
        ? `${best.stats.owner} has fallen from ${arrow} — the steepest decline in league history.`
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
    return insight ? [insight] : [];
  },
};

export const neverFinishedLastGenerator: InsightGenerator = {
  id: 'career:never_last',
  category: 'historical',
  supportedLifecycles: NEVER_LAST_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insight = deriveNeverFinishedLast(context);
    return insight ? [insight] : [];
  },
};

export const titleChaserGenerator: InsightGenerator = {
  id: 'career:title_chaser',
  category: 'historical',
  supportedLifecycles: TITLE_CHASER_LIFECYCLES,
  tone: 'playful',
  generate(context) {
    const insight = deriveTitleChaser(context);
    return insight ? [insight] : [];
  },
};

export const rookieBenchmarkGenerator: InsightGenerator = {
  id: 'career:rookie_benchmark',
  category: 'historical',
  supportedLifecycles: ROOKIE_LIFECYCLES,
  tone: 'factual',
  generate(context) {
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
