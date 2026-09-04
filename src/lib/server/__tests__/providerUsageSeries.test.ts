import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderUsageSample,
  MAX_PERIODS_PER_DAY,
  mergeIntoSample,
  mergeProviderUsageSample,
  observedPeriodReset,
  parseProviderUsageSeries,
  PROVIDER_USAGE_SERIES_MAX_ENTRIES,
  utcDayOf,
  type ProviderUsageSample,
} from '../providerUsageSeries';

function sample(overrides: Partial<ProviderUsageSample> = {}): ProviderUsageSample {
  const observedAt = overrides.observedAt ?? '2026-09-04T00:00:00.000Z';
  return {
    day: '2026-09-04',
    periodSequence: 0,
    firstObservedAt: observedAt,
    observedAt,
    usedMax: 400,
    usedLatest: 400,
    remaining: 4600,
    limit: 5000,
    patronLevel: 1,
    ...overrides,
  };
}

test('a reset inside a UTC day SPLITS it, keeping both the closing and opening totals', () => {
  // The case that makes this a two-entry design. CFBD's reset hour is not verified
  // to be 00:00 UTC, so a reset at 06:00 on the 1st puts the previous period's
  // final burn and the new period's start on the same day. Overwriting loses the
  // first; discarding the later loses the second.
  const preReset = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T00:00:00.000Z',
    usedMax: 4800,
    usedLatest: 4800,
    remaining: 200,
  });
  const postReset = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T06:00:00.000Z',
    usedMax: 3,
    usedLatest: 3,
    remaining: 4997,
  });

  const merged = mergeProviderUsageSample({ samples: [preReset] }, postReset);

  assert.equal(merged.samples.length, 2, 'the day now spans two periods');
  assert.deepEqual(
    merged.samples.map((entry) => [entry.periodSequence, entry.usedMax]),
    [
      [0, 4800],
      [1, 3],
    ],
    'the closing final and the opening start both survive, in order'
  );
});

test('a third apparent reset in one day folds in rather than growing the row', () => {
  // Two periods cannot both end inside one day. A further drop is a provider
  // anomaly, and an unbounded row is a worse outcome than a lost anomaly.
  const day = '2026-10-01';
  let series = { samples: [sample({ day, usedMax: 4800, usedLatest: 4800 })] };
  series = mergeProviderUsageSample(
    series,
    sample({ day, observedAt: `${day}T06:00:00.000Z`, usedMax: 3, usedLatest: 3 })
  );
  series = mergeProviderUsageSample(
    series,
    sample({ day, observedAt: `${day}T12:00:00.000Z`, usedMax: 1, usedLatest: 1 })
  );

  assert.equal(series.samples.length, MAX_PERIODS_PER_DAY);
});

test('within one period the entry accumulates: usedMax rises, usedLatest tracks the newest', () => {
  const morning = sample({ observedAt: '2026-09-04T00:00:00.000Z', usedMax: 400, usedLatest: 400 });
  const evening = sample({ observedAt: '2026-09-04T18:00:00.000Z', usedMax: 470, usedLatest: 470 });

  const merged = mergeProviderUsageSample({ samples: [morning] }, evening);

  assert.equal(merged.samples.length, 1, 'no reset — one entry for the day');
  assert.equal(merged.samples[0]?.usedMax, 470);
  assert.equal(merged.samples[0]?.usedLatest, 470);
  assert.equal(merged.samples[0]?.firstObservedAt, '2026-09-04T00:00:00.000Z', 'span is kept');
  assert.equal(merged.samples[0]?.observedAt, '2026-09-04T18:00:00.000Z');
});

test('usedMax and usedLatest diverge once the per-day split cap is reached', () => {
  // Where the two fields earn their place. ANY drop is treated as a period
  // boundary — deliberately, because a spurious split is harmless (both values
  // kept, bounded at two) while a MISSED split destroys a month's final burn. So
  // inside one entry the two normally agree. They diverge exactly when the cap is
  // hit and a further drop must fold in: `usedMax` holds the high-water mark a
  // month total needs, `usedLatest` reports the anomaly.
  const day = '2026-10-01';
  let series = { samples: [sample({ day, usedMax: 4800, usedLatest: 4800 })] };
  series = mergeProviderUsageSample(
    series,
    sample({ day, observedAt: `${day}T06:00:00.000Z`, usedMax: 120, usedLatest: 120 })
  );
  series = mergeProviderUsageSample(
    series,
    sample({ day, observedAt: `${day}T12:00:00.000Z`, usedMax: 90, usedLatest: 90 })
  );

  assert.equal(series.samples.length, MAX_PERIODS_PER_DAY, 'capped');
  const second = series.samples[1]!;
  assert.equal(second.usedMax, 120, 'the high-water mark of the folded entry holds');
  assert.equal(second.usedLatest, 90, 'and the latest reading is still reported');
});

