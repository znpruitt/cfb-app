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
