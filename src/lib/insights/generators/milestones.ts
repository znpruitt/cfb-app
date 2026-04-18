import type { Insight } from '../../selectors/insights';
import { registerGenerator } from '../engine';
import type {
  InsightContext,
  InsightGenerator,
  LifecycleState,
  NewsHook,
  OwnerCareerStats,
} from '../types';
import { collectHeadToHead, type HeadToHeadResult } from './rivalry';

const NO_CLAIM_OWNER = 'NoClaim';
const TIE_SUPPRESSION_THRESHOLD = 4;

const EVERGREEN_LIFECYCLES: LifecycleState[] = [
  'preseason',
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
];

const WIN_MILESTONES = [100, 200, 300, 400, 500];
const POINT_MILESTONES = [5_000, 10_000, 15_000, 20_000, 25_000];
const APPROACHING_THRESHOLD = 0.9;
const JUST_CROSSED_THRESHOLD = 1.05;
const MIN_PERFECT_MEETINGS = 5;

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
}

function activeOwnerSet(currentRoster: Map<string, string>): Set<string> {
  const set = new Set(currentRoster.values());
  set.delete(NO_CLAIM_OWNER);
  return set;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
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

type MilestoneEvent = {
  owner: string;
  current: number;
  milestone: number;
  status: 'approaching' | 'just_crossed';
  kind: 'wins' | 'points';
  isFirst: boolean;
};

function evaluateMilestones(
  ownerStats: OwnerCareerStats[],
  milestones: number[],
  value: (s: OwnerCareerStats) => number,
  kind: 'wins' | 'points'
): MilestoneEvent[] {
  const events: MilestoneEvent[] = [];
  for (const stats of ownerStats) {
    const current = value(stats);
    for (const milestone of milestones) {
      const ratio = current / milestone;
      if (ratio >= APPROACHING_THRESHOLD && ratio < 1) {
        events.push({
          owner: stats.owner,
          current,
          milestone,
          status: 'approaching',
          kind,
          isFirst: false,
        });
      } else if (ratio >= 1 && ratio <= JUST_CROSSED_THRESHOLD) {
        const othersCrossed = ownerStats.filter(
          (o) => o.owner !== stats.owner && value(o) >= milestone
        );
        events.push({
          owner: stats.owner,
          current,
          milestone,
          status: 'just_crossed',
          kind,
          isFirst: othersCrossed.length === 0,
        });
      }
    }
  }
  return events;
}

// === A. Career Milestone Watch ===

function deriveMilestoneWatch(context: InsightContext): Insight | null {
  const active = activeOwnerSet(context.currentRoster);
  const activeStats = context.ownerCareerStats.filter((s) => active.has(s.owner));
  if (activeStats.length === 0) return null;

  const events: MilestoneEvent[] = [
    ...evaluateMilestones(activeStats, WIN_MILESTONES, (s) => s.totalWins, 'wins'),
    ...evaluateMilestones(activeStats, POINT_MILESTONES, (s) => s.totalPoints, 'points'),
  ];

  if (events.length === 0) return null;

  // Prioritize: just_crossed > approaching; higher milestone > lower; smaller approach gap > larger.
  const rankedEvents = events.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'just_crossed' ? -1 : 1;
    if (a.status === 'just_crossed') {
      if (a.isFirst !== b.isFirst) return a.isFirst ? -1 : 1;
      return b.milestone - a.milestone;
    }
    // approaching: prefer the highest milestone, then the smallest remaining gap.
    if (a.milestone !== b.milestone) return b.milestone - a.milestone;
    return a.milestone - a.current - (b.milestone - b.current);
  });

  const event = rankedEvents[0]!;
  const statLabel = event.kind === 'wins' ? 'career wins' : 'career league points';

  let description: string;
  let priority: number;
  if (event.status === 'just_crossed') {
    if (event.kind === 'wins') {
      description = event.isFirst
        ? `${event.owner} crossed ${formatNumber(event.milestone)} career wins — first to the mark.`
        : `${event.owner} crossed ${formatNumber(event.milestone)} career wins.`;
    } else {
      description = event.isFirst
        ? `${event.owner} crossed ${formatNumber(event.milestone)} career league points — first to the mark.`
        : `${event.owner} crossed ${formatNumber(event.milestone)} career league points.`;
    }
    priority = 72;
  } else {
    const remaining = event.milestone - event.current;
    description = `${event.owner} is ${formatNumber(remaining)} ${event.kind === 'wins' ? 'wins' : 'points'} away from ${formatNumber(event.milestone)} ${statLabel}.`;
    priority = 60;
  }

  return toInsight({
    id: `milestone-${event.kind}-${event.milestone}-${ownerSlug(event.owner)}-${event.status}`,
    type: 'milestone_watch',
    title: event.status === 'just_crossed' ? 'Career milestone reached' : 'Career milestone watch',
    description,
    owner: event.owner,
    priorityScore: priority,
    lifecycle: EVERGREEN_LIFECYCLES,
    newsHook: 'milestone_crossed',
    statValue: event.milestone,
  });
}

