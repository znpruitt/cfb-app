import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the server actions' `revalidateTag` (via invalidateStandings) runs under the
// bare node:test runner.
import '../../../api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { confirmPreseasonOwners, beginPreseason } from '../actions';
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
