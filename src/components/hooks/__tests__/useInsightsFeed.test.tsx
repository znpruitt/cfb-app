import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';

import { parseInsightsPayload, useInsightsFeed, useForwardLook } from '../useInsightsFeed';
import { deriveStandings } from '../../../lib/standings';
import { prepareForwardLookPayload } from '../../../lib/recap/composeForwardLook';
import {
  forwardContext,
  forwardScore,
  forwardOdds,
  addRivalry,
  FORWARD_NOW,
  FORWARD_SCOPE,
} from '../../../test/forwardLookFixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
(globalThis as { self: Window }).self = dom.window as unknown as Window;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

const originalFetch = globalThis.fetch;
const ACTIVE_STATUS = { state: 'season', year: 2026 } as const;

function availableRecapPayload(week: number, owner = `Owner ${week}`) {
  return {
    status: 'available',
    week,
    weekLabel: `Week ${week}`,
    latestGameDate: week === 1 ? '2026-08-30' : '2026-09-06',
    headline: `${owner} takes the week at 1–0`,
    isIncomplete: false,
    ownerLines: [{ owner, recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' }],
    leaderLines: [
      {
        id: 'best-record',
        label: 'Best record',
        value: '1–0',
        context: `${owner} · 31 PF`,
      },
    ],
    tileLeaderLines: [
      {
        id: 'best-record',
        label: 'Best record',
        value: '1–0',
        context: `${owner} · 31 PF`,
      },
    ],
    movementLines: [],
    recordChangeLines: [],
    headToHeadLines: [],
    notableResultLines: [],
    tileHighlights: [],
  };
}

function recapResponse(week: number, owner = `Owner ${week}`): Response {
  return new Response(
    JSON.stringify({
      insights: [{ id: `insight-${week}` }],
      lifecycleState: 'mid_season',
      generatedAt: '2026-09-01T00:00:00.000Z',
      weeklyRecap: availableRecapPayload(week, owner),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('Forward Look is cleared on request failure and league-scope change while the standing feed survives', async () => {
  const look = prepareForwardLookPayload(
    { status: 'available', context: forwardContext() },
    FORWARD_SCOPE
  )!;
  let fail = false;
  globalThis.fetch = (async () => {
    if (fail) throw new Error('offline');
    return new Response(
      JSON.stringify({
        insights: [{ id: 'standing' }],
        weeklyRecap: availableRecapPayload(1),
        forwardLook: look,
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  const view = renderHook(
    ({ slug }) =>
      useInsightsFeed({
        leagueSlug: slug,
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick: FORWARD_NOW.getTime(),
      }),
    { initialProps: { slug: 'tsc' } }
  );
  await waitFor(() => assert.equal(view.result.current.forwardLook?.seasonYear, 2026));
  fail = true;
  act(() => view.result.current.refreshInsights());
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'unavailable'));
  assert.equal(
    view.result.current.forwardLook,
    null,
    'failed reads cannot leave forward claims behind'
  );
  assert.equal(view.result.current.insights.length, 1, 'standing feed is preserved');
  fail = false;
  act(() => view.result.current.refreshInsights());
  await waitFor(() => assert.ok(view.result.current.forwardLook));
  view.rerender({ slug: '' });
  assert.equal(
    view.result.current.forwardLook,
    null,
    'slugless surface cannot retain another league preview'
  );
});

test('invalid recap data cannot empty an otherwise healthy insights payload', () => {
  const parsed = parseInsightsPayload({
    insights: [{ id: 'healthy-insight' }],
    lifecycleState: 'mid_season',
    weeklyRecap: { status: 'available', week: 'not-a-number' },
  });

  assert.equal(parsed.insights.length, 1);
  assert.equal(parsed.lifecycleState, 'mid_season');
  assert.deepEqual(parsed.weeklyRecap, { status: 'unavailable' });
});

test('an older recap remains available when additive detail fields are absent', () => {
  const recap = availableRecapPayload(1, 'Alice');
  Reflect.deleteProperty(recap, 'leaderLines');
  Reflect.deleteProperty(recap, 'tileLeaderLines');
  Reflect.deleteProperty(recap, 'movementLines');
  Reflect.deleteProperty(recap, 'recordChangeLines');
  Reflect.deleteProperty(recap, 'headToHeadLines');
  Reflect.deleteProperty(recap, 'notableResultLines');
  Reflect.deleteProperty(recap, 'tileHighlights');
  const parsed = parseInsightsPayload({
    insights: [{ id: 'healthy-insight' }],
    weeklyRecap: recap,
  });

  assert.equal(parsed.weeklyRecap.status, 'available');
  if (parsed.weeklyRecap.status !== 'available') return;
  assert.deepEqual(parsed.weeklyRecap.leaderLines, []);
  assert.deepEqual(parsed.weeklyRecap.tileLeaderLines, []);
  assert.deepEqual(parsed.weeklyRecap.movementLines, []);
  assert.deepEqual(parsed.weeklyRecap.recordChangeLines, []);
  assert.deepEqual(parsed.weeklyRecap.headToHeadLines, []);
  assert.deepEqual(parsed.weeklyRecap.notableResultLines, []);
  assert.deepEqual(parsed.weeklyRecap.tileHighlights, []);
});

test('malformed present detail fields fail only the recap', () => {
  for (const [field, malformed] of [
    ['leaderLines', [{ id: 'best-record' }]],
    ['tileLeaderLines', 'not-an-array'],
    ['movementLines', [{ owner: 'Alice', direction: 'sideways' }]],
    ['recordChangeLines', [{ kind: 'record-change', id: 'record' }]],
    ['headToHeadLines', [{ kind: 'game', id: 'game' }]],
    ['notableResultLines', 'not-an-array'],
    ['tileHighlights', [{ kind: 'unknown' }]],
  ] as const) {
    const parsed = parseInsightsPayload({
      insights: [{ id: 'healthy-insight' }],
      lifecycleState: 'mid_season',
      weeklyRecap: { ...availableRecapPayload(1, 'Alice'), [field]: malformed },
    });

    assert.equal(parsed.insights.length, 1, `${field} must not empty the feed`);
    assert.deepEqual(parsed.weeklyRecap, { status: 'unavailable' });
  }
});

test('a stale response cannot overwrite a newer league request', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return calls === 1 ? first.promise : second.promise;
  }) as typeof fetch;

  const view = renderHook(
    ({ leagueSlug }) =>
      useInsightsFeed({
        leagueSlug,
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick: Date.parse('2026-09-07T16:00:00.000Z'),
      }),
    { initialProps: { leagueSlug: 'alpha' } }
  );

  view.rerender({ leagueSlug: 'beta' });
  await act(async () => {
    second.resolve(recapResponse(2, 'Beta'));
    await second.promise;
  });
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'available'));
  assert.match(
    view.result.current.weeklyRecap.status === 'available'
      ? (view.result.current.weeklyRecap.headline ?? '')
      : '',
    /Beta/
  );

  await act(async () => {
    first.resolve(recapResponse(1, 'Alpha'));
    await first.promise;
  });
  assert.equal(calls, 2);
  assert.match(
    view.result.current.weeklyRecap.status === 'available'
      ? (view.result.current.weeklyRecap.headline ?? '')
      : '',
    /Beta/
  );
});

test('non-Overview surfaces skip the feed request until the Overview is entered', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return recapResponse(1);
  }) as typeof fetch;

  const view = renderHook(
    ({ enabled }) =>
      useInsightsFeed({
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick: Date.parse('2026-09-07T16:00:00.000Z'),
        enabled,
      }),
    { initialProps: { enabled: false } }
  );

  await act(async () => Promise.resolve());
  assert.equal(calls, 0, 'disabled is the negative observation');
  assert.equal(view.result.current.weeklyRecap.status, 'inactive');

  view.rerender({ enabled: true });
  await waitFor(() => assert.equal(calls, 1));
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'available'));
});

