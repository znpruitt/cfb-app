import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LIVE_DELTA_STALE_THRESHOLD_MS,
  selectFreshOwnerPendingDelta,
  selectLiveDelta,
} from '../selectors/liveDelta.ts';
import type { LiveDelta } from '../selectors/liveDelta.ts';
import type { AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';

function game(overrides: Partial<AppGame> = {}): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      away: {
        kind: 'team',
        teamId: overrides.canAway ?? 'away-id',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.canAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
      home: {
        kind: 'team',
        teamId: overrides.canHome ?? 'home-id',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
  };
}

function score(
  status: string,
  awayScore: number | null,
  homeScore: number | null,
  options?: { awayTeam?: string; homeTeam?: string; time?: string | null }
): ScorePack {
  return {
    status,
    away: { team: options?.awayTeam ?? 'Away', score: awayScore },
    home: { team: options?.homeTeam ?? 'Home', score: homeScore },
    time: options?.time ?? null,
  };
}

const FIXED_NOW = Date.parse('2026-09-15T18:30:00.000Z');

test('selectLiveDelta returns empty byGame and byOwner when there are no games', () => {
  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: {},
    games: [],
    rosterByTeam: new Map(),
    weekKey: '2026:1',
    lastFetchedAt: new Date(FIXED_NOW).toISOString(),
    now: FIXED_NOW,
  });

  assert.equal(result.weekKey, '2026:1');
  assert.deepEqual(result.byGame, {});
  assert.deepEqual(result.byOwner, {});
  assert.equal(result.isStale, false);
  assert.equal(result.generatedAt, new Date(FIXED_NOW).toISOString());
});

test('selectLiveDelta marks scheduled games when scores are missing', () => {
  const g = game({ key: 'g1', csvAway: 'Texas', csvHome: 'Rice' });
  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: {},
    games: [g],
    rosterByTeam: new Map(),
    weekKey: '2026:1',
    lastFetchedAt: null,
    now: FIXED_NOW,
  });

  assert.equal(result.byGame.g1?.status, 'unknown');
  assert.equal(result.byGame.g1?.score, null);
  // participantTeamIds come from the team-kind participants on the game
  assert.deepEqual(result.byGame.g1?.participantTeamIds, ['away-id', 'home-id']);
  assert.deepEqual(result.byOwner, {});
  assert.equal(result.isStale, true, 'no fetch yet → stale');
});

test('selectLiveDelta credits leading owner pendingWins and trailing owner pendingLosses for an in-progress game', () => {
  const g = game({ key: 'g2', csvAway: 'Texas', csvHome: 'Rice' });
  const roster = new Map<string, string>([
    ['Texas', 'Alice'],
    ['Rice', 'Bob'],
  ]);

  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: { g2: score('In Q3', 21, 14) },
    games: [g],
    rosterByTeam: roster,
    weekKey: '2026:3',
    lastFetchedAt: new Date(FIXED_NOW - 60_000).toISOString(),
    now: FIXED_NOW,
  });

  assert.equal(result.byGame.g2?.status, 'inprogress');
  assert.deepEqual(result.byOwner.Alice, {
    owner: 'Alice',
    pendingWins: 1,
    pendingLosses: 0,
    pendingPointsFor: 21,
    pendingPointsAgainst: 14,
  });
  assert.deepEqual(result.byOwner.Bob, {
    owner: 'Bob',
    pendingWins: 0,
    pendingLosses: 1,
    pendingPointsFor: 14,
    pendingPointsAgainst: 21,
  });
  assert.equal(result.isStale, false);
});

test('selectLiveDelta resolves the pending owner despite a provider-name mismatch (PLATFORM-039)', () => {
  // Provider label "Wash St" differs from the stored/canonical "Washington State".
  const g = game({ key: 'gm', csvAway: 'Wash St', canAway: 'Washington State', csvHome: 'Rice' });
  const roster = new Map<string, string>([['Washington State', 'Alice']]);

  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: { gm: score('In Q3', 24, 10) },
    games: [g],
    rosterByTeam: roster,
    weekKey: '2026:3',
    lastFetchedAt: new Date(FIXED_NOW - 60_000).toISOString(),
    now: FIXED_NOW,
  });

  assert.equal(result.byGame.gm?.status, 'inprogress');
  assert.equal(result.byOwner.Alice?.pendingWins, 1);
  assert.equal(result.byOwner.Alice?.pendingPointsFor, 24);
});

