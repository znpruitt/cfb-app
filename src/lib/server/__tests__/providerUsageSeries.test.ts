import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendProviderUsageObservation,
  buildProviderUsageObservation,
  parseProviderUsageSeries,
  PROVIDER_USAGE_MAX_OBSERVATIONS,
  type ProviderUsageObservation,
} from '../providerUsageSeries';

function obs(overrides: Partial<ProviderUsageObservation> = {}): ProviderUsageObservation {
  return { at: '2026-09-04T00:00:00.000Z', remaining: 4600, limit: 5000, ...overrides };
}

/**
 * The model stores what was observed, so these tests are about STORAGE, not
 * interpretation. There is no reset detection, period assignment, or
 * "which reading wins" to exercise — those were the questions the previous
 * design answered at write time, and where every defect lived.
 */

test('arrival order does not matter — observations are sorted by time', () => {
  // The property the whole redesign buys. A late-committing straggler simply
  // lands in its place; nothing has to decide what it means.
  const later = obs({ at: '2026-09-04T12:00:00.000Z', remaining: 4000 });
  const earlier = obs({ at: '2026-09-04T06:00:00.000Z', remaining: 4300 });

  const series = appendProviderUsageObservation({ observations: [later] }, earlier);

  assert.deepEqual(
    series.observations.map((entry) => entry.at),
    ['2026-09-04T06:00:00.000Z', '2026-09-04T12:00:00.000Z']
  );
  assert.equal(series.observations[0]?.remaining, 4300, 'and both readings survive');
  assert.equal(series.observations[1]?.remaining, 4000);
});

test('two probes sharing a timestamp are BOTH kept', () => {
  // The log records what happened. Collapsing entries on `at` looked like
  // redelivery protection but was neither: a redelivery re-probes and stamps a
  // fresh timestamp, so it never collided — while two real probes inside one
  // millisecond did, and one was lost.
  const one = obs({ at: '2026-09-04T06:00:00.000Z', remaining: 4300 });
  const series = appendProviderUsageObservation(
    { observations: [one] },
    { ...one, remaining: 4299 }
  );

  assert.equal(series.observations.length, 2);
  assert.deepEqual(
    series.observations.map((entry) => entry.remaining),
    [4300, 4299],
    'and the later append sorts after the earlier entry'
  );
});

test('a rising `remaining` is retained as-is — the period boundary is a READ-time fact', () => {
  // Under the previous design this was the hardest case: a write had to decide
  // whether the rise was a monthly reset, clock skew, or a tier change, and act
  // on it immediately. Now both readings are simply kept, and whoever asks
  // "when did the month roll?" sorts and looks for the rise.
  const endOfMonth = obs({ at: '2026-09-30T18:00:00.000Z', remaining: 200 });
  const afterReset = obs({ at: '2026-10-01T00:00:00.000Z', remaining: 4997 });

  const series = appendProviderUsageObservation({ observations: [endOfMonth] }, afterReset);

  assert.equal(series.observations.length, 2, 'nothing is collapsed or overwritten');
  assert.equal(series.observations[0]?.remaining, 200, "the month's final burn survives");
  assert.equal(series.observations[1]?.remaining, 4997, 'and so does the new period start');
});

test('a tier change is just two readings — it cannot look like anything else', () => {
  // The defect that motivated dropping `used`: it is derived as limit − remaining,
  // so tier 2 → 1 moved it by 25,000 with no calls made and the old design read a
  // reset. `remaining` is unchanged at 600 across the change, and nothing derives.
  const tier2 = obs({ at: '2026-09-15T00:00:00.000Z', remaining: 600, limit: 30000 });
  const tier1 = obs({ at: '2026-09-15T06:00:00.000Z', remaining: 600, limit: 5000 });

  const series = appendProviderUsageObservation({ observations: [tier2] }, tier1);

  assert.equal(series.observations.length, 2);
  assert.deepEqual(
    series.observations.map((entry) => [entry.remaining, entry.limit]),
    [
      [600, 30000],
      [600, 5000],
    ],
    'the limit is recorded as context and the remaining count is untouched'
  );
});

