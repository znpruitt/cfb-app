import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import React from 'react';

import CFBScheduleApp from '../CFBScheduleApp';
import { OVERVIEW_SCOREBOARD_GRID_STYLE } from '../OverviewPanel';
import { AppContextProviders } from './_setup/renderWithAppContext';
import { deriveStandings } from '../../lib/standings';
import { prepareForwardLookPayload } from '../../lib/recap/composeForwardLook';
import { composeWeeklyRecap } from '../../lib/recap/composeWeeklyRecap';
import {
  forwardContext,
  forwardGame,
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
    if (url.startsWith('/api/scores'))
      return jsonResponse({
        items: (scheduleItems ?? []).map((raw) => {
          const game = raw as Record<string, unknown>;
          return {
            ...game,
            time: null,
            home: { team: game.homeTeam, score: game.completed ? 21 : null },
            away: { team: game.awayTeam, score: game.completed ? 14 : null },
          };
        }),
        meta: { source: 'cache' },
      });
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
    forwardLook: prepareForwardLookPayload(result, FORWARD_SCOPE),
  };
  Date.now = () => before.getTime();
  installFetch(
    [
      {
        id: 'prior',
        week: 5,
        seasonType: 'regular',
        startDate: '2026-10-03T19:00:00Z',
        homeTeam: 'Alabama',
        awayTeam: 'Georgia',
        status: 'final',
        completed: true,
      },
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
    forwardLook: prepareForwardLookPayload(result, FORWARD_SCOPE),
  };
  const schedule = [
    {
      id: 'prior',
      week: 5,
      seasonType: 'regular',
      startDate: '2026-10-03T19:00:00Z',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
      status: 'final',
      completed: true,
    },
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
    assert.ok(rendered.getByText('Weekly recap'));
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
  for (const historyFirst of [true, false]) {
    test(`Overview composes from client results and canonical rows (initial final=${existingFinal}, history first=${historyFirst})`, async (t) => {
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
      addRivalry(context, Array(5).fill('Alice'));
      const historyPayload = prepareForwardLookPayload(
        { status: 'available', context },
        FORWARD_SCOPE
      );
      const schedule = context.games.map((game) => ({
        id: game.key,
        week: game.canonicalWeek,
        seasonType: 'regular',
        startDate: game.date,
        homeTeam: game.canHome,
        awayTeam: game.canAway,
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
      let phase = existingFinal ? 'win' : 'live';
      let releaseScores: (() => void) | undefined;
      let releaseHistory: (() => void) | undefined;
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
              {
                id: 'collision',
                week: 6,
                seasonType: 'regular',
                startDate: context.games[1].date,
                status: phase === 'live' ? 'inprogress' : 'final',
                time: null,
                home: { team: 'Texas', score: phase === 'win' ? 21 : 7 },
                away: { team: 'Georgia', score: phase === 'win' ? 7 : 21 },
              },
            ],
            meta: { source: 'cache', cache: 'hit' },
          });
          if (scoreCalls === 1)
            return new Promise<Response>((resolve) => {
              releaseScores = () => resolve(response);
            });
          return response;
        }
        if (url.startsWith('/api/insights/')) {
          insightCalls++;
          return new Promise<Response>((resolve) => {
            releaseHistory = () =>
              resolve(jsonResponse({ ...recapPayload, forwardLook: historyPayload }));
          });
        }
        return fallback(input, init);
      }) as typeof fetch;
      const baseRows = deriveStandings(context.games, context.rosterByTeam, {}).rows;
      const canonical = {
        slug: 'tsc',
        year: 2026,
        source: 'live' as const,
        lifecycle: 'mid_season' as const,
        rows: baseRows.map((row) => ({
          ...row,
          wins: row.owner === 'Alice' ? 10 : 9,
          gamesBack: row.owner === 'Alice' ? 0 : 1,
        })),
        noClaimRow: null,
        ownerColorOrder: ['Alice', 'Bob'],
        standingsHistory: null,
        coverage: { state: 'complete' as const, message: null },
        ownersRosterSource: 'csv' as const,
        archiveYearResolved: null,
        inferredSeasonStart: null,
        generatedAt: now.toISOString(),
      };
      const rendered = renderApp([], {
        canonicalStandings: canonical,
        leagueStatus: FORWARD_SCOPE.leagueStatus,
      });
      await waitFor(() =>
        assert.equal(Boolean(releaseScores && releaseHistory), true, 'both reads started')
      );
      await act(async () => (historyFirst ? releaseHistory!() : releaseScores!()));
      assert.equal(
        rendered.queryByText('Forward look') === null,
        true,
        'claims wait for both context and initial season hydration'
      );
      await act(async () => (historyFirst ? releaseScores!() : releaseHistory!()));
      const tile = () => rendered.getByText('Forward look').closest('section')!;
      await waitFor(() => assert.match(tile().textContent!, /meet one win apart/));
      assert.match(
        tile().textContent!,
        /Bob 9 wins, Alice 10 wins/,
        'facts use canonical wins, excluding pending wins'
      );
      assert.equal(
        /6-game rivalry streak/.test(tile().textContent!),
        existingFinal,
        'initial finals are composed directly when both inputs arrive'
      );
      assert.equal(insightCalls, 1, 'bootstrap finals cause zero additional Insights requests');
      const poll = async (next: string) => {
        phase = next;
        now = new Date(now.getTime() + 3 * 60_000);
        const before = scoreCalls;
        act(() => window.dispatchEvent(new dom.window.Event('focus')));
        await waitFor(() => assert.equal(scoreCalls, before + 1));
      };
      await poll('win');
      await waitFor(() => assert.match(tile().textContent!, /6-game rivalry streak/));
      assert.match(
        tile().textContent!,
        /Bob 9 wins, Alice 10 wins/,
        'new final does not outrun the table'
      );
      await poll('loss');
      await waitFor(() =>
        assert.equal(
          /rivalry streak/.test(tile().textContent!),
          false,
          'correction removes broken streak without waiting for a response'
        )
      );
      assert.equal(
        insightCalls,
        1,
        'finals and corrections cause zero additional Insights requests'
      );
      const updated = {
        ...canonical,
        rows: canonical.rows.map((row) => ({ ...row, wins: 10, gamesBack: 0 })),
      };
      rendered.rerender(
        <CFBScheduleApp
          leagueSlug="tsc"
          leagueYear={2026}
          leagueStatus={FORWARD_SCOPE.leagueStatus}
          canonicalStandings={updated}
        />
      );
      await waitFor(() =>
        assert.match(
          tile().textContent!,
          /can break their wins tie/,
          'canonical row update changes the tile with the table'
        )
      );
      const table = [...rendered.container.querySelectorAll('p')].find(
        (p) => p.textContent === 'Standings'
      )!.parentElement!.parentElement!;
      const records = [...table.querySelectorAll('button')].map(
        (button) => button.parentElement!.nextElementSibling!.textContent
      );
      assert.deepEqual(
        records,
        ['10–0', '10–0'],
        'table and tile receive the same updated canonical wins'
      );
      assert.equal(insightCalls, 1, 'canonical row changes do not request Insights');
    });
  }
}

