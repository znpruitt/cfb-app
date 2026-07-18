import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyObservationAttachment,
  deriveSlateExpectation,
  ingestGameStatsObservations,
  providerAddressableId,
  validateGameStatsPayload,
  type ScheduleSlateItem,
} from '../ingestion.ts';
import { getCachedGameStats } from '../cache.ts';
import { parseV2GameObservation } from '../contract.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, seedGameStatsPartitionForTests, wireGame } from './fixtures.ts';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED = '2026-10-11T20:00:00.000Z'; // days before NOW
const RECENT = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago (< 6h threshold)
const FUTURE = '2026-10-18T20:00:00.000Z';
const FENCE = '2026-10-15T12:00:00.000Z';

// Registry with FBS/FCS classification for the canonical-attachment tests.
// The fixture wire schools (Alpha State / Beta Tech / …) resolve through the
// registry. 'Grass Valley' and 'Pine Flats' are catalogued WITHOUT a level so
// classification falls back to the canonical-schedule conference policy;
// anything outside the catalog/alias authority is UNRESOLVED (no identity).
const RESOLVER = createTeamIdentityResolver({
  teams: [
    { school: 'Alpha State', level: 'FBS' },
    { school: 'Beta Tech', level: 'FBS' },
    { school: 'Gamma Poly', level: 'FBS' },
    { school: 'Little Brook', level: 'FCS' },
    { school: 'Stony Vale', level: 'FCS' },
    { school: 'Grass Valley' },
    { school: 'Pine Flats' },
  ],
  aliasMap: { 'alpha st.': 'Alpha State' },
});

function item(overrides: Partial<ScheduleSlateItem> & { id: string }): ScheduleSlateItem {
  return {
    week: 3,
    seasonType: 'regular',
    startDate: COMPLETED,
    status: 'STATUS_FINAL',
    homeTeam: 'Alpha State',
    awayTeam: 'Beta Tech',
    ...overrides,
  };
}

function expectationFor(
  items: ScheduleSlateItem[],
  week = 3,
  seasonType: 'regular' | 'postseason' = 'regular'
) {
  return deriveSlateExpectation({
    scheduleItems: items,
    resolver: RESOLVER,
    year: 2026,
    week,
    seasonType,
    now: NOW,
  });
}

