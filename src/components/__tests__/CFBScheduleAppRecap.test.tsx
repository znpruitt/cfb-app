import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import React from 'react';

import CFBScheduleApp from '../CFBScheduleApp';
import { OVERVIEW_SCOREBOARD_GRID_STYLE } from '../OverviewPanel';
import { AppContextProviders } from './_setup/renderWithAppContext';
import { deriveStandings } from '../../lib/standings';
import { composeForwardLook } from '../../lib/recap/composeForwardLook';
import { composeWeeklyRecap } from '../../lib/recap/composeWeeklyRecap';
import {
  forwardContext,
  forwardGame,
  forwardScore,
  addRivalry,
  FORWARD_NOW,
  FORWARD_SCOPE,
} from '../../test/forwardLookFixtures';

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
const originalDateNow = Date.now;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const recapPayload = {
  insights: [],
  lifecycleState: 'mid_season',
  weeklyRecap: {
    status: 'available',
    week: 1,
    weekLabel: 'Week 1',
    latestGameDate: '2026-08-30',
    headline: 'Alice takes the week at 1–0',
    isIncomplete: false,
    ownerLines: [{ owner: 'Alice', recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' }],
    leaderLines: [
      {
        id: 'best-record',
        label: 'Best record',
        value: '1–0',
        context: 'Alice · 31 PF',
      },
    ],
    tileLeaderLines: [
      {
        id: 'best-record',
        label: 'Best record',
        value: '1–0',
        context: 'Alice · 31 PF',
      },
    ],
    movementLines: [],
  },
};

function installFetch(
  scheduleItems: unknown[] | null,
  payload: unknown = recapPayload,
  ownersCsv: string | null = null
): {
  insightsCalls: () => number;
  scheduleCalls: () => number;
} {
  let insightsCalls = 0;
  let scheduleCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/insights/')) {
      insightsCalls += 1;
      return jsonResponse(payload);
    }
    if (url.startsWith('/api/schedule')) {
      scheduleCalls += 1;
      return scheduleItems === null
        ? jsonResponse({ error: 'unavailable' }, 503)
        : jsonResponse({ items: scheduleItems, meta: { source: 'cache' } });
    }
    if (url.startsWith('/api/aliases')) return jsonResponse({ map: {} });
    if (url.startsWith('/api/owners')) {
      return jsonResponse({ year: 2026, csvText: ownersCsv, hasStoredValue: ownersCsv !== null });
    }
    if (url.startsWith('/api/postseason-overrides')) {
      return jsonResponse({ year: 2026, map: {}, hasStoredValue: false });
    }
    if (url.startsWith('/api/teams')) {
      return jsonResponse({
        items: [
          { school: 'Alabama', subdivision: 'fbs', conference: 'SEC' },
          { school: 'Georgia', subdivision: 'fbs', conference: 'SEC' },
        ],
      });
    }
    if (url.startsWith('/api/conferences')) return jsonResponse({ items: [] });
    if (url.startsWith('/api/rankings')) {
      return jsonResponse({
        weeks: [],
        latestWeek: null,
        meta: {
          source: 'cfbd',
          cache: 'hit',
          generatedAt: '2026-09-01T14:00:00.000Z',
        },
      });
    }
    if (url.startsWith('/api/draft/')) return jsonResponse({});
    return jsonResponse({});
  }) as typeof fetch;

  return { insightsCalls: () => insightsCalls, scheduleCalls: () => scheduleCalls };
}

function renderApp(
  initialIssues: string[] = [],
  props: Partial<React.ComponentProps<typeof CFBScheduleApp>> = {}
): ReturnType<typeof render> {
  return render(
    <CFBScheduleApp
      leagueSlug="tsc"
      leagueYear={2026}
      leagueStatus={{ state: 'season', year: 2026 }}
      initialIssues={initialIssues}
      {...props}
    />,
    { wrapper: AppContextProviders }
  );
}

