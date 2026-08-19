import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import GameDayConfidenceIndicator from '../GameDayConfidenceIndicator';
import type { GameDayConfidence } from '../../lib/selectors/gameDayConfidence';

test('renders an accessible neutral tracking signal with motion-safe activity', () => {
  const html = renderToStaticMarkup(
    <GameDayConfidenceIndicator confidence={{ kind: 'tracking', label: 'Tracking scores' }} />
  );

  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-game-day-confidence="tracking"/);
  assert.match(html, /Tracking scores/);
  assert.match(html, /motion-safe:animate-pulse/);
  assert.doesNotMatch(html, /(?:green|emerald|blue|amber|red)-/);
});

test('waiting and preparing states are calm rather than animated', () => {
  const states: GameDayConfidence[] = [
    { kind: 'waiting', label: 'Waiting for scores' },
    { kind: 'preparing', label: 'Preparing for kickoff' },
  ];
  for (const confidence of states) {
    const html = renderToStaticMarkup(<GameDayConfidenceIndicator confidence={confidence} />);
    assert.match(html, new RegExp(confidence.label));
    assert.doesNotMatch(html, /motion-safe:animate-pulse/);
  }
});

test('keeps an empty live region mounted without a confidence claim', () => {
  const html = renderToStaticMarkup(<GameDayConfidenceIndicator confidence={null} />);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
  assert.match(html, /data-game-day-confidence="idle"/);
  assert.match(html, /class="sr-only"/);
  assert.doesNotMatch(html, /Tracking scores|Waiting for scores|Preparing for kickoff/);
});
