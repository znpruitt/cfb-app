import assert from 'node:assert/strict';
import test from 'node:test';

import { TEST_LEAGUE_SLUG, type League } from '../../league.ts';
import { loadRankingsPublicationContext, selectRankingsTargetYears } from '../automaticContext.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../server/appStateStore.ts';

const YEAR = 2031;
const SCHEDULED_AT = new Date('2031-10-05T22:00:00.000Z');

function league(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2005, // deliberately wrong: selection must NEVER read league.year
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  } as League;
}

function scheduleItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '401',
    week: 1,
    startDate: '2031-08-30T18:00:00.000Z',
    homeTeam: 'Georgia',
    awayTeam: 'Michigan',
    status: 'scheduled',
    seasonType: 'regular',
    ...overrides,
  };
}

function rankingsEntry(polls: { ap?: boolean; coaches?: boolean; cfp?: boolean }) {
  const entryFor = (on: boolean | undefined) =>
    on ? [{ teamId: 'georgia', teamName: 'Georgia', rank: 1, rankSource: 'ap' }] : [];
  return {
    at: 1,
    response: {
      weeks: [
        {
          season: YEAR,
          week: 1,
          seasonType: 'regular',
          primarySource: 'ap',
          teams: [],
          polls: {
            ap: entryFor(polls.ap),
            coaches: entryFor(polls.coaches),
            cfp: entryFor(polls.cfp),
          },
        },
      ],
      latestWeek: null,
      meta: { source: 'cfbd', cache: 'miss', generatedAt: '2031-01-01T00:00:00.000Z' },
    },
  };
}

async function loadContext(lifecycle: 'preseason' | 'season' = 'season') {
  return loadRankingsPublicationContext({ year: YEAR, lifecycle, scheduledAt: SCHEDULED_AT });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setAppStateReadFailureForTests(null);
});

test.after(() => {
  __setAppStateReadFailureForTests(null);
});

// ---------------------------------------------------------------------------
// Target selection (registry-only, never the calendar or league.year)
// ---------------------------------------------------------------------------

// 4 — preseason + season only, distinct ascending status years, season wins.
test('target selection: preseason+season status years ascending; offseason excluded', () => {
  const targets = selectRankingsTargetYears([
    league('a', { state: 'season', year: 2032 }),
    league('b', { state: 'preseason', year: 2031 }),
    league('c', { state: 'offseason' }),
    league('d', { state: 'preseason', year: 2032 }), // mixed year → season wins
    league('e', { state: 'preseason', year: 2031 }), // duplicate → one entry
  ]);
  assert.deepEqual(targets, {
    years: [
      { year: 2031, lifecycle: 'preseason' },
      { year: 2032, lifecycle: 'season' },
    ],
    excludedDemoCandidate: false,
  });
});

test('target selection: season precedence is order-independent', () => {
  const seasonFirst = selectRankingsTargetYears([
    league('a', { state: 'season', year: 2031 }),
    league('b', { state: 'preseason', year: 2031 }),
  ]);
  const preseasonFirst = selectRankingsTargetYears([
    league('b', { state: 'preseason', year: 2031 }),
    league('a', { state: 'season', year: 2031 }),
  ]);
  assert.deepEqual(seasonFirst, {
    years: [{ year: 2031, lifecycle: 'season' }],
    excludedDemoCandidate: false,
  });
  assert.deepEqual(preseasonFirst, seasonFirst);
});