for (const startup of ['issues', 'throws'] as const) {
  test(`Forward Look uses season hydration rather than a clean poll (startup ${startup})`, async (t) => {
    let now = FORWARD_NOW.getTime();
    Date.now = () => now;
    const oldVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    t.after(() => {
      if (oldVisibility) Object.defineProperty(document, 'visibilityState', oldVisibility);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    });
    const context = forwardContext();
    addRivalry(context, ['Alice', 'Alice', 'Alice']);
    context.games.push(forwardGame('repeat', 6, '2026-10-10T23:00:00Z'));
    const schedule = context.games.map((game) => ({
      id: game.key,
      week: game.week,
      seasonType: 'regular',
      startDate: game.date,
      homeTeam: game.canHome,
      awayTeam: game.canAway,
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      completed: false,
      neutralSite: false,
      conferenceGame: true,
    }));
    const payload = {
      ...recapPayload,
      forwardLook: prepareForwardLookPayload({ status: 'available', context }, FORWARD_SCOPE),
    };
    installFetch(schedule, payload, 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
    const fallback = globalThis.fetch;
    const scoreUrls: string[] = [];
    let polling = false;
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
        scoreUrls.push(url);
        if (!polling) {
          if (startup === 'throws') throw new Error('bootstrap disconnected');
          return jsonResponse({ error: 'unavailable' }, 503);
        }
        return jsonResponse({
          items: [
            {
              id: 'collision',
              week: 6,
              seasonType: 'regular',
              startDate: context.games[1].date,
              status: 'final',
              time: null,
              home: { team: 'Texas', score: 21 },
              away: { team: 'Georgia', score: 7 },
            },
          ],
          meta: { source: 'cache', cache: 'hit' },
        });
      }
      return fallback(input, init);
    }) as typeof fetch;
    const rendered = renderApp();
    await act(async () => {});
    await waitFor(() => assert.ok(scoreUrls.length > 0));
    await act(async () => {});
    if (startup === 'issues') {
      assert.equal(
        rendered.queryByText('Forward look') !== null,
        true,
        'a completed season hydration with issues does not wait forever for a clean poll'
      );
      const before = scoreUrls.length;
      act(() => window.dispatchEvent(new dom.window.Event('focus')));
      assert.equal(scoreUrls.length, before, 'Thursday has no eligible score poll');
    } else {
      assert.equal(rendered.queryByText('Forward look') === null, true);
      polling = true;
      now = Date.parse('2026-10-10T19:05:00Z');
      const before = scoreUrls.length;
      act(() => window.dispatchEvent(new dom.window.Event('focus')));
      await waitFor(() => assert.equal(scoreUrls.length, before + 1));
      await act(async () => {});
      assert.match(scoreUrls.at(-1)!, /week=6/, 'positive control: clean narrow poll completed');
      assert.equal(
        rendered.queryByText('Forward look') === null,
        true,
        'a clean narrow poll cannot substitute for missing season hydration'
      );
    }
  });
}
