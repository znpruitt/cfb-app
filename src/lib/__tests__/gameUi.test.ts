import assert from 'node:assert/strict';
import test from 'node:test';

import { gameStateFromScore, gameStatusLabelPresentation } from '../gameUi.ts';
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

test('shared game status labels expose the four semantic tones without pill chrome', () => {
  const live = gameStatusLabelPresentation('live');
  const final = gameStatusLabelPresentation('final');
  const scheduled = gameStatusLabelPresentation('scheduled');
  const unknown = gameStatusLabelPresentation('unknown');

  assert.match(live.className, /dark:text-emerald-400/, 'live label must carry emerald');
  assert.equal(
    live.dotClassName,
    'size-1.5 rounded-full bg-current',
    'live label must carry the shared static dot'
  );
  assert.match(final.className, /dark:text-zinc-400/, 'final label must be neutral zinc');
  assert.equal(final.dotClassName, null, 'final label must not carry a dot');
  assert.match(scheduled.className, /dark:text-sky-400/, 'scheduled label must carry sky');
  assert.equal(scheduled.dotClassName, null, 'scheduled label must not carry a dot');
  assert.match(unknown.className, /dark:text-zinc-500/, 'unknown label must use dimmer zinc');
  assert.equal(unknown.dotClassName, null, 'unknown label must not carry a dot');

  for (const presentation of [live, final, scheduled, unknown]) {
    assert.match(presentation.className, /text-\[10px\].*uppercase.*tracking-\[0\.08em\]/);
    assert.doesNotMatch(presentation.className, /rounded-full|\bborder\b|bg-/);
  }
});

test('shared live status label supports the neutral freshness pulse used by Matchups', () => {
  const pulsing = gameStatusLabelPresentation('live', {
    liveHue: 'neutral',
    liveDot: 'pulse',
  });
  const dormant = gameStatusLabelPresentation('live', {
    liveHue: 'neutral',
    liveDot: 'none',
  });

  assert.match(pulsing.className, /dark:text-zinc-300/);
  assert.doesNotMatch(pulsing.className, /emerald/);
  assert.equal(pulsing.dotClassName, 'size-1.5 rounded-full bg-current animate-pulse');
  assert.equal(dormant.dotClassName, null);
});
