import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { buildLeagueInsightContext } from '@/lib/insights/loadInsights';
import { generateRawInsights } from '@/lib/insights/engine';
import '@/lib/insights/generators';

// ---------------------------------------------------------------------------
// INSIGHTS-032 — the season wrap, end to end, through the REAL context builder.
//
// `insights-lifecycle-awareness.test.ts` pins the generator's behaviour against a
// hand-built `InsightContext`, which proves the selection logic and nothing about
// where the data comes from. That gap is the one this project keeps falling into:
// a fixture that cannot reach the failure passes for evidence. Every assertion
// below runs through `buildLeagueInsightContext` against seeded durable state, so
// it also proves that a real preseason league's context carries the adjacent
// archive in the field the generator reads.
// ---------------------------------------------------------------------------

const SLUG = 'wrap';
const YEAR = 2026;
const PRIOR = 2025;

/** Final 2025 table: Zoe took it, Yuri finished three back, Xavier last. */
const FINAL_2025 = [
  { owner: 'Zoe', wins: 11, losses: 1 },
  { owner: 'Yuri', wins: 8, losses: 4 },
  { owner: 'Xavier', wins: 3, losses: 9 },
];

const TEAMS: Record<string, string> = { Zoe: 'Georgia', Yuri: 'Clemson', Xavier: 'Utah' };

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

async function seedLeague(
  opts: { archiveYear?: number; rows?: typeof FINAL_2025; confirmed?: boolean } = {}
): Promise<void> {
  const rows = opts.rows ?? FINAL_2025;
  const archiveYear = opts.archiveYear ?? PRIOR;

  await addLeague({
    slug: SLUG,
    displayName: 'Wrap League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2021,
    status: { state: 'preseason', year: YEAR },
  });

  const leader = rows[0]!;
  await setAppState(`standings-archive:${SLUG}`, String(archiveYear), {
    leagueSlug: SLUG,
    year: archiveYear,
    archivedAt: `${archiveYear + 1}-01-05T00:00:00.000Z`,
    ownerRosterSnapshot:
      'team,owner\n' + rows.map((r) => `${TEAMS[r.owner]},${r.owner}`).join('\n'),
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: rows.map((r) => ({
      owner: r.owner,
      wins: r.wins,
      losses: r.losses,
      ties: 0,
      winPct: r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0,
      pointsFor: 300 + r.wins * 20,
      pointsAgainst: 300,
      pointDifferential: r.wins * 20,
      gamesBack: leader.wins - r.wins,
      finalGames: r.wins + r.losses,
    })),
    games: [],
    scoresByKey: {},
  });

  if (opts.confirmed !== false) {
    await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Zoe', 'Yuri', 'Xavier']);
    // The CURRENT-year roster, which is what makes this fixture the real
    // post-draft state rather than the rollover window. Without it the roster
    // falls back to the archive, `usingArchivedRoster` goes true, and the
    // "Last season's" framing below would pass on the OLD trigger — a green
    // test over the exact case INSIGHTS-032 exists to fix. Mutation-proven:
    // reverting the framing condition survives every assertion here unless this
    // CSV is seeded.
    await setAppState(
      `owners:${SLUG}:${YEAR}`,
      'csv',
      'team,owner\n' + FINAL_2025.map((r) => `${TEAMS[r.owner]},${r.owner}`).join('\n')
    );
  }
}

async function wrapInsights(opts: Parameters<typeof seedLeague>[0] = {}) {
  await seedLeague(opts);
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(context.lifecycleState, 'preseason', 'the fixture must actually be in preseason');
  assert.equal(
    context.usingArchivedRoster,
    false,
    'this fixture must be the POST-DRAFT state, where the old framing trigger is off'
  );
  return generateRawInsights(context).filter((i) => i.category === 'season_wrap');
}

test('the season wrap survives rollover: preseason serves last season from the archive', async () => {
  const insights = await wrapInsights();

  const champion = insights.find((i) => i.type === 'champion_margin');
  assert.ok(
    champion,
    `preseason must carry a champion margin; saw [${insights.map((i) => i.type).join(', ')}]`
  );
  assert.match(champion.description, /Zoe/, 'the archived champion must be named');
  assert.equal(champion.statValue, 3, 'the margin must be read off the archived table');
  assert.equal(
    champion.title,
    "Last season's champion margin",
    'an unframed title on a season that has not kicked off is a current-year claim'
  );
});

test('a preseason league whose current standings are empty still reaches the archive', async () => {
  // The mechanism check. In preseason nothing has been played, so if the
  // generator were reading `context.currentStandings` there would be no margin
  // to report at all — the fixture below confirms that table is in fact empty of
  // results, which is what makes the assertion above meaningful rather than a
  // coincidence of two tables agreeing.
  await seedLeague();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.ok(
    context.currentStandings.every((r) => r.finalGames === 0),
    `the new season must have no completed games; got ${JSON.stringify(context.currentStandings)}`
  );
  assert.ok(
    context.archives.some((a) => a.year === PRIOR),
    'the adjacent archive must be present on a real preseason context'
  );
});

test('without the ADJACENT archive, preseason serves no wrap', async () => {
  // Same league, same rows, archived one year earlier. A 2024 champion is not
  // "last season's" champion, and the copy has no way to say otherwise.
  const insights = await wrapInsights({ archiveYear: 2024 });
  assert.equal(insights.length, 0, `expected no wrap; got [${insights.map((i) => i.title)}]`);
});

test('an archived season nobody played serves no wrap', async () => {
  const unplayed = FINAL_2025.map((r) => ({ ...r, wins: 0, losses: 0 }));
  const insights = await wrapInsights({ rows: unplayed });
  assert.equal(
    insights.length,
    0,
    `a 0-0 archive cannot support "title secured by"; got [${insights.map((i) => i.title)}]`
  );
});
