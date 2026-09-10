import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { cleanup, fireEvent, render } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import React from 'react';

import CompactGameScoreboard from '../CompactGameScoreboard';

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

function scoreboard(awayLogoUrl: string): React.ReactElement {
  return (
    <CompactGameScoreboard
      state="live"
      clock="Q3 8:12"
      matchupLabel="Away at Home"
      away={{
        teamName: 'Away',
        teamLogo: { url: awayLogoUrl },
        score: 17,
      }}
      home={{ teamName: 'Home', score: 24 }}
    />
  );
}

test('a changed logo URL remounts an image hidden by an earlier load failure', () => {
  const firstUrl = 'https://cdn.collegefootballdata.com/logos-dark/64/1.png';
  const secondUrl = 'https://cdn.collegefootballdata.com/logos-dark/64/2.png';
  const { container, rerender } = render(scoreboard(firstUrl));
  const firstImage = container.querySelector<HTMLImageElement>(
    '[data-scoreboard-team-logo="away"]'
  );
  assert.ok(firstImage);

  fireEvent.error(firstImage);
  assert.equal(firstImage.hidden, true, 'the broken provider image is hidden');

  rerender(scoreboard(secondUrl));
  const secondImage = container.querySelector<HTMLImageElement>(
    '[data-scoreboard-team-logo="away"]'
  );
  assert.ok(secondImage);
  assert.notEqual(secondImage, firstImage, 'the changed URL must create a fresh DOM image');
  assert.equal(secondImage.hidden, false, 'the prior DOM mutation must not survive');
  assert.equal(secondImage.getAttribute('src'), secondUrl);
});
