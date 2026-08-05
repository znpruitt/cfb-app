import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  runCapturingRevalidatedTags,
  runWithRevalidateContext,
} from '../../../api/draft/[slug]/[year]/__tests__/_setup/revalidateContext';

import * as actions from '../actions';
import {
  ADMIN_SERVER_ACTION_NAMES,
  __withAdminActionAuthorizerForTests,
  requireAdminAction,
} from '../../../../lib/auth/requireAdminAction.ts';
import type { League } from '../../../../lib/league.ts';
import { draftScope } from '../../../../lib/draft.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppStateEntries,
  listAppStateScopes,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1SB — every admin Server Action authorizes at its own boundary.
//
// Next treats an exported Server Action as a public endpoint reachable by its
// action id, so routing is defense in depth and never the action's authority.
// These tests invoke the real exported functions DIRECTLY, with no pathname
// involved at all — which is the only shape that proves the boundary.
//
// The same table runs TWICE: unauthorized (expect zero durable effect) and
// authorized (expect the real effect). Without the positive control every
// "nothing happened" row would be unfalsifiable, and an input-validation
// refusal would be indistinguishable from an authorization refusal.
// ---------------------------------------------------------------------------

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

function makeLeague(slug: string, year: number, status?: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...(status !== undefined ? { status } : {}),
  };
}

/**
 * A complete durable-store snapshot, composed from already-exported readers.
 * Captures writes, deletes, scope disappearance, AND `updatedAt`, so a
 * byte-identical comparison proves no mutation of any kind occurred.
 */
async function snapshotStore(): Promise<string> {
  const scopes = (await listAppStateScopes()).sort();
  const out: Record<string, unknown> = {};
  for (const scope of scopes) {
    const entries = await getAppStateEntries<unknown>(scope);
    out[scope] = Object.fromEntries(
      Object.entries(entries)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, v])
    );
  }
  return JSON.stringify(out);
}

/** Seed state that would let every action reach a real mutation if authorized. */
async function seedWorld(): Promise<void> {
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2025, { state: 'season', year: 2025 }),
    makeLeague('alpha', 2025, { state: 'offseason' }),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 }),
  ]);
  await setAppState('preseason-owners:test', '2026', ['Alice', 'Bob']);
  await setAppState('owners:test:2025', 'csv', 'team,owner\nTexas,Alice');
  await setAppState('owners:test:2026', 'csv', 'team,owner\nTexas,Alice');
  // The demo league resolves to season 2025, so `autoCompleteDraft` targets
  // that year; 2026 is the year the preseason controls clear.
  for (const year of ['2025', '2026']) {
    await setAppState(draftScope('test'), year, {
      phase: 'active',
      picks: [],
      currentPickIndex: 0,
      settings: { draftOrder: ['Alice', 'Bob'], totalRounds: 1 },
      timerState: 'off',
      timerExpiresAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }
}

/**
 * Every action with VALID-LOOKING arguments, so no input-validation path can
 * fire and masquerade as an authorization refusal. The four slug-taking actions
 * are aimed at real seeded production leagues.
 */
const INVOCATIONS: ReadonlyArray<{ name: string; call: () => Promise<unknown> }> = [
  { name: 'setTestLeagueStatus', call: () => actions.setTestLeagueStatus('preseason') },
  { name: 'resetTestDraft', call: () => actions.resetTestDraft() },
  { name: 'resetTestLeague', call: () => actions.resetTestLeague() },
  { name: 'beginPreseason', call: () => actions.beginPreseason('alpha') },
  { name: 'setAssignmentMethod', call: () => actions.setAssignmentMethod('bravo', 'draft') },
  {
    name: 'confirmPreseasonOwners',
    call: () => actions.confirmPreseasonOwners('bravo', 2026, ['Alice', 'Bob']),
  },
  { name: 'completeSetup', call: () => actions.completeSetup('bravo', 2026) },
  { name: 'migrateTestOwnersCsv', call: () => actions.migrateTestOwnersCsv(2025, 2026) },
  { name: 'autoCompleteDraft', call: () => actions.autoCompleteDraft() },
];

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete MUTABLE_ENV.NODE_ENV;
  else MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  __resetAppStateForTests();
});

