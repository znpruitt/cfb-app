import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import GlobalRefreshPanel from '../GlobalRefreshPanel';
import GameStatsCachePanel from '../GameStatsCachePanel';
import HistoricalCachePanel from '../HistoricalCachePanel';
import ProviderMaintenancePanel from '../ProviderMaintenancePanel';
import ReferenceDataPanel from '../ReferenceDataPanel';
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

type Recorded = {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
};

let requests: Recorded[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : null,
      headers: (init?.headers as Record<string, string>) ?? {},
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

test('HistoricalCachePanel: a no-op repair result is never presented as a cache write', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : null,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return Response.json({ success: true, year: 2019, scoreCount: 0, noOp: true });
  }) as typeof globalThis.fetch;

  const { getByText, getByRole, queryByText } = render(<HistoricalCachePanel leagues={[]} />);
  fireEvent.click(getByRole('button', { name: 'Cache Historical Scores' }));

  await waitFor(() => getByText(/Provider returned no score rows for 2019 — nothing cached/));
  assert.equal(queryByText(/Cached 0 scores/), null, 'no-op never reads as a persisted write');
});

// PLATFORM-086F2D1 — the relocated Odds/Rankings maintenance surface: exact
// URLs and admin headers, disclosures paired, and no false success on failure.
test('ProviderMaintenancePanel: odds + rankings URLs, admin headers, and disclosures', async () => {
  const year = seasonYearForToday();
  dom.window.sessionStorage.setItem('cfb_admin_token', 'test-token');
  try {
    const { getAllByText, getByText, getByRole } = render(<ProviderMaintenancePanel />);

    assert.equal(getAllByText('Cost and scope').length, 2, 'one disclosure per action');
    getByText(MAINTENANCE_ACTIONS['odds-refresh'].nominalCost);
    getByText(MAINTENANCE_ACTIONS['rankings-refresh'].nominalCost);
    getByText(`${year} canonical odds`);
    getByText(`${year} season (regular + postseason polls)`);

    fireEvent.click(getByRole('button', { name: 'Refresh Odds' }));
    await waitFor(() => assert.equal(requests.length, 1));
    assert.equal(requests[0]!.url, `/api/odds?year=${year}&refresh=1`);
    assert.equal(requests[0]!.method, 'GET');
    assert.equal(requests[0]!.headers['x-admin-token'], 'test-token', 'admin header forwarded');

    fireEvent.click(getByRole('button', { name: 'Refresh Rankings' }));
    await waitFor(() => assert.equal(requests.length, 2));
    assert.equal(requests[1]!.url, `/api/rankings?year=${year}&bypassCache=1`);
    assert.equal(requests[1]!.headers['x-admin-token'], 'test-token');
  } finally {
    dom.window.sessionStorage.removeItem('cfb_admin_token');
  }
});

test('ProviderMaintenancePanel: non-2xx and fallback responses never render success', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push({ url, method: 'GET', body: null, headers: {} });
    if (url.startsWith('/api/odds')) return new Response('nope', { status: 502 });
    // Rankings 2xx serving a stale/prior-good fallback must ALSO fail.
    return Response.json({ meta: { stale: true, rebuildRequired: true } });
  }) as typeof globalThis.fetch;

  const { getByRole, getByText, queryByText } = render(<ProviderMaintenancePanel />);

  fireEvent.click(getByRole('button', { name: 'Refresh Odds' }));
  await waitFor(() => getByText('Error 502'));
  assert.equal(queryByText('Done'), null);

  fireEvent.click(getByRole('button', { name: 'Refresh Rankings' }));
  await waitFor(() => getByText('Provider refresh failed; fallback data is still serving.'));
  assert.equal(queryByText('Done'), null, 'fallback 2xx never reads as success');
});

