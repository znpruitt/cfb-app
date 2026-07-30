import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManualRolloverRequest,
  describeManualRolloverReason,
  describeManualRolloverRefusal,
  parseManualRolloverStatusResponse,
} from '../manualRollover.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the shared client-safe manual-rollover contract both
// panels decode through, so request/response shapes cannot drift per panel.
// ---------------------------------------------------------------------------

test('buildManualRolloverRequest always carries the explicit year', () => {
  assert.deepEqual(buildManualRolloverRequest(2024, false), { year: 2024, confirmed: false });
  assert.deepEqual(buildManualRolloverRequest(2024, true), { year: 2024, confirmed: true });
});

test('parseManualRolloverStatusResponse accepts the contract shape', () => {
  const parsed = parseManualRolloverStatusResponse({
    generatedAt: '2026-01-01T00:00:00.000Z',
    years: [
      {
        year: 2023,
        eligibility: 'eligible',
        reason: null,
        championshipDate: '2024-01-09T00:00:00.000Z',
        rolloverDate: '2024-01-16T00:00:00.000Z',
        leagues: [],
      },
      {
        year: 2024,
        eligibility: 'not-eligible',
        reason: 'waiting-period',
        championshipDate: null,
        rolloverDate: null,
        leagues: [],
      },
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(
    parsed.years.map((y) => ({ year: y.year, eligibility: y.eligibility, reason: y.reason })),
    [
      { year: 2023, eligibility: 'eligible', reason: null },
      { year: 2024, eligibility: 'not-eligible', reason: 'waiting-period' },
    ]
  );
});

test('parseManualRolloverStatusResponse rejects malformed payloads', () => {
  assert.equal(parseManualRolloverStatusResponse(null), null);
  assert.equal(parseManualRolloverStatusResponse('nope'), null);
  assert.equal(parseManualRolloverStatusResponse({ years: [] }), null);
  assert.equal(
    parseManualRolloverStatusResponse({ generatedAt: 'x', years: [{ year: 'bad' }] }),
    null
  );
  assert.equal(
    parseManualRolloverStatusResponse({
      generatedAt: 'x',
      years: [{ year: 2024, eligibility: 'perhaps', leagues: [] }],
    }),
    null,
    'unknown eligibility rejected'
  );
});

test('refusal payloads map to operator-readable language', () => {
  assert.match(
    describeManualRolloverRefusal({ error: 'rollover-year-not-active' }) ?? '',
    /no longer an active season group/
  );
  assert.match(
    describeManualRolloverRefusal({ error: 'rollover-not-eligible', reason: 'not-final' }) ?? '',
    /not final yet/
  );
  assert.match(
    describeManualRolloverRefusal({ error: 'rollover-eligibility-unavailable' }) ?? '',
    /durable store read failed/
  );
  assert.equal(describeManualRolloverRefusal({ error: 'something-else' }), null);
  assert.equal(describeManualRolloverRefusal('nope'), null);
});

test('every stable reason has operator-readable language', () => {
  for (const reason of [
    'no-season-schedule',
    'no-structured-championship',
    'score-missing',
    'not-final',
    'disrupted',
    'waiting-period',
    'read-failed',
  ] as const) {
    const text = describeManualRolloverReason(reason);
    assert.ok(text.length > 10, `${reason} described`);
    assert.ok(!text.includes(reason), 'stable code translated, not echoed');
  }
});
