import test from 'node:test';
import assert from 'node:assert/strict';

import { isTruePostseasonGame, isWeekContextGame } from '../postseason-display';

test('conference championship stage is excluded from postseason tab classification', () => {
  assert.equal(
    isTruePostseasonGame({
      stage: 'conference_championship',
      postseasonRole: 'conference_championship',
    }),
    false
  );
});

test('conference championship games are explicitly kept in week context', () => {
  assert.equal(
    isWeekContextGame({
      stage: 'conference_championship',
      postseasonRole: 'conference_championship',
    }),
    true
  );
});
test('regular-season games remain excluded from postseason tab classification', () => {
  assert.equal(isTruePostseasonGame({ stage: 'regular', postseasonRole: null }), false);
});

test('bowl and playoff games remain included in postseason tab classification', () => {
  assert.equal(isTruePostseasonGame({ stage: 'bowl', postseasonRole: 'bowl' }), true);
  assert.equal(isTruePostseasonGame({ stage: 'playoff', postseasonRole: 'playoff' }), true);
  assert.equal(
    isTruePostseasonGame({ stage: 'playoff', postseasonRole: 'national_championship' }),
    true
  );
});