test('ReferenceDataPanel: conferences + team-database wiring, disclosures, fallback truth', async () => {
  const { getAllByText, getByText, getByRole } = render(<ReferenceDataPanel />);

  assert.equal(getAllByText('Cost and scope').length, 2);
  getByText(MAINTENANCE_ACTIONS['conferences-refresh'].nominalCost);
  getByText(MAINTENANCE_ACTIONS['team-database-sync'].nominalCost);

  fireEvent.click(getByRole('button', { name: 'Refresh Conferences' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0]!.url, '/api/conferences?bypassCache=1');
  assert.equal(requests[0]!.method, 'GET');

  // The sync response must be a VALID TeamDatabaseSyncResponse — the panel
  // renders the summary, and an invalid fixture would mask a render throw
  // (Codex review).
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : null,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return Response.json({
      ok: true,
      source: 'cfbd',
      updatedAt: '2026-07-30T00:00:00.000Z',
      summary: {
        fetchedCount: 136,
        writtenCount: 136,
        updatedCount: 3,
        withColorCount: 130,
        withAltColorCount: 120,
        missingColorCount: 6,
        skippedCount: 0,
        errors: [],
      },
    });
  }) as typeof globalThis.fetch;

  fireEvent.click(getByRole('button', { name: 'Update Team Database' }));
  await waitFor(() => assert.equal(requests.length, 2));
  assert.equal(requests[1]!.url, '/api/admin/team-database');
  assert.equal(requests[1]!.method, 'POST');
  // The rendered summary proves the panel consumed the response without throwing.
  await waitFor(() => getByText('Latest sync summary'));
  getByText('Fetched: 136');
  getByText('No skipped rows.');
});

// Codex review — refresh feedback is year-scoped: changing the season year
// resets visible results, and a late completion for the abandoned year is
// dropped rather than rendered beside the new target.
test('ProviderMaintenancePanel: a year change resets feedback and drops stale completions', async () => {
  const year = seasonYearForToday();
  let resolveOdds: ((r: Response) => void) | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push({ url: String(input), method: 'GET', body: null, headers: {} });
    return new Promise<Response>((resolve) => {
      resolveOdds = resolve;
    });
  }) as typeof globalThis.fetch;

  const { container, getByRole, getByText, queryByText } = render(<ProviderMaintenancePanel />);
  fireEvent.click(getByRole('button', { name: 'Refresh Odds' }));
  await waitFor(() => getByText('Working…'));

  // Switch the year while the old-year request is still in flight.
  const yearInput = container.querySelector('input[type="number"]')!;
  const propsKey = Object.keys(yearInput).find((k) => k.startsWith('__reactProps$'))!;
  const props = (yearInput as unknown as Record<string, unknown>)[propsKey] as {
    onChange: (e: { target: { value: string } }) => void;
  };
  act(() => {
    props.onChange({ target: { value: String(year + 1) } });
  });
  getByText(`${year + 1} canonical odds`);

  // The old-year request resolves successfully — it must NOT render "Done"
  // beside the newly selected year's target.
  await act(async () => {
    resolveOdds!(Response.json({}));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(queryByText('Done'), null, 'stale completion dropped');
  assert.equal(queryByText('Working…'), null, 'feedback reset by the year change');
});

// Codex r2 — an A→B→A year round-trip must not let the superseded first
// attempt overwrite the newer attempt's feedback: only the latest per-dataset
// attempt sequence may write.
test('ProviderMaintenancePanel: a superseded same-year attempt never overwrites newer feedback', async () => {
  const year = seasonYearForToday();
  const pending: Array<(r: Response) => void> = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push({ url: String(input), method: 'GET', body: null, headers: {} });
    return new Promise<Response>((resolve) => {
      pending.push(resolve);
    });
  }) as typeof globalThis.fetch;

  const { container, getByRole, getByText, queryByText } = render(<ProviderMaintenancePanel />);
  const oddsButton = () => getByRole('button', { name: /Refresh Odds|Refreshing…/ });

  // Attempt 1 for year A starts and stays in flight.
  fireEvent.click(oddsButton());
  await waitFor(() => getByText('Working…'));

  // A → B → A round-trip (each change resets feedback and invalidates attempts).
  const yearInput = container.querySelector('input[type="number"]')!;
  const propsKey = Object.keys(yearInput).find((k) => k.startsWith('__reactProps$'))!;
  const props = (yearInput as unknown as Record<string, unknown>)[propsKey] as {
    onChange: (e: { target: { value: string } }) => void;
  };
  act(() => props.onChange({ target: { value: String(year + 1) } }));
  act(() => props.onChange({ target: { value: String(year) } }));
  assert.equal(queryByText('Working…'), null, 'round-trip reset the feedback');

  // Attempt 2 for the SAME year A starts and is now the latest.
  fireEvent.click(oddsButton());
  await waitFor(() => getByText('Working…'));
  assert.equal(pending.length, 2, 'two in-flight attempts');

  // The SUPERSEDED attempt 1 resolves successfully — it must not write.
  await act(async () => {
    pending[0]!(Response.json({}));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(queryByText('Done'), null, 'superseded attempt dropped');
  getByText('Working…');

  // The latest attempt resolves and owns the feedback.
  await act(async () => {
    pending[1]!(Response.json({}));
    await new Promise((r) => setTimeout(r, 0));
  });
  await waitFor(() => getByText('Done'));
});

