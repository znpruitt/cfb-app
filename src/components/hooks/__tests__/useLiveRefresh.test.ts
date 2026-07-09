import assert from 'node:assert/strict';
import test from 'node:test';

import { detectScoreFinalizations, nextBootstrapGuardState } from '../useLiveRefresh';
import type { ScorePack } from '../../../lib/scores';

function score(status: string): ScorePack {
  return {
    status,
    home: { team: 'Home', score: 21 },
    away: { team: 'Away', score: 14 },
    time: null,
  };
}

test('initial loaded state can bootstrap and arms guard', () => {
  const next = nextBootstrapGuardState({
    current: false,
    scheduleLoaded: true,
    didBootstrapThisPass: true,
  });

  assert.equal(next, true);
});

test('unloaded schedule resets bootstrap guard', () => {
  const next = nextBootstrapGuardState({
    current: true,
    scheduleLoaded: false,
  });

  assert.equal(next, false);
});

test('later reload can bootstrap again after unload reset', () => {
  const afterUnload = nextBootstrapGuardState({
    current: true,
    scheduleLoaded: false,
  });
  const afterReloadBootstrap = nextBootstrapGuardState({
    current: afterUnload,
    scheduleLoaded: true,
    didBootstrapThisPass: true,
  });

  assert.equal(afterUnload, false);
  assert.equal(afterReloadBootstrap, true);
});

test('continuous loaded state without bootstrap keeps guard stable', () => {
  const next = nextBootstrapGuardState({
    current: true,
    scheduleLoaded: true,
    didBootstrapThisPass: false,
  });

  assert.equal(next, true);
});

// PLATFORM-080 — transition-aware finalization detection.
test('non-final → final transition triggers exactly one finalization signal', () => {
  const observedKeys = new Set<string>();
  const finalKeys = new Set<string>();

  // Poll 1: game in progress — observed, not final, no signal.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('in_progress') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    false
  );
  // Poll 2: same game now final — real transition → signal once.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    true
  );
});

test('repeated polls with the same final game do not repeatedly signal', () => {
  const observedKeys = new Set<string>();
  const finalKeys = new Set<string>();

  detectScoreFinalizations({
    nextScores: { g1: score('in_progress') },
    scopeGameKeys: ['g1'],
    observedKeys,
    finalKeys,
  });
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    true
  );
  // Subsequent polls with the same final game must not signal again.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    false
  );
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    false
  );
});

test('initial payload with already-final games does not signal', () => {
  const observedKeys = new Set<string>();
  const finalKeys = new Set<string>();

  // First time these games are seen and they are already final (initial load,
  // or a game entering scope already final): canonical already reflects them.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final'), g2: score('Final') },
      scopeGameKeys: ['g1', 'g2'],
      observedKeys,
      finalKeys,
    }),
    false
  );
});

test('in-progress score updates do not signal a finalization', () => {
  const observedKeys = new Set<string>();
  const finalKeys = new Set<string>();

  detectScoreFinalizations({
    nextScores: { g1: score('1st Quarter') },
    scopeGameKeys: ['g1'],
    observedKeys,
    finalKeys,
  });
  // Score changes but stays in progress — no finalization.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('4th Quarter') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    false
  );
});

test('scheduled game with no prior score row still signals when it later finalizes', () => {
  // Codex P2 regression: a scheduled game is in the watched scope but has no
  // attached score row (cold/stale public cache or a failed attach), so it is
  // absent from nextScores. Because observed is seeded from the scope, its later
  // finalization is a real transition — not a first-seen final — and signals.
  const observedKeys = new Set<string>();
  const finalKeys = new Set<string>();

  // Poll 1: g1 watched but no score row yet.
  assert.equal(
    detectScoreFinalizations({
      nextScores: {},
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    false
  );
  // Poll 2: an authorized refresh has since seeded g1 as final.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalKeys,
    }),
    true
  );
});