test('the open page refetches exactly once at 06:00 ET without a usable client schedule', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return recapResponse(calls === 1 ? 1 : 2);
  }) as typeof fetch;
  const view = renderHook(
    ({ nowTick }) =>
      useInsightsFeed({
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick,
      }),
    { initialProps: { nowTick: Date.parse('2026-09-07T09:59:00.000Z') } }
  );

  await waitFor(() => {
    assert.equal(view.result.current.weeklyRecap.status, 'available');
    if (view.result.current.weeklyRecap.status === 'available') {
      assert.equal(view.result.current.weeklyRecap.week, 1);
    }
  });
  assert.equal(calls, 1);

  view.rerender({ nowTick: Date.parse('2026-09-07T10:00:00.000Z') });
  await waitFor(() => {
    assert.equal(view.result.current.weeklyRecap.status, 'available');
    if (view.result.current.weeklyRecap.status === 'available') {
      assert.equal(view.result.current.weeklyRecap.week, 2);
    }
  });
  assert.equal(calls, 2);

  view.rerender({ nowTick: Date.parse('2026-09-07T10:01:00.000Z') });
  await act(async () => Promise.resolve());
  assert.equal(calls, 2);
});

test('a failed boundary refresh preserves the healthy standing feed', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return recapResponse(1);
    throw new Error('temporary network failure');
  }) as typeof fetch;

  const view = renderHook(
    ({ nowTick }) =>
      useInsightsFeed({
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick,
      }),
    { initialProps: { nowTick: Date.parse('2026-09-07T09:59:00.000Z') } }
  );

  await waitFor(() => {
    assert.equal(view.result.current.weeklyRecap.status, 'available');
    assert.equal(view.result.current.insights.length, 1);
  });

  view.rerender({ nowTick: Date.parse('2026-09-07T10:00:00.000Z') });
  await waitFor(() => assert.equal(calls, 2));
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'unavailable'));
  assert.equal(calls, 2);
  assert.equal(view.result.current.insights.length, 1);
  assert.equal(view.result.current.lifecycleState, 'mid_season');
});

