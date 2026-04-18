import type { Insight } from '../../selectors/insights';
import { registerGenerator } from '../engine';
import type {
  InsightContext,
  InsightGenerator,
  LifecycleState,
  NewsHook,
  OwnerSeasonStats,
} from '../types';

const NO_CLAIM_OWNER = 'NoClaim';
const TIE_SUPPRESSION_THRESHOLD = 4;

const STATS_LIFECYCLES: LifecycleState[] = [
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
];
const EVERGREEN_LIFECYCLES: LifecycleState[] = [
  'preseason',
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
];

const MIN_GAMES_BASIC = 50;
const MIN_WINS_YARDS_PER_WIN = 30;
const MIN_THIRD_DOWN_ATTEMPTS = 200;

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
    category: 'stats_outliers',
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

function activeSeasonStats(context: InsightContext): OwnerSeasonStats[] {
  if (!context.ownerGameStats) return [];
  const active = activeOwnerSet(context.currentRoster);
  return context.ownerGameStats.filter((s) => active.has(s.owner));
}

function tiedAtValue<T>(entries: T[], value: (t: T) => number, direction: 'min' | 'max'): T[] {
  if (entries.length === 0) return [];
  const extremum = entries.reduce(
    (m, e) => (direction === 'max' ? Math.max(m, value(e)) : Math.min(m, value(e))),
    direction === 'max' ? -Infinity : Infinity
  );
  const epsilon = 1e-9;
  return entries.filter((e) => Math.abs(value(e) - extremum) < epsilon);
}

// === A. Ball Security Leader ===

