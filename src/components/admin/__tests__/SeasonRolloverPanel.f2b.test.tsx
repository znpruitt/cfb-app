import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

import SeasonRolloverPanel from '../SeasonRolloverPanel';
import type {
  ManualRolloverExecuteResponse,
  ManualRolloverPreviewResponse,
  ManualRolloverStatusResponse,
  ManualRolloverYearStatus,
} from '@/lib/manualRollover';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the Data Cache maintenance panel consumes the per-year
// contract: every year renders its own eligibility state, execute controls
// exist only for eligible years, requests carry the row's explicit year, and
// a successful execution clears the preview and reloads status.
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
dom.window.confirm = () => true;

function makeRouter(): AppRouterInstance & { refreshCalls: number } {
  const router = {
    refreshCalls: 0,
    back: () => {},
    forward: () => {},
    prefetch: () => {},
    push: () => {},
    replace: () => {},
    refresh: () => {
      router.refreshCalls += 1;
    },
  } as unknown as AppRouterInstance & { refreshCalls: number };
  return router;
}

function withRouter(node: React.ReactElement, router: AppRouterInstance) {
  return React.createElement(AppRouterContext.Provider, { value: router }, node);
}

type Recorded = { method: string; body: { year?: number; confirmed?: boolean } | null };

let requests: Recorded[] = [];
let statusPayload: ManualRolloverStatusResponse;
let confirmResponse: (body: { year?: number }) => Response;
const originalFetch = globalThis.fetch;

function makeYearStatus(
  year: number,
  eligibility: ManualRolloverYearStatus['eligibility'],
  overrides: Partial<ManualRolloverYearStatus> = {}
): ManualRolloverYearStatus {
  return {
    year,
    eligibility,
    reason:
      eligibility === 'eligible'
        ? null
        : eligibility === 'unavailable'
          ? 'read-failed'
          : 'waiting-period',
    championshipDate: eligibility === 'eligible' ? `${year + 1}-01-09T00:00:00.000Z` : null,
    rolloverDate: eligibility === 'eligible' ? `${year + 1}-01-16T00:00:00.000Z` : null,
    leagues: [
      {
        slug: `alpha-${year}`,
        displayName: `Alpha ${year}`,
        year,
        createdAt: '2022-01-01T00:00:00.000Z',
        status: { state: 'season', year },
      },
      {
        slug: `bravo-${year}`,
        displayName: `Bravo ${year}`,
        year,
        createdAt: '2022-01-01T00:00:00.000Z',
        status: { state: 'season', year },
      },
    ],
    ...overrides,
  };
}

function previewResponse(year: number): ManualRolloverPreviewResponse {
  return {
    invalidLifecycleTargets: 0,
    preview: {
      year,
      championshipDate: `${year + 1}-01-09T00:00:00.000Z`,
      rolloverDate: `${year + 1}-01-16T00:00:00.000Z`,
      leagues: [
        {
          leagueSlug: `alpha-${year}`,
          displayName: `Alpha ${year}`,
          status: { state: 'season', year },
          hasExistingArchive: false,
          champion: 'Alice',
          top3: [{ position: 1, owner: 'Alice', wins: 10, losses: 2, ties: 0 }],
          diff: null,
          error: null,
        },
      ],
    },
  };
}

function executeResponse(year: number): ManualRolloverExecuteResponse {
  return {
    invalidLifecycleTargets: 0,
    success: true,
    year,
    archivedLeagues: [`alpha-${year}`, `bravo-${year}`],
    rolledOverLeagues: [`alpha-${year}`, `bravo-${year}`],
    errors: [],
  };
}

