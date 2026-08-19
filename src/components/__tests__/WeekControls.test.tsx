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

test('POLISH-006: the selected week is exposed to assistive technology, not only by styling', () => {
  // The removed week summary bar was the only textual statement of the active
  // week. These buttons carried the selection in CSS classes alone, so a screen
  // reader announced every week identically once that text was gone.
  const html = renderToStaticMarkup(
    <WeekControls
      weeks={[1, 2]}
      weekDateLabels={new Map()}
      selectedTab={2}
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

  // Exactly one control is current: the selected week, and not its neighbour
  // or the postseason button.
  assert.equal(html.match(/aria-current="true"/g)?.length, 1);
  assert.match(html, /aria-current="true"><span class="font-medium">Week 2</);
});

test('POLISH-006: postseason carries the current marker when it is the selection', () => {
  const html = renderToStaticMarkup(
    <WeekControls
      weeks={[1]}
      weekDateLabels={new Map()}
      selectedTab="postseason"
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

  assert.equal(html.match(/aria-current="true"/g)?.length, 1);
  assert.match(html, /aria-current="true">Postseason</);
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
    />
  );

  assert.match(html, /opacity-75/);
  assert.match(html, /border-gray-400 bg-gray-100 text-gray-500/);
});