test('the log is bounded on every write and drops the OLDEST', () => {
  const observations = Array.from({ length: PROVIDER_USAGE_MAX_OBSERVATIONS }, (_, index) =>
    obs({ at: new Date(Date.UTC(2025, 0, 1) + index * 6 * 3600_000).toISOString() })
  );
  const oldest = observations[0]!.at;
  const newest = new Date(
    Date.UTC(2025, 0, 1) + PROVIDER_USAGE_MAX_OBSERVATIONS * 6 * 3600_000
  ).toISOString();

  const series = appendProviderUsageObservation({ observations }, obs({ at: newest }));

  assert.equal(series.observations.length, PROVIDER_USAGE_MAX_OBSERVATIONS, 'the cap holds');
  assert.equal(series.observations.at(-1)?.at, newest);
  assert.ok(!series.observations.some((entry) => entry.at === oldest), 'the oldest is dropped');
});

test('an unavailable probe is recorded as null, never coerced to zero', () => {
  // A GAP and a NULL are different claims: only one says the sampler ran.
  const built = buildProviderUsageObservation(
    { patronLevel: null, used: null, remaining: null, limit: null },
    new Date('2026-09-04T00:00:00.000Z')
  );

  assert.equal(built.remaining, null);
  assert.equal(built.limit, null);
  assert.equal(built.at, '2026-09-04T00:00:00.000Z');
});

test('a fractional count is not trustworthy and is stored as null', () => {
  // `resolveCfbdUsage` accepts any finite non-negative number, but the quota gate
  // refuses non-integers. Storing one would put a value in the log the rest of the
  // system considers unusable.
  const built = buildProviderUsageObservation(
    { patronLevel: 1, used: 3499.5, remaining: 1500.5, limit: 5000 },
    new Date('2026-09-04T00:00:00.000Z')
  );

  assert.equal(built.remaining, null, 'a fractional count is not a count');
  assert.equal(built.limit, 5000, 'the integer limit is still recorded');
});

test('a malformed stored row degrades to empty rather than throwing', () => {
  assert.deepEqual(parseProviderUsageSeries(null), { observations: [] });
  assert.deepEqual(parseProviderUsageSeries('nonsense'), { observations: [] });
  assert.deepEqual(parseProviderUsageSeries({ observations: 'nope' }), { observations: [] });
  assert.deepEqual(parseProviderUsageSeries({ observations: [{ at: 'not-a-date' }] }), {
    observations: [],
  });
  // Positive control: the assertions above cannot be passing because the parser
  // rejects everything.
  assert.equal(parseProviderUsageSeries({ observations: [obs()] }).observations.length, 1);
});

test('a stored row is sorted and bounded on READ as well as on write', () => {
  // A row written by an older build, or hand-edited, is normalized on the way in
  // rather than trusted.
  const parsed = parseProviderUsageSeries({
    observations: [
      { at: '2026-09-04T12:00:00.000Z', remaining: 4000, limit: 5000 },
      { at: '2026-09-04T06:00:00.000Z', remaining: 4300, limit: 5000 },
    ],
  });

  assert.deepEqual(
    parsed.observations.map((entry) => entry.at),
    ['2026-09-04T06:00:00.000Z', '2026-09-04T12:00:00.000Z']
  );
});

test('a non-canonical timestamp is normalized so lexicographic ordering stays chronological', () => {
  // Review finding: the parser accepts anything `Date.parse` accepts, but ordering
  // is `localeCompare`, which is only chronological for the `toISOString()` shape.
  // An offset row sorted after a LATER `Z` row and was then trimmed from the wrong
  // end by the bound.
  const parsed = parseProviderUsageSeries({
    observations: [
      { at: '2026-09-04T09:00:00.000Z', remaining: 4000, limit: 5000 },
      // 08:00Z — genuinely EARLIER than the row above, but sorts after it as text.
      { at: '2026-09-04T10:00:00+02:00', remaining: 4300, limit: 5000 },
    ],
  });

  assert.deepEqual(
    parsed.observations.map((entry) => entry.at),
    ['2026-09-04T08:00:00.000Z', '2026-09-04T09:00:00.000Z'],
    'the offset row is rewritten to UTC and sorts into its true position'
  );
  assert.equal(parsed.observations[0]?.remaining, 4300, 'and carries its own values');
});
