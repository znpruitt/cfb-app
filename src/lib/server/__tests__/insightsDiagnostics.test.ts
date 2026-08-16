import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { buildInsightsDiagnostics, classifyInsightFunnel } from '@/lib/server/insightsDiagnostics';
import type { Insight } from '@/lib/selectors/insights';
import {
  MAX_SERVED_INSIGHTS,
  OVERVIEW_INSIGHT_SLOTS,
  OVERVIEW_INSIGHT_SLOTS_WITH_RECAP,
} from '@/lib/insights/limits';

// ---------------------------------------------------------------------------
// INSIGHTS-019 — the funnel view model.
//
// The feed narrows twice (generated → served → rendered) and neither cut was
// observable. This page exists to answer "why is my feed thin, and would
// rotation have anything to work with" — the question INSIGHTS-023 and
// INSIGHTS-018 both turn on, and the reason 018 was stopped once already.
//
// The fixture below is the one from `loadInsights.test.ts`: a season league with
// three archived seasons, which is what reaches the career/historical generators.
// A fixture that generates NOTHING would make every assertion here vacuous —
// that exact mistake cost two attempts during INSIGHTS-029 — so the first
// assertion is that something was generated at all.
// ---------------------------------------------------------------------------

const SLUG = 'diag';
const YEAR = 2026;
const OWNERS = ['Alice', 'Bob', 'Carol', 'Dave'];

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

async function seedLeagueWithHistory(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Diagnostics League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2022,
    status: { state: 'season', year: YEAR },
  });

  const csv = 'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Carol\nOhio State,Dave';
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', csv);

  const archived: Record<number, [number, number][]> = {
    2023: [
      [10, 2],
      [8, 4],
      [6, 6],
      [2, 10],
    ],
    2024: [
      [9, 3],
      [7, 5],
      [5, 7],
      [3, 9],
    ],
    2025: [
      [11, 1],
      [6, 6],
      [4, 8],
      [1, 11],
    ],
  };
  for (const [year, records] of Object.entries(archived)) {
    await setAppState(`standings-archive:${SLUG}`, year, {
      leagueSlug: SLUG,
      year: Number(year),
      archivedAt: '2026-01-01T00:00:00.000Z',
      ownerRosterSnapshot: csv,
      standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
      finalStandings: records.map(([wins, losses], i) => ({
        owner: OWNERS[i],
        wins,
        losses,
        ties: 0,
        winPct: wins / (wins + losses),
        pointsFor: 350 + i * 10,
        pointsAgainst: 300,
        pointDifferential: 50 + i * 10,
        gamesBack: 0,
        finalGames: wins + losses,
      })),
      games: [],
      scoresByKey: {},
    });
  }

  const teams = ['Georgia', 'Clemson', 'Alabama', 'Ohio State'];
  const items = [];
  const scoreRows = [];
  let n = 0;
  for (let week = 1; week <= 6; week++) {
    for (let pair = 0; pair < 2; pair++) {
      const home = teams[pair * 2];
      const away = teams[pair * 2 + 1];
      const id = `g${++n}`;
      const startDate = `2026-09-0${week}T18:00:00.000Z`;
      items.push({
        id,
        week,
        startDate,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: home,
        awayTeam: away,
        homeConference: 'SEC',
        awayConference: 'ACC',
        status: 'final',
        seasonType: 'regular',
      });
      scoreRows.push({
        id,
        seasonType: 'regular',
        startDate,
        week,
        status: 'final',
        home: { team: home, score: ((week * 7 + pair * 3) % 40) + 10 },
        away: { team: away, score: ((week * 5 + pair * 11) % 35) + 7 },
        time: null,
      });
    }
  }
  await setAppState('schedule', `${YEAR}-all-all`, { items });
  await setAppState('scores', `${YEAR}-all-regular`, { items: scoreRows });
}

test('reports the funnel, and the fixture actually fills it', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  assert.ok(
    model.counts.generated > 0,
    'the fixture MUST generate insights, or nothing below means anything'
  );
  assert.equal(model.counts.servedCap, MAX_SERVED_INSIGHTS, 'reports the real loader cap');
  assert.ok(
    model.counts.renderedCap === OVERVIEW_INSIGHT_SLOTS ||
      model.counts.renderedCap === OVERVIEW_INSIGHT_SLOTS_WITH_RECAP,
    'reports one of the real Overview caps'
  );

  // The funnel only ever narrows.
  assert.ok(model.counts.served <= model.counts.generated, 'served cannot exceed generated');
  assert.ok(model.counts.rendered <= model.counts.served, 'rendered cannot exceed served');
  assert.ok(model.counts.served <= model.counts.servedCap, 'served respects its cap');
  assert.ok(model.counts.rendered <= model.counts.renderedCap, 'rendered respects its cap');
});

