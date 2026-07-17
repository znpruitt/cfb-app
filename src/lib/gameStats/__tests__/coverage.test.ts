import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGameStatsPayload,
  deriveExpectedGameStatsIds,
  evaluateWeeklyGameStatsCompleteness,
  expectsGameStats,
  hasUsableGameStats,
  mergeWeeklyGameStats,
  usableGameStatsGameIds,
  type GameStatsScheduleItem,
} from '../coverage.ts';
import {
  resetConferenceClassificationRecords,
  setConferenceClassificationRecords,
} from '../../conferenceSubdivision.ts';
import { aggregateOwnerGameStats } from '../ownerStats.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';

function row(
  providerGameId: number,
  homeSchool = 'Alpha',
  awaySchool = 'Beta',
  // Provider-PRESENT stat fields per side (stat authority evidence): the
  // normalizer records exactly the wire-supplied categories in `raw`, so a
  // realistic row carries at least one. Pass {} to build an identity-only row.
  rawFields: Record<string, string> = { totalYards: '100' }
): GameStats {
  return {
    providerGameId,
    week: 1,
    seasonType: 'regular',
    // Only the fields coverage/merge inspect need to be real; the rest are structural.
    home: { school: homeSchool, raw: rawFields } as GameStats['home'],
    away: { school: awaySchool, raw: rawFields } as GameStats['away'],
  };
}

function record(games: GameStats[]): WeeklyGameStats {
  return {
    year: 2026,
    week: 1,
    seasonType: 'regular',
    fetchedAt: '2026-10-01T00:00:00.000Z',
    games,
  };
}

test('a missing record has no coverage', () => {
  assert.equal(hasUsableGameStats(null), false);
  assert.equal(hasUsableGameStats(undefined), false);
  assert.equal(usableGameStatsGameIds(null).size, 0);
});

test('an empty games array is not coverage (finding #3)', () => {
  assert.equal(hasUsableGameStats(record([])), false);
  assert.equal(usableGameStatsGameIds(record([])).size, 0);
});

test('rows with no positive provider id are dropped (all-dropped record is not coverage)', () => {
  assert.equal(hasUsableGameStats(record([row(0)])), false);
  assert.equal(hasUsableGameStats(record([row(-5)])), false);
});

test('usable rows are counted by their provider game id (as strings, matching ScheduleItem.id)', () => {
  const ids = usableGameStatsGameIds(record([row(101), row(0), row(102)]));
  assert.deepEqual([...ids].sort(), ['101', '102']);
  assert.equal(hasUsableGameStats(record([row(101)])), true);
});

// 5th-review finding #4 — a row needs nonempty team identities on BOTH sides.
test('a row with a blank home or away school is NOT usable (finding #4)', () => {
  assert.equal(hasUsableGameStats(record([row(101, '', 'Beta')])), false, 'blank home');
  assert.equal(hasUsableGameStats(record([row(101, 'Alpha', '')])), false, 'blank away');
  assert.equal(hasUsableGameStats(record([row(101, '   ', 'Beta')])), false, 'whitespace-only');
  // A blank-identity row does not count even alongside a usable one.
  assert.deepEqual([...usableGameStatsGameIds(record([row(101, '', ''), row(102)]))], ['102']);
});

// 5th-review finding #1 — disrupted games do not produce stats.
test('expectsGameStats excludes disrupted statuses, includes normal ones', () => {
  for (const status of ['Canceled', 'cancelled', 'Postponed', 'Suspended', 'Delayed']) {
    assert.equal(expectsGameStats(status), false, status);
  }
  for (const status of ['STATUS_FINAL', 'final', 'in progress', 'scheduled', '']) {
    assert.equal(expectsGameStats(status), true, status);
  }
});

// 5th-review finding #5 — payload classification shared by cron + manual route.
test('classifyGameStatsPayload: empty array → noop', () => {
  assert.deepEqual(classifyGameStatsPayload([], 1, 'regular'), { kind: 'noop' });
});

