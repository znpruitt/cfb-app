import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSeasonArchive } from '../seasonRollover.ts';
import { parseGameStatSlateSnapshot } from '../gameStats/slateSnapshot.ts';
import type { TeamCatalogItem } from '../teamIdentity.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';

// PLATFORM-086H3E1: the archive-owned game-stat slate snapshot must be derived
// from the archive's OWN exact canonical build and paired with the archive's
// own scoresByKey — never a live rebuild.

const SLUG = 'snapshot-league';
const YEAR = 2025;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

async function seedTeamDb(schools: string[]): Promise<void> {
  const items: TeamCatalogItem[] = schools.map((school) => ({
    school,
    conference: 'Mountain West',
  }));
  await setTeamDatabaseFile({ source: 'cfbd', updatedAt: '2025-01-01T00:00:00.000Z', items });
}

function wireItem(params: {
  id: string;
  week: number;
  home: string;
  away: string;
  status?: string;
  homeId?: number;
  awayId?: number;
}): Record<string, unknown> {
  return {
    id: params.id,
    week: params.week,
    startDate: `${YEAR}-09-01T18:00:00.000Z`,
    neutralSite: false,
    conferenceGame: false,
    homeTeam: params.home,
    awayTeam: params.away,
    ...(params.homeId !== undefined ? { homeId: params.homeId } : {}),
    ...(params.awayId !== undefined ? { awayId: params.awayId } : {}),
    homeConference: 'Mountain West',
    awayConference: 'Mountain West',
    status: params.status ?? 'final',
    seasonType: 'regular',
  };
}

async function seedSeason(): Promise<void> {
  await seedTeamDb(['Texas', 'Rival Tech', 'Gulf State', 'Marsh College']);
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      // addressable, completed, id-bearing → must persist in the snapshot
      wireItem({
        id: '9001',
        week: 1,
        home: 'Texas',
        away: 'Rival Tech',
        homeId: 251,
        awayId: 252,
      }),
      // disrupted → stat-inapplicable, must NOT persist
      wireItem({
        id: '9002',
        week: 2,
        home: 'Gulf State',
        away: 'Marsh College',
        status: 'STATUS_CANCELED',
      }),
      // non-numeric provider id → unaddressable, must NOT persist
      wireItem({ id: 'manual-entry-1', week: 3, home: 'Texas', away: 'Gulf State' }),
    ],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: '9001',
        seasonType: 'regular',
        startDate: `${YEAR}-09-01T18:00:00.000Z`,
        week: 1,
        status: 'final',
        home: { team: 'Texas', score: 31 },
        away: { team: 'Rival Tech', score: 10 },
        time: null,
      },
    ],
  });
  await setAppState(
    `owners:${SLUG}:${YEAR}`,
    'csv',
    ['team,owner', 'Texas,Alice', 'Rival Tech,Bob'].join('\n')
  );
}

test('buildSeasonArchive: attaches a snapshot paired with the archive build', async () => {
  await seedSeason();
  const archive = await buildSeasonArchive(SLUG, YEAR);

  const snapshot = archive.gameStatSlate;
  assert.ok(snapshot, 'archive carries the E1 slate snapshot');
  assert.equal(snapshot!.snapshotVersion, 1);
  assert.equal(snapshot!.year, YEAR);

  // Addressable completed game persists with its numeric participant ids.
  const persisted = snapshot!.games.find((g) => g.providerGameId === 9001);
  assert.ok(persisted, 'addressable game persisted');
  assert.equal(persisted!.homeId, 251);
  assert.equal(persisted!.awayId, 252);
  assert.equal(persisted!.providerWeek, 1);
  assert.equal(persisted!.seasonType, 'regular');

  // Disrupted and unaddressable rows never persist.
  assert.equal(
    snapshot!.games.find((g) => g.providerGameId === 9002),
    undefined
  );
  assert.equal(snapshot!.games.length, 1);

  // PAIRING: every snapshot game maps onto this archive's own build — the same
  // attachment key exists on an archive game with the same provider id, and the
  // completed game's key resolves in the archive's own scoresByKey.
  for (const game of snapshot!.games) {
    const archiveGame = archive.games.find((g) => g.key === game.key);
    assert.ok(archiveGame, `archive build contains snapshot key ${game.key}`);
    assert.equal(archiveGame!.providerGameId, String(game.providerGameId));
  }
  assert.ok(
    persisted!.key in archive.scoresByKey,
    'completed snapshot game pairs with the archive-owned score'
  );
});

