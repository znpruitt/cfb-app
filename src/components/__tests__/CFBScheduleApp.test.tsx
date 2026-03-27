import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CFBScheduleApp, {
  clearDrilldownFocusState,
  deriveWeeklyMatchupsDrilldownState,
  resolveHighlightDrilldownNavigation,
} from '../CFBScheduleApp';
import { scrollFocusedGameIntoView } from '../GameWeekPanel';
import { scrollFocusedOwnerPairIntoView } from '../MatchupMatrixView';
import { scrollFocusedOwnerIntoView } from '../MatchupsWeekPanel';
import { scrollFocusedStandingsOwnerIntoView } from '../StandingsPanel';
import { getAdminAlertCount } from '../../lib/adminDiagnostics';
import type { DiagEntry } from '../../lib/diagnostics';
import type { AppGame } from '../../lib/schedule';

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
  const html = renderToStaticMarkup(
    <CFBScheduleApp initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']} />
  );

  assert.match(html, /League view unavailable/);
  assert.match(html, /CFBD schedule load failed: upstream CFBD returned 503/);
  assert.match(html, /Rebuild schedule/);
  assert.match(html, /Open Admin \/ Debug/);
  assert.doesNotMatch(html, /Commissioner tools and diagnostics/);
});

test('league surface keeps admin tooling off the landing page when a schedule can render', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp initialGames={[game()]} />);

  assert.match(html, /CFB League Dashboard/);
  assert.match(html, /League overview/);
  assert.match(html, /Overview/);
  assert.match(html, /Admin \/ Debug/);
  assert.doesNotMatch(html, /League-first/);
  assert.doesNotMatch(html, /CFB Office Pool/);
  assert.doesNotMatch(html, /League surface unavailable/);
  assert.doesNotMatch(html, /Commissioner tools and diagnostics/);
  assert.doesNotMatch(html, /Admin diagnostics: API usage/);
});

test('league surface shows compact orientation and partial data availability copy', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp initialGames={[game()]} />);

  assert.match(html, /Track owner matchups, scores, and odds for the selected league view\./);
  assert.match(
    html,
    /Start with the current league picture, then drill into weekly schedule and matchup detail as needed\./
  );
  assert.doesNotMatch(html, /Scores available for 0\/1 games\./);
  assert.doesNotMatch(html, /Odds unavailable in this view\./);
});

test('owner surface remains reachable with owner data even when no week is selected', () => {
  const html = renderToStaticMarkup(
    <CFBScheduleApp
      initialWeekViewMode="owner"
      initialRoster={[{ owner: 'Alice', team: 'Texas' }]}
      initialGames={[]}
      initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']}
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

test('admin surface still renders dedicated admin and debug tooling', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp surface="admin" />);

  assert.match(html, /Commissioner tools and diagnostics/);
  assert.match(html, /Admin diagnostics: API usage/);
  assert.match(html, /Back to league view/);
});

test('league surface admin attention count ignores informational provider rows', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp initialGames={[game()]} initialIssues={[]} />);

  assert.doesNotMatch(html, /admin item/);
});

