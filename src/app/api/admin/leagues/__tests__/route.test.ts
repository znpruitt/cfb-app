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

test('a new league is born in PRESEASON, for the derived season year', async () => {
  // PLATFORM-093 — a league with no owners, no roster and no draft is setting up,
  // not in season. `season` asserted otherwise and, because every setup surface is
  // gated on `preseason`, left a new league unable to confirm owners at all.
  const expectedYear = new Date().getUTCFullYear();
  const res = await POST(createRequest({ slug: 'my-league', displayName: 'My League' }));
  const body = (await res.json()) as { league: League };
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.league.year, expectedYear);
  assert.deepEqual(body.league.status, { state: 'preseason', year: expectedYear });

  const record = await getAppState<League[]>('leagues', 'registry');
  const stored = record?.value?.[0];
  assert.equal(stored?.year, expectedYear);
  assert.deepEqual(stored?.status, { state: 'preseason', year: expectedYear });
  assert.equal(body.league.foundedYear, new Date(body.league.createdAt).getUTCFullYear());
});

test('ordinary creation REFUSES a supplied season year', async () => {
  // There is only ever one season in play, so there was never a choice to offer —
  // and accepting one invited a league to be created for a season it will never
  // play. Mirrors `restoreFoundedYear`: a value the adopting path states and the
  // ordinary path may not send.
  const res = await POST(
    createRequest({ slug: 'supplied-year', displayName: 'Supplied', year: 2026 })
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /derives the season year and accepts no value/i);

  const record = await getAppState<League[]>('leagues', 'registry');
  assert.equal(record?.value?.length ?? 0, 0, 'a refused creation writes nothing');
});

test('a supplied year is still refused when it happens to be correct', async () => {
  // The refusal is about the CONTRACT, not the value. Accepting a "correct" year
  // would leave the field alive and the next caller free to send a wrong one.
  const res = await POST(
    createRequest({
      slug: 'right-year',
      displayName: 'Right',
      year: new Date().getUTCFullYear(),
    })
  );
  assert.equal(res.status, 400);
});

test('adoption still requires a year, and still validates its range', async () => {
  // Adoption re-attaches a record to data that already exists for a particular
  // season, so it must state which — deriving today's year would file 2024
  // material under this season with no way to correct it (`updateLeague` and
  // `PATCH` both refuse `year`). Residue has to exist for adoption to be reachable
  // at all, so seed some.
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:revived:2024', 'csv', 'Owner,Team\nDana,Alabama');

  const omitted = await POST(
    createRequest({
      slug: 'revived',
      displayName: 'Revived',
      adoptExistingData: true,
      restoreFoundedYear: null,
    })
  );
  assert.equal(omitted.status, 400);
  assert.match(await omitted.text(), /year is required when adopting/i);

  const currentMaximum = maxCreatableSeasonYear(Date.now());
  for (const year of [MIN_SEASON_YEAR - 1, currentMaximum + 1, 2026.5, 'not-a-year']) {
    const response = await POST(
      createRequest({
        slug: 'revived',
        displayName: 'Revived',
        year,
        adoptExistingData: true,
        restoreFoundedYear: null,
      })
    );
    assert.equal(response.status, 400, String(year));
    assert.match(await response.text(), /integer season year/, String(year));
  }

  assert.deepEqual(await readRegistry(), [], 'no league was created on any refused path');
});

test('adoption files the league under the season it states, not the current one', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:revived:2024', 'csv', 'Owner,Team\nDana,Alabama');

  const res = await POST(
    createRequest({
      slug: 'revived',
      displayName: 'Revived',
      year: 2024,
      adoptExistingData: true,
      restoreFoundedYear: 2019,
    })
  );
  const body = (await res.json()) as { league: League };
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.league.year, 2024, 'the stated season, not the derived one');
  assert.equal(body.league.foundedYear, 2019);
});

test('adoption keeps its `season` seed, and stays out of the transition cron', async () => {
  // Seeding adoption `preseason` looked harmless and was not. The
  // season-transition cron selects on `status.state === 'preseason'` and groups
  // by `status.year`, so a restored 2024 league would enrol 2024 as a target:
  // `shouldFetch` is unconditionally true for a season that old
  // (`now >= firstGameDate - 7d`), buying a billed regular + postseason CFBD
  // refetch, a durable re-commit of that season's schedule, and a standings
  // invalidation — for a restoration that previously cost nothing.
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:revived:2024', 'csv', 'Owner,Team\nDana,Alabama');

  const res = await POST(
    createRequest({
      slug: 'revived',
      displayName: 'Revived',
      year: 2024,
      adoptExistingData: true,
      restoreFoundedYear: null,
    })
  );
  const body = (await res.json()) as { league: League };
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.deepEqual(body.league.status, { state: 'season', year: 2024 });
  assert.notEqual(
    body.league.status.state,
    'preseason',
    'a restored past season must not become a transition target'
  );
});