test('PLATFORM-204: a refused team-database sync renders the refusal and clears the stale summary', async () => {
  // The operator surface for the guard. Before it, an empty CFBD body returned
  // `ok: true` with an all-zero summary and the green "No skipped rows." line —
  // a wipe presented as a success. A refusal must read as a refusal, and must
  // not leave an EARLIER run's success block rendered beneath it, which would
  // put two contradictory verdicts on one screen.
  //
  // Flushed with `act` rather than `waitFor` (the pattern the sibling
  // ProviderMaintenancePanel tests use): a `waitFor` here does not reject when
  // the expected text is absent, it hangs to the file's 30s budget, and a
  // timeout reads as flake instead of as the caught regression it is.
  const { getByRole, getByText, queryByText } = render(<ReferenceDataPanel />);
  const syncButton = () =>
    getByRole('button', { name: /Update Team Database|Updating team database…/ });
  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

  // 1. A healthy sync first, so there IS a summary block to be left behind.
  globalThis.fetch = (async () =>
    Response.json({
      ok: true,
      source: 'cfbd',
      updatedAt: '2026-07-30T00:00:00.000Z',
      summary: {
        fetchedCount: 138,
        writtenCount: 138,
        updatedCount: 0,
        withColorCount: 138,
        withAltColorCount: 138,
        missingColorCount: 0,
        skippedCount: 0,
        errors: [],
      },
    })) as typeof globalThis.fetch;

  fireEvent.click(syncButton());
  await flush();
  getByText('Latest sync summary');
  getByText('No skipped rows.');

  // 2. The next click is refused by the guard.
  globalThis.fetch = (async () =>
    Response.json(
      {
        error: 'team-database-empty-replacement-rejected',
        detail:
          'CFBD returned 0 teams. The catalog was NOT changed — the existing 138 teams are still being served.',
      },
      { status: 502 }
    )) as typeof globalThis.fetch;

  fireEvent.click(syncButton());
  await flush();

  // The refusal names what was kept, so the owner can tell a no-op from a wipe.
  //
  // Every assertion below compares BOOLEANS, never the element `queryByText`
  // returns. `assert.equal(<jsdom element>, null)` builds its diff with
  // `util.inspect`, which walks ownerDocument → defaultView → window and does
  // not come back — so a regression here hung to the file's 30s budget and
  // reported as a timeout instead of as a failed assertion.
  assert.equal(
    queryByText(
      /CFBD returned 0 teams\. The catalog was NOT changed — the existing 138 teams are still being served\./
    ) !== null,
    true,
    'the refusal is rendered, naming what was kept'
  );
  assert.equal(
    queryByText('Latest sync summary') === null,
    true,
    "the previous run's summary is cleared, not left contradicting the refusal"
  );
  assert.equal(
    queryByText('No skipped rows.') === null,
    true,
    'no green verdict beside a red refusal'
  );
});

test('ReferenceDataPanel: a bundled-fallback conferences 2xx never renders success', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push({ url: String(input), method: 'GET', body: null, headers: {} });
    return Response.json({ meta: { fallbackUsed: true, source: 'local_snapshot' } });
  }) as typeof globalThis.fetch;

  const { getByRole, getByText, queryByText } = render(<ReferenceDataPanel />);
  fireEvent.click(getByRole('button', { name: 'Refresh Conferences' }));
  await waitFor(() => getByText('Provider refresh failed; fallback data is still serving.'));
  assert.equal(queryByText('Done'), null);
});
