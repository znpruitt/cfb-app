import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManualRolloverRequest,
  describeManualRolloverReason,
  describeManualRolloverRefusal,
  parseManualRolloverStatusResponse,
} from '../manualRollover.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the shared client-safe rollover contract the panel decodes
// through, so request/response shapes cannot drift from the server's.
// ---------------------------------------------------------------------------

// CONTRACT PIN (PLATFORM-086F2H3A) — the builder carries the explicit year and
// NEVER emits `confirmed`. The route answers `confirmed: true` with
// `rollover-execution-retired`, so a builder that reintroduced the field would
// make every preview click a refused request.
test('buildManualRolloverRequest carries the explicit year and never emits confirmed', () => {
  assert.deepEqual(buildManualRolloverRequest(2024), { year: 2024 });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(buildManualRolloverRequest(2024), 'confirmed'),
    'the retired field is absent from the body, not merely false'
  );
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
  // PLATFORM-086F2H3A — an execute attempt must read as a RETIRED capability,
  // not as a transient error worth retrying. Reachable only by clients built
  // from F2H3A onward: a stale pre-F2H3A bundle ships the older `default:
  // return null` and renders the generic HTTP message, and the 409 alone is
  // what protects that caller.
  assert.match(
    describeManualRolloverRefusal({ error: 'rollover-execution-retired' }) ?? '',
    /retired/
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