test('league creation rejects the aliases slug that collides with the static admin route', async () => {
  const response = await POST(
    createRequest({ slug: 'aliases', displayName: 'Unreachable League' })
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

  const res = await POST(createRequest({ slug: 'ghost', displayName: 'Ghost' }));

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

  const res = await POST(createRequest({ slug: 'fresh', displayName: 'Fresh' }));

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

  const res = await POST(createRequest({ slug: 'tsc', displayName: 'TSC' }));

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
  const created = await POST(createRequest({ slug: 'alpha', displayName: 'Alpha' }));
  assert.equal(created.status, 201);

  const live = await POST(createRequest({ slug: 'alpha', displayName: 'Alpha 2' }));
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

  const refused = await POST(createRequest({ slug: 'ghost', displayName: 'G' }));
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

  const res = await POST(createRequest({ slug: 'fresh', displayName: 'Fresh' }));

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

// ---------------------------------------------------------------------------
// PLATFORM-086F2J round 2 — `adoptExistingData` was SELF-JUSTIFYING.
//
// The flag suppressed the residue scan, so nothing ever established that there
// was anything to adopt. That made the recovery-only founding year reachable on
// any clean slug — the arbitrary founding-year-at-creation this field exists to
// keep shut — and it meant a stale flag carried over from a slug the operator
// HAD been warned about skipped the guard for one they had not.
// ---------------------------------------------------------------------------

test('adopting a slug that holds nothing is refused', async () => {
  await setAppState('leagues', 'registry', []);

  const res = await POST(
    createRequest({
      slug: 'brand-new',
      displayName: 'Brand New',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: 1998,
    })
  );

  assert.equal(res.status, 400, 'there is nothing to adopt');
  assert.match(await res.text(), /nothing to adopt/i);
  assert.deepEqual(await readRegistry(), [], 'and no league was created');
});

// POSITIVE CONTROL — the identical request succeeds once residue exists, so the
// refusal above is about the absent data and not about the payload shape.
test('the same adoption succeeds when data actually survives', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:brand-new:2024', 'csv', 'Owner,Team\nDana,Alabama');

  const res = await POST(
    createRequest({
      slug: 'brand-new',
      displayName: 'Brand New',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: 1998,
    })
  );

  assert.equal(res.status, 201);
  assert.equal((await readRegistry())[0]!.foundedYear, 1998);
});

// REGRESSION TEST — the stale-acknowledgement path, end to end at the route.
// Residue exists for `ghost`; the operator ticks adopt for it, then changes the
// slug to `other` and submits. `other` was never surveyed and never refused, so
// adopting it must fail rather than silently attach a founding year to a league
// nobody was warned about.
test('an acknowledgement earned on one slug does not carry to another', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team\nDana,Alabama');

  assert.equal(
    (await POST(createRequest({ slug: 'ghost', displayName: 'G' }))).status,
    409,
    'ghost is the slug that earned the acknowledgement'
  );

  const res = await POST(
    createRequest({
      slug: 'other',
      displayName: 'Other',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: 1998,
    })
  );

  assert.equal(res.status, 400, 'a different slug does not inherit it');
  assert.deepEqual(await readRegistry(), []);
});

// PLATFORM-086F2J round 2 — "no recorded founding year" must stay expressible.
// `foundedYear` is optional and leagues predating the field carry none. Since
// adoption REQUIRES the value and the freeze then makes it permanent, a required
// integer would force the operator to invent one — the exact fabrication this
// field exists to prevent. `null` says "none recorded"; omission still fails.
test('a restored league may explicitly have no founding year', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');

  const res = await POST(
    createRequest({
      slug: 'ghost',
      displayName: 'G',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: null,
    })
  );

  assert.equal(res.status, 201);
  const restored = (await readRegistry())[0]!;
  assert.equal(restored.foundedYear, undefined, 'absent, not invented');
  assert.ok(!('foundedYear' in restored) || restored.foundedYear === undefined);
});

// CONTRACT PIN — omitting the field is still an error, so `null` is a deliberate
// statement rather than a synonym for "I did not say".
test('null is distinct from omitting the restore year', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');

  const res = await POST(
    createRequest({ slug: 'ghost', displayName: 'G', year: 2025, adoptExistingData: true })
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /required when adopting/i);
});

// PLATFORM-086F2J round 2 — the ceiling is the CURRENT year, not the season
// horizon. `maxCreatableSeasonYear` is `currentYear + 1` because it bounds which
// SEASON may be created; a founding year is when the league came into existence,
// so a future one restores nothing — and PATCH would then freeze it forever.
test('a founding year in the future is refused even though that season is creatable', async () => {
  await setAppState('leagues', 'registry', []);
  await setAppState('owners:ghost:2024', 'csv', 'Owner,Team');

  const nextYear = new Date().getUTCFullYear() + 1;
  assert.equal(nextYear, maxCreatableSeasonYear(Date.now()), 'the season horizon does allow it');

  const res = await POST(
    createRequest({
      slug: 'ghost',
      displayName: 'G',
      year: 2025,
      adoptExistingData: true,
      restoreFoundedYear: nextYear,
    })
  );

  assert.equal(res.status, 400, 'but a founding year may not be in the future');
  assert.deepEqual(await readRegistry(), []);
});