test('context delivery remains scoped when a late response arrives after a league switch', async () => {
  const pending = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (async () =>
    ++calls === 1
      ? pending.promise
      : new Response(
          JSON.stringify({ forwardLook: { seasonYear: 2026, rivalries: [] } })
        )) as typeof fetch;
  const view = renderHook(
    ({ slug }) =>
      useInsightsFeed({
        leagueSlug: slug,
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick: FORWARD_NOW.getTime(),
      }),
    { initialProps: { slug: 'alpha' } }
  );
  view.rerender({ slug: 'beta' });
  await waitFor(() => assert.deepEqual(view.result.current.forwardLook?.rivalries, []));
  await act(async () =>
    pending.resolve(
      new Response(JSON.stringify({ forwardLook: { seasonYear: 2026, rivalries: null } }))
    )
  );
  assert.deepEqual(
    view.result.current.forwardLook?.rivalries,
    [],
    'old league history cannot replace current context'
  );
  assert.equal(calls, 2, 'scope change is a positive control for fetch observation');
});

test('Forward Look reuses preparation across polls and responds to explicit context updates', () => {
  const context = forwardContext();
  addRivalry(context, ['Alice', 'Alice', 'Alice']);
  const history = prepareForwardLookPayload({ status: 'available', context }, FORWARD_SCOPE)!;
  let scheduleReads = 0;
  const games = context.games.map((game) => ({
    ...game,
    get participants() {
      scheduleReads++;
      return game.participants;
    },
  }));
  const standings = deriveStandings(context.games, context.rosterByTeam, context.scoresByKey).rows;
  const initial: Parameters<typeof useForwardLook>[0] = {
    history,
    games,
    rosterByTeam: context.rosterByTeam,
    oddsByKey: {} as Record<string, ReturnType<typeof forwardOdds>>,
    scoresByKey: context.scoresByKey,
    standings,
    ...FORWARD_SCOPE,
    nowTick: FORWARD_NOW.getTime(),
    scheduleLoaded: true,
    scoresObserved: true,
  };
  const view = renderHook((props) => useForwardLook(props), { initialProps: initial });
  const rerender = (props: typeof initial) => {
    view.rerender(initial);
    view.rerender(props);
  };
  assert.ok(scheduleReads > 0, 'positive control: preparation reads schedule ownership');
  assert.ok(view.result.current?.lines.some((line) => line.value === '4 straight'));
  // Changing a completed game's result must not need to read that game's ownership again.
  let oldGameReads = 0;
  Object.defineProperty(games[0], 'participants', {
    get() {
      oldGameReads++;
      return context.games[0].participants;
    },
  });
  rerender({ ...initial, scoresByKey: { prior: forwardScore(7, 21) } });
  assert.equal(oldGameReads, 0, 'score changes reuse prepared current-season ownership');
  assert.equal(
    view.result.current?.lines.some((line) => line.family === 'rivalry'),
    false,
    'score correction breaks the archived streak immediately'
  );
  rerender({
    ...initial,
    scoresByKey: { prior: { ...forwardScore(), status: 'inprogress' } },
  });
  assert.equal(
    view.result.current?.lines.some((line) => line.family === 'rivalry'),
    false,
    'final regression cannot keep the old streak'
  );
  rerender({ ...initial, scoresByKey: {} });
  assert.equal(
    view.result.current?.lines.some((line) => line.family === 'rivalry'),
    false,
    'removing a final cannot keep the old streak'
  );
  rerender({ ...initial, oddsByKey: { collision: forwardOdds() } });
  assert.ok(
    view.result.current?.lines.some((line) => line.family === 'upset'),
    'odds hydration updates prepared context'
  );
  rerender({
    ...initial,
    rosterByTeam: new Map([
      ['Texas', 'Alice'],
      ['Georgia', 'Alice'],
    ]),
  });
  assert.equal(view.result.current?.lines.length, 0, 'roster reload removes self-matchup claims');
  rerender({
    ...initial,
    games: [...games.slice(0, 1), { ...games[1], rawStatus: 'canceled' }],
  });
  assert.equal(
    view.result.current?.lines.length,
    0,
    'schedule override removes canceled candidates'
  );
  assert.ok(oldGameReads > 0, 'explicit context updates reprepare current-season ownership');
  const updated = forwardContext();
  addRivalry(updated, ['Bob', 'Bob', 'Bob']);
  rerender({
    ...initial,
    history: prepareForwardLookPayload({ status: 'available', context: updated }, FORWARD_SCOPE)!,
  });
  assert.equal(
    view.result.current?.lines.some((line) => line.value === '4 straight'),
    false,
    'history update replaces prepared rivalry evidence'
  );
  rerender({ ...initial, seasonYear: 2025 });
  assert.equal(view.result.current, null, 'another season cannot use this context');
  rerender({ ...initial, leagueStatus: { state: 'offseason' } });
  assert.equal(view.result.current, null, 'inactive lifecycle cannot show current-season claims');
});
