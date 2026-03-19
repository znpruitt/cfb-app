import test from 'node:test';
import assert from 'node:assert/strict';

import { hasRequiredSeasonTypeFailure } from '../scheduleSeasonFetch.ts';

test('requires both regular and postseason responses when seasonType=all', () => {
  assert.equal(hasRequiredSeasonTypeFailure('all', []), false);
  assert.equal(hasRequiredSeasonTypeFailure('all', ['regular']), true);
  assert.equal(hasRequiredSeasonTypeFailure('all', ['postseason']), true);
});

test('treats single season-type requests independently', () => {
  assert.equal(hasRequiredSeasonTypeFailure('regular', ['postseason']), false);
  assert.equal(hasRequiredSeasonTypeFailure('regular', ['regular']), true);

  assert.equal(hasRequiredSeasonTypeFailure('postseason', ['regular']), false);
  assert.equal(hasRequiredSeasonTypeFailure('postseason', ['postseason']), true);
});
