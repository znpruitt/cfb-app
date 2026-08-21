import { afterEach, beforeEach } from 'node:test';

// MUST precede `@testing-library/react`: it installs the JSDOM globals before
// `react-dom` is evaluated. See the module for why a late setup silently breaks
// multi-field forms.
import { dom } from '../../../../test/domEnvironment.ts';

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

import AdminLeaguesPage from '../page';
import type { PublicLeague } from '@/lib/league';

/**
 * Importing this harness installs the original page-suite root hooks in the
 * importing test worker. They reset request observations, replace fetch with
 * the registry-route stub, and clean up the DOM after every test.
 */

dom.window.sessionStorage.setItem('adminToken', 'test-token');

function router(): AppRouterInstance {
  return {
    back: () => {},
    forward: () => {},
    prefetch: () => {},
    push: () => {},
    replace: () => {},
    refresh: () => {},
  } as unknown as AppRouterInstance;
}

function league(slug: string): PublicLeague {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2025,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2025 },
  };
}

let requests: Array<{ method: string; url: string }> = [];
let bodies: Array<Record<string, unknown>> = [];
/** Slugs the fake route treats as holding surviving data. */
const RESIDUAL_SLUGS = new Set(['ghost', 'phantom']);
const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  bodies = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url });
    if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (method === 'GET') return Response.json({ leagues: [league('alpha'), league('bravo')] });
    if (method === 'DELETE') return Response.json({ leagues: [league('bravo')] });
    // PLATFORM-093 — faithful to the route rather than one-shot: it refuses a
    // slug holding residue UNLESS the caller acknowledges adoption. The previous
    // single-use flag made a second residual slug unreachable, which is exactly
    // the scenario that carries stale recovery state between slugs.
    if (method === 'POST') {
      const sent = bodies[bodies.length - 1] ?? {};
      const slug = String(sent.slug ?? '');
      if (RESIDUAL_SLUGS.has(slug) && sent.adoptExistingData !== true) {
        return new Response(`Stored data still exists for slug "${slug}" (2 record group(s)).`, {
          status: 409,
        });
      }
    }
    return Response.json({});
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

export {
  AdminLeaguesPage,
  AppRouterContext,
  bodies,
  dom,
  fireEvent,
  React,
  render,
  requests,
  router,
  userEvent,
  waitFor,
};