test('classifyGameStatsPayload: non-array → no-usable-rows (failure)', () => {
  assert.deepEqual(classifyGameStatsPayload(null, 1, 'regular'), { kind: 'no-usable-rows' });
  assert.deepEqual(classifyGameStatsPayload({ oops: true }, 1, 'regular'), {
    kind: 'no-usable-rows',
  });
});

test('classifyGameStatsPayload: nonempty payload with no usable rows → no-usable-rows', () => {
  // A row missing its away team is dropped by normalization; a row with a blank
  // school normalizes but is not usable — both leave zero usable rows.
  const raw = [
    { id: 5001, teams: [{ team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] },
    {
      id: 5002,
      teams: [
        { team: '', homeAway: 'home', points: 10, stats: [] },
        { team: '', homeAway: 'away', points: 7, stats: [] },
      ],
    },
  ];
  assert.deepEqual(classifyGameStatsPayload(raw, 1, 'regular'), { kind: 'no-usable-rows' });
});

test('classifyGameStatsPayload: ≥1 usable row → commit with the normalized games', () => {
  const raw = [
    {
      id: 5001,
      teams: [
        { team: 'Alpha', homeAway: 'home', points: 21, stats: [] },
        { team: 'Beta', homeAway: 'away', points: 14, stats: [] },
      ],
    },
  ];
  const result = classifyGameStatsPayload(raw, 1, 'regular');
  assert.equal(result.kind, 'commit');
  assert.equal(result.kind === 'commit' && result.games.length, 1);
});

// === PLATFORM-086H — schedule-relative expected coverage ===

function scheduleItem(overrides: Partial<GameStatsScheduleItem> = {}): GameStatsScheduleItem {
  return {
    id: '101',
    week: 1,
    seasonType: 'regular',
    status: 'STATUS_FINAL',
    homeTeam: 'Alpha',
    awayTeam: 'Beta',
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    ...overrides,
  };
}

test('expected ids come from schedule ids scoped to the exact week + season type', () => {
  const items = [
    scheduleItem({ id: '101', week: 1 }),
    scheduleItem({ id: '102', week: 2 }),
    scheduleItem({ id: '103', week: 1, seasonType: 'postseason' }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular');
  assert.equal(slate.hasScheduleEvidence, true);
  assert.deepEqual([...slate.expectedIds], ['101']);
});

test('no schedule rows for the slate → no schedule evidence (never "complete")', () => {
  const slate = deriveExpectedGameStatsIds([scheduleItem({ week: 2 })], 1, 'regular');
  assert.equal(slate.hasScheduleEvidence, false);
  assert.equal(slate.expectedIds.size, 0);
});

test('disrupted terminal dispositions are not expected (canceled / postponed)', () => {
  const items = [
    scheduleItem({ id: '101', status: 'Canceled' }),
    scheduleItem({ id: '102', status: 'STATUS_POSTPONED' }),
    scheduleItem({ id: '103', status: 'STATUS_FINAL' }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular');
  assert.equal(slate.hasScheduleEvidence, true);
  assert.deepEqual([...slate.expectedIds], ['103']);
});

test('unresolved placeholders are not expected; a resolved postseason matchup is', () => {
  const items = [
    scheduleItem({ id: '201', seasonType: 'postseason', awayTeam: 'TBD' }),
    scheduleItem({ id: '202', seasonType: 'postseason', homeTeam: 'Winner of Rose Bowl' }),
    scheduleItem({
      id: '203',
      seasonType: 'postseason',
      homeTeam: 'College Football Playoff Quarterfinal 1',
    }),
    scheduleItem({ id: '204', seasonType: 'postseason', homeTeam: 'Alpha', awayTeam: 'Beta' }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'postseason');
  assert.deepEqual([...slate.expectedIds], ['204']);
});

test('FCS-vs-FCS is excluded by classification; FBS-vs-FCS and unknowns stay expected', () => {
  const items = [
    scheduleItem({ id: '301', homeConference: 'Big Sky', awayConference: 'Big Sky' }),
    scheduleItem({ id: '302', homeConference: 'SEC', awayConference: 'Big Sky' }),
    // Unknown conferences never positively classify as FCS → not excluded.
    scheduleItem({ id: '303', homeConference: 'X', awayConference: 'Y' }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular');
  assert.deepEqual([...slate.expectedIds].sort(), ['302', '303']);
});

test('a schedule row with no id is unverifiable, never expected', () => {
  const slate = deriveExpectedGameStatsIds([scheduleItem({ id: '' })], 1, 'regular');
  assert.equal(slate.hasScheduleEvidence, true);
  assert.equal(slate.expectedIds.size, 0);
  assert.equal(slate.unverifiableCount, 1);
});

// Review remediation — only provider-addressable (positive numeric) ids can be
// expected: coverage rows only ever carry positive numeric provider ids, so a
// synthetic/malformed schedule id could never be covered and would leave the
// slate permanently incomplete.

test('synthetic, zero, negative, and malformed ids are unverifiable — not expected', () => {
  for (const id of ['3-Alpha-Beta', '0', '-5', 'abc', '12.5', ' ']) {
    const slate = deriveExpectedGameStatsIds([scheduleItem({ id })], 1, 'regular');
    assert.equal(slate.expectedIds.size, 0, `id ${JSON.stringify(id)} must not be expected`);
    assert.equal(slate.unverifiableCount, 1, `id ${JSON.stringify(id)} counts as unverifiable`);
  }
  const valid = deriveExpectedGameStatsIds([scheduleItem({ id: '101' })], 1, 'regular');
  assert.deepEqual([...valid.expectedIds], ['101']);
  assert.equal(valid.unverifiableCount, 0);
});

test('a non-stat-producing row with a synthetic id is excluded, not unverifiable', () => {
  const slate = deriveExpectedGameStatsIds(
    [scheduleItem({ id: '3-Alpha-Beta', status: 'Canceled' })],
    1,
    'regular'
  );
  assert.equal(slate.expectedIds.size, 0);
  assert.equal(
    slate.unverifiableCount,
    0,
    'a disrupted game is not "unverifiable" — it expects no stats'
  );
});

test('unverifiable rows never suppress completeness of the verifiable coverage', () => {
  const items = [
    scheduleItem({ id: '101' }),
    scheduleItem({ id: '3-Alpha-Beta' }), // synthetic fallback id — unverifiable
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular');
  assert.deepEqual([...slate.expectedIds], ['101']);
  assert.equal(slate.unverifiableCount, 1);
  // The covered verifiable game makes the week COMPLETE — the unverifiable row
  // stays out of the denominator, so it cannot cause endless weekly recovery.
  assert.deepEqual(evaluate(items, [row(101)]), { state: 'complete', expectedCount: 1 });
});

test('a slate of only unverifiable rows expects nothing (no permanent partial coverage)', () => {
  assert.deepEqual(evaluate([scheduleItem({ id: '3-Alpha-Beta' })], null), {
    state: 'no-expected-games',
  });
});

// Review remediation — expected coverage is decided by POSITIVE, deterministic
// evidence only: the shared placeholder patterns (extended with TBA / "to be
// announced|determined") and the static conference policy. A pattern-valid but
// unknown participant STAYS expected — the FBS-only catalog cannot disprove a
// real FCS opponent, and wrongly excluding a real game would falsely complete
// the week and silently suppress recovery.

test('placeholder-labeled matchups are not expected (TBD / TBA / to-be-announced / determined)', () => {
  for (const label of [
    'TBD',
    'Home Team TBA',
    'To Be Announced',
    'To Be Determined',
    'Winner of Rose Bowl',
    'College Football Playoff Quarterfinal 1',
  ]) {
    const items = [scheduleItem({ id: '101', awayTeam: label, awayConference: '' })];
    const slate = deriveExpectedGameStatsIds(items, 1, 'regular');
    assert.equal(slate.expectedIds.size, 0, `label ${JSON.stringify(label)} must not be expected`);
  }
});

test('an FBS-vs-unknown opponent with an EMPTY conference stays expected', () => {
  // The catalog is FBS-only, so an absent conference cannot disprove a real
  // (e.g. FCS) opponent — excluding it would falsely complete the week.
  const items = [scheduleItem({ id: '101', awayTeam: 'Mystery College', awayConference: '' })];
  assert.deepEqual([...deriveExpectedGameStatsIds(items, 1, 'regular').expectedIds], ['101']);
});

test('an FBS-vs-unknown opponent with an UNRECOGNIZED conference stays expected', () => {
  const items = [
    scheduleItem({ id: '101', awayTeam: 'Mystery College', awayConference: 'Frontier League' }),
  ];
  assert.deepEqual([...deriveExpectedGameStatsIds(items, 1, 'regular').expectedIds], ['101']);
});

test('an FBS-vs-known-FCS matchup stays expected', () => {
  const items = [scheduleItem({ id: '101', awayTeam: 'Montana State', awayConference: 'Big Sky' })];
  assert.deepEqual([...deriveExpectedGameStatsIds(items, 1, 'regular').expectedIds], ['101']);
});

test('FCS-vs-FCS is excluded only by the static policy classification of BOTH sides', () => {
  const excluded = deriveExpectedGameStatsIds(
    [
      scheduleItem({
        id: '101',
        homeTeam: 'Montana',
        awayTeam: 'Montana State',
        homeConference: 'Big Sky',
        awayConference: 'Big Sky',
      }),
    ],
    1,
    'regular'
  );
  assert.equal(excluded.expectedIds.size, 0);
});

test('expected coverage is deterministic across mutable conference-index mutation', () => {
  // A conference only the (mutable) CFBD record index would classify as FCS:
  // loading or resetting those records — as unrelated schedule builds do in the
  // same process — must not change the derivation.
  const items = [
    scheduleItem({
      id: '101',
      homeTeam: 'Mystery A',
      awayTeam: 'Mystery B',
      homeConference: 'Frontier League',
      awayConference: 'Frontier League',
    }),
  ];
  const before = deriveExpectedGameStatsIds(items, 1, 'regular');
  setConferenceClassificationRecords([{ id: 999, name: 'Frontier League', classification: 'fcs' }]);
  try {
    const during = deriveExpectedGameStatsIds(items, 1, 'regular');
    assert.deepEqual([...during.expectedIds], [...before.expectedIds]);
  } finally {
    resetConferenceClassificationRecords();
  }
  const after = deriveExpectedGameStatsIds(items, 1, 'regular');
  assert.deepEqual([...after.expectedIds], [...before.expectedIds]);
  assert.deepEqual(
    [...before.expectedIds],
    ['101'],
    'static policy alone decides — stays expected'
  );
});

// === PLATFORM-086H — weekly completeness contract (finding #5) ===

function evaluate(
  items: GameStatsScheduleItem[],
  games: GameStats[] | null
): ReturnType<typeof evaluateWeeklyGameStatsCompleteness> {
  return evaluateWeeklyGameStatsCompleteness({
    scheduleItems: items,
    week: 1,
    seasonType: 'regular',
    record: games === null ? null : record(games),
  });
}

test('completeness: schedule evidence unavailable is its own state, never complete', () => {
  assert.deepEqual(evaluate([], [row(101)]), { state: 'schedule-unavailable' });
});

test('completeness: a slate with no expected games is not applicable', () => {
  assert.deepEqual(evaluate([scheduleItem({ status: 'Canceled' })], null), {
    state: 'no-expected-games',
  });
});

test('completeness: expected games with no usable rows', () => {
  const items = [scheduleItem({ id: '101' }), scheduleItem({ id: '102' })];
  assert.deepEqual(evaluate(items, null), {
    state: 'no-usable-rows',
    expectedCount: 2,
    missingIds: ['101', '102'],
  });
  // A record whose every row is unusable is equivalent to no rows.
  assert.equal(evaluate(items, [row(101, '', '')]).state, 'no-usable-rows');
});

test('completeness: a subset of expected coverage is PARTIAL, not complete (finding #5)', () => {
  const items = [scheduleItem({ id: '101' }), scheduleItem({ id: '102' })];
  assert.deepEqual(evaluate(items, [row(101)]), {
    state: 'partial',
    expectedCount: 2,
    coveredCount: 1,
    missingIds: ['102'],
  });
});

test('completeness: complete only when EVERY expected id has a usable row', () => {
  const items = [
    scheduleItem({ id: '101' }),
    scheduleItem({ id: '102' }),
    // Non-expected games (disrupted) do not block completeness.
    scheduleItem({ id: '103', status: 'Postponed' }),
  ];
  assert.deepEqual(evaluate(items, [row(101), row(102)]), {
    state: 'complete',
    expectedCount: 2,
  });
});

// === PLATFORM-086H — merge without regression (requirement 4) ===

test('merge: rows for new game ids are appended and counted as committed', () => {
  const merge = mergeWeeklyGameStats(null, [row(101), row(102)]);
  assert.equal(merge.changed, true);
  assert.equal(merge.rowsCommitted, 2);
  assert.equal(merge.rowsRetained, 0);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 102]
  );
});

test('merge: prior rows omitted by a partial response are retained, never deleted', () => {
  const prior = record([row(101), row(102)]);
  const merge = mergeWeeklyGameStats(prior, [row(103)]);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 102, 103]
  );
  assert.equal(merge.rowsCommitted, 1);
  assert.equal(merge.rowsRetained, 2);
});

test('merge: an empty recovery response changes nothing and retains all prior rows', () => {
  const prior = record([row(101), row(102)]);
  const merge = mergeWeeklyGameStats(prior, []);
  assert.equal(merge.changed, false);
  assert.equal(merge.rowsRetained, 2);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 102]
  );
});

test('merge: identical incoming rows are a no-change (no rewrite, no invalidation)', () => {
  const prior = record([row(101), row(102)]);
  const merge = mergeWeeklyGameStats(prior, [row(101), row(102)]);
  assert.equal(merge.changed, false);
  assert.equal(merge.rowsCommitted, 0);
});

test('merge: a changed usable row replaces the prior row for the same game id', () => {
  const prior = record([row(101, 'Alpha', 'Beta'), row(102)]);
  const updated = row(101, 'Alpha Corrected', 'Beta');
  const merge = mergeWeeklyGameStats(prior, [updated]);
  assert.equal(merge.changed, true);
  assert.equal(merge.rowsCommitted, 1);
  assert.equal(merge.games[0].home.school, 'Alpha Corrected');
  assert.equal(merge.games[1].providerGameId, 102, 'the untouched prior row is retained in place');
});

test('merge: an UNUSABLE incoming row never clobbers a usable prior row', () => {
  const prior = record([row(101, 'Alpha', 'Beta')]);
  const merge = mergeWeeklyGameStats(prior, [row(101, '', '')]);
  assert.equal(merge.changed, false);
  assert.equal(merge.games[0].home.school, 'Alpha', 'the usable prior row survives');
});

test('merge: a usable incoming row repairs a previously unusable prior row', () => {
  const prior = record([row(101, '', '')]);
  const merge = mergeWeeklyGameStats(prior, [row(101, 'Alpha', 'Beta')]);
  assert.equal(merge.changed, true);
  assert.equal(merge.rowsCommitted, 1);
  assert.equal(merge.games[0].home.school, 'Alpha');
});

// Review remediation — incoming rows without a canonical merge key are never
// persisted: they could never be replaced or deduplicated, so every recovery
// run of a still-incomplete week would append another copy.

test('merge: incoming rows without a canonical merge key are dropped, valid rows persist', () => {
  const prior = record([row(101)]);
  const keylessNonNumeric = { ...row(102), providerGameId: 'abc' as unknown as number };
  const merge = mergeWeeklyGameStats(prior, [row(0), row(-5), keylessNonNumeric, row(103)]);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 103],
    'only the prior-good row and the valid incoming row are persisted'
  );
  assert.equal(merge.rowsDroppedKeyless, 3);
  assert.equal(merge.rowsCommitted, 1);
});

test('merge: repeated recovery with the same malformed row never accumulates duplicates', () => {
  const first = mergeWeeklyGameStats(null, [row(101), row(-5)]);
  assert.deepEqual(
    first.games.map((g) => g.providerGameId),
    [101]
  );
  const second = mergeWeeklyGameStats(record(first.games), [row(101), row(-5)]);
  assert.equal(second.changed, false, 'the repeated malformed row forces no rewrite');
  assert.deepEqual(
    second.games.map((g) => g.providerGameId),
    [101],
    'no duplicate accumulates across recovery runs'
  );
});

// Review remediation — merge identity is separate from STAT AUTHORITY: a row's
// authority comes from provider-PRESENT stat fields (`raw`, recorded before
// omitted categories are normalized to zero), never from nonzero values.

test('merge: an identity-only incoming row never replaces prior populated statistics', () => {
  const prior = record([row(101)]);
  const identityOnly = row(101, 'Alpha', 'Beta', {});
  const merge = mergeWeeklyGameStats(prior, [identityOnly]);
  assert.equal(merge.changed, false);
  assert.deepEqual(merge.games[0].home.raw, { totalYards: '100' }, 'prior stats survive');
});

test('merge: an identity-only incoming row is not persisted when no prior row exists', () => {
  const merge = mergeWeeklyGameStats(null, [row(101, 'Alpha', 'Beta', {})]);
  assert.equal(merge.changed, false);
  assert.deepEqual(merge.games, [], 'zero-filled identity-only rows are never authoritative');
  assert.equal(merge.rowsDroppedStatless, 1);
});

test('merge: weaker present-field coverage never replaces stronger prior coverage', () => {
  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '350', rushingYards: '150' })]);
  const weaker = row(101, 'Alpha', 'Beta', { totalYards: '10' });
  const merge = mergeWeeklyGameStats(prior, [weaker]);
  assert.equal(merge.changed, false);
  assert.equal(merge.games[0].home.raw.totalYards, '350', 'the stronger prior row is retained');
});

