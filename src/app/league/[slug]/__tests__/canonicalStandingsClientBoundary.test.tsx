import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { ReactElement } from 'react';

import { addLeague } from '@/lib/leagueRegistry';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import { getCanonicalStandings, type CanonicalStandings } from '@/lib/selectors/leagueStandings';
import { selectSeasonContext, type SeasonContext } from '@/lib/selectors/seasonContext';
import type { StandingsHistoryWeekSnapshot } from '@/lib/standingsHistory';

import LeagueRootPage from '../page';
import LeagueMatchupsPage from '../matchups/page';
import LeagueMembersPage from '../members/page';
import LeagueSchedulePage from '../schedule/page';
import LeagueStandingsPage from '../standings/page';

// ---------------------------------------------------------------------------
// PLATFORM-109 — what canonical standings look like at the client boundary.
//
// `standingsHistory.byWeek[*].pending` lists every unconcluded real game of the
// season, and its only consumer is `selectSeasonContext`. The five league routes
// serialize the snapshot into a client component, so the browser was receiving
// the whole list in order to reduce it to one of three strings.
//
// These pin the replacement on every route: the derived string arrives, and the
// list it was derived from does not. A route that goes back to passing
// `canonicalStandings` directly fails here rather than silently re-growing the
// payload.
// ---------------------------------------------------------------------------

const SLUG = 'tsc';
const YEAR = 2026;

type CFBScheduleAppProps = {
  canonicalStandings?: CanonicalStandings;
  seasonContext?: SeasonContext;
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

/**
 * A league with one real, unscored, already-kicked-off game — which is exactly
 * what `deriveStandingsHistory` records as `pending`. Without an unconcluded
 * game the stripping assertion below would pass over an empty list and prove
 * nothing.
 */
async function seedLeagueWithAPendingGame(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000001',
        week: 1,
        startDate: `${YEAR}-09-05T18:00:00.000Z`,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
  });
}

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('the fixture really does produce a pending game server-side', async () => {
  // Positive control for the two tests below: the observer they use (looking for
  // `pending` on a week snapshot) must be able to SEE a pending game, or its
  // absence at the boundary would be meaningless.
  await seedLeagueWithAPendingGame();

  const canonical = await getCanonicalStandings({ slug: SLUG });
  const history = canonical.standingsHistory;

  assert.ok(history, 'fixture must produce a standings history');
  assert.ok(history.weeks.length > 0, 'fixture must produce at least one week');
  const pendingCount = history.weeks.reduce(
    (total, week) => total + (history.byWeek[week]?.pending?.length ?? 0),
    0
  );
  assert.ok(pendingCount > 0, 'fixture must produce at least one pending game');
});

test('no league surface ships the pending game list to the client', async () => {
  await seedLeagueWithAPendingGame();

  for (const [name, render] of SURFACES) {
    const props = appProps(await render(SLUG));
    const history = props.canonicalStandings?.standingsHistory;

    assert.ok(history, `${name} must still pass a standings history`);
    assert.ok(
      history.weeks.length > 0,
      `${name} history must be non-empty for this to mean anything`
    );
    for (const week of history.weeks) {
      const snapshot: StandingsHistoryWeekSnapshot | undefined = history.byWeek[week];
      assert.ok(snapshot, `${name} week ${week} must survive`);
      assert.equal(
        Object.prototype.hasOwnProperty.call(snapshot, 'pending'),
        false,
        `${name} week ${week} must not carry pending across the client boundary`
      );
    }
  }
});

test('every league surface passes the derived season context instead', async () => {
  await seedLeagueWithAPendingGame();
  const unstripped = await getCanonicalStandings({ slug: SLUG });

  for (const [name, render] of SURFACES) {
    const props = appProps(await render(SLUG));

    // The component defaults this prop, so a route that forgot it would render
    // `in-season` rather than crash — which is why presence is asserted here
    // rather than left to the component's fallback.
    assert.ok(
      props.seasonContext !== undefined,
      `${name} must pass the server-derived season context`
    );

    // And it must be the RIGHT value, not merely a legal one. Review found this
    // test asserting only "one of three strings", which would have passed for a
    // hardcoded answer — and which is why the reclassification defect below
    // survived every gate. The comparison is against the UNSTRIPPED snapshot,
    // i.e. the exact computation the browser used to perform for itself.
    assert.equal(
      props.seasonContext,
      selectSeasonContext({ standingsHistory: unstripped.standingsHistory }),
      `${name} season context must equal the pre-projection answer`
    );
  }
});
