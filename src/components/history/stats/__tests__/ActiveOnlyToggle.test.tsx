import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { ActiveOnlyToggle } from '../ActiveOnlyToggle';

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

afterEach(() => cleanup());

test('ActiveOnlyToggle: renders "All owners" label when off', () => {
  const { getByRole } = render(<ActiveOnlyToggle activeOnly={false} onChange={() => {}} />);
  const button = getByRole('switch');
  assert.equal(button.getAttribute('aria-checked'), 'false');
  assert.match(button.textContent ?? '', /All owners/);
});

test('ActiveOnlyToggle: renders "Active only" label when on', () => {
  const { getByRole } = render(<ActiveOnlyToggle activeOnly={true} onChange={() => {}} />);
  const button = getByRole('switch');
  assert.equal(button.getAttribute('aria-checked'), 'true');
  assert.match(button.textContent ?? '', /Active only/);
});

test('ActiveOnlyToggle: click invokes onChange with flipped value', () => {
  let next: boolean | null = null;
  const { getByRole } = render(
    <ActiveOnlyToggle activeOnly={false} onChange={(v) => (next = v)} />
  );
  fireEvent.click(getByRole('switch'));
  assert.equal(next, true);
});

test('ActiveOnlyToggle: disabled prevents onChange firing', () => {
  let called = false;
  const { getByRole } = render(
    <ActiveOnlyToggle
      activeOnly={false}
      onChange={() => {
        called = true;
      }}
      disabled
    />
  );
  fireEvent.click(getByRole('switch'));
  assert.equal(called, false);
});
