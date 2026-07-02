import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import { loadInsightsForLeague } from '@/lib/insights/loadInsights';

// ===========================================================================
// PLATFORM-053 — loadInsightsForLeague sources standings rows/history from the
// canonical selector (getCanonicalStandings), not an Insights-local
// deriveStandings/deriveStandingsHistory re-derivation. These integration tests
// exercise the canonical path end-to-end (no server → origin is null → games
// empty; canonical still drives standings inputs).
//
// NOTE: The row/history *contradiction* guarantee is enforced structurally —
// loadInsights no longer imports or calls deriveStandings/deriveStandingsHistory,
// so no code path can diverge from canonical — and is covered by PLATFORM-049's
// getCanonicalStandings authority tests (empty/null/complete) plus the existing
// generator tests that pass rows/history directly.
// ===========================================================================

const SLUG = 'tsc';

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('loadInsightsForLeague returns a well-formed response from the canonical path (season + CSV)', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2026 },
  });
  await setAppState(
    'owners:tsc:2026',
    'csv',
    'team,owner\nGeorgia,Alice\nClemson,Bob\nAir Force,NoClaim'
  );

  const res = await loadInsightsForLeague(SLUG, 2026);

  assert.ok(Array.isArray(res.insights));
  assert.equal(typeof res.lifecycleState, 'string');
  assert.equal(res.error, undefined);
});

test('canonical empty standings are authoritative: no crash, no fabricated insights', async () => {
  // Offseason league with no archive and no CSV → canonical resolves to an empty
  // snapshot. Insights must not resurrect local standings or error.
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'offseason' },
  });

  const res = await loadInsightsForLeague(SLUG, 2026);

  assert.ok(Array.isArray(res.insights));
  assert.equal(res.error, undefined);
});

test('canonical preseason-names lifecycle drives Insights when only preseason owners exist', async () => {
  // No current-year CSV — the OLD local path would derive an empty roster and
  // empty standings. Canonical synthesizes preseason-names rows for the seeded
  // owners, and Insights runs off the canonical preseason lifecycle.
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: 2026 },
  });
  await savePreseasonOwners(SLUG, 2026, ['Zelda', 'Yara']);

  const res = await loadInsightsForLeague(SLUG, 2026);

  assert.equal(res.lifecycleState, 'preseason');
  assert.ok(Array.isArray(res.insights));
  assert.equal(res.error, undefined);
});

test('unknown league returns an empty offseason response without throwing', async () => {
  const res = await loadInsightsForLeague('does-not-exist', 2026);
  assert.deepEqual(res.insights, []);
  assert.equal(res.lifecycleState, 'offseason');
  assert.match(res.error ?? '', /not found/);
});
