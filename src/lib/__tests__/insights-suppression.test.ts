import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ballSecurityGenerator,
  clockCrusherGenerator,
  takeawayKingGenerator,
  teamIdentityGenerator,
  thirdDownSpecialistGenerator,
  yardsPerWinGenerator,
} from '../insights/generators/stats';
import {
  isSuppressed,
  isSuppressionRecordExpired,
  SUPPRESSION_RECORD_TTL_DAYS,
  type SuppressionRecord,
} from '../insights/suppression';
import type { InsightContext, OwnerCareerStats, OwnerSeasonStats } from '../insights/types';
import type { Insight } from '../selectors/insights';
import type { OwnerStandingsRow } from '../standings';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRecord(overrides: Partial<SuppressionRecord>): SuppressionRecord {
  return {
    insightId: overrides.insightId ?? 'ball-security-alex',
    hook: overrides.hook ?? 'extending_lead',
    owner: overrides.owner ?? 'Alex',
    firedAt: overrides.firedAt ?? new Date().toISOString(),
    statValue: overrides.statValue ?? 0.45,
  };
}

function makeInsight(overrides: Partial<Insight>): Insight {
  return {
    id: overrides.id ?? 'ball-security-alex',
    type: overrides.type ?? 'ball_security',
    title: overrides.title ?? 'Ball security leader',
    description: overrides.description ?? '...',
    owner: overrides.owner ?? 'Alex',
    relatedOwners: overrides.relatedOwners ?? [],
    priorityScore: overrides.priorityScore ?? 65,
    newsHook: overrides.newsHook ?? 'extending_lead',
    statValue: overrides.statValue ?? 0.45,
  };
}

function row(owner: string, wins: number): OwnerStandingsRow {
  const losses = 100 - wins;
  return {
    owner,
    wins,
    losses,
    winPct: wins / (wins + losses),
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: 0,
    finalGames: wins + losses,
  };
}

function seasonStats(overrides: Partial<OwnerSeasonStats> & { owner: string }): OwnerSeasonStats {
  return {
    owner: overrides.owner,
    season: overrides.season ?? 2025,
    gamesPlayed: overrides.gamesPlayed ?? 100,
    points: overrides.points ?? 0,
    pointsAgainst: overrides.pointsAgainst ?? 0,
    totalYards: overrides.totalYards ?? 30_000,
    rushingYards: overrides.rushingYards ?? 15_000,
    passingYards: overrides.passingYards ?? 15_000,
    turnovers: overrides.turnovers ?? 50,
    turnoversForced: overrides.turnoversForced ?? 50,
    turnoverMargin: overrides.turnoverMargin ?? 0,
    thirdDownConversions: overrides.thirdDownConversions ?? 100,
    thirdDownAttempts: overrides.thirdDownAttempts ?? 250,
    thirdDownPct: overrides.thirdDownPct ?? 0.4,
    possessionSeconds: overrides.possessionSeconds ?? 60_000,
  };
}

function makeContext(overrides: Partial<InsightContext> = {}): InsightContext {
  return {
    leagueSlug: overrides.leagueSlug ?? 'test',
    currentYear: overrides.currentYear ?? 2025,
    lifecycleState: overrides.lifecycleState ?? 'mid_season',
    seasonContext: overrides.seasonContext ?? 'in-season',
    currentWeek: overrides.currentWeek ?? null,
    currentStandings: overrides.currentStandings ?? [],
    weeklyStandings: overrides.weeklyStandings ?? [],
    games: overrides.games ?? [],
    ownerGameStats: overrides.ownerGameStats ?? null,
    ownerCareerStats: overrides.ownerCareerStats ?? ([] as OwnerCareerStats[]),
    archives: overrides.archives ?? [],
    historicalRosters: overrides.historicalRosters ?? {},
    rankings: overrides.rankings ?? null,
    currentRoster: overrides.currentRoster ?? new Map(),
    usingArchivedRoster: overrides.usingArchivedRoster ?? false,
  };
}

// ---------------------------------------------------------------------------
// TTL safety net
// ---------------------------------------------------------------------------

test('isSuppressionRecordExpired: fresh record (1 day old) is not expired', () => {
  const record = makeRecord({
    firedAt: new Date(Date.now() - 1 * DAY_MS).toISOString(),
  });
  assert.equal(isSuppressionRecordExpired(record), false);
});

test('isSuppressionRecordExpired: 30-day-old record is not expired', () => {
  const record = makeRecord({
    firedAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
  });
  assert.equal(isSuppressionRecordExpired(record), false);
});