beforeEach(() => {
  Date.now = () => Date.parse('2026-09-01T14:00:00.000Z');
  window.localStorage.clear();
});

test('Overview replaces the recap at the real cutoff and keeps an empty Forward Look before the podium', async () => {
  const context = forwardContext();
  context.rosterByTeam.clear();
  const result = { status: 'available' as const, context };
  const before = new Date(FORWARD_NOW.getTime() - 60_000);
  const payload = {
    ...recapPayload,
    weeklyRecap: composeWeeklyRecap(result, before, FORWARD_SCOPE),
    forwardLook: composeForwardLook(result, before, FORWARD_SCOPE),
  };
  Date.now = () => before.getTime();
  installFetch(
    [
      {
        id: 'next',
        week: 6,
        startDate: '2026-10-10T19:00:00Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Alabama',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    payload
  );
  let rendered = renderApp();
  await waitFor(() => assert.ok(rendered.getByText('Weekly recap')));
  assert.equal(
    rendered.queryByText('Forward look') === null,
    true,
    'recap owns the pre-cutoff slot'
  );
  rendered.unmount();
  Date.now = () => FORWARD_NOW.getTime();
  rendered = renderApp();
  await waitFor(() => assert.ok(rendered.getByRole('heading', { name: 'Week 6 ahead' })));
  assert.equal(
    rendered.queryByText('Weekly recap') === null,
    true,
    'exact cutoff replaces the recap'
  );
  const tile = rendered.getByText('Forward look').closest('section')!;
  await waitFor(() => assert.ok(rendered.getByText('League summary')));
  const podium = rendered.getByText('League summary').closest('section')!;
  assert.ok(
    tile.compareDocumentPosition(podium) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'empty tile remains above podium'
  );
});

test('Forward Look leaves the watchlist, Insights panel and scoreboard grid unchanged', async () => {
  Date.now = () => FORWARD_NOW.getTime();
  const result = { status: 'available' as const, context: forwardContext() };
  const payload = {
    ...recapPayload,
    insights: [
      {
        id: 'standing-insight',
        type: 'race',
        title: 'Standing insight stays here',
        description: 'The league race continues',
        priorityScore: 100,
      },
    ],
    weeklyRecap: composeWeeklyRecap(result, FORWARD_NOW, FORWARD_SCOPE),
    forwardLook: composeForwardLook(result, FORWARD_NOW, FORWARD_SCOPE),
  };
  const schedule = [
    {
      id: 'upcoming',
      week: 6,
      startDate: '2026-10-10T19:00:00Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular',
    },
  ];
  const observe = async (withLook: boolean) => {
    installFetch(
      schedule,
      { ...payload, forwardLook: withLook ? payload.forwardLook : null },
      'team,owner\nAlabama,Alice\nGeorgia,Bob\n'
    );
    const c = result.context;
    const rendered = renderApp([], {
      canonicalStandings: {
        slug: 'tsc',
        year: 2026,
        source: 'live',
        lifecycle: 'mid_season',
        rows: deriveStandings(c.games, c.rosterByTeam, c.scoresByKey).rows,
        noClaimRow: null,
        ownerColorOrder: ['Alice', 'Bob'],
        standingsHistory: null,
        coverage: { state: 'complete', message: null },
        ownersRosterSource: 'csv',
        archiveYearResolved: null,
        inferredSeasonStart: null,
        generatedAt: FORWARD_NOW.toISOString(),
      },
    });
    await waitFor(() => assert.ok(rendered.getByText('Upcoming watchlist')));
    await waitFor(() => assert.ok(rendered.getByText('Standing insight stays here')));
    if (withLook) await waitFor(() => assert.ok(rendered.getByText('Forward look')));
    const grid = rendered.container.querySelector('[data-watchlist-scoreboard-grid]')!;
    assert.ok(grid, 'observer sees the real scoreboard grid');
    const observation = {
      watchlist: rendered.getByText('Upcoming watchlist').closest('section')!.textContent,
      insights: rendered.getByText('Insights').parentElement!.parentElement!.textContent,
      grid: {
        text: grid.textContent,
        className: grid.className,
        style: grid.getAttribute('style'),
      },
    };
    rendered.unmount();
    return observation;
  };
  const baseline = await observe(false);
  const occupied = await observe(true);
  assert.deepEqual(occupied.watchlist, baseline.watchlist, 'watchlist content stays unchanged');
  assert.deepEqual(occupied.insights, baseline.insights, 'Insights content stays unchanged');
  assert.deepEqual(occupied.grid, baseline.grid, 'scoreboard content and geometry stay unchanged');
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
});

test('Overview keeps a fetched recap visible when client schedule bootstrap fails', async () => {
  const calls = installFetch(null);
  const rendered = renderApp(['CFBD schedule load failed: upstream returned 503']);

  await waitFor(() => {
    assert.ok(rendered.getByRole('heading', { name: 'Alice takes the week at 1–0' }));
  });
  assert.match(rendered.container.textContent ?? '', /schedule isn.t available right now/);
  assert.equal(calls.insightsCalls(), 1);
  assert.equal(calls.scheduleCalls(), 1);
});

test('Overview keeps the recap tile before its podium when the schedule succeeds', async () => {
  installFetch([
    {
      id: 'week-1-game',
      week: 1,
      startDate: '2026-09-05T19:00:00.000Z',
      neutralSite: false,
      conferenceGame: true,
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular',
    },
  ]);
  const rendered = renderApp();

  await waitFor(() => {
    assert.ok(rendered.getByText('League summary'));
  });
  const tile = rendered.getByText('Weekly recap').closest('section');
  const podium = rendered.getByText('League summary').closest('section');
  assert.ok(tile);
  assert.ok(podium);
  assert.doesNotMatch(
    tile.className,
    /(?:^|\s)(?:max-w-|w-\[)/,
    'the full-width recap exception must not inherit a scoreboard max-width utility'
  );
  assert.equal(tile.style.maxWidth, '', 'the recap tile must not carry an inline max-width');
  const scoreboardWidthProperties = Object.keys(OVERVIEW_SCOREBOARD_GRID_STYLE);
  assert.ok(scoreboardWidthProperties.length > 0, 'positive control: the cap has inline variables');
  for (const property of scoreboardWidthProperties) {
    assert.equal(
      tile.style.getPropertyValue(property),
      '',
      `the recap tile must not inherit the scoreboard width variable ${property}`
    );
  }
  assert.ok(
    tile.compareDocumentPosition(podium) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'recap stays before the podium in normal flow'
  );
});

for (const existingFinal of [true, false]) {
  test(
    existingFinal
      ? 'Overview seeds existing finals at mount and refreshes for a later final'
      : 'Overview refreshes Forward Look once when its live poll completes an earlier game',
    async (t) => {
      let now = new Date('2026-10-10T19:00:00Z');
      Date.now = () => now.getTime();
      const oldVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      t.after(() => {
        if (oldVisibility) Object.defineProperty(document, 'visibilityState', oldVisibility);
        else delete (document as unknown as Record<string, unknown>).visibilityState;
      });
      const context = forwardContext();
      context.games[0] = forwardGame('prior', 5, '2026-10-03T19:00:00Z', 'Unowned', 'Other');
      context.games[1].date = '2026-10-10T16:00:00Z';
      context.games.push(forwardGame('repeat', 6, '2026-10-10T23:00:00Z'));
      context.scoresByKey = {};
      if (existingFinal) {
        context.games.push(forwardGame('baseline-final', 6, '2026-10-10T14:00:00Z'));
        context.scoresByKey['baseline-final'] = forwardScore(7, 21);
      }
      addRivalry(context, Array(5).fill('Alice'));
      const schedule = context.games
        .filter((game) => game.canonicalWeek === 6)
        .map((game) => ({
          id: game.key,
          week: 6,
          seasonType: 'regular',
          startDate: game.date,
          homeTeam: 'Texas',
          awayTeam: 'Georgia',
          homeConference: 'SEC',
          awayConference: 'SEC',
          status: 'scheduled',
          completed: false,
          neutralSite: false,
          conferenceGame: true,
        }));
      installFetch(schedule, recapPayload, 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
      const fallback = globalThis.fetch;
      let scoreCalls = 0;
      let insightCalls = 0;
      let final = false;
      let resolveBootstrap: ((response: Response) => void) | undefined;
      let bootstrapResponse: Response | undefined;
      let resolveRefresh: ((response: Response) => void) | undefined;
      let freshResponse: Response | undefined;
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.startsWith('/api/teams'))
          return jsonResponse({
            items: [
              { school: 'Texas', subdivision: 'fbs', conference: 'SEC' },
              { school: 'Georgia', subdivision: 'fbs', conference: 'SEC' },
            ],
          });
        if (url.startsWith('/api/scores')) {
          scoreCalls++;
          const response = jsonResponse({
            items: [
              ...(existingFinal
                ? [
                    {
                      id: 'baseline-final',
                      week: 6,
                      seasonType: 'regular',
                      startDate: '2026-10-10T14:00:00Z',
                      status: 'final',
                      time: null,
                      home: { team: 'Texas', score: 7 },
                      away: { team: 'Georgia', score: 21 },
                    },
                  ]
                : []),
              {
                id: 'collision',
                week: 6,
                seasonType: 'regular',
                startDate: schedule[0].startDate,
                status: final ? 'final' : 'inprogress',
                time: null,
                home: { team: 'Texas', score: existingFinal && final ? 21 : 7 },
                away: { team: 'Georgia', score: existingFinal && final ? 7 : 21 },
              },
            ],
            meta: { source: 'cache', cache: 'hit' },
          });
          if (scoreCalls === 1) {
            bootstrapResponse = response;
            return new Promise<Response>((resolve) => {
              resolveBootstrap = resolve;
            });
          }
          return response;
        }
        if (url.startsWith('/api/insights/')) {
          insightCalls++;
          const response = jsonResponse({
            ...recapPayload,
            forwardLook: composeForwardLook({ status: 'available', context }, now, FORWARD_SCOPE),
          });
          if (insightCalls === 1) return response;
          freshResponse = response;
          return new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          });
        }
        return fallback(input, init);
      }) as typeof fetch;
      const rendered = renderApp();
      await waitFor(() => assert.equal(scoreCalls, 1));
      await act(async () => resolveBootstrap!(bootstrapResponse!));
      assert.equal(
        insightCalls,
        1,
        existingFinal
          ? 'existing finals at mount produce exactly one Insights request'
          : 'nonfinal bootstrap does not duplicate the Insights request'
      );
      const oldHeading = existingFinal ? /meet one win apart/ : /can break their wins tie/;
      const newHeading = existingFinal ? /can break their wins tie/ : /meet one win apart/;
      await waitFor(() => assert.ok(rendered.getByRole('heading', { name: oldHeading })));
      final = true;
      context.scoresByKey.collision = existingFinal ? forwardScore(21, 7) : forwardScore(7, 21);
      now = new Date('2026-10-10T19:03:00Z');
      act(() => window.dispatchEvent(new dom.window.Event('focus')));
      await waitFor(() => assert.equal(scoreCalls, 2));
      await waitFor(() =>
        assert.equal(
          insightCalls,
          2,
          'the completed-result signal uses exactly one existing refresh'
        )
      );
      await waitFor(() => assert.ok(rendered.getByRole('heading', { name: 'Week 6 ahead' })));
      assert.equal(
        rendered.queryByRole('heading', { name: oldHeading }) === null,
        true,
        'live result invalidates the old claim before the response'
      );
      await act(async () => resolveRefresh!(freshResponse!));
      await waitFor(() => assert.ok(rendered.getByRole('heading', { name: newHeading })));
      assert.equal(
        insightCalls,
        2,
        'finalization callback does not issue a second Insights refresh'
      );
    }
  );
}
