import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGameStatsPayload,
  deriveExpectedGameStatsIds,
  evaluateWeeklyGameStatsCompleteness,
  expectsGameStats,
  hasCompleteStatCoverage,
  hasUsableGameStats,
  isAuthoritativeGameStatsRow,
  mergeWeeklyGameStats,
  usableGameStatsGameIds,
  type GameStatsScheduleItem,
} from '../coverage.ts';
import {
  resetConferenceClassificationRecords,
  setConferenceClassificationRecords,
} from '../../conferenceSubdivision.ts';
import { ANALYTICS_REQUIRED_CATEGORIES, RECOGNIZED_STAT_CATEGORIES } from '../normalizers.ts';
import { aggregateOwnerGameStats, aggregateOwnerSeasonStats } from '../ownerStats.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';

function row(
  providerGameId: number,
  homeSchool = 'Alpha',
  awaySchool = 'Beta',
  // Provider-PRESENT stat fields per side (stat authority evidence): the
  // normalizer records exactly the wire-supplied categories in `raw`, so a
  // realistic row carries at least one. Pass {} to build an identity-only row.
  rawFields: Record<string, string> = FULL_RAW
): GameStats {
  return {
    providerGameId,
    week: 1,
    seasonType: 'regular',
    // Only the fields coverage/merge inspect need to be real; the rest are structural.
    home: { school: homeSchool, raw: rawFields } as unknown as GameStats['home'],
    away: { school: awaySchool, raw: rawFields } as unknown as GameStats['away'],
  };
}

/** Every analytics-required category present — a COMPLETE side. */
const FULL_RAW: Record<string, string> = {
  netPassingYards: '210',
  possessionTime: '30:00',
  rushingYards: '150',
  thirdDownEff: '6-14',
  totalYards: '360',
  turnovers: '1',
};

/** All required categories explicitly zero — complete, and legitimately so. */
const FULL_RAW_ZEROS: Record<string, string> = {
  netPassingYards: '0',
  possessionTime: '0:00',
  rushingYards: '0',
  thirdDownEff: '0-0',
  totalYards: '0',
  turnovers: '0',
};

// Observation window provably later than every fixture record's fetchedAt
// ('2026-10-01…'), so persistence-level merge tests exercise replacement rules
// without the overlap fence rejecting them (fencing has its own tests below).
const LATER_OBSERVATION = { fetchStartedAt: '2026-10-02T00:00:00.000Z' };
const mergeLater = (
  prior: WeeklyGameStats | null,
  incoming: readonly GameStats[]
): ReturnType<typeof mergeWeeklyGameStats> =>
  mergeWeeklyGameStats(prior, incoming, LATER_OBSERVATION);

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

const WIRE_STATS = [{ category: 'totalYards', stat: '100' }];

test('classifyGameStatsPayload: ≥1 authoritative row → commit with the normalized games', () => {
  const raw = [
    {
      id: 5001,
      teams: [
        { team: 'Alpha', homeAway: 'home', points: 21, stats: WIRE_STATS },
        { team: 'Beta', homeAway: 'away', points: 14, stats: WIRE_STATS },
      ],
    },
  ];
  const result = classifyGameStatsPayload(raw, 1, 'regular');
  assert.equal(result.kind, 'commit');
  assert.equal(result.kind === 'commit' && result.games.length, 1);
});

// Adversarial-review remediation — schema drift is distinguished from
// unpublished data: usable identity with zero AUTHORITATIVE rows is a visible
// target-local failure, never a silent acceptance of zero-filled stats.
test('classifyGameStatsPayload: identity-only or unknown-category rows → no-authoritative-rows', () => {
  const identityOnly = [
    {
      id: 5001,
      teams: [
        { team: 'Alpha', homeAway: 'home', points: 21, stats: [] },
        { team: 'Beta', homeAway: 'away', points: 14, stats: [] },
      ],
    },
  ];
  assert.deepEqual(classifyGameStatsPayload(identityOnly, 1, 'regular'), {
    kind: 'no-authoritative-rows',
  });

  const unknownOnly = [
    {
      id: 5001,
      teams: [
        {
          team: 'Alpha',
          homeAway: 'home',
          points: 21,
          stats: [{ category: 'rushYds', stat: '150' }],
        },
        {
          team: 'Beta',
          homeAway: 'away',
          points: 14,
          stats: [{ category: 'rushYds', stat: '80' }],
        },
      ],
    },
  ];
  assert.deepEqual(classifyGameStatsPayload(unknownOnly, 1, 'regular'), {
    kind: 'no-authoritative-rows',
  });
});

