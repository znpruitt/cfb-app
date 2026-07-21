import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import {
  __deleteTeamDatabaseStoreFileForTests,
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../../server/teamDatabaseStore.ts';
import {
  buildCanonicalGameStatsSlate,
  loadCanonicalGameStatsSlate,
  selectCanonicalPartition,
  type CanonicalGame,
} from '../canonicalSlate.ts';
import { C1_TEAMS, IDENTITY_KEYS, scheduleItem } from './c1Fixtures.ts';

// Fixed clock: everything with a 2025-09-06 kickoff is > 6h old at this instant.
const NOW = new Date('2025-09-07T00:00:00Z');

function bySlateId(games: CanonicalGame[], id: number): CanonicalGame | undefined {
  return games.find((g) => g.providerGameId === id);
}

function build(items: ReturnType<typeof scheduleItem>[]) {
  return buildCanonicalGameStatsSlate({
    year: 2025,
    scheduleItems: items,
    teams: C1_TEAMS,
    aliasMap: {},
    now: NOW,
  });
}

test('canonical slate: expected / pending / disrupted / placeholder / excluded classify correctly', () => {
  const slate = build([
    // completed FBS-vs-FBS: kickoff well past → expected
    scheduleItem({ id: '5001', week: 3, home: 'Alpha State', away: 'Beta Tech', status: 'final' }),
    // upcoming FBS-vs-FBS: kickoff in the future → pending
    scheduleItem({
      id: '5002',
      week: 3,
      home: 'Gamma A&M',
      away: 'Delta University',
      startDate: '2025-09-13T16:00:00Z',
      status: 'scheduled',
    }),
    // disrupted: canceled → not expected
    scheduleItem({
      id: '5003',
      week: 3,
      home: 'Alpha State',
      away: 'Gamma A&M',
      status: 'STATUS_CANCELED',
    }),
    // FCS-vs-FCS → excluded by the shared builder, never in the slate
    scheduleItem({ id: '5004', week: 3, home: 'Epsilon College', away: 'Zeta State' }),
  ]);

  const expected = bySlateId(slate.games, 5001);
  assert.ok(expected);
  assert.equal(expected!.applicability, 'expected');
  assert.equal(expected!.seasonType, 'regular');
  assert.equal(expected!.home?.identityKey, IDENTITY_KEYS['Alpha State']);
  assert.equal(expected!.away?.identityKey, IDENTITY_KEYS['Beta Tech']);

  assert.equal(bySlateId(slate.games, 5002)?.applicability, 'pending');

  const disrupted = bySlateId(slate.games, 5003);
  assert.equal(disrupted?.applicability, 'not-expected');
  assert.equal(disrupted?.notExpectedReason, 'disrupted');

  // FCS-vs-FCS excluded from the canonical schedule → absent from the slate.
  assert.equal(bySlateId(slate.games, 5004), undefined);
});

test('canonical slate: kickoff six-hour threshold governs expected vs pending', () => {
  const slate = build([
    // exactly 6h before NOW → expected
    scheduleItem({
      id: '6001',
      week: 4,
      home: 'Alpha State',
      away: 'Beta Tech',
      startDate: '2025-09-06T18:00:00Z',
      status: 'final',
    }),
    // 5h59m before NOW → pending
    scheduleItem({
      id: '6002',
      week: 4,
      home: 'Gamma A&M',
      away: 'Delta University',
      startDate: '2025-09-06T18:01:00Z',
      status: 'in_progress',
    }),
  ]);
  assert.equal(bySlateId(slate.games, 6001)?.applicability, 'expected');
  assert.equal(bySlateId(slate.games, 6002)?.applicability, 'pending');
});

test('canonical slate: postseason games keep their season type and provider week', () => {
  const slate = build([
    scheduleItem({ id: '7001', week: 3, home: 'Alpha State', away: 'Beta Tech', status: 'final' }),
    scheduleItem({
      id: '7002',
      week: 1,
      home: 'Gamma A&M',
      away: 'Delta University',
      status: 'final',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      eventKey: 'omega-bowl',
    }),
  ]);
  const bowl = bySlateId(slate.games, 7002);
  assert.ok(bowl);
  assert.equal(bowl!.seasonType, 'postseason');
  // Provider week is preserved (NOT the appended canonical week used for history).
  assert.equal(bowl!.providerWeek, 1);
  assert.equal(bowl!.applicability, 'expected');

  // The postseason game partitions separately from the regular week.
  const regularWk3 = selectCanonicalPartition(slate, 3, 'regular');
  const postWk1 = selectCanonicalPartition(slate, 1, 'postseason');
  assert.deepEqual(
    regularWk3.expected.map((g) => g.providerGameId),
    [7001]
  );
  assert.deepEqual(
    postWk1.expected.map((g) => g.providerGameId),
    [7002]
  );
});

test('canonical slate: placeholder postseason game is deferred, never expected', () => {
  const slate = build([
    // A postseason game whose teams are unknown labels → placeholder.
    scheduleItem({
      id: '8001',
      week: 1,
      home: 'TBD East',
      away: 'TBD West',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'playoff',
      playoffRound: 'semifinal',
      eventKey: 'sigma-semi',
    }),
  ]);
  const placeholder = slate.games.find((g) => g.eventId.includes('sigma-semi'));
  // Placeholder ids are synthetic (non-numeric) so most are unaddressable; if the
  // provider id survives as numeric it is still classified not-expected.
  if (placeholder) {
    assert.equal(placeholder.applicability, 'not-expected');
    assert.equal(placeholder.notExpectedReason, 'placeholder');
  }
  const partition = selectCanonicalPartition(slate, 1, 'postseason');
  assert.equal(partition.expected.length, 0);
});

test('canonical slate: a half-set postseason shell (one team + one TBD) is EXPECTED, away unresolved', () => {
  const slate = build([
    // One known team + one TBD slot → buildScheduleFromApi leaves isPlaceholder
    // false. Under the CFBD-id authority model, participant settledness governs a
    // stored row's integrity, NOT whether the game is expected — so the
    // addressable game is expected with an unresolved (null) away participant, and
    // a durable row attaches as `unverified` (see evidenceAuthority tests).
    scheduleItem({
      id: '8100',
      week: 1,
      home: 'Alpha State',
      away: 'TBD Opponent',
      status: 'final',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      eventKey: 'kappa-bowl',
    }),
  ]);
  const game = bySlateId(slate.games, 8100);
  assert.ok(game);
  assert.equal(game!.applicability, 'expected');
  assert.equal(game!.notExpectedReason, null);
  assert.equal(game!.home?.identityKey, IDENTITY_KEYS['Alpha State']);
  assert.equal(game!.away, null); // TBD slot → unresolved canonical participant
  const partition = selectCanonicalPartition(slate, 1, 'postseason');
  assert.deepEqual(
    partition.expected.map((g) => g.providerGameId),
    [8100]
  );
  assert.equal(partition.deferredPlaceholders.length, 0);
});

test('buildCanonicalGameStatsSlate: an empty team catalog throws (catalog authority required)', () => {
  // The pure builder must enforce the same catalog-authority precondition as the
  // async loader — a direct caller cannot bypass it with an empty catalog and
  // have identities seeded from schedule labels alone.
  assert.throws(() =>
    buildCanonicalGameStatsSlate({
      year: 2025,
      scheduleItems: [
        scheduleItem({
          id: '5001',
          week: 3,
          home: 'Alpha State',
          away: 'Beta Tech',
          status: 'final',
        }),
      ],
      teams: [],
      aliasMap: {},
      now: NOW,
    })
  );
  // A non-empty catalog builds normally.
  const ok = buildCanonicalGameStatsSlate({
    year: 2025,
    scheduleItems: [
      scheduleItem({
        id: '5001',
        week: 3,
        home: 'Alpha State',
        away: 'Beta Tech',
        status: 'final',
      }),
    ],
    teams: C1_TEAMS,
    aliasMap: {},
    now: NOW,
  });
  assert.ok(bySlateId(ok.games, 5001));
});

test('canonical slate: malformed non-decimal schedule ids are not addressable', () => {
  const slate = build([
    scheduleItem({ id: '5001', week: 3, home: 'Alpha State', away: 'Beta Tech', status: 'final' }),
    // `Number('1e3')` would coerce to 1000; a digits-only grammar rejects it so it
    // can never attach a durable row for an unrelated numeric game.
    scheduleItem({
      id: '1e3',
      week: 3,
      home: 'Gamma A&M',
      away: 'Delta University',
      status: 'final',
    }),
  ]);
  assert.ok(bySlateId(slate.games, 5001));
  assert.equal(bySlateId(slate.games, 1000), undefined);
  assert.equal(
    slate.games.some((g) => g.providerGameId === 1000),
    false
  );
});

test('canonical slate: arbitrary provider labels never gain identity authority', () => {
  const slate = build([
    scheduleItem({ id: '9001', week: 3, home: 'Alpha State', away: 'Beta Tech', status: 'final' }),
  ]);
  // Catalog + alias + schedule participants resolve…
  assert.equal(slate.resolveStoredParticipantKey('Alpha State'), IDENTITY_KEYS['Alpha State']);
  // …an arbitrary label does not.
  assert.equal(slate.resolveStoredParticipantKey('Totally Fake University'), null);
  assert.equal(slate.resolveStoredParticipantKey(''), null);
  assert.equal(slate.resolveStoredParticipantKey(42), null);
});

test('canonical slate: a label on an EXCLUDED schedule row gains no identity authority', () => {
  const slate = build([
    // Included FBS-vs-FBS game: its participants ARE settled canonical identities.
    scheduleItem({ id: '9101', week: 3, home: 'Alpha State', away: 'Beta Tech', status: 'final' }),
    // Non-catalog FCS-vs-FCS row: dropped by buildScheduleFromApi (both non-FBS),
    // so its raw labels are never settled participants and must not seed the
    // resolver. Non-catalog labels can only resolve THROUGH such seeding.
    scheduleItem({
      id: '9102',
      week: 3,
      home: 'Ghost Aggies',
      away: 'Phantom Normal',
      homeConf: 'Big Sky',
      awayConf: 'Missouri Valley',
      status: 'final',
    }),
  ]);
  // The excluded game is not in the canonical slate at all.
  assert.equal(bySlateId(slate.games, 9102), undefined);
  // Its labels resolve to nothing — no identity authority from an excluded row.
  assert.equal(slate.resolveStoredParticipantKey('Ghost Aggies'), null);
  assert.equal(slate.resolveStoredParticipantKey('Phantom Normal'), null);
  // The included game's participants still resolve.
  assert.equal(slate.resolveStoredParticipantKey('Alpha State'), IDENTITY_KEYS['Alpha State']);
});

test('loadCanonicalGameStatsSlate: aggregate and partition-only layouts produce identical expectations', async () => {
  const items = [
    scheduleItem({ id: '4101', week: 5, home: 'Alpha State', away: 'Beta Tech', status: 'final' }),
    scheduleItem({
      id: '4102',
      week: 1,
      home: 'Gamma A&M',
      away: 'Delta University',
      status: 'final',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'bowl',
      eventKey: 'tau-bowl',
    }),
  ];
  const regularItems = items.filter((i) => i.seasonType !== 'postseason');
  const postseasonItems = items.filter((i) => i.seasonType === 'postseason');

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  await __deleteTeamDatabaseStoreFileForTests();
  await setTeamDatabaseFile({ items: C1_TEAMS } as never);

  // Layout A: one aggregate `${year}-all-all` record.
  await setAppState('schedule', '2025-all-all', { items });
  const aggregate = await loadCanonicalGameStatsSlate({ year: 2025, now: NOW });

  // Layout B: partition-only `${year}-all-regular` + `${year}-all-postseason`.
  await setAppState('schedule', '2025-all-all', { items: [] });
  await setAppState('schedule', '2025-all-regular', { items: regularItems });
  await setAppState('schedule', '2025-all-postseason', { items: postseasonItems });
  const partitioned = await loadCanonicalGameStatsSlate({ year: 2025, now: NOW });

  assert.equal(aggregate.status, 'available');
  assert.equal(partitioned.status, 'available');
  if (aggregate.status !== 'available' || partitioned.status !== 'available') return;

  const summarize = (games: CanonicalGame[]) =>
    games
      .map((g) => ({
        id: g.providerGameId,
        week: g.providerWeek,
        seasonType: g.seasonType,
        applicability: g.applicability,
        home: g.home?.identityKey ?? null,
        away: g.away?.identityKey ?? null,
      }))
      .sort((a, b) => a.id - b.id);

  assert.deepEqual(summarize(aggregate.slate.games), summarize(partitioned.slate.games));
  assert.ok(summarize(aggregate.slate.games).some((g) => g.id === 4101));

  // Leave the shared stores clean for any non-isolated runner.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  await __deleteTeamDatabaseStoreFileForTests();
});

test('loadCanonicalGameStatsSlate: an empty team catalog is unavailable context, not valid absence', async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  await __deleteTeamDatabaseStoreFileForTests();

  await setAppState('schedule', '2025-all-all', {
    items: [
      scheduleItem({
        id: '4201',
        week: 3,
        home: 'Alpha State',
        away: 'Beta Tech',
        status: 'final',
      }),
    ],
  });
  // Durable catalog present but EMPTY — getTeamDatabaseItems() returns [] without
  // throwing, so an available slate would authorize attachment with no catalog
  // authority. The loader must reject it as catalog-load-failed.
  await setTeamDatabaseFile({ items: [] } as never);

  const result = await loadCanonicalGameStatsSlate({ year: 2025, now: NOW });
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') assert.equal(result.reason, 'catalog-load-failed');

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  await __deleteTeamDatabaseStoreFileForTests();
});
