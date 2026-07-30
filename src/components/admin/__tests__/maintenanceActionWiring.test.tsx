import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import GlobalRefreshPanel from '../GlobalRefreshPanel';
import GameStatsCachePanel from '../GameStatsCachePanel';
import HistoricalCachePanel from '../HistoricalCachePanel';
import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import WinTotalsUploadPanel from '@/components/WinTotalsUploadPanel';
import { MAINTENANCE_ACTIONS } from '@/lib/admin/maintenanceActions';
import { seasonYearForToday } from '@/lib/scores/normalizers';

// ---------------------------------------------------------------------------
// PLATFORM-086F2C — every maintenance panel action is paired with its correct
// descriptor disclosure, and adding the disclosures changed NO request
// construction: URLs, methods, and bodies are pinned here.
// ---------------------------------------------------------------------------

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

type Recorded = { url: string; method: string; body: string | null };

let requests: Recorded[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : null,
    });
    return Response.json({
      success: true,
      year: 2019,
      resolvedCount: 1,
      unresolvedTeams: [],
      refresh: { outcome: 'success', reason: 'written-clean' },
      durable: { status: 'complete' },
    });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('GlobalRefreshPanel: schedule + scores disclosures paired; request URLs unchanged', async () => {
  const year = seasonYearForToday();
  const { getAllByText, getByText, getByRole } = render(<GlobalRefreshPanel />);

  assert.equal(getAllByText('Cost and scope').length, 2, 'one disclosure per action');
  getByText(MAINTENANCE_ACTIONS['schedule-full-year-refresh'].nominalCost);
  getByText(MAINTENANCE_ACTIONS['scores-aggregate-refresh'].nominalCost);
  getByText(`${year} full season`);
  getByText(`${year} season (applicable partitions)`);

  fireEvent.click(getByRole('button', { name: 'Rebuild Schedule' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0]!.url, `/api/schedule?bypassCache=1&year=${year}`);
  assert.equal(requests[0]!.method, 'GET');

  fireEvent.click(getByRole('button', { name: 'Refresh Scores' }));
  await waitFor(() => assert.equal(requests.length, 2));
  assert.equal(requests[1]!.url, `/api/scores?year=${year}&refresh=1&aggregate=1`);
  assert.equal(requests[1]!.method, 'GET');
});

test('GameStatsCachePanel: partition + emergency backfill disclosures; partition URL unchanged', async () => {
  const year = seasonYearForToday();
  const { getAllByText, getByText, getByRole } = render(<GameStatsCachePanel />);

  assert.equal(getAllByText('Cost and scope').length, 1, 'partition disclosure');
  getByText(/Cost and scope \(emergency — high provider cost\)/);
  getByText(MAINTENANCE_ACTIONS['game-stats-partition-refresh'].nominalCost);
  getByText(MAINTENANCE_ACTIONS['game-stats-full-backfill'].nominalCost);
  getByText(`${year} regular week 1`);
  getByText(`${year} full season (15 regular + 4 postseason weeks)`);

  fireEvent.click(getByRole('button', { name: 'Refresh Game Stats' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(
    requests[0]!.url,
    `/api/game-stats?year=${year}&week=1&seasonType=regular&bypassCache=1`
  );
  assert.equal(requests[0]!.method, 'GET');
});

test('HistoricalCachePanel: both repair disclosures paired; POST bodies unchanged', async () => {
  const now = new Date();
  const currentSeasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const year = currentSeasonYear - 1;

  const { getAllByText, getByText, getByRole } = render(<HistoricalCachePanel leagues={[]} />);

  assert.equal(getAllByText('Cost and scope').length, 2);
  getByText(MAINTENANCE_ACTIONS['historical-schedule-repair'].nominalCost);
  getByText(MAINTENANCE_ACTIONS['historical-scores-repair'].nominalCost);
  assert.equal(getAllByText(`${year} full season (past year)`).length, 2);

  fireEvent.click(getByRole('button', { name: 'Cache Historical Schedule' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0]!.url, '/api/admin/cache-historical-schedule');
  assert.equal(requests[0]!.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0]!.body!), { year, force: false });

  fireEvent.click(getByRole('button', { name: 'Cache Historical Scores' }));
  await waitFor(() => assert.equal(requests.length, 2));
  assert.equal(requests[1]!.url, '/api/admin/cache-historical-scores');
  assert.equal(requests[1]!.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1]!.body!), { year, force: false });
});

test('SpRatingsCachePanel: routine disclosure paired; POST unchanged', async () => {
  const { getByText, getByRole } = render(<SpRatingsCachePanel />);

  getByText('Cost and scope');
  getByText(MAINTENANCE_ACTIONS['sp-ratings-refresh'].nominalCost);

  fireEvent.click(getByRole('button', { name: 'Cache SP+ Ratings' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0]!.url, '/api/admin/cache-sp-ratings');
  assert.equal(requests[0]!.method, 'POST');
  const body = JSON.parse(requests[0]!.body!) as { year: number; force: boolean };
  assert.equal(body.force, false);
  assert.equal(typeof body.year, 'number');
});

test('WinTotalsUploadPanel: routine disclosure paired; POST unchanged', async () => {
  const { container, getByText, getByRole } = render(<WinTotalsUploadPanel />);

  getByText('Cost and scope');
  getByText(MAINTENANCE_ACTIONS['win-totals-upload'].nominalCost);

  const textarea = container.querySelector('textarea')!;
  // React's change-event plugin does not fire under this JSDOM harness (the
  // value tracker dedupes synthetic input events), so drive the controlled
  // component's own onChange prop directly — deterministic and equivalent to a
  // user edit for the request-construction contract under test.
  const propsKey = Object.keys(textarea).find((k) => k.startsWith('__reactProps$'))!;
  const props = (textarea as unknown as Record<string, unknown>)[propsKey] as {
    onChange: (e: { target: { value: string } }) => void;
  };
  act(() => {
    props.onChange({ target: { value: 'Team, WinTotalLow, WinTotalHigh\nA, 1, 2' } });
  });
  fireEvent.click(getByRole('button', { name: 'Upload Win Totals' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.match(requests[0]!.url, /^\/api\/admin\/win-totals\?year=\d+$/);
  assert.equal(requests[0]!.method, 'POST');
  assert.match(requests[0]!.body ?? '', /WinTotalLow/);
});