test('classifyGameStatsPayload: a mixed payload commits; the merge drops the drifted row', () => {
  const mixed = [
    {
      id: 5001,
      teams: [
        { team: 'Alpha', homeAway: 'home', points: 21, stats: WIRE_STATS },
        { team: 'Beta', homeAway: 'away', points: 14, stats: WIRE_STATS },
      ],
    },
    {
      id: 5002,
      teams: [
        { team: 'Gamma', homeAway: 'home', points: 10, stats: [] },
        { team: 'Delta', homeAway: 'away', points: 7, stats: [] },
      ],
    },
  ];
  const result = classifyGameStatsPayload(mixed, 1, 'regular');
  assert.equal(result.kind, 'commit');
  if (result.kind === 'commit') {
    const merge = mergeLater(null, result.games);
    assert.deepEqual(
      merge.games.map((g) => g.providerGameId),
      [5001],
      'only the authoritative row persists'
    );
    assert.equal(merge.rowsDroppedStatless, 1);
  }
});

// === PLATFORM-086H — schedule-relative expected coverage ===

const NOW = Date.parse('2026-10-15T12:00:00.000Z');

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
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
  assert.equal(slate.hasScheduleEvidence, true);
  assert.deepEqual([...slate.expectedIds], ['101']);
});

test('no schedule rows for the slate → no schedule evidence (never "complete")', () => {
  const slate = deriveExpectedGameStatsIds([scheduleItem({ week: 2 })], 1, 'regular', NOW);
  assert.equal(slate.hasScheduleEvidence, false);
  assert.equal(slate.expectedIds.size, 0);
});

test('disrupted terminal dispositions are not expected (canceled / postponed)', () => {
  const items = [
    scheduleItem({ id: '101', status: 'Canceled' }),
    scheduleItem({ id: '102', status: 'STATUS_POSTPONED' }),
    scheduleItem({ id: '103', status: 'STATUS_FINAL' }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
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
  const slate = deriveExpectedGameStatsIds(items, 1, 'postseason', NOW);
  assert.deepEqual([...slate.expectedIds], ['204']);
});

test('FCS-vs-FCS is excluded by classification; FBS-vs-FCS and unknowns stay expected', () => {
  const items = [
    scheduleItem({ id: '301', homeConference: 'Big Sky', awayConference: 'Big Sky' }),
    scheduleItem({ id: '302', homeConference: 'SEC', awayConference: 'Big Sky' }),
    // Unknown conferences never positively classify as FCS → not excluded.
    scheduleItem({ id: '303', homeConference: 'X', awayConference: 'Y' }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
  assert.deepEqual([...slate.expectedIds].sort(), ['302', '303']);
});

test('a schedule row with no id is unverifiable, never expected', () => {
  const slate = deriveExpectedGameStatsIds([scheduleItem({ id: '' })], 1, 'regular', NOW);
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
    const slate = deriveExpectedGameStatsIds([scheduleItem({ id })], 1, 'regular', NOW);
    assert.equal(slate.expectedIds.size, 0, `id ${JSON.stringify(id)} must not be expected`);
    assert.equal(slate.unverifiableCount, 1, `id ${JSON.stringify(id)} counts as unverifiable`);
  }
  const valid = deriveExpectedGameStatsIds([scheduleItem({ id: '101' })], 1, 'regular', NOW);
  assert.deepEqual([...valid.expectedIds], ['101']);
  assert.equal(valid.unverifiableCount, 0);
});

test('a non-stat-producing row with a synthetic id is excluded, not unverifiable', () => {
  const slate = deriveExpectedGameStatsIds(
    [scheduleItem({ id: '3-Alpha-Beta', status: 'Canceled' })],
    1,
    'regular',
    NOW
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
  const slate = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
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
    const slate = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
    assert.equal(slate.expectedIds.size, 0, `label ${JSON.stringify(label)} must not be expected`);
  }
});

test('an FBS-vs-unknown opponent with an EMPTY conference stays expected', () => {
  // The catalog is FBS-only, so an absent conference cannot disprove a real
  // (e.g. FCS) opponent — excluding it would falsely complete the week.
  const items = [scheduleItem({ id: '101', awayTeam: 'Mystery College', awayConference: '' })];
  assert.deepEqual([...deriveExpectedGameStatsIds(items, 1, 'regular', NOW).expectedIds], ['101']);
});

test('an FBS-vs-unknown opponent with an UNRECOGNIZED conference stays expected', () => {
  const items = [
    scheduleItem({ id: '101', awayTeam: 'Mystery College', awayConference: 'Frontier League' }),
  ];
  assert.deepEqual([...deriveExpectedGameStatsIds(items, 1, 'regular', NOW).expectedIds], ['101']);
});

test('an FBS-vs-known-FCS matchup stays expected', () => {
  const items = [scheduleItem({ id: '101', awayTeam: 'Montana State', awayConference: 'Big Sky' })];
  assert.deepEqual([...deriveExpectedGameStatsIds(items, 1, 'regular', NOW).expectedIds], ['101']);
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
    'regular',
    NOW
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
  const before = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
  setConferenceClassificationRecords([{ id: 999, name: 'Frontier League', classification: 'fcs' }]);
  try {
    const during = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
    assert.deepEqual([...during.expectedIds], [...before.expectedIds]);
  } finally {
    resetConferenceClassificationRecords();
  }
  const after = deriveExpectedGameStatsIds(items, 1, 'regular', NOW);
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
    now: NOW,
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
  const merge = mergeLater(null, [row(101), row(102)]);
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
  const merge = mergeLater(prior, [row(103)]);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 102, 103]
  );
  assert.equal(merge.rowsCommitted, 1);
  assert.equal(merge.rowsRetained, 2);
});

test('merge: an empty recovery response changes nothing and retains all prior rows', () => {
  const prior = record([row(101), row(102)]);
  const merge = mergeLater(prior, []);
  assert.equal(merge.changed, false);
  assert.equal(merge.rowsRetained, 2);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 102]
  );
});