test('buildSeasonArchive: the persisted snapshot round-trips the strict parser', async () => {
  await seedSeason();
  const archive = await buildSeasonArchive(SLUG, YEAR);

  // Exactly what durable persistence stores/returns: the JSON image.
  const persisted: unknown = JSON.parse(JSON.stringify(archive.gameStatSlate));
  const parsed = parseGameStatSlateSnapshot(persisted, YEAR);
  assert.equal(parsed.status, 'valid');

  // Wrong-year pairing fails closed at parse time.
  assert.equal(parseGameStatSlateSnapshot(persisted, YEAR + 1).status, 'malformed');
});

test('buildSeasonArchive: a manual override on the exact build is reflected in the snapshot', async () => {
  await seedSeason();

  // Discover the game's eventId from an un-overridden build, then override its
  // attachment key — overrides are keyed by eventId and applied INSIDE the
  // archive's own buildScheduleFromApi invocation.
  const baseline = await buildSeasonArchive(SLUG, YEAR);
  const eventId = baseline.games.find((g) => g.providerGameId === '9001')!.eventId;
  await setAppState(`postseason-overrides:${SLUG}:${YEAR}`, 'map', {
    [eventId]: { key: 'overridden-key-9001' },
  });

  const archive = await buildSeasonArchive(SLUG, YEAR);
  const snapGame = archive.gameStatSlate!.games.find((g) => g.providerGameId === 9001);
  assert.ok(snapGame, 'overridden game still persisted');
  // A league-agnostic internal rebuild would ignore the league's manual
  // override and yield the underived key; the exact-build snapshot must carry
  // the overridden attachment key AND stay paired with this archive's own
  // scoresByKey under that same key.
  assert.equal(snapGame!.key, 'overridden-key-9001');
  assert.ok(
    'overridden-key-9001' in archive.scoresByKey,
    'archive-owned score attached under the overridden key'
  );
});

test('buildSeasonArchive: an override rewriting a provider id fails closed', async () => {
  await seedSeason();
  const baseline = await buildSeasonArchive(SLUG, YEAR);
  const eventId = baseline.games.find((g) => g.providerGameId === '9001')!.eventId;
  // Rewriting the association id away from every schedule wire row makes the
  // game unverifiable — the archive build must reject, never silently default
  // the partition or null the participant ids.
  await setAppState(`postseason-overrides:${SLUG}:${YEAR}`, 'map', {
    [eventId]: { providerGameId: '77777' },
  });
  await assert.rejects(buildSeasonArchive(SLUG, YEAR), /no associated schedule wire row/);
});

test('buildSeasonArchive: an empty team catalog fails closed', async () => {
  await seedSeason();
  await seedTeamDb([]);
  await assert.rejects(buildSeasonArchive(SLUG, YEAR), /non-empty team catalog/);
});

test('buildSeasonArchive: ambiguous duplicate schedule ids fail closed', async () => {
  await seedSeason();
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      wireItem({
        id: '9001',
        week: 1,
        home: 'Texas',
        away: 'Rival Tech',
        homeId: 251,
        awayId: 252,
      }),
      wireItem({ id: '9001', week: 2, home: 'Gulf State', away: 'Marsh College' }),
    ],
  });
  await assert.rejects(buildSeasonArchive(SLUG, YEAR), /ambiguous duplicate CFBD schedule id/);
});
