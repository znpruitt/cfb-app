import assert from 'node:assert/strict';
import test from 'node:test';

import { findResidualLeagueScopes } from '../leagueResidualData.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import { draftScope } from '../../draft.ts';
import { preseasonOwnerScope } from '../../preseasonOwnerStore.ts';
import { saveSeasonArchive } from '../../seasonArchive.ts';
import { saveSuppressionRecord } from '../../insights/suppression.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2I — the residue survey, pinned scope family by scope family.
//
// The route tests only ever exercised `owners:` and `draft:`. The other five
// families are string literals in this module, so a typo in `preseason-owners`,
// `insights-suppression`, `postseason-overrides`, `aliases`, or
// `standings-archive` would leave the whole suite green while the guard silently
// stopped detecting that kind of residue — and a new league at a reused slug
// would adopt the previous league's archives or preseason owners.
//
// Where a real writer exists it is used INSTEAD of a literal, so the key shape
// is proven against production code rather than against my memory of it.
// ---------------------------------------------------------------------------

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('a slug with no stored data has no residue', async () => {
  assert.deepEqual(await findResidualLeagueScopes('ghost'), []);
});

// Each family independently, so one detected family cannot mask six broken ones.
test('every scope family is detected on its own', async () => {
  const cases: Array<{ name: string; seed: () => Promise<unknown> }> = [
    { name: 'owners', seed: () => setAppState('owners:ghost:2024', 'csv', 'Owner,Team') },
    { name: 'draft', seed: () => setAppState(draftScope('ghost'), '2024', { phase: 'complete' }) },
    {
      name: 'preseason-owners',
      seed: () => setAppState(preseasonOwnerScope('ghost'), '2024', { owners: [] }),
    },
    {
      name: 'postseason-overrides',
      seed: () => setAppState('postseason-overrides:ghost:2024', 'items', []),
    },
    {
      name: 'aliases (legacy league-scoped)',
      seed: () => setAppState('aliases:ghost:2024', 'map', {}),
    },
  ];

  for (const { name, seed } of cases) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await seed();
    const found = await findResidualLeagueScopes('ghost');
    assert.ok(
      found.length > 0,
      `${name} residue must be detected on its own; got ${JSON.stringify(found)}`
    );
  }
});

// `standings-archive:<slug>` is duplicated in this module because
// `seasonArchive`'s `archiveScope` is private. Seeded through the REAL writer so
// the copy is pinned against production, not against a second literal: if
// `archiveScope` is ever renamed, this fails.
test('season archives are detected through the real writer', async () => {
  await saveSeasonArchive({
    leagueSlug: 'ghost',
    year: 2024,
    generatedAt: '2024-02-01T00:00:00.000Z',
    finalStandings: [],
    standingsHistory: { weeks: [], byWeek: {} },
    games: [],
  } as unknown as Parameters<typeof saveSeasonArchive>[0]);

  const found = await findResidualLeagueScopes('ghost');
  assert.ok(
    found.some((scope) => scope.includes('ghost')),
    `an archive written by saveSeasonArchive must count as residue; got ${JSON.stringify(found)}`
  );
});

// Same argument for suppression: seeded through its own writer so the
// `insights-suppression:<slug>:<season>` shape is pinned against production.
test('insight suppression records are detected through the real writer', async () => {
  await saveSuppressionRecord(
    {
      insightId: 'insight-1',
      hook: 'snapshot',
      owner: 'Dana',
      suppressedAt: '2024-02-01T00:00:00.000Z',
    } as unknown as Parameters<typeof saveSuppressionRecord>[0],
    'ghost',
    2024
  );

  const found = await findResidualLeagueScopes('ghost');
  assert.ok(
    found.some((scope) => scope.includes('ghost')),
    `a suppression record must count as residue; got ${JSON.stringify(found)}`
  );
});

// REGRESSION TEST — the prefix hazard, at the unit boundary. `draft:tsc` is a
// PREFIX of `draft:tsc-old`, and `owners:tsc` of `owners:tsc-old:2025`. A naive
// match reports residue for `tsc` because an unrelated `tsc-old` exists, which
// blocks a valid slug and looks exactly like the guard working.
test('a longer sibling slug is never mistaken for this slug', async () => {
  await setAppState('owners:tsc-old:2024', 'csv', 'Owner,Team');
  await setAppState(draftScope('tsc-old'), '2024', { phase: 'complete' });
  await setAppState(preseasonOwnerScope('tsc-old'), '2024', { owners: [] });

  assert.deepEqual(await findResidualLeagueScopes('tsc'), [], 'tsc-old`s data is not tsc`s');

  // POSITIVE CONTROL — the same helper DOES find `tsc-old`'s own residue, so the
  // empty result above is discrimination and not a survey that finds nothing.
  assert.ok((await findResidualLeagueScopes('tsc-old')).length >= 3);
});

test('the result is deterministic and free of duplicates', async () => {
  await setAppState('owners:ghost:2023', 'csv', 'Owner,Team');
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');
  await setAppState(draftScope('ghost'), '2024', { phase: 'complete' });

  const first = await findResidualLeagueScopes('ghost');
  const second = await findResidualLeagueScopes('ghost');

  assert.deepEqual(first, second, 'stable across calls');
  assert.deepEqual(first, [...new Set(first)].sort(), 'sorted and deduplicated');
});