test('merge: identical incoming rows are a no-change (no rewrite, no invalidation)', () => {
  const prior = record([row(101), row(102)]);
  const merge = mergeLater(prior, [row(101), row(102)]);
  assert.equal(merge.changed, false);
  assert.equal(merge.rowsCommitted, 0);
});

test('merge: a changed usable row replaces the prior row for the same game id', () => {
  const prior = record([row(101, 'Alpha', 'Beta'), row(102)]);
  const updated = row(101, 'Alpha Corrected', 'Beta');
  const merge = mergeLater(prior, [updated]);
  assert.equal(merge.changed, true);
  assert.equal(merge.rowsCommitted, 1);
  assert.equal(merge.games[0].home.school, 'Alpha Corrected');
  assert.equal(merge.games[1].providerGameId, 102, 'the untouched prior row is retained in place');
});

test('merge: an UNUSABLE incoming row never clobbers a usable prior row', () => {
  const prior = record([row(101, 'Alpha', 'Beta')]);
  const merge = mergeLater(prior, [row(101, '', '')]);
  assert.equal(merge.changed, false);
  assert.equal(merge.games[0].home.school, 'Alpha', 'the usable prior row survives');
});

test('merge: a usable incoming row repairs a previously unusable prior row', () => {
  const prior = record([row(101, '', '')]);
  const merge = mergeLater(prior, [row(101, 'Alpha', 'Beta')]);
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
  const merge = mergeLater(prior, [row(0), row(-5), keylessNonNumeric, row(103)]);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 103],
    'only the prior-good row and the valid incoming row are persisted'
  );
  assert.equal(merge.rowsDroppedKeyless, 3);
  assert.equal(merge.rowsCommitted, 1);
});

test('merge: repeated recovery with the same malformed row never accumulates duplicates', () => {
  const first = mergeLater(null, [row(101), row(-5)]);
  assert.deepEqual(
    first.games.map((g) => g.providerGameId),
    [101]
  );
  const second = mergeLater(record(first.games), [row(101), row(-5)]);
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
  const merge = mergeLater(prior, [identityOnly]);
  assert.equal(merge.changed, false);
  assert.deepEqual(merge.games[0].home.raw, FULL_RAW, 'prior stats survive');
});

test('merge: an identity-only incoming row is not persisted when no prior row exists', () => {
  const merge = mergeLater(null, [row(101, 'Alpha', 'Beta', {})]);
  assert.equal(merge.changed, false);
  assert.deepEqual(merge.games, [], 'zero-filled identity-only rows are never authoritative');
  assert.equal(merge.rowsDroppedStatless, 1);
});

test('merge: weaker present-field coverage never replaces stronger prior coverage', () => {
  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '350', rushingYards: '150' })]);
  const weaker = row(101, 'Alpha', 'Beta', { totalYards: '10' });
  const merge = mergeLater(prior, [weaker]);
  assert.equal(merge.changed, false);
  assert.equal(merge.games[0].home.raw.totalYards, '350', 'the stronger prior row is retained');
});

