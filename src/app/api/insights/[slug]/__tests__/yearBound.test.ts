import assert from 'node:assert/strict';
import test from 'node:test';

import { clearGenerators, getRegisteredGenerators, registerGenerator } from '@/lib/insights/engine';
import type { InsightGenerator, LifecycleState } from '@/lib/insights/types';
import { addLeague } from '@/lib/leagueRegistry';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import { __resetTeamDatabaseStoreForTests } from '@/lib/server/teamDatabaseStore';

import { GET } from '../route';

/**
 * #770 — `?year=` had a floor (`n >= 2000`) and NO ceiling, and the value became
 * cache identity verbatim in TWO places: `insightsCacheKeyParts` and, via
 * `getCanonicalStandings({ year })`, `canonicalStandingsCacheKeyParts`. So every
 * distinct value was a guaranteed miss, a full `buildLeagueInsightContext`, and
 * two new `unstable_cache` entries — the standings one under `revalidate: false`.
 *
 * TWO things have to be pinned here, and the second is what makes the first mean
 * anything. A 400 is trivial to assert and would pass on a fixture that could
 * never have built anything, so every refusal below is paired with a control
 * proving the SAME fixture serves a legitimate year and DOES run the build.
 *
 * `buildInvocations` is what makes "no rebuild" an OBSERVATION rather than an
 * inference from a status code: a refusal that still ran the build would look
 * identical in the response body.
 */

const ALL_LIFECYCLES: LifecycleState[] = [
  'preseason',
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
];

let buildInvocations = 0;
const buildProbe: InsightGenerator = {
  id: 'narrative:year-bound-probe',
  category: 'narrative',
  supportedLifecycles: ALL_LIFECYCLES,
  tone: 'factual',
  generate(): ReturnType<InsightGenerator['generate']> {
    buildInvocations += 1;
    return [] as ReturnType<InsightGenerator['generate']>;
  },
};

let savedGenerators: readonly InsightGenerator[] = [];

/**
 * Derived from the clock at run time, never written as a literal: the bound is
 * `maxCreatableSeasonYear(now)` = `currentYear + 1`, so a pinned year would make
 * these tests expire — exactly what `npm run test:clock-shift` exists to catch.
 */
function currentYear(): number {
  return new Date().getUTCFullYear();
}

const ABSURD_A = 987654321;
const ABSURD_B = 987654322;

async function seedLeague(slug: string, year: number): Promise<void> {
  await addLeague({
    slug,
    displayName: `Year Bound ${slug}`,
    year,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year },
  });
  await setAppState(`owners:${slug}:${year}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${year}-all-all`, { items: [] });
}

function anonymous(slug: string, query = ''): Request {
  return new Request(`http://localhost/api/insights/${slug}${query}`);
}

function call(slug: string, query = ''): Promise<Response> {
  return GET(anonymous(slug, query), { params: Promise.resolve({ slug }) });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  savedGenerators = getRegisteredGenerators();
  clearGenerators();
  registerGenerator(buildProbe);
  buildInvocations = 0;
});

test.afterEach(() => {
  clearGenerators();
  for (const generator of savedGenerators) registerGenerator(generator);
});

test('an absurd year is refused, and the refusal runs NO build', async () => {
  const slug = 'year-bound-refusal';
  await seedLeague(slug, currentYear());

  const res = await call(slug, `?year=${ABSURD_A}`);
  const body = (await res.json()) as { error?: string; field?: string };

  assert.equal(res.status, 400);
  assert.equal(body.field, 'year');
  assert.match(body.error ?? '', /^year must be an integer between 2000 and \d{4}$/);
  assert.equal(buildInvocations, 0, 'the refusal must not have built a league context');
});

test('CONTROL: the SAME fixture serves a legitimate year and DOES build', async () => {
  const slug = 'year-bound-refusal';
  await seedLeague(slug, currentYear());

  const res = await call(slug, `?year=${currentYear()}`);

  assert.equal(res.status, 200);
  assert.ok(
    buildInvocations > 0,
    'without this the refusal above could pass on a fixture that never builds'
  );
});

