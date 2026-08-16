import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveControlOutcome } from '../controlOutcome';
import type { DraftState } from '@/lib/draft';

// ---------------------------------------------------------------------------
// PLATFORM-102 — a refused draft control must SAY so.
//
// The board's control helpers acted only on success: `if (res.ok && data.draft)`
// with no else. That was survivable while refusals were unreachable — the
// buttons were hidden in the states that would fail — and this slice made them
// reachable. Both reviewers flagged the same scenario: laptop and phone both
// open, the phone makes a pick, the laptop presses Undo, the server correctly
// answers 409, and the laptop shows NOTHING. The spinner stops. Pressing again
// fails identically because nothing re-fetched.
//
// The refusal bodies below are the ones the routes actually return, copied from
// the live responses observed while verifying over HTTP — not invented shapes.
// ---------------------------------------------------------------------------

const draft = { phase: 'live' } as DraftState;

test('a 409 from Undo surfaces the server’s own words', () => {
  const outcome = resolveControlOutcome(
    { ok: false, status: 409 },
    {
      error:
        'The board has moved on — pick 2 is no longer the last pick (it is now 1). Refresh and try again.',
    },
    'Undo did not apply'
  );

  assert.equal(outcome.kind, 'error');
  assert.match(
    outcome.kind === 'error' ? outcome.message : '',
    /no longer the last pick/,
    'the operator is told what happened and what to do — not given a status code'
  );
});

test('a 422 from auto-pick surfaces the reason', () => {
  const outcome = resolveControlOutcome(
    { ok: false, status: 422 },
    { error: 'Auto-pick is only valid from a paused, expired timer (phase: live, timer: running)' },
    'That control did not apply'
  );

  assert.equal(outcome.kind, 'error');
  assert.match(outcome.kind === 'error' ? outcome.message : '', /only valid from a paused/);
});

test('a refusal with no body still produces a message rather than silence', () => {
  const outcome = resolveControlOutcome({ ok: false, status: 500 }, {}, 'Undo did not apply');

  assert.equal(outcome.kind, 'error');
  assert.equal(
    outcome.kind === 'error' ? outcome.message : '',
    'Undo did not apply (500)',
    'the fallback carries the status so the failure is at least identifiable'
  );
});

test('a 200 carrying no draft is treated as failure, not success', () => {
  // This is the shape that made a failed control look like a dead button: the
  // old guard was `res.ok && data.draft`, and when it did not hold, nothing
  // happened at all.
  const outcome = resolveControlOutcome({ ok: true, status: 200 }, {}, 'unpick did not apply');

  assert.equal(outcome.kind, 'error');
});

test('a successful control applies the returned draft', () => {
  const outcome = resolveControlOutcome({ ok: true, status: 200 }, { draft }, 'unused');

  assert.equal(outcome.kind, 'applied');
  assert.equal(outcome.kind === 'applied' ? outcome.draft : null, draft);
});

test('a control that resets the draft redirects to setup', () => {
  const outcome = resolveControlOutcome(
    { ok: true, status: 200 },
    { draft: { phase: 'setup' } as DraftState },
    'unused'
  );

  assert.equal(outcome.kind, 'redirect-setup');
});

test('GUARD: the board re-syncs on a refusal instead of leaving a stale view', () => {
  // The message alone is not the whole fix. A refusal usually means this view is
  // behind, so the next press would fail identically unless something re-fetches.
  // Pinned at the source because the effect lives in the component, while the
  // decision — tested above — lives in the module.
  const src = readFileSync(
    fileURLToPath(new URL('../DraftBoardClient.tsx', import.meta.url)),
    'utf8'
  );

  const handler = src.slice(src.indexOf('async function applyControlResponse'));
  const errorBranch = handler.slice(handler.indexOf("outcome.kind === 'error'"));
  const branchEnd = errorBranch.indexOf('return;');

  assert.ok(branchEnd > 0, 'expected the error branch to return early');
  assert.match(
    errorBranch.slice(0, branchEnd),
    /refresh\(\)/,
    'the error branch must re-sync the board, or the next press fails identically'
  );
});