test('merge: explicitly supplied zero-valued statistics are valid authority', () => {
  // A present "0" is real data, not an omission — it persists and can replace
  // an equal-coverage prior row.
  const fresh = mergeLater(null, [row(101, 'Alpha', 'Beta', { totalYards: '0' })]);
  assert.equal(fresh.changed, true);
  assert.equal(fresh.games[0].home.raw.totalYards, '0');

  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '100' })]);
  const zeroUpdate = row(101, 'Alpha', 'Beta', { totalYards: '0' });
  const replaced = mergeLater(prior, [zeroUpdate]);
  assert.equal(replaced.changed, true, 'equal-coverage explicit zeros replace normally');
  assert.equal(replaced.games[0].home.raw.totalYards, '0');
});

test('merge: equal or stronger present-field coverage still replaces normally', () => {
  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '100' })]);
  const stronger = row(101, 'Alpha', 'Beta', { totalYards: '120', rushingYards: '60' });
  const merge = mergeLater(prior, [stronger]);
  assert.equal(merge.changed, true);
  assert.equal(merge.rowsCommitted, 1);
  assert.equal(merge.games[0].home.raw.rushingYards, '60');
});

test('merge: dropped keyless rows cannot inflate owner aggregation', () => {
  // Two recovery passes carrying the same malformed keyless duplicate: the
  // merged record holds ONE game, so the owner is credited exactly once.
  const first = mergeLater(null, [row(101, 'Alpha', 'Beta'), row(0, 'Alpha', 'Beta')]);
  const second = mergeLater(record(first.games), [
    row(101, 'Alpha', 'Beta'),
    row(0, 'Alpha', 'Beta'),
  ]);
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  const owners = aggregateOwnerGameStats(second.games, new Map([['Alpha', 'OwnerA']]), resolver);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].owner, 'OwnerA');
  assert.equal(owners[0].gamesPlayed, 1, 'the keyless duplicate never reaches aggregation');
});

// === Review remediation — canonical stat authority + per-side category sets ===

test('isAuthoritativeGameStatsRow: identity-only rows are not authoritative; explicit zeros are', () => {
  assert.equal(isAuthoritativeGameStatsRow(row(101)), true);
  assert.equal(isAuthoritativeGameStatsRow(row(101, 'Alpha', 'Beta', {})), false, 'identity-only');
  assert.equal(
    isAuthoritativeGameStatsRow(row(101, 'Alpha', 'Beta', { totalYards: '0' })),
    true,
    'an explicitly supplied zero is present provider data'
  );
  assert.equal(isAuthoritativeGameStatsRow(row(0)), false, 'keyless');
  assert.equal(isAuthoritativeGameStatsRow(row(101, '', 'Beta')), false, 'unusable identity');
});

test('coverage requires stat authority: a legacy identity-only cached row is NOT covered', () => {
  const legacy = record([row(101, 'Alpha', 'Beta', {})]);
  assert.equal(usableGameStatsGameIds(legacy).size, 0);
  // The scheduled game therefore stays recovery-eligible instead of "complete".
  assert.deepEqual(evaluate([scheduleItem({ id: '101' })], legacy.games), {
    state: 'no-usable-rows',
    expectedCount: 1,
    missingIds: ['101'],
  });
});

test('a legacy statless row is repaired naturally by a later authoritative row', () => {
  const legacy = record([row(101, 'Alpha', 'Beta', {})]);
  const repaired = mergeLater(legacy, [row(101)]);
  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.games[0].home.raw, FULL_RAW);
  // Another identity-only response is a truthful no-op: nothing rewritten.
  const stillLegacy = mergeLater(legacy, [row(101, 'Alpha', 'Beta', {})]);
  assert.equal(stillLegacy.changed, false);
  assert.deepEqual(stillLegacy.games, legacy.games, 'prior rows retained untouched');
});

test('merge: equal-count but DIFFERENT category sets never replace prior data', () => {
  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '350' })]);
  const differentSet = row(101, 'Alpha', 'Beta', { rushingYards: '150' });
  const merge = mergeLater(prior, [differentSet]);
  assert.equal(merge.changed, false);
  assert.equal(merge.games[0].home.raw.totalYards, '350', 'cached categories are never erased');
});

