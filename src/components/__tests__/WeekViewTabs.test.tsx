import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WeekViewTabs from '../WeekViewTabs';

test('week view tabs render schedule and matchups labels', () => {
  const html = renderToStaticMarkup(<WeekViewTabs value="matchups" onChange={() => {}} />);

  assert.match(html, /Schedule/);
  assert.match(html, /Matchups/);
});
