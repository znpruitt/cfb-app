import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveOwnerRoster, deriveOwnerViewSnapshot } from '../ownerView.ts';
import type { AppGame, ParticipantSlot } from '../schedule';
import type { ScorePack } from '../scores';
import type { OwnerStandingsRow } from '../standings';

function teamParticipant(overrides: Partial<Extract<ParticipantSlot, { kind: 'team' }>>) {
  return {
    kind: 'team' as const,
    teamId: overrides.teamId ?? 'team-id',
    displayName: overrides.displayName ?? 'Team',
    canonicalName: overrides.canonicalName ?? 'Team',
    rawName: overrides.rawName ?? 'Team',
  };
}

// Provider labels ("Wash St") intentionally differ from the stored/canonical
// assignment ("Washington State") — the mismatch PLATFORM-039 must resolve.
function mismatchGame(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: 'e',
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: overrides.date ?? '2026-09-05T17:00:00.000Z',
    stage: 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: 1,
    slotOrder: 1,
    eventKey: 'event',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: null,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: teamParticipant({
        teamId: 'washingtonstate',
        displayName: 'Washington State',
        canonicalName: 'Washington State',
        rawName: 'Wash St',
      }),
      home: teamParticipant({
        teamId: 'oregon',
        displayName: 'Oregon',
        canonicalName: 'Oregon',
        rawName: 'Oregon',
      }),
    },
    csvAway: 'Wash St',
    csvHome: 'Oregon',
    canAway: 'Washington State',
    canHome: 'Oregon',
    awayConf: 'Big Ten',
    homeConf: 'Big Ten',
    ...overrides,
  };
}

const roster = new Map([['Washington State', 'Alice']]);

test('deriveOwnerRoster includes a final owned game and records the W despite a provider-name mismatch', () => {
  const scoresByKey: Record<string, ScorePack> = {
    g: {
      status: 'final',
      time: 'Final',
      away: { team: 'Wash St', score: 31 },
      home: { team: 'Oregon', score: 17 },
    },
  };

  const rows = deriveOwnerRoster(
    'Alice',
    [mismatchGame({ key: 'g', status: 'final' })],
    roster,
    scoresByKey
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.teamName, 'Washington State');
  assert.equal(rows[0]?.record, '1–0');
});

test('deriveOwnerRoster resolves side and next opponent for an upcoming owned game despite a mismatch', () => {
  const rows = deriveOwnerRoster('Alice', [mismatchGame({ key: 'g' })], roster, {});

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row?.ownerTeamSide, 'away');
  // Opponent display remains provider-facing.
  assert.equal(row?.nextOpponent, 'Oregon');
  assert.equal(row?.nextGameLabel, 'at Oregon');
  assert.equal(row?.currentStatus, 'Upcoming');
});

// ---------------------------------------------------------------------------
// PLATFORM-044 — Members owner summary (rank/record/win%/differential) prefers
// canonical standings rows; roster/game details stay schedule/client-derived;
// falls back to local rows when canonical is unavailable/empty/omits the owner.
// ---------------------------------------------------------------------------

function standingsRow(
  overrides: Partial<OwnerStandingsRow> & { owner: string }
): OwnerStandingsRow {
  return {
    owner: overrides.owner,
    wins: overrides.wins ?? 0,
    losses: overrides.losses ?? 0,
    winPct: overrides.winPct ?? 0,
    pointsFor: overrides.pointsFor ?? 0,
    pointsAgainst: overrides.pointsAgainst ?? 0,
    pointDifferential: overrides.pointDifferential ?? 0,
    gamesBack: overrides.gamesBack ?? 0,
    finalGames: overrides.finalGames ?? 0,
  };
}

const EMPTY_VIEW = {
  allGames: [] as AppGame[],
  weekGames: [] as AppGame[],
  rosterByTeam: new Map<string, string>(),
  scoresByKey: {} as Record<string, ScorePack>,
};

