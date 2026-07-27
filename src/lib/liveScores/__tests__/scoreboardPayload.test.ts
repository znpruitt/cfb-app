import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyStatusLabel } from '@/lib/gameStatus';

import {
  isScoreboardFinal,
  normalizeScoreboardPayload,
  normalizeScoreboardRow,
  scoreboardStatusLabel,
} from '../scoreboardPayload';
import { makeScoreboardRow } from './fixtures';

// ---- Payload-level classification (prompt case 13) ------------------------

test('a non-array top level is reported as non-array', () => {
  assert.deepEqual(normalizeScoreboardPayload({ games: [] }), { topLevel: 'non-array' });
  assert.deepEqual(normalizeScoreboardPayload(null), { topLevel: 'non-array' });
});

test('an empty array reports rawCount 0 and no rows', () => {
  const result = normalizeScoreboardPayload([]);
  assert.equal(result.topLevel, 'array');
  if (result.topLevel !== 'array') return;
  assert.equal(result.rawCount, 0);
  assert.equal(result.rows.length, 0);
});

test('a nonempty array whose rows are all structurally unusable is schema drift (rawCount>0, rows empty)', () => {
  const result = normalizeScoreboardPayload([
    { id: 'not-numeric', status: 'scheduled', homeTeam: { name: 'A' }, awayTeam: { name: 'B' } },
    { id: 5, status: 'unknown-status', homeTeam: { name: 'A' }, awayTeam: { name: 'B' } },
    { id: 6, status: 'scheduled', homeTeam: { name: '' }, awayTeam: { name: 'B' } },
  ]);
  assert.equal(result.topLevel, 'array');
  if (result.topLevel !== 'array') return;
  assert.equal(result.rawCount, 3);
  assert.equal(result.rows.length, 0);
});

test('usable rows are extracted; unrelated fields are dropped', () => {
  const result = normalizeScoreboardPayload([
    {
      id: 401001,
      startDate: '2025-10-11T20:00:00.000Z',
      status: 'in_progress',
      period: 3,
      clock: '08:14',
      homeTeam: { id: 333, name: 'Alabama', points: 21, conference: 'SEC' },
      awayTeam: { id: 61, name: 'Georgia', points: 17 },
      weather: { temp: 70 },
      betting: { spread: -3 },
      lastPlay: 'run for 5',
    },
  ]);
  assert.equal(result.topLevel, 'array');
  if (result.topLevel !== 'array') return;
  assert.equal(result.rows.length, 1);
  const row = result.rows[0]!;
  assert.equal(row.providerGameId, 401001);
  assert.equal(row.homeId, 333);
  assert.equal(row.awayId, 61);
  assert.equal(row.homeTeam, 'Alabama');
  assert.equal(row.homePoints, 21);
  assert.equal(row.awayPoints, 17);
  // No unrelated fields ever surface on the normalized row.
  assert.deepEqual(Object.keys(row).sort(), [
    'awayId',
    'awayPoints',
    'awayTeam',
    'clock',
    'homeId',
    'homePoints',
    'homeTeam',
    'period',
    'providerGameId',
    'startDate',
    'status',
  ]);
});

test('a row without a valid positive provider game id is dropped', () => {
  assert.equal(
    normalizeScoreboardRow({
      id: 0,
      status: 'scheduled',
      homeTeam: { name: 'A' },
      awayTeam: { name: 'B' },
    }),
    null
  );
  assert.equal(
    normalizeScoreboardRow({
      id: -5,
      status: 'scheduled',
      homeTeam: { name: 'A' },
      awayTeam: { name: 'B' },
    }),
    null
  );
  assert.equal(
    normalizeScoreboardRow({
      status: 'scheduled',
      homeTeam: { name: 'A' },
      awayTeam: { name: 'B' },
    }),
    null
  );
});

// ---- Status normalization (prompt case 12) --------------------------------

test('scheduled → scheduled label', () => {
  const row = makeScoreboardRow({ providerGameId: 1, status: 'scheduled' });
  assert.equal(scoreboardStatusLabel(row), 'scheduled');
  assert.equal(classifyStatusLabel(scoreboardStatusLabel(row)), 'scheduled');
});

test('in_progress with period + clock → a live quarter label the classifier reads as inprogress', () => {
  const row = makeScoreboardRow({
    providerGameId: 1,
    status: 'in_progress',
    period: 3,
    clock: '08:14',
  });
  assert.equal(scoreboardStatusLabel(row), 'Q3 8:14');
  assert.equal(classifyStatusLabel('Q3 8:14'), 'inprogress');
});

test('in_progress beyond regulation → OT, read as inprogress', () => {
  const row = makeScoreboardRow({
    providerGameId: 1,
    status: 'in_progress',
    period: 5,
    clock: '02:00',
  });
  assert.equal(scoreboardStatusLabel(row), 'OT');
  assert.equal(classifyStatusLabel('OT'), 'inprogress');
});

test('in_progress without period → In Progress, read as inprogress', () => {
  const row = makeScoreboardRow({ providerGameId: 1, status: 'in_progress' });
  assert.equal(scoreboardStatusLabel(row), 'In Progress');
  assert.equal(classifyStatusLabel('In Progress'), 'inprogress');
});

test('completed with both scores → final; completed missing a score → In Progress (never a fabricated final)', () => {
  const finalRow = makeScoreboardRow({
    providerGameId: 1,
    status: 'completed',
    homePoints: 24,
    awayPoints: 21,
  });
  assert.equal(scoreboardStatusLabel(finalRow), 'final');
  assert.equal(isScoreboardFinal(finalRow), true);

  const incomplete = makeScoreboardRow({
    providerGameId: 1,
    status: 'completed',
    homePoints: 24,
    awayPoints: null,
  });
  assert.equal(scoreboardStatusLabel(incomplete), 'In Progress');
  assert.equal(isScoreboardFinal(incomplete), false);
});
