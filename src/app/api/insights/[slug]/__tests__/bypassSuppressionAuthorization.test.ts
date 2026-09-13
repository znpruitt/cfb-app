import assert from 'node:assert/strict';
import test from 'node:test';

import { clearGenerators, getRegisteredGenerators, registerGenerator } from '@/lib/insights/engine';
import type { InsightGenerator } from '@/lib/insights/types';
import { addLeague } from '@/lib/leagueRegistry';
import { saveSeasonArchive, type SeasonArchive } from '@/lib/seasonArchive';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import { __resetTeamDatabaseStoreForTests } from '@/lib/server/teamDatabaseStore';

import { GET } from '../route';

/**
 * #627 — `?bypassSuppression=1` is a platform-admin capability, and its only gate
 * was `isAuthorizedForLeague`, which admits ANY caller on a passwordless league.
 *
 * TWO things had to be pinned, and the second is what makes the first mean
 * something. The refusal is easy to assert and trivially passes on a fixture that
 * never had bypassed content: every test below that asserts "the anonymous caller
 * got nothing" is paired with a control proving the SAME fixture yields bypassed
 * output for an admin.
 *
 * The stand-in generator is why that control can exist at all. Measured against
 * this branch's parent: the two live `shouldSuppressGenerator` entries each carry
 * a non-bypassable copy inside their own generator, so `bypassSuppression` lifts
 * the engine gate and publishes NOTHING today. A control built on `narrative:
 * membership` or `career:rookie_benchmark` would therefore be green for the wrong
 * reason — it would assert an absence the generator, not the guard, produced.
 * `SUPPRESSED_GENERATOR_ID` registers a generator under an id the engine gate
 * suppresses, WITHOUT that in-generator copy: exactly the shape AGENTS.md Season
 * Launch invariant 4 permits a future engine-level rule to have, and exactly what
 * this guard exists to protect.
 */

/** `shouldSuppressGenerator` suppresses this id whenever `usingArchivedRoster`. */
const SUPPRESSED_GENERATOR_ID = 'career:rookie_benchmark';
const BYPASSED_INSIGHT_ID = 'engine-gated-stand-in';
const ADMIN_TOKEN = 'test-admin-token-627';

const SLUG = 'insights-bypass-auth';
const YEAR = 2026;

let savedGenerators: readonly InsightGenerator[] = [];
let savedToken: string | undefined;

/**
 * Emits unconditionally. The engine's own gate is the ONLY thing that can stop
 * it, which is what makes its presence a direct observation of whether
 * `bypassSuppression` took effect.
 */
const standInGenerator: InsightGenerator = {
  id: SUPPRESSED_GENERATOR_ID,
  category: 'historical',
  supportedLifecycles: ['fresh_offseason', 'offseason', 'preseason'],
  tone: 'factual',
  generate(): ReturnType<InsightGenerator['generate']> {
    return [
      {
        id: BYPASSED_INSIGHT_ID,
        type: 'rookie_benchmark',
        title: 'Engine-gated stand-in',
        description: 'Only reachable when the engine suppression gate is lifted.',
        descriptionVariants: ['Only reachable when the engine suppression gate is lifted.'],
        owner: 'Alice',
        relatedOwners: [],
        priorityScore: 70,
        lifecycle: ['fresh_offseason', 'offseason', 'preseason'],
        category: 'historical',
        newsHook: 'new_record',
        statValue: 1,
      },
    ];
  },
};

/**
 * Counts every generator invocation, so "the uncached build at `loadInsights.ts`
 * is unreachable" is OBSERVED rather than inferred from a status code. A refusal
 * that still ran the build would look identical in the response.
 */
let generatorInvocations = 0;
const countingGenerator: InsightGenerator = {
  id: 'narrative:counting-probe',
  category: 'narrative',
  supportedLifecycles: ['fresh_offseason', 'offseason', 'preseason', 'early_season', 'mid_season'],
  tone: 'factual',
  generate(): ReturnType<InsightGenerator['generate']> {
    generatorInvocations += 1;
    return [] as ReturnType<InsightGenerator['generate']>;
  },
};

function archive(year: number): SeasonArchive {
  return {
    leagueSlug: SLUG,
    year,
    archivedAt: '2026-01-02T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\nTexas,Alice\nGeorgia,Bob\n',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [
      { owner: 'Alice', wins: 10, losses: 2, ties: 0, pointsFor: 300, pointsAgainst: 200, rank: 1 },
      { owner: 'Bob', wins: 8, losses: 4, ties: 0, pointsFor: 280, pointsAgainst: 210, rank: 2 },
    ],
    games: [],
    scoresByKey: {},
  } as unknown as SeasonArchive;
}