// ---------------------------------------------------------------------------
// UNAUTHORIZED — the whole point of the slice.

test('every action refuses an unauthorized caller and mutates nothing', async () => {
  for (const { name, call } of INVOCATIONS) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await seedWorld();
    const before = await snapshotStore();

    // Capture the tags actually revalidated during the call — an empty array
    // the test constructed itself would assert nothing.
    const captured: string[] = [];
    await assert.rejects(
      () =>
        __withAdminActionAuthorizerForTests(
          () => false,
          async () => {
            const { tags } = await runCapturingRevalidatedTags(async () => {
              await call();
            });
            captured.push(...tags);
          }
        ),
      /Not authorized/,
      `${name} must refuse with the stable authorization error`
    );

    assert.equal(
      await snapshotStore(),
      before,
      `${name} must not read-modify-write, delete, or create ANY durable record`
    );
    assert.deepEqual(captured, [], `${name} must not invalidate or revalidate anything`);
  }
});

test('authorization outranks argument validation', async () => {
  // `confirmPreseasonOwners` throws 'At least 2 owners required' when
  // authorized. Unauthorized, it must report AUTHORIZATION — otherwise a
  // validation refusal could masquerade as a guard and the guard could sit
  // below the check without any test noticing.
  await seedWorld();
  const before = await snapshotStore();

  await assert.rejects(
    () =>
      __withAdminActionAuthorizerForTests(
        () => false,
        () =>
          runWithRevalidateContext(() => actions.confirmPreseasonOwners('bravo', 2026, ['Solo']))
      ),
    /Not authorized/,
    'the guard must precede the owner-count check'
  );
  assert.equal(await snapshotStore(), before);
});

test('a value-returning action REJECTS rather than returning anything', async () => {
  // Both call sites treat a returned value as success, so a resolved promise of
  // any shape would be a security failure rather than a cosmetic one.
  await seedWorld();

  for (const { name, call } of INVOCATIONS.filter((i) =>
    ['migrateTestOwnersCsv', 'autoCompleteDraft'].includes(i.name)
  )) {
    const outcome = await __withAdminActionAuthorizerForTests(
      () => false,
      () =>
        runWithRevalidateContext(async () => call().then(() => 'RESOLVED' as const)).catch(
          () => 'REJECTED' as const
        )
    );
    assert.equal(outcome, 'REJECTED', `${name} must reject, never resolve`);
  }
});

// ---------------------------------------------------------------------------
// AUTHORIZED — the positive control. Without it, every "zero" above is
// unfalsifiable: an action that did nothing at all would pass identically.

test('the same calls DO take effect when authorized', async () => {
  for (const { name, call } of INVOCATIONS) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await seedWorld();
    const before = await snapshotStore();

    await __withAdminActionAuthorizerForTests(
      () => true,
      () =>
        runWithRevalidateContext(async () => {
          try {
            await call();
          } catch (err) {
            // `beginPreseason`/`confirmPreseasonOwners`/`completeSetup` end in
            // redirect(), which throws NEXT_REDIRECT. Anything else is real.
            const digest = (err as { digest?: string })?.digest ?? '';
            if (!String(digest).startsWith('NEXT_REDIRECT')) throw err;
          }
        })
    );

    assert.notEqual(
      await snapshotStore(),
      before,
      `${name} must actually do its work when authorized — otherwise the ` +
        `unauthorized assertion above proves nothing`
    );
  }
});

// ---------------------------------------------------------------------------
// The guard's own contract.

