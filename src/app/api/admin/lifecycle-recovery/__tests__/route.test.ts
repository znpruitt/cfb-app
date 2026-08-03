import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1 — `POST /api/admin/lifecycle-recovery` is the narrow,
// platform-admin-only authority that initializes a GENUINELY ABSENT lifecycle
// status on a legacy league record, and nothing else. It is not a generic
// lifecycle setter: no state selection, no year edit, no archive, no rollover
// bypass, no repair of a malformed status, and no test-league operation. It is
// dormant in F2H1 (no UI invokes it) but fully contracted and tested.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-token';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

// Distinctive strings that must never appear in a response body.
const PASSWORD_HASH_CANARY = 'PASSWORD-HASH-CANARY-0001';
const PASSWORD_SALT_CANARY = 'PASSWORD-SALT-CANARY-0002';
const STORAGE_ERROR_CANARY = 'STORAGE-ERROR-CANARY-0003';

function makeLeague(slug: string, year: number, status?: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    ...(status !== undefined ? { status } : {}),
  };
}

function postRequest(body: unknown, token: string | null = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return new Request('https://example.com/api/admin/lifecycle-recovery', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
}

async function seed(leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

type ErrorBody = { error?: string; detail?: string };
type SuccessBody = {
  leagueSlug?: string;
  year?: number;
  status?: { state?: string; year?: number };
};

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  __resetAppStateForTests();
});

// ---------------------------------------------------------------------------
// Authentication

test('an unauthenticated request is rejected with 401 before any registry work', async () => {
  await seed([makeLeague('alpha', 2024)]);
  // Any registry read or write would throw this — proving auth ran FIRST is the
  // absence of the 503 that a store fault would otherwise produce.
  __setAppStateReadFailureForTests(new Error(STORAGE_ERROR_CANARY), 'leagues');
  __setAppStateWriteFailureForTests(new Error(STORAGE_ERROR_CANARY), 'leagues');
  try {
    const res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }, null));

    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(!text.includes(STORAGE_ERROR_CANARY), 'no registry access was attempted');
  } finally {
    __setAppStateReadFailureForTests(null);
    __setAppStateWriteFailureForTests(null);
  }

  const stored = await readRegistry();
  assert.equal(stored[0]?.status, undefined, 'the legacy record is untouched');
});

test('an invalid admin token is rejected with 401', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }, 'wrong-token'));

  assert.equal(res.status, 401);
  assert.equal((await readRegistry())[0]?.status, undefined);
});

// ---------------------------------------------------------------------------
// Request validation

test('malformed JSON is a 400 invalid request', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const res = await POST(postRequest('{ not json'));

  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as ErrorBody).error, 'lifecycle-recovery-invalid-request');
  assert.equal((await readRegistry())[0]?.status, undefined);
});

test('a non-object body is a 400 invalid request', async () => {
  await seed([makeLeague('alpha', 2024)]);

  for (const body of ['null', '"alpha"', '42', '["alpha"]']) {
    const res = await POST(postRequest(body));
    assert.equal(res.status, 400, `body ${body} rejected`);
    assert.equal(((await res.json()) as ErrorBody).error, 'lifecycle-recovery-invalid-request');
  }
  assert.equal((await readRegistry())[0]?.status, undefined);
});

test('a missing or non-canonical slug is a 400 invalid request', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const invalidSlugs: unknown[] = [
    undefined,
    '',
    '   ',
    'Alpha',
    'alpha_beta',
    'alpha/beta',
    7,
    null,
  ];
  for (const leagueSlug of invalidSlugs) {
    const res = await POST(postRequest({ leagueSlug, confirmed: true }));
    assert.equal(res.status, 400, `slug ${JSON.stringify(leagueSlug)} rejected`);
    assert.equal(((await res.json()) as ErrorBody).error, 'lifecycle-recovery-invalid-request');
  }
  assert.equal((await readRegistry())[0]?.status, undefined);
});

test('missing, false, or merely truthy confirmation is a 400 invalid request', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const unconfirmed: unknown[] = [undefined, false, null, 'true', 1, {}];
  for (const confirmed of unconfirmed) {
    const res = await POST(postRequest({ leagueSlug: 'alpha', confirmed }));
    assert.equal(res.status, 400, `confirmed ${JSON.stringify(confirmed)} rejected`);
    assert.equal(((await res.json()) as ErrorBody).error, 'lifecycle-recovery-invalid-request');
  }
  assert.equal((await readRegistry())[0]?.status, undefined, 'nothing was initialized');
});

// ---------------------------------------------------------------------------
// Refusals

test('an unknown league is a 404', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const res = await POST(postRequest({ leagueSlug: 'ghost', confirmed: true }));

  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as ErrorBody).error, 'lifecycle-recovery-league-not-found');
});

