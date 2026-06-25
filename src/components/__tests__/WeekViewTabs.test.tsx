import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WeekViewTabs from '../WeekViewTabs';

test('week view tabs render the canonical top-level overview, standings, matchups, and members labels', () => {
  const html = renderToStaticMarkup(<WeekViewTabs value="matchups" onChange={() => {}} />);

  // Top-level tabs after the standings-ownership redesign. Schedule/Matrix are
  // sub-views of Matchups and Rankings is a sub-view of Standings, so they no
  // longer surface as their own top-level tab labels.
  assert.match(html, /Overview/);
  assert.match(html, /Standings/);
  assert.match(html, /Matchups/);
  assert.match(html, /Members/);
});