beforeEach(() => {
  requests = [];
  confirmResponse = (body) => Response.json(executeResponse(body.year!));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Recorded['body']) : null;
    requests.push({ method, body });
    if (method === 'GET') return Response.json(statusPayload);
    if (body?.confirmed === false) return Response.json(previewResponse(body.year!));
    return confirmResponse(body!);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('ineligible and unavailable years expose reasons but never an execute control', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'not-eligible'), makeYearStatus(2024, 'unavailable')],
  };

  const { getByText, queryByRole } = render(withRouter(<SeasonRolloverPanel />, makeRouter()));
  await waitFor(() => getByText('Season 2023'));
  getByText('Season 2024');
  getByText('The seven-day waiting period after the national championship has not elapsed.');
  getByText('Eligibility unavailable');
  getByText(/durable store read failed/);
  assert.equal(queryByRole('button', { name: /Execute Rollover/ }), null);
  assert.equal(queryByRole('button', { name: /Preview Rollover/ }), null);
});

test('no active season years → truthful empty message', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    years: [],
    invalidLifecycleTargets: 0,
  };
  const { getByText } = render(withRouter(<SeasonRolloverPanel />, makeRouter()));
  await waitFor(() => getByText(/No production league is currently in season/));
});

test('preview/execute carry the exact year; multi-year state never cross-wires; success reloads', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible'), makeYearStatus(2024, 'eligible')],
  };
  const router = makeRouter();

  const { getAllByRole, getByRole, getByText, queryByText } = render(
    withRouter(<SeasonRolloverPanel />, router)
  );
  await waitFor(() => getByText('Season 2023'));

  // Preview ONLY the 2023 row.
  const previewButtons = getAllByRole('button', { name: /Preview Rollover/ });
  assert.equal(previewButtons.length, 2);
  fireEvent.click(previewButtons[0]!);

  await waitFor(() => getByText(/Previewing rollover for season/));
  assert.deepEqual(requests.find((r) => r.method === 'POST')?.body, {
    year: 2023,
    confirmed: false,
  });

  // Execute control names the exact year; the sibling row has none.
  const executeButton = getByRole('button', { name: 'Execute Rollover (2023)' });
  assert.equal(queryByText('Execute Rollover (2024)'), null, 'sibling year has no execute');

  // Production-faithful reload: after execution the 2023 leagues are offseason,
  // so the post-success status DROPS the 2023 row.
  statusPayload = {
    generatedAt: '2026-01-01T00:00:01.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2024, 'eligible')],
  };

  fireEvent.click(executeButton);
  await waitFor(() => getByText(/Rollover complete — the 2023 season was archived/));
  getByText(/2 leagues transitioned to offseason/);

  const posts = requests.filter((r) => r.method === 'POST');
  assert.deepEqual(posts[1]?.body, { year: 2023, confirmed: true });
  assert.ok(
    posts.every((r) => r.body?.year === 2023),
    'no request ever targeted the sibling year'
  );

  // Success cleared the preview, reloaded status (executed row unmounted while
  // the banner persists), and refreshed the RSC tree.
  assert.equal(queryByText(/Previewing rollover for season/), null);
  assert.equal(queryByText('Season 2023'), null, 'executed year row dropped');
  getByText(/Rollover complete — the 2023 season was archived/);
  getByText('Season 2024');
  assert.equal(requests.filter((r) => r.method === 'GET').length, 2);
  assert.equal(router.refreshCalls, 1);
});

test('a mid-flow gate refusal shows the stable reason, clears the preview, and resyncs', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  confirmResponse = () =>
    Response.json({ error: 'rollover-not-eligible', reason: 'not-final' }, { status: 409 });

  const { getByRole, getByText, queryByRole, queryByText } = render(
    withRouter(<SeasonRolloverPanel />, makeRouter())
  );
  await waitFor(() => getByText('Season 2023'));

  fireEvent.click(getByRole('button', { name: /Preview Rollover/ }));
  await waitFor(() => getByText(/Previewing rollover for season/));

  fireEvent.click(getByRole('button', { name: 'Execute Rollover (2023)' }));

  await waitFor(() => getByText(/Rollover refused: .*not final yet/));
  // The stale preview was dropped — no execute control remains mounted.
  assert.equal(queryByRole('button', { name: /Execute Rollover/ }), null);
  assert.equal(queryByText(/Previewing rollover for season/), null);
  // The refusal triggered a status resync (initial GET + refusal GET).
  assert.equal(requests.filter((r) => r.method === 'GET').length, 2);
});