test('selectLiveDelta does not credit pending W/L for tied in-progress scores but still records points', () => {
  const g = game({ key: 'gt', csvAway: 'Texas', csvHome: 'Rice' });
  const roster = new Map<string, string>([
    ['Texas', 'Alice'],
    ['Rice', 'Bob'],
  ]);

  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: { gt: score('In Q2', 14, 14) },
    games: [g],
    rosterByTeam: roster,
    weekKey: '2026:3',
    lastFetchedAt: new Date(FIXED_NOW).toISOString(),
    now: FIXED_NOW,
  });

  assert.equal(result.byOwner.Alice?.pendingWins, 0);
  assert.equal(result.byOwner.Alice?.pendingLosses, 0);
  assert.equal(result.byOwner.Alice?.pendingPointsFor, 14);
  assert.equal(result.byOwner.Bob?.pendingPointsAgainst, 14);
});

test('selectLiveDelta records final games as final and emits no pending owner stats for them', () => {
  const g = game({ key: 'gf', csvAway: 'Texas', csvHome: 'Rice' });
  const roster = new Map<string, string>([
    ['Texas', 'Alice'],
    ['Rice', 'Bob'],
  ]);

  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: { gf: score('Final', 28, 21) },
    games: [g],
    rosterByTeam: roster,
    weekKey: '2026:5',
    lastFetchedAt: new Date(FIXED_NOW).toISOString(),
    now: FIXED_NOW,
  });

  assert.equal(result.byGame.gf?.status, 'final');
  assert.deepEqual(result.byOwner, {}, 'final games never contribute pending stats');
});

test('selectLiveDelta excludes NoClaim from byOwner pending aggregates', () => {
  const g = game({ key: 'gn', csvAway: 'Texas', csvHome: 'Rice' });
  const roster = new Map<string, string>([
    ['Texas', 'Alice'],
    ['Rice', 'NoClaim'],
  ]);

  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: { gn: score('In Q1', 7, 0) },
    games: [g],
    rosterByTeam: roster,
    weekKey: '2026:1',
    lastFetchedAt: new Date(FIXED_NOW).toISOString(),
    now: FIXED_NOW,
  });

  assert.ok(result.byOwner.Alice, 'real owner is recorded');
  assert.equal(result.byOwner.NoClaim, undefined, 'NoClaim never appears in byOwner');
});

test('selectLiveDelta aggregates an owner across multiple in-progress games', () => {
  const g1 = game({ key: 'g-a', csvAway: 'Texas', csvHome: 'Rice' });
  const g2 = game({ key: 'g-b', csvAway: 'Baylor', csvHome: 'TCU' });
  const roster = new Map<string, string>([
    ['Texas', 'Alice'],
    ['Rice', 'Bob'],
    ['Baylor', 'Alice'],
    ['TCU', 'Carol'],
  ]);

  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: {
      'g-a': score('In Q3', 21, 14),
      'g-b': score('In Q2', 7, 14, { awayTeam: 'Baylor', homeTeam: 'TCU' }),
    },
    games: [g1, g2],
    rosterByTeam: roster,
    weekKey: '2026:3',
    lastFetchedAt: new Date(FIXED_NOW).toISOString(),
    now: FIXED_NOW,
  });

  assert.deepEqual(result.byOwner.Alice, {
    owner: 'Alice',
    pendingWins: 1,
    pendingLosses: 1,
    pendingPointsFor: 21 + 7,
    pendingPointsAgainst: 14 + 14,
  });
});

test('selectLiveDelta marks isStale=true when lastFetchedAt is older than the threshold', () => {
  const stale = new Date(FIXED_NOW - DEFAULT_LIVE_DELTA_STALE_THRESHOLD_MS - 5_000).toISOString();
  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: {},
    games: [],
    rosterByTeam: new Map(),
    weekKey: '2026:1',
    lastFetchedAt: stale,
    now: FIXED_NOW,
  });
  assert.equal(result.isStale, true);
});

