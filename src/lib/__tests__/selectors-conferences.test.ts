import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveConferenceOptionsFromTrackedGames } from '../selectors/conferences';

test('conference selector derives stable, deduped, FBS-only options from tracked games', () => {
  const games = [
    { canAway: 'Fordham', awayConf: 'Patriot', canHome: 'Boston College', homeConf: 'ACC' },
    { canAway: 'Clemson', awayConf: 'ACC', canHome: 'Boston College', homeConf: 'ACC' },
    {
      canAway: 'Boise State',
      awayConf: 'Mountain West',
      canHome: 'Utah State',
      homeConf: 'Mountain West',
    },
    { canAway: 'Tulane', awayConf: 'AAC', canHome: 'Memphis', homeConf: 'AAC' },
  ];
  const fbsNames = new Set([
    'Boston College',
    'Clemson',
    'Boise State',
    'Utah State',
    'Tulane',
    'Memphis',
  ]);

  const conferences = deriveConferenceOptionsFromTrackedGames({
    games,
    isFbsTeamName: (name) => fbsNames.has(name),
  });

  assert.deepEqual(conferences, ['ALL', 'AAC', 'ACC', 'Mountain West']);
});

test('conference selector safely ignores empty conference values', () => {
  const conferences = deriveConferenceOptionsFromTrackedGames({
    games: [{ canAway: 'Boston College', awayConf: '', canHome: 'Clemson', homeConf: '  ' }],
    isFbsTeamName: () => true,
  });

  assert.deepEqual(conferences, ['ALL']);
});
