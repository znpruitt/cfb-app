import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../route';
import { PATCH } from '../[slug]/route';
import { maxCreatableSeasonYear, MIN_SEASON_YEAR, type League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — new leagues are born with an explicit lifecycle status:
// creation persists a synchronized `year` + `status: { state:'season', year }`
// in the same registry record, so no new missing-status league can exist.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-token';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function createRequest(body: unknown): Request {
  return new Request('https://example.com/api/admin/leagues', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify(body),
  });
}

function PATCH_FOR_TEST(slug: string, body: unknown) {
  return PATCH(
    new Request(`https://example.com/api/admin/leagues/${slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) }
  );
}

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
}

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
});

test('league creation persists synchronized year and status in one record', async () => {
  const res = await POST(
    createRequest({ slug: 'my-league', displayName: 'My League', year: 2026 })
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { league: League };
  assert.equal(body.league.year, 2026);
  assert.deepEqual(body.league.status, { state: 'season', year: 2026 });

  const record = await getAppState<League[]>('leagues', 'registry');
  const stored = record?.value?.[0];
  assert.equal(stored?.year, 2026);
  assert.deepEqual(stored?.status, { state: 'season', year: 2026 });
  assert.equal(body.league.foundedYear, new Date(body.league.createdAt).getUTCFullYear());
});

test('league creation accepts both supported year boundaries', async () => {
  const currentMaximum = maxCreatableSeasonYear(Date.now());

  const minimum = await POST(
    createRequest({ slug: 'minimum-year', displayName: 'Minimum', year: MIN_SEASON_YEAR })
  );
  assert.equal(minimum.status, 201);

  const maximum = await POST(
    createRequest({ slug: 'maximum-year', displayName: 'Maximum', year: currentMaximum })
  );
  assert.equal(maximum.status, 201);
});

test('league creation rejects unsupported or non-integer years without a registry write', async () => {
  const currentMaximum = maxCreatableSeasonYear(Date.now());
  const invalidYears = [MIN_SEASON_YEAR - 1, currentMaximum + 1, 2026.5, 'not-a-year'];

  for (const [index, year] of invalidYears.entries()) {
    const response = await POST(
      createRequest({ slug: `invalid-year-${index}`, displayName: 'Invalid', year })
    );
    assert.equal(response.status, 400);
    assert.match(await response.text(), /integer season year/);
  }

  assert.equal(await getAppState<League[]>('leagues', 'registry'), null);
});

test('league creation rejects the aliases slug that collides with the static admin route', async () => {
  const response = await POST(
    createRequest({ slug: 'aliases', displayName: 'Unreachable League', year: 2026 })
  );

  assert.equal(response.status, 400);
  assert.match(await response.text(), /Slug is reserved/);
  assert.equal(await getAppState<League[]>('leagues', 'registry'), null);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2I — a slug whose previous occupant's data is still stored.
//
// Deleting a league removes ONE registry entry; every scope keyed by the slug
// survives. Creating a new league at that slug would attach the previous
// league's rosters, drafts, and archives to it — one set of people's names shown
// to a commissioner with no relationship to them.
// ---------------------------------------------------------------------------

test('creation refuses a slug whose previous league data survives', async () => {
  await setAppState('leagues', 'registry', []);
  // Two DIFFERENT scope families, so the check cannot pass on the strength of
  // one remembered prefix.
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team\nDana,Alabama');
  await setAppState('draft:ghost', '2024', { phase: 'complete' });

  const res = await POST(createRequest({ slug: 'ghost', displayName: 'Ghost', year: 2025 }));

  assert.equal(res.status, 409);
  const text = await res.text();
  assert.match(text, /Stored data still exists/i);
  assert.deepEqual(await readRegistry(), [], 'no league was created');
});

// POSITIVE CONTROL — without this, "refused" could mean the check rejects
// everything, and the test above would pass against a guard that is simply
// broken.
test('creation still succeeds for a slug with no surviving data', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team\nDana,Alabama');

  const res = await POST(createRequest({ slug: 'fresh', displayName: 'Fresh', year: 2025 }));

  assert.equal(res.status, 201);
  assert.deepEqual(
    (await readRegistry()).map((l) => l.slug),
    ['fresh'],
    'an unrelated slug is unaffected by another slug`s residue'
  );
});

// REGRESSION TEST — the prefix hazard. `owners:tsc` is a PREFIX of
// `owners:tsc-old:2025`, so a naive prefix match would report that `tsc` has
// residual data because an unrelated league named `tsc-old` exists — blocking a
// slug for no reason, which looks identical to the guard working.
test('residue detection does not confuse a slug with a longer sibling slug', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:tsc-old:2024', 'csv', 'Owner,Team\nDana,Alabama');
  await setAppState('draft:tsc-old', '2024', { phase: 'complete' });

  const res = await POST(createRequest({ slug: 'tsc', displayName: 'TSC', year: 2025 }));

  assert.equal(res.status, 201, 'tsc is clean; tsc-old`s data is not tsc`s');
  assert.deepEqual(
    (await readRegistry()).map((l) => l.slug),
    ['tsc']
  );
});

// The two 409s are different conditions — a league EXISTS vs a league's REMAINS
// exist — and must stay distinguishable.
test('a live-slug conflict reads differently from a residual-data conflict', async () => {
  await setAppState('leagues', 'registry', []);
  const created = await POST(createRequest({ slug: 'alpha', displayName: 'Alpha', year: 2025 }));
  assert.equal(created.status, 201);

  const live = await POST(createRequest({ slug: 'alpha', displayName: 'Alpha 2', year: 2025 }));
  assert.equal(live.status, 409);
  const liveText = await live.text();
  assert.match(liveText, /already exists/i);
  assert.ok(
    !/Stored data still exists/i.test(liveText),
    'the live conflict is not reported as residue'
  );
});

