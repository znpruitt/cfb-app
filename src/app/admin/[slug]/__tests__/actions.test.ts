import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the server actions' `revalidateTag` (via invalidateStandings) runs under the
// bare node:test runner.
import '../../../api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import {
  confirmPreseasonOwners,
  beginPreseason,
  completeSetup,
  setAssignmentMethod,
} from '../actions';
import { __withAdminActionAuthorizerForTests } from '../../../../lib/auth/requireAdminAction.ts';
import type { League } from '../../../../lib/league.ts';
import { draftScope, type DraftState } from '../../../../lib/draft.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import { draftPicksSignature } from '../../../../lib/selectors/draftPublication.ts';

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
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
    publishedPicks: draftPicksSignature(picks),
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

test('completeSetup invalidates the INSIGHTS feed, not only the admin pages', async () => {
  // INSIGHTS-025. `setupComplete` is the evidence that licenses membership-change
  // insights (`membershipCompleteness.ts`), and that answer is computed inside the
  // insights cache — whose entries carry the canonical standings tags. Revalidating
  // the admin paths does not reach it, so before this the public Overview kept
  // serving the pre-completion pool (silent on arrivals and departures) for up to
  // the 300s TTL after the commissioner clicked Complete Setup.
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);
  await seedAssignedTeams('alpha', 2026);

  const tags = await runCapturingTags(() => completeSetup('alpha', 2026));

  assert.ok(tags.includes('standings:alpha'), 'league umbrella tag invalidated');
  assert.ok(
    tags.includes('standings:alpha:2026'),
    'and the YEAR tag — insights are cached per (slug, year)'
  );
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
  await setAppState(draftScope('alpha'), '2026', {
    phase: 'complete',
    picks: SEED_PICKS,
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
  });

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
  await setAppState(draftScope('alpha'), '2026', {
    phase: 'complete',
    picks: SEED_PICKS,
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
  });

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
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
    publishedPicks: draftPicksSignature(SEED_PICKS),
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

test('setAssignmentMethod refuses to leave a draft that has every pick', async () => {
  // PLATFORM-095, owner's ruling. Switching is fine mid-draft; once the picks are
  // all in, the draft's assignment must not be thrown away by changing method.
  //
  // The refusal lives in the ACTION, not only in the card. This is a Server
  // Action: reachable without the form, arguments crossing HTTP unvalidated —
  // hiding the control is presentation, not enforcement.
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);
  await seedAssignedTeams('alpha', 2026);

  // RETURNED, not thrown: Next.js redacts thrown Server Action errors in
  // production, so a throw would reach the commissioner as an opaque digest.
  let refused: Awaited<ReturnType<typeof setAssignmentMethod>> | undefined;
  await runCapturingTags(async () => {
    refused = await setAssignmentMethod('alpha', 'manual');
  });
  assert.equal(refused?.ok, false, 'the action refuses');
  assert.match(refused?.ok === false ? refused.error : '', /draft is finished/);

  const league = (await getAppState<League[]>('leagues', 'registry'))?.value?.[0];
  assert.equal(league?.assignmentMethod, 'draft', 'the method is unchanged');
});

test('setAssignmentMethod always allows switching BACK to draft', async () => {
  // The direction fix. Refusing every change once the picks were in also blocked
  // the return journey, and a league on `manual` with a finished draft had no
  // route out: `manual-assignment-incomplete` has no writer, the card is hidden,
  // and Complete Setup is blocked with only a draft Reset to escape.
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }, 'manual'),
  ]);
  await seedAssignedTeams('alpha', 2026);

  await runCapturingTags(() => setAssignmentMethod('alpha', 'draft'));

  const back = (await getAppState<League[]>('leagues', 'registry'))?.value?.[0];
  assert.equal(back?.assignmentMethod, 'draft', 'the recovery path is open');
});

test('setAssignmentMethod still allows a switch mid-draft', async () => {
  // The other half of the ruling: an in-progress draft may be abandoned. The
  // confirmation dialog is the UI half; the action must not block it.
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);
  await setAppState(draftScope('alpha'), '2026', {
    phase: 'live',
    picks: [SEED_PICKS[0]!],
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
  });

  await runCapturingTags(() => setAssignmentMethod('alpha', 'manual'));

  const league = (await getAppState<League[]>('leagues', 'registry'))?.value?.[0];
  assert.equal(league?.assignmentMethod, 'manual');
});

