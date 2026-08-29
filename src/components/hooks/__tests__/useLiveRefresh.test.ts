import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectScoreFinalizations,
  nextBootstrapGuardState,
  updateScoreHydrationCleanState,
} from '../useLiveRefresh';
import type { ScorePack } from '../../../lib/scores';

function score(status: string): ScorePack {
  return {
    status,
    home: { team: 'Home', score: 21 },
    away: { team: 'Away', score: 14 },
    time: null,
  };
}

function scoreWith(status: string, home: number, away: number): ScorePack {
  return {
    status,
    home: { team: 'Home', score: home },
    away: { team: 'Away', score: away },
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

test('an in-place schedule generation change rearms score bootstrap', () => {
  const next = nextBootstrapGuardState({
    current: true,
    scheduleLoaded: true,
    generationChanged: true,
  });

  assert.equal(next, false);
});

test('full-scope hydration cleanliness updates only the requested schedule phase', () => {
  const afterPostseasonSuccess = updateScoreHydrationCleanState(
    { regular: false, postseason: false },
    ['postseason'],
    []
  );
  assert.deepEqual(afterPostseasonSuccess, { regular: false, postseason: true });

  assert.deepEqual(updateScoreHydrationCleanState(afterPostseasonSuccess, ['regular'], []), {
    regular: true,
    postseason: true,
  });
  assert.deepEqual(
    updateScoreHydrationCleanState(afterPostseasonSuccess, ['postseason'], ['postseason']),
    {
      regular: false,
      postseason: false,
    }
  );
});

// PLATFORM-080 — transition-aware finalization detection.
test('non-final → final transition triggers exactly one finalization signal', () => {
  const observedKeys = new Set<string>();
  const finalScores = new Map<string, string>();

  // Poll 1: game in progress — observed, not final, no signal.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('in_progress') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    false
  );
  // Poll 2: same game now final — real transition → signal once.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    true
  );
});

test('repeated polls with the same final game do not repeatedly signal', () => {
  const observedKeys = new Set<string>();
  const finalScores = new Map<string, string>();

  detectScoreFinalizations({
    nextScores: { g1: score('in_progress') },
    scopeGameKeys: ['g1'],
    observedKeys,
    finalScores,
  });
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    true
  );
  // Subsequent polls with the same final game must not signal again.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    false
  );
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    false
  );
});

test('initial payload with already-final games does not signal', () => {
  const observedKeys = new Set<string>();
  const finalScores = new Map<string, string>();

  // First time these games are seen and they are already final (initial load,
  // or a game entering scope already final): canonical already reflects them.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final'), g2: score('Final') },
      scopeGameKeys: ['g1', 'g2'],
      observedKeys,
      finalScores,
    }),
    false
  );
});

test('in-progress score updates do not signal a finalization', () => {
  const observedKeys = new Set<string>();
  const finalScores = new Map<string, string>();

  detectScoreFinalizations({
    nextScores: { g1: score('1st Quarter') },
    scopeGameKeys: ['g1'],
    observedKeys,
    finalScores,
  });
  // Score changes but stays in progress — no finalization.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('4th Quarter') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
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
  const finalScores = new Map<string, string>();

  // Poll 1: g1 watched but no score row yet.
  assert.equal(
    detectScoreFinalizations({
      nextScores: {},
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    false
  );
  // Poll 2: an authorized refresh has since seeded g1 as final.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: score('Final') },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    true
  );
});

// PLATFORM-086B2B — the browser keeps polling in-window finals so a `/games`
// reconciliation correction reaches canonical standings, not just the game card.
test('a material final → final score correction signals a canonical refresh', () => {
  const observedKeys = new Set<string>();
  const finalScores = new Map<string, string>();

  // Provisional scoreboard final (21-14).
  detectScoreFinalizations({
    nextScores: { g1: scoreWith('Final', 21, 14) },
    scopeGameKeys: ['g1'],
    observedKeys,
    finalScores,
  });
  // `/games` reconciliation revises the score (24-14) — must signal so canonical
  // standings/records recompute, even though g1 was already final.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: scoreWith('Final', 24, 14) },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    true
  );
  // A repeat of the corrected score does not re-signal.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: scoreWith('Final', 24, 14) },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    false
  );
});

test('a status-label-only change on a final with unchanged scores does not signal', () => {
  const observedKeys = new Set<string>();
  const finalScores = new Map<string, string>();

  detectScoreFinalizations({
    nextScores: { g1: scoreWith('Final', 21, 14) },
    scopeGameKeys: ['g1'],
    observedKeys,
    finalScores,
  });
  // Same scores, different label (e.g. Final → Final/OT) — not a material change.
  assert.equal(
    detectScoreFinalizations({
      nextScores: { g1: scoreWith('Final/OT', 21, 14) },
      scopeGameKeys: ['g1'],
      observedKeys,
      finalScores,
    }),
    false
  );
});
