import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import React from 'react';

import CFBScheduleApp from '../CFBScheduleApp';
import { OVERVIEW_SCOREBOARD_GRID_STYLE } from '../OverviewPanel';
import { AppContextProviders } from './_setup/renderWithAppContext';
import { deriveStandings } from '../../lib/standings';
import { prepareForwardLookHistory } from '../../lib/selectors/forwardLookRivalries';
import { composeWeeklyRecap } from '../../lib/recap/composeWeeklyRecap';
import {
  forwardContext,
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
    forwardLook: prepareForwardLookHistory(result.context),
  };
  Date.now = () => before.getTime();
  installFetch(
    [
      priorScheduleRow(),
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
    forwardLook: prepareForwardLookHistory(result.context),
  };
  const schedule = [
    priorScheduleRow(),
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
    assert.equal(
      rendered.queryByRole('heading', { name: 'Alice takes the week at 1–0' }) !== null,
      true,
      'recap renders despite failed client bootstrap'
    );
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

function priorScheduleRow() {
  return {
    id: 'prior',
    week: 5,
    seasonType: 'regular',
    startDate: '2026-10-03T19:00:00Z',
    homeTeam: 'Unowned',
    awayTeam: 'Other',
    homeConference: 'SEC',
    awayConference: 'SEC',
    status: 'scheduled',
    completed: false,
    neutralSite: false,
    conferenceGame: true,
  };
}

for (const bootstrapFails of [false, true]) {
  test(
    bootstrapFails
      ? 'a clean narrow poll reveals Forward Look after a thrown bootstrap'
      : 'mounted Forward Look follows canonical table rows and corrects rivalry without an Insights refetch',
    async (t) => {
      let now = Date.parse('2026-10-10T19:00:00Z');
      Date.now = () => now;
      const oldVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      t.after(() => {
        if (oldVisibility) Object.defineProperty(document, 'visibilityState', oldVisibility);
      });
      const context = forwardContext();
      addRivalry(context, Array(5).fill('Alice'));
      const canonicalStandings = {
        slug: 'tsc',
        year: 2026,
        source: 'live' as const,
        lifecycle: 'mid_season' as const,
        rows: deriveStandings(context.games, context.rosterByTeam, context.scoresByKey).rows,
        noClaimRow: null,
        ownerColorOrder: ['Alice', 'Bob'],
        standingsHistory: null,
        coverage: { state: 'complete' as const, message: null },
        ownersRosterSource: 'csv' as const,
        archiveYearResolved: null,
        inferredSeasonStart: null,
        generatedAt: FORWARD_NOW.toISOString(),
      };
      const schedule = [
        priorScheduleRow(),
        ...[
          { id: 'collision', startDate: '2026-10-10T16:00:00Z' },
          { id: 'repeat', startDate: '2026-10-10T23:00:00Z' },
        ].map((game) => ({
          ...priorScheduleRow(),
          ...game,
          week: 6,
          homeTeam: 'Texas',
          awayTeam: 'Georgia',
        })),
      ];
      installFetch(
        schedule,
        { ...recapPayload, forwardLook: prepareForwardLookHistory(context) },
        'team,owner\nTexas,Alice\nGeorgia,Bob\n'
      );
      const fallback = globalThis.fetch;
      const scoreRequests: string[] = [];
      let insightsCalls = 0;
      let corrected = false;
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.startsWith('/api/teams'))
          return jsonResponse({
            items: [
              { school: 'Texas', subdivision: 'fbs', conference: 'SEC' },
              { school: 'Georgia', subdivision: 'fbs', conference: 'SEC' },
            ],
          });
        if (url.startsWith('/api/insights/')) insightsCalls++;
        if (url.startsWith('/api/scores')) {
          scoreRequests.push(url);
          if (bootstrapFails && scoreRequests.length === 1)
            throw new Error('bootstrap network failure');
          return jsonResponse({
            items: [
              {
                id: 'collision',
                week: 6,
                seasonType: 'regular',
                startDate: '2026-10-10T16:00:00Z',
                ...forwardScore(corrected ? 7 : 21, corrected ? 21 : 7),
              },
            ],
            meta: { source: 'cache', cache: 'hit' },
          });
        }
        return fallback(input, init);
      }) as typeof fetch;
      const view = renderApp([], { canonicalStandings, leagueStatus: FORWARD_SCOPE.leagueStatus });
      await waitFor(() => assert.equal(scoreRequests.length, 1));
      await waitFor(() => assert.equal(insightsCalls, 1));
      if (bootstrapFails) {
        await waitFor(() =>
          assert.equal(
            view.queryByText('Forward look') === null,
            true,
            'failed bootstrap leaves tile in loading state'
          )
        );
      } else {
        await waitFor(() =>
          assert.equal(
            view.queryByText(/6-game rivalry streak/) !== null,
            true,
            'initial final composes immediately'
          )
        );
      }
      corrected = true;
      now += 180_000;
      act(() => window.dispatchEvent(new dom.window.Event('focus')));
      await waitFor(() => assert.equal(scoreRequests.length, 2));
      assert.match(
        scoreRequests[1],
        /week=6/,
        'recovery is a narrow week poll, not another full read'
      );
      await waitFor(() =>
        assert.equal(
          view.queryByText('Forward look') !== null,
          true,
          'successful narrow poll reveals the tile'
        )
      );
      await waitFor(() =>
        assert.equal(
          view.queryByText(/6-game rivalry streak/) === null,
          true,
          'displayed corrected final removes the old streak'
        )
      );
      assert.equal(
        insightsCalls,
        1,
        'bootstrap and corrected final require zero Insights refreshes'
      );
      assert.equal(
        view.queryByText(/Bob 0 wins, Alice 1 win/) !== null,
        true,
        'tile follows canonical wins despite opposite client winner'
      );
      const table = view.getByText('Movement').parentElement!;
      const alice = Array.from(table.querySelectorAll('button')).find(
        (button) => button.textContent === 'Alice'
      );
      assert.ok(alice, 'canonical table row is rendered');
      assert.equal(
        alice.parentElement?.parentElement?.textContent?.includes('1–0'),
        true,
        'displayed table retains canonical Alice record'
      );
      const updated = {
        ...canonicalStandings,
        rows: canonicalStandings.rows.map((row) =>
          row.owner === 'Bob' ? { ...row, wins: 1 } : row
        ),
      };
      view.rerender(
        <CFBScheduleApp
          leagueSlug="tsc"
          leagueYear={2026}
          leagueStatus={FORWARD_SCOPE.leagueStatus}
          canonicalStandings={updated}
        />
      );
      await waitFor(() =>
        assert.equal(
          view.queryByRole('heading', { name: /can break their wins tie/ }) !== null,
          true,
          'canonical prop update changes tile standings facts'
        )
      );
      const bob = Array.from(
        view.getByText('Movement').parentElement!.querySelectorAll('button')
      ).find((button) => button.textContent === 'Bob');
      assert.equal(
        bob?.parentElement?.parentElement?.textContent?.includes('1–1'),
        true,
        'same canonical update changes displayed table record'
      );
    }
  );
}