test('selectLiveDelta marks isStale=true when lastFetchedAt is unparseable or null', () => {
  const nullCase = selectLiveDelta({
    canonical: null,
    scoresByKey: {},
    games: [],
    rosterByTeam: new Map(),
    weekKey: '2026:1',
    lastFetchedAt: null,
    now: FIXED_NOW,
  });
  assert.equal(nullCase.isStale, true);

  const garbageCase = selectLiveDelta({
    canonical: null,
    scoresByKey: {},
    games: [],
    rosterByTeam: new Map(),
    weekKey: '2026:1',
    lastFetchedAt: 'not-a-date',
    now: FIXED_NOW,
  });
  assert.equal(garbageCase.isStale, true);
});

test('selectLiveDelta marks isStale=false when lastFetchedAt is within the threshold', () => {
  const fresh = new Date(FIXED_NOW - 1_000).toISOString();
  const result = selectLiveDelta({
    canonical: null,
    scoresByKey: {},
    games: [],
    rosterByTeam: new Map(),
    weekKey: '2026:1',
    lastFetchedAt: fresh,
    now: FIXED_NOW,
  });
  assert.equal(result.isStale, false);
});

// ---------------------------------------------------------------------------
// PLATFORM-046 — selectFreshOwnerPendingDelta: the shared "Live this week"
// pending-badge selector used by both Standings and the Members owner header.
// ---------------------------------------------------------------------------

function liveDelta(
  byOwner: Record<string, { pendingWins: number; pendingLosses: number }>,
  opts: { isStale?: boolean } = {}
): LiveDelta {
  return {
    weekKey: '2026:3',
    generatedAt: '2026-10-01T00:00:00.000Z',
    byGame: {},
    byOwner: Object.fromEntries(
      Object.entries(byOwner).map(([owner, d]) => [
        owner,
        { owner, pendingPointsFor: 0, pendingPointsAgainst: 0, ...d },
      ])
    ),
    isStale: opts.isStale ?? false,
  };
}

test('selectFreshOwnerPendingDelta returns a fresh, nonzero pending delta for the owner', () => {
  const delta = selectFreshOwnerPendingDelta(
    liveDelta({ Alice: { pendingWins: 1, pendingLosses: 0 } }),
    'Alice'
  );
  assert.equal(delta?.pendingWins, 1);
  assert.equal(delta?.pendingLosses, 0);
});

test('selectFreshOwnerPendingDelta suppresses a stale overlay', () => {
  const delta = selectFreshOwnerPendingDelta(
    liveDelta({ Alice: { pendingWins: 1, pendingLosses: 0 } }, { isStale: true }),
    'Alice'
  );
  assert.equal(delta, null);
});

test('selectFreshOwnerPendingDelta returns null when the owner has no delta', () => {
  assert.equal(
    selectFreshOwnerPendingDelta(liveDelta({ Bob: { pendingWins: 1, pendingLosses: 0 } }), 'Alice'),
    null
  );
});

test('selectFreshOwnerPendingDelta returns null for a zero-decision (tied) delta', () => {
  assert.equal(
    selectFreshOwnerPendingDelta(
      liveDelta({ Alice: { pendingWins: 0, pendingLosses: 0 } }),
      'Alice'
    ),
    null
  );
});

test('selectFreshOwnerPendingDelta never annotates NoClaim', () => {
  assert.equal(
    selectFreshOwnerPendingDelta(
      liveDelta({ NoClaim: { pendingWins: 3, pendingLosses: 1 } }),
      'NoClaim'
    ),
    null
  );
});

test('selectFreshOwnerPendingDelta returns null for missing owner / missing delta inputs', () => {
  assert.equal(selectFreshOwnerPendingDelta(null, 'Alice'), null);
  assert.equal(selectFreshOwnerPendingDelta(undefined, 'Alice'), null);
  assert.equal(selectFreshOwnerPendingDelta(liveDelta({}), null), null);
  assert.equal(selectFreshOwnerPendingDelta(liveDelta({}), undefined), null);
});

test('selectFreshOwnerPendingDelta reflects multiple in-progress games aggregated into one delta', () => {
  // selectLiveDelta accumulates all in-progress games for an owner into a single
  // byOwner entry; the helper reads that aggregate (one badge, not many).
  const delta = selectFreshOwnerPendingDelta(
    liveDelta({ Alice: { pendingWins: 2, pendingLosses: 1 } }),
    'Alice'
  );
  assert.equal(delta?.pendingWins, 2);
  assert.equal(delta?.pendingLosses, 1);
});
