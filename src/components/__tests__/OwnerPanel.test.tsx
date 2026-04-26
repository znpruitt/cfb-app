import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OwnerPanel from '../OwnerPanel';
import type { OwnerViewSnapshot } from '../../lib/ownerView';
import type { CanonicalStandings } from '../../lib/selectors/leagueStandings';

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

const canonicalSnapshot: CanonicalStandings = {
  slug: 'tsc',
  year: 2025,
  source: 'live',
  lifecycle: 'mid_season',
  rows: [
    {
      owner: 'Foster',
      wins: 2,
      losses: 1,
      winPct: 0.667,
      pointsFor: 100,
      pointsAgainst: 80,
      pointDifferential: 20,
      gamesBack: 0,
      finalGames: 3,
    },
    {
      owner: 'Ballard',
      wins: 1,
      losses: 2,
      winPct: 0.333,
      pointsFor: 80,
      pointsAgainst: 100,
      pointDifferential: -20,
      gamesBack: 1,
      finalGames: 3,
    },
  ],
  noClaimRow: null,
  // Alphabetical canonical order: Ballard before Foster.
  ownerColorOrder: ['Ballard', 'Foster'],
  standingsHistory: null,
  coverage: { state: 'complete', message: null },
  ownersRosterSource: 'csv',
  archiveYearResolved: null,
  generatedAt: '2026-04-26T00:00:00.000Z',
};

test('owner panel uses canonical owner order for picker navigation when canonical is provided', () => {
  // Snapshot orders owners as ['Ballard', 'Foster'] (alphabetical here too) but
  // include a canonical with the same set so we can verify picker labels reach
  // both owners regardless of which list anchors the picker.
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshot}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
      canonicalStandings={canonicalSnapshot}
    />
  );

  assert.match(html, /aria-label="Previous owner: Foster"/);
  assert.match(html, /aria-label="Next owner: Foster"/);
});

test('owner panel falls back to snapshot owner order when canonical is absent', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshot}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );

  assert.match(html, /aria-label="Previous owner: Foster"/);
  assert.match(html, /aria-label="Next owner: Foster"/);
});

test('owner panel surfaces snapshot-only owners after the canonical block', () => {
  const snapshotWithExtra: OwnerViewSnapshot = {
    ...snapshot,
    selectedOwner: 'Aragon',
    ownerOptions: ['Aragon', 'Ballard', 'Foster'],
  };

  // Aragon is missing from canonical (mid-session roster addition). The picker
  // should still reach them via wrap-around — Aragon's "Next owner" should be
  // the first canonical owner (Ballard), and "Previous owner" should wrap
  // forward through canonical to the last appended snapshot-only owner. With
  // only Aragon outside canonical, wrap brings Aragon → Ballard → Foster →
  // Aragon, so previous from Aragon is Foster.
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshotWithExtra}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
      canonicalStandings={canonicalSnapshot}
    />
  );

  assert.match(html, /aria-label="Previous owner: Foster"/);
  assert.match(html, /aria-label="Next owner: Ballard"/);
});