test('target selection: no eligible lifecycle states yields no targets', () => {
  assert.deepEqual(selectRankingsTargetYears([league('c', { state: 'offseason' })]), {
    years: [],
    excludedDemoCandidate: false,
  });
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T4 — production-only target ownership
//
// The demo league is manual-only for automatic rankings publication. It is
// filtered PER LEAGUE inside the ownership loop, so it can contribute neither
// year membership nor lifecycle precedence, and the excluded-candidate fact
// travels back on the same result the years do.
// ---------------------------------------------------------------------------

// CONTRACT PIN — the inputs that must keep `excludedDemoCandidate: false`, so
// the new zero-target reason can never displace `no-ranking-target`. An
// `offseason` or status-less demo record was never an eligible candidate.
test('T4 contract pin: empty, status-less, and offseason-only inputs exclude no candidate', () => {
  const noCandidate = { years: [], excludedDemoCandidate: false };
  assert.deepEqual(selectRankingsTargetYears([]), noCandidate, 'empty registry');
  assert.deepEqual(
    selectRankingsTargetYears([league(TEST_LEAGUE_SLUG, undefined as unknown as League['status'])]),
    noCandidate,
    'demo record with no status'
  );
  assert.deepEqual(
    selectRankingsTargetYears([
      league(TEST_LEAGUE_SLUG, { state: 'offseason' }),
      league('a', { state: 'offseason' }),
    ]),
    noCandidate,
    'offseason demo is not an excluded candidate'
  );
});

// REGRESSION TEST — the demo alone produces no automatic target, and says so.
test('T4 regression: an active demo-only registry yields no years and flags the exclusion', () => {
  assert.deepEqual(
    selectRankingsTargetYears([league(TEST_LEAGUE_SLUG, { state: 'season', year: 2031 })]),
    { years: [], excludedDemoCandidate: true },
    'demo season'
  );
  assert.deepEqual(
    selectRankingsTargetYears([league(TEST_LEAGUE_SLUG, { state: 'preseason', year: 2032 })]),
    { years: [], excludedDemoCandidate: true },
    'demo preseason'
  );
});

// REGRESSION TEST — the demo must not determine a SHARED year's lifecycle.
// Removing the exclusion returns `lifecycle: 'season'` here. This is a
// REPORTING-truth fix: lifecycle is inert in the publication classifier, so no
// window, key, quota gate, or provider request changes with it.
test('T4 regression: demo season(Y) does not outrank production preseason(Y)', () => {
  const both = [
    league(TEST_LEAGUE_SLUG, { state: 'season', year: 2031 }),
    league('alpha', { state: 'preseason', year: 2031 }),
  ];
  assert.deepEqual(selectRankingsTargetYears(both), {
    years: [{ year: 2031, lifecycle: 'preseason' }],
    excludedDemoCandidate: true,
  });
  // Order-independent, exactly as production precedence is.
  assert.deepEqual(selectRankingsTargetYears([...both].reverse()), {
    years: [{ year: 2031, lifecycle: 'preseason' }],
    excludedDemoCandidate: true,
  });
});

// CONTRACT PIN — NOT a regression test. The pre-existing precedence guard
// already prevents `preseason` from displacing a `season` owner, so this passes
// with the exclusion fully removed. It pins that T4 PRESERVED that direction.
test('T4 contract pin: production season(Y) precedence survives a demo preseason(Y)', () => {
  assert.deepEqual(
    selectRankingsTargetYears([
      league(TEST_LEAGUE_SLUG, { state: 'preseason', year: 2031 }),
      league('alpha', { state: 'season', year: 2031 }),
    ]),
    { years: [{ year: 2031, lifecycle: 'season' }], excludedDemoCandidate: true }
  );
});

// REGRESSION TEST — a demo-only year is dropped whole; the production year is
// untouched. Subtracting demo years AFTER grouping would also pass here, which
// is why the shared-year cases above carry that mutation.
test('T4 regression: a demo-only year is dropped while a distinct production year survives', () => {
  assert.deepEqual(
    selectRankingsTargetYears([
      league(TEST_LEAGUE_SLUG, { state: 'preseason', year: 2033 }),
      league('alpha', { state: 'season', year: 2031 }),
    ]),
    { years: [{ year: 2031, lifecycle: 'season' }], excludedDemoCandidate: true }
  );
});

// ---------------------------------------------------------------------------
// Cache-only context loading
// ---------------------------------------------------------------------------

// 5 — missing rankings → all poll flags false; absent schedule → null kickoffs.
test('absent schedule and rankings yield known absence (nulls + false flags)', async () => {
  const result = await loadContext();
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.context.year, YEAR);
  assert.equal(result.context.lifecycle, 'season');
  assert.equal(result.context.scheduledAt, SCHEDULED_AT);
  assert.equal(result.context.firstKickoffAt, null);
  assert.equal(result.context.structuredChampionshipKickoffAt, null);
  assert.equal(result.context.hasAp, false);
  assert.equal(result.context.hasCoaches, false);
  assert.equal(result.context.hasCfp, false);
});

// 5 — earliest canonical kickoff across the season's items.
test('the earliest valid canonical kickoff is derived', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [
      scheduleItem({ id: '2', startDate: '2031-09-06T18:00:00.000Z' }),
      scheduleItem({ id: '1', startDate: '2031-08-30T18:00:00.000Z' }),
      scheduleItem({ id: '3', startDate: null }), // unusable → ignored
      scheduleItem({ id: '4', startDate: 'not-a-date' }), // unusable → ignored
    ],
  });
  const result = await loadContext();
  assert.equal(result.kind, 'ok');
  assert.equal(result.kind === 'ok' && result.context.firstKickoffAt, '2031-08-30T18:00:00.000Z');
});