test('a league with an existing valid status is a 409 status-already-present', async () => {
  await seed([
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 }),
    makeLeague('charlie', 2025, { state: 'offseason' }),
  ]);
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo', 'charlie']) {
    const res = await POST(postRequest({ leagueSlug: slug, confirmed: true }));
    assert.equal(res.status, 409, `${slug} refused`);
    assert.equal(((await res.json()) as ErrorBody).error, 'lifecycle-status-already-present');
  }

  assert.deepEqual(await readRegistry(), before, 'a valid lifecycle status is never altered');
});

test('the test league is a 409 test-league-lifecycle-managed-separately', async () => {
  await seed([makeLeague('test', 2024)]);
  const before = await readRegistry();

  const res = await POST(postRequest({ leagueSlug: 'test', confirmed: true }));

  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as ErrorBody).error, 'test-league-lifecycle-managed-separately');
  assert.deepEqual(await readRegistry(), before);
});

test('a malformed legacy status is a 409 invalid-legacy-record, never repaired', async () => {
  await seed([
    makeLeague('alpha', 2024, {} as League['status']),
    makeLeague('bravo', 2024, { state: 'bogus' } as unknown as League['status']),
    makeLeague('charlie', 2024, { state: 'preseason' } as unknown as League['status']),
    // A non-boolean `setupComplete` makes the preseason variant unassignable —
    // it must surface as the malformed-record code, not status-already-present
    // (F2H1 Codex review round 2).
    makeLeague('delta', 2026, {
      state: 'preseason',
      year: 2026,
      setupComplete: 'yes',
    } as unknown as League['status']),
  ]);
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo', 'charlie', 'delta']) {
    const res = await POST(postRequest({ leagueSlug: slug, confirmed: true }));
    assert.equal(res.status, 409, `${slug} refused`);
    assert.equal(
      ((await res.json()) as ErrorBody).error,
      'lifecycle-recovery-invalid-legacy-record'
    );
  }

  assert.deepEqual(await readRegistry(), before);
});

test('a stored value that is not a year at all is a 409 invalid-legacy-record', async () => {
  // An out-of-range but structurally valid year (1999) is REPAIRABLE — the
  // supported range is an ingress rule, not a recovery rule (F2H review).
  await seed([makeLeague('alpha', 2024.5), makeLeague('bravo', Number.NaN as number)]);
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo']) {
    const res = await POST(postRequest({ leagueSlug: slug, confirmed: true }));
    assert.equal(res.status, 409, `${slug} refused`);
    assert.equal(
      ((await res.json()) as ErrorBody).error,
      'lifecycle-recovery-invalid-legacy-record'
    );
  }

  assert.deepEqual(await readRegistry(), before, 'no season year was invented');
});

// ---------------------------------------------------------------------------
// Success

test('an out-of-range but valid legacy year is repaired, not refused', async () => {
  await seed([makeLeague('alpha', 1999)]);

  const res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));

  assert.equal(res.status, 200);
  const body = (await res.json()) as SuccessBody;
  assert.deepEqual(body.status, { state: 'season', year: 1999 });
  assert.deepEqual((await readRegistry())[0]!.status, { state: 'season', year: 1999 });
});

test('a confirmed request initializes the missing status and returns the installed value', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));

  assert.equal(res.status, 200);
  const body = (await res.json()) as SuccessBody;
  assert.equal(body.leagueSlug, 'alpha');
  assert.equal(body.year, 2024);
  assert.deepEqual(body.status, { state: 'season', year: 2024 });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'season', year: 2024 });
  assert.equal(stored.year, 2024, 'the top-level year stays synchronized and is not incremented');
});

test('a repeated request cannot overwrite the newly installed status', async () => {
  await seed([makeLeague('alpha', 2024)]);

  assert.equal((await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }))).status, 200);
  const afterFirst = await readRegistry();

  const repeat = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));

  assert.equal(repeat.status, 409);
  assert.equal(((await repeat.json()) as ErrorBody).error, 'lifecycle-status-already-present');
  assert.deepEqual(await readRegistry(), afterFirst, 'the installed status is immutable here');
});

// ---------------------------------------------------------------------------
// Store faults and response safety