test('the destructive warning is offered only when LEAVING a draft', () => {
  // Structural. The confirmation is client state raised by a click, which the
  // server-render harness cannot fire — but the DIRECTION is checkable, and it
  // was wrong: `draftHasPicks` stays true after switching to manual (the draft
  // record is deliberately retained), so selecting "Run a Draft" also raised
  // "this discards the draft", which is the opposite of what returning does.
  const source = readFileSync(
    new URL('../components/AssignmentMethodCard.tsx', import.meta.url),
    'utf8'
  );
  assert.match(
    source,
    /method !== currentMethod && method !== 'draft' && draftHasPicks/,
    'returning to `draft` must not warn about discarding it'
  );
});

test('a completed draft blocks manual even when NO method was ever chosen', async () => {
  // Codex. The guard keyed on `assignmentMethod === 'draft'`, so a league that
  // never chose one skipped the check entirely — and draft creation has no
  // method gate, so a commissioner can create and finish a draft first, then
  // switch to manual on top of it. The refusal keys on the REQUESTED direction
  // and the draft's state, not on the method the league happens to hold.
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }, null),
  ]);
  await seedAssignedTeams('alpha', 2026);

  let refused: Awaited<ReturnType<typeof setAssignmentMethod>> | undefined;
  await runCapturingTags(async () => {
    refused = await setAssignmentMethod('alpha', 'manual');
  });
  assert.equal(refused?.ok, false);

  const league = (await getAppState<League[]>('leagues', 'registry'))?.value?.[0];
  assert.notEqual(league?.assignmentMethod, 'manual', 'nothing was written');
});

test('the draft setup shell offers Reset for a finished but unconfirmed draft', () => {
  // Structural. The only state with no exit at all: nothing published, so no
  // Reopen, and Reset hidden at `complete`, so abandoning a finished draft meant
  // CONFIRMING it first. `DraftControls` allowed a reset there and is mounted by
  // nothing, so the affordance was lost rather than removed deliberately.
  //
  // Rendering the shell needs a router and live draft state this harness has
  // none of, so the gate itself is pinned.
  const source = readFileSync(
    new URL('../../../../components/draft/DraftSetupShell.tsx', import.meta.url),
    'utf8'
  );
  // PLATFORM-099 split the control in two — the trigger button and the typed
  // confirmation panel — so BOTH must carry the gate. COUNTED, not matched: an
  // existence check passes just as happily on one as on two, and this branch's
  // predecessor shipped a duplicated banner that every gate waved through for
  // exactly that reason.
  const gated = source.match(/\{\(phase !== 'complete' \|\| !isPublished\) &&/g) ?? [];
  assert.equal(
    gated.length,
    2,
    'Reset survives at `complete` until published — on the trigger AND the confirmation'
  );
  assert.match(source, /const isPublished = isDraftPublished\(draftState\);/);

  // PLATFORM-099 — a second click on the same button was arming and confirming in
  // one gesture, because the confirm button rendered where the first click left
  // the cursor. This card also carries the pick timer, which is what brings
  // anyone here mid-draft.
  assert.match(
    source,
    /const resetPhraseMatches = resetTyped\.trim\(\)\.toLowerCase\(\) === slug\.toLowerCase\(\);/,
    'the reset confirmation is a typed phrase, not a second click'
  );
  // Case-insensitive, and the input opts out of autocapitalise — mobile IMEs
  // capitalise the first character, and draft night is the likeliest phone
  // moment for a control that shares a card with the pick timer.
  assert.match(source, /autoCapitalize="off"/, 'the confirmation input is typable on a phone');
  assert.match(
    source,
    /if \(!resetPhraseMatches\) return;/,
    'and the handler re-checks it, so a keyboard submit cannot pass a disabled attribute'
  );
  assert.equal(
    (source.match(/Confirm reset — all picks will be lost/g) ?? []).length,
    0,
    'the one-button arm-and-confirm is gone, not merely bypassed'
  );
});

test('a draft mid-correction still counts as run for the method guard', async () => {
  // PLATFORM-096 round 1. Requiring every slot FILLED made a fully-drafted league
  // with one temporarily empty slot read as in-progress, so switching to `manual`
  // was permitted and the whole draft stranded — one click during the correction
  // window this feature introduces, re-opening the hole PLATFORM-095 closed.
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }),
  ]);
  await seedAssignedTeams('alpha', 2026);
  const draft = (await getAppState<DraftState>(draftScope('alpha'), '2026'))?.value as DraftState;
  await setAppState(draftScope('alpha'), '2026', {
    ...draft,
    picks: [draft.picks[0]!, { ...draft.picks[1]!, team: null }],
  });

  let refused: Awaited<ReturnType<typeof setAssignmentMethod>> | undefined;
  await runCapturingTags(async () => {
    refused = await setAssignmentMethod('alpha', 'manual');
  });
  assert.equal(refused?.ok, false, 'a run draft cannot be discarded mid-correction');
});
