import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScheduleFromApi } from '../../schedule.ts';
import {
  buildCanonicalGameStatsSlate,
  deriveCanonicalGameStatsSlateFromBuild,
} from '../canonicalSlate.ts';
import {
  GAME_STAT_SLATE_SNAPSHOT_VERSION,
  buildGameStatSlateSnapshot,
  parseGameStatSlateSnapshot,
  snapshotToCanonicalSlate,
  type GameStatSlateSnapshot,
} from '../slateSnapshot.ts';
import { C1_TEAMS, IDENTITY_KEYS, scheduleItem } from './c1Fixtures.ts';

// Fixed clock: the 2025-09-06 default kickoff is > 6h old at this instant.
const NOW = new Date('2025-09-07T00:00:00Z');
const YEAR = 2025;

function fixtureItems() {
  return [
    // completed, id-bearing → expected, persisted with numeric participant ids
    scheduleItem({
      id: '5001',
      week: 3,
      home: 'Alpha State',
      away: 'Beta Tech',
      status: 'final',
      homeId: 101,
      awayId: 202,
    }),
    // future kickoff → pending; ids omitted (pre-C5 record) → nulls, still persisted
    scheduleItem({
      id: '5002',
      week: 3,
      home: 'Gamma A&M',
      away: 'Delta University',
      startDate: '2025-09-13T16:00:00Z',
      status: 'scheduled',
    }),
    // disrupted → not-expected, never persisted
    scheduleItem({
      id: '5003',
      week: 3,
      home: 'Alpha State',
      away: 'Gamma A&M',
      status: 'STATUS_CANCELED',
    }),
  ];
}

function exactBuild(scheduleItems = fixtureItems(), now = NOW) {
  const { games } = buildScheduleFromApi({
    scheduleItems,
    teams: C1_TEAMS,
    aliasMap: {},
    season: YEAR,
  });
  return { year: YEAR, games, scheduleItems, teams: C1_TEAMS, aliasMap: {}, now };
}

function validSnapshot(): GameStatSlateSnapshot {
  return buildGameStatSlateSnapshot(exactBuild());
}

function snapshotGame(snapshot: GameStatSlateSnapshot, id: number) {
  return snapshot.games.find((g) => g.providerGameId === id);
}

// === deriveCanonicalGameStatsSlateFromBuild ===

test('derive-from-build: identical to the internal-build slate over the same inputs', () => {
  const input = exactBuild();
  const derived = deriveCanonicalGameStatsSlateFromBuild(input);
  const built = buildCanonicalGameStatsSlate({
    year: YEAR,
    scheduleItems: input.scheduleItems,
    teams: C1_TEAMS,
    aliasMap: {},
    now: NOW,
  });
  assert.deepEqual(derived, built);
});

test('derive-from-build: consumes the EXACT games it is given, never an internal rebuild', () => {
  const input = exactBuild();
  // Deliberately drop one built game. A derivation that internally rebuilt from
  // scheduleItems would resurrect it; the exact-build contract must not.
  const withoutFirst = {
    ...input,
    games: input.games.filter((game) => game.providerGameId !== '5001'),
  };
  const slate = deriveCanonicalGameStatsSlateFromBuild(withoutFirst);
  assert.equal(
    slate.games.find((g) => g.providerGameId === 5001),
    undefined,
    'a game absent from the provided build must be absent from the slate'
  );
});

test('derive-from-build: fails closed when a built game has no associated wire row', () => {
  const input = exactBuild();
  // Simulate a manual override rewriting a provider id away from every wire
  // row: the association is unverifiable and must throw, never silently
  // default the partition/season type or null the participant ids.
  const rewritten = {
    ...input,
    games: input.games.map((game) =>
      game.providerGameId === '5001' ? { ...game, providerGameId: '99999' } : game
    ),
  };
  assert.throws(
    () => deriveCanonicalGameStatsSlateFromBuild(rewritten),
    /no associated schedule wire row/
  );
});

test('derive-from-build: refuses an empty team catalog', () => {
  const input = exactBuild();
  assert.throws(
    () => deriveCanonicalGameStatsSlateFromBuild({ ...input, teams: [] }),
    /non-empty team catalog/
  );
});

// === buildGameStatSlateSnapshot ===

