import assert from 'node:assert/strict';
import test from 'node:test';

import type { League } from '../../league.ts';
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
  assert.deepEqual(targets, [
    { year: 2031, lifecycle: 'preseason' },
    { year: 2032, lifecycle: 'season' },
  ]);
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
  assert.deepEqual(seasonFirst, [{ year: 2031, lifecycle: 'season' }]);
  assert.deepEqual(preseasonFirst, seasonFirst);
});

test('target selection: no eligible lifecycle states yields no targets', () => {
  assert.deepEqual(selectRankingsTargetYears([league('c', { state: 'offseason' })]), []);
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