test('a blank CLERK_SECRET_KEY fails closed, whatever the session would say', async () => {
  const originalSecret = process.env.CLERK_SECRET_KEY;
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = ((...args: unknown[]) => void logs.push(String(args[0]))) as typeof console.warn;

  try {
    for (const secret of [undefined, '', '   ']) {
      if (secret === undefined) delete MUTABLE_ENV.CLERK_SECRET_KEY;
      else MUTABLE_ENV.CLERK_SECRET_KEY = secret;

      await assert.rejects(() => requireAdminAction('beginPreseason'), /Not authorized/);
      const event = JSON.parse(logs[logs.length - 1]!) as { reason: string };
      assert.equal(event.reason, 'missing-clerk-secret', `secret=${JSON.stringify(secret)}`);
    }
  } finally {
    console.warn = originalWarn;
    if (originalSecret === undefined) delete MUTABLE_ENV.CLERK_SECRET_KEY;
    else MUTABLE_ENV.CLERK_SECRET_KEY = originalSecret;
  }
});

test('the real authorizer fails closed with no Clerk session', async () => {
  // No override installed: this exercises the REAL path, which is what makes
  // the refusal meaningful rather than a test of a stub.
  const originalSecret = process.env.CLERK_SECRET_KEY;
  MUTABLE_ENV.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
  const originalWarn = console.warn;
  console.warn = (() => {}) as typeof console.warn;
  try {
    await assert.rejects(() => requireAdminAction('resetTestLeague'), /Not authorized/);
  } finally {
    console.warn = originalWarn;
    if (originalSecret === undefined) delete MUTABLE_ENV.CLERK_SECRET_KEY;
    else MUTABLE_ENV.CLERK_SECRET_KEY = originalSecret;
  }
});

test('an authorizer that THROWS is a refusal, never a pass', async () => {
  const originalWarn = console.warn;
  const logs: string[] = [];
  console.warn = ((...args: unknown[]) => void logs.push(String(args[0]))) as typeof console.warn;
  try {
    await assert.rejects(
      () =>
        __withAdminActionAuthorizerForTests(
          () => {
            throw new Error('clerk exploded');
          },
          () => requireAdminAction('completeSetup')
        ),
      /Not authorized/
    );
    const event = JSON.parse(logs[logs.length - 1]!) as { reason: string };
    assert.equal(event.reason, 'authorization-unavailable');
  } finally {
    console.warn = originalWarn;
  }
});

test('the refusal log carries exactly the allowlisted keys and no caller input', async () => {
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = ((...args: unknown[]) => void logs.push(String(args[0]))) as typeof console.warn;

  try {
    await assert.rejects(
      () =>
        __withAdminActionAuthorizerForTests(
          () => false,
          () =>
            runWithRevalidateContext(() =>
              actions.confirmPreseasonOwners('SLUG-CANARY', 2026, ['OWNER-CANARY', 'B'])
            )
        ),
      /Not authorized/
    );

    assert.equal(logs.length, 1, 'exactly one event per refusal');
    const raw = logs[0]!;
    const event = JSON.parse(raw) as Record<string, unknown>;

    assert.deepEqual(Object.keys(event).sort(), ['action', 'event', 'reason']);
    assert.equal(event.event, 'admin-action-unauthorized');
    assert.equal(event.action, 'confirmPreseasonOwners');
    assert.equal(event.reason, 'not-platform-admin');

    assert.ok(!raw.includes('SLUG-CANARY'), 'no caller-supplied slug');
    assert.ok(!raw.includes('OWNER-CANARY'), 'no caller-supplied arguments');
    assert.ok(!raw.includes('2026'), 'no caller-supplied year');
  } finally {
    console.warn = originalWarn;
  }
});

test('the scoped override restores after success, error, AND redirect', async () => {
  await seedWorld();

  // Success.
  await __withAdminActionAuthorizerForTests(
    () => true,
    async () => {}
  );
  await assert.rejects(() => requireAdminAction('resetTestDraft'), /Not authorized/);

  // Ordinary error.
  await assert.rejects(
    () =>
      __withAdminActionAuthorizerForTests(
        () => true,
        async () => {
          throw new Error('boom');
        }
      ),
    /boom/
  );
  await assert.rejects(() => requireAdminAction('resetTestDraft'), /Not authorized/);

  // Next redirect, which is how three of the actions terminate.
  await assert.rejects(
    () =>
      __withAdminActionAuthorizerForTests(
        () => true,
        () => runWithRevalidateContext(() => actions.beginPreseason('alpha'))
      ),
    (err: { digest?: string }) => String(err?.digest ?? '').startsWith('NEXT_REDIRECT')
  );
  await assert.rejects(() => requireAdminAction('resetTestDraft'), /Not authorized/);
});