// 5 — the structured championship comes ONLY from the E1A resolver.
test('the structured CFP championship kickoff is resolved; text inference never applies', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [
      scheduleItem({ id: '1' }),
      // A text-looking championship WITHOUT structured identity — never used.
      scheduleItem({
        id: '2',
        week: 16,
        seasonType: 'postseason',
        startDate: '2032-01-10T00:30:00.000Z',
        notes: 'College Football Playoff National Championship',
      }),
      // The structured row the resolver accepts.
      scheduleItem({
        id: '3',
        week: 17,
        seasonType: 'postseason',
        startDate: '2032-01-12T00:30:00.000Z',
        playoffRoundSource: 'cfbd-structured',
        playoffRound: 'national_championship',
        playoffCompetition: 'College Football Playoff',
      }),
    ],
  });
  const result = await loadContext();
  assert.equal(result.kind, 'ok');
  assert.equal(
    result.kind === 'ok' && result.context.structuredChampionshipKickoffAt,
    '2032-01-12T00:30:00.000Z'
  );
});

// 5 — cross-source poll detection from usable cached ranking weeks.
test('poll flags reflect which sources have usable cached data', async () => {
  await setAppState('rankings', String(YEAR), rankingsEntry({ ap: true, cfp: true }));
  const result = await loadContext();
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.context.hasAp, true);
  assert.equal(result.context.hasCoaches, false);
  assert.equal(result.context.hasCfp, true);
});

// Codex round-1 finding #2 — coverage is scoped to THIS season's weeks: a
// foreign-season week must never mark a source published for the target year.
test('a foreign-season cached week never counts toward this year’s poll coverage', async () => {
  const entry = rankingsEntry({ ap: true });
  (entry.response.weeks[0] as { season: number }).season = YEAR - 1;
  await setAppState('rankings', String(YEAR), entry);
  const result = await loadContext();
  assert.equal(result.kind, 'ok');
  assert.equal(result.kind === 'ok' && result.context.hasAp, false);
});

// Codex round-1 finding #2 — malformed poll values (a string's `.length` is
// truthy) never count as coverage; the year stays refreshable (self-healing),
// not unavailable.
test('malformed poll values never count as coverage', async () => {
  const entry = rankingsEntry({});
  (entry.response.weeks[0] as { polls: Record<string, unknown> }).polls = {
    ap: 'xx',
    coaches: { length: 5 },
    cfp: [],
  };
  await setAppState('rankings', String(YEAR), entry);
  const result = await loadContext();
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.context.hasAp, false);
  assert.equal(result.context.hasCoaches, false);
  assert.equal(result.context.hasCfp, false);
});

// 5 — malformed present records are UNAVAILABLE, never coerced to absence.
test('a present but malformed schedule record is unavailable context', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, { at: 1, items: 'not-an-array' });
  assert.deepEqual(await loadContext(), { kind: 'unavailable' });
});

// Codex round-1 finding #1 — ELEMENT-level schedule corruption is unavailable,
// never usable context that could manufacture kickoff/championship windows.
test('element-level schedule corruption is unavailable context', async () => {
  for (const items of [
    ['corrupt-string'],
    [scheduleItem(), 42],
    [null],
    [scheduleItem(), ['nested-array']],
  ]) {
    await setAppState('schedule', `${YEAR}-all-all`, { at: 1, items });
    assert.deepEqual(await loadContext(), { kind: 'unavailable' }, JSON.stringify(items));
  }
});

// Fields may be legitimately absent on OBJECT items (older records) — that is
// shape variation, not corruption.
test('object items with absent fields remain usable known-shape context', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [{ id: '9' }, scheduleItem()],
  });
  const result = await loadContext();
  assert.equal(result.kind, 'ok');
  assert.equal(result.kind === 'ok' && result.context.firstKickoffAt, '2031-08-30T18:00:00.000Z');
});

test('a present but malformed rankings record is unavailable context', async () => {
  await setAppState('rankings', String(YEAR), { at: 'bogus', response: 42 });
  assert.deepEqual(await loadContext(), { kind: 'unavailable' });
});

// 5 — a genuine store read failure is unavailable context.
test('a schedule store read failure is unavailable context', async () => {
  __setAppStateReadFailureForTests(new Error('store down'), 'schedule');
  try {
    assert.deepEqual(await loadContext(), { kind: 'unavailable' });
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

test('a rankings store read failure is unavailable context', async () => {
  __setAppStateReadFailureForTests(new Error('store down'), 'rankings');
  try {
    assert.deepEqual(await loadContext(), { kind: 'unavailable' });
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});
