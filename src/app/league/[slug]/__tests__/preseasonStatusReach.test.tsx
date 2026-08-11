import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { ReactElement } from 'react';

import { addLeague } from '@/lib/leagueRegistry';
import { __deleteAppStateFileForTests, __resetAppStateForTests } from '@/lib/server/appStateStore';
import type { CanonicalStandings } from '@/lib/selectors/leagueStandings';
import type { LeagueStatus } from '@/lib/league';

import LeagueRootPage from '../page';
import LeagueMatchupsPage from '../matchups/page';
import LeagueMembersPage from '../members/page';
import LeagueSchedulePage from '../schedule/page';
import LeagueStandingsPage from '../standings/page';

// ---------------------------------------------------------------------------
// PRESEASON-STATUS-BANNER-TRUTHFULNESS
//
// The preseason status banner is rendered by CFBScheduleApp, so it reaches a
// surface only if that route hands the component BOTH facts it decides from:
// the lifecycle status and the canonical standings snapshot. Matchups and
// Members passed the snapshot but not the status, so a preseason league got no
// banner there — and, from the same omission, a header that read
// `{year} Season` on a league that had not started its season.
//
// A member arriving at Matchups during preseason sees an empty grid; the banner
// is the whole reason that emptiness is explainable. This pins that every league
// surface receives the status, so the wiring cannot silently drop off one route
// again.
// ---------------------------------------------------------------------------

const SLUG = 'tsc';

type CFBScheduleAppProps = {
  leagueSlug?: string;
  leagueStatus?: LeagueStatus;
  leagueYear?: number;
  assignmentMethod?: 'draft' | 'manual' | null;
  canonicalStandings?: CanonicalStandings;
  initialWeekViewMode?: string;
};

/** The pages return `<main><CFBScheduleApp {...props} /></main>`; read the props. */
function appProps(page: ReactElement): CFBScheduleAppProps {
  const main = page as ReactElement<{ children: ReactElement<CFBScheduleAppProps> }>;
  return main.props.children.props;
}

const SURFACES: ReadonlyArray<[string, (slug: string) => Promise<ReactElement>]> = [
  ['overview', (slug) => LeagueRootPage({ params: Promise.resolve({ slug }) })],
  ['schedule', (slug) => LeagueSchedulePage({ params: Promise.resolve({ slug }) })],
  ['matchups', (slug) => LeagueMatchupsPage({ params: Promise.resolve({ slug }) })],
  ['members', (slug) => LeagueMembersPage({ params: Promise.resolve({ slug }) })],
  [
    'standings',
    (slug) =>
      LeagueStandingsPage({
        params: Promise.resolve({ slug }),
        searchParams: Promise.resolve({}),
      }),
  ],
];

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('every league surface receives the preseason status the banner decides from', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: 2026 },
    assignmentMethod: 'draft',
  });

  for (const [name, render] of SURFACES) {
    const props = appProps(await render(SLUG));

    // Without this the banner cannot run at all, and the header claims a season
    // the league has not reached.
    assert.deepEqual(props.leagueStatus, { state: 'preseason', year: 2026 }, name);

    // The banner's roster fact rides on the canonical snapshot, not on client
    // state, so both must arrive together.
    assert.ok(props.canonicalStandings, `${name} must pass canonicalStandings`);
    assert.equal(props.canonicalStandings?.slug, SLUG, name);
    assert.equal(props.canonicalStandings?.ownersRosterSource, 'none', name);

    // The roster gate needs the owner COUNT as well as the source tag, and a
    // stale draft record must not speak for a manual league — both facts have
    // to reach the component or the banner decides on partial evidence.
    assert.ok(Array.isArray(props.canonicalStandings?.rows), name);
    assert.equal(props.assignmentMethod, 'draft', name);
  }
});

test('a legacy record with no stored status resolves identically on every surface', async () => {
  // The fallback inference (`?? { state: 'season', year }`) was inlined on two
  // routes and omitted on three, so the surfaces disagreed for exactly the
  // records the fallback exists to cover. `resolveDisplayLeagueStatus` is now
  // the single definition; this is the case that proves they share it.
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    // No status stored.
  });

  for (const [name, render] of SURFACES) {
    const props = appProps(await render(SLUG));
    assert.deepEqual(props.leagueStatus, { state: 'season', year: 2026 }, name);
  }
});

test('the surfaces agree on the lifecycle facts and differ only by entry point', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: 2026 },
  });

  const rendered = await Promise.all(
    SURFACES.map(async ([name, render]) => [name, appProps(await render(SLUG))] as const)
  );
  const [, overview] = rendered[0]!;

  for (const [name, props] of rendered.slice(1)) {
    assert.deepEqual(props.leagueStatus, overview.leagueStatus, name);
    assert.equal(props.leagueYear, overview.leagueYear, name);
    assert.equal(props.assignmentMethod, overview.assignmentMethod, name);
    assert.equal(props.canonicalStandings?.source, overview.canonicalStandings?.source, name);
    assert.equal(
      props.canonicalStandings?.ownersRosterSource,
      overview.canonicalStandings?.ownersRosterSource,
      name
    );
  }

  // The entry-point view mode is the only intended difference.
  assert.deepEqual(
    rendered.map(([name, props]) => [name, props.initialWeekViewMode]),
    [
      ['overview', undefined],
      ['schedule', 'schedule'],
      ['matchups', 'matchups'],
      ['members', 'owner'],
      ['standings', 'standings'],
    ]
  );
});
