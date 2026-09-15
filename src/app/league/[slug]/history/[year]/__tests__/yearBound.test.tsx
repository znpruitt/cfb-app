import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactElement } from 'react';

import { addLeague } from '@/lib/leagueRegistry';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';

import SeasonDetailPage from '../page';

/**
 * #774 — the history PAGE's caller-supplied year bound.
 *
 * The page is covered separately because it never shared code with the API
 * route: it carried its own `Number(yearStr)` copy of the same broken parser and
 * so shared the defect without sharing a line. Measured before the fix,
 * `/league/<slug>/history/2029.25` and `/2029.75` each rendered 200 and each
 * minted its own `revalidate: false` archive cache entry — the page was an
 * independent second vector, not a mirror of the route.
 *
 * `notFound()` throws, so a refusal is a rejection here and a served year is a
 * resolved render. Every refusal is paired with a render control on the same
 * fixture, because "it threw" is otherwise satisfied by any breakage at all.
 */

const SLUG = 'history-page-year-bound';
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

/** Passwordless, so `renderLeagueGateIfBlocked` returns nothing. */
async function seedLeague(slug: string, year = OPERATING_YEAR): Promise<void> {
  await addLeague({
    slug,
    displayName: `History Page ${slug}`,
    year,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year },
  });
}

function render(slug: string, year: string): Promise<ReactElement> {
  return SeasonDetailPage({ params: Promise.resolve({ slug, year }) });
}

/**
 * Read the SERVER-PRODUCED element tree rather than rendering it, and both
 * reasons are environmental rather than a preference. `LeaguePageShell` pulls in
 * Clerk (`useClerk` throws outside a `<ClerkProvider>`), and the inner subtree
 * carries `HistoryBackLink`, a client component whose `useRouter` throws
 * "invariant expected app router to be mounted". Both were measured, not
 * anticipated — the first cut of this suite rendered, and five tests failed on
 * the harness rather than on the claim.
 *
 * Walking the tree loses nothing this suite needs: the year reaches the page's
 * output as `{year} Season`, as the empty-state sentence, and as a `year` prop on
 * four child components, and all of that is present in the tree the page
 * returns. What it cannot see is anything a child component computes internally,
 * and this suite asserts on none of that.
 */
function collectPageText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectPageText).join('');
  const element = node as { props?: { children?: unknown; year?: unknown } };
  if (!element.props) return '';
  const own = typeof element.props.year === 'number' ? ` year=${element.props.year} ` : '';
  return own + collectPageText(element.props.children);
}

async function pageText(slug: string, year: string): Promise<string> {
  return collectPageText(await render(slug, year));
}

/**
 * A REFUSAL IS `notFound()`, NOT MERELY A REJECTION — review finding, and the
 * distinction is load-bearing here rather than pedantic. `resolveArchiveYearParam`
 * THROWS by design when the archive-list read fails, so a bare `assert.rejects`
 * would stay green if this page started 500-ing on these inputs instead of
 * 404-ing, and the suite would report the bound as working. Digest measured
 * against this Next version rather than assumed: `notFound()` throws an error
 * carrying `NEXT_HTTP_ERROR_FALLBACK;404`.
 */
const NOT_FOUND = /^NEXT_HTTP_ERROR_FALLBACK;404$/;

async function assertNotFound(slug: string, year: string, message: string): Promise<void> {
  await assert.rejects(
    () => render(slug, year),
    (err: unknown) => {
      const digest = (err as { digest?: unknown }).digest;
      assert.match(String(digest), NOT_FOUND, `${message} (got digest ${String(digest)})`);
      return true;
    },
    message
  );
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('MUTATION: a planted fractional archive does NOT render — the page refuses before the read', async () => {
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2026.5');

  await assertNotFound(
    SLUG,
    '2026.5',
    'an archive exists at this key; before #774 the page found it and rendered it'
  );
});

test('CONTROL: the SAME fixture renders the oldest archive', async () => {
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2026.5');
  await plantArchive(SLUG, '2018');

  const html = await pageText(SLUG, '2018');

  assert.match(
    html,
    /2018 Season/,
    'the refusal above must not be the page simply always throwing'
  );
  assert.match(html, / year=2018 /, 'and the resolved year is what reached the archive components');
});

test('THE DESIGNED EMPTY STATE SURVIVES for an in-range gap year', async () => {
  // The reason the ceiling is the operating year and not the archive list. `tsc`
  // genuinely has holes at 2019 and 2020; bounding on the list alone would turn
  // this surface into a `notFound()`.
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2018');
  await plantArchive(SLUG, '2021');

  const html = await pageText(SLUG, '2019');

  assert.match(html, /No archived data found for the 2019 season\./);
  assert.doesNotMatch(html, /Historical data is available from/);
});

test('the operating year renders its empty state, and the year beyond it is refused', async () => {
  await seedLeague(SLUG);

  const atCeiling = await pageText(SLUG, String(OPERATING_YEAR));
  assert.match(atCeiling, new RegExp(`No archived data found for the ${OPERATING_YEAR} season\\.`));

  await assertNotFound(
    SLUG,
    String(OPERATING_YEAR + 1),
    'a year above the ceiling must be a 404, not a crash'
  );
});

test('dense years are refused — each was an independent cache entry on this page', async () => {
  await seedLeague(SLUG);

  for (const year of ['2029.25', '2029.75', '2026.0000001', '2e10', '0x7E0']) {
    await assertNotFound(SLUG, year, `${year} must be refused`);
  }
});

test('THE DISJUNCT: the page serves an archive above the operating year', async () => {
  const desynced = 'history-page-desynced';
  await seedLeague(desynced, 2020);
  await plantArchive(desynced, '2024');

  const html = await pageText(desynced, '2024');
  assert.match(html, /2024 Season/);

  // MUTATION CONTROL: identical league, identical shape, archive absent.
  await assertNotFound(desynced, '2025', 'the disjunct must admit only years actually archived');
});

test('a padded but legitimate year still renders', async () => {
  await seedLeague(SLUG);
  await plantArchive(SLUG, '2024');

  const html = await pageText(SLUG, ' 2024 ');
  assert.match(html, /2024 Season/);
});

test('BEHAVIOUR PRESERVED: a sub-2000 year and a non-numeric one are still refused', async () => {
  await seedLeague(SLUG);

  await assertNotFound(SLUG, '1999', 'the sub-2000 floor predates #774');
  await assertNotFound(SLUG, 'nonsense', 'a non-numeric year was refused before #774 too');
});
