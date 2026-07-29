import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleFromApi, type ScheduleWireItem } from '../schedule.ts';
import type { TeamCatalogItem } from '../teamIdentity.ts';

/**
 * PLATFORM-086E1C1 — the wire→AppGame presentation carry. Media reaches the
 * application model ONLY as the wire item's exact-id joined overlay; venue
 * catalog details reach it only through the (server-joined) `venue` object.
 */

const teams: TeamCatalogItem[] = [
  { school: 'Texas', level: 'FBS', conference: 'SEC' },
  { school: 'Rice', level: 'FBS', conference: 'American' },
  { school: 'Georgia', level: 'FBS', conference: 'SEC' },
  { school: 'Alabama', level: 'FBS', conference: 'SEC' },
];

function wireItem(overrides: Partial<ScheduleWireItem>): ScheduleWireItem {
  return {
    id: '101',
    week: 1,
    startDate: '2025-08-30T00:00:00Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Texas',
    awayTeam: 'Rice',
    homeConference: 'SEC',
    awayConference: 'American',
    status: 'scheduled',
    seasonType: 'regular',
    ...overrides,
  };
}

test('media carries from the wire item onto its exact AppGame; absent media adds no key', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    aliasMap: {},
    teams,
    scheduleItems: [
      wireItem({
        id: '101',
        media: [{ gameId: '101', mediaType: 'tv', outlet: 'ESPN' }],
        startTimeTBD: true,
        venueId: 3504,
        venue: { stadium: 'DKR', city: 'Austin', state: 'TX', country: 'US' },
      }),
      wireItem({ id: '102', homeTeam: 'Georgia', awayTeam: 'Alabama', week: 2 }),
    ],
  });

  const withMedia = built.games.find((g) => g.providerGameId === '101');
  assert.ok(withMedia);
  assert.deepEqual(withMedia!.media, [{ gameId: '101', mediaType: 'tv', outlet: 'ESPN' }]);
  assert.equal(withMedia!.startTimeTBD, true);
  assert.equal(withMedia!.venueId, 3504);
  assert.deepEqual(withMedia!.venue, {
    stadium: 'DKR',
    city: 'Austin',
    state: 'TX',
    country: 'US',
  });

  const withoutMedia = built.games.find((g) => g.providerGameId === '102');
  assert.ok(withoutMedia);
  assert.ok(!('media' in withoutMedia!), 'a game without media keeps its exact prior shape');
});

test('an empty media array is not carried', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    aliasMap: {},
    teams,
    scheduleItems: [wireItem({ id: '101', media: [] })],
  });
  const game = built.games.find((g) => g.providerGameId === '101');
  assert.ok(game);
  assert.ok(!('media' in game!));
});
