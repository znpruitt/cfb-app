import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
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
import {
  teamRecordsClientProps,
  type TeamRecordsByProviderGameId,
} from '@/lib/selectors/teamRecordsClient';
import type { ScheduleWireItem } from '@/lib/schedule';
import type { TeamRecordItem, TeamRecordsCacheRead } from '@/lib/teamRecords/teamRecordsCache';

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

function record(teamId: number, team: string, wins: number, losses: number): TeamRecordItem {
  return {
    year: YEAR,
    teamId,
    team,
    classification: teamId === 399 ? 'fcs' : 'fbs',
    conference: null,
    total: { games: wins + losses, wins, losses, ties: 0 },
  };
}

function scheduleItem(
  id: string,
  awayId: number | null | undefined,
  homeId: number | null | undefined
): ScheduleWireItem {
  return {
    id,
    week: 1,
    startDate: '2026-09-03T22:00:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    awayTeam: 'UAlbany',
    homeTeam: 'Buffalo',
    awayId,
    homeId,
    awayConference: 'CAA',
    homeConference: 'Mid-American',
    status: 'scheduled',
    seasonType: 'regular',
  };
}

function recordCache(
  items: TeamRecordItem[],
  uncreditableTeamIds: number[] = []
): TeamRecordsCacheRead {
  return { at: Date.UTC(YEAR, 8, 2), year: YEAR, items, uncreditableTeamIds };
}

type CFBScheduleAppProps = {
  canonicalStandings?: CanonicalStandings;
  seasonContext?: SeasonContext;
  initialNowMs?: number;
  teamRecordsByProviderGameId?: TeamRecordsByProviderGameId;
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

/**
 * A league whose only game is FINAL. Every week is played with nothing pending,
 * so the season context is `final` — the answer the fixture above can never
 * produce, and therefore the one that makes the equality assertion below capable
 * of catching a hardcoded value.
 */
async function seedLeagueWithAFinishedSeason(): Promise<void> {
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
        id: '401000002',
        week: 1,
        startDate: `${YEAR}-09-05T18:00:00.000Z`,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'final',
        seasonType: 'regular',
      },
    ],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: '401000002',
        seasonType: 'regular',
        startDate: `${YEAR}-09-05T18:00:00.000Z`,
        week: 1,
        status: 'final',
        home: { team: 'Texas', score: 31 },
        away: { team: 'Georgia', score: 17 },
        time: null,
      },
    ],
  });
}

async function seedLeagueWithFcsOpponentRecords(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nBuffalo,Alice\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401868946',
        week: 1,
        startDate: `${YEAR}-09-03T22:00:00.000Z`,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Buffalo',
        awayTeam: 'UAlbany',
        homeId: 2084,
        awayId: 399,
        homeConference: 'Mid-American',
        awayConference: 'CAA',
        homeClassification: 'fbs',
        awayClassification: 'fcs',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
  });
  await setAppState('team-records', String(YEAR), {
    at: Date.UTC(YEAR, 8, 2),
    year: YEAR,
    items: [
      {
        year: YEAR,
        teamId: 399,
        team: 'UAlbany',
        classification: 'fcs',
        conference: 'CAA',
        total: { games: 1, wins: 1, losses: 0, ties: 0 },
      },
      {
        year: YEAR,
        teamId: 2084,
        team: 'Buffalo',
        classification: 'fbs',
        conference: 'Mid-American',
        total: { games: 0, wins: 0, losses: 0, ties: 0 },
      },
    ],
  });
}

async function findPageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findPageFiles(entryPath)));
    if (entry.isFile() && entry.name === 'page.tsx') files.push(entryPath);
  }
  return files;
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

    // And it must be the RIGHT value, not merely a legal one: the comparison is
    // against the UNSTRIPPED snapshot, i.e. the exact computation the browser
    // used to perform for itself.
    //
    // On its own this case cannot catch a route that hardcoded `in-season`,
    // because that IS the answer here. The finished-season test below supplies
    // the discriminating value. An earlier version of this comment claimed this
    // assertion alone was enough, and the confirming review was right that it
    // was not.
    assert.equal(
      props.seasonContext,
      selectSeasonContext({ standingsHistory: unstripped.standingsHistory }),
      `${name} season context must equal the pre-projection answer`
    );
  }
});