test('isSuppressionRecordExpired: record older than TTL is expired', () => {
  const record = makeRecord({
    firedAt: new Date(Date.now() - (SUPPRESSION_RECORD_TTL_DAYS + 1) * DAY_MS).toISOString(),
  });
  assert.equal(isSuppressionRecordExpired(record), true);
});

test('isSuppressionRecordExpired: record at exactly TTL boundary is not expired', () => {
  const record = makeRecord({
    firedAt: new Date(Date.now() - SUPPRESSION_RECORD_TTL_DAYS * DAY_MS).toISOString(),
  });
  // Exactly TTL_DAYS old → diff equals TTL exactly → not strictly greater → not expired.
  assert.equal(isSuppressionRecordExpired(record), false);
});

test('isSuppressionRecordExpired: invalid firedAt is treated as not expired', () => {
  const record = makeRecord({ firedAt: 'not-a-date' });
  assert.equal(isSuppressionRecordExpired(record), false);
});

test('isSuppressed: 30-day-old record with unchanged stat suppresses normally', () => {
  const record = makeRecord({
    insightId: 'ball-security-alex',
    hook: 'extending_lead',
    owner: 'Alex',
    statValue: 0.45,
    firedAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
  });
  const records = new Map([[`${record.insightId}:${record.hook}`, record]]);
  const insight = makeInsight({
    id: 'ball-security-alex',
    type: 'ball_security',
    owner: 'Alex',
    newsHook: 'extending_lead',
    statValue: 0.45,
  });
  assert.equal(isSuppressed(insight, records), true);
});

test('isSuppressed: 91-day-old record is ignored (TTL exceeded)', () => {
  const record = makeRecord({
    insightId: 'ball-security-alex',
    hook: 'extending_lead',
    owner: 'Alex',
    statValue: 0.45,
    firedAt: new Date(Date.now() - 91 * DAY_MS).toISOString(),
  });
  const records = new Map([[`${record.insightId}:${record.hook}`, record]]);
  const insight = makeInsight({
    id: 'ball-security-alex',
    type: 'ball_security',
    owner: 'Alex',
    newsHook: 'extending_lead',
    statValue: 0.45,
  });
  assert.equal(
    isSuppressed(insight, records),
    false,
    'records older than the TTL must be treated as absent'
  );
});

// ---------------------------------------------------------------------------
// Stats types now in TYPE_THRESHOLDS — 'unchanged' rule
// ---------------------------------------------------------------------------

test('isSuppressed: ball_security same owner + same stat → suppress (unchanged rule)', () => {
  const record = makeRecord({
    insightId: 'ball-security-alex',
    hook: 'extending_lead',
    owner: 'Alex',
    statValue: 0.45,
  });
  const records = new Map([[`${record.insightId}:${record.hook}`, record]]);
  const insight = makeInsight({
    id: 'ball-security-alex',
    type: 'ball_security',
    owner: 'Alex',
    newsHook: 'extending_lead',
    statValue: 0.45,
  });
  assert.equal(isSuppressed(insight, records), true);
});

test('isSuppressed: ball_security same owner + different stat → fire (stat changed)', () => {
  const record = makeRecord({
    insightId: 'ball-security-alex',
    hook: 'extending_lead',
    owner: 'Alex',
    statValue: 0.45,
  });
  const records = new Map([[`${record.insightId}:${record.hook}`, record]]);
  const insight = makeInsight({
    id: 'ball-security-alex',
    type: 'ball_security',
    owner: 'Alex',
    newsHook: 'extending_lead',
    statValue: 0.5,
  });
  assert.equal(isSuppressed(insight, records), false);
});

test('isSuppressed: ball_security different owner → fire (leader changed)', () => {
  const record = makeRecord({
    insightId: 'ball-security-alex',
    hook: 'extending_lead',
    owner: 'Alex',
    statValue: 0.45,
  });
  // Insight ID likely differs when owner changes (id includes owner slug),
  // so the suppression key won't even match — but this test pins the
  // owner-mismatch fallthrough explicitly.
  const records = new Map([[`ball-security-alex:extending_lead`, record]]);
  const insight = makeInsight({
    id: 'ball-security-alex', // same id, different primaryOwner
    type: 'ball_security',
    owner: 'Blake',
    newsHook: 'extending_lead',
    statValue: 0.45,
  });
  assert.equal(isSuppressed(insight, records), false);
});

