/**
 * PLATFORM-086F2G — the ONLY mutation surface on System Health. These tests drive
 * the interactive path: the unchanged POST bodies, PLATFORM-086I feedback (stable
 * status-based message, control unchanged on failure), a server-model refresh on
 * success, manual-only datasets showing no toggle, no client GET on render, and
 * the read-only fixture path leaving the mutation unreachable.
 */

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

import AutomationSafetyControls from '../AutomationSafetyControls';
import type { AutomationHealth } from '@/lib/server/systemHealthIssues';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
(globalThis as { self: Window }).self = dom.window as unknown as Window;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

function automation(overrides: Partial<AutomationHealth> = {}): AutomationHealth {
  return {
    state: 'available',
    globalPause: false,
    datasets: {
      scores: { enabled: true },
      schedule: { enabled: true },
      odds: { enabled: true },
      rankings: { enabled: true },
      conferences: { enabled: true },
      'game-stats': { enabled: true },
    },
    ...overrides,
  } as AutomationHealth;
}

let refreshCalls = 0;
const router = {
  refresh: () => {
    refreshCalls += 1;
  },
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as import('next/dist/shared/lib/app-router-context.shared-runtime').AppRouterInstance;

function renderControls(a: AutomationHealth, readOnly = false) {
  return render(
    <AppRouterContext.Provider value={router}>
      <AutomationSafetyControls automation={a} readOnly={readOnly} />
    </AppRouterContext.Provider>
  );
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  refreshCalls = 0;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('no client GET is issued on render', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await act(async () => {
    renderControls(automation());
  });
  assert.equal(calls, 0);
});

test('pause POSTs the unchanged body and refreshes the server model on success', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;

  const { getByText } = renderControls(automation());
  await act(async () => {
    fireEvent.click(getByText('Pause automation'));
  });
  await waitFor(() => assert.equal(refreshCalls, 1));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/admin/provider-status');
  assert.deepEqual(calls[0].body, { action: 'set-global-pause', paused: true });
});

test('a consumed dataset toggle POSTs the unchanged set-dataset-enabled body', async () => {
  const calls: Array<{ body: unknown }> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;

  const { getByLabelText } = renderControls(automation());
  await act(async () => {
    fireEvent.click(getByLabelText('Game stats automatic refresh'));
  });
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0].body, {
    action: 'set-dataset-enabled',
    dataset: 'game-stats',
    enabled: false,
  });
});

test('manual-only datasets (Conferences) render no toggle', () => {
  const { queryByLabelText } = renderControls(automation());
  assert.equal(queryByLabelText('Conferences automatic refresh'), null);
  // A consumed dataset does render one.
  assert.ok(queryByLabelText('Game stats automatic refresh'));
});

test('a failed mutation shows a stable status-based alert and leaves the setting unchanged', async () => {
  globalThis.fetch = (async () => new Response('SENSITIVE BODY', { status: 500 })) as typeof fetch;
  const { getByText, findByRole } = renderControls(automation());
  await act(async () => {
    fireEvent.click(getByText('Pause automation'));
  });
  const alert = await findByRole('alert');
  assert.match(alert.textContent ?? '', /Update failed \(HTTP 500\)/);
  assert.ok(!/SENSITIVE BODY/.test(alert.textContent ?? ''), 'response body never rendered');
  // The confirmed state is untouched (still "On"); no refresh happened.
  assert.ok(getByText('On'));
  assert.equal(refreshCalls, 0);
});

test('read-only mode makes the mutation path unreachable (no fetch, disabled control)', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('', { status: 200 });
  }) as typeof fetch;
  const { getByText } = renderControls(automation(), true);
  const button = getByText('Pause automation') as HTMLButtonElement;
  assert.equal(button.disabled, true);
  await act(async () => {
    fireEvent.click(button);
  });
  assert.equal(calls, 0);
  assert.equal(refreshCalls, 0);
});

test('settings-unavailable renders no controls and no fabricated open state', () => {
  const { queryByText } = renderControls({ state: 'unavailable' } as AutomationHealth);
  assert.equal(queryByText('Pause automation'), null);
  assert.ok(queryByText(/settings are unavailable/i));
});
