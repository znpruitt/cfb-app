import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import { renderWithAppContext } from './_setup/renderWithAppContext';
import CFBScheduleApp, {
  clearDrilldownFocusState,
  deriveWeeklyMatchupsDrilldownState,
  resolveHighlightDrilldownNavigation,
  shouldRenderLiveStatusSection,
} from '../CFBScheduleApp';
import { scrollFocusedGameIntoView } from '../GameWeekPanel';
import { scrollFocusedOwnerPairIntoView } from '../MatchupMatrixView';
import { scrollFocusedOwnerIntoView } from '../MatchupsWeekPanel';
import { scrollFocusedStandingsOwnerIntoView } from '../StandingsPanel';
import type { AppGame } from '../../lib/schedule';
import type { CanonicalStandings } from '../../lib/selectors/leagueStandings';

// PLATFORM-079: standings/owner data (owner options, selection, colors, matrix)
// is sourced from the server-passed `canonicalStandings` prop, not a client
// deriveStandings fallback. Tests that assert on owner/standings content supply
// a minimal canonical snapshot for the owners they exercise.
function canonicalStandings(owners: string[]): CanonicalStandings {
  return {
    slug: 'test',
    year: 2026,
    source: 'live',
    lifecycle: 'mid_season',
    rows: owners.map((owner) => ({
      owner,
      wins: 0,
      losses: 0,
      winPct: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: 0,
      finalGames: 0,
    })),
    noClaimRow: null,
    ownerColorOrder: [...owners].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    ),
    standingsHistory: null,
    coverage: { state: 'complete', message: null },
    ownersRosterSource: 'csv',
    archiveYearResolved: null,
    inferredSeasonStart: null,
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function game(overrides: Partial<AppGame> = {}): AppGame {
  return {
    key: overrides.key ?? 'g-1',
    eventId: overrides.eventId ?? 'event-1',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event-key-1',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'home-team',
        displayName: 'Home Team',
        canonicalName: 'Home Team',
        rawName: 'Home Team',
      },
      away: {
        kind: 'team',
        teamId: 'away-team',
        displayName: 'Away Team',
        canonicalName: 'Away Team',
        rawName: 'Away Team',
      },
    },
    csvAway: overrides.csvAway ?? 'Away Team',
    csvHome: overrides.csvHome ?? 'Home Team',
    canAway: overrides.canAway ?? 'Away Team',
    canHome: overrides.canHome ?? 'Home Team',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

test('league surface shows compact fatal fallback for schedule bootstrap failures', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']} />
  );

  assert.match(html, /League view unavailable/);
  assert.match(html, /CFBD schedule load failed: upstream CFBD returned 503/);
  assert.match(html, /Rebuild schedule/);
  assert.match(html, /Open Data Management/);
  assert.doesNotMatch(html, /Commissioner tools and diagnostics/);
});

test('league surface keeps admin tooling off the landing page when a schedule can render', () => {
  const html = renderWithAppContext(<CFBScheduleApp initialGames={[game()]} />);

  assert.match(html, /<h1 class="text-xl font-medium">League<\/h1>/);
  assert.match(html, />Overview</);
  assert.match(html, />Standings</);
  assert.match(html, />Matchups</);
  assert.doesNotMatch(html, /League-first/);
  assert.doesNotMatch(html, /CFB Office Pool/);
  assert.doesNotMatch(html, /League surface unavailable/);
  assert.doesNotMatch(html, /Commissioner tools and diagnostics/);
  assert.doesNotMatch(html, /API Usage/);
});

test('league surface shows compact orientation and partial data availability copy', () => {
  const html = renderWithAppContext(<CFBScheduleApp initialGames={[game()]} />);

  assert.match(html, />Overview</);
  assert.match(html, />Featured games</);
  assert.doesNotMatch(html, /data-active-surface-subtitle="true"/);
  assert.doesNotMatch(html, /Scores available for 0\/1 games\./);
  assert.doesNotMatch(html, /Odds unavailable in this view\./);
});

test('owner surface remains reachable with owner data even when no week is selected', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="owner"
      initialRoster={[{ owner: 'Alice', team: 'Texas' }]}
      initialGames={[]}
      initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']}
      canonicalStandings={canonicalStandings(['Alice'])}
    />
  );

  assert.match(html, /Roster • Live • This week/);
  assert.match(html, /Choose Alice/);
  assert.match(html, /aria-label="Choose Alice"/);
  assert.match(html, /Alice/);
  assert.match(html, /the currently selected week slate/);
  assert.match(html, /No teams from this selection are attached to the selected week\./);
  assert.match(html, /League view unavailable/);
});