test('two distinct absurd years mint no cache identity and cost no rebuild', async () => {
  const slug = 'year-bound-cardinality';
  await seedLeague(slug, currentYear());

  const first = await call(slug, `?year=${ABSURD_A}`);
  const second = await call(slug, `?year=${ABSURD_B}`);

  assert.equal(first.status, 400);
  assert.equal(second.status, 400);
  assert.equal(
    buildInvocations,
    0,
    'each distinct year previously forced a build and two new unstable_cache entries'
  );
});

test('an omitted year still resolves the operating season — the default request is never bounded', async () => {
  const slug = 'year-bound-default';
  await seedLeague(slug, currentYear());

  const omitted = await call(slug);
  const empty = await call(slug, '?year=');

  assert.equal(omitted.status, 200);
  assert.equal(empty.status, 200, 'an empty value is absent, not invalid');
});

test('ROLLOVER: next season — the widest year the registry can hold — is served', async () => {
  const slug = 'year-bound-rollover';
  const nextSeason = currentYear() + 1;
  await seedLeague(slug, currentYear());

  const res = await call(slug, `?year=${nextSeason}`);

  assert.equal(res.status, 200, 'a bound that refuses next season breaks preseason rollover');
  assert.ok(buildInvocations > 0);
});

test('THE DISJUNCT: a league whose operating year exceeds the ceiling is still served its own year', async () => {
  const beyond = currentYear() + 5;

  // The league whose OWN operating year is the out-of-range value.
  const ownSlug = 'year-bound-beyond-own';
  await seedLeague(ownSlug, beyond);
  const own = await call(ownSlug, `?year=${beyond}`);

  // MUTATION CONTROL: the identical year against a league operating normally.
  // Without this, the pass above could mean the ceiling is simply wider than
  // `currentYear + 1` rather than that the disjunct fired.
  const otherSlug = 'year-bound-beyond-other';
  await seedLeague(otherSlug, currentYear());
  const other = await call(otherSlug, `?year=${beyond}`);

  assert.equal(own.status, 200, 'a league must never be refused its own operating year');
  assert.equal(
    other.status,
    400,
    'the same year is out of range for a league that does not hold it'
  );
});

test('a padded year is served, not refused — emptiness and validity read the SAME trimmed value', async () => {
  const slug = 'year-bound-padded';
  await seedLeague(slug, currentYear());

  // The first cut trimmed for the emptiness check but tested the UNTRIMMED
  // value for validity, so these two disagreed: whitespace alone was absent
  // (200) while whitespace around a good year was a hard 400 that
  // `Number.parseInt` had served before #770. Padding is not the defect.
  const padded = await call(slug, `?year=%20${currentYear()}%20`);
  const whitespaceOnly = await call(slug, '?year=%20');

  assert.equal(padded.status, 200, 'a padded but legitimate year must still be served');
  assert.equal(whitespaceOnly.status, 200, 'whitespace alone is absent, as an empty value is');
  assert.ok(buildInvocations > 0, 'and the padded request really did resolve to a real season');
});

test('BEHAVIOUR CHANGE, pinned: a sub-2000 year is now a 400 rather than a silent fallback', async () => {
  const slug = 'year-bound-floor';
  await seedLeague(slug, currentYear());

  const res = await call(slug, '?year=1999');

  assert.equal(res.status, 400, 'this returned 200 with the operating year before #770');
  assert.equal(buildInvocations, 0);
});

test('a non-numeric year, and one with trailing junk, are both refused', async () => {
  const slug = 'year-bound-nonnumeric';
  await seedLeague(slug, currentYear());

  const words = await call(slug, '?year=nonsense');
  const trailing = await call(slug, `?year=${currentYear()}nonsense`);

  assert.equal(words.status, 400);
  assert.equal(trailing.status, 400, 'Number.parseInt read this as a valid year before #770');
  assert.equal(buildInvocations, 0);
});

test('#627 UNCHANGED: the bypass refusal still precedes the year bound', async () => {
  const slug = 'year-bound-bypass-order';
  await seedLeague(slug, currentYear());

  const savedToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = 'test-admin-token-770';
  try {
    // An anonymous caller passing BOTH an absurd year and the admin-only
    // parameter must still meet #627's refusal — answering it with a 400 would
    // change that slice's refusal surface.
    const res = await call(slug, `?year=${ABSURD_A}&bypassSuppression=1`);
    assert.equal(res.status, 401, 'the bypass guard must run before the year bound');
    assert.equal(buildInvocations, 0);
  } finally {
    if (savedToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = savedToken;
  }
});
