import assert from 'node:assert/strict';
import test from 'node:test';

import { gameStateFromScore } from '../gameUi.ts';
import type { ScorePack } from '../scores.ts';

// PLATFORM-086B1 — gameStateFromScore now delegates to the central status
// classifier, so live labels the old loose substring matcher missed are
// recognized consistently.

function score(status: string): ScorePack {
  return { status, home: { team: 'A', score: 1 }, away: { team: 'B', score: 2 }, time: null };
}

test('no score → unknown; an empty/whitespace status stays unknown', () => {
  assert.equal(gameStateFromScore(undefined), 'unknown');
  assert.equal(gameStateFromScore(score('')), 'unknown');
  assert.equal(gameStateFromScore(score('   ')), 'unknown');
});

test('live scoreboard labels are recognized as inprogress through the central classifier', () => {
  assert.equal(gameStateFromScore(score('Q3 8:14')), 'inprogress');
  assert.equal(gameStateFromScore(score('OT')), 'inprogress');
  assert.equal(gameStateFromScore(score('In Progress')), 'inprogress');
});

test('final and scheduled labels classify as before', () => {
  assert.equal(gameStateFromScore(score('final')), 'final');
  assert.equal(gameStateFromScore(score('FINAL')), 'final');
  assert.equal(gameStateFromScore(score('scheduled')), 'scheduled');
});

test('a disrupted label presents as scheduled', () => {
  assert.equal(gameStateFromScore(score('postponed')), 'scheduled');
  assert.equal(gameStateFromScore(score('canceled')), 'scheduled');
});
