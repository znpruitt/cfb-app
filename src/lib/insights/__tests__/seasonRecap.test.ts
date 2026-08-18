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
// INSIGHTS-032 — the season recap, end to end through the REAL loader.
//
// `season-recap.test.ts` pins the generator against a hand-built context, which
// proves the selection logic and nothing about where the data comes from. That
// gap is the one this project keeps falling into: a fixture that cannot reach
// the failure passes for evidence. Everything below runs through
// `buildLeagueInsightContext` against seeded durable state, so it also proves a
// real preseason league's context carries the adjacent archive in the field the
// generator reads — and that the cards it emits carry the metadata navigation
// depends on.
// ---------------------------------------------------------------------------

const SLUG = 'recap';
const YEAR = 2026;
const PRIOR = 2025;

/** 2025 as played. Xavier finished last and has since LEFT the league. */
const FINAL_2025 = [
  { owner: 'Zoe', wins: 11, losses: 1 },
  { owner: 'Yuri', wins: 8, losses: 4 },
  { owner: 'Xavier', wins: 3, losses: 9 },
];
const TEAMS: Record<string, string> = { Zoe: 'Georgia', Yuri: 'Clemson', Xavier: 'Utah' };
/** Who is actually playing 2026 — Xavier is gone. */
const CURRENT = ['Zoe', 'Yuri'];

/**
 * Weeks 1-6 with complete coverage, ordered by the final standings: the leader
 * stays level, each subsequent owner trails by their finishing position, and the
 * runner-up closes over the last three weeks so the chase card has a slope to
 * read.
 */
function weeklyHistory(rows: typeof FINAL_2025) {
  const weeks = [1, 2, 3, 4, 5, 6];
  const leader = rows[0]!;
  const gapFor = (index: number, week: number): number => {
    if (index === 0) return 0;
    if (index === 1) return week <= 3 ? 6 : 9 - week; // 6,6,6,5,4,3
    return index * 3; // steady, and last place stays last
  };
  const byOwner: Record<string, unknown[]> = {};
  const byWeek: Record<number, unknown> = {};
  for (const week of weeks) {
    const ranked = rows
      .map((r, index) => ({ owner: r.owner, gamesBack: gapFor(index, week) }))
      .sort((a, b) => a.gamesBack - b.gamesBack);
    for (const { owner, gamesBack } of ranked) {
      (byOwner[owner] ??= []).push({
        week,
        wins: Math.max(0, leader.wins - gamesBack),
        losses: gamesBack,
        ties: 0,
        winPct: 0.5,
        pointsFor: 300,
        pointsAgainst: 280,
        pointDifferential: 20,
        gamesBack,
      });
    }
    byWeek[week] = {
      week,
      standings: ranked.map(({ owner, gamesBack }) => ({
        owner,
        wins: Math.max(0, leader.wins - gamesBack),
        losses: gamesBack,
        ties: 0,
        winPct: 0.5,
        pointsFor: 300,
        pointsAgainst: 280,
        pointDifferential: 20,
        gamesBack,
        finalGames: leader.wins,
      })),
      coverage: { state: 'complete', message: null },
    };
  }
  return { weeks, byWeek, byOwner };
}

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

async function seedLeague(
  opts: { archiveYear?: number; rows?: typeof FINAL_2025 } = {}
): Promise<void> {
  const rows = opts.rows ?? FINAL_2025;
  const archiveYear = opts.archiveYear ?? PRIOR;
  const leader = rows[0]!;

  await addLeague({
    slug: SLUG,
    displayName: 'Recap League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2021,
    status: { state: 'preseason', year: YEAR, setupComplete: true },
  });

  await setAppState(`standings-archive:${SLUG}`, String(archiveYear), {
    leagueSlug: SLUG,
    year: archiveYear,
    archivedAt: `${archiveYear + 1}-01-05T00:00:00.000Z`,
    ownerRosterSnapshot:
      'team,owner\n' + rows.map((r) => `${TEAMS[r.owner]},${r.owner}`).join('\n'),
    // A REAL weekly history. An empty one still produces the champion card from
    // `finalStandings`, which is how the first version of this file passed while
    // never reaching the throne card — the only one that names the departed
    // owner. Xavier sits last every week; Yuri closes on Zoe down the stretch.
    standingsHistory: weeklyHistory(rows),
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

  // The CURRENT-year roster. Its presence is what makes this the real post-draft
  // state rather than the rollover window: with it, `usingArchivedRoster` is
  // false, which is precisely the state in which a relative "last season" prefix
  // would have stopped being applied.
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), CURRENT);
  await setAppState(
    `owners:${SLUG}:${YEAR}`,
    'csv',
    'team,owner\n' + CURRENT.map((o) => `${TEAMS[o]},${o}`).join('\n')
  );
}

async function recapCards(opts: Parameters<typeof seedLeague>[0] = {}) {
  await seedLeague(opts);
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(context.lifecycleState, 'preseason', 'the fixture must actually be in preseason');
  assert.equal(
    context.usingArchivedRoster,
    false,
    'this must be the POST-DRAFT state, where a relative prefix would not fire'
  );
  return generateRawInsights(context).filter((i) => i.category === 'season_wrap');
}

test('the recap survives rollover: preseason serves last season from the archive', async () => {
  const cards = await recapCards();

  const champion = cards.find((i) => i.type === 'champion_margin');
  assert.ok(champion, `preseason must carry a champion margin; saw [${cards.map((i) => i.type)}]`);
  assert.equal(champion.title, 'How 2025 finished', 'the title names the ARCHIVED season');
  assert.equal(
    champion.description,
    'Zoe took it by 3 games over Yuri.',
    'the recap copy is owner-authored; a mechanical prefix is not a substitute'
  );
});

test('the archive is genuinely the source: the new season has no results to read', async () => {
  // The mechanism check. If the generator were reading `context.currentStandings`
  // there would be no margin to report at all, which is what makes the assertion
  // above meaningful rather than two tables coincidentally agreeing.
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

test('a DEPARTED owner is still named, and the card carries its season', async () => {
  // Xavier is absent from the 2026 roster and confirmed owner list. Withholding
  // the card would make the recap dark until owners are confirmed and would
  // delete the champion card outright whenever last season's champion left.
  const cards = await recapCards();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.ok(!context.leagueMembers.has('Xavier'), 'the fixture must have Xavier departed');

  const named = cards.flatMap((i) => [i.owner, ...(i.relatedOwners ?? [])]).filter(Boolean);
  assert.ok(named.includes('Xavier'), `a departed owner is named: got ${named.join(', ')}`);

  // The wiring half of navigation: routing reads `insight.season`, and tests that
  // hand-build an insight prove only that the router reads it.
  for (const card of cards) {
    assert.equal(card.season, PRIOR, `${card.type} must carry the season it describes`);
    assert.equal(card.decay, 'season_recap', `${card.type} must declare its ageing policy`);
  }
});

test('without the ADJACENT archive, preseason serves no recap', async () => {
  const cards = await recapCards({ archiveYear: 2024 });
  assert.equal(cards.length, 0, `expected no recap; got [${cards.map((i) => i.title)}]`);
});

test('an archived season nobody played serves no recap', async () => {
  const unplayed = FINAL_2025.map((r) => ({ ...r, wins: 0, losses: 0 }));
  const cards = await recapCards({ rows: unplayed });
  assert.equal(
    cards.length,
    0,
    `a 0-0 archive supports no claim; got [${cards.map((i) => i.title)}]`
  );
});
