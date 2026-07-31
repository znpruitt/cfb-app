import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';

import MaintenanceActionDetails from '../MaintenanceActionDetails';
import { MAINTENANCE_ACTIONS } from '@/lib/admin/maintenanceActions';

// ---------------------------------------------------------------------------
// PLATFORM-086F2C — the compact per-action cost/scope disclosure: every field
// plus the live target rendered inside a native, keyboard-accessible
// <details> element, with neutral presentation only (no decorative
// amber/red/green/blue for action classes).
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

afterEach(() => {
  cleanup();
});

test('renders every descriptor field and the supplied live target', () => {
  const d = MAINTENANCE_ACTIONS['scores-aggregate-refresh'];
  const { container, getByText } = render(
    <MaintenanceActionDetails action="scores-aggregate-refresh" targetScope="2025 season" />
  );

  const details = container.querySelector('details');
  assert.ok(details, 'native <details> disclosure');
  const summary = details!.querySelector('summary');
  assert.ok(summary, 'native <summary> — keyboard-accessible by default');
  assert.match(summary!.textContent ?? '', /Cost and scope/);

  getByText('Class');
  getByText(d.actionClass);
  getByText('Provider');
  getByText(d.provider);
  getByText('Nominal cost');
  getByText(d.nominalCost);
  getByText('Current target');
  getByText('2025 season');
  getByText('Durable mutations');
  getByText(d.durableMutations.join('; '));
  getByText('Automation owner');
  getByText(d.automationOwner);
});

test('toggles open/closed through the summary element', () => {
  const { container } = render(
    <MaintenanceActionDetails action="sp-ratings-refresh" targetScope="2025 season" />
  );
  const details = container.querySelector('details')!;
  assert.equal(details.open, false, 'collapsed at rest — the page stays dense');
  fireEvent.click(details.querySelector('summary')!);
  assert.equal(details.open, true, 'expandable via activation');
});

test('uses neutral presentation — no decorative class colors', () => {
  for (const action of ['game-stats-full-backfill', 'scores-aggregate-refresh'] as const) {
    const { container, unmount } = render(
      <MaintenanceActionDetails action={action} targetScope="2025" />
    );
    const html = container.innerHTML;
    for (const hue of ['amber', 'red-', 'green-', 'blue-']) {
      assert.ok(!html.includes(hue), `${action}: no ${hue} decoration`);
    }
    unmount();
  }
});

test('the emergency backfill visibly identifies itself at rest', () => {
  const { container } = render(
    <MaintenanceActionDetails action="game-stats-full-backfill" targetScope="2024 full season" />
  );
  const summary = container.querySelector('summary')!;
  assert.match(
    summary.textContent ?? '',
    /emergency — high provider cost/,
    'visible without expanding'
  );
});
