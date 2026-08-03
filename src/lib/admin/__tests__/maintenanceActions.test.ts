import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAINTENANCE_ACTION_IDS,
  MAINTENANCE_ACTIONS,
  MAINTENANCE_COST_CAVEAT,
  type MaintenanceActionClass,
} from '../maintenanceActions.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2C — the shared maintenance-action description contract. Every
// action on the Data Maintenance & Recovery page discloses provider, nominal
// cost, durable mutations, automation owner, and class — allowlisted copy only.
// ---------------------------------------------------------------------------

const EXPECTED_IDS = [
  'schedule-full-year-refresh',
  'scores-aggregate-refresh',
  'game-stats-partition-refresh',
  'game-stats-full-backfill',
  'odds-refresh',
  'rankings-refresh',
  'historical-schedule-repair',
  'historical-scores-repair',
  'conferences-refresh',
  'team-database-sync',
  'score-attachment-recovery',
] as const;

const VALID_CLASSES: readonly MaintenanceActionClass[] = ['routine', 'recovery', 'emergency'];

test('all eleven action IDs exist exactly once', () => {
  assert.deepEqual([...MAINTENANCE_ACTION_IDS].sort(), [...EXPECTED_IDS].sort());
  assert.equal(new Set(MAINTENANCE_ACTION_IDS).size, 11);
});

test('retired SP+/win-total actions are absent from the descriptor inventory', () => {
  assert.ok(!MAINTENANCE_ACTION_IDS.includes('sp-ratings-refresh' as never));
  assert.ok(!MAINTENANCE_ACTION_IDS.includes('win-totals-upload' as never));
});

test('every descriptor has nonblank fields and a valid class', () => {
  for (const id of MAINTENANCE_ACTION_IDS) {
    const d = MAINTENANCE_ACTIONS[id];
    assert.equal(d.id, id, `${id}: id matches key`);
    assert.ok(d.label.trim().length > 0, `${id}: label`);
    assert.ok(d.provider.trim().length > 0, `${id}: provider`);
    assert.ok(d.nominalCost.trim().length > 0, `${id}: nominalCost`);
    assert.ok(d.automationOwner.trim().length > 0, `${id}: automationOwner`);
    assert.ok(d.durableMutations.length > 0, `${id}: durableMutations nonempty`);
    assert.ok(
      d.durableMutations.every((m) => m.trim().length > 0),
      `${id}: no blank mutation entries`
    );
    assert.ok(VALID_CLASSES.includes(d.actionClass), `${id}: valid class`);
  }
});

test('exactly the two audited high-cost actions are emergency', () => {
  const emergencies = MAINTENANCE_ACTION_IDS.filter(
    (id) => MAINTENANCE_ACTIONS[id].actionClass === 'emergency'
  ).sort();
  assert.deepEqual(emergencies, ['game-stats-full-backfill', 'score-attachment-recovery']);
});

test('the score-attachment recovery descriptor states the approved facts', () => {
  const d = MAINTENANCE_ACTIONS['score-attachment-recovery'];
  assert.equal(d.label, 'Refresh scores and run attachment trace');
  assert.equal(d.provider, 'CFBD through the schedule, conference, and score adapters');
  assert.match(d.nominalCost, /1–2 score requests/);
  assert.match(d.nominalCost, /2 schedule partitions and 1 conferences request/);
  assert.match(d.nominalCost, /fall back across provider weeks/);
  assert.deepEqual(d.durableMutations, [
    'Score caches and scoped provider-refresh statuses',
    'Standings invalidation when scores change',
    'Schedule and conference caches/statuses when cold context rebuilds them',
  ]);
  assert.equal(d.automationOwner, 'Operator diagnostic and recovery only');
  assert.equal(d.actionClass, 'emergency');
});

test('routine vs recovery classifications match the audited action classes', () => {
  for (const id of ['conferences-refresh', 'team-database-sync'] as const) {
    assert.equal(MAINTENANCE_ACTIONS[id].actionClass, 'routine', id);
  }
  for (const id of [
    'schedule-full-year-refresh',
    'scores-aggregate-refresh',
    'game-stats-partition-refresh',
    'odds-refresh',
    'rankings-refresh',
    'historical-schedule-repair',
    'historical-scores-repair',
  ] as const) {
    assert.equal(MAINTENANCE_ACTIONS[id].actionClass, 'recovery', id);
  }
});

test('the nominal-cost caveat is stated once as shared copy', () => {
  assert.match(MAINTENANCE_COST_CAVEAT, /nominal/i);
  assert.match(MAINTENANCE_COST_CAVEAT, /retry/i);
});
