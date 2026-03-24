import assert from 'node:assert/strict';
import test from 'node:test';

import { createRankingsRequestGuard } from '../rankingsRequestGuard';

test('rankings request guard ignores stale request ids after a newer request starts', () => {
  const guard = createRankingsRequestGuard();

  const firstRequest = guard.nextRequestId();
  const secondRequest = guard.nextRequestId();

  assert.equal(guard.isCurrent(firstRequest), false);
  assert.equal(guard.isCurrent(secondRequest), true);
});

test('rankings request guard invalidates pending requests on cancelOutstanding', () => {
  const guard = createRankingsRequestGuard();

  const requestId = guard.nextRequestId();
  assert.equal(guard.isCurrent(requestId), true);

  guard.cancelOutstanding();
  assert.equal(guard.isCurrent(requestId), false);
});
