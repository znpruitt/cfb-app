import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';

import { selectVisibleForwardLook } from '../../../lib/selectors/forwardLook';
import type { ScorePack } from '../../../lib/scores';
import type { AppGame } from '../../../lib/schedule';
import { parseInsightsPayload, useInsightsFeed } from '../useInsightsFeed';
import { composeForwardLook } from '../../../lib/recap/composeForwardLook';
import {
  forwardContext,
  forwardGame,
  forwardScore,
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

function game(key: string, week: number, date: string): AppGame {
  return {
    key,
    eventId: key,
    eventKey: key,
    week,
    canonicalWeek: week,
    providerWeek: week,
    stage: 'regular',
    stageOrder: 1,
    slotOrder: 0,
    date,
    status: 'scheduled',
    rawStatus: 'scheduled',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: key,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: {
        kind: 'team',
        teamId: `${key}-away`,
        displayName: `${key} Away`,
        canonicalName: `${key} Away`,
        rawName: `${key} Away`,
      },
      home: {
        kind: 'team',
        teamId: `${key}-home`,
        displayName: `${key} Home`,
        canonicalName: `${key} Home`,
        rawName: `${key} Home`,
      },
    },
    csvAway: `${key} Away`,
    csvHome: `${key} Home`,
    canAway: `${key} Away`,
    canHome: `${key} Home`,
    awayConf: 'IND',
    homeConf: 'IND',
  };
}

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
  const look = composeForwardLook(
    { status: 'available', context: forwardContext() },
    FORWARD_NOW,
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
        scoresByKey: {},
        leagueSlug: slug,
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        games: [],
        scheduleLoaded: false,
        nowTick: FORWARD_NOW.getTime(),
      }),
    { initialProps: { slug: 'tsc' } }
  );
  await waitFor(() => assert.equal(view.result.current.forwardLook?.target.week, 6));
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
        scoresByKey: {},
        leagueSlug,
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        games: [],
        scheduleLoaded: false,
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
        scoresByKey: {},
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        games: [],
        scheduleLoaded: false,
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
        scoresByKey: {},
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        games: [],
        scheduleLoaded: false,
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
  const games = [
    game('week-1', 1, '2026-08-30T20:00:00.000Z'),
    game('week-2', 2, '2026-09-07T03:00:00.000Z'),
  ];

  const view = renderHook(
    ({ nowTick }) =>
      useInsightsFeed({
        scoresByKey: {},
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        games,
        scheduleLoaded: true,
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

test('completed results refresh forward premises once, not on clock ticks or live-score churn', async () => {
  const context = forwardContext();
  context.games[0] = forwardGame('prior', 5, '2026-10-03T19:00:00Z', 'Unowned', 'Other');
  context.games[1].date = '2026-10-10T16:00:00Z';
  context.games.push(forwardGame('repeat', 6, '2026-10-10T23:00:00Z'));
  context.scoresByKey = {};
  addRivalry(context, Array(5).fill('Alice'));
  let now = new Date('2026-10-10T10:00:00Z');
  const requests: { response: Response; pending: Deferred<Response> }[] = [];
  globalThis.fetch = (async () => {
    const response = new Response(
      JSON.stringify({
        insights: [{ id: 'standing' }],
        forwardLook: composeForwardLook({ status: 'available', context }, now, FORWARD_SCOPE),
      })
    );
    const pending = deferred<Response>();
    requests.push({ response, pending });
    return pending.promise;
  }) as typeof fetch;
  const view = renderHook(
    ({ scores, tick }: { scores: Record<string, ScorePack>; tick: number }) =>
      useInsightsFeed({
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        games: context.games,
        scheduleLoaded: true,
        scoresByKey: scores,
        nowTick: tick,
      }),
    { initialProps: { scores: {} as Record<string, ScorePack>, tick: now.getTime() } }
  );
  await act(async () => requests[0].pending.resolve(requests[0].response));
  assert.ok(view.result.current.forwardLook?.lines.some((line) => line.value === '5 straight'));
  for (let poll = 1; poll <= 4; poll++) {
    view.rerender({
      scores: { collision: { ...forwardScore(poll, 14), status: 'inprogress' } },
      tick: now.getTime() + poll * 60_000,
    });
  }
  assert.equal(
    requests.length,
    1,
    'clock ticks and nonfinal score changes make no Insights requests'
  );

  now = new Date('2026-10-10T21:00:00Z');
  context.scoresByKey = { collision: forwardScore(7, 21) };
  view.rerender({ scores: context.scoresByKey, tick: now.getTime() });
  assert.equal(requests.length, 2, 'a first-seen completed result makes exactly one refresh');
  assert.equal(
    view.result.current.forwardLook?.lines.length,
    0,
    'old forward premises disappear while the refresh is pending'
  );
  assert.equal(
    view.result.current.forwardLook?.weekLabel,
    'Week 6',
    'pending refresh retains the applicable week frame'
  );
  assert.equal(
    view.result.current.insights.length,
    1,
    'standing feed remains present while refreshing'
  );
  await act(async () => requests[1].pending.resolve(requests[1].response));
  const fresh = selectVisibleForwardLook(view.result.current.forwardLook, now)!;
  assert.match(
    fresh.lines[0].title,
    /one win apart/,
    'refreshed standings replace the obsolete tie'
  );
  assert.equal(
    fresh.lines.some((line) => line.family === 'rivalry'),
    false,
    'refreshed rivalry removes the broken streak'
  );
  view.rerender({
    scores: { collision: { ...forwardScore(7, 21), status: 'Final/OT', time: 'changed' } },
    tick: now.getTime() + 60_000,
  });
  assert.equal(requests.length, 2, 'equivalent final labels and timestamps do not refetch');

  context.scoresByKey = { collision: forwardScore(21, 7) };
  view.rerender({ scores: context.scoresByKey, tick: now.getTime() });
  assert.equal(requests.length, 3, 'a material final correction refreshes once');
  context.scoresByKey = { collision: forwardScore(7, 21) };
  view.rerender({ scores: context.scoresByKey, tick: now.getTime() });
  assert.equal(requests.length, 4);
  await act(async () => requests[3].pending.resolve(requests[3].response));
  await act(async () => requests[2].pending.resolve(requests[2].response));
  assert.equal(
    view.result.current.forwardLook?.lines.length,
    1,
    'a superseded result response cannot clear current narratives'
  );
  assert.equal(
    view.result.current.forwardLook?.lines.some((line) => line.value === '6 straight'),
    false,
    'a superseded result response cannot restore a stale streak'
  );
  assert.equal(
    view.result.current.forwardLook?.lines.some((line) => line.family === 'rivalry'),
    false
  );
});
