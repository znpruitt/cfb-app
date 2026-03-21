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
      nextGameLabel: 'at Georgia',
      ownerTeamSide: 'away',
      isNeutralSite: false,
      nextKickoff: '2026-09-01T17:00:00.000Z',
      currentStatus: 'Live',
      currentScore: 'Texas 20 - 17 Georgia',
      liveGameKey: 'game-1',
    },
    {
      teamName: 'Michigan',
      record: '9–2',
      nextOpponent: 'Ohio State',
      nextGameLabel: 'vs Ohio State',
      ownerTeamSide: 'home',
      isNeutralSite: false,
      nextKickoff: '2026-09-03T17:00:00.000Z',
      currentStatus: 'Upcoming',
      currentScore: null,
      liveGameKey: null,
    },
    {
      teamName: 'Oregon',
      record: '7–2',
      nextOpponent: 'Washington',
      nextGameLabel: 'vs Washington',
      ownerTeamSide: 'away',
      isNeutralSite: true,
      nextKickoff: '2026-09-05T17:00:00.000Z',
      currentStatus: 'Final',
      currentScore: 'Oregon 24 - 20 Washington',
      liveGameKey: null,
    },
  ],
  liveRows: [
    {
      teamName: 'Texas',
      record: '8–3',
      nextOpponent: 'Georgia',
      nextGameLabel: 'at Georgia',
      ownerTeamSide: 'away',
      isNeutralSite: false,
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
      nextGameLabel: 'at Georgia',
      ownerTeamSide: 'away',
      isNeutralSite: false,
      nextKickoff: '2026-09-01T17:00:00.000Z',
      currentStatus: 'Live',
      currentScore: 'Texas 20 - 17 Georgia',
      liveGameKey: 'game-1',
    },
    {
      teamName: 'Michigan',
      record: '9–2',
      nextOpponent: 'Ohio State',
      nextGameLabel: 'vs Ohio State',
      ownerTeamSide: 'home',
      isNeutralSite: false,
      nextKickoff: '2026-09-03T17:00:00.000Z',
      currentStatus: 'Upcoming',
      currentScore: null,
      liveGameKey: null,
    },
    {
      teamName: 'Oregon',
      record: '7–2',
      nextOpponent: 'Washington',
      nextGameLabel: 'vs Washington',
      ownerTeamSide: 'away',
      isNeutralSite: true,
      nextKickoff: '2026-09-05T17:00:00.000Z',
      currentStatus: 'Final',
      currentScore: 'Oregon 24 - 20 Washington',
      liveGameKey: null,
    },
  ],
  weekSummary: {
    totalGames: 3,
    liveGames: 1,
    finalGames: 1,
    scheduledGames: 1,
    opponentOwners: ['Foster'],
    performanceSummary: '1–0 · 1 live',
    performanceDetail: '3 games',
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
  assert.match(html, /at <span>Georgia/);
  assert.match(html, /vs <span>Ohio State/);
  assert.match(html, /Live/);
});

test('owner panel shows live, final, and upcoming week-row detail correctly', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshot}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );

  assert.match(html, /Texas 20 - 17 Georgia/);
  assert.match(html, /Oregon 24 - 20 Washington/);
  assert.match(html, /Thu, Sep 3, 5:00 PM/);
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
            nextGameLabel: null,
            ownerTeamSide: 'home',
            isNeutralSite: false,
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

test('owner panel preserves neutral-site next-game wording when rankings decorate the opponent', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={{
        ...snapshot,
        rosterRows: [snapshot.rosterRows[2]!],
        liveRows: [],
        weekRows: [snapshot.weekRows[2]!],
      }}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );

  assert.match(html, /vs <span>Washington/);
  assert.doesNotMatch(html, /at <span>Washington/);
});
