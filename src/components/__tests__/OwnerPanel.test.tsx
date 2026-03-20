import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OwnerPanel from '../OwnerPanel';
import type { OwnerViewSnapshot } from '../../lib/ownerView';

const snapshot: OwnerViewSnapshot = {
  selectedOwner: 'Alice',
  ownerOptions: ['Alice', 'Bob'],
  header: {
    owner: 'Alice',
    rank: 1,
    record: '4–1',
    winPct: 0.8,
    pointDifferential: 30,
  },
  rosterRows: [
    {
      gameKey: 'game-1',
      ownerTeamSide: 'away',
      teamName: 'Texas',
      opponentTeamName: 'Georgia',
      opponentOwner: 'Bob',
      isOwnerVsOwner: true,
      status: 'inprogress',
      statusLabel: 'Q3 08:10',
      scoreLine: 'Texas 20 - 17 Georgia',
      kickoff: '2026-09-01T17:00:00.000Z',
      matchupLabel: 'Texas at Georgia',
    },
  ],
  liveRows: [
    {
      gameKey: 'game-1',
      ownerTeamSide: 'away',
      teamName: 'Texas',
      opponentTeamName: 'Georgia',
      opponentOwner: 'Bob',
      isOwnerVsOwner: true,
      status: 'inprogress',
      statusLabel: 'Q3 08:10',
      scoreLine: 'Texas 20 - 17 Georgia',
      kickoff: '2026-09-01T17:00:00.000Z',
      matchupLabel: 'Texas at Georgia',
    },
  ],
  weekRows: [
    {
      gameKey: 'game-1',
      ownerTeamSide: 'away',
      teamName: 'Texas',
      opponentTeamName: 'Georgia',
      opponentOwner: 'Bob',
      isOwnerVsOwner: true,
      status: 'inprogress',
      statusLabel: 'Q3 08:10',
      scoreLine: 'Texas 20 - 17 Georgia',
      kickoff: '2026-09-01T17:00:00.000Z',
      matchupLabel: 'Texas at Georgia',
    },
  ],
  weekSummary: {
    totalGames: 1,
    liveGames: 1,
    finalGames: 0,
    scheduledGames: 0,
    opponentOwners: ['Bob'],
    performanceSummary: '0–0 · 1 live',
    performanceDetail: '1 game',
  },
};

test('owner panel renders owner selector, header, roster, and week slate sections', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshot}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );

  assert.match(html, /Owner view/);
  assert.match(html, /aria-label="Previous owner: Bob"/);
  assert.match(html, /aria-label="Next owner: Bob"/);
  assert.match(html, /Select owner/);
  assert.match(html, /aria-label="Select owner: Alice"/);
  assert.match(html, /Alice/);
  assert.match(html, /Rank #1/);
  assert.match(html, /Record 4–1/);
  assert.match(html, /Roster/);
  assert.match(html, /Live games/);
  assert.match(html, /Week 1 slate/);
  assert.match(html, /Texas/);
  assert.match(html, /vs Bob/);
});

test('owner panel degrades gracefully when no active week rows are available', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={{ ...snapshot, weekRows: [], weekSummary: null }}
      selectedWeekLabel="the currently selected week"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );

  assert.match(html, /the currently selected week slate/);
  assert.match(html, /No games for this owner are attached to the selected week\./);
});