test('an INDETERMINATE store failure never claims the status was not installed', async () => {
  // PLATFORM-086H3D durability-uncertainty contract (raised at F2H1 Codex review):
  // when mutation SQL was SUBMITTED but its COMMIT acknowledgement was lost, the
  // write MAY already be durable. Injecting the typed error through the write
  // seam exercises exactly the route logic under test — its classification of a
  // typed store error — without standing up a fake Postgres pool.
  await seed([makeLeague('alpha', 2024)]);

  __setAppStateWriteFailureForTests(
    new AppStateTxnFinalizeError(new Error(STORAGE_ERROR_CANARY), true, false),
    'leagues'
  );
  let res: Response;
  try {
    res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(res.status, 503);
  const text = await res.text();
  const body = JSON.parse(text) as ErrorBody;
  assert.equal(body.error, 'lifecycle-recovery-unavailable');
  assert.ok(
    !/No lifecycle status was installed/.test(body.detail ?? ''),
    'never promises a rollback the store cannot guarantee'
  );
  assert.match(body.detail ?? '', /could not be confirmed/);
  assert.ok(!text.includes(STORAGE_ERROR_CANARY), 'no raw storage error text');
});

test('a DEFINITE store failure still reports that nothing was installed', async () => {
  // `writeAttempted: false` — no mutation SQL was submitted, so the untouched
  // claim is truthful and must be preserved.
  await seed([makeLeague('alpha', 2024)]);
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(
    new AppStateTxnFinalizeError(new Error(STORAGE_ERROR_CANARY), false, false),
    'leagues'
  );
  let res: Response;
  try {
    res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(res.status, 503);
  const body = (await res.json()) as ErrorBody;
  assert.equal(body.error, 'lifecycle-recovery-unavailable');
  assert.match(body.detail ?? '', /No lifecycle status was installed/);
  assert.deepEqual(await readRegistry(), before);
});

test('an indeterminate cleanup failure is classified the same way', async () => {
  await seed([makeLeague('alpha', 2024)]);

  __setAppStateWriteFailureForTests(
    new AppStateTxnCleanupError(
      new Error(STORAGE_ERROR_CANARY),
      new Error('rollback failed'),
      true,
      false
    ),
    'leagues'
  );
  let res: Response;
  try {
    res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(res.status, 503);
  const text = await res.text();
  assert.match((JSON.parse(text) as ErrorBody).detail ?? '', /could not be confirmed/);
  assert.ok(!text.includes('rollback failed'), 'no cleanup-cause detail leaks');
  assert.ok(!text.includes(STORAGE_ERROR_CANARY));
});

test('a registry read failure is a 503 with no raw storage detail', async () => {
  await seed([makeLeague('alpha', 2024)]);

  __setAppStateReadFailureForTests(new Error(STORAGE_ERROR_CANARY), 'leagues');
  let res: Response;
  try {
    res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));
  } finally {
    __setAppStateReadFailureForTests(null);
  }

  assert.equal(res.status, 503);
  const text = await res.text();
  assert.equal((JSON.parse(text) as ErrorBody).error, 'lifecycle-recovery-unavailable');
  assert.ok(!text.includes(STORAGE_ERROR_CANARY), 'no raw storage error text');
  assert.ok(!text.includes('at '), 'no stack frames');
});

test('a registry write failure is a 503 and leaves the record unchanged', async () => {
  await seed([makeLeague('alpha', 2024)]);
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error(STORAGE_ERROR_CANARY), 'leagues');
  let res: Response;
  try {
    res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(res.status, 503);
  const text = await res.text();
  assert.equal((JSON.parse(text) as ErrorBody).error, 'lifecycle-recovery-unavailable');
  assert.ok(!text.includes(STORAGE_ERROR_CANARY));
  assert.deepEqual(await readRegistry(), before, 'no partial lifecycle write survived');
});

test('no response leaks credential material from the league record', async () => {
  await seed([
    {
      ...makeLeague('alpha', 2024),
      passwordHash: PASSWORD_HASH_CANARY,
      passwordSalt: PASSWORD_SALT_CANARY,
    },
    {
      ...makeLeague('bravo', 2024, { state: 'season', year: 2024 }),
      passwordHash: PASSWORD_HASH_CANARY,
      passwordSalt: PASSWORD_SALT_CANARY,
    },
  ]);

  // The success path and the refusal path both observe the full record.
  const responses = [
    await POST(postRequest({ leagueSlug: 'alpha', confirmed: true })),
    await POST(postRequest({ leagueSlug: 'bravo', confirmed: true })),
  ];

  for (const res of responses) {
    const text = await res.text();
    assert.ok(!text.includes(PASSWORD_HASH_CANARY), 'no password hash');
    assert.ok(!text.includes(PASSWORD_SALT_CANARY), 'no password salt');
    assert.ok(!text.includes(ADMIN_TOKEN), 'no admin token');
    assert.ok(!text.includes('passwordHash'), 'no credential field names');
    assert.ok(!text.includes('passwordSalt'));
  }
});

test('the success body is a fixed allowlist — no extra league fields ride along', async () => {
  await seed([
    {
      ...makeLeague('alpha', 2024),
      foundedYear: 2011,
      assignmentMethod: 'draft',
      passwordHash: PASSWORD_HASH_CANARY,
    },
  ]);

  const res = await POST(postRequest({ leagueSlug: 'alpha', confirmed: true }));

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['leagueSlug', 'status', 'year']);
  assert.deepEqual(Object.keys(body.status as object).sort(), ['state', 'year']);
});
