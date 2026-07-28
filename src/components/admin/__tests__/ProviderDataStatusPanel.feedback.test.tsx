import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import ProviderDataStatusPanel from '../ProviderDataStatusPanel';
import { PROVIDER_DATASET_DESCRIPTORS, type ProviderDataset } from '@/lib/providerDatasets';

// PLATFORM-086I — the settings-feedback rendering of mutation errors already
// stored by the panel (global pause + interactive dataset auto-refresh toggle).
// These tests drive the authoritative-state path: a failed mutation must surface
// its stored error beside its control WITHOUT changing the confirmed setting, and
// a retry must clear the stale alert while pending and apply the confirmed value
// only after a successful POST is reloaded from the feed.

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

const YEAR = 2026;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// A status record with no history → the panel's benign "No refresh history
// recorded" state (cacheState 'unknown'); avoids coupling the test to the
// outcome-summary branches under test elsewhere.
function makeStatus(scope: Record<string, unknown>) {
  return {
    scope,
    scopeKey: 'test',
    lastAttemptAt: null,
    lastSuccessAt: null,
    latestAttemptOutcome: null,
    lastError: null,
    partialFailure: false,
    failedPartitions: [],
    rowsCommitted: null,
    source: null,
    durationMs: null,
  };
}

const CACHE_STATES: Record<ProviderDataset, 'unknown'> = {
  scores: 'unknown',
  schedule: 'unknown',
  odds: 'unknown',
  rankings: 'unknown',
  conferences: 'unknown',
  'game-stats': 'unknown',
};

// Feed with the interactive Game Stats card plus a read-only (planned) Odds
// card, so "renders only on the Game Stats card" is a real assertion, not vacuous.
// (Odds stays planned/read-only; scores is no longer read-only — its live-score
// cron consumes the toggle now (PLATFORM-086B2B) — so it would add a 2nd toggle.)
function makeFeed({
  globalPause = false,
  gameStatsEnabled = true,
}: { globalPause?: boolean; gameStatsEnabled?: boolean } = {}) {
  return {
    generatedAt: '2026-07-27T00:00:00.000Z',
    year: YEAR,
    globalPause,
    datasets: [
      {
        dataset: 'game-stats',
        descriptor: PROVIDER_DATASET_DESCRIPTORS['game-stats'],
        status: makeStatus({ kind: 'week-partition', year: YEAR, week: 1, seasonType: 'regular' }),
        setting: { enabled: gameStatsEnabled },
        diagnostics: [],
      },
      {
        dataset: 'odds',
        descriptor: PROVIDER_DATASET_DESCRIPTORS.odds,
        status: makeStatus({ kind: 'year', year: YEAR }),
        setting: { enabled: false },
        diagnostics: [],
      },
    ],
    diagnostics: [],
    scoreSeasonTypes: ['regular'],
    cacheStates: CACHE_STATES,
    oddsUsage: null,
    oddsUsageState: 'absent',
    oddsUsageStateDetail: null,
  };
}

const USAGE_SNAPSHOT = {
  patronLevel: 1,
  used: 100,
  remaining: 4900,
  limit: 5000,
  normalized: {
    used: 100,
    remaining: 4900,
    limit: 5000,
    consistent: true,
    source: 'live provider observation',
    observedAt: '2026-07-27T00:00:00.000Z',
    raw: { used: 100, remaining: 4900, limit: 5000, patronLevel: 1 },
  },
};

// Per-test mutable handlers. GET reads `currentFeed` live so a post-success
// reload observes whatever the test staged; POST is delegated to `settingsHandler`.
let currentFeed: ReturnType<typeof makeFeed>;
let settingsHandler: (body: Record<string, unknown>) => Promise<Response>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  currentFeed = makeFeed();
  settingsHandler = async () => new Response('{}', { status: 200 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/api/admin/usage')) {
      return new Response(JSON.stringify(USAGE_SNAPSHOT), { status: 200 });
    }
    if (url.includes('/api/admin/provider-status') && method === 'GET') {
      return new Response(JSON.stringify(currentFeed), { status: 200 });
    }
    if (url.includes('/api/admin/provider-status') && method === 'POST') {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return settingsHandler(body);
    }
    return new Response('', { status: 404 });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function findPauseButton(container: HTMLElement): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    /automation/i.test(b.textContent ?? '')
  );
  assert.ok(btn, 'global pause button should be present');
  return btn!;
}

function findGameStatsCheckbox(container: HTMLElement): HTMLInputElement {
  const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  assert.equal(boxes.length, 1, 'exactly one interactive toggle (Game Stats) is expected');
  return boxes[0];
}

