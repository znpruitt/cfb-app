import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render } from '@testing-library/react';
import ForwardLookTile from '../ForwardLookTile';
import { composeForwardLook } from '../../../lib/recap/composeForwardLook';
import {
  addRivalry,
  forwardContext,
  FORWARD_NOW,
  FORWARD_SCOPE,
} from '../../../test/forwardLookFixtures';
import {
  selectForwardLookInputs,
  selectForwardStandings,
  selectForwardUpsets,
  mergeForwardLookLines,
} from '../../../lib/selectors/forwardLook';
import { selectForwardRivalries } from '../../../lib/selectors/forwardLookRivalries';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
afterEach(cleanup);

test('Forward Look disclosure renders narrative lines in normal flow and collapses accessibly', () => {
  const look = composeForwardLook(
    { status: 'available', context: forwardContext() },
    FORWARD_NOW,
    FORWARD_SCOPE
  )!;
  const view = render(<ForwardLookTile look={look} />);
  const button = view.getByRole('button', { name: 'View the week ahead' });
  const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
  assert.equal(panel.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  fireEvent.click(button);
  assert.equal(panel.hidden, false, 'click opens the narrative');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(view.getAllByRole('listitem').length, look.lines.length);
  for (const line of look.lines) assert.ok(view.getByText(line.detail));
  assert.doesNotMatch(
    panel.className,
    /absolute|fixed|overflow|max-h-/,
    'disclosure pushes content down'
  );
  assert.equal(
    panel.querySelector('article') === null,
    true,
    'narratives are not scoreboard cards'
  );
  fireEvent.click(view.getByRole('button', { name: 'Collapse' }));
  assert.equal(panel.hidden, true);
});

test('Forward Look renders with each family independently empty and with every family empty', () => {
  const context = forwardContext();
  addRivalry(context, ['Bob', 'Alice', 'Alice']);
  const inputs = selectForwardLookInputs(context, FORWARD_NOW)!;
  const families = [
    selectForwardStandings(inputs),
    selectForwardRivalries(inputs),
    selectForwardUpsets(inputs),
  ];
  assert.ok(
    families.every((family) => family.length > 0),
    'positive control: all selectors contribute'
  );
  const look = composeForwardLook({ status: 'available', context }, FORWARD_NOW, FORWARD_SCOPE)!;
  for (let omitted = 0; omitted < 3; omitted++) {
    const lines = mergeForwardLookLines(
      families.map((family, index) => (index === omitted ? [] : family))
    );
    const view = render(<ForwardLookTile look={{ ...look, lines }} />);
    fireEvent.click(view.getByRole('button', { name: 'View the week ahead' }));
    for (const line of lines)
      assert.ok(view.getByText(line.detail), `surviving family renders with ${omitted} omitted`);
    assert.equal(
      lines.some((line) => line.family === families[omitted][0].family),
      false
    );
    view.unmount();
  }
  const empty = render(<ForwardLookTile look={{ ...look, lines: [] }} />);
  assert.ok(empty.getByRole('heading', { name: 'Week 6 ahead' }), 'empty tile names its week');
  assert.equal(empty.queryByRole('button') === null, true, 'empty tile has no empty disclosure');
});
