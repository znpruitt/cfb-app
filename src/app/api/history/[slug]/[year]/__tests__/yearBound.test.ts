import assert from 'node:assert/strict';
import test from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';

import { GET } from '../route';

/**
 * #774 — the history route's caller-supplied year bound.
 *
 * WHAT MAKES THE REFUSALS HERE MEAN SOMETHING. A 400 is trivial to assert and
 * would pass against a league that could never have served anything, so every
 * refusal below is paired with a control proving the SAME fixture serves a
 * legitimate year — including `tsc`'s real oldest archive, 2018, not just the
 * current one.
 *
 * And the sharpest control is the planted fractional archive: an archive
 * genuinely EXISTS at store key `2026.5`, so before this slice the route found
 * it and returned 200, minting `season-archive/<slug>/2026.5` under
 * `revalidate: false`. A bound that resolved the year but happened to 404 would
 * be indistinguishable from one that refused it — unless the thing at that key
 * is really there.
 */

const SLUG = 'history-year-bound';
const OPERATING_YEAR = 2026;

async function plantArchive(slug: string, key: string): Promise<void> {
  await setAppState(`standings-archive:${slug}`, key, {
    leagueSlug: slug,
    year: Number(key),
    archivedAt: '2026-01-01T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\nTexas,Alice\n',
    // The full `StandingsHistory` shape — `weeks`, `byWeek` AND `byOwner`. A
    // thinner fixture throws inside `selectSeasonSuperlatives` before anything
    // renders, which would leave every "refused" assertion in this file passing
    // while no control could ever prove the page serves a legitimate year.
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  });
}

/** Passwordless, so `isAuthorizedForLeague` admits before it needs a cookie. */
async function seedLeague(slug: string, year = OPERATING_YEAR): Promise<void> {
  await addLeague({
    slug,
    displayName: `History Year Bound ${slug}`,
    year,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year },
  });
}

function call(slug: string, year: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/history/${slug}/${year}`), {
    params: Promise.resolve({ slug, year }),
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('MUTATION: a planted fractional archive is refused, not served', async () => {
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2026.5');

  const res = await call(SLUG, '2026.5');
  const body = (await res.json()) as { error?: string; field?: string };

  assert.equal(res.status, 400, 'this returned 200 with the archive body before #774');
  assert.equal(body.field, 'year');
  assert.match(body.error ?? '', /year must be an integer/);
});

test('CONTROL: the SAME fixture serves the oldest archive, so the refusal is the bound', async () => {
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2026.5');
  await plantArchive(SLUG, '2018');

  const res = await call(SLUG, '2018');
  const body = (await res.json()) as { year?: number };

  assert.equal(res.status, 200, "tsc's real oldest archive must never be refused");
  assert.equal(body.year, 2018);
});

test('CONTROL: the operating year is served, and it is the ceiling', async () => {
  await seedLeague(SLUG);
  await plantArchive(SLUG, String(OPERATING_YEAR));

  const served = await call(SLUG, String(OPERATING_YEAR));
  const beyond = await call(SLUG, String(OPERATING_YEAR + 1));

  assert.equal(served.status, 200);
  assert.equal(beyond.status, 400, 'an archive of a season that has not finished cannot exist');
});

test('CARDINALITY: distinct dense years all refuse, and none reaches the cache key', async () => {
  await seedLeague(SLUG);
  // Every one of these was a 200-or-404 that minted its own `revalidate: false`
  // entry. Measured before the fix: 11 requests, 8 entries on disk.
  for (const year of ['2026.5', '2026.6', '2026.0000001', '2e10', '0x7E0', '2025.999']) {
    const res = await call(SLUG, year);
    assert.equal(res.status, 400, `${year} must be refused`);
  }
});

test('A GAP YEAR IN RANGE IS A 404, NOT A 400 — "no archive" and "bad year" are different answers', async () => {
  // `tsc` genuinely has holes at 2019 and 2020. This is the case that rules out
  // bounding on the archive list alone, and the answer must stay the one the
  // route already gave: plain text, 404.
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2018');
  await plantArchive(SLUG, '2021');

  const res = await call(SLUG, '2019');

  assert.equal(res.status, 404);
  assert.equal(await res.text(), `No archive found for ${SLUG} season 2019`);
});

test('THE DISJUNCT: an archive above the operating year is still served', async () => {
  // A legacy record whose top-level year sits below its own newest archive.
  const desynced = 'history-year-bound-desynced';
  await seedLeague(desynced, 2020);
  await plantArchive(desynced, '2024');

  const held = await call(desynced, '2024');
  assert.equal(held.status, 200, 'a league must never be refused a season it holds');

  // MUTATION CONTROL: identical year, identical league, archive absent. Without
  // it the pass above could mean the ceiling is simply wider than the operating
  // year rather than that the disjunct fired.
  const notHeld = await call(desynced, '2025');
  assert.equal(notHeld.status, 400);
});

test('a padded but legitimate year is still served', async () => {
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2024');

  // Measured before the fix: this returned 200 and collapsed onto the same cache
  // entry as the bare year, so refusing it would be an unreviewed second change.
  const res = await call(SLUG, ' 2024 ');
  assert.equal(res.status, 200);
});

test('ORDER PRESERVED: an unknown league still 404s with an empty body, never a 400', async () => {
  // `getLeague` moved ABOVE the year check so the bound can read the operating
  // year. This pins that the auth gate still answers first: a 400 here would
  // confirm the league exists to an unauthorized caller, which is exactly what
  // the 404 blend exists to prevent.
  const res = await call('no-such-league', '2026.5');

  assert.equal(res.status, 404);
  assert.equal(await res.text(), '', 'the gate returns a null body; the route 404 has text');
});

test('a non-numeric year is refused with the JSON shape, not the old plain text', async () => {
  await seedLeague(SLUG);

  const res = await call(SLUG, 'nonsense');
  const body = (await res.json()) as { error?: string; field?: string };

  assert.equal(res.status, 400);
  assert.equal(
    res.headers.get('content-type'),
    'application/json',
    'matches #770 so AGENTS.md invariant 4 describes one rule, not two'
  );
  assert.equal(body.field, 'year');
});

test('BEHAVIOUR PRESERVED: a sub-2000 year is still a 400', async () => {
  await seedLeague(SLUG);
  const res = await call(SLUG, '1999');
  assert.equal(res.status, 400, 'the floor predates #774 and is unchanged');
});
