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

test('clock skew between the two producers cannot invent a period', () => {
  // The 15-minute and 6-hourly crons both fire at :00 of 00/06/12/18, so two
  // /info probes run in the same minute on different instances with unsynchronised
  // clocks. A few calls of apparent decrease must NOT read as a monthly reset — the
  // phantom period would then absorb the day's real readings and a consumer would
  // see a mid-month boundary.
  const higher = sample({
    observedAt: '2026-09-04T12:00:00.000Z',
    usedMax: 4801,
    usedLatest: 4801,
  });
  const skewed = sample({
    observedAt: '2026-09-04T12:00:30.000Z',
    usedMax: 4795,
    usedLatest: 4795,
  });

  const merged = mergeProviderUsageSample({ samples: [higher] }, skewed);

  assert.equal(merged.samples.length, 1, 'a single-digit decrease is skew, not a reset');
  assert.equal(merged.samples[0]?.usedMax, 4801, 'the high-water mark holds');

  // Positive control: a REAL reset from the same baseline still splits.
  const real = mergeProviderUsageSample(
    { samples: [higher] },
    sample({ observedAt: '2026-09-04T12:00:30.000Z', usedMax: 3, usedLatest: 3 })
  );
  assert.equal(real.samples.length, 2, 'a drop to near zero is still a reset');
});

test('a delayed PRE-reset observation still opens its own earlier period', () => {
  // The mirror of the straggler case: the post-reset reading commits first and the
  // pre-reset one lands after. Without an explicit branch the high count folds into
  // the post-reset entry, producing ONE record with the old period's usedMax and the
  // new period's usedLatest — the two months become unattributable.
  const postReset = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T06:00:00.000Z',
    usedMax: 3,
    usedLatest: 3,
  });
  const delayedPreReset = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T00:00:00.000Z',
    usedMax: 4800,
    usedLatest: 4800,
  });

  const merged = mergeProviderUsageSample({ samples: [postReset] }, delayedPreReset);

  assert.equal(merged.samples.length, 2, 'the boundary survives the reversed commit order');
  assert.deepEqual(
    merged.samples.map((entry) => [entry.periodSequence, entry.usedMax]),
    [
      [0, 4800],
      [1, 3],
    ],
    'the closing period is first and the opening period follows, correctly renumbered'
  );
});

test('an out-of-order write does not invent a reset', () => {
  // The producers overlap by design and the game-stats sample is deferred, so a
  // NEWER observation can commit before an older one. Comparing the older
  // candidate against the newest entry would read `used` as falling and split the
  // day — inventing a monthly reset and corrupting every total derived from it.
  const newer = sample({ observedAt: '2026-09-04T12:00:00.000Z', usedMax: 401, usedLatest: 401 });
  const older = sample({ observedAt: '2026-09-04T11:00:00.000Z', usedMax: 400, usedLatest: 400 });

  const merged = mergeProviderUsageSample({ samples: [newer] }, older);

  assert.equal(merged.samples.length, 1, 'one entry — no invented period boundary');
  assert.equal(merged.samples[0]?.usedMax, 401, 'the high-water mark is unaffected');
  assert.equal(
    merged.samples[0]?.observedAt,
    '2026-09-04T12:00:00.000Z',
    'and the newer observation still owns the timestamp'
  );
});

test('an out-of-order write still folds into the right period after a real split', () => {
  const preReset = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T00:00:00.000Z',
    usedMax: 4800,
    usedLatest: 4800,
  });
  const postReset = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T06:00:00.000Z',
    usedMax: 3,
    usedLatest: 3,
  });
  let series = mergeProviderUsageSample({ samples: [preReset] }, postReset);

  // A straggler from BEFORE the reset arrives after the split already exists.
  series = mergeProviderUsageSample(
    series,
    sample({
      day: '2026-10-01',
      observedAt: '2026-10-01T00:30:00.000Z',
      usedMax: 4810,
      usedLatest: 4810,
    })
  );

  assert.equal(series.samples.length, 2, 'no third period');
  assert.equal(series.samples[0]?.usedMax, 4810, 'it lands in the CLOSING period, raising its max');
  assert.equal(series.samples[1]?.usedMax, 3, 'the opening period is untouched');
});

