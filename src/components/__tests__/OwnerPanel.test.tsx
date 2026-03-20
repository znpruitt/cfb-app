import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OwnerPanel from '../OwnerPanel';
import type { OwnerViewSnapshot } from '../../lib/ownerView';

const snapshot: OwnerViewSnapshot = {
  selectedOwner: 'Ballard',
  ownerOptions: ['Ballard', 'Foster'],
  header: {
    owner: 'Ballard',
    rank: 1,
    record: '4–1',
    winPct: 0.8,
    pointDifferential: 30,
  },
  rosterRows: [
    {
      teamName: 'Texas',
      record: '8–3',
      nextOpponent: 'Georgia',
      nextKickoff: '2026-09-01T17:00:00.000Z',
      currentStatus: 'Live',
      currentScore: 'Texas 20 - 17 Georgia',
      liveGameKey: 'game-1',
    },
  ],
  liveRows: [
    {
      teamName: 'Texas',
      record: '8–3',
      nextOpponent: 'Georgia',
      nextKickoff: '2026-09-01T17:00:00.000Z',
      currentStatus: 'Live',
      currentScore: 'Texas 20 - 17 Georgia',
      liveGameKey: 'game-1',
    },
  ],
  weekRows: [
    {
      teamName: 'Texas',
      record: '8–3',
      nextOpponent: 'Georgia',
      nextKickoff: '2026-09-01T17:00:00.000Z',
      currentStatus: 'Live',
      currentScore: 'Texas 20 - 17 Georgia',
      liveGameKey: 'game-1',
    },
  ],
  weekSummary: {
    totalGames: 1,
    liveGames: 1,
    finalGames: 0,
    scheduledGames: 0,
    opponentOwners: ['Foster'],
    performanceSummary: '0–0 · 1 live',
    performanceDetail: '1 game',
  },
};

test('owner panel renders merged header navigation and team-based roster table', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshot}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );

  assert.match(html, /Roster • Live • This week/);
  assert.match(html, /aria-label="Previous owner: Foster"/);
  assert.match(html, /aria-label="Next owner: Foster"/);
  assert.doesNotMatch(html, /surname/i);
  assert.match(html, /Ballard/);
  assert.match(html, /Rank #1/);
  assert.match(html, /Record 4–1/);
  assert.match(html, /Roster/);
  assert.match(html, /Live games/);
  assert.match(html, /Week 1 slate/);
  assert.match(html, /Texas/);
  assert.match(html, /8–3/);
  assert.match(html, /vs Georgia/);
  assert.match(html, /Live/);
});

test('owner panel renders season-complete messaging without week rows', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={{
        ...snapshot,
        rosterRows: [
          {
            teamName: 'Michigan',
            record: '10–2',
            nextOpponent: null,
            nextKickoff: null,
            currentStatus: 'Final',
            currentScore: null,
            liveGameKey: null,
          },
        ],
        weekRows: [],
        weekSummary: null,
      }}
      selectedWeekLabel="the currently selected week"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );

  assert.match(html, /Season complete/);
  assert.match(html, /No teams from this selection are attached to the selected week\./);
});