test('production refuses the test override, from both directions', async () => {
  MUTABLE_ENV.NODE_ENV = 'production';
  const originalSecret = process.env.CLERK_SECRET_KEY;
  const originalWarn = console.warn;
  console.warn = (() => {}) as typeof console.warn;
  try {
    // The setter refuses outright...
    await assert.rejects(
      () =>
        __withAdminActionAuthorizerForTests(
          () => true,
          async () => 'reached'
        ),
      /must not be used in production/
    );

    // ...and the guard INDEPENDENTLY ignores an override that is already
    // installed. Install it while non-production (so the setter allows it),
    // then evaluate under production from inside the scope. This is the second
    // of the two checks; testing only the setter would leave the guard's own
    // ignore unverified, and a mutation removing it would pass unnoticed.
    MUTABLE_ENV.NODE_ENV = 'development';
    MUTABLE_ENV.CLERK_SECRET_KEY = 'sk_live_not_a_real_key';
    await __withAdminActionAuthorizerForTests(
      () => true,
      async () => {
        MUTABLE_ENV.NODE_ENV = 'production';
        await assert.rejects(
          () => requireAdminAction('autoCompleteDraft'),
          /Not authorized/,
          'an installed override must be ignored in production'
        );
      }
    );
  } finally {
    console.warn = originalWarn;
    MUTABLE_ENV.NODE_ENV = 'development';
    if (originalSecret === undefined) delete MUTABLE_ENV.CLERK_SECRET_KEY;
    else MUTABLE_ENV.CLERK_SECRET_KEY = originalSecret;
  }
});

// ---------------------------------------------------------------------------
// Structural completeness — behavioral reflection, plus the one scan a
// behavioral test genuinely cannot reach.

test('the guarded name list equals the exported actions of the module', async () => {
  const exported = Object.entries(actions)
    .filter(([, v]) => typeof v === 'function')
    .map(([k]) => k)
    .sort();

  assert.deepEqual(
    exported,
    [...ADMIN_SERVER_ACTION_NAMES].sort(),
    'a new exported action must be added to ADMIN_SERVER_ACTION_NAMES and guarded'
  );
});

test('every exported action opens with its own matching guard call', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/admin/[slug]/actions.ts'), 'utf8');

  for (const name of ADMIN_SERVER_ACTION_NAMES) {
    const start = source.indexOf(`export async function ${name}(`);
    assert.notEqual(start, -1, `${name} is exported`);
    const bodyStart = source.indexOf('{\n', start);
    const firstStatement = source
      .slice(bodyStart + 2)
      .split('\n')[0]!
      .trim();
    assert.equal(
      firstStatement,
      `await requireAdminAction('${name}');`,
      `${name}'s FIRST statement must be its own guard call — a guard below any ` +
        `read, validation, or mutation does not protect them`
    );
  }
});

test('no second repository Server Action module exists', () => {
  // The one thing a behavioral test cannot reach: a NEW `'use server'` module
  // appearing elsewhere in the tree would be an entirely separate action
  // surface, invisible to every assertion above. Scoped to repository source —
  // the production build also registers dependency-owned actions (Clerk), which
  // are not ours to guard.
  const root = join(process.cwd(), 'src');
  const modules: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const head = readFileSync(full, 'utf8').slice(0, 400);
      if (/^\s*['"]use server['"]\s*;/m.test(head)) modules.push(full.slice(root.length + 1));
    }
  };
  walk(root);

  assert.deepEqual(
    modules,
    ['app/admin/[slug]/actions.ts'],
    'a new Server Action module requires an explicit authorization decision'
  );
});
