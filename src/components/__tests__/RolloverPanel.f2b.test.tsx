import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import RolloverPanel from '../RolloverPanel';
import type {
  ManualRolloverExecuteResponse,
  ManualRolloverPreviewResponse,
  ManualRolloverStatusResponse,
  ManualRolloverYearStatus,
} from '@/lib/manualRollover';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the Season-page rollover panel consumes the per-year
// contract: every request carries the selected explicit year, execute controls
// exist only for eligible years, multiple years cannot cross-wire state, a
// successful action clears the preview and reloads status (the executed year
// drops out of the eligible list while the result banner persists), and a
// mid-flow gate refusal renders the stable reason and resyncs.
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
        slug: `league-${year}`,
        displayName: `League ${year}`,
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
          leagueSlug: `league-${year}`,
          displayName: `League ${year}`,
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
    archivedLeagues: [`league-${year}`],
    rolledOverLeagues: [`league-${year}`],
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
    if (method === 'GET') {
      return Response.json(statusPayload);
    }
    if (body?.confirmed === false) return Response.json(previewResponse(body.year!));
    return confirmResponse(body!);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('renders nothing when no year is eligible (no execute control for ineligible/unavailable)', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'not-eligible'), makeYearStatus(2024, 'unavailable')],
  };

  const { container } = render(<RolloverPanel />);
  await waitFor(() => assert.equal(requests.length, 1, 'status loaded'));
  await waitFor(() => assert.equal(container.textContent, '', 'no eligible year → no panel UI'));
});

test('preview and confirm send the selected explicit year; success persists across the reload', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible'), makeYearStatus(2024, 'eligible')],
  };

  const { getAllByRole, getByRole, getByText, queryByText } = render(<RolloverPanel />);
  await waitFor(() => getByText(/Season 2023 is complete/));
  getByText(/Season 2024 is complete/);

  // Preview the FIRST year only.
  const previewButtons = getAllByRole('button', { name: /Preview Rollover/ });
  assert.equal(previewButtons.length, 2, 'one preview control per eligible year');
  fireEvent.click(previewButtons[0]!);

  await waitFor(() => getByText(/Rollover preview — 2023 season/));
  const previewPost = requests.find((r) => r.method === 'POST');
  assert.deepEqual(previewPost?.body, { year: 2023, confirmed: false });

  // The sibling year's section is untouched (no preview, still offering Preview).
  assert.equal(
    getAllByRole('button', { name: /Preview Rollover/ }).length,
    1,
    'only the non-previewed year still shows its preview control'
  );
  assert.equal(queryByText(/Rollover preview — 2024 season/), null);

  // Production-faithful reload: after execution the 2023 leagues are offseason,
  // so the post-success status DROPS 2023 from the eligible list.
  statusPayload = {
    generatedAt: '2026-01-01T00:00:01.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2024, 'eligible')],
  };

  // Confirm names the exact year and league count, and posts that year.
  const confirmButton = getByRole('button', {
    name: /Confirm Rollover — archive the 2023 season \(1 league\)/,
  });
  fireEvent.click(confirmButton);

  await waitFor(() => getByText(/Season 2023 archived/));
  const confirmPost = requests.filter((r) => r.method === 'POST')[1];
  assert.deepEqual(confirmPost?.body, { year: 2023, confirmed: true });

  // Success reloaded the per-year status (initial GET + post-success GET); the
  // executed year's section unmounted while the banner PERSISTS, and the
  // sibling year's section is still offered.
  assert.equal(requests.filter((r) => r.method === 'GET').length, 2);
  assert.equal(queryByText(/Season 2023 is complete/), null, 'executed year dropped');
  getByText(/Season 2023 archived/);
  getByText(/Season 2024 is complete/);
  // No request ever carried the sibling year.
  assert.ok(requests.filter((r) => r.method === 'POST').every((r) => r.body?.year === 2023));
});

test('a mid-flow gate refusal shows the stable reason, clears the preview, and resyncs', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  confirmResponse = () =>
    Response.json({ error: 'rollover-not-eligible', reason: 'not-final' }, { status: 409 });

  const { getByRole, getByText, queryByRole } = render(<RolloverPanel />);
  await waitFor(() => getByText(/Season 2023 is complete/));

  fireEvent.click(getByRole('button', { name: /Preview Rollover/ }));
  await waitFor(() => getByText(/Rollover preview — 2023 season/));

  fireEvent.click(getByRole('button', { name: /Confirm Rollover — archive the 2023 season/ }));

  await waitFor(() => getByText(/Rollover refused: .*not final yet/));
  // The stale preview was dropped — no confirm control remains mounted.
  assert.equal(queryByRole('button', { name: /Confirm Rollover/ }), null);
  // The refusal triggered a status resync (initial GET + refusal GET).
  assert.equal(requests.filter((r) => r.method === 'GET').length, 2);
});
