import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeAutoCompleteDraftResult,
  describeTestControlResult,
  describeTestControlRefusal,
  type TestControlRefusalReason,
  type TestControlResult,
} from '../testLeagueControl.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3B1 — operator language for the demo lifecycle controls.
//
// Before this, every refusal was a thrown Server Action error. In production
// that message is REDACTED to an opaque digest, so the reason could not be
// recovered by the client at all — which is why it had to move onto the RETURN
// value rather than into the error text.
// ---------------------------------------------------------------------------

test('an applied change says what it moved to', () => {
  assert.deepEqual(
    describeTestControlResult({ kind: 'applied', state: 'season', year: 2025, cacheStale: false }),
    { tone: 'success', message: 'Moved to Season 2025.' }
  );
  assert.deepEqual(
    describeTestControlResult({
      kind: 'applied',
      state: 'preseason',
      year: 2026,
      cacheStale: false,
    }),
    { tone: 'success', message: 'Moved to Preseason 2026.' }
  );
});

// Offseason carries no year in `LeagueStatus`, so the copy must not invent one.
test('offseason copy names no year', () => {
  const applied = describeTestControlResult({
    kind: 'applied',
    state: 'offseason',
    year: null,
    cacheStale: false,
  });
  assert.equal(applied.message, 'Moved to Offseason.');
  assert.ok(!/\d/.test(applied.message), 'no digits — there is no offseason year to report');
});

// REGRESSION TEST — a post-commit cache failure is NOT a failed transition. The
// registry write is already durable when `invalidateStandings` runs, so
// reporting a refusal there would tell the operator a change did not happen when
// it did. Same misattribution class F2H2B removed from the rollover cron.
test('a stale cache is reported alongside the change, not instead of it', () => {
  const feedback = describeTestControlResult({
    kind: 'applied',
    state: 'season',
    year: 2025,
    cacheStale: true,
  });
  assert.equal(feedback.tone, 'success', 'the transition succeeded');
  assert.match(feedback.message, /^Moved to Season 2025\./, 'it still leads with what happened');
  // Worded for BOTH revalidation calls: they share one Next store, so the fault
  // that occurs takes the admin path as well as the standings tag, and naming
  // only the standings cache would understate what is stale.
  assert.match(feedback.message, /Cached views may be briefly stale/);
});

test('a no-change result says "Already in", never "Moved to"', () => {
  const feedback = describeTestControlResult({ kind: 'no-change', state: 'season', year: 2025 });
  assert.deepEqual(feedback, { tone: 'neutral', message: 'Already in Season 2025.' });
  assert.ok(!feedback.message.includes('Moved'), 'no claim of movement');
});

// The three refusal reasons are different operator conditions and must not
// collapse into one message — a corrupt stored year needs a repair, an
// unsupported state is a bad request, and a missing league is neither.
test('every refusal reason has distinct copy that never echoes the code', () => {
  const reasons: TestControlRefusalReason[] = [
    'unusable-lifecycle',
    'unsupported-state',
    'league-not-found',
  ];
  const messages = reasons.map(describeTestControlRefusal);
  assert.equal(new Set(messages).size, reasons.length, 'distinct copy per reason');
  for (const [i, message] of messages.entries()) {
    assert.ok(!message.includes(reasons[i]!), 'the stable code is translated, not echoed');
    assert.match(message, /No change was made\./, 'every refusal states nothing changed');
  }
  // The mapping THROUGH `describeTestControlResult` is asserted too, not just
  // the helper in isolation. A mutation that collapsed the refusal branch into
  // the generic failure copy left the helper untouched and survived a check that
  // only exercised `describeTestControlRefusal` directly.
  const generic = describeTestControlResult({ kind: 'failed' }).message;
  for (const reason of reasons) {
    const feedback = describeTestControlResult({ kind: 'refused', reason });
    assert.equal(feedback.tone, 'error');
    assert.equal(feedback.message, describeTestControlRefusal(reason), 'the reason survives');
    assert.notEqual(
      feedback.message,
      generic,
      'a refusal is a known condition and must not read as an unexplained failure'
    );
  }
});

// REGRESSION TEST — the control previously rendered `(err as Error).message`
// from a caught Server Action rejection. In production that is an opaque digest
// presented to an operator as an explanation.
test('an unexpected failure produces generic copy carrying no error text', () => {
  const feedback = describeTestControlResult({ kind: 'failed' });
  assert.equal(feedback.tone, 'error');
  assert.equal(feedback.message, 'Something went wrong. No change was confirmed.');
  // It also must not overclaim: the action may have committed before failing.
  assert.ok(!/no change was made/i.test(feedback.message), 'it says UNCONFIRMED, not "no change"');
});

// Every variant must produce copy — a future member added without copy would
// otherwise render as `undefined` at the operator.
test('every result kind maps to non-empty copy', () => {
  const results: TestControlResult[] = [
    { kind: 'applied', state: 'season', year: 2025, cacheStale: false },
    { kind: 'applied', state: 'season', year: 2025, cacheStale: true },
    { kind: 'no-change', state: 'offseason', year: null },
    { kind: 'refused', reason: 'unusable-lifecycle' },
    { kind: 'failed' },
  ];
  for (const result of results) {
    const { message, tone } = describeTestControlResult(result);
    assert.ok(message.length > 10, `copy for ${result.kind}`);
    assert.ok(['success', 'neutral', 'error'].includes(tone));
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3B1 — the draft auto-complete result.
//
// Review caught a regression in the first version of this slice: routing that
// control's thrown errors through a blanket catch replaced FOUR actionable
// diagnostics with one generic sentence. The production digest problem was real,
// but the fix was a typed result, not a shorter message.
// ---------------------------------------------------------------------------

test('every auto-complete refusal keeps its own distinguishable answer', () => {
  const messages = (
    ['league-not-found', 'no-draft', 'already-complete', 'no-draft-order', 'slots-filled'] as const
  ).map((reason) => describeAutoCompleteDraftResult({ kind: 'refused', reason }).message);

  assert.equal(new Set(messages).size, messages.length, 'no two refusals read alike');
  for (const message of messages) assert.ok(message.length > 10);

  // The two that mattered most in practice: "no draft exists" and "the draft is
  // already complete" are opposite conditions and used to be distinguishable.
  const [, noDraft, complete] = messages;
  assert.match(noDraft!, /No draft exists/);
  assert.match(complete!, /already complete/);
});

test('a completed run reports the pick count, and an empty one is not a success', () => {
  assert.deepEqual(describeAutoCompleteDraftResult({ kind: 'completed', picks: 12 }), {
    tone: 'success',
    message: 'Auto-completed 12 picks.',
  });
  assert.equal(
    describeAutoCompleteDraftResult({ kind: 'completed', picks: 1 }).message,
    'Auto-completed 1 pick.'
  );
  assert.equal(
    describeAutoCompleteDraftResult({ kind: 'completed', picks: 0 }).tone,
    'neutral',
    'filling nothing is not a success'
  );
});

test('the not-enough-teams refusal keeps both numbers', () => {
  const feedback = describeAutoCompleteDraftResult({
    kind: 'refused-not-enough-teams',
    available: 3,
    needed: 40,
  });
  assert.equal(feedback.tone, 'error');
  assert.match(feedback.message, /\(3\)/);
  assert.match(feedback.message, /40 remaining picks/);
});