test('merge: complementary non-superset category sets retain the prior row', () => {
  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '350', firstDowns: '20' })]);
  const complementary = row(101, 'Alpha', 'Beta', { rushingYards: '150', firstDowns: '21' });
  const merge = mergeLater(prior, [complementary]);
  assert.equal(merge.changed, false, 'no synthetic field-merge; whole-row replace or nothing');
  assert.equal(merge.games[0].home.raw.totalYards, '350');
});

test('merge: a strict per-side category superset replaces; incoming values win', () => {
  const prior = record([row(101, 'Alpha', 'Beta', { totalYards: '350' })]);
  const superset = row(101, 'Alpha', 'Beta', { totalYards: '360', rushingYards: '150' });
  const merge = mergeLater(prior, [superset]);
  assert.equal(merge.changed, true);
  assert.equal(merge.games[0].home.raw.totalYards, '360');
  assert.equal(merge.games[0].home.raw.rushingYards, '150');
});

test('merge: home and away category coverage are evaluated independently', () => {
  const prior: GameStats = {
    providerGameId: 101,
    week: 1,
    seasonType: 'regular',
    home: { school: 'Alpha', raw: { totalYards: '350' } } as unknown as GameStats['home'],
    away: {
      school: 'Beta',
      raw: { totalYards: '280', firstDowns: '18' },
    } as unknown as GameStats['away'],
  };
  // Home side is a superset, but the away side LOST firstDowns → retained.
  const incoming: GameStats = {
    providerGameId: 101,
    week: 1,
    seasonType: 'regular',
    home: {
      school: 'Alpha',
      raw: { totalYards: '360', rushingYards: '150' },
    } as unknown as GameStats['home'],
    away: { school: 'Beta', raw: { totalYards: '290' } } as unknown as GameStats['away'],
  };
  const merge = mergeLater(record([prior]), [incoming]);
  assert.equal(merge.changed, false, 'one weaker side blocks the whole-row replacement');
  assert.equal(merge.games[0].away.raw.firstDowns, '18');
});

test('analytics ignore legacy statless and keyless rows; authoritative zeros still count', () => {
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  const roster = new Map([['Alpha', 'OwnerA']]);
  const games = [
    row(101, 'Alpha', 'Beta', FULL_RAW_ZEROS), // complete explicit-zero row
    row(102, 'Alpha', 'Beta', {}), // legacy identity-only zero-fill
    row(0, 'Alpha', 'Beta'), // keyless/malformed legacy row
    row(103, '', ''), // unusable identity
  ];
  const weekly = aggregateOwnerGameStats(games, roster, resolver);
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].gamesPlayed, 1, 'only the authoritative row is counted');

  const season = aggregateOwnerSeasonStats([games], roster, resolver, 2026);
  assert.equal(season.length, 1);
  assert.equal(season[0].gamesPlayed, 1, 'season aggregation applies the same boundary');
});

// === Review remediation — kickoff-gated placeholder recovery lifecycle ===

const MATURE_KICKOFF = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
const RECENT_KICKOFF = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago < 6h cutoff