/**
 * A PASSWORDLESS league whose roster is borrowed from an archive, so
 * `usingArchivedRoster` is true and the engine gate is armed. No owners CSV for
 * `YEAR` is what borrows it — see `computeRosterFallback`.
 */
async function seedLeague(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Insights Bypass Auth',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: YEAR },
  });
  await setAppState('schedule', `${YEAR}-all-all`, { items: [] });
  await saveSeasonArchive(archive(YEAR - 1));
}

type Feed = { insights: { id: string }[] };

function anonymous(query = ''): Request {
  return new Request(`http://localhost/api/insights/${SLUG}${query}`);
}

function asAdmin(query = ''): Request {
  return new Request(`http://localhost/api/insights/${SLUG}${query}`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
}

const call = (req: Request): Promise<Response> =>
  GET(req, { params: Promise.resolve({ slug: SLUG }) });

async function insightIds(res: Response): Promise<string[]> {
  const payload = (await res.json()) as Feed;
  return payload.insights.map((i) => i.id);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();

  savedGenerators = [...getRegisteredGenerators()];
  clearGenerators();
  registerGenerator(standInGenerator);
  registerGenerator(countingGenerator);
  generatorInvocations = 0;

  savedToken = process.env.ADMIN_API_TOKEN;
  // The DEPLOYED configuration: `vercel env ls` shows ADMIN_API_TOKEN set for
  // both Production and Preview. The unset case is a separate test below.
  process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;

  await seedLeague();
});

test.afterEach(() => {
  clearGenerators();
  for (const g of savedGenerators) registerGenerator(g);
  if (savedToken === undefined) delete process.env.ADMIN_API_TOKEN;
  else process.env.ADMIN_API_TOKEN = savedToken;
});

// ---------------------------------------------------------------------------
// The control FIRST: this fixture really does yield bypassed content, so every
// absence asserted below is the guard's doing and not the fixture's.
// ---------------------------------------------------------------------------

test('CONTROL: an admin passing ?bypassSuppression=1 receives the engine-gated insight', async () => {
  const res = await call(asAdmin('?bypassSuppression=1'));
  assert.equal(res.status, 200);
  assert.ok(
    (await insightIds(res)).includes(BYPASSED_INSIGHT_ID),
    'the fixture must be able to produce bypassed content, or every assertion below is vacuous'
  );
});

test('CONTROL: the same fixture withholds it when nobody asks for the bypass', async () => {
  const res = await call(asAdmin());
  assert.equal(res.status, 200);
  assert.ok(!(await insightIds(res)).includes(BYPASSED_INSIGHT_ID));
});

// ---------------------------------------------------------------------------
// THE REGRESSION TEST. Red on this branch's parent, where the route reads the
// parameter straight off the query string behind the league gate.
// ---------------------------------------------------------------------------

test('#627: an anonymous caller on a PASSWORDLESS league is refused the bypass', async () => {
  const res = await call(anonymous('?bypassSuppression=1'));
  assert.equal(res.status, 401, 'league access alone must never lift suppression');
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'admin-token-required');
});

test('#627: the refusal never reaches the uncached build — no generator runs at all', async () => {
  generatorInvocations = 0;
  const refused = await call(anonymous('?bypassSuppression=1'));
  assert.equal(refused.status, 401);
  assert.equal(
    generatorInvocations,
    0,
    'a refusal that still built the feed would be indistinguishable in the response'
  );

  // POSITIVE CONTROL for the counter itself: the same counter must move when a
  // request IS served, or "0" above would prove nothing about the guard.
  const served = await call(anonymous());
  assert.equal(served.status, 200);
  assert.ok(generatorInvocations > 0, 'the invocation counter must be able to move');
});

test('#627: a wrong admin token is refused, not merely a missing one', async () => {
  const res = await call(
    new Request(`http://localhost/api/insights/${SLUG}?bypassSuppression=1`, {
      headers: { 'x-admin-token': 'not-the-token' },
    })
  );
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, 'admin-token-invalid');
});

// ---------------------------------------------------------------------------
// This is an AUTHORIZATION change, not an insights change.
// ---------------------------------------------------------------------------