function deriveBallSecurity(context: InsightContext): Insight | null {
  const active = activeSeasonStats(context).filter((s) => s.gamesPlayed >= MIN_GAMES_BASIC);
  if (active.length === 0) return null;

  type Entry = { stats: OwnerSeasonStats; perGame: number };
  const entries: Entry[] = active.map((stats) => ({
    stats,
    perGame: stats.turnovers / stats.gamesPlayed,
  }));

  const tied = tiedAtValue(entries, (e) => e.perGame, 'min').sort((a, b) =>
    a.stats.owner.localeCompare(b.stats.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner);
  const perGame = tied[0]!.perGame.toFixed(2);

  const description =
    tied.length === 1
      ? `${ownerNames[0]}'s roster coughed it up just ${perGame} times per game — cleanest in the league.`
      : `${formatOwnerList(ownerNames)} share the league's cleanest hands at ${perGame} turnovers per game.`;

  return toInsight({
    id: `ball-security-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'ball_security',
    title: 'Ball security leader',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 65,
    lifecycle: STATS_LIFECYCLES,
    newsHook: 'snapshot',
    statValue: Number(perGame),
  });
}

// === B. Defensive Takeaway King ===

function deriveTakeawayKing(context: InsightContext): Insight | null {
  const active = activeSeasonStats(context).filter((s) => s.gamesPlayed >= MIN_GAMES_BASIC);
  if (active.length === 0) return null;

  type Entry = { stats: OwnerSeasonStats; perGame: number };
  const entries: Entry[] = active.map((stats) => ({
    stats,
    perGame: stats.turnoversForced / stats.gamesPlayed,
  }));

  const tied = tiedAtValue(entries, (e) => e.perGame, 'max').sort((a, b) =>
    a.stats.owner.localeCompare(b.stats.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner);
  const leaderPerGame = tied[0]!.perGame;

  // Second-best to use as threshold reference.
  const others = entries.filter((e) => !tied.includes(e)).sort((a, b) => b.perGame - a.perGame);
  const second = others[0];
  const threshold = second ? second.perGame.toFixed(2) : leaderPerGame.toFixed(2);

  let description: string;
  if (tied.length === 1) {
    description = second
      ? `${ownerNames[0]}'s defense forced ${leaderPerGame.toFixed(2)} takeaways per game — the only owner above ${threshold}.`
      : `${ownerNames[0]}'s defense forced ${leaderPerGame.toFixed(2)} takeaways per game — the league's top ball hawk.`;
  } else {
    description = `${formatOwnerList(ownerNames)} each forced ${leaderPerGame.toFixed(2)} takeaways per game — tied for the league lead.`;
  }

  return toInsight({
    id: `takeaway-king-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'takeaway_king',
    title: 'Defensive takeaway king',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 65,
    lifecycle: STATS_LIFECYCLES,
    newsHook: 'snapshot',
    statValue: Number(leaderPerGame.toFixed(2)),
  });
}

// === C. Yards-Per-Win Efficiency ===

function deriveYardsPerWin(context: InsightContext): Insight | null {
  const stats = activeSeasonStats(context);
  if (stats.length === 0) return null;

  const winsByOwner = new Map<string, number>();
  for (const row of context.currentStandings) {
    winsByOwner.set(row.owner, row.wins);
  }

  type Entry = { stats: OwnerSeasonStats; wins: number; yardsPerWin: number };
  const entries: Entry[] = stats
    .map((s) => {
      const wins = winsByOwner.get(s.owner) ?? 0;
      if (wins < MIN_WINS_YARDS_PER_WIN) return null;
      return { stats: s, wins, yardsPerWin: s.totalYards / wins } as Entry;
    })
    .filter((e): e is Entry => e !== null);

  if (entries.length === 0) return null;

  const tied = tiedAtValue(entries, (e) => e.yardsPerWin, 'min').sort((a, b) =>
    a.stats.owner.localeCompare(b.stats.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner);
  const ypw = Math.round(tied[0]!.yardsPerWin);

  const description =
    tied.length === 1
      ? `${ownerNames[0]} needed just ${ypw.toLocaleString()} yards per win — nobody in the league was more efficient.`
      : `${formatOwnerList(ownerNames)} each needed ${ypw.toLocaleString()} yards per win — the league's most efficient offenses.`;

  return toInsight({
    id: `yards-per-win-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'yards_per_win',
    title: 'Yards-per-win efficiency',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 67,
    lifecycle: STATS_LIFECYCLES,
    newsHook: 'snapshot',
    statValue: ypw,
  });
}

// === D. Clock Crusher ===

function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function deriveClockCrusher(context: InsightContext): Insight | null {
  const active = activeSeasonStats(context).filter((s) => s.gamesPlayed >= MIN_GAMES_BASIC);
  if (active.length === 0) return null;

  type Entry = { stats: OwnerSeasonStats; perGame: number };
  const entries: Entry[] = active.map((stats) => ({
    stats,
    perGame: stats.possessionSeconds / stats.gamesPlayed,
  }));

  const tied = tiedAtValue(entries, (e) => e.perGame, 'max').sort((a, b) =>
    a.stats.owner.localeCompare(b.stats.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((e) => e.stats.owner);
  const clock = formatClock(tied[0]!.perGame);

  const description =
    tied.length === 1
      ? `${ownerNames[0]}'s roster controlled the ball ${clock} per game — the league's ultimate clock-eater.`
      : `${formatOwnerList(ownerNames)} each controlled the ball ${clock} per game — tied as the league's top time-of-possession owners.`;

  return toInsight({
    id: `clock-crusher-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'clock_crusher',
    title: 'Clock crusher',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 60,
    lifecycle: STATS_LIFECYCLES,
    newsHook: 'snapshot',
    statValue: Math.round(tied[0]!.perGame),
  });
}

// === E. Third Down Specialist ===

function deriveThirdDownSpecialist(context: InsightContext): Insight | null {
  const active = activeSeasonStats(context).filter(
    (s) => s.thirdDownAttempts >= MIN_THIRD_DOWN_ATTEMPTS
  );
  if (active.length === 0) return null;

  const tied = tiedAtValue(active, (s) => s.thirdDownPct, 'max').sort((a, b) =>
    a.owner.localeCompare(b.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((s) => s.owner);
  const leaderPct = (tied[0]!.thirdDownPct * 100).toFixed(1);

  const others = active
    .filter((s) => !tied.includes(s))
    .sort((a, b) => b.thirdDownPct - a.thirdDownPct);
  const second = others[0];

  let description: string;
  if (tied.length === 1) {
    description = second
      ? `${ownerNames[0]} converted ${leaderPct}% of 3rd downs — edging ${second.owner} for the league lead.`
      : `${ownerNames[0]} converted ${leaderPct}% of 3rd downs — the league's only owner to clear the ${MIN_THIRD_DOWN_ATTEMPTS}-attempt bar.`;
  } else {
    description = `${formatOwnerList(ownerNames)} each converted ${leaderPct}% of 3rd downs — tied for the league lead.`;
  }

  return toInsight({
    id: `third-down-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'third_down',
    title: 'Third down specialist',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 62,
    lifecycle: STATS_LIFECYCLES,
    newsHook: 'snapshot',
    statValue: Number(leaderPct),
  });
}

// === F. Team Identity (Ground & Pound vs Air Raid) ===

function deriveTeamIdentity(context: InsightContext): Insight | null {
  const active = activeSeasonStats(context).filter((s) => s.totalYards > 0);
  if (active.length === 0) return null;

  type Entry = { stats: OwnerSeasonStats; rushPct: number; passPct: number };
  const entries: Entry[] = active.map((stats) => ({
    stats,
    rushPct: stats.rushingYards / stats.totalYards,
    passPct: stats.passingYards / stats.totalYards,
  }));

  const groundLeader = [...entries].sort((a, b) => b.rushPct - a.rushPct)[0]!;
  const airLeader = [...entries].sort((a, b) => b.passPct - a.passPct)[0]!;

  const groundExtremity = Math.abs(groundLeader.rushPct - 0.5);
  const airExtremity = Math.abs(airLeader.passPct - 0.5);

  const useGround = groundExtremity >= airExtremity;
  const chosen = useGround ? groundLeader : airLeader;
  const pct = useGround ? (chosen.rushPct * 100).toFixed(0) : (chosen.passPct * 100).toFixed(0);

  const sameStatEntries = entries.map((e) => ({
    entry: e,
    value: useGround ? e.rushPct : e.passPct,
  }));
  const tied = tiedAtValue(sameStatEntries, (t) => t.value, 'max').sort((a, b) =>
    a.entry.stats.owner.localeCompare(b.entry.stats.owner)
  );
  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const ownerNames = tied.map((t) => t.entry.stats.owner);

  let description: string;
  if (useGround) {
    description =
      tied.length === 1
        ? `${ownerNames[0]}'s roster ran for ${pct}% of its yards — the league's purest ground attack.`
        : `${formatOwnerList(ownerNames)} each rushed for ${pct}% of their yards — tied for the league's most ground-heavy offenses.`;
  } else {
    description =
      tied.length === 1
        ? `${ownerNames[0]}'s offense went through the air ${pct}% of the time — the league's most pass-heavy attack.`
        : `${formatOwnerList(ownerNames)} each went through the air ${pct}% of the time — tied for the league's most pass-heavy offenses.`;
  }

  return toInsight({
    id: `team-identity-${useGround ? 'ground' : 'air'}-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'team_identity',
    title: useGround ? 'Ground & pound leader' : 'Air raid leader',
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: 58,
    lifecycle: EVERGREEN_LIFECYCLES,
    newsHook: 'snapshot',
    statValue: Number(pct),
  });
}

// === Generator registrations ===

export const ballSecurityGenerator: InsightGenerator = {
  id: 'stats:ball_security',
  category: 'stats_outliers',
  supportedLifecycles: STATS_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    if (!context.ownerGameStats) return [];
    const insight = deriveBallSecurity(context);
    return insight ? [insight] : [];
  },
};

export const takeawayKingGenerator: InsightGenerator = {
  id: 'stats:takeaway_king',
  category: 'stats_outliers',
  supportedLifecycles: STATS_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    if (!context.ownerGameStats) return [];
    const insight = deriveTakeawayKing(context);
    return insight ? [insight] : [];
  },
};

export const yardsPerWinGenerator: InsightGenerator = {
  id: 'stats:yards_per_win',
  category: 'stats_outliers',
  supportedLifecycles: STATS_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    if (!context.ownerGameStats) return [];
    const insight = deriveYardsPerWin(context);
    return insight ? [insight] : [];
  },
};

export const clockCrusherGenerator: InsightGenerator = {
  id: 'stats:clock_crusher',
  category: 'stats_outliers',
  supportedLifecycles: STATS_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    if (!context.ownerGameStats) return [];
    const insight = deriveClockCrusher(context);
    return insight ? [insight] : [];
  },
};

export const thirdDownSpecialistGenerator: InsightGenerator = {
  id: 'stats:third_down',
  category: 'stats_outliers',
  supportedLifecycles: STATS_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    if (!context.ownerGameStats) return [];
    const insight = deriveThirdDownSpecialist(context);
    return insight ? [insight] : [];
  },
};

export const teamIdentityGenerator: InsightGenerator = {
  id: 'stats:team_identity',
  category: 'stats_outliers',
  supportedLifecycles: EVERGREEN_LIFECYCLES,
  tone: 'factual',
  generate(context) {
    if (!context.ownerGameStats) return [];
    const insight = deriveTeamIdentity(context);
    return insight ? [insight] : [];
  },
};

registerGenerator(ballSecurityGenerator);
registerGenerator(takeawayKingGenerator);
registerGenerator(yardsPerWinGenerator);
registerGenerator(clockCrusherGenerator);
registerGenerator(thirdDownSpecialistGenerator);
registerGenerator(teamIdentityGenerator);
