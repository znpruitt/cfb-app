import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the server actions' `revalidateTag` (via invalidateStandings) runs under the
// bare node:test runner.
import '../../../api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { confirmPreseasonOwners, beginPreseason, completeSetup } from '../actions';
import type { League } from '../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-071 — preseason lifecycle server actions must invalidate standings.
//
// These actions change a league's standings surface (preseason owner list,
// offseason→preseason lifecycle) but did not bust the cached canonical
// standings snapshot, so the public page stayed stale until a hard refresh
// (documented gap in leagueStandings.ts). Each now calls invalidateStandings
// before its terminal redirect().
// ---------------------------------------------------------------------------

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

function makeLeague(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2025,
    createdAt: '2024-01-01T00:00:00.000Z',
    status,
  };
}

// Run `fn`, capturing revalidated tags. Server actions terminate in redirect(),
// which throws NEXT_REDIRECT — swallow that (and only that) so the tags recorded
// before the throw can be asserted; any other error propagates.
async function runCapturingTags(fn: () => Promise<unknown>): Promise<string[]> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  return workAsyncStorage.run(store as never, async () => {
    try {
      await fn();
    } catch (err) {
      const digest = (err as { digest?: string })?.digest ?? '';
      if (!String(digest).startsWith('NEXT_REDIRECT')) throw err;
    }
    return store.pendingRevalidatedTags;
  });
}

test('confirmPreseasonOwners invalidates the league standings for that year', async () => {
  const tags = await runCapturingTags(() =>
    confirmPreseasonOwners('alpha', 2026, ['Alice', 'Bob'])
  );

  assert.ok(tags.includes('standings:alpha'), 'league umbrella tag invalidated');
  assert.ok(tags.includes('standings:alpha:2026'), 'year-scoped tag invalidated');

  // The preseason owners were actually persisted (mutation happened before the
  // invalidation, so the invalidation is not a no-op).
  const stored = await getAppState<string[]>('preseason-owners:alpha', '2026');
  assert.deepEqual(stored?.value, ['Alice', 'Bob']);
});

test('confirmPreseasonOwners with <2 owners throws before persisting or invalidating', async () => {
  await assert.rejects(
    () => runCapturingTags(() => confirmPreseasonOwners('alpha', 2026, ['Alice'])),
    /At least 2 owners required/
  );
  const stored = await getAppState<string[]>('preseason-owners:alpha', '2026');
  assert.equal(stored, null, 'no preseason owners persisted on the rejected path');
});

test('beginPreseason invalidates the league standings (offseason→preseason)', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'offseason' })]);

  const tags = await runCapturingTags(() => beginPreseason('alpha'));

  assert.ok(tags.includes('standings:alpha'), 'league umbrella tag invalidated');
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — lifecycle callers no longer perform a redundant second
// year write: the lifecycle authority synchronizes league.year with
// status.year in ONE registry record.
// ---------------------------------------------------------------------------

test('completeSetup writes one synchronized lifecycle record (no separate year write)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);

  await runCapturingTags(() => completeSetup('alpha', 2026));

  const record = await getAppState<League[]>('leagues', 'registry');
  const league = record?.value?.[0];
  assert.deepEqual(league?.status, { state: 'preseason', year: 2026, setupComplete: true });
  assert.equal(league?.year, 2026, 'top-level year synchronized by the same lifecycle write');
});

test('beginPreseason refuses outside offseason — re-invocation cannot re-increment the year', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);

  await assert.rejects(
    () => runCapturingTags(() => beginPreseason('alpha')),
    /League is not in offseason/
  );

  const record = await getAppState<League[]>('leagues', 'registry');
  const league = record?.value?.[0];
  assert.deepEqual(league?.status, { state: 'preseason', year: 2026 }, 'no double increment');
  assert.equal(league?.year, 2025, 'top-level year untouched by the refused call');
});

test('beginPreseason synchronizes league.year to the preseason year', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'offseason' })]);

  await runCapturingTags(() => beginPreseason('alpha'));

  const record = await getAppState<League[]>('leagues', 'registry');
  const league = record?.value?.[0];
  assert.deepEqual(league?.status, { state: 'preseason', year: 2026 });
  assert.equal(league?.year, 2026);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1 — both commissioner lifecycle actions now consume a GUARDED
// transaction-local transition. The precondition and (for begin-preseason) the
// year derivation happen under the registry lock, so a double submission or a
// stale form can no longer double-increment or rewrite the lifecycle year.
// ---------------------------------------------------------------------------

async function readLeague(slug: string): Promise<League | undefined> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value?.find((l) => l.slug === slug);
}

test('two concurrent beginPreseason submissions increment the year exactly once', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'offseason' })]);

  // The loser's guard re-runs under the lock and refuses; only one submission
  // may complete (the other throws before its redirect).
  const outcomes = await Promise.allSettled([
    runCapturingTags(() => beginPreseason('alpha')),
    runCapturingTags(() => beginPreseason('alpha')),
  ]);

  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(rejected.length, 1, 'exactly one submission is refused');
  assert.match(String((rejected[0] as PromiseRejectedResult).reason), /League is not in offseason/);

  const league = await readLeague('alpha');
  assert.deepEqual(league?.status, { state: 'preseason', year: 2026 }, 'no double increment');
  assert.equal(league?.year, 2026);
});

test('beginPreseason reports an unusable stored year instead of writing one', async () => {
  await setAppState('leagues', 'registry', [
    { ...makeLeague('alpha', { state: 'offseason' }), year: Number.NaN as number },
  ]);

  await assert.rejects(
    () => runCapturingTags(() => beginPreseason('alpha')),
    /unusable season year/
  );

  assert.equal((await readLeague('alpha'))?.status?.state, 'offseason', 'nothing was written');
});

test('a stale completeSetup form for another year writes nothing', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);
  const before = await readLeague('alpha');

  // The bound argument comes from a page rendered while the league was in an
  // earlier preseason year; submitting it must not move the lifecycle year.
  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2025)),
    /no longer in preseason for 2025/
  );
  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2027)),
    /no longer in preseason for 2027/
  );

  assert.deepEqual(await readLeague('alpha'), before, 'the lifecycle record is untouched');
});

test('completeSetup refuses a league that has left preseason', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'season', year: 2026 })]);

  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2026)),
    /League is not in preseason/
  );

  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'season', year: 2026 });
});

test('completeSetup on an unknown league reports not found', async () => {
  await setAppState('leagues', 'registry', []);

  await assert.rejects(
    () => runCapturingTags(() => completeSetup('ghost', 2026)),
    /League not found/
  );
});

test('a repeated completeSetup still redirects but rewrites nothing', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);

  await runCapturingTags(() => completeSetup('alpha', 2026));
  const afterFirst = await getAppState<League[]>('leagues', 'registry');

  // Resolves normally (the redirect throw is swallowed by the harness) —
  // an already-complete matching setup is a harmless no-op, not an error.
  await runCapturingTags(() => completeSetup('alpha', 2026));

  const afterRepeat = await getAppState<League[]>('leagues', 'registry');
  assert.deepEqual(afterRepeat?.value, afterFirst?.value);
  assert.deepEqual((await readLeague('alpha'))?.status, {
    state: 'preseason',
    year: 2026,
    setupComplete: true,
  });
});
