import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, render } from '@testing-library/react';

import LeagueLifecycleSummary from '../LeagueLifecycleSummary';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3B1 — the RENDERED contract, distinct from the copy contract.
//
// `describeLeagueLifecycle` owns which sentence is true; this owns that the two
// facts reach the operator as two labelled facts rather than one merged
// "status", which is the whole point of the component.
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

afterEach(cleanup);

test('state and next step render as two separately labelled facts', () => {
  const { getByText, container } = render(
    <LeagueLifecycleSummary
      storedStatus={{ state: 'preseason', year: 2026 }}
      fallbackYear={2025}
      isDemo={false}
    />
  );

  getByText('Current state');
  getByText('Next step');
  getByText('Preseason 2026');
  getByText(/Advances to the 2026 season automatically/);

  // The two facts occupy DIFFERENT elements. A single merged sentence would
  // still satisfy every `getByText` above.
  const stateEl = getByText('Preseason 2026');
  const nextEl = getByText(/Advances to the 2026 season automatically/);
  assert.notEqual(stateEl, nextEl, 'state and ownership are not the same node');
  assert.ok(
    !(stateEl.textContent ?? '').includes('Advances'),
    'the state element carries no ownership claim'
  );
  assert.equal(container.querySelectorAll('dt').length, 2, 'exactly two labelled facts');
});

// Three ownership values, three badges — and the distinction review caught is
// between the last two. "Manual" asserts an operator-owned path EXISTS. A
// production record with no stored status has none: no cron reaches it and no
// supported operation writes a lifecycle status onto it, so badging it "Manual"
// would send an operator looking for a control that was never built.
test('the badge distinguishes operator-owned from unowned, and leaves automatic quiet', () => {
  const operatorOwned: Array<{ storedStatus: null | { state: 'offseason' }; isDemo: boolean }> = [
    { storedStatus: { state: 'offseason' }, isDemo: false },
    { storedStatus: null, isDemo: true },
  ];
  for (const props of operatorOwned) {
    const { queryByText } = render(<LeagueLifecycleSummary {...props} fallbackYear={2025} />);
    assert.ok(queryByText('Manual') !== null, `Manual badge for ${JSON.stringify(props)}`);
    assert.ok(queryByText('Needs attention') === null, 'an owned league is not flagged');
    cleanup();
  }

  // REGRESSION — the unowned production record.
  const unowned = render(
    <LeagueLifecycleSummary storedStatus={null} fallbackYear={2025} isDemo={false} />
  );
  assert.ok(
    unowned.queryByText('Manual') === null,
    'no Manual badge — there is no manual path for a production lifecycle repair'
  );
  assert.ok(unowned.queryByText('Needs attention') !== null);
  cleanup();

  // POSITIVE CONTROL — an automatically-owned league carries NEITHER badge, so
  // the assertions above are discriminating rather than badge-always-absent.
  const { queryByText } = render(
    <LeagueLifecycleSummary
      storedStatus={{ state: 'season', year: 2026 }}
      fallbackYear={2026}
      isDemo={false}
    />
  );
  assert.ok(queryByText('Manual') === null, 'an automatic owner gets no Manual badge');
  assert.ok(queryByText('Needs attention') === null);
});

// REGRESSION TEST — a legacy record reaches NO lifecycle job, so the inferred
// season label must not drag the season's automation claim along with it.
test('a missing status renders the inferred label without an automation claim', () => {
  const { getByText, queryByText } = render(
    <LeagueLifecycleSummary storedStatus={null} fallbackYear={2025} isDemo={false} />
  );

  getByText('Season 2025');
  getByText(/No lifecycle status is recorded/);
  assert.ok(
    queryByText(/Rolls over to offseason automatically/) === null,
    'the season ownership sentence must not appear'
  );
});

test('the demo league renders manual-control copy in place of any automation claim', () => {
  const { getByText, queryByText } = render(
    <LeagueLifecycleSummary
      storedStatus={{ state: 'preseason', year: 2026, setupComplete: true }}
      fallbackYear={2025}
      isDemo
    />
  );

  getByText('Preseason 2026');
  getByText(/Manually controlled/);
  assert.ok(
    queryByText(/Advances to the 2026 season automatically/) === null,
    'the demo is excluded from the season-transition cron — it must not claim it'
  );
});