test('observedPeriodReset needs two complete counts — a null is not a drop', () => {
  const complete = sample({ usedMax: 4800, usedLatest: 4800 });
  const degraded = sample({ usedMax: null, usedLatest: null, remaining: null, limit: null });

  assert.equal(observedPeriodReset(complete, degraded), false, 'null must not read as a reset');
  assert.equal(observedPeriodReset(degraded, complete), false, 'nor an unknown baseline');
  assert.equal(
    observedPeriodReset(complete, sample({ usedMax: 3, usedLatest: 3 })),
    true,
    'positive control: a real drop IS a reset'
  );
});

test('a degraded observation never blanks a complete one', () => {
  const complete = sample({ observedAt: '2026-09-04T00:00:00.000Z' });
  const tierless = sample({
    observedAt: '2026-09-04T18:00:00.000Z',
    usedMax: null,
    usedLatest: null,
    limit: null,
    patronLevel: null,
    remaining: 4540,
  });

  const merged = mergeIntoSample(complete, tierless);

  assert.equal(merged.usedLatest, 400, 'used survives');
  assert.equal(merged.limit, 5000, 'limit survives');
  assert.equal(merged.usedMax, 400);
});

test('the series is bounded by entry count and drops the OLDEST', () => {
  const samples = Array.from({ length: PROVIDER_USAGE_SERIES_MAX_ENTRIES }, (_, index) => {
    const day = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    return sample({ day, observedAt: `${day}T00:00:00.000Z` });
  });
  const oldestDay = samples[0]!.day;
  const newDay = new Date(Date.UTC(2025, 0, 1 + PROVIDER_USAGE_SERIES_MAX_ENTRIES))
    .toISOString()
    .slice(0, 10);

  const merged = mergeProviderUsageSample(
    { samples },
    sample({ day: newDay, observedAt: `${newDay}T00:00:00.000Z` })
  );

  assert.equal(merged.samples.length, PROVIDER_USAGE_SERIES_MAX_ENTRIES);
  assert.equal(merged.samples.at(-1)?.day, newDay);
  assert.ok(!merged.samples.some((entry) => entry.day === oldestDay), 'the oldest day is dropped');
});

test('a malformed stored series degrades to empty rather than throwing', () => {
  assert.deepEqual(parseProviderUsageSeries(null), { samples: [] });
  assert.deepEqual(parseProviderUsageSeries('nonsense'), { samples: [] });
  assert.deepEqual(parseProviderUsageSeries({ samples: 'nope' }), { samples: [] });
  assert.deepEqual(parseProviderUsageSeries({ samples: [{ day: 'not-a-day' }] }), { samples: [] });
  // Positive control: the assertions above cannot be passing because the parser
  // rejects everything.
  assert.equal(parseProviderUsageSeries({ samples: [sample()] }).samples.length, 1);
});

test('a legacy row without the new fields normalizes instead of being rejected', () => {
  // Rows written before the split existed carry `used`, no `usedMax`/`usedLatest`,
  // no `periodSequence`. Dropping them would silently lose history.
  const parsed = parseProviderUsageSeries({
    samples: [
      {
        day: '2026-09-04',
        observedAt: '2026-09-04T00:00:00.000Z',
        usedLatest: 400,
        remaining: 4600,
        limit: 5000,
        patronLevel: 1,
      },
    ],
  });

  assert.equal(parsed.samples.length, 1);
  assert.equal(parsed.samples[0]?.periodSequence, 0);
  assert.equal(parsed.samples[0]?.usedMax, 400, 'usedMax falls back to the known latest');
  assert.equal(parsed.samples[0]?.firstObservedAt, '2026-09-04T00:00:00.000Z');
});

test('an unavailable observation is recorded as null, never coerced to zero', () => {
  const built = buildProviderUsageSample(
    { patronLevel: null, used: null, remaining: null, limit: null },
    new Date('2026-09-04T00:00:00.000Z')
  );

  assert.equal(built.usedMax, null);
  assert.equal(built.usedLatest, null);
  assert.equal(built.remaining, null);
  assert.equal(built.day, '2026-09-04');
});

test('days are keyed in UTC, so a late local evening does not land on the wrong day', () => {
  assert.equal(utcDayOf(new Date('2026-09-04T23:59:59.000Z')), '2026-09-04');
  assert.equal(utcDayOf(new Date('2026-09-05T00:00:00.000Z')), '2026-09-05');
});