// === B. Perfect Against ===

function pairOwners(key: string): [string, string] {
  const [a, b] = key.split('|');
  return [a ?? '', b ?? ''];
}

function countWins(results: HeadToHeadResult[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of results) {
    counts.set(r.winner, (counts.get(r.winner) ?? 0) + 1);
  }
  return counts;
}

function derivePerfectAgainst(context: InsightContext): Insight | null {
  if (context.archives.length === 0) return null;
  const pairs = collectHeadToHead(context.archives, context.historicalRosters);
  const active = activeOwnerSet(context.currentRoster);

  type Entry = { dominant: string; loser: string; wins: number; meetings: number };
  const entries: Entry[] = [];

  for (const [key, results] of pairs) {
    if (results.length < MIN_PERFECT_MEETINGS) continue;
    const [a, b] = pairOwners(key);
    if (!active.has(a) || !active.has(b)) continue;
    const wins = countWins(results);
    const winsA = wins.get(a) ?? 0;
    const winsB = wins.get(b) ?? 0;
    if (winsA > 0 && winsB === 0) {
      entries.push({ dominant: a, loser: b, wins: winsA, meetings: results.length });
    } else if (winsB > 0 && winsA === 0) {
      entries.push({ dominant: b, loser: a, wins: winsB, meetings: results.length });
    }
  }

  if (entries.length === 0) return null;

  // Prefer the perfect record with the most meetings.
  entries.sort(
    (a, b) =>
      b.meetings - a.meetings ||
      a.dominant.localeCompare(b.dominant) ||
      a.loser.localeCompare(b.loser)
  );
  const topMeetings = entries[0]!.meetings;
  const tied = entries.filter((e) => e.meetings === topMeetings);
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const best = tied[0]!;
  // First time this insight can fire (at MIN_PERFECT_MEETINGS) is treated as a new record.
  const hook: NewsHook = best.meetings === MIN_PERFECT_MEETINGS ? 'new_record' : 'streak_extended';
  const description =
    hook === 'new_record'
      ? `${best.dominant} is ${best.wins}-0 all time against ${best.loser} — a perfect record across ${best.meetings} meetings.`
      : `${best.dominant} stays perfect against ${best.loser} — now ${best.wins}-0 across ${best.meetings} meetings.`;

  return toInsight({
    id: `perfect-against-${ownerSlug(best.dominant)}-${ownerSlug(best.loser)}`,
    type: 'perfect_against',
    title: 'Perfect all-time record',
    description,
    owner: best.dominant,
    relatedOwners: [best.loser],
    priorityScore: 78,
    lifecycle: EVERGREEN_LIFECYCLES,
    newsHook: hook,
    statValue: best.wins,
  });
}

// === Generator registrations ===

export const milestoneWatchGenerator: InsightGenerator = {
  id: 'milestones:watch',
  category: 'historical',
  supportedLifecycles: EVERGREEN_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insight = deriveMilestoneWatch(context);
    return insight ? [insight] : [];
  },
};

export const perfectAgainstGenerator: InsightGenerator = {
  id: 'milestones:perfect_against',
  category: 'historical',
  supportedLifecycles: EVERGREEN_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    const insight = derivePerfectAgainst(context);
    return insight ? [insight] : [];
  },
};

registerGenerator(milestoneWatchGenerator);
registerGenerator(perfectAgainstGenerator);
