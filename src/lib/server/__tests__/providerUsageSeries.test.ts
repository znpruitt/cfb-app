import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderUsageSample,
  mergeProviderUsageSample,
  parseProviderUsageSeries,
  preferSample,
  PROVIDER_USAGE_SERIES_MAX_DAYS,
  utcDayOf,
  type ProviderUsageSample,
} from '../providerUsageSeries';

function sample(overrides: Partial<ProviderUsageSample> = {}): ProviderUsageSample {
  return {
    day: '2026-09-04',
    observedAt: '2026-09-04T00:00:00.000Z',
    used: 400,
    remaining: 4600,
    limit: 5000,
    patronLevel: 1,
    ...overrides,
  };
}

test('a usable observation is never displaced by an unusable one from the same day', () => {
  // THE rule this module exists for. The 00:00 floor sample runs unconditionally;
  // the opportunistic game-stats sample runs later and can fail. Without this, one
  // failed evening probe would replace a good morning reading with a null.
  const good = sample({ observedAt: '2026-09-04T00:00:00.000Z' });
  const failedLater = sample({
    observedAt: '2026-09-04T18:00:00.000Z',
    used: null,
    remaining: null,
    limit: null,
    patronLevel: null,
  });

  assert.equal(preferSample(good, failedLater).remaining, 4600, 'the later failure must not win');
  assert.equal(preferSample(failedLater, good).remaining, 4600, 'order must not matter');
});

test('between two usable observations the later one wins, because used is cumulative', () => {
  const morning = sample({ observedAt: '2026-09-04T00:00:00.000Z', used: 400, remaining: 4600 });
  const evening = sample({ observedAt: '2026-09-04T22:00:00.000Z', used: 460, remaining: 4540 });

  assert.equal(preferSample(morning, evening).used, 460);
  assert.equal(preferSample(evening, morning).used, 460, 'order must not matter');
});

test('merging replaces the same day and keeps other days untouched', () => {
  const series = {
    samples: [
      sample({ day: '2026-09-03', observedAt: '2026-09-03T00:00:00.000Z', used: 300 }),
      sample({ day: '2026-09-04', observedAt: '2026-09-04T00:00:00.000Z', used: 400 }),
    ],
  };
  const merged = mergeProviderUsageSample(
    series,
    sample({ day: '2026-09-04', observedAt: '2026-09-04T20:00:00.000Z', used: 470 })
  );

  assert.equal(merged.samples.length, 2, 'a same-day sample must replace, never append');
  assert.deepEqual(
    merged.samples.map((entry) => entry.day),
    ['2026-09-03', '2026-09-04'],
    'days stay sorted ascending'
  );
  assert.equal(merged.samples[0]?.used, 300, 'the other day is untouched');
  assert.equal(merged.samples[1]?.used, 470);
});

test('the series is bounded by construction and drops the OLDEST day', () => {
  // Bounded structurally — there is no pruning job that can be forgotten.
  const samples = Array.from({ length: PROVIDER_USAGE_SERIES_MAX_DAYS }, (_, index) => {
    const day = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    return sample({ day, observedAt: `${day}T00:00:00.000Z` });
  });
  const oldestDay = samples[0]!.day;
  const newDay = new Date(Date.UTC(2025, 0, 1 + PROVIDER_USAGE_SERIES_MAX_DAYS))
    .toISOString()
    .slice(0, 10);

  const merged = mergeProviderUsageSample(
    { samples },
    sample({ day: newDay, observedAt: `${newDay}T00:00:00.000Z` })
  );

  assert.equal(merged.samples.length, PROVIDER_USAGE_SERIES_MAX_DAYS);
  assert.equal(merged.samples.at(-1)?.day, newDay, 'the new day is kept');
  assert.ok(
    !merged.samples.some((entry) => entry.day === oldestDay),
    'the oldest day is the one dropped'
  );
});

test('a malformed stored series degrades to empty rather than throwing', () => {
  // Losing history is bad; taking a cron down over it is worse.
  assert.deepEqual(parseProviderUsageSeries(null), { samples: [] });
  assert.deepEqual(parseProviderUsageSeries('nonsense'), { samples: [] });
  assert.deepEqual(parseProviderUsageSeries({ samples: 'nope' }), { samples: [] });
  assert.deepEqual(
    parseProviderUsageSeries({ samples: [{ day: 'not-a-day', observedAt: 'x' }] }),
    { samples: [] },
    'an unparseable entry is dropped, not coerced'
  );
  // Positive control: a well-formed entry in the same shape DOES survive, so the
  // assertions above cannot be passing because the parser rejects everything.
  assert.equal(parseProviderUsageSeries({ samples: [sample()] }).samples.length, 1);
});

test('an unavailable observation is recorded as null, never coerced to zero', () => {
  // `fetchCfbdUsage` returns all-null when the provider gave nothing usable. A
  // zero here would read downstream as quota exhaustion.
  const built = buildProviderUsageSample(
    { patronLevel: null, used: null, remaining: null, limit: null },
    new Date('2026-09-04T00:00:00.000Z')
  );

  assert.equal(built.used, null);
  assert.equal(built.remaining, null);
  assert.equal(built.limit, null);
  assert.equal(built.day, '2026-09-04');
});

test('days are keyed in UTC, so a late local evening does not land on the wrong day', () => {
  assert.equal(utcDayOf(new Date('2026-09-04T23:59:59.000Z')), '2026-09-04');
  assert.equal(utcDayOf(new Date('2026-09-05T00:00:00.000Z')), '2026-09-05');
});
