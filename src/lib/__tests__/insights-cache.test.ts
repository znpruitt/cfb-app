import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySuppression,
  clearGenerators,
  generateRawInsights,
  registerGenerator,
} from '@/lib/insights/engine';
import { insightsCacheKeyParts, insightsCacheTags } from '@/lib/insights/loadInsights';
import { ALL_STANDINGS_TAG } from '@/lib/selectors/leagueStandings';
import { ALIAS_OVERRIDES_HASH } from '../teamDatabase.ts';
import { SEED_ALIASES_HASH } from '@/lib/server/globalAliasStore';
import {
  listAppStateKeys,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import type { Insight } from '@/lib/selectors/insights';
import type { InsightContext, InsightGenerator } from '@/lib/insights/types';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// ---------------------------------------------------------------------------
// Cache key / tag helpers — the testable surface of the Insights output cache.
// (unstable_cache falls back to direct compute under node:test, so key/tag
// isolation is asserted through the builders.)
// ---------------------------------------------------------------------------

test('insights cache key includes slug, year, the seed-alias hash, and the override-policy hash', () => {
  assert.deepEqual(insightsCacheKeyParts('tsc', 2026), [
    'insights',
    'tsc',
    '2026',
    `seeds:${SEED_ALIASES_HASH}`,
    `alias-overrides:${ALIAS_OVERRIDES_HASH}`,
    'analytics:h3e3-final-complete-v1',
    // INSIGHTS-022 — copy policy is part of cache IDENTITY. Dropping the
    // "Returning owner" prefix and widening the rookie card's lifecycle are
    // policy changes that touch no standings input, so no tag fires and warm
    // entries would otherwise keep serving retracted copy until the TTL lapsed.
    'copy:insights030-league-record-population-v1',
    // INSIGHTS-023a — membership is part of cache IDENTITY for the same reason.
    // Membership now comes from the league's roster/confirmed list instead of
    // being reconstructed from the team→owner map, so a warm entry computed
    // under the old rule keeps serving cards that NAME DEPARTED OWNERS — the
    // exact defect the slice fixes — until the TTL lapses. Deployment fires no
    // tag.
    'membership:insights023a-league-membership-v1',
  ]);
});

test('different leagues and different years produce different insights cache keys', () => {
  assert.notDeepEqual(insightsCacheKeyParts('tsc', 2026), insightsCacheKeyParts('other', 2026));
  assert.notDeepEqual(insightsCacheKeyParts('tsc', 2026), insightsCacheKeyParts('tsc', 2025));
});

test('insights cache tags piggyback the canonical standings tags for the slug+year', () => {
  const tags = insightsCacheTags('tsc', 2026);
  // Carrying the standings tags is what makes every invalidateStandings call
  // refresh Insights too — assert the exact set the standings cache uses.
  assert.deepEqual(tags, [ALL_STANDINGS_TAG, 'standings:tsc', 'standings:tsc:2026']);
});

test('insights cache tags do not leak across leagues or years', () => {
  assert.notDeepEqual(insightsCacheTags('tsc', 2026), insightsCacheTags('other', 2026));
  assert.notDeepEqual(insightsCacheTags('tsc', 2026), insightsCacheTags('tsc', 2025));
});

// ---------------------------------------------------------------------------
// Engine split — generation (pure, cacheable) is separate from the per-request
// serving step, which is what lets the raw set be cached at all.
//
// INSIGHTS-029 REPLACED that serving step. It was `applySuppression`
// ("fire once, then fade"); it is now `selectServedInsights`, a pure sort and
// cap. **The tests below pin the RETIRED behaviour**, which is deliberate — the
// function is still exported — but nothing on the serving path does this any
// more, and per AGENTS.md Insights invariant 4 it must not be restored there.
// The live serving guarantee is pinned in `loadInsights.test.ts`.
// ---------------------------------------------------------------------------

function makeInsight(overrides: Partial<Insight> & { id: string }): Insight {
  return {
    type: 'career_points_leader',
    title: 'Title',
    description: 'Description',
    owner: 'Alice',
    priorityScore: 50,
    newsHook: 'snapshot',
    statValue: 100,
    ...overrides,
  };
}

function makeContext(overrides: Partial<InsightContext> = {}): InsightContext {
  return {
    leagueSlug: 'tsc',
    currentYear: 2026,
    lifecycleState: 'mid_season',
    ...overrides,
  } as unknown as InsightContext;
}

test('generateRawInsights runs matching generators and drops non-positive scores — no I/O', () => {
  clearGenerators();
  const gen: InsightGenerator = {
    id: 'test:gen',
    category: 'historical',
    supportedLifecycles: ['mid_season'],
    generate: () => [
      makeInsight({ id: 'keep', priorityScore: 40 }),
      makeInsight({ id: 'drop', priorityScore: 0 }),
    ],
  };
  registerGenerator(gen);

  const raw = generateRawInsights(makeContext(), { bypassSuppression: false });
  assert.deepEqual(
    raw.map((i) => i.id),
    ['keep']
  );

  // A generator whose lifecycle does not match is skipped entirely.
  clearGenerators();
  registerGenerator({ ...gen, supportedLifecycles: ['offseason'] });
  assert.deepEqual(generateRawInsights(makeContext({ lifecycleState: 'mid_season' })), []);

  clearGenerators();
});

test('applySuppression fires an insight once, then suppresses it on the next run', async () => {
  const raw = [makeInsight({ id: 'once', newsHook: 'snapshot', owner: 'Alice' })];

  // First run: nothing suppressed → the insight fires and a record is written.
  const first = await applySuppression(raw, 'tsc', 2026);
  assert.deepEqual(
    first.map((i) => i.id),
    ['once']
  );
  const recordKeys = await listAppStateKeys('insights-suppression:tsc:2026');
  assert.equal(recordKeys.length, 1, 'a suppression record should be written per run');

  // Second run over the same raw set: the snapshot-hook insight is now suppressed.
  const second = await applySuppression(raw, 'tsc', 2026);
  assert.deepEqual(second, [], 'a snapshot insight fires once, then fades');
});

test('applySuppression scopes records by league and season', async () => {
  const raw = [makeInsight({ id: 'x', owner: 'Alice' })];

  await applySuppression(raw, 'tsc', 2026);
  // Different league and different season are unaffected — the insight still fires.
  assert.deepEqual(
    (await applySuppression(raw, 'other', 2026)).map((i) => i.id),
    ['x']
  );
  assert.deepEqual(
    (await applySuppression(raw, 'tsc', 2025)).map((i) => i.id),
    ['x']
  );
});