test('every generated insight is accounted for exactly once', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  assert.equal(
    model.insights.length,
    model.counts.generated,
    'the list is the whole generated set, not just what survived'
  );

  const rendered = model.insights.filter((i) => i.fate === 'rendered').length;
  const servedNotRendered = model.insights.filter((i) => i.fate === 'served-not-rendered').length;
  const cut = model.insights.filter((i) => i.fate === 'generated-not-served').length;

  assert.equal(rendered, model.counts.rendered, 'the rendered fate matches the rendered count');
  assert.equal(
    rendered + servedNotRendered,
    model.counts.served,
    'served = what shows plus what is served but not shown'
  );
  assert.equal(
    rendered + servedNotRendered + cut,
    model.counts.generated,
    'no insight is unaccounted for, and none is counted twice'
  );
});

test('insights are ranked by priority, highest first', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  const scores = model.insights.map((i) => i.priorityScore);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
    'ranked by score descending'
  );
  assert.deepEqual(
    model.insights.map((i) => i.rank),
    model.insights.map((_, idx) => idx + 1),
    'ranks are 1-based and contiguous'
  );
});

test('every insight is attributed to the generator that produced it', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  assert.ok(
    model.insights.every((i) => i.generatorId !== 'unknown'),
    'attribution must not fall back to unknown — that means the mapping broke'
  );

  // The per-generator counts must add up to the total, or the page is telling
  // two different stories about the same run.
  const summed = model.generators.reduce((total, g) => total + g.produced, 0);
  assert.equal(summed, model.counts.generated, 'generator counts sum to the generated total');
});

test('a generator that cannot run in this lifecycle says so rather than reading as empty', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  const skipped = model.generators.filter((g) => g.skippedBy === 'lifecycle');
  assert.ok(skipped.length > 0, 'some generators do not run in a mid-season state');
  assert.ok(
    skipped.every((g) => g.produced === 0),
    'a skipped generator produces nothing, by definition'
  );
});

// ---------------------------------------------------------------------------
// The funnel's third branch — "cut before serving" — driven directly.
//
// It cannot be reached from a fixture: a league with 8 owners and 5 archived
// seasons generates 9 insights, under the cap of 10. That IS the page's headline
// finding, and it is why INSIGHTS-018 was stopped. But it would leave the branch
// the page most exists to reveal completely untested, so the classification is a
// pure function and gets driven here with a pool that genuinely overflows.
// ---------------------------------------------------------------------------

function synthetic(id: string, priorityScore: number): Insight {
  return {
    id,
    type: 'drought',
    title: id,
    description: id,
    owner: 'Alice',
    priorityScore,
    newsHook: 'streak_extended',
    statValue: 1,
  };
}

test('an overflowing pool: the tail is cut before serving', () => {
  // 14 insights for 10 served slots and 5 rendered slots.
  const generated = Array.from({ length: 14 }, (_, i) => synthetic(`i-${i}`, 100 - i));

  const { served, fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS);

  assert.equal(served.length, MAX_SERVED_INSIGHTS, 'the loader cap applies');

  const fates = generated.map((i) => fateOf(i.id));
  assert.equal(fates.filter((f) => f === 'rendered').length, OVERVIEW_INSIGHT_SLOTS);
  assert.equal(
    fates.filter((f) => f === 'served-not-rendered').length,
    MAX_SERVED_INSIGHTS - OVERVIEW_INSIGHT_SLOTS
  );
  assert.equal(
    fates.filter((f) => f === 'generated-not-served').length,
    14 - MAX_SERVED_INSIGHTS,
    'the overflow is reported as cut — the branch a real fixture cannot reach'
  );
});

test('the cut falls on the LOWEST priority, not on arrival order', () => {
  // Deliberately shuffled so a pass-through implementation would fail.
  const generated = [
    synthetic('lowest', 1),
    synthetic('highest', 999),
    ...Array.from({ length: 12 }, (_, i) => synthetic(`mid-${i}`, 50 + i)),
  ];

  const { fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS);

  assert.equal(fateOf('highest'), 'rendered', 'the best insight reaches the screen');
  assert.equal(fateOf('lowest'), 'generated-not-served', 'the worst is cut');
});

test('a pool smaller than the feed cuts nothing', () => {
  const generated = Array.from({ length: 3 }, (_, i) => synthetic(`i-${i}`, 10 - i));
  const { served, fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS);

  assert.equal(served.length, 3);
  assert.ok(
    generated.every((i) => fateOf(i.id) === 'rendered'),
    'with 3 insights and 5 slots, everything shows — the state TSC is actually in'
  );
});