test('snapshot: persists expected + pending games only, with the exact allowlisted keys', () => {
  const snapshot = validSnapshot();

  assert.equal(snapshot.snapshotVersion, GAME_STAT_SLATE_SNAPSHOT_VERSION);
  assert.equal(snapshot.year, YEAR);
  assert.deepEqual(Object.keys(snapshot).sort(), ['games', 'snapshotVersion', 'year']);

  // Expected (5001) and pending (5002) persist; disrupted (5003) never does.
  assert.ok(snapshotGame(snapshot, 5001));
  assert.ok(snapshotGame(snapshot, 5002));
  assert.equal(snapshotGame(snapshot, 5003), undefined);

  for (const game of snapshot.games) {
    assert.deepEqual(Object.keys(game).sort(), [
      'away',
      'awayId',
      'home',
      'homeId',
      'key',
      'providerGameId',
      'providerWeek',
      'seasonType',
    ]);
  }

  const completed = snapshotGame(snapshot, 5001)!;
  assert.equal(completed.providerWeek, 3);
  assert.equal(completed.seasonType, 'regular');
  assert.equal(completed.homeId, 101);
  assert.equal(completed.awayId, 202);
  assert.equal(completed.home?.identityKey, IDENTITY_KEYS['Alpha State']);
  assert.equal(completed.away?.identityKey, IDENTITY_KEYS['Beta Tech']);
  assert.deepEqual(Object.keys(completed.home!).sort(), ['canonicalName', 'identityKey']);

  // Ids omitted on the wire row (pre-C5 record) persist as explicit nulls.
  const upcoming = snapshotGame(snapshot, 5002)!;
  assert.equal(upcoming.homeId, null);
  assert.equal(upcoming.awayId, null);
});

test('snapshot: content is independent of the build instant', () => {
  // At this earlier instant 5001 (16:00 kickoff) is only 1h old → `pending`
  // instead of `expected`. The persisted snapshot collapses that split, so the
  // content must be identical.
  const earlier = buildGameStatSlateSnapshot(
    exactBuild(fixtureItems(), new Date('2025-09-06T17:00:00Z'))
  );
  assert.deepEqual(earlier, validSnapshot());
});

test('snapshot: survives JSON persistence round-trip through the strict parser', () => {
  const persisted: unknown = JSON.parse(JSON.stringify(validSnapshot()));
  const parsed = parseGameStatSlateSnapshot(persisted, YEAR);
  assert.equal(parsed.status, 'valid');
  assert.deepEqual(parsed.status === 'valid' ? parsed.snapshot : null, validSnapshot());
});

test('snapshot: builder self-verifies against the strict parser before returning', () => {
  const input = exactBuild();
  // Simulate an unvalidated manual override injecting an invalid provider week
  // into the exact build: the builder must fail the archive build rather than
  // emit a snapshot its own reader would call malformed.
  const poisoned = {
    ...input,
    games: input.games.map((game) =>
      game.providerGameId === '5001' ? { ...game, providerWeek: -1 } : game
    ),
  };
  assert.throws(() => buildGameStatSlateSnapshot(poisoned), /failed strict validation/);
});

test('snapshot: builder refuses an empty team catalog', () => {
  const input = exactBuild();
  assert.throws(
    () => buildGameStatSlateSnapshot({ ...input, teams: [] }),
    /non-empty team catalog/
  );
});

// === parseGameStatSlateSnapshot ===

test('parse: only a MISSING value is absent; a present null is corrupt → malformed', () => {
  assert.deepEqual(parseGameStatSlateSnapshot(undefined), { status: 'absent' });
  assert.deepEqual(parseGameStatSlateSnapshot(null), { status: 'malformed' });
});

test('parse: expectedYear mismatch is a provenance violation → malformed', () => {
  assert.equal(parseGameStatSlateSnapshot(validSnapshot(), YEAR).status, 'valid');
  assert.equal(parseGameStatSlateSnapshot(validSnapshot(), YEAR - 1).status, 'malformed');
});

test('parse: provider week zero is a real partition → valid', () => {
  const snapshot = validSnapshot();
  snapshot.games[0]!.providerWeek = 0;
  assert.equal(parseGameStatSlateSnapshot(snapshot).status, 'valid');
});

