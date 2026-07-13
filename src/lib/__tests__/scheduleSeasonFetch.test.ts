import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyEmptyScheduleRefresh,
  hasRequiredSeasonTypeFailure,
} from '../scheduleSeasonFetch.ts';

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

test('classifyEmptyScheduleRefresh: shared empty-response policy (finding #2)', () => {
  // Mapped rows present → commit as usual.
  assert.equal(classifyEmptyScheduleRefresh({ mappedRows: 5, priorDurableRows: 0 }), 'not-empty');
  assert.equal(classifyEmptyScheduleRefresh({ mappedRows: 5, priorDurableRows: 9 }), 'not-empty');
  // Zero mapped rows over a populated prior-good schedule → reject (empty replacement).
  assert.equal(
    classifyEmptyScheduleRefresh({ mappedRows: 0, priorDurableRows: 12 }),
    'unexpected-empty-replacement'
  );
  // Zero mapped rows with no prior-good schedule → valid no-op (unpublished/inapplicable).
  assert.equal(classifyEmptyScheduleRefresh({ mappedRows: 0, priorDurableRows: 0 }), 'valid-noop');
});