// REGRESSION TEST — the refusal must not be a DEAD END.
//
// Nothing in the app deletes league-scoped records, so a blanket refusal would
// burn the slug forever. Worse, re-creating at the same slug is how an
// ACCIDENTAL delete was recovered, and the demo league's slug is a hardcoded
// constant whose only creation path is this route — a permanent refusal would
// have left no way back.
test('an explicit adopt acknowledgement lets the same slug be restored', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team\nDana,Alabama');

  const refused = await POST(createRequest({ slug: 'ghost', displayName: 'G', year: 2025 }));
  assert.equal(refused.status, 409, 'not by accident');

  const adopted = await POST(
    createRequest({
      slug: 'ghost',
      displayName: 'G',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: 2019,
    })
  );
  assert.equal(adopted.status, 201, 'but possible on purpose');
  // PLATFORM-086F2J — a restoration restores the FOUNDING YEAR too. Without
  // this the adoption path brought back rosters and archives while silently
  // stamping the league with the restoration date.
  assert.equal((await readRegistry())[0]!.foundedYear, 2019);
  assert.deepEqual(
    (await readRegistry()).map((l) => l.slug),
    ['ghost']
  );
});

// The demo league is the concrete case: `TEST_LEAGUE_SLUG` is hardcoded, so no
// alternate slug exists, and `resetTestLeagueLifecycle` answers
// `league-not-found` for an absent league. If this POST could not restore it,
// deleting the demo would brick it permanently.
test('the demo slug can be restored after its data has been written', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('draft:test', '2025', { phase: 'complete' });
  await setAppState('preseason-owners:test', '2025', { owners: [] });

  const refused = await POST(createRequest({ slug: 'test', displayName: 'Demo', year: 2025 }));
  assert.equal(refused.status, 409);

  const restored = await POST(
    createRequest({
      slug: 'test',
      displayName: 'Demo',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: 2024,
    })
  );
  assert.equal(restored.status, 201, 'the demo league is recoverable');
  assert.equal((await readRegistry())[0]!.foundedYear, 2024);
});

// The acknowledgement must be the EXPLICIT boolean — a truthy string arriving
// from a form must not satisfy it.
test('only a literal true adopts; a truthy value does not', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');

  const res = await POST(
    createRequest({ slug: 'ghost', displayName: 'G', year: 2025, adoptExistingData: 'yes' })
  );
  assert.equal(res.status, 409, 'a truthy string is not an acknowledgement');
  assert.deepEqual(await readRegistry(), []);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2J — the RECOVERY-ONLY founding year.
//
// Freezing `foundedYear` made restoration silently rewrite it to today. The
// recovery value is narrow by construction: a SEPARATE field name, accepted only
// alongside a deliberate adoption, and refused on ordinary creation — so general
// editing and legacy imports stay closed.
// ---------------------------------------------------------------------------

test('restoreFoundedYear is refused on ordinary creation', async () => {
  await setAppState('leagues', 'registry', []);

  const res = await POST(
    createRequest({ slug: 'fresh', displayName: 'Fresh', year: 2025, restoreFoundedYear: 1999 })
  );

  assert.equal(res.status, 400);
  assert.match(await res.text(), /only accepted when adopting/i);
  assert.deepEqual(await readRegistry(), [], 'nothing was created');
});

// REQUIRED rather than defaulted: a restoration that silently invented a
// founding year is the exact defect this closes.
test('adopting without a restore year is refused', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');

  const res = await POST(
    createRequest({ slug: 'ghost', displayName: 'G', year: 2025, adoptExistingData: true })
  );

  assert.equal(res.status, 400);
  assert.match(await res.text(), /required when adopting/i);
  assert.deepEqual(await readRegistry(), [], 'nothing was created');
});

test('a restore year outside the accepted range is refused', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');

  for (const bad of [1899, 2.5, 'nineteen', 99999]) {
    const res = await POST(
      createRequest({
        slug: 'ghost',
        displayName: 'G',
        year: 2025,
        adoptExistingData: true,
        restoreFoundedYear: bad,
      })
    );
    assert.equal(res.status, 400, `expected refusal for ${JSON.stringify(bad)}`);
    assert.deepEqual(await readRegistry(), []);
  }
});

// POSITIVE CONTROL — ordinary creation still DERIVES the value and is
// unaffected, so the refusals above are about the recovery field specifically.
test('ordinary creation still derives the founding year', async () => {
  await setAppState('leagues', 'registry', []);

  const res = await POST(createRequest({ slug: 'fresh', displayName: 'Fresh', year: 2025 }));

  assert.equal(res.status, 201);
  const stored = (await readRegistry())[0]!;
  assert.equal(stored.foundedYear, new Date().getUTCFullYear());
});

// The recovery window closes at creation: PATCH still refuses the field, so a
// restored league cannot then be edited freely.
test('a restored league still cannot have its founding year edited afterwards', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');

  await POST(
    createRequest({
      slug: 'ghost',
      displayName: 'G',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: 2019,
    })
  );

  const res = await PATCH_FOR_TEST('ghost', { foundedYear: 2001 });
  assert.equal(res.status, 409);
  assert.equal((await readRegistry())[0]!.foundedYear, 2019, 'the restored value stands');
});