test('isSuppressed: takeaway_king unchanged rule applies', () => {
  const record = makeRecord({
    insightId: 'takeaway-king-alex',
    hook: 'extending_lead',
    owner: 'Alex',
    statValue: 1.5,
  });
  const records = new Map([[`${record.insightId}:${record.hook}`, record]]);
  const sameInsight = makeInsight({
    id: 'takeaway-king-alex',
    type: 'takeaway_king',
    owner: 'Alex',
    newsHook: 'extending_lead',
    statValue: 1.5,
  });
  const changedInsight = makeInsight({
    id: 'takeaway-king-alex',
    type: 'takeaway_king',
    owner: 'Alex',
    newsHook: 'extending_lead',
    statValue: 1.6,
  });
  assert.equal(isSuppressed(sameInsight, records), true);
  assert.equal(isSuppressed(changedInsight, records), false);
});

// ---------------------------------------------------------------------------
// Stats generators emit non-snapshot hook
// ---------------------------------------------------------------------------

test('stats generators no longer emit snapshot hook (regression guard)', () => {
  const stats = [
    seasonStats({ owner: 'Alex', turnovers: 30, turnoversForced: 80 }),
    seasonStats({ owner: 'Blake', turnovers: 80, turnoversForced: 30 }),
  ];
  const standings = [row('Alex', 60), row('Blake', 40)];
  const context = makeContext({
    lifecycleState: 'mid_season',
    ownerGameStats: stats,
    currentRoster: new Map([
      ['t1', 'Alex'],
      ['t2', 'Blake'],
    ]),
    currentStandings: standings,
  });

  const generators = [
    ballSecurityGenerator,
    takeawayKingGenerator,
    yardsPerWinGenerator,
    clockCrusherGenerator,
    thirdDownSpecialistGenerator,
    teamIdentityGenerator,
  ];
  for (const g of generators) {
    const insights = g.generate(context);
    for (const insight of insights) {
      assert.notEqual(
        insight.newsHook,
        'snapshot',
        `${g.id} should not emit 'snapshot' hook (single-fire-per-season bug)`
      );
    }
  }
});

test('ballSecurityGenerator + isSuppressed: leader change fires; same leader+stat suppresses', () => {
  const standings = [row('Alex', 60), row('Blake', 40)];

  // Week 5: Alex is the cleanest at 0.30/game (turnovers=30, games=100).
  const week5Stats: OwnerSeasonStats[] = [
    seasonStats({ owner: 'Alex', turnovers: 30 }),
    seasonStats({ owner: 'Blake', turnovers: 80 }),
  ];
  const week5Ctx = makeContext({
    lifecycleState: 'mid_season',
    ownerGameStats: week5Stats,
    currentRoster: new Map([
      ['t1', 'Alex'],
      ['t2', 'Blake'],
    ]),
    currentStandings: standings,
  });
  const week5Insights = ballSecurityGenerator.generate(week5Ctx);
  assert.equal(week5Insights.length, 1, 'week 5 should emit one ball_security insight');
  const week5 = week5Insights[0]!;
  assert.equal(week5.owner, 'Alex');
  assert.notEqual(week5.newsHook, 'snapshot');

  // Build a suppression record from week 5's fire.
  const priorRecord = makeRecord({
    insightId: week5.id,
    hook: week5.newsHook,
    owner: week5.owner!,
    statValue: week5.statValue,
  });
  const records = new Map([[`${priorRecord.insightId}:${priorRecord.hook}`, priorRecord]]);

  // Week 6 — same data → same insight → must be suppressed.
  const week6SameInsights = ballSecurityGenerator.generate(week5Ctx);
  assert.equal(week6SameInsights.length, 1);
  assert.equal(
    isSuppressed(week6SameInsights[0]!, records),
    true,
    'unchanged leader + unchanged stat must suppress'
  );

  // Week 7 — Blake takes the lead with cleanest hands (turnovers=20).
  const week7Stats: OwnerSeasonStats[] = [
    seasonStats({ owner: 'Alex', turnovers: 35 }),
    seasonStats({ owner: 'Blake', turnovers: 20 }),
  ];
  const week7Ctx = makeContext({
    lifecycleState: 'mid_season',
    ownerGameStats: week7Stats,
    currentRoster: new Map([
      ['t1', 'Alex'],
      ['t2', 'Blake'],
    ]),
    currentStandings: standings,
  });
  const week7Insights = ballSecurityGenerator.generate(week7Ctx);
  assert.equal(week7Insights.length, 1);
  const week7 = week7Insights[0]!;
  assert.equal(week7.owner, 'Blake', 'Blake should take the leader spot in week 7');
  assert.equal(
    isSuppressed(week7, records),
    false,
    'leader change must fire even with prior week-5 record present'
  );
});