test('a DELAYED post-reset observation joins the new period, not the old one', () => {
  // t0 pre-reset opens period 0; t2 post-reset opens period 1; then t1 — also
  // post-reset, but older than t2 — commits last. Only period 0 had "started"
  // before t1, so a purely temporal rule folds new-period counters into the
  // previous period's row and makes both months unattributable.
  const t0 = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T00:00:00.000Z',
    usedMax: 4800,
    usedLatest: 4800,
  });
  const t2 = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T18:00:00.000Z',
    usedMax: 40,
    usedLatest: 40,
  });
  let series = mergeProviderUsageSample({ samples: [t0] }, t2);
  assert.equal(series.samples.length, 2, 'precondition: the split exists');

  const t1 = sample({
    day: '2026-10-01',
    observedAt: '2026-10-01T12:00:00.000Z',
    usedMax: 25,
    usedLatest: 25,
  });
  series = mergeProviderUsageSample(series, t1);

  assert.equal(series.samples.length, 2, 'still two periods');
  assert.equal(series.samples[0]?.usedMax, 4800, 'the closing period keeps its final burn');
  assert.equal(series.samples[1]?.usedMax, 40, 'and the new period keeps its own high-water mark');
  assert.equal(
    series.samples[1]?.firstObservedAt,
    '2026-10-01T12:00:00.000Z',
    "the new period's span is pulled back to include the delayed observation"
  );
});

test('a fractional count is not a complete observation', () => {
  // `resolveCfbdUsage` accepts any finite non-negative number, but the quota gate
  // refuses non-integers as untrustworthy. Storing one as complete would pollute
  // the series while System Health reports green.
  const complete = sample({
    observedAt: '2026-09-04T00:00:00.000Z',
    usedMax: 400,
    usedLatest: 400,
  });
  const fractional = sample({
    observedAt: '2026-09-04T18:00:00.000Z',
    usedMax: 399.5,
    usedLatest: 399.5,
    remaining: 4600.5,
  });

  const merged = mergeIntoSample(complete, fractional);
  assert.equal(merged.usedLatest, 400, 'the integer observation is not displaced');
  assert.equal(merged.remaining, 4600);
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

test('a quiet month still splits on the 1st, where a halving would miss it', () => {
  // An offseason month can end at used = 40 and reset to 25 — no halving, but a
  // real boundary. The period is calendar monthly, so the 1st is the only day a
  // reset can occur and any drop there counts.
  const endOfQuietMonth = sample({
    day: '2026-07-01',
    observedAt: '2026-07-01T00:00:00.000Z',
    usedMax: 40,
    usedLatest: 40,
    remaining: 4960,
  });
  const afterReset = sample({
    day: '2026-07-01',
    observedAt: '2026-07-01T06:00:00.000Z',
    usedMax: 25,
    usedLatest: 25,
    remaining: 4975,
  });

  const merged = mergeProviderUsageSample({ samples: [endOfQuietMonth] }, afterReset);
  assert.equal(merged.samples.length, 2, 'the boundary is preserved without a halving');

  // Control: the SAME small drop mid-month is skew, not a reset.
  const midMonth = mergeProviderUsageSample(
    {
      samples: [{ ...endOfQuietMonth, day: '2026-07-15', observedAt: '2026-07-15T00:00:00.000Z' }],
    },
    { ...afterReset, day: '2026-07-15', observedAt: '2026-07-15T06:00:00.000Z' }
  );
  assert.equal(midMonth.samples.length, 1, 'mid-month, a small drop is skew');
});

test('a patron-tier change is not a reset, however far `used` falls', () => {
  // `used` is derived as limit − remaining, so a tier change moves it with no calls
  // made. Tier 2 → 1 at remaining 600 takes used from 29,400 to 4,400 — a halving
  // that would otherwise append a phantom period mid-month.
  const tier2 = sample({
    day: '2026-09-15',
    observedAt: '2026-09-15T00:00:00.000Z',
    usedMax: 29400,
    usedLatest: 29400,
    remaining: 600,
    limit: 30000,
    patronLevel: 2,
  });
  const tier1 = sample({
    day: '2026-09-15',
    observedAt: '2026-09-15T06:00:00.000Z',
    usedMax: 4400,
    usedLatest: 4400,
    remaining: 600,
    limit: 5000,
    patronLevel: 1,
  });

  assert.equal(observedPeriodReset(tier2, tier1), false, 'differing limits are not comparable');
  assert.equal(
    mergeProviderUsageSample({ samples: [tier2] }, tier1).samples.length,
    1,
    'and no phantom period is appended'
  );
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
  assert.equal(
    merged.observedAt,
    '2026-09-04T00:00:00.000Z',
    'and the timestamp stays with the values it describes — a rejected observation must not stamp them fresh'
  );
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
        // The PRE-SPLIT field name. An earlier version of this test used
        // `usedLatest` here, so it exercised the new shape and passed without
        // ever reaching the case its own title names.
        used: 400,
        remaining: 4600,
        limit: 5000,
        patronLevel: 1,
      },
    ],
  });

  assert.equal(parsed.samples.length, 1);
  assert.equal(parsed.samples[0]?.periodSequence, 0);
  assert.equal(parsed.samples[0]?.usedLatest, 400, 'the legacy `used` is read, not dropped');
  assert.equal(parsed.samples[0]?.usedMax, 400, 'and it seeds the high-water mark');
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
