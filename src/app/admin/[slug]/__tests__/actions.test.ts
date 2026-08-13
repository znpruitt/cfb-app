import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the server actions' `revalidateTag` (via invalidateStandings) runs under the
// bare node:test runner.
import '../../../api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { confirmPreseasonOwners, beginPreseason, completeSetup } from '../actions';
import { __withAdminActionAuthorizerForTests } from '../../../../lib/auth/requireAdminAction.ts';
import type { League } from '../../../../lib/league.ts';
import { draftScope, draftPicksDigest } from '../../../../lib/draft.ts';
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

function makeLeague(
  slug: string,
  status: League['status'],
  assignmentMethod: League['assignmentMethod'] | undefined = 'draft'
): League {
  // PLATFORM-094 — `completeSetup` asks how this league assigns teams, so a
  // league with no method is refused before the draft is even consulted.
  // Defaulted to 'draft' because that is what every case here models.
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2025,
    createdAt: '2024-01-01T00:00:00.000Z',
    status,
    ...(assignmentMethod !== undefined ? { assignmentMethod } : {}),
  };
}

// Run `fn`, capturing revalidated tags. Server actions terminate in redirect(),
// which throws NEXT_REDIRECT — swallow that (and only that) so the tags recorded
// before the throw can be asserted; any other error propagates.
// PLATFORM-086F2H1SB — authorize once here (see testControls.test.ts) so the
// existing assertions keep exercising behavior rather than the new guard.
async function runCapturingTags(fn: () => Promise<unknown>): Promise<string[]> {
  return __withAdminActionAuthorizerForTests(
    () => true,
    () => runCapturingTagsUnauthorized(fn)
  );
}

async function runCapturingTagsUnauthorized(fn: () => Promise<unknown>): Promise<string[]> {
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

const SEED_AT = '2026-08-01T00:00:00.000Z';

/**
 * Seed a league whose teams ARE assigned: a complete draft that published, plus
 * the roster it published. PLATFORM-094 — `phase: 'complete'` alone is the state
 * a draft reaches on its final pick and assigns nothing, so the digest has to
 * match the picks for `completeSetup` to accept it.
 */
const SEED_PICKS = [
  {
    pickNumber: 1,
    round: 0,
    roundPick: 0,
    owner: 'Alice',
    team: 'Texas',
    pickedAt: SEED_AT,
    autoSelected: false,
  },
  {
    pickNumber: 2,
    round: 0,
    roundPick: 1,
    owner: 'Bob',
    team: 'Ohio State',
    pickedAt: SEED_AT,
    autoSelected: false,
  },
];

async function seedAssignedTeams(slug: string, year: number): Promise<void> {
  const picks = [
    {
      pickNumber: 1,
      round: 0,
      roundPick: 0,
      owner: 'Alice',
      team: 'Texas',
      pickedAt: SEED_AT,
      autoSelected: false,
    },
    {
      pickNumber: 2,
      round: 0,
      roundPick: 1,
      owner: 'Bob',
      team: 'Ohio State',
      pickedAt: SEED_AT,
      autoSelected: false,
    },
  ];
  await setAppState(draftScope(slug), String(year), {
    phase: 'complete',
    picks,
    publishedPicks: draftPicksDigest(picks),
  });
  await setAppState(`owners:${slug}:${year}`, 'csv', 'team,owner\nTexas,Alice\nOhio State,Bob');
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

test('confirmPreseasonOwners refuses an unusable owner list before persisting or invalidating', async () => {
  // PLATFORM-092 — validate what the READER will see. Server Action arguments
  // cross HTTP unvalidated, so the shell's own guards are not the enforcement.
  const cases: Array<[string[], RegExp]> = [
    [['Alice'], /at least 2 owners are required/i],
    // A repeated name is a mistake to report, not something to quietly collapse
    // into a shorter roster than the commissioner entered.
    [['Alice', 'Alice', 'Bob'], /listed more than once/i],
    // NoClaim is the absorber for unclaimed teams, never a person.
    [['NoClaim', 'Alice'], /reserved for unclaimed teams/i],
  ];
  for (const [owners, expected] of cases) {
    await assert.rejects(
      () => runCapturingTags(() => confirmPreseasonOwners('alpha', 2026, owners)),
      expected,
      owners.join(',')
    );
    assert.equal(
      await getAppState<string[]>('preseason-owners:alpha', '2026'),
      null,
      `no preseason owners persisted on the rejected path: ${owners.join(',')}`
    );
  }
});

test('confirmPreseasonOwners stores names exactly as entered, minus stray whitespace', async () => {
  // Owner identity is the raw string everywhere downstream, so nothing is folded
  // on the commissioner's behalf — two people really can be "Mike" and "mike".
  await runCapturingTags(() => confirmPreseasonOwners('alpha', 2026, ['  Mike ', 'mike', 'Zach']));
  const stored = await getAppState<string[]>('preseason-owners:alpha', '2026');
  assert.deepEqual(stored?.value, ['Mike', 'mike', 'Zach']);
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
  await seedAssignedTeams('alpha', 2026);

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

test('beginPreseason logs a safe refusal when the next year cannot be derived', async () => {
  await setAppState('leagues', 'registry', [
    {
      ...makeLeague('alpha', { state: 'offseason' }),
      year: Number.MAX_SAFE_INTEGER,
    },
  ]);
  const messages: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => messages.push(args.map(String).join(' '));
  try {
    await assert.rejects(
      () => runCapturingTags(() => beginPreseason('alpha')),
      /Unable to begin preseason/
    );
  } finally {
    console.error = original;
  }

  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0]!) as unknown, {
    event: 'lifecycle-action-refused',
    action: 'begin-preseason',
    leagueSlug: 'alpha',
    reason: 'unusable-next-year',
  });
});

test('completeSetup preserves redirect behavior but logs and refuses a stale-year form', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);
  const before = await getAppState<League[]>('leagues', 'registry');
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => messages.push(args.map(String).join(' '));
  try {
    await runCapturingTags(() => completeSetup('alpha', 2025));
  } finally {
    console.warn = original;
  }

  assert.deepEqual(await getAppState<League[]>('leagues', 'registry'), before);
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0]!) as unknown, {
    event: 'lifecycle-action-refused',
    action: 'complete-preseason-setup',
    leagueSlug: 'alpha',
    reason: 'year-mismatch',
  });
});

