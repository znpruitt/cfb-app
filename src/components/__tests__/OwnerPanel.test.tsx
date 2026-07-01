import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OwnerPanel from '../OwnerPanel';
import type { OwnerViewSnapshot } from '../../lib/ownerView';
import type { CanonicalStandings } from '../../lib/selectors/leagueStandings';
import type { LiveDelta } from '../../lib/selectors/liveDelta';

function liveDelta(
  byOwner: Record<string, { pendingWins: number; pendingLosses: number }>,
  opts: { isStale?: boolean } = {}
): LiveDelta {
  return {
    weekKey: '2026:3',
    generatedAt: '2026-10-01T00:00:00.000Z',
    byGame: {},
    byOwner: Object.fromEntries(
      Object.entries(byOwner).map(([owner, d]) => [
        owner,
        { owner, pendingPointsFor: 0, pendingPointsAgainst: 0, ...d },
      ])
    ),
    isStale: opts.isStale ?? false,
  };
}

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
  inferredSeasonStart: null,
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

test('owner panel filters canonical-only owners that the snapshot does not know about', () => {
  // Canonical includes Carol, but the snapshot only carries Alice and Bob (a
  // canonical/snapshot skew, e.g., post-roster-mutation pre-refresh). Carol
  // must not appear in the picker — selecting her would bounce because
  // deriveOwnerViewSnapshot only resolves owners from snapshot.ownerOptions.
  const snapshotWithoutCarol: OwnerViewSnapshot = {
    ...snapshot,
    selectedOwner: 'Alice',
    ownerOptions: ['Alice', 'Bob'],
  };
  const canonicalIncludingCarol: CanonicalStandings = {
    ...canonicalSnapshot,
    ownerColorOrder: ['Alice', 'Bob', 'Carol'],
  };

  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshotWithoutCarol}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
      canonicalStandings={canonicalIncludingCarol}
    />
  );

  // Picker has 2 options [Alice, Bob]: from Alice, prev = Bob, next = Bob.
  // If Carol leaked in, prev/next from Alice would mention Carol.
  assert.match(html, /aria-label="Previous owner: Bob"/);
  assert.match(html, /aria-label="Next owner: Bob"/);
  assert.doesNotMatch(html, /Carol/);
});

test('owner panel appends snapshot-only owners after canonical block (canonical contributes order only)', () => {
  // Canonical has [Alice, Bob], snapshot adds Dave (canonical hasn't seen yet).
  // ownerOptions should be [Alice, Bob, Dave]: canonical anchors order, Dave
  // appended after.
  const snapshotWithDave: OwnerViewSnapshot = {
    ...snapshot,
    selectedOwner: 'Dave',
    ownerOptions: ['Alice', 'Bob', 'Dave'],
  };
  const canonicalAliceBob: CanonicalStandings = {
    ...canonicalSnapshot,
    ownerColorOrder: ['Alice', 'Bob'],
  };

  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshotWithDave}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
      canonicalStandings={canonicalAliceBob}
    />
  );

  // From Dave (last in [Alice, Bob, Dave]): prev = Bob, next wraps to Alice.
  assert.match(html, /aria-label="Previous owner: Bob"/);
  assert.match(html, /aria-label="Next owner: Alice"/);
});

// ---------------------------------------------------------------------------
// PLATFORM-046 — Members owner header liveDelta pending badge. The badge is a
// separate annotation; it never changes the canonical header baseline.
// ---------------------------------------------------------------------------

function renderWithLiveDelta(delta: LiveDelta | null, override?: Partial<OwnerViewSnapshot>) {
  return renderToStaticMarkup(
    <OwnerPanel
      snapshot={{ ...snapshot, ...override }}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
      liveDelta={delta}
    />
  );
}

test('owner header renders a pending badge for a fresh, nonzero liveDelta without changing the baseline', () => {
  const html = renderWithLiveDelta(liveDelta({ Ballard: { pendingWins: 1, pendingLosses: 0 } }));

  assert.match(html, /data-owner-live-pending="1-0"/);
  assert.match(html, /Live this week: 1–0/);
  assert.match(html, /\+1–0/);
  // Canonical baseline is untouched.
  assert.match(html, /Rank #1/);
  assert.match(html, /Record 4–1/);
  assert.match(html, /Win % 0\.800/);
  assert.match(html, /Pt Diff \+30/);
});

test('owner header aggregates multiple live games into a single badge', () => {
  const html = renderWithLiveDelta(liveDelta({ Ballard: { pendingWins: 2, pendingLosses: 1 } }));

  const matches = html.match(/data-owner-live-pending/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(html, /data-owner-live-pending="2-1"/);
  assert.match(html, /\+2–1/);
});

test('owner header shows no badge for a stale liveDelta', () => {
  const html = renderWithLiveDelta(
    liveDelta({ Ballard: { pendingWins: 1, pendingLosses: 0 } }, { isStale: true })
  );
  assert.doesNotMatch(html, /data-owner-live-pending/);
  assert.match(html, /Record 4–1/);
});

test('owner header shows no badge when the delta lacks the header owner', () => {
  const html = renderWithLiveDelta(liveDelta({ Foster: { pendingWins: 2, pendingLosses: 0 } }));
  assert.doesNotMatch(html, /data-owner-live-pending/);
});

test('owner header shows no badge for a zero-decision (tied) delta', () => {
  const html = renderWithLiveDelta(liveDelta({ Ballard: { pendingWins: 0, pendingLosses: 0 } }));
  assert.doesNotMatch(html, /data-owner-live-pending/);
});

test('a null header is not resurrected by liveDelta (no header, no badge)', () => {
  const html = renderWithLiveDelta(liveDelta({ Ballard: { pendingWins: 3, pendingLosses: 0 } }), {
    header: null,
  });
  assert.doesNotMatch(html, /data-owner-live-pending/);
  assert.doesNotMatch(html, /Rank #/);
  assert.doesNotMatch(html, /Record 4–1/);
});

test('no liveDelta prop renders the canonical header with no badge', () => {
  const html = renderToStaticMarkup(
    <OwnerPanel
      snapshot={snapshot}
      selectedWeekLabel="Week 1"
      displayTimeZone="UTC"
      onOwnerChange={() => {}}
    />
  );
  assert.doesNotMatch(html, /data-owner-live-pending/);
  assert.match(html, /Record 4–1/);
});
