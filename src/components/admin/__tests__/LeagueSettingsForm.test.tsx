import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LeagueSettingsForm from '../LeagueSettingsForm';

// ---------------------------------------------------------------------------
// PLATFORM-086F2J — this form had NO test file. It was the only surface that
// could edit the founding year, which is now frozen at creation.
//
// The load-bearing assertion is on the REQUEST BODY, not the input's state: a
// read-only input proves the operator cannot type, while the route refuses ANY
// body carrying `foundedYear` — so a form that still sent the value would refuse
// every save, and an input-only assertion would not catch it.
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

let bodies: Array<Record<string, unknown>> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  bodies = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return Response.json({ league: { slug: 'tsc', displayName: 'Renamed', year: 2025 } });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function renderForm(foundedYear?: number) {
  return render(
    <LeagueSettingsForm
      slug="tsc"
      initialDisplayName="TSC"
      initialYear={2025}
      initialFoundedYear={foundedYear}
    />
  );
}

test('the founding year renders read-only', () => {
  const { getByRole } = renderForm(2018);
  const input = getByRole('textbox', { name: /founded year/i }) as HTMLInputElement;

  assert.equal(input.readOnly, true, 'the value is shown but not editable');
  assert.equal(input.value, '2018', 'and it shows the stored value, not the current year');
});

// The row is deliberately KEPT rather than deleted — showing the value is what
// makes "this cannot be changed" legible instead of the field vanishing.
test('the founding year is still displayed', () => {
  const { getByText } = renderForm(2018);
  getByText('Founded Year');
});

test('saving sends the display name and NEVER the founding year', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const { getByRole } = renderForm(2018);

  const name = getByRole('textbox', { name: /display name/i }) as HTMLInputElement;
  await user.clear(name);
  await user.type(name, 'Renamed');
  await user.click(getByRole('button', { name: /save/i }));

  await waitFor(() => assert.equal(bodies.length, 1));
  // POSITIVE CONTROL — the request really carried the edit, so the absence below
  // is about `foundedYear` specifically and not about an empty submission.
  assert.equal(bodies[0]!.displayName, 'Renamed');
  assert.ok(
    !('foundedYear' in bodies[0]!),
    `the frozen field must not be sent; body was ${JSON.stringify(bodies[0])}`
  );
});