test('owner surface wires liveDelta to OwnerPanel; no live badge without in-progress scores (PLATFORM-046)', () => {
  // The owner surface renders OwnerPanel with liveDelta wired through. Static
  // render seeds no scores, so liveDelta has no in-progress games → no badge,
  // while the canonical/local header baseline still renders.
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="owner"
      initialRoster={[{ owner: 'Alice', team: 'Texas' }]}
      initialGames={[game({ csvAway: 'Texas', csvHome: 'Rice' })]}
      canonicalStandings={canonicalStandings(['Alice'])}
    />
  );

  assert.match(html, /Roster • Live • This week/);
  assert.doesNotMatch(html, /data-owner-live-pending/);
});

test('PLATFORM-079: Members owner options/selection come from canonical standings, not the client roster', () => {
  // The client roster carries only "Zed"; canonical carries only "Alice". If
  // owner options were still derived client-side from the roster, the picker
  // would offer Zed. Sourcing from canonical, it must offer Alice and never Zed
  // — proving the retired client deriveStandings path no longer feeds Members.
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="owner"
      initialRoster={[{ owner: 'Zed', team: 'Texas' }]}
      initialGames={[game({ csvAway: 'Texas', csvHome: 'Rice' })]}
      canonicalStandings={canonicalStandings(['Alice'])}
    />
  );

  assert.match(html, /aria-label="Choose Alice"/);
  assert.doesNotMatch(html, /Choose Zed/);
});

test('active-season league surface uses the league status year, not the global default (PLATFORM-042)', () => {
  // The header subtitle renders "{leagueYear ?? selectedSeason} Season". With no
  // leagueYear, it reflects the resolved season. Under the old inline logic an
  // active-season league fell back to DEFAULT_SEASON; it must now use
  // leagueStatus.year (2099).
  const html = renderWithAppContext(
    <CFBScheduleApp initialGames={[game()]} leagueStatus={{ state: 'season', year: 2099 }} />
  );

  assert.match(html, /2099 Season/);
});

test('league surface admin attention count ignores informational provider rows', () => {
  const html = renderWithAppContext(<CFBScheduleApp initialGames={[game()]} initialIssues={[]} />);

  assert.doesNotMatch(html, /admin item/);
});

test('overview hides week context controls while still rendering overview content', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialGames={[
        game({ key: 'week-1', week: 1, csvAway: 'Texas', csvHome: 'Oklahoma' }),
        game({ key: 'week-2', week: 2, csvAway: 'Notre Dame', csvHome: 'USC' }),
      ]}
      initialRoster={[
        { owner: 'Alice', team: 'Texas' },
        { owner: 'Bob', team: 'Oklahoma' },
        { owner: 'Cory', team: 'Notre Dame' },
      ]}
      canonicalStandings={canonicalStandings(['Alice', 'Bob', 'Cory'])}
    />
  );

  assert.match(html, />Overview</);
  assert.match(html, /Full standings/);
  assert.doesNotMatch(html, /Team filter/);
});

test('schedule keeps week context controls visible', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="schedule"
      initialGames={[game({ week: 1 }), game({ key: 'g-2', week: 2 })]}
    />
  );

  assert.match(html, /Team filter/);
});

test('matchups keeps week context controls visible', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="matchups"
      initialGames={[game({ week: 1 }), game({ key: 'g-2', week: 2 })]}
    />
  );

  assert.match(html, /Team filter/);
});

test('matrix mode renders dedicated matchup matrix surface and not weekly matchups cards', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="matrix"
      initialGames={[
        game({ key: 'g-1', week: 1, csvAway: 'Texas', csvHome: 'Oklahoma' }),
        game({ key: 'g-2', week: 1, csvAway: 'USC', csvHome: 'Notre Dame' }),
      ]}
      initialRoster={[
        { owner: 'Alice', team: 'Texas' },
        { owner: 'Bob', team: 'Oklahoma' },
        { owner: 'Cara', team: 'USC' },
      ]}
      canonicalStandings={canonicalStandings(['Alice', 'Bob', 'Cara'])}
    />
  );

  assert.match(html, /data-owner-pair-cell=/);
  assert.match(html, />Matrix</);
  assert.match(html, /Team filter/);
  assert.doesNotMatch(html, /data-owner-card=/);
});