function observationOf(payloadEntry: unknown) {
  const parsed = parseV2GameObservation(payloadEntry);
  assert.ok(parsed.ok, 'fixture observation parses');
  return parsed.ok ? parsed.observation : (null as never);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === providerAddressableId ===

test('providerAddressableId accepts only positive safe-integer id strings', () => {
  assert.equal(providerAddressableId('401123456'), 401123456);
  assert.equal(providerAddressableId(' 42 '), 42);
  for (const bad of ['', '0', '-5', '4.2', 'tbd-cfp-semi-1', 'abc', null, undefined]) {
    assert.equal(providerAddressableId(bad as string | null | undefined), null, String(bad));
  }
});

// === deriveSlateExpectation (canonical participants + classification) ===

test('expectation: completed addressable stat-producing games are expected with canonical participants', () => {
  const expectation = expectationFor([
    item({ id: '101' }),
    item({ id: '102', homeTeam: 'Gamma Poly', awayTeam: 'Alpha St.' }),
  ]);
  assert.deepEqual([...expectation.expectedIds].sort(), [101, 102]);
  const game = expectation.games.get(101)!;
  assert.equal(game.home.resolution, 'resolved');
  assert.equal(game.home.subdivision, 'FBS');
  assert.ok(game.home.identityKey.length > 0, 'participant identity retained');
  // Alias resolution flows through the central resolver (Alpha St. → Alpha State).
  assert.equal(
    expectation.games.get(102)!.away.identityKey,
    expectation.games.get(101)!.home.identityKey
  );
});

test('expectation: disrupted games are excluded by classification, never expected', () => {
  const expectation = expectationFor([
    item({ id: '101' }),
    item({ id: '102', status: 'Canceled' }),
    item({ id: '103', status: 'Postponed' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [101]);
  assert.equal(expectation.disrupted, 2);
});

test('expectation: non-numeric ids are deferred placeholders', () => {
  const expectation = expectationFor([
    item({ id: 'cfp-semi-placeholder' }),
    item({ id: '' }),
    item({ id: '104' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [104]);
  assert.equal(expectation.deferredPlaceholders, 2);
});

test('expectation: a NUMERIC id with unresolved placeholder participants still defers', () => {
  // A postseason slot can carry a real provider id before its participants
  // resolve — a numeric id alone is NOT sufficient resolution.
  const expectation = expectationFor([
    item({ id: '7001', homeTeam: 'TBD', awayTeam: 'Beta Tech' }),
    item({ id: '7002', homeTeam: 'Semifinal Winner TBD', awayTeam: 'TBD' }),
    item({ id: '7003' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [7003]);
  assert.deepEqual([...expectation.placeholderIds].sort(), [7001, 7002]);
  assert.equal(expectation.deferredPlaceholders, 2);
});

test('expectation: a resolved postseason game becomes addressable once participants resolve', () => {
  const expectation = deriveSlateExpectation({
    scheduleItems: [
      item({
        id: '7001',
        seasonType: 'postseason',
        homeTeam: 'Alpha State',
        awayTeam: 'Gamma Poly',
      }),
    ],
    resolver: RESOLVER,
    year: 2026,
    week: 3,
    seasonType: 'postseason',
    now: NOW,
  });
  assert.deepEqual([...expectation.expectedIds], [7001]);
  assert.equal(expectation.placeholderIds.size, 0);
});

test('expectation: scheduled FCS-vs-FCS games are excluded by classification', () => {
  const expectation = expectationFor([
    item({ id: '101' }), // FBS vs FBS — persists
    item({ id: '102', awayTeam: 'Little Brook' }), // FBS vs FCS — persists
    item({ id: '103', homeTeam: 'Little Brook', awayTeam: 'Alpha State' }), // FCS vs FBS — persists
    item({ id: '104', homeTeam: 'Little Brook', awayTeam: 'Stony Vale' }), // FCS vs FCS — excluded
  ]);
  assert.deepEqual([...expectation.expectedIds].sort(), [101, 102, 103]);
  assert.deepEqual([...expectation.excludedIds], [104]);
  assert.equal(expectation.excludedByClassification, 1);
});

test('expectation: FCS classification also derives from canonical-schedule conference policy', () => {
  // Catalogued sides WITHOUT a registry level classify through the schedule
  // conference (Big Sky is policy-FCS) — never through provider-stat
  // availability, and never by defaulting an unknown to FCS.
  const expectation = expectationFor([
    item({
      id: '105',
      homeTeam: 'Grass Valley',
      awayTeam: 'Pine Flats',
      homeConference: 'Big Sky',
      awayConference: 'Big Sky',
    }),
    item({
      id: '106',
      homeTeam: 'Alpha State',
      awayTeam: 'Grass Valley',
      awayConference: 'Big Sky',
    }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [106], 'FBS-vs-FCS stays included');
  assert.deepEqual(
    [...expectation.excludedIds],
    [105],
    'FCS-vs-FCS excluded via conference policy'
  );
});

test('expectation: a registry-UNKNOWN participant has no identity and defers its game', () => {
  // 'Unknown Northern' is outside the catalog/alias authority: normalized
  // text is never an identity, so the game defers as unresolved — it is not
  // expected, not excluded, and never provider-eligible.
  const expectation = expectationFor([
    item({ id: '107', awayTeam: 'Unknown Northern', awayConference: 'Big Sky' }),
    item({ id: '108' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [108]);
  assert.deepEqual([...expectation.unresolvedIds], [107]);
  assert.equal(expectation.unresolvedParticipants, 1);
});

test('expectation: UNKNOWN classification defers — never treated as FBS or FCS', () => {
  // Catalogued identity but no registry level AND no recognized conference:
  // classification is UNKNOWN, which is outside the explicit allowlist.
  const expectation = expectationFor([
    item({ id: '109', awayTeam: 'Grass Valley', awayConference: null }),
    item({ id: '110', awayTeam: 'Grass Valley', awayConference: 'Mystery League' }),
    item({ id: '111' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [111]);
  assert.deepEqual([...expectation.classificationUnknownIds].sort(), [109, 110]);
  assert.equal(expectation.classificationUnknown, 2);
});

test('identity: distinct labels that merely NORMALIZE alike can never match (collision regressions)', () => {
  // 'A-B' and 'AB' normalize to the same string; neither is in the registry,
  // so neither carries an identity and nothing can match or persist.
  const collisionPairs: Array<[string, string]> = [
    ['A-B', 'AB'], // punctuation collapse
    ['North  Ridge', 'North Ridge'], // whitespace collapse
    ['pine flats', 'PINE FLATS'], // case-only difference without alias authority
    ['St. Marks', 'St Marks'], // punctuation difference
  ];
  for (const [scheduleLabel, providerLabel] of collisionPairs) {
    const expectation = expectationFor([
      item({ id: '150', homeTeam: scheduleLabel, awayTeam: 'Beta Tech' }),
    ]);
    if (expectation.games.has(150)) {
      // Case-only labels of a CATALOGUED school resolve through the central
      // registry normalization — that is alias/registry authority, not text
      // matching; the pair still resolves to ONE identity, so a provider
      // label naming a DIFFERENT school cannot match it (covered below).
      const observation = observationOf(
        wireGame({ id: 150, home: { school: providerLabel, teamId: 900 } })
      );
      const state = classifyObservationAttachment(observation, expectation, RESOLVER);
      assert.ok(
        state === 'matched' || state === 'participant-mismatch',
        `${scheduleLabel} vs ${providerLabel}: attachment stays identity-governed`
      );
    } else {
      // Registry-unknown labels defer as unresolved; a catalogued case-variant
      // without classification authority defers as classification-unknown.
      // Either way the game is NEVER expected and never provider-eligible.
      assert.ok(
        expectation.unresolvedIds.has(150) ||
          expectation.placeholderIds.has(150) ||
          expectation.classificationUnknownIds.has(150),
        `${scheduleLabel} defers without authoritative identity/classification`
      );
      assert.ok(!expectation.expectedIds.has(150));
    }
  }
});

test('identity: two distinct registry-unknown participants with similar labels never persist', () => {
  const expectation = expectationFor([
    item({ id: '152', homeTeam: 'Ridge-Field', awayTeam: 'Beta Tech' }),
  ]);
  assert.ok(expectation.unresolvedIds.has(152), 'the schedule side defers');
  // Even if the game WERE addressable, a registry-unknown provider label
  // ('RidgeField', normalizing identically) has no identity to match with.
  const otherSlate = expectationFor([item({ id: '153' })]);
  const observation = observationOf(
    wireGame({ id: 153, home: { school: 'RidgeField', teamId: 900 } })
  );
  assert.equal(
    classifyObservationAttachment(observation, otherSlate, RESOLVER),
    'unresolved-participant'
  );
});

test('identity: a schedule-RESOLVED participant never matches an unresolved provider label', () => {
  const expectation = expectationFor([item({ id: '151' })]); // Alpha State vs Beta Tech
  const observation = observationOf(
    wireGame({ id: 151, home: { school: 'Alpha Statee', teamId: 900 } }) // registry-unknown typo
  );
  assert.equal(
    classifyObservationAttachment(observation, expectation, RESOLVER),
    'unresolved-participant',
    'an unresolved provider participant never authorizes persistence'
  );
});

test('expectation: games inside the completion threshold (or future/undated) are pending', () => {
  const expectation = expectationFor([
    item({ id: '101' }),
    item({ id: '105', startDate: RECENT }),
    item({ id: '106', startDate: FUTURE }),
    item({ id: '107', startDate: null }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [101]);
  assert.deepEqual([...expectation.pendingIds].sort(), [105, 106, 107]);
});

test('expectation: only the requested slate (week + season type) contributes', () => {
  const expectation = expectationFor([
    item({ id: '101' }),
    item({ id: '201', week: 4 }),
    item({ id: '301', seasonType: 'postseason' }),
  ]);
  assert.deepEqual([...expectation.expectedIds], [101]);
});

test('expectation: an empty schedule reports scheduleAvailable false', () => {
  const expectation = expectationFor([]);
  assert.equal(expectation.scheduleAvailable, false);
  assert.equal(expectation.expectedIds.size, 0);
});

// === validateGameStatsPayload ===

test('validation: a non-array payload is invalid', () => {
  for (const bad of [null, undefined, {}, 'x', 42]) {
    assert.deepEqual(validateGameStatsPayload(bad), { kind: 'invalid-payload' }, String(bad));
  }
});

test('validation: an empty array is a valid empty response', () => {
  assert.deepEqual(validateGameStatsPayload([]), { kind: 'empty' });
});

test('validation: a nonempty payload with zero parseable entries is schema drift', () => {
  const result = validateGameStatsPayload([{ nonsense: true }, 17, null]);
  assert.equal(result.kind, 'schema-drift');
  assert.equal(result.kind === 'schema-drift' && result.entryCount, 3);
});

// === classifyObservationAttachment (canonical participant validation) ===

const SLATE = [
  item({ id: '5001' }),
  item({ id: '5002', homeTeam: 'Gamma Poly', awayTeam: 'Little Brook' }),
];

test('attachment: a scheduled id with agreeing canonical participants matches', () => {
  const expectation = expectationFor(SLATE);
  const observation = observationOf(wireGame({ id: 5001 }));
  assert.equal(classifyObservationAttachment(observation, expectation, RESOLVER), 'matched');
});

test('attachment: a scheduled id with UNRELATED provider teams is a participant mismatch, never merged', async () => {
  const expectation = expectationFor(SLATE);
  const unrelated = observationOf(
    wireGame({ id: 5001, home: { school: 'Gamma Poly', teamId: 303 } })
  );
  assert.equal(
    classifyObservationAttachment(unrelated, expectation, RESOLVER),
    'participant-mismatch'
  );

  const result = await ingestGameStatsObservations({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchStartedAt: FENCE,
    payload: [wireGame({ id: 5001, home: { school: 'Gamma Poly', teamId: 303 } })],
    expectation,
    resolver: RESOLVER,
  });
  assert.equal(result.kind, 'no-attachable-observations');
  if (result.kind === 'no-attachable-observations') {
    assert.equal(result.attachment.participantMismatch, 1);
    assert.equal(result.attachment.unscheduledId, 0, 'mismatch is NOT collapsed into unmatched-id');
  }
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'durable state untouched');
});

test('attachment: a provider participant that cannot resolve is unresolved, never merged', () => {
  const expectation = expectationFor(SLATE);
  // "TBD" is an invalid team label → resolves to no identity.
  const unresolved = observationOf(wireGame({ id: 5001, home: { school: 'TBD' } }));
  assert.equal(
    classifyObservationAttachment(unresolved, expectation, RESOLVER),
    'unresolved-participant'
  );
});

test('attachment: orientation must match the schedule for non-neutral games', () => {
  const expectation = expectationFor(SLATE);
  // Same canonical pair, reversed home/away on a HOME game → mismatch.
  const reversed = observationOf(
    wireGame({
      id: 5001,
      home: { school: 'Beta Tech', teamId: 202 },
      away: { school: 'Alpha State', teamId: 101 },
    })
  );
  assert.equal(
    classifyObservationAttachment(reversed, expectation, RESOLVER),
    'participant-mismatch'
  );
});

test('attachment: neutral-site games accept the documented reversed orientation', () => {
  const expectation = expectationFor([item({ id: '5001', neutralSite: true })]);
  const reversed = observationOf(
    wireGame({
      id: 5001,
      home: { school: 'Beta Tech', teamId: 202 },
      away: { school: 'Alpha State', teamId: 101 },
    })
  );
  assert.equal(classifyObservationAttachment(reversed, expectation, RESOLVER), 'matched');
  // Identity still governs: a reversed pair with a WRONG participant mismatches.
  const wrong = observationOf(
    wireGame({
      id: 5001,
      home: { school: 'Gamma Poly', teamId: 303 },
      away: { school: 'Alpha State', teamId: 101 },
    })
  );
  assert.equal(classifyObservationAttachment(wrong, expectation, RESOLVER), 'participant-mismatch');
});

test('attachment: excluded, placeholder, and unscheduled ids classify distinctly', () => {
  const expectation = expectationFor([
    item({ id: '104', homeTeam: 'Little Brook', awayTeam: 'Stony Vale' }), // excluded FCS-vs-FCS
    item({ id: '7001', homeTeam: 'TBD', awayTeam: 'TBD' }), // numeric placeholder
    item({ id: '5001' }),
  ]);
  assert.equal(
    classifyObservationAttachment(
      observationOf(
        wireGame({
          id: 104,
          home: { school: 'Little Brook', teamId: 900 },
          away: { school: 'Stony Vale', teamId: 901 },
        })
      ),
      expectation,
      RESOLVER
    ),
    'excluded-classification'
  );
  assert.equal(
    classifyObservationAttachment(observationOf(wireGame({ id: 7001 })), expectation, RESOLVER),
    'placeholder-deferred'
  );
  assert.equal(
    classifyObservationAttachment(observationOf(wireGame({ id: 999_999 })), expectation, RESOLVER),
    'unscheduled-id'
  );
});

// === ingestGameStatsObservations ===

function baseInput(payload: unknown, expectation = expectationFor(SLATE)) {
  return {
    year: 2026,
    week: 3,
    seasonType: 'regular' as const,
    fetchStartedAt: FENCE,
    payload,
    expectation,
    resolver: RESOLVER,
  };
}

test('ingest: an empty payload is expected-empty when nothing is expected yet', async () => {
  const expectation = expectationFor([item({ id: '5001', startDate: FUTURE })]);
  const result = await ingestGameStatsObservations(baseInput([], expectation));
  assert.deepEqual(result, { kind: 'valid-empty', emptyContext: 'expected' });
});

test('ingest: an empty payload is UNEXPECTED-empty when completed games expect stats', async () => {
  const result = await ingestGameStatsObservations(baseInput([]));
  assert.deepEqual(result, { kind: 'valid-empty', emptyContext: 'unexpected' });
});

test('ingest: unscheduled provider ids never merge (no game creation from statistics)', async () => {
  const result = await ingestGameStatsObservations(baseInput([wireGame({ id: 999_999 })]));
  assert.equal(result.kind, 'no-attachable-observations');
  if (result.kind === 'no-attachable-observations') {
    assert.equal(result.attachment.unscheduledId, 1);
  }
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'nothing persisted');
});

test('ingest: a scheduled FCS-vs-FCS game never merges even when the provider covers it', async () => {
  const expectation = expectationFor([
    item({ id: '104', homeTeam: 'Little Brook', awayTeam: 'Stony Vale' }),
  ]);
  const result = await ingestGameStatsObservations(
    baseInput(
      [
        wireGame({
          id: 104,
          home: { school: 'Little Brook', teamId: 900 },
          away: { school: 'Stony Vale', teamId: 901 },
        }),
      ],
      expectation
    )
  );
  assert.equal(result.kind, 'no-attachable-observations');
  if (result.kind === 'no-attachable-observations') {
    assert.equal(result.attachment.excludedClassification, 1);
  }
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null);
});

test('ingest: one unresolved provider side blocks only that observation, not its siblings', async () => {
  const result = await ingestGameStatsObservations(
    baseInput([
      wireGame({ id: 5001 }),
      wireGame({ id: 5002, home: { school: 'TBD', teamId: 303 } }),
    ])
  );
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.equal(result.attachment.matched, 1);
    assert.equal(result.attachment.unresolvedParticipant, 1);
    assert.deepEqual(result.merge.inserted, [5001]);
  }
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.deepEqual(
    stored!.games.map((g) => g.providerGameId),
    [5001],
    'only the canonically attached observation persisted'
  );
});

test('ingest: matched observations with no valid categories are a content failure, not a write', async () => {
  const statless = {
    id: 5001,
    teams: [
      {
        teamId: 101,
        team: 'Alpha State',
        conference: 'X',
        homeAway: 'home',
        points: 21,
        stats: [],
      },
      { teamId: 202, team: 'Beta Tech', conference: 'Y', homeAway: 'away', points: 14, stats: [] },
    ],
  };
  const result = await ingestGameStatsObservations(baseInput([statless]));
  assert.equal(result.kind, 'no-persistable-observations');
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'nothing persisted');
});

test('ingest: matched FBS-vs-FCS observations merge into v2 durable rows', async () => {
  const expectation = expectationFor(SLATE);
  const result = await ingestGameStatsObservations(
    baseInput(
      [
        wireGame({ id: 5001 }),
        wireGame({
          id: 5002,
          home: { school: 'Gamma Poly', teamId: 303 },
          away: { school: 'Little Brook', teamId: 900 },
        }),
      ],
      expectation
    )
  );
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.equal(result.merge.outcome, 'written');
    assert.deepEqual(result.merge.inserted, [5001, 5002]);
  }
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 2);
  for (const row of stored!.games) {
    assert.equal(row.schemaVersion, 2);
    assert.equal(row.fetchStartedAt, FENCE);
  }
});

test('ingest: a pending (recently kicked off) schedule game may still merge', async () => {
  const expectation = expectationFor([item({ id: '5001', startDate: RECENT })]);
  const result = await ingestGameStatsObservations(
    baseInput([wireGame({ id: 5001 })], expectation)
  );
  assert.equal(result.kind, 'merged');
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 1);
});

test('ingest: a partial batch preserves prior durable games (no partition replacement)', async () => {
  const expectation = expectationFor([item({ id: '5001' }), item({ id: '5002' })]);
  await ingestGameStatsObservations(
    baseInput([wireGame({ id: 5001 }), wireGame({ id: 5002 })], expectation)
  );
  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const result = await ingestGameStatsObservations({
    ...baseInput([wireGame({ id: 5002, home: { points: 45 } })], expectation),
    fetchStartedAt: later,
  });
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.deepEqual(result.merge.updated, [5002]);
    assert.deepEqual(result.merge.retainedExisting, [5001], 'the absent game is retained');
  }
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.deepEqual(stored!.games.map((g) => g.providerGameId).sort(), [5001, 5002]);
});

test('ingest: an older late-arriving observation is fenced out (stale, no rollback)', async () => {
  await ingestGameStatsObservations(baseInput([wireGame({ id: 5001, home: { points: 31 } })]));
  const older = new Date(Date.parse(FENCE) - 60_000).toISOString();
  const result = await ingestGameStatsObservations({
    ...baseInput([wireGame({ id: 5001, home: { points: 3 } })]),
    fetchStartedAt: older,
  });
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.equal(result.merge.outcome, 'stale');
    assert.deepEqual(result.merge.stale, [5001]);
  }
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored!.games[0]!.home.points, 31, 'newer durable evidence not rolled back');
});

test('ingest: prior LEGACY durable rows upgrade conservatively instead of being replaced', async () => {
  const legacy = legacyRowFromWire(wireGame({ id: 5001 }), 3);
  await seedGameStatsPartitionForTests({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-10-12T00:00:00.000Z',
    games: [legacy],
  });
  const result = await ingestGameStatsObservations(baseInput([wireGame({ id: 5001 })]));
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') assert.deepEqual(result.merge.updated, [5001]);
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored!.games[0]!.schemaVersion, 2, 'the row upgraded through the merge');
});

test('ingest: an invalid fence surfaces as a typed unavailable merge, durable untouched', async () => {
  const result = await ingestGameStatsObservations({
    ...baseInput([wireGame({ id: 5001 })]),
    fetchStartedAt: 'not-a-timestamp',
  });
  assert.equal(result.kind, 'merged');
  if (result.kind === 'merged') {
    assert.equal(result.merge.outcome, 'unavailable');
    assert.equal(result.merge.unavailableReason, 'invalid-fetch-started-at');
  }
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null);
});