test('parse: strict allowlist rejects every malformed shape', () => {
  const mutations: Array<[string, (s: GameStatSlateSnapshot) => unknown]> = [
    ['non-object root', () => 'not-an-object'],
    ['array root', () => []],
    ['extra root key', (s) => ({ ...s, extra: true })],
    [
      'missing root key',
      (s) => {
        const clone: Record<string, unknown> = { ...s };
        delete clone.games;
        return clone;
      },
    ],
    ['wrong version number', (s) => ({ ...s, snapshotVersion: 2 })],
    ['string version', (s) => ({ ...s, snapshotVersion: '1' })],
    ['non-positive year', (s) => ({ ...s, year: 0 })],
    ['string year', (s) => ({ ...s, year: '2025' })],
    ['non-array games', (s) => ({ ...s, games: {} })],
    ['non-object game', (s) => ({ ...s, games: [...s.games, 'game'] })],
    [
      'extra game key',
      (s) => ({ ...s, games: [{ ...s.games[0]!, neutral: false }, ...s.games.slice(1)] }),
    ],
    [
      'missing game key',
      (s) => {
        const clone: Record<string, unknown> = { ...s.games[0]! };
        delete clone.key;
        return { ...s, games: [clone, ...s.games.slice(1)] };
      },
    ],
    [
      'duplicate provider game id',
      (s) => ({
        ...s,
        games: [s.games[0]!, { ...s.games[1]!, providerGameId: s.games[0]!.providerGameId }],
      }),
    ],
    ['zero provider game id', (s) => mutateFirst(s, { providerGameId: 0 })],
    ['negative provider game id', (s) => mutateFirst(s, { providerGameId: -5 })],
    ['fractional provider game id', (s) => mutateFirst(s, { providerGameId: 1.5 })],
    ['string provider game id', (s) => mutateFirst(s, { providerGameId: '5001' })],
    ['empty attachment key', (s) => mutateFirst(s, { key: '   ' })],
    ['negative provider week', (s) => mutateFirst(s, { providerWeek: -1 })],
    ['fractional provider week', (s) => mutateFirst(s, { providerWeek: 1.5 })],
    ['string provider week', (s) => mutateFirst(s, { providerWeek: '3' })],
    ['unknown season type', (s) => mutateFirst(s, { seasonType: 'preseason' })],
    ['non-object participant', (s) => mutateFirst(s, { home: 'Alpha State' })],
    [
      'extra participant key',
      (s) => mutateFirst(s, { home: { identityKey: 'k', canonicalName: 'n', level: 'FBS' } }),
    ],
    [
      'empty participant identity',
      (s) => mutateFirst(s, { home: { identityKey: ' ', canonicalName: 'n' } }),
    ],
    ['string participant id', (s) => mutateFirst(s, { homeId: '101' })],
    ['zero participant id', (s) => mutateFirst(s, { homeId: 0 })],
    ['fractional participant id', (s) => mutateFirst(s, { awayId: 1.2 })],
  ];
  for (const [label, mutate] of mutations) {
    assert.deepEqual(
      parseGameStatSlateSnapshot(mutate(validSnapshot())),
      { status: 'malformed' },
      label
    );
  }
});

function mutateFirst(snapshot: GameStatSlateSnapshot, patch: Record<string, unknown>): unknown {
  return {
    ...snapshot,
    games: [{ ...snapshot.games[0]!, ...patch }, ...snapshot.games.slice(1)],
  };
}

// === snapshotToCanonicalSlate ===

test('reconstruction: every persisted game is expected, with fixed reconstruction values', () => {
  const snapshot = validSnapshot();
  const slate = snapshotToCanonicalSlate(snapshot);

  assert.equal(slate.year, YEAR);
  assert.equal(slate.games.length, snapshot.games.length);
  for (const [index, game] of slate.games.entries()) {
    const persisted = snapshot.games[index]!;
    assert.equal(game.providerGameId, persisted.providerGameId);
    assert.equal(game.key, persisted.key);
    assert.equal(game.providerWeek, persisted.providerWeek);
    assert.equal(game.seasonType, persisted.seasonType);
    assert.deepEqual(game.home, persisted.home);
    assert.deepEqual(game.away, persisted.away);
    assert.equal(game.homeId, persisted.homeId);
    assert.equal(game.awayId, persisted.awayId);
    // Fixed reconstruction values — never schedule truth.
    assert.equal(game.applicability, 'expected');
    assert.equal(game.notExpectedReason, null);
    assert.equal(game.eventId, String(persisted.providerGameId));
    assert.equal(game.neutral, false);
    assert.equal(game.kickoff, null);
    assert.equal(game.rawStatus, null);
  }
});