test('admin attention count includes actionable ignored-score diagnostics but excludes informational ignored rows', () => {
  const actionableIgnoredScoreRow: DiagEntry = {
    kind: 'ignored_score_row',
    week: 8,
    providerHome: 'Provider Home',
    providerAway: 'Provider Away',
    reason: 'multiple_candidate_matches',
    diagnostic: {
      type: 'ignored_score_row',
      classification: 'actionable',
      reason: 'multiple_candidate_matches',
      userMessage: 'Action required: canonical schedule match is ambiguous',
      provider: {
        source: 'cfbd_scores',
        week: 8,
        homeTeamRaw: 'Provider Home',
        awayTeamRaw: 'Provider Away',
        seasonType: 'regular',
        providerGameId: 'row-8',
        homeScore: 31,
        awayScore: 28,
        status: 'final',
        kickoff: '2026-11-01T19:30:00Z',
      },
      normalization: {
        homeTeamNormalized: 'provider home',
        awayTeamNormalized: 'provider away',
      },
      resolution: {
        homeCanonical: 'Provider Home',
        awayCanonical: 'Provider Away',
        homeResolved: true,
        awayResolved: true,
      },
      trace: {
        candidateCount: 2,
        plausibleScheduledGameCount: 2,
      },
    },
    debugOnly: true,
  };

  const informationalIgnoredRow: DiagEntry = {
    kind: 'ignored_score_row',
    week: 8,
    providerHome: 'FCS Home',
    providerAway: 'FCS Away',
    reason: 'no_scheduled_match',
    diagnostic: {
      type: 'ignored_score_row',
      classification: 'ignored',
      reason: 'no_scheduled_match',
      userMessage: 'Ignored non-league provider row.',
      provider: {
        source: 'cfbd_scores',
        week: 8,
        homeTeamRaw: 'FCS Home',
        awayTeamRaw: 'FCS Away',
        seasonType: 'regular',
        providerGameId: null,
        homeScore: null,
        awayScore: null,
        status: null,
        kickoff: null,
      },
      normalization: {
        homeTeamNormalized: null,
        awayTeamNormalized: null,
      },
      resolution: {
        homeCanonical: null,
        awayCanonical: null,
        homeResolved: false,
        awayResolved: false,
      },
      trace: {
        candidateCount: 0,
        plausibleScheduledGameCount: 0,
      },
    },
    debugOnly: true,
  };

  const count = getAdminAlertCount({
    issues: [],
    diag: [actionableIgnoredScoreRow, informationalIgnoredRow],
    aliasStaging: { upserts: {}, deletes: [] },
  });

  assert.equal(count, 1);
});

test('overview hides week context controls while still rendering overview content', () => {
  const html = renderToStaticMarkup(
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
    />
  );

  assert.match(html, /Overview/);
  assert.match(html, /League standings/);
  assert.doesNotMatch(html, /Week context/);
});

test('schedule keeps week context controls visible', () => {
  const html = renderToStaticMarkup(
    <CFBScheduleApp
      initialWeekViewMode="schedule"
      initialGames={[game({ week: 1 }), game({ key: 'g-2', week: 2 })]}
    />
  );

  assert.match(html, /Week context/);
  assert.match(html, /Browse weeks, postseason, and team filters\./);
});

test('matchups keeps week context controls visible', () => {
  const html = renderToStaticMarkup(
    <CFBScheduleApp
      initialWeekViewMode="matchups"
      initialGames={[game({ week: 1 }), game({ key: 'g-2', week: 2 })]}
    />
  );

  assert.match(html, /Week context/);
  assert.match(html, /Browse weeks, postseason, and team filters\./);
});

test('matrix mode renders dedicated matchup matrix surface and not weekly matchups cards', () => {
  const html = renderToStaticMarkup(
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
    />
  );

  assert.match(html, /Matchup matrix/);
  assert.match(html, /owner-vs-owner/);
  assert.match(html, /Week context/);
  assert.doesNotMatch(html, /Surname-based weekly cards and team context for the selected tab\./);
});

test('matrix mode remains available in postseason contexts', () => {
  const html = renderToStaticMarkup(
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
    />
  );

  assert.match(html, /Matchup matrix/);
  assert.match(html, /Matrix/);
  assert.doesNotMatch(html, /Postseason overview/);
});

test('standings hides week context controls and keeps season-level framing', () => {
  const html = renderToStaticMarkup(
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
  assert.match(
    html,
    /Season-long surname results and coverage status stay front-and-center here\./
  );
  assert.doesNotMatch(html, /Week context/);
});

test('postseason weekly matchups drill-down coerces to a regular week tab', () => {
  assert.deepEqual(
    deriveWeeklyMatchupsDrilldownState({
      selectedTab: 'postseason',
      selectedWeek: null,
      regularWeeks: [8, 9, 10],
    }),
    { nextTab: 8, nextWeek: 8 }
  );
});

test('postseason matchups drill-down preserves selected regular week when available', () => {
  assert.deepEqual(
    deriveWeeklyMatchupsDrilldownState({
      selectedTab: 'postseason',
      selectedWeek: 9,
      regularWeeks: [8, 9, 10],
    }),
    { nextTab: 9, nextWeek: 9 }
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