test('matrix mode remains available in postseason contexts', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="matrix"
      initialGames={[
        game({
          key: 'bowl-1',
          week: 16,
          stage: 'bowl',
          postseasonRole: 'bowl',
          csvAway: 'Texas',
          csvHome: 'Oklahoma',
        }),
      ]}
      initialRoster={[
        { owner: 'Alice', team: 'Texas' },
        { owner: 'Bob', team: 'Oklahoma' },
      ]}
      canonicalStandings={canonicalStandings(['Alice', 'Bob'])}
    />
  );

  assert.match(html, /data-owner-pair-cell=/);
  assert.match(html, />Matrix</);
  assert.doesNotMatch(html, /Postseason overview/);
});

test('standings hides week context controls and keeps season-level framing', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialWeekViewMode="standings"
      initialGames={[game({ week: 1 }), game({ key: 'g-2', week: 2 })]}
      initialRoster={[
        { owner: 'Alice', team: 'Away Team' },
        { owner: 'Bob', team: 'Home Team' },
      ]}
    />
  );

  assert.match(html, /Standings/);
  assert.doesNotMatch(html, /Team filter/);
});

test('postseason weekly matchups drill-down preserves postseason scope when no week is selected', () => {
  assert.deepEqual(
    deriveWeeklyMatchupsDrilldownState({
      selectedTab: 'postseason',
      selectedWeek: null,
      regularWeeks: [8, 9, 10],
    }),
    { nextTab: 'postseason', nextWeek: null }
  );
});

test('postseason matchups drill-down does not coerce to regular week even when selectedWeek exists', () => {
  assert.deepEqual(
    deriveWeeklyMatchupsDrilldownState({
      selectedTab: 'postseason',
      selectedWeek: 9,
      regularWeeks: [8, 9, 10],
    }),
    { nextTab: 'postseason', nextWeek: 9 }
  );
});

test('non-postseason weekly matchups drill-down remains unchanged', () => {
  assert.deepEqual(
    deriveWeeklyMatchupsDrilldownState({
      selectedTab: 7,
      selectedWeek: 7,
      regularWeeks: [7, 8],
    }),
    { nextTab: 7, nextWeek: 7 }
  );
});

test('highlight game drill-down routes to schedule with game focus and postseason scope', () => {
  const next = resolveHighlightDrilldownNavigation({
    target: {
      kind: 'game',
      destination: 'schedule',
      gameId: 'bowl-1',
      seasonTab: 'postseason',
      week: null,
      expand: true,
      focus: true,
    },
    selectedWeek: 6,
    regularWeeks: [6, 7, 8],
  });

  assert.deepEqual(next, {
    nextTab: 'postseason',
    nextWeek: null,
    nextViewMode: 'schedule',
    focusedGameId: 'bowl-1',
    focusedOwner: null,
    focusedOwnerPair: null,
  });
});

test('highlight owner drill-down routes to standings with owner focus', () => {
  const next = resolveHighlightDrilldownNavigation({
    target: {
      kind: 'owner',
      destination: 'standings',
      owner: 'Alice',
      seasonTab: 'week',
      week: 8,
      focus: true,
    },
    selectedWeek: 6,
    regularWeeks: [6, 7, 8],
  });

  assert.equal(next.nextTab, 8);
  assert.equal(next.nextWeek, 8);
  assert.equal(next.nextViewMode, 'standings');
  assert.equal(next.focusedOwner, 'Alice');
});

test('highlight owner-pair drill-down routes to matrix with pair focus', () => {
  const next = resolveHighlightDrilldownNavigation({
    target: {
      kind: 'owner_pair',
      destination: 'matrix',
      owners: ['Alice', 'Bob'],
      seasonTab: 'week',
      week: 9,
      focus: true,
    },
    selectedWeek: 6,
    regularWeeks: [6, 7, 8, 9],
  });

  assert.equal(next.nextTab, 9);
  assert.equal(next.nextWeek, 9);
  assert.equal(next.nextViewMode, 'matrix');
  assert.deepEqual(next.focusedOwnerPair, ['Alice', 'Bob']);
});

test('highlight owner drill-down routes postseason matchups without regular-week coercion', () => {
  const next = resolveHighlightDrilldownNavigation({
    target: {
      kind: 'owner',
      destination: 'matchups',
      owner: 'Alice',
      seasonTab: 'postseason',
      week: null,
      focus: true,
    },
    selectedWeek: 6,
    regularWeeks: [6, 7, 8],
  });

  assert.deepEqual(next, {
    nextTab: 'postseason',
    nextWeek: null,
    nextViewMode: 'matchups',
    focusedGameId: null,
    focusedOwner: 'Alice',
    focusedOwnerPair: null,
  });
});