// ---------------------------------------------------------------------------
// PLATFORM-094 — completeSetup verifies team assignment itself.
//
// It previously trusted a `disabled` button, which is not a guard: this Server
// Action is reachable without the form, and Server Action arguments cross HTTP
// unvalidated (PLATFORM-086F2H1SB).
// ---------------------------------------------------------------------------

async function seedPreseasonLeague(): Promise<void> {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);
}

async function setupCompleteFlag(): Promise<boolean | undefined> {
  const status = (await getAppState<League[]>('leagues', 'registry'))?.value?.[0]?.status;
  return status?.state === 'preseason' ? status.setupComplete : undefined;
}

test('completeSetup refuses a draft that is complete but never published', async () => {
  // The shape `draftPhase === 'complete'` alone admitted — and the state EVERY
  // draft is in the moment its final pick lands.
  await seedPreseasonLeague();
  await setAppState(draftScope('alpha'), '2026', { phase: 'complete', picks: SEED_PICKS });

  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2026)),
    /draft-not-published/
  );
  assert.notEqual(await setupCompleteFlag(), true);
});

test('completeSetup refuses a pre-draft roster standing in for a published one', async () => {
  // A repair CSV imported before the draft, plus a phase that flipped on the
  // final pick, is not a publication — and a presence-only check would complete
  // setup on ownership the draft never made.
  await seedPreseasonLeague();
  await setAppState('owners:alpha:2026', 'csv', 'team,owner\nTexas,Carol\nOhio State,Dave');
  await setAppState(draftScope('alpha'), '2026', { phase: 'complete', picks: SEED_PICKS });

  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2026)),
    /draft-not-published/
  );
  assert.notEqual(await setupCompleteFlag(), true);
});

test('completeSetup refuses a draft whose picks changed after it published', async () => {
  // Reset / Undo / a pick edit all land here: the digest no longer describes the
  // picks, so the stored roster describes a draft that no longer exists.
  await seedPreseasonLeague();
  await seedAssignedTeams('alpha', 2026);
  await setAppState(draftScope('alpha'), '2026', {
    phase: 'complete',
    picks: [{ ...SEED_PICKS[0]!, team: 'Michigan' }, SEED_PICKS[1]!],
    publishedPicks: draftPicksDigest(SEED_PICKS),
  });

  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2026)),
    /draft-not-published/
  );
  assert.notEqual(await setupCompleteFlag(), true);
});

test('completeSetup refuses a published draft whose roster was later blanked', async () => {
  // `PUT /api/owners` can clear the CSV without touching the draft, so the
  // publication record alone would outlive the data it points at.
  await seedPreseasonLeague();
  await seedAssignedTeams('alpha', 2026);
  await setAppState('owners:alpha:2026', 'csv', null);

  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2026)),
    /published-roster-missing/
  );
  assert.notEqual(await setupCompleteFlag(), true);
});

test('completeSetup refuses a league with no assignment method', async () => {
  await setAppState('leagues', 'registry', [
    // `null`, not `undefined` — a default parameter fires on undefined and
    // would hand the league back the 'draft' method this case is removing.
    makeLeague('alpha', { state: 'preseason', year: 2026 }, null),
  ]);

  await assert.rejects(
    () => runCapturingTags(() => completeSetup('alpha', 2026)),
    /no-assignment-method/
  );
  assert.notEqual(await setupCompleteFlag(), true);
});
