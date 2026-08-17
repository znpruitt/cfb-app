import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { addLeague } from '@/lib/leagueRegistry';
import { draftScope } from '@/lib/draft';
import { draftPicksSignature } from '@/lib/selectors/draftPublication';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
} from '@/lib/server/appStateStore';
import {
  buildInsightsDiagnostics,
  classifyInsightFunnel,
  runGeneratorForDiagnostics,
  redactConnectionDetails,
} from '@/lib/server/insightsDiagnostics';
import type { Insight } from '@/lib/selectors/insights';
import type { InsightGenerator } from '@/lib/insights/types';
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
  assert.ok(model.counts.onOverview <= model.counts.served, 'rendered cannot exceed served');
  assert.ok(model.counts.served <= model.counts.servedCap, 'served respects its cap');
  assert.ok(model.counts.onOverview <= model.counts.renderedCap, 'rendered respects its cap');
});

test('every generated insight is accounted for exactly once', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  assert.equal(
    model.insights.length,
    model.counts.generated,
    'the list is the whole generated set, not just what survived'
  );

  const onOverview = model.insights.filter((i) => i.fate === 'on-overview').length;
  const allInsightsOnly = model.insights.filter((i) => i.fate === 'all-insights-only').length;
  const cut = model.insights.filter((i) => i.fate === 'not-served').length;

  assert.equal(onOverview, model.counts.onOverview, 'the rendered fate matches the rendered count');
  assert.equal(
    onOverview + allInsightsOnly,
    model.counts.served,
    'served = what shows plus what is served but not shown'
  );
  assert.equal(
    onOverview + allInsightsOnly + cut,
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

  const { served, fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  assert.equal(served.length, MAX_SERVED_INSIGHTS, 'the loader cap applies');

  const fates = generated.map((i) => fateOf(i.id));
  assert.equal(fates.filter((f) => f === 'on-overview').length, OVERVIEW_INSIGHT_SLOTS);
  assert.equal(
    fates.filter((f) => f === 'all-insights-only').length,
    MAX_SERVED_INSIGHTS - OVERVIEW_INSIGHT_SLOTS
  );
  assert.equal(
    fates.filter((f) => f === 'not-served').length,
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

  const { fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  assert.equal(fateOf('highest'), 'on-overview', 'the best insight reaches the screen');
  assert.equal(fateOf('lowest'), 'not-served', 'the worst is cut');
});

test('a pool smaller than the feed cuts nothing', () => {
  const generated = Array.from({ length: 3 }, (_, i) => synthetic(`i-${i}`, 10 - i));
  const { served, fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  assert.equal(served.length, 3);
  assert.ok(
    generated.every((i) => fateOf(i.id) === 'on-overview'),
    'with 3 insights and 5 slots, everything shows — the state TSC is actually in'
  );
});

// ---------------------------------------------------------------------------
// What review found this page getting wrong, pinned so it cannot come back.
//
// The first version modelled TWO surfaces (loader → Overview) when there are
// THREE: `/league/[slug]/insights` renders every served insight, and only the
// Overview cuts at five. It also ignored that `OverviewPanel` fills any empty
// Overview slots with client-derived fallback cards — so on a thin feed it
// reported "On the Overview: 2" while the Overview rendered 5.
// ---------------------------------------------------------------------------

test('the Overview shortfall is reported, because fallback cards hide it', () => {
  // Two engine insights for five Overview slots: the reader sees five cards.
  const generated = Array.from({ length: 2 }, (_, i) => synthetic(`i-${i}`, 10 - i));
  const { served } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  const onOverview = Math.min(served.length, OVERVIEW_INSIGHT_SLOTS);
  const fillerSlots = Math.max(0, OVERVIEW_INSIGHT_SLOTS - served.length);

  assert.equal(onOverview, 2, 'the engine supplies two');
  assert.equal(fillerSlots, 3, 'and three slots are covered by fallback — the thing that hides it');
});

test('a full engine feed reports no shortfall', () => {
  const generated = Array.from({ length: 8 }, (_, i) => synthetic(`i-${i}`, 100 - i));
  const { served } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  assert.equal(Math.max(0, OVERVIEW_INSIGHT_SLOTS - served.length), 0, 'no fallback needed');
});

test('insights below the Overview cut are still on the All Insights page', () => {
  // The label said "Served, not shown". They ARE shown — just not on the
  // Overview. Eight generated: five on the Overview, three All-Insights-only,
  // none cut, because eight is under the serving cap of ten.
  const generated = Array.from({ length: 8 }, (_, i) => synthetic(`i-${i}`, 100 - i));
  const { fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  const fates = generated.map((i) => fateOf(i.id));
  assert.equal(fates.filter((f) => f === 'on-overview').length, OVERVIEW_INSIGHT_SLOTS);
  assert.equal(
    fates.filter((f) => f === 'all-insights-only').length,
    3,
    'these reach a reader — on the All Insights page'
  );
  assert.equal(fates.filter((f) => f === 'not-served').length, 0, 'nothing is cut under the cap');
});

test('the pool/feed verdict is measured against the OVERVIEW cap, not the loader cap', () => {
  // THE contradiction review found: with 7 generated the old page compared
  // against the loader cap of 10, printed "nothing to rotate", and listed two
  // rows that do not reach the Overview on the very same screen.
  const generated = Array.from({ length: 7 }, (_, i) => synthetic(`i-${i}`, 100 - i));
  const { fateOf } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  const beyondOverview = generated.filter((i) => fateOf(i.id) !== 'on-overview').length;
  assert.equal(beyondOverview, 2, 'two insights do not reach the Overview');

  // The verdict the page renders must agree with that.
  assert.equal(
    generated.length > OVERVIEW_INSIGHT_SLOTS,
    true,
    'so the pool DOES exceed the feed — rotation would have material'
  );
  assert.equal(
    generated.length > MAX_SERVED_INSIGHTS,
    false,
    'while the old comparison said otherwise — this is the contradiction'
  );
});

// ---------------------------------------------------------------------------
// A generator that CRASHES must not look like one with nothing to say.
//
// Review found the first version reporting a throwing generator as
// `produced: 0, skippedBy: null` — while the comment two lines above claimed a
// failing generator "IS something to see". A mutation restoring that behaviour
// passed every test, which is how I know the fix needed this.
// ---------------------------------------------------------------------------

function fakeGenerator(overrides: Partial<InsightGenerator> = {}): InsightGenerator {
  return {
    id: 'fake:test',
    category: 'historical',
    supportedLifecycles: ['preseason', 'season' as never],
    generate: () => [],
    ...overrides,
  } as InsightGenerator;
}

const fakeContext = { lifecycleState: 'preseason', usingArchivedRoster: false } as never;

test('a generator that throws is reported as an error, not as zero', () => {
  const result = runGeneratorForDiagnostics(
    fakeGenerator({
      generate: () => {
        throw new Error('boom');
      },
    }),
    fakeContext
  );

  assert.equal(result.skippedBy, 'error', 'the crash is visible');
  assert.deepEqual(result.produced, [], 'and it does not take the page down');
});

test('a generator that simply has nothing to say is NOT reported as an error', () => {
  const result = runGeneratorForDiagnostics(fakeGenerator({ generate: () => [] }), fakeContext);

  assert.equal(result.skippedBy, null, 'quiet is not the same as broken');
  assert.deepEqual(result.produced, []);
});

test('a generator outside this lifecycle is distinguished from both', () => {
  const result = runGeneratorForDiagnostics(
    fakeGenerator({ supportedLifecycles: ['postseason'] }),
    fakeContext
  );

  assert.equal(result.skippedBy, 'lifecycle');
});

test('zero-and-negative-score insights are dropped, matching the engine', () => {
  const result = runGeneratorForDiagnostics(
    fakeGenerator({
      generate: () => [synthetic('keep', 5), synthetic('drop-zero', 0), synthetic('drop-neg', -1)],
    }),
    fakeContext
  );

  assert.deepEqual(
    result.produced.map((i) => i.id),
    ['keep'],
    'the page must apply the same positive-score filter production does'
  );
});

// ---------------------------------------------------------------------------
// Round 2 — the claims the PAGE makes, each pinned to a field.
//
// Both round-1 errors were prose that outran the data: a shortfall reported as
// "covered by fallback" (untrue in preseason, where there is none), and a year
// chosen by reasoning rather than by reading what the Overview asks for.
// Everything else that round got a test; the sentence did not.
// ---------------------------------------------------------------------------

test('the shortfall is a shortfall — it claims nothing about fallback', () => {
  const generated = Array.from({ length: 2 }, (_, i) => synthetic(`i-${i}`, 10 - i));
  const { served } = classifyInsightFunnel(generated, OVERVIEW_INSIGHT_SLOTS, 'preseason');

  const unfilled = Math.max(0, OVERVIEW_INSIGHT_SLOTS - served.length);
  assert.equal(unfilled, 3, 'three slots the engine did not fill');

  // The page must NOT assert those three are covered. In preseason
  // `deriveLeagueInsights` returns nothing (no owner has played), so the real
  // fallback count there is zero — the old copy would have said three.
  const src = readFileSync(
    fileURLToPath(new URL('../../../components/admin/InsightsDiagnostics.tsx', import.meta.url)),
    'utf8'
  );
  assert.ok(
    !/are covered by fallback/.test(src),
    'the page must not assert the unfilled slots ARE covered'
  );
  assert.ok(/may substitute/.test(src), 'it may say fallback MAY substitute — that much is true');
});

test('the recap cap is derived from the slot count, not a second literal', () => {
  assert.equal(
    OVERVIEW_INSIGHT_SLOTS_WITH_RECAP,
    OVERVIEW_INSIGHT_SLOTS - 1,
    'the recap row takes exactly one slot — widening the slots must carry through'
  );
});

test('a crashed generator sorts above the quiet ones', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  // No generator throws on this fixture, so assert the ORDERING RULE holds on
  // the real output: every error (none here) precedes every non-error, and
  // produced counts descend after that.
  const errorIdx = model.generators
    .map((g, i) => (g.skippedBy === 'error' ? i : -1))
    .filter((i) => i >= 0);
  const nonErrorIdx = model.generators
    .map((g, i) => (g.skippedBy === 'error' ? -1 : i))
    .filter((i) => i >= 0);
  if (errorIdx.length > 0) {
    assert.ok(Math.max(...errorIdx) < Math.min(...nonErrorIdx), 'errors come first');
  }

  const produced = model.generators.filter((g) => !g.skippedBy).map((g) => g.produced);
  assert.deepEqual(
    produced,
    [...produced].sort((a, b) => b - a),
    'then most productive first'
  );
});

test('a store failure is REPORTED, not thrown — the page survives what it explains', async () => {
  // No league seeded: `buildLeagueInsightContext` throws "League not found",
  // which stands in for the store failures it deliberately does not swallow.
  const model = await buildInsightsDiagnostics('no-such-league', YEAR);

  assert.ok(model.contextError, 'the failure is carried in the model');
  assert.match(String(model.contextError), /not found/);
  assert.equal(model.counts.generated, 0, 'and the counts are honest about knowing nothing');
  assert.deepEqual(model.generators, []);
  assert.deepEqual(model.insights, []);
});

test('a healthy league carries no context error', async () => {
  await seedLeagueWithHistory();
  const model = await buildInsightsDiagnostics(SLUG, YEAR);
  assert.equal(
    model.contextError,
    null,
    'or the error state would be indistinguishable from health'
  );
});

// ---------------------------------------------------------------------------
// Round 3 — the failure view must be readable and must not leak.
// ---------------------------------------------------------------------------

test('a connection string is redacted out of the reported failure', () => {
  const leaked =
    'connect ECONNREFUSED postgres://appuser:hunter2@db.internal.example:5432/cfb — check config';
  const safe = redactConnectionDetails(leaked);

  assert.ok(!safe.includes('hunter2'), 'credentials must not reach the page');
  assert.ok(!safe.includes('db.internal.example'), 'nor the host');
  assert.ok(
    safe.includes('ECONNREFUSED'),
    'while the diagnostic part survives — it is the payload'
  );
});

test('an ordinary message is left intact', () => {
  const plain = "League 'nope' not found";
  assert.equal(redactConnectionDetails(plain), plain, 'redaction must not eat useful text');
});

test('the failure alert has a LIGHT palette, not dark-only', () => {
  // The first version was copied from an always-dark draft surface. On this
  // themed admin page that made the one message the page exists to deliver in a
  // failure state near-invisible in light mode.
  const src = readFileSync(
    fileURLToPath(new URL('../../../components/admin/InsightsDiagnostics.tsx', import.meta.url)),
    'utf8'
  );
  const alert = src.slice(src.indexOf('role="alert"'), src.indexOf('role="alert"') + 400);

  assert.match(alert, /bg-red-50\b/, 'a light background layer');
  assert.match(alert, /text-red-900\b/, 'and readable light-mode text');
  assert.match(alert, /dark:bg-red-950/, 'with the dark variant layered on top');
});

test('WIRING: a leaky store failure reaches the page redacted', async () => {
  // Testing `redactConnectionDetails` alone proved nothing about the model:
  // a mutation removing the call from `buildInsightsDiagnostics` passed every
  // test. This drives a real store failure through the real path.
  await seedLeagueWithHistory();

  __setAppStateReadFailureForTests(
    new Error('connect ECONNREFUSED postgres://appuser:hunter2@db.internal.example:5432/cfb')
  );
  try {
    const model = await buildInsightsDiagnostics(SLUG, YEAR);

    assert.ok(model.contextError, 'the failure is reported rather than thrown');
    assert.ok(!String(model.contextError).includes('hunter2'), 'credentials redacted end to end');
    assert.ok(
      !String(model.contextError).includes('db.internal.example'),
      'and the host with them'
    );
    assert.match(String(model.contextError), /ECONNREFUSED/, 'the diagnosis survives');
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

test('the funnel classifies against DECAYED scores, as production ranks them', () => {
  // Removing the decay from `classifyInsightFunnel` failed nothing until this
  // existed. Production decays before capping, so without the same projection
  // this page reported a draft insight's score as 74 while production ranked it
  // at 26 — and, because the sort order differed, could show "On the Overview"
  // for a card production had cut. The page's own contract is that it cannot
  // disagree with production about the funnel.
  const draftInsight = {
    id: 'draft-fact',
    type: 'self_schedule_heavy',
    title: 'Playing themselves',
    description: 'x',
    priorityScore: 74,
    decay: 'draft',
    newsHook: 'snapshot',
    statValue: 8,
  } as unknown as Insight;
  const fresh = {
    id: 'fresh',
    type: 'drought',
    title: 'Drought',
    description: 'y',
    priorityScore: 40,
    newsHook: 'snapshot',
    statValue: 1,
  } as unknown as Insight;

  // In PRESEASON the draft fact outranks the fresher one.
  const pre = classifyInsightFunnel([fresh, draftInsight], 1, 'preseason');
  assert.equal(pre.served[0]?.id, 'draft-fact', 'undecayed, it leads');
  assert.equal(pre.fateOf('draft-fact'), 'on-overview');

  // LATE SEASON it decays to 26 and the fresher insight takes the slot.
  const late = classifyInsightFunnel([fresh, draftInsight], 1, 'late_season');
  assert.equal(late.served[0]?.id, 'fresh', 'decayed, it loses the slot');
  assert.equal(late.fateOf('draft-fact'), 'all-insights-only');
  assert.ok(
    (late.served.find((i) => i.id === 'draft-fact')?.priorityScore ?? 74) < 74,
    'and the score the page reports is the decayed one'
  );
});

test('the page reports a membership CONTRADICTION rather than calling it publishable', async () => {
  // The field exists so "the generator and the diagnostics page cannot disagree
  // about why a feed is silent" (context.ts). For one round it was resolved and
  // then never put on the diagnostics model, so in the exact state it was added
  // for — a list re-confirmed after the draft published — the generator returned
  // nothing while the page said "publishable ... naming N owners" and the
  // generator row showed a bare `gated`.
  await seedLeagueWithHistory();

  // A confirmed draft naming three owners...
  const picks = ['Alice', 'Bob', 'Carol'].map((owner, i) => ({
    pickNumber: i + 1,
    round: 1,
    roundPick: i + 1,
    owner,
    team: ['Georgia', 'Clemson', 'Alabama'][i]!,
    pickedAt: '2026-08-01T00:00:00.000Z',
    autoSelected: false,
  }));
  await setAppState(draftScope(SLUG), String(YEAR), {
    leagueSlug: SLUG,
    year: YEAR,
    phase: 'complete',
    owners: ['Alice', 'Bob', 'Carol'],
    settings: { rounds: 1, timerSeconds: 60, order: ['Alice', 'Bob', 'Carol'] },
    picks,
    currentPickIndex: picks.length,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    publishedPicks: draftPicksSignature(picks),
  } as unknown as Parameters<typeof setAppState>[2]);
  // ...and a confirmed owner list naming a FOURTH who never drafted.
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Alice', 'Bob', 'Carol', 'Dave']);

  const model = await buildInsightsDiagnostics(SLUG, YEAR);

  assert.deepEqual(
    model.membership.membershipDisagreement,
    ['Dave'],
    'the page must name who the two records disagree about'
  );
  // Not asserting `skippedBy` here: this fixture's lifecycle skips the generator
  // BEFORE the contradiction gate is reached, so the field reports `lifecycle`
  // and would pin the wrong thing. The `gated` labelling is covered directly, on
  // a lifecycle that runs, in `membership.test.ts`.
  assert.ok(
    model.membership.seasonOwners,
    'control: a confirmed draft IS present, so this is the contradiction case and not the ordinary withheld one'
  );
});