test('generic weekly matchups focus reset clears stale owner, game, and owner-pair focus', () => {
  assert.deepEqual(clearDrilldownFocusState(), {
    focusedGameId: null,
    focusedOwner: null,
    focusedOwnerPair: null,
  });
});

test('game drill-down focus helper scrolls the targeted game card', () => {
  let called = false;
  const didScroll = scrollFocusedGameIntoView({
    gameId: 'game-1',
    refsByGameId: new Map([
      [
        'game-1',
        {
          scrollIntoView: () => {
            called = true;
          },
        },
      ],
    ]),
  });

  assert.equal(didScroll, true);
  assert.equal(called, true);
});

test('owner drill-down focus helper scrolls matchup owner card', () => {
  let called = false;
  const didScroll = scrollFocusedOwnerIntoView({
    focusedOwner: 'Alice',
    focusedOwnerPair: null,
    refsByOwner: new Map([
      [
        'Alice',
        {
          scrollIntoView: () => {
            called = true;
          },
        },
      ],
    ]),
  });

  assert.equal(didScroll, true);
  assert.equal(called, true);
});

test('owner-pair drill-down focus helper scrolls matrix intersection', () => {
  let called = false;
  const didScroll = scrollFocusedOwnerPairIntoView({
    focusedOwnerPair: ['Bob', 'Alice'],
    refsByOwnerPair: new Map([
      [
        'Alice::Bob',
        {
          scrollIntoView: () => {
            called = true;
          },
        },
      ],
    ]),
  });

  assert.equal(didScroll, true);
  assert.equal(called, true);
});

test('standings drill-down focus helper scrolls focused owner row', () => {
  let called = false;
  const didScroll = scrollFocusedStandingsOwnerIntoView({
    focusedOwner: 'Alice',
    refsByOwner: new Map([
      [
        'Alice',
        {
          scrollIntoView: () => {
            called = true;
          },
        },
      ],
    ]),
  });

  assert.equal(didScroll, true);
  assert.equal(called, true);
});

// ---------------------------------------------------------------------------
// 4th-review finding #5 — the served-odds freshness label must mount in the
// normal clean state, gated by `oddsSnapshotAt` in the section predicate.
// ---------------------------------------------------------------------------

const cleanLiveStatusInput = {
  loadingSchedule: false,
  scheduleLoaded: true,
  loadingLive: false,
  visibleGames: 5,
  visibleScoresCount: 5, // scores complete
  oddsAvailabilitySummary: null, // every game has odds
  oddsSnapshotAt: null,
  userFacingLiveIssuesCount: 0, // no issues
};

test('live-status section renders in the clean state when an odds snapshot exists (finding #5)', () => {
  // The clean state: complete scores, full odds coverage, no issues. Before the
  // fix nothing here mounts the section, so the freshness label never shows.
  assert.equal(
    shouldRenderLiveStatusSection({ ...cleanLiveStatusInput, oddsSnapshotAt: null }),
    false,
    'nothing to show when there is no odds snapshot and the surface is otherwise clean'
  );
  assert.equal(
    shouldRenderLiveStatusSection({
      ...cleanLiveStatusInput,
      oddsSnapshotAt: '2026-10-15T12:00:00.000Z',
    }),
    true,
    'a valid odds snapshot alone mounts the section so the freshness label shows'
  );
});

test('live-status section still renders for the other live signals (finding #5 regression)', () => {
  // A warning alongside the label.
  assert.equal(
    shouldRenderLiveStatusSection({
      ...cleanLiveStatusInput,
      oddsSnapshotAt: '2026-10-15T12:00:00.000Z',
      userFacingLiveIssuesCount: 1,
    }),
    true
  );
  // Partial scores.
  assert.equal(
    shouldRenderLiveStatusSection({ ...cleanLiveStatusInput, visibleScoresCount: 3 }),
    true
  );
  // Odds availability summary present.
  assert.equal(
    shouldRenderLiveStatusSection({
      ...cleanLiveStatusInput,
      oddsAvailabilitySummary: 'Odds available for 3/5 games.',
    }),
    true
  );
  // Loading states.
  assert.equal(
    shouldRenderLiveStatusSection({
      ...cleanLiveStatusInput,
      loadingSchedule: true,
      scheduleLoaded: false,
    }),
    true
  );
  assert.equal(shouldRenderLiveStatusSection({ ...cleanLiveStatusInput, loadingLive: true }), true);
});
