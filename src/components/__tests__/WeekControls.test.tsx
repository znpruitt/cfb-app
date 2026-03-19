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

test('week tabs are visually de-emphasized when a season-scoped view is active', () => {
  const html = renderToStaticMarkup(
    <WeekControls
      weeks={[1]}
      weekDateLabels={new Map([[1, 'Aug 29 – Sep 3']])}
      selectedTab={1}
      hasPostseason={false}
      selectedConference="ALL"
      conferences={['ALL']}
      teamFilter=""
      onSelectWeek={() => {}}
      onSelectPostseason={() => {}}
      onSelectedConferenceChange={() => {}}
      onTeamFilterChange={() => {}}
      isSeasonViewActive={true}
      activeViewLabel="Overview"
    />
  );

  assert.match(html, /opacity-75/);
  assert.match(html, /border-gray-400 bg-gray-100 text-gray-500/);
  assert.match(html, /Supporting context while/);
});