test('owner header prefers canonical standings over contradictory local rows (PLATFORM-044)', () => {
  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows: [
      standingsRow({ owner: 'Alice', wins: 1, losses: 5, winPct: 0.167, pointDifferential: -40 }),
    ],
    canonicalStandingsRows: [
      standingsRow({ owner: 'Alice', wins: 6, losses: 0, winPct: 1, pointDifferential: 120 }),
    ],
    ...EMPTY_VIEW,
  });

  // Old behavior read the local row (1–5); must now reflect canonical (6–0).
  assert.equal(snapshot.header?.record, '6–0');
  assert.equal(snapshot.header?.winPct, 1);
  assert.equal(snapshot.header?.pointDifferential, 120);
});

test('owner rank comes from canonical ordering', () => {
  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows: [standingsRow({ owner: 'Alice' }), standingsRow({ owner: 'Bob' })],
    // Canonical orders Bob ahead of Alice → Alice is rank 2.
    canonicalStandingsRows: [standingsRow({ owner: 'Bob' }), standingsRow({ owner: 'Alice' })],
    ...EMPTY_VIEW,
  });

  assert.equal(snapshot.header?.rank, 2);
});

test('owner header falls back to local rows when canonical is unavailable', () => {
  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows: [
      standingsRow({ owner: 'Alice', wins: 3, losses: 2, winPct: 0.6, pointDifferential: 10 }),
    ],
    ...EMPTY_VIEW,
  });

  assert.equal(snapshot.header?.record, '3–2');
  assert.equal(snapshot.header?.rank, 1);
});

test('owner header falls back to local rows when canonical rows are empty', () => {
  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows: [standingsRow({ owner: 'Alice', wins: 4, losses: 1 })],
    canonicalStandingsRows: [],
    ...EMPTY_VIEW,
  });

  assert.equal(snapshot.header?.record, '4–1');
  assert.equal(snapshot.header?.rank, 1);
});

test('owner header falls back to local rows when canonical omits the owner (local-only owner)', () => {
  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows: [standingsRow({ owner: 'Alice', wins: 3, losses: 2 })],
    canonicalStandingsRows: [standingsRow({ owner: 'Zoe', wins: 9 })],
    ...EMPTY_VIEW,
  });

  assert.equal(snapshot.header?.record, '3–2');
  assert.equal(snapshot.header?.rank, 1);
});

test('roster rows stay client-derived while the header uses canonical (PLATFORM-039 mismatch intact)', () => {
  const roster = new Map([['Washington State', 'Alice']]);
  const games = [mismatchGame({ key: 'g', status: 'final' })];
  const scoresByKey: Record<string, ScorePack> = {
    g: {
      status: 'final',
      time: 'Final',
      away: { team: 'Wash St', score: 31 },
      home: { team: 'Oregon', score: 17 },
    },
  };

  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows: [standingsRow({ owner: 'Alice', wins: 0, losses: 1 })],
    canonicalStandingsRows: [standingsRow({ owner: 'Alice', wins: 7, losses: 0, winPct: 1 })],
    allGames: games,
    weekGames: games,
    rosterByTeam: roster,
    scoresByKey,
  });

  // Header from canonical…
  assert.equal(snapshot.header?.record, '7–0');
  // …but the roster row is still resolved from the (provider-mismatched) game.
  assert.equal(snapshot.rosterRows.length, 1);
  assert.equal(snapshot.rosterRows[0]?.teamName, 'Washington State');
});

test('NoClaim is not surfaced as a Members owner entry', () => {
  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: null,
    // NoClaim is filtered out upstream (canonical/local both exclude it).
    standingsRows: [standingsRow({ owner: 'Alice' }), standingsRow({ owner: 'Bob' })],
    canonicalStandingsRows: [standingsRow({ owner: 'Alice' }), standingsRow({ owner: 'Bob' })],
    ...EMPTY_VIEW,
  });

  assert.ok(!snapshot.ownerOptions.includes('NoClaim'));
  assert.deepEqual(snapshot.ownerOptions, ['Alice', 'Bob']);
});
