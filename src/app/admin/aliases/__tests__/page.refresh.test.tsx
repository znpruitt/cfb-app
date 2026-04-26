import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

import AdminAliasesPage from '../page';

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

type MockRouter = AppRouterInstance & { refreshCalls: number };

function makeMockRouter(): MockRouter {
  const router = {
    refreshCalls: 0,
    back: () => {},
    forward: () => {},
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    refresh: () => {
      router.refreshCalls += 1;
    },
  } as MockRouter;
  return router;
}

function withRouter(node: React.ReactElement, router: AppRouterInstance) {
  return React.createElement(AppRouterContext.Provider, { value: router }, node);
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Default: GET /api/aliases returns an empty alias map; PUT /api/aliases
  // returns 204. Individual tests override the response to simulate failure.
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/api/aliases') && method === 'GET') {
      return new Response(JSON.stringify({ map: {} }), { status: 200 });
    }
    if (url.includes('/api/aliases') && method === 'PUT') {
      return new Response('{}', { status: 200 });
    }
    return new Response('', { status: 404 });
  };
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('admin alias editor calls router.refresh after a successful save', async () => {
  const fetchCalls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    fetchCalls.push({ url, method });
    if (url.includes('/api/aliases') && method === 'GET') {
      return new Response(JSON.stringify({ map: { 'app state': 'Appalachian State' } }), {
        status: 200,
      });
    }
    if (url.includes('/api/aliases') && method === 'PUT') {
      return new Response('{}', { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  const router = makeMockRouter();
  const rendered = render(withRouter(React.createElement(AdminAliasesPage), router));

  // Wait for the editor to open (load aliases completes and editorOpen=true).
  await waitFor(() => {
    const buttons = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>('button')
    ).map((b) => b.textContent?.trim());
    assert.ok(buttons.includes('Save'), `Save button absent; buttons: ${buttons.join(',')}`);
  });

  const saveButton = Array.from(
    rendered.container.querySelectorAll<HTMLButtonElement>('button')
  ).find((button) => button.textContent?.trim() === 'Save');
  assert.ok(saveButton, 'Save button should be present');

  await act(async () => {
    fireEvent.click(saveButton!);
    // Flush macrotask + microtask queue so the saveAliases promise can resolve
    // its fetch and then run setStatus + router.refresh inside the same act.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await waitFor(
    () => {
      assert.equal(
        router.refreshCalls,
        1,
        `router.refresh not called; fetches: ${JSON.stringify(fetchCalls)}`
      );
    },
    { timeout: 2000 }
  );
});

test('admin alias editor does not call router.refresh when save fails', async () => {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/api/aliases') && method === 'GET') {
      return new Response(JSON.stringify({ map: {} }), { status: 200 });
    }
    if (url.includes('/api/aliases') && method === 'PUT') {
      return new Response('boom', { status: 500 });
    }
    return new Response('', { status: 404 });
  };

  const router = makeMockRouter();
  const rendered = render(withRouter(React.createElement(AdminAliasesPage), router));

  await waitFor(() => {
    assert.ok(rendered.container.querySelector('button'));
  });

  const saveButton = Array.from(
    rendered.container.querySelectorAll<HTMLButtonElement>('button')
  ).find((button) => button.textContent?.trim() === 'Save');
  assert.ok(saveButton);

  await act(async () => {
    fireEvent.click(saveButton!);
  });

  // Allow the failed save to settle. router.refresh must not have been called.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(router.refreshCalls, 0);
});