test('a dated numeric-id placeholder PAST the maturity cutoff is expected (stale label)', () => {
  const items = [
    scheduleItem({
      id: '901',
      seasonType: 'postseason',
      awayTeam: 'TBD',
      startDate: MATURE_KICKOFF,
    }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'postseason', NOW);
  assert.deepEqual(
    [...slate.expectedIds],
    ['901'],
    'a played game with a stale placeholder label stays recoverable by its provider id'
  );
});

test('the same placeholder BEFORE the maturity cutoff remains suppressed', () => {
  const items = [
    scheduleItem({
      id: '901',
      seasonType: 'postseason',
      awayTeam: 'TBD',
      startDate: RECENT_KICKOFF,
    }),
  ];
  assert.equal(deriveExpectedGameStatsIds(items, 1, 'postseason', NOW).expectedIds.size, 0);
});

test('a dateless or unparseable-date placeholder remains suppressed', () => {
  for (const startDate of [undefined, null, '', 'not-a-date']) {
    const items = [
      scheduleItem({ id: '901', seasonType: 'postseason', awayTeam: 'TBD', startDate }),
    ];
    assert.equal(
      deriveExpectedGameStatsIds(items, 1, 'postseason', NOW).expectedIds.size,
      0,
      `startDate ${JSON.stringify(startDate)} proves nothing`
    );
  }
});

test('a mature placeholder with a synthetic id is unverifiable, not expected', () => {
  const items = [
    scheduleItem({
      id: '1-TBD-TBD',
      seasonType: 'postseason',
      awayTeam: 'TBD',
      startDate: MATURE_KICKOFF,
    }),
  ];
  const slate = deriveExpectedGameStatsIds(items, 1, 'postseason', NOW);
  assert.equal(slate.expectedIds.size, 0);
  assert.equal(slate.unverifiableCount, 1);
});

// === Adversarial-review remediation — recognized-category authority ===

/** Row with independent per-side raw maps. */
function sidedRow(
  providerGameId: number,
  homeRaw: Record<string, string>,
  awayRaw: Record<string, string>
): GameStats {
  return {
    providerGameId,
    week: 1,
    seasonType: 'regular',
    home: { school: 'Alpha', raw: homeRaw } as unknown as GameStats['home'],
    away: { school: 'Beta', raw: awayRaw } as unknown as GameStats['away'],
  };
}

test('the recognized-category contract is locked to the normalizer', () => {
  assert.deepEqual(
    [...RECOGNIZED_STAT_CATEGORIES].sort(),
    [
      'firstDowns',
      'fourthDownEff',
      'fumblesLost',
      'fumblesRecovered',
      'interceptionTDs',
      'interceptionYards',
      'interceptions',
      'kickReturnTDs',
      'kickReturnYards',
      'netPassingYards',
      'passAttempts',
      'passCompletions',
      'passesIntercepted',
      'passingTDs',
      'possessionTime',
      'puntReturnTDs',
      'puntReturnYards',
      'rushingAttempts',
      'rushingTDs',
      'rushingYards',
      'thirdDownEff',
      'totalPenaltiesYards',
      'totalYards',
      'turnovers',
    ],
    'the list must match exactly the raw keys normalizeTeam consumes — update both together'
  );
});

test('authority requires a recognized category on EACH side', () => {
  // Both sides recognized (explicit zeros included) → authoritative.
  assert.equal(
    isAuthoritativeGameStatsRow(sidedRow(101, { totalYards: '0' }, { turnovers: '0' })),
    true
  );
  // Recognized on only one side → non-authoritative (the other side's metrics
  // would all be fabricated zeros).
  assert.equal(isAuthoritativeGameStatsRow(sidedRow(101, { totalYards: '350' }, {})), false);
  assert.equal(isAuthoritativeGameStatsRow(sidedRow(101, {}, { totalYards: '280' })), false);
  // Unknown/renamed categories only → non-authoritative on both sides.
  assert.equal(
    isAuthoritativeGameStatsRow(sidedRow(101, { rushYds: '150' }, { rushYds: '80' })),
    false
  );
  // Mixed: only the recognized key establishes authority.
  assert.equal(
    isAuthoritativeGameStatsRow(
      sidedRow(101, { rushYds: '150', totalYards: '350' }, { totalYards: '280' })
    ),
    true
  );
});

test('one-sided rows never count toward completeness, availability, or analytics', () => {
  const oneSided = sidedRow(101, { totalYards: '350' }, {});
  assert.equal(usableGameStatsGameIds(record([oneSided])).size, 0);
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  const owners = aggregateOwnerGameStats([oneSided], new Map([['Alpha', 'OwnerA']]), resolver);
  assert.equal(owners.length, 0, 'the statless side would be fabricated zeros');
  // The scheduled game therefore stays recovery-eligible…
  assert.equal(evaluate([scheduleItem({ id: '101' })], [oneSided]).state, 'no-usable-rows');
  // …and a later fully authoritative row repairs it.
  const repaired = mergeLater(record([oneSided]), [row(101)]);
  assert.equal(repaired.changed, true);
  assert.equal(usableGameStatsGameIds(record(repaired.games)).size, 1);
});

test('unknown categories in a prior row never block a recognized-superset replacement', () => {
  const prior = record([
    sidedRow(101, { totalYards: '350', mysteryCat: 'x' }, { totalYards: '280' }),
  ]);
  const incoming = sidedRow(
    101,
    { totalYards: '360', rushingYards: '150' },
    { totalYards: '290', rushingYards: '90' }
  );
  const merge = mergeLater(prior, [incoming]);
  assert.equal(merge.changed, true, 'only RECOGNIZED categories participate in the superset rule');
  assert.equal(merge.games[0].home.raw.rushingYards, '150');
});

// === Review remediation — structural equality independent of jsonb key order ===

/** Recursively rebuild `value` with every object's keys in REVERSED order —
 * simulating the Postgres `jsonb` round-trip, which does not preserve key
 * insertion order. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reorderKeys(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
      out[key] = reorderKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

test('merge: a jsonb-style key-order round trip of an identical row is a truthful no-op', () => {
  const original = sidedRow(
    101,
    { totalYards: '350', rushingYards: '150' },
    { totalYards: '280', firstDowns: '18' }
  );
  // The durable prior comes back with reordered keys at every nesting level.
  const roundTripped = JSON.parse(JSON.stringify(reorderKeys(original))) as GameStats;
  const merge = mergeLater(record([roundTripped]), [original]);
  assert.equal(merge.changed, false, 'key order must never fabricate a change');
  assert.equal(merge.rowsCommitted, 0);
});

test('merge: equality still detects genuinely different values under reordered keys', () => {
  const prior = record([
    reorderKeys(sidedRow(101, { totalYards: '350', rushingYards: '150' }, { totalYards: '280' })),
  ]);
  const updated = sidedRow(101, { totalYards: '360', rushingYards: '150' }, { totalYards: '280' });
  const merge = mergeLater(prior, [updated]);
  assert.equal(merge.changed, true, 'a changed stat value is a real change');
  assert.equal(merge.games[0].home.raw.totalYards, '360');
});

test('merge: array ordering remains significant in row equality', () => {
  const withArray = (order: number[]): GameStats =>
    ({
      ...sidedRow(101, { totalYards: '350' }, { totalYards: '280' }),
      order,
    }) as unknown as GameStats;
  const merge = mergeLater(record([withArray([1, 2])]), [withArray([2, 1])]);
  assert.equal(merge.changed, true, 'reordered ARRAYS are different data, not key-order noise');
});

// === Adversarial-review remediation — complete coverage vs persistence authority ===

test('the analytics-required category contract is locked and recognized', () => {
  assert.deepEqual(
    [...ANALYTICS_REQUIRED_CATEGORIES].sort(),
    [
      'netPassingYards',
      'possessionTime',
      'rushingYards',
      'thirdDownEff',
      'totalYards',
      'turnovers',
    ],
    'exactly the raw-backed fields addTeamStats consumes — update both together'
  );
  for (const category of ANALYTICS_REQUIRED_CATEGORIES) {
    assert.ok(
      RECOGNIZED_STAT_CATEGORIES.includes(category),
      `${category} must be a recognized normalizer category`
    );
  }
});

test('a sparse one-category row is STORED but never complete, available, or analytics-eligible', () => {
  const sparse = sidedRow(101, { totalYards: '350' }, { totalYards: '280' });
  assert.equal(isAuthoritativeGameStatsRow(sparse), true, 'sparse rows are real, storable data');
  assert.equal(hasCompleteStatCoverage(sparse), false);
  const stored = mergeLater(null, [sparse]);
  assert.equal(stored.changed, true, 'the sparse row persists');
  assert.equal(usableGameStatsGameIds(record(stored.games)).size, 0, 'not counted as covered');
  assert.equal(
    evaluate([scheduleItem({ id: '101' })], stored.games).state,
    'no-usable-rows',
    'the week stays recovery-eligible'
  );
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  assert.equal(
    aggregateOwnerGameStats(stored.games, new Map([['Alpha', 'OwnerA']]), resolver).length,
    0,
    'sparse rows never reach analytics — their omitted metrics would be fabricated zeros'
  );
});

test('one complete team plus one sparse team remains incomplete', () => {
  const halfComplete = sidedRow(101, FULL_RAW, { totalYards: '280' });
  assert.equal(hasCompleteStatCoverage(halfComplete), false);
  assert.equal(usableGameStatsGameIds(record([halfComplete])).size, 0);
});

test('explicit zeros across all required categories are complete and analytics-eligible', () => {
  const zeros = row(101, 'Alpha', 'Beta', FULL_RAW_ZEROS);
  assert.equal(hasCompleteStatCoverage(zeros), true);
  assert.equal(usableGameStatsGameIds(record([zeros])).size, 1);
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  const owners = aggregateOwnerGameStats([zeros], new Map([['Alpha', 'OwnerA']]), resolver);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].gamesPlayed, 1, 'a real zero-stat game still counts');
});

test('a later complete response repairs a sparse stored row', () => {
  const sparse = mergeLater(null, [sidedRow(101, { totalYards: '350' }, { totalYards: '280' })]);
  const repaired = mergeLater(record(sparse.games), [row(101)]);
  assert.equal(repaired.changed, true);
  assert.equal(hasCompleteStatCoverage(repaired.games[0]), true);
  assert.equal(usableGameStatsGameIds(record(repaired.games)).size, 1);
});

// === Adversarial-review remediation — unusable new rows never persist ===

test('a mixed payload persists only the valid row; blank-school rows are dropped', () => {
  for (const [home, away] of [
    ['', 'Beta'],
    ['Alpha', ''],
  ] as const) {
    const valid = row(101);
    const unusable = row(102, home, away); // full stat content, unusable identity
    const merge = mergeLater(null, [valid, unusable]);
    assert.deepEqual(
      merge.games.map((g) => g.providerGameId),
      [101],
      `blank ${home === '' ? 'home' : 'away'} school row must not persist`
    );
    assert.equal(merge.rowsCommitted, 1, 'dropped rows never count as committed');
    assert.equal(merge.rowsDroppedUnusable, 1);
  }
});

test('repeated recovery does not accumulate unusable rows', () => {
  const payload = [row(101), row(102, '', 'Beta')];
  const first = mergeLater(null, payload);
  const second = mergeLater(record(first.games), payload);
  assert.equal(second.changed, false, 'the repeat is a truthful no-op');
  assert.deepEqual(
    second.games.map((g) => g.providerGameId),
    [101],
    'no unusable duplicate accumulates'
  );
});

// === Adversarial-review remediation — provider-observation window fencing ===

/** Prior record fetched at a KNOWN completion time for window comparisons. */
function recordFetchedAt(games: GameStats[], fetchedAt: string): WeeklyGameStats {
  return { ...record(games), fetchedAt };
}

const PRIOR_FETCHED_AT = '2026-10-10T12:00:00.000Z';
const OVERLAPPING = { fetchStartedAt: '2026-10-10T11:59:00.000Z' }; // started before prior completed
const PROVABLY_LATER = { fetchStartedAt: '2026-10-10T12:00:01.000Z' };

test('an overlapping older snapshot cannot replace a committed same-game row', () => {
  const prior = recordFetchedAt([row(101, 'Alpha', 'Beta', FULL_RAW)], PRIOR_FETCHED_AT);
  const differing = row(101, 'Alpha', 'Beta', { ...FULL_RAW, totalYards: '111' });
  const merge = mergeWeeklyGameStats(prior, [differing], OVERLAPPING);
  assert.equal(merge.changed, false, 'first-committed wins for overlapping observations');
  assert.equal(merge.games[0].home.raw.totalYards, FULL_RAW.totalYards);
});

test('an overlapping strict superset also cannot replace the committed row (no exemption)', () => {
  const prior = recordFetchedAt(
    [sidedRow(101, { totalYards: '350' }, { totalYards: '280' })],
    PRIOR_FETCHED_AT
  );
  const superset = row(101, 'Alpha', 'Beta', FULL_RAW);
  const merge = mergeWeeklyGameStats(prior, [superset], OVERLAPPING);
  assert.equal(merge.changed, false, 'coverage gain does not override snapshot-order uncertainty');
});

test('a provably later observation can correct equal-set values and enrich coverage', () => {
  const prior = recordFetchedAt([row(101, 'Alpha', 'Beta', FULL_RAW)], PRIOR_FETCHED_AT);
  const corrected = row(101, 'Alpha', 'Beta', { ...FULL_RAW, totalYards: '400' });
  const equalSet = mergeWeeklyGameStats(prior, [corrected], PROVABLY_LATER);
  assert.equal(equalSet.changed, true, 'later non-overlapping corrections still flow');
  assert.equal(equalSet.games[0].home.raw.totalYards, '400');

  const sparsePrior = recordFetchedAt(
    [sidedRow(101, { totalYards: '350' }, { totalYards: '280' })],
    PRIOR_FETCHED_AT
  );
  const enriched = mergeWeeklyGameStats(sparsePrior, [row(101)], PROVABLY_LATER);
  assert.equal(enriched.changed, true, 'later supersets still repair sparse rows');
  assert.equal(hasCompleteStatCoverage(enriched.games[0]), true);
});

test('overlapping requests still ADD previously absent game ids (union preserved)', () => {
  const prior = recordFetchedAt([row(101, 'Alpha', 'Beta', FULL_RAW)], PRIOR_FETCHED_AT);
  const merge = mergeWeeklyGameStats(
    prior,
    [row(101, 'Alpha', 'Beta', { ...FULL_RAW, totalYards: '111' }), row(102)],
    OVERLAPPING
  );
  assert.equal(merge.changed, true);
  assert.deepEqual(
    merge.games.map((g) => g.providerGameId),
    [101, 102],
    'the addition merges while the protected same-game row is retained'
  );
  assert.equal(merge.games[0].home.raw.totalYards, FULL_RAW.totalYards, 'no replacement occurred');
});
