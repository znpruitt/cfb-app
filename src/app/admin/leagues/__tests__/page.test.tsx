import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

import AdminLeaguesPage from '../page';
import type { PublicLeague } from '@/lib/league';

// ---------------------------------------------------------------------------
// PLATFORM-086F2I — this page is the REGISTRY surface: create, list, delete.
// Configuration moved to `/admin/[slug]/settings`, and the irreversible delete
// now requires typing the league's slug.
//
// The typed value is the SLUG, not a fixed word: a fixed word is identical on
// every row, so it defends against a stray click but not against acting on the
// WRONG league. The browser check is convenience only — the route enforces it,
// because a static ADMIN_API_TOKEN reaches the endpoint without this form.
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
let adoptOffered = false;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  bodies = [];
  adoptOffered = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url });
    if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (method === 'GET') return Response.json({ leagues: [league('alpha'), league('bravo')] });
    if (method === 'DELETE') return Response.json({ leagues: [league('bravo')] });
    if (method === 'POST' && !adoptOffered) {
      adoptOffered = true;
      return new Response('Stored data still exists for slug "ghost" (2 record group(s)).', {
        status: 409,
      });
    }
    return Response.json({});
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('the league overview offers no configuration editing', async () => {
  const { getByText, queryAllByRole } = render(
    React.createElement(AppRouterContext.Provider, { value: router() }, <AdminLeaguesPage />)
  );
  await waitFor(() => getByText('League alpha'));

  assert.equal(
    queryAllByRole('button', { name: /^Edit$/ }).length,
    0,
    'renaming belongs to the league settings page'
  );
  assert.equal(queryAllByRole('button', { name: /^Save$/ }).length, 0);

  // POSITIVE CONTROL — the registry actions this page DOES own are present, so
  // the absences above are not an empty render.
  assert.equal(
    queryAllByRole('button', { name: /^Delete$/ }).length,
    2,
    'one delete control per league — the page still owns deletion'
  );

  // Removing the inline editor must not strand the operator: each row routes to
  // the page that DOES own configuration. Without this, deleting the link would
  // be silent.
  const settingsLinks = queryAllByRole('link', { name: /^Settings$/ });
  assert.equal(settingsLinks.length, 2, 'each league links to its settings page');
  assert.equal(
    settingsLinks[0]!.getAttribute('href'),
    '/admin/alpha/settings',
    'and it points at that league'
  );
});

test('delete stays disabled until the exact slug is typed, then sends it to the route', async () => {
  // `userEvent`, not `fireEvent.change`: React's value tracker means assigning
  // `target.value` can update the DOM without ever running `onChange`, so the
  // control stays disabled and a naive "still disabled" assertion passes for the
  // wrong reason. This test was written that way first and proved nothing.
  const user = userEvent.setup({ document: dom.window.document });
  const { getAllByRole, getByText, getByRole } = render(
    React.createElement(AppRouterContext.Provider, { value: router() }, <AdminLeaguesPage />)
  );
  await waitFor(() => getByText('League alpha'));

  await user.click(getAllByRole('button', { name: /^Delete$/ })[0]!);

  const input = () =>
    getByRole('textbox', { name: 'Type alpha to confirm deletion' }) as HTMLInputElement;
  const confirm = () => getByRole('button', { name: 'Delete alpha' }) as HTMLButtonElement;

  assert.equal(confirm().disabled, true, 'armed but not yet confirmed');

  // The WRONG league's slug must not unlock it — the accident this design exists
  // for, and the case a fixed confirmation word would have accepted.
  await user.type(input(), 'bravo');
  assert.equal(input().value, 'bravo', 'the wrong slug really was entered');
  assert.equal(confirm().disabled, true, 'and it did NOT unlock the button');

  await user.clear(input());
  await user.type(input(), 'alpha');
  assert.equal(input().value, 'alpha');
  assert.equal(confirm().disabled, false, 'the exact slug unlocks it');

  await user.click(confirm());
  await waitFor(() => assert.ok(requests.some((r) => r.method === 'DELETE')));

  const del = requests.find((r) => r.method === 'DELETE')!;
  assert.match(
    del.url,
    /\/api\/admin\/leagues\/alpha\?confirm=alpha$/,
    'the confirmation travels IN THE REQUEST — the route is the authority, not this form'
  );
});

test('no DELETE is issued before a confirmation is typed', async () => {
  const { getAllByRole, getByText } = render(
    React.createElement(AppRouterContext.Provider, { value: router() }, <AdminLeaguesPage />)
  );
  await waitFor(() => getByText('League alpha'));

  fireEvent.click(getAllByRole('button', { name: /^Delete$/ })[0]!);
  assert.deepEqual(
    requests.filter((r) => r.method === 'DELETE'),
    [],
    'arming the control is not a request'
  );
});

// PLATFORM-086F2J — GAP, recorded rather than papered over.
//
// The create form's restore-year wiring has NO test. `userEvent.type` updates the
// DOM value of the create-form inputs but does not reach React state — the
// submit handler still sees an empty slug and refuses — while the identical
// approach works on the delete-confirmation input a few tests above. The cause
// is specific to this form and was not identified.
//
// Rather than ship a test that passes for the wrong reason or drives the form
// through an artificial path, the wiring is left uncovered and said so. What IS
// covered is the contract that matters: the route requires `restoreFoundedYear`
// whenever `adoptExistingData` is sent, refuses it on ordinary creation,
// validates its range, and still freezes the value afterwards — seven tests in
// `src/app/api/admin/leagues/__tests__/route.test.ts`, including positive
// controls. A form that failed to send the year would refuse every restoration
// loudly and immediately, which is the mitigating factor.
