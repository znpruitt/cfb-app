import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { cleanup, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import React from 'react';

import CFBScheduleApp from '../CFBScheduleApp';
import { AppContextProviders } from './_setup/renderWithAppContext';

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
  },
};

function installFetch(scheduleItems: unknown[] | null): {
  insightsCalls: () => number;
  scheduleCalls: () => number;
} {
  let insightsCalls = 0;
  let scheduleCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/insights/')) {
      insightsCalls += 1;
      return jsonResponse(recapPayload);
    }
    if (url.startsWith('/api/schedule')) {
      scheduleCalls += 1;
      return scheduleItems === null
        ? jsonResponse({ error: 'unavailable' }, 503)
        : jsonResponse({ items: scheduleItems, meta: { source: 'cache' } });
    }
    if (url.startsWith('/api/aliases')) return jsonResponse({ map: {} });
    if (url.startsWith('/api/owners')) {
      return jsonResponse({ year: 2026, csvText: null, hasStoredValue: false });
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

function renderApp(initialIssues: string[] = []): ReturnType<typeof render> {
  return render(
    <CFBScheduleApp
      leagueSlug="tsc"
      leagueYear={2026}
      leagueStatus={{ state: 'season', year: 2026 }}
      initialIssues={initialIssues}
    />,
    { wrapper: AppContextProviders }
  );
}

beforeEach(() => {
  Date.now = () => Date.parse('2026-09-01T14:00:00.000Z');
  window.localStorage.clear();
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
  assert.ok(
    tile.compareDocumentPosition(podium) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'recap stays before the podium in normal flow'
  );
});