test('merge: explicitly supplied zero-valued statistics are valid authority', () => {
  // A present "0" is real data, not an omission — it persists and can replace
  // an equal-coverage prior row.
  const fresh = mergeWeeklyGameStats(null, [row(101, 'Alpha', 'Beta', { totalYards: '0' })]);
  assert.equal(fresh.changed, true);
  assert.equal(fresh.games[0].home.raw.totalYards, '0');

  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '100' })]);
  const zeroUpdate = row(101, 'Alpha', 'Beta', { totalYards: '0' });
  const replaced = mergeWeeklyGameStats(prior, [zeroUpdate]);
  assert.equal(replaced.changed, true, 'equal-coverage explicit zeros replace normally');
  assert.equal(replaced.games[0].home.raw.totalYards, '0');
});

test('merge: equal or stronger present-field coverage still replaces normally', () => {
  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '100' })]);
  const stronger = row(101, 'Alpha', 'Beta', { totalYards: '120', rushingYards: '60' });
  const merge = mergeWeeklyGameStats(prior, [stronger]);
  assert.equal(merge.changed, true);
  assert.equal(merge.rowsCommitted, 1);
  assert.equal(merge.games[0].home.raw.rushingYards, '60');
});

test('merge: dropped keyless rows cannot inflate owner aggregation', () => {
  // Two recovery passes carrying the same malformed keyless duplicate: the
  // merged record holds ONE game, so the owner is credited exactly once.
  const first = mergeWeeklyGameStats(null, [row(101, 'Alpha', 'Beta'), row(0, 'Alpha', 'Beta')]);
  const second = mergeWeeklyGameStats(record(first.games), [
    row(101, 'Alpha', 'Beta'),
    row(0, 'Alpha', 'Beta'),
  ]);
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  const owners = aggregateOwnerGameStats(second.games, new Map([['Alpha', 'OwnerA']]), resolver);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].owner, 'OwnerA');
  assert.equal(owners[0].gamesPlayed, 1, 'the keyless duplicate never reaches aggregation');
});
