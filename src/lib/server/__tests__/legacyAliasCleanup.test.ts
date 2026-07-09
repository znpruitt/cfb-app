import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  getAppState,
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import {
  cleanupLegacyLeagueScopedAliases,
  parseAliasScope,
  reportLegacyLeagueScopedAliases,
} from '@/lib/server/legacyAliasCleanup';

// A pure copy of a known seed default (SEED_ALIASES maps 'ole miss' →
// 'mississippi'), so it carries nothing the migration would promote.
const SEED_COPY = { 'ole miss': 'mississippi' } as const;
// A made-up alias that is not a seed default → a "manual repair".
const MANUAL_REPAIR = { 'weird name': 'real team' } as const;

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('parseAliasScope distinguishes global, year, league, and other scopes', () => {
  assert.equal(parseAliasScope('aliases:global').kind, 'global');
  assert.equal(parseAliasScope('aliases:2026').kind, 'year');
  assert.equal(parseAliasScope('aliases:tsc:2026').kind, 'league');
  assert.equal(parseAliasScope('schedule').kind, 'other');
  // Defensive: a 'global' second segment is never treated as a league slug.
  assert.equal(parseAliasScope('aliases:global:2026').kind, 'other');
});

test('runtime alias resolution ignores aliases:${slug}:${year} (PLATFORM-067)', async () => {
  await setAppState('aliases:testleague:2026', 'map', { 'zzz squad': 'zzz canonical' });

  const resolved = await getScopedAliasMap('testleague', 2026);

  // The league-scoped entry must not leak into runtime resolution.
  assert.ok(!Object.values(resolved).includes('zzz canonical'));
});

test('report identifies legacy league-scoped keys (dry run, no mutation)', async () => {
  await setAppState('aliases:alpha:2025', 'map', SEED_COPY);
  await setAppState('aliases:beta:2024', 'map', MANUAL_REPAIR);

  const report = await reportLegacyLeagueScopedAliases();

  assert.deepEqual(report.scopes.map((s) => s.scope).sort(), [
    'aliases:alpha:2025',
    'aliases:beta:2024',
  ]);
  // Both keys survive a report (read-only).
  assert.ok((await getAppState('aliases:alpha:2025', 'map'))?.value);
  assert.ok((await getAppState('aliases:beta:2024', 'map'))?.value);
});

test('cleanup does not delete global or year-scoped alias keys', async () => {
  await setAppState('aliases:global', 'map', { 'g one': 'g two' });
  await setAppState('aliases:2026', 'map', { 'y one': 'y two' });
  await setAppState('aliases:zed:2026', 'map', SEED_COPY);

  await cleanupLegacyLeagueScopedAliases({ apply: true });

  assert.ok((await getAppState('aliases:global', 'map'))?.value, 'global map preserved');
  assert.ok((await getAppState('aliases:2026', 'map'))?.value, 'year map preserved');
  assert.equal(
    (await getAppState('aliases:zed:2026', 'map'))?.value,
    undefined,
    'redundant league key removed'
  );
});

test('cleanup does not delete unrelated app-state keys', async () => {
  await setAppState('schedule', '2026-all-all', { items: [] });
  await setAppState('owners:tsc:2026', 'csv', 'team,owner');
  await setAppState('aliases:gamma:2025', 'map', SEED_COPY);

  await cleanupLegacyLeagueScopedAliases({ apply: true });

  assert.ok((await getAppState('schedule', '2026-all-all'))?.value, 'schedule cache preserved');
  assert.ok((await getAppState('owners:tsc:2026', 'csv'))?.value, 'owners csv preserved');
});

test('dry run deletes nothing; --apply removes pure seed-copy but skips un-promoted manual repairs', async () => {
  await setAppState('aliases:seedy:2025', 'map', SEED_COPY);
  await setAppState('aliases:manual:2025', 'map', MANUAL_REPAIR);

  const dry = await cleanupLegacyLeagueScopedAliases();
  assert.deepEqual(dry.deleted, [], 'dry run deletes nothing');
  assert.ok((await getAppState('aliases:seedy:2025', 'map'))?.value, 'dry run leaves keys intact');

  const applied = await cleanupLegacyLeagueScopedAliases({ apply: true });
  assert.deepEqual(applied.deleted, ['aliases:seedy:2025'], 'pure seed-copy deleted');
  assert.ok(
    applied.skipped.some((s) => s.scope === 'aliases:manual:2025'),
    'manual-repair key skipped pre-migration'
  );
  assert.ok(
    (await getAppState('aliases:manual:2025', 'map'))?.value,
    'manual-repair key preserved until promoted'
  );
});

test('manual-repair league key becomes safe to delete once migration is done', async () => {
  await setAppState('aliases:manual:2025', 'map', MANUAL_REPAIR);
  await setAppState('aliases:global', 'migration-done', true);

  const applied = await cleanupLegacyLeagueScopedAliases({ apply: true });

  assert.deepEqual(applied.deleted, ['aliases:manual:2025']);
  assert.equal((await getAppState('aliases:manual:2025', 'map'))?.value, undefined);
});