test('global-pause mutation HTTP failure renders an alert tied to the pause button, unchanged state', async () => {
  currentFeed = makeFeed({ globalPause: false });
  settingsHandler = async () => new Response('boom detail', { status: 500 });

  const rendered = render(<ProviderDataStatusPanel defaultYear={YEAR} />);

  await waitFor(() => {
    findPauseButton(rendered.container);
  });
  const button = findPauseButton(rendered.container);
  // Off → the control offers "Pause automation".
  assert.equal(button.textContent?.trim(), 'Pause automation');

  await act(async () => {
    fireEvent.click(button);
    await tick();
    await tick();
  });

  // The stored detail is surfaced in a role="alert" region.
  const alert = rendered.container.querySelector('#provider-global-pause-error');
  assert.ok(alert, 'a pause failure alert should render');
  assert.equal(alert!.getAttribute('role'), 'alert');
  assert.match(alert!.textContent ?? '', /Pause update failed:/);
  assert.match(alert!.textContent ?? '', /500/);
  assert.match(alert!.textContent ?? '', /boom detail/);

  // The alert is programmatically associated with the button that failed.
  assert.equal(button.getAttribute('aria-describedby'), 'provider-global-pause-error');

  // Authoritative state is untouched: still Off, button still offers to pause.
  const offLabel = Array.from(rendered.container.querySelectorAll('span')).find(
    (s) => s.textContent?.trim() === 'Off'
  );
  assert.ok(offLabel, 'global pause should remain confirmed Off');
  assert.equal(button.textContent?.trim(), 'Pause automation');

  // The button is re-enabled for a retry.
  assert.equal(button.disabled, false);
});

test('Game Stats toggle rejection renders an alert only on that card, tied to the checkbox, unchanged', async () => {
  currentFeed = makeFeed({ gameStatsEnabled: true });
  settingsHandler = async () => {
    throw new TypeError('network down');
  };

  const rendered = render(<ProviderDataStatusPanel defaultYear={YEAR} />);

  await waitFor(() => {
    findGameStatsCheckbox(rendered.container);
  });
  const checkbox = findGameStatsCheckbox(rendered.container);
  assert.equal(checkbox.checked, true);

  await act(async () => {
    fireEvent.click(checkbox);
    await tick();
    await tick();
  });

  const alert = rendered.container.querySelector('#provider-toggle-game-stats-error');
  assert.ok(alert, 'a toggle failure alert should render on the Game Stats card');
  assert.equal(alert!.getAttribute('role'), 'alert');
  assert.match(alert!.textContent ?? '', /Auto-refresh update failed:/);
  assert.match(alert!.textContent ?? '', /network down/);

  // Associated with the checkbox that failed.
  assert.equal(checkbox.getAttribute('aria-describedby'), 'provider-toggle-game-stats-error');

  // No optimistic flip: the checkbox stays at the server-confirmed value.
  assert.equal(checkbox.checked, true);

  // It renders ONLY on the Game Stats card and does not leak elsewhere.
  assert.equal(
    rendered.container.querySelectorAll('[id^="provider-toggle-"]').length,
    1,
    'no other dataset card should show a toggle alert'
  );
  assert.equal(
    rendered.container.querySelector('#provider-global-pause-error'),
    null,
    'global pause feedback must not appear'
  );
  assert.doesNotMatch(rendered.container.textContent ?? '', /Refresh failed:/);
  assert.doesNotMatch(rendered.container.textContent ?? '', /Refresh complete\./);

  // Checkbox is re-enabled for a retry.
  assert.equal(checkbox.disabled, false);
});

test('retry clears the stale alert while pending and applies the confirmed setting on success', async () => {
  currentFeed = makeFeed({ gameStatsEnabled: false });
  let postCalls = 0;
  const deferred = makeDeferred<Response>();
  settingsHandler = async () => {
    postCalls += 1;
    if (postCalls === 1) return new Response('first failure', { status: 500 });
    return deferred.promise;
  };

  const rendered = render(<ProviderDataStatusPanel defaultYear={YEAR} />);

  await waitFor(() => {
    findGameStatsCheckbox(rendered.container);
  });
  let checkbox = findGameStatsCheckbox(rendered.container);
  assert.equal(checkbox.checked, false);

  // First attempt fails → alert visible, checkbox still at confirmed false.
  await act(async () => {
    fireEvent.click(checkbox);
    await tick();
    await tick();
  });
  assert.ok(
    rendered.container.querySelector('#provider-toggle-game-stats-error'),
    'first failure should render an alert'
  );
  assert.equal(checkbox.checked, false);

  // Stage the server-confirmed value the successful reload will return.
  currentFeed = makeFeed({ gameStatsEnabled: true });

  // Retry: while the POST is pending, the stale alert clears and the control is busy.
  await act(async () => {
    fireEvent.click(checkbox);
    await tick();
  });
  assert.equal(
    rendered.container.querySelector('#provider-toggle-game-stats-error'),
    null,
    'the stale alert must clear once the retry is pending'
  );
  checkbox = findGameStatsCheckbox(rendered.container);
  assert.equal(checkbox.disabled, true, 'the checkbox is disabled while the retry is in flight');
  assert.equal(
    checkbox.getAttribute('aria-describedby'),
    null,
    'aria-describedby drops while there is no active alert'
  );

  // Resolve the POST and let the success reload apply the confirmed setting.
  await act(async () => {
    deferred.resolve(new Response('{}', { status: 200 }));
    await tick();
    await tick();
    await tick();
  });

  checkbox = findGameStatsCheckbox(rendered.container);
  assert.equal(checkbox.checked, true, 'the confirmed on-value is applied after reload');
  assert.equal(
    rendered.container.querySelector('#provider-toggle-game-stats-error'),
    null,
    'no alert remains after a successful retry'
  );
  assert.equal(checkbox.disabled, false);
});
