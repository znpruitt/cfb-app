import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';

import type { AppGame } from '../../../lib/schedule';
import { parseInsightsPayload, useInsightsFeed } from '../useInsightsFeed';

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

function recapResponse(week: number, owner = `Owner ${week}`): Response {
  return new Response(
    JSON.stringify({
      insights: [{ id: `insight-${week}` }],
      lifecycleState: 'mid_season',
      generatedAt: '2026-09-01T00:00:00.000Z',
      weeklyRecap: {
        status: 'available',
        week,
        weekLabel: `Week ${week}`,
        latestGameDate: week === 1 ? '2026-08-30' : '2026-09-06',
        headline: `${owner} takes the week at 1–0`,
        isIncomplete: false,
        ownerLines: [{ owner, recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' }],
      },
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