test('every league surface passes pid-native FCS and FBS team records', async () => {
  await seedLeagueWithFcsOpponentRecords();

  for (const [name, render] of SURFACES) {
    const props = appProps(await render(SLUG));
    assert.deepEqual(
      props.teamRecordsByProviderGameId?.['401868946'],
      {
        away: { wins: 1, losses: 0 },
        home: { wins: 0, losses: 0 },
      },
      `${name} must pass UAlbany and Buffalo records by their CFBD participant ids`
    );
  }
});

test('the client projection uses participant ids only and preserves withheld absence', () => {
  const missingIds = teamRecordsClientProps(
    [scheduleItem('2018-row', undefined, undefined)],
    recordCache([record(399, 'UAlbany', 1, 0), record(2084, 'Buffalo', 0, 0)])
  );
  assert.deepEqual(
    missingIds.teamRecordsByProviderGameId,
    {},
    'the 2018-style row must not fall back from missing participant ids to matching names'
  );

  const withheld = teamRecordsClientProps(
    [scheduleItem('withheld', 399, 2084)],
    recordCache([record(399, 'UAlbany', 1, 0), record(2084, 'Buffalo', 0, 0)], [399])
  );
  assert.deepEqual(
    withheld.teamRecordsByProviderGameId.withheld,
    { away: null, home: { wins: 0, losses: 0 } },
    'a deliberately withheld outcome must stay absent rather than render as 0-0'
  );
});

test('every league route mounting CFBScheduleApp supplies team-record props', async () => {
  const routeRoot = path.join(process.cwd(), 'src', 'app', 'league', '[slug]');
  const pageFiles = await findPageFiles(routeRoot);
  const mountingPages: string[] = [];

  for (const pageFile of pageFiles) {
    const source = await readFile(pageFile, 'utf8');
    if (!/<CFBScheduleApp\b/.test(source)) continue;
    mountingPages.push(path.relative(routeRoot, pageFile));
    assert.match(
      source,
      /\{\.\.\.teamRecordsClientProps\(scheduleItems, teamRecords\)\}/,
      `${path.relative(routeRoot, pageFile)} must project records at the CFBScheduleApp boundary`
    );
  }

  assert.ok(mountingPages.length > 0, 'fixture must discover a CFBScheduleApp route mount');
});

test('a finished season reaches the client as `final`, not the default', async () => {
  // The discriminating half of the assertion above. Every route must report the
  // season OVER here; a hardcoded `in-season`, a dropped prop falling back to its
  // default, or a projection that lost the answer all fail this.
  await seedLeagueWithAFinishedSeason();
  const unstripped = await getCanonicalStandings({ slug: SLUG });
  assert.equal(
    selectSeasonContext({ standingsHistory: unstripped.standingsHistory }),
    'final',
    'the fixture must actually produce a finished season, or this proves nothing'
  );

  for (const [name, render] of SURFACES) {
    const props = appProps(await render(SLUG));
    assert.equal(props.seasonContext, 'final', `${name} must report the finished season`);
  }
});

test('only the Overview route seeds the request-time promotion clock', async () => {
  await seedLeagueWithAPendingGame();

  const overviewProps = appProps(await LeagueRootPage({ params: Promise.resolve({ slug: SLUG }) }));
  const memberProps = appProps(
    await LeagueMembersPage({ params: Promise.resolve({ slug: SLUG }) })
  );

  assert.equal(typeof overviewProps.initialNowMs, 'number');
  assert.equal(Number.isFinite(overviewProps.initialNowMs), true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(memberProps, 'initialNowMs'),
    false,
    'Members must not inherit the Overview request-time context'
  );
});
