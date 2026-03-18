import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WeekControls from '../WeekControls';

test('week tabs render dynamic canonical date sublabels', () => {
  const html = renderToStaticMarkup(
    <WeekControls
      weeks={[0, 1]}
      weekDateLabels={
        new Map([
          [0, 'Aug 23'],
          [1, 'Aug 29 – Sep 3'],
        ])
      }
      selectedTab={0}
      hasPostseason={true}
      selectedConference="ALL"
      conferences={['ALL']}
      teamFilter=""
      onSelectWeek={() => {}}
      onSelectPostseason={() => {}}
      onSelectedConferenceChange={() => {}}
      onTeamFilterChange={() => {}}
    />
  );

  assert.match(html, /Week 0/);
  assert.match(html, /Aug 23/);
  assert.match(html, /Week 1/);
  assert.match(html, /Aug 29 – Sep 3/);
  assert.match(html, /Postseason/);
});
