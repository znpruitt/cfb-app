import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getApiUsageSnapshot,
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '../server/apiUsageBudget.ts';

test('api usage snapshot tracks route requests and cache outcomes', () => {
  const before = getApiUsageSnapshot();

  recordRouteRequest('schedule');
  recordRouteRequest('scores');
  recordRouteCacheHit('schedule');
  recordRouteCacheMiss('scores');

  const after = getApiUsageSnapshot();

  assert.equal(after.routeRequests.schedule, before.routeRequests.schedule + 1);
  assert.equal(after.routeRequests.scores, before.routeRequests.scores + 1);
  assert.equal(after.routeCache.schedule.hit, before.routeCache.schedule.hit + 1);
  assert.equal(after.routeCache.scores.miss, before.routeCache.scores.miss + 1);
});
