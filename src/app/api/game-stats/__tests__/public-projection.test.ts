import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../lib/server/appStateStore.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('the public game-stats route never emits the internal commitStamp', async () => {
  const key = '2024:6:regular';
  // A cached partition carrying an internal commit stamp + a v2-marked game.
  await setAppState('game-stats', key, {
    year: 2024,
    week: 6,
    seasonType: 'regular',
    fetchedAt: new Date().toISOString(), // fresh → cache hit within TTL
    commitStamp: { lineage: 'L', revision: 3 },
    games: [],
  });

  const res = await GET(
    new Request('http://localhost/api/game-stats?year=2024&week=6&seasonType=regular')
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  // The envelope is byte-compatible with legacy data and carries NO commitStamp.
  assert.equal('commitStamp' in body, false);
  assert.deepEqual(Object.keys(body).sort(), [
    'fetchedAt',
    'games',
    'meta',
    'seasonType',
    'week',
    'year',
  ]);
  assert.equal((body.meta as { cache: string }).cache, 'hit');
});