test('#627: a caller NOT passing the parameter is served identically, admin or not', async () => {
  const anon = await call(anonymous());
  const admin = await call(asAdmin());
  assert.equal(anon.status, 200);
  assert.equal(admin.status, 200);

  const a = (await anon.json()) as Record<string, unknown>;
  const b = (await admin.json()) as Record<string, unknown>;
  // `generatedAt` is a request-time clock read and is expected to differ.
  delete a.generatedAt;
  delete b.generatedAt;
  assert.deepEqual(a, b);
});

test('#627: an anonymous caller NOT passing the parameter still gets the ordinary feed', async () => {
  const res = await call(anonymous());
  assert.equal(res.status, 200);
  assert.ok(!(await insightIds(res)).includes(BYPASSED_INSIGHT_ID));
});

test('#627: an unrelated query parameter does not trip the guard', async () => {
  const res = await call(anonymous(`?year=${YEAR}`));
  assert.equal(res.status, 200);
});

test('#627: only the exact value `1` requests the bypass, and it is guarded', async () => {
  // `=true` is not the bypass and must be served as an ordinary request, exactly
  // as before — the parse is unchanged and this pins that the guard did not widen it.
  const notBypass = await call(anonymous('?bypassSuppression=true'));
  assert.equal(notBypass.status, 200);
  assert.ok(!(await insightIds(notBypass)).includes(BYPASSED_INSIGHT_ID));
});

// ---------------------------------------------------------------------------
// The environment axis. Receipt item 1, pinned so it cannot change silently.
// ---------------------------------------------------------------------------

test('ENVIRONMENT: with ADMIN_API_TOKEN unset outside production the shared helper authorizes anyone', async () => {
  // NOT an endorsement — a pin. `isAuthorizedAdminRequest` returns
  // `!isProductionRuntime()` when no token is configured, so on a local dev server
  // with no token this guard admits an anonymous caller. AGENTS.md Auth invariant 5
  // forbids narrowing that fallback here, and `vercel env ls` shows the token IS
  // configured for both Production and Preview, so no deployed surface is in this
  // state. If that fallback is ever removed (invariant 5's planned sunset), this
  // test fails and says so rather than the behaviour changing unnoticed.
  delete process.env.ADMIN_API_TOKEN;
  assert.notEqual(process.env.NODE_ENV, 'production');

  const res = await call(anonymous('?bypassSuppression=1'));
  assert.equal(res.status, 200);
  assert.ok(
    (await insightIds(res)).includes(BYPASSED_INSIGHT_ID),
    'the no-token fallback authorizes outside production — documented, not endorsed'
  );
});

test('ENVIRONMENT: with ADMIN_API_TOKEN unset IN production the guard refuses', async () => {
  // NOT driven through the route, and the reason is worth stating: under
  // `NODE_ENV=production` the app-state store refuses the file fallback outright
  // (`DATABASE_URL is required for shared durable app state in production`), so
  // `isAuthorizedForLeague` throws before the guard is reached. Asserting a 401
  // through the route here would be asserting a store failure.
  //
  // The guard IS `requireAdminAuth(req)`, so exercising it directly tests the
  // exact predicate the route delegates to, on the one axis the route cannot
  // reach — the other side of the branch the test above pins.
  delete process.env.ADMIN_API_TOKEN;
  const previousNodeEnv = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = 'production';
  try {
    const refusal = await requireAdminAuth(anonymous('?bypassSuppression=1'));
    assert.ok(refusal, 'production with no token configured must not authorize');
    assert.equal(refusal.status, 401);
    assert.equal(
      ((await refusal.json()) as { error: string }).error,
      'admin-token-server-misconfigured'
    );
  } finally {
    if (previousNodeEnv === undefined)
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = previousNodeEnv;
  }
});

test('ENVIRONMENT CONTROL: the same direct call authorizes a valid token in production', async () => {
  // Proves the assertion above fired on the MISSING TOKEN and not on
  // `NODE_ENV=production` alone.
  const previousNodeEnv = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = 'production';
  try {
    assert.equal(await requireAdminAuth(asAdmin('?bypassSuppression=1')), null);
  } finally {
    if (previousNodeEnv === undefined)
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = previousNodeEnv;
  }
});

test('ENVIRONMENT: the two tests above restore NODE_ENV by DELETING it, not by assigning undefined', () => {
  // `process.env.X = undefined` coerces to the five-character string
  // `"undefined"`, which is truthy and is not `'production'` — so every
  // `=== 'development'` / `=== 'test'` branch in any transitively imported module
  // flips for whatever runs next. Harmless only while those two tests are LAST in
  // the file, which is not a property a file keeps. Red before the fix.
  assert.notEqual(process.env.NODE_ENV, 'undefined');
});
