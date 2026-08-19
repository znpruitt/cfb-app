import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import { renderWithAppContext } from './_setup/renderWithAppContext';
import CFBScheduleApp, {
  clearDrilldownFocusState,
  deriveWeeklyMatchupsDrilldownState,
  resolveHighlightDrilldownNavigation,
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

  // POLISH-005 — a member sees IMPACT, not diagnosis. The fixture feeds a raw
  // upstream failure; none of it may reach the page.
  assert.match(html, /schedule isn.{0,8}t available right now/);
  assert.doesNotMatch(html, /CFBD/, 'no provider name');
  assert.doesNotMatch(html, /503/, 'no upstream status code');
  assert.doesNotMatch(html, /schedule load failed/, 'no raw issue string');
  assert.doesNotMatch(html, /Rebuild schedule/, 'a MEMBER gets no operator action');
  assert.doesNotMatch(html, /Open Data Management/, 'no admin link');
  // NO retry, and the fixture is why the reasoning took three attempts to get
  // right. `CFBD schedule load failed:` IS a transient fetch error — but
  // `loadScheduleFromApi` flattens every rejection into that one prefix,
  // including the public routes' 503 cold-cache responses that require an
  // operator refresh. A classifier over the string cannot tell them apart, so
  // the retry waits until the loader carries structured errors.
  assert.doesNotMatch(html, /Try again/, 'the error string cannot say whether a retry could work');
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
  // POLISH-005 — the fatal fallback is now member copy, not an operator console.
  assert.match(html, /schedule isn.{0,8}t available right now/);
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

// PRESEASON-STATUS-BANNER-TRUTHFULNESS — the banner is rendered from
// `selectPreseasonBannerState`, so the claim ledger lives in that module's
// tests. These render tests prove the WIRING: that the canonical snapshot's
// `ownersRosterSource` actually reaches the decision, and that the fabricated
// `Draft scheduled · Date TBD` claim is gone from the rendered surface.
//
// Only the no-draft-record states are reachable here: `draftPhase` and
// `draftScheduledAt` arrive from a client fetch effect that never runs under
// `renderToStaticMarkup`, which leaves `draftPhase` null — exactly the
// production shape of the regression.
// ---------------------------------------------------------------------------

function preseasonSnapshot(
  ownersRosterSource: CanonicalStandings['ownersRosterSource'],
  owners: string[] = ownersRosterSource === 'none' ? [] : ['Alice', 'Bob']
): CanonicalStandings {
  const base = canonicalStandings(owners);
  return {
    ...base,
    source: ownersRosterSource === 'none' ? 'preseason-awaiting-kickoff' : 'preseason-names',
    lifecycle: 'preseason',
    ownersRosterSource,
  };
}

test('preseason with no current-season roster states the real stage instead of claiming a scheduled draft', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      leagueSlug="tsc"
      leagueStatus={{ state: 'preseason', year: 2026 }}
      canonicalStandings={preseasonSnapshot('none')}
      initialGames={[]}
    />
  );

  assert.match(html, /Awaiting 2026 roster confirmation · Contact your commissioner/);
  assert.doesNotMatch(html, /Draft scheduled/);
  assert.doesNotMatch(html, /Date TBD/);
});

test('confirmed preseason owners advance the banner without promising a draft', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      leagueSlug="tsc"
      leagueStatus={{ state: 'preseason', year: 2026 }}
      canonicalStandings={preseasonSnapshot('preseason-owners')}
      initialGames={[]}
    />
  );

  assert.match(html, /Roster confirmed · Season setup in progress/);
  assert.doesNotMatch(html, /Awaiting 2026 roster confirmation/);
  assert.doesNotMatch(html, /Draft scheduled/);
});

test('a prior season archive roster does not advance the preseason banner', () => {
  const html = renderWithAppContext(
    <CFBScheduleApp
      leagueSlug="tsc"
      leagueStatus={{ state: 'preseason', year: 2026 }}
      canonicalStandings={preseasonSnapshot('archive')}
      initialGames={[]}
    />
  );

  assert.match(html, /Awaiting 2026 roster confirmation/);
  assert.doesNotMatch(html, /Roster confirmed/);
});

test('a current-season source with no real owners does not read as a confirmed roster', () => {
  // The NoClaim-only CSV shape: `ownersRosterSource: 'csv'` with zero rows.
  // Wired through the real component to prove the owner COUNT reaches the
  // decision, not just the source tag.
  const html = renderWithAppContext(
    <CFBScheduleApp
      leagueSlug="tsc"
      leagueStatus={{ state: 'preseason', year: 2026 }}
      canonicalStandings={preseasonSnapshot('csv', [])}
      initialGames={[]}
    />
  );

  assert.match(html, /Awaiting 2026 roster confirmation/);
  assert.doesNotMatch(html, /Roster confirmed/);
});

test('the members surface does not stack the preseason roster grid on top of OwnerPanel', () => {
  // `canRenderPrimarySurface` is unconditionally true for the owner view, so the
  // preseason section must exclude it or the same owners render twice. Passing
  // `leagueStatus` to this route is what made that reachable.
  const html = renderWithAppContext(
    <CFBScheduleApp
      leagueSlug="tsc"
      initialWeekViewMode="owner"
      leagueStatus={{ state: 'preseason', year: 2026 }}
      canonicalStandings={preseasonSnapshot('preseason-owners')}
      // The grid only renders when there IS a roster to draw, so this must be
      // supplied or the assertion below would pass vacuously — it has to be able
      // to see the thing it denies.
      initialRoster={[{ team: 'Texas', owner: 'Alice' }]}
      initialGames={[]}
    />
  );

  // The banner still rides on this surface...
  assert.match(html, /Roster confirmed/);
  // ...but the preseason-only roster grid does not.
  assert.doesNotMatch(html, /2026 Rosters/);
  // The exclusion is scoped to the grid, not the whole section: the schedule
  // placeholder is the only thing explaining the empty owner surface here, and
  // it was reachable on this route before this work. Dropping it with the grid
  // would have been a net removal.
  assert.match(html, /season schedule not yet available/);
});

test('other preseason surfaces keep the roster grid the members fix excludes', () => {
  // Proves the exclusion is scoped to the owner view rather than deleting the
  // preseason section outright.
  const html = renderWithAppContext(
    <CFBScheduleApp
      leagueSlug="tsc"
      initialWeekViewMode="overview"
      leagueStatus={{ state: 'preseason', year: 2026 }}
      canonicalStandings={preseasonSnapshot('preseason-owners')}
      initialRoster={[{ team: 'Texas', owner: 'Alice' }]}
      initialGames={[]}
    />
  );

  assert.match(html, /2026 Rosters/);
});

// The live indicator was CUT from POLISH-005 (2026-08-18). It claimed live
// coverage falsely five different ways across four rounds — stale schedule
// status, a missing score, a cached in-progress score, a missing score again via
// an unbounded clock, and a successful read of deliberately-stale prior-good
// cache. The signals it needs are real but not yet threaded to the client; see
// `docs/next-tasks.md` 57. What remains of POLISH-005 is removal only.

// The counters ("Scores available for 98/100 games.", the odds availability
// summary) were DELETED, and the live-status section they lived in only mounts
// when `visibleGames` is non-empty — which needs a selected week, set by
// post-load effects a static render never runs. So no fixture in this file can
// make them appear, and a `doesNotMatch` on them would pass whether or not the
// code came back. The real contract is the predicate above (silent unless live),
// which IS reachable and mutation-proven. Mutation-found: an earlier version of
// this test passed with the counter re-introduced verbatim.

test('POLISH-005: internal issue strings never reach a member surface', () => {
  // The fixture feeds raw internal strings of exactly the shapes the app
  // produces. None may render.
  const html = renderWithAppContext(
    <CFBScheduleApp
      initialIssues={[
        'CFBD schedule load failed: upstream CFBD returned 503',
        'invalid-schedule-row: week 4 row 12',
        'identity-unresolved: Directional State',
        'Odds fetch failed: unable to load current odds.',
      ]}
    />
  );
  // NOTE: "Data notes" is not asserted here. Its input path — the
  // `issues -> standingsIssues -> trendIssues -> TrendsDetailSurface.issues`
  // prop chain — was DELETED, so no fixture can make it render and a
  // `doesNotMatch` on it would be decorative. Its enforcement is the compiler:
  // the prop no longer exists.
  assert.doesNotMatch(html, /invalid-schedule-row/, 'no raw issue string');
  assert.doesNotMatch(html, /identity-unresolved/, 'no raw issue string');
  assert.doesNotMatch(html, /CFBD/, 'no provider name');
});

// The postseason override's admin gating is pinned in `GameWeekPanel.test.tsx`,
// where the button actually renders. A CFBScheduleApp-level `doesNotMatch` was
// VACUOUS: the control only appears on an `isPlaceholder` postseason card, and
// there is no prop to select the postseason tab in a static render, so the
// button never rendered whether or not the gate existed. Mutation-found —
// handing the callback back to members unconditionally left it green.

test('POLISH-005: an ADMIN keeps the rebuild path on a fatal schedule failure', () => {
  // The rebuild forces `bypassCache`, which `/api/schedule` refuses only when
  // the admin check FAILS — so for an admin it succeeds. An earlier version of
  // this slice removed it on the rationale that "both were server-refused
  // anyway", which is true for a member and false for an admin, and left the one
  // person who could repair a broken league page with nothing to click.
  const admin = renderWithAppContext(
    <CFBScheduleApp
      isAdmin
      initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']}
    />
  );
  assert.match(admin, /Rebuild schedule/, 'the operator keeps their repair path');
  // The MEMBER copy is unchanged for them — an affordance, not a console.
  assert.match(admin, /schedule isn.{0,8}t available right now/);
  assert.doesNotMatch(admin, /CFBD/, 'still no provider name, even for an admin');
  assert.doesNotMatch(admin, /schedule load failed/, 'still no raw issue string');

  // Control: the identical failure without `isAdmin` offers nothing to click,
  // so the assertion above is the gate and not an inert fixture.
  const member = renderWithAppContext(
    <CFBScheduleApp initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']} />
  );
  assert.doesNotMatch(member, /Rebuild schedule/);
});

test('POLISH-005: no admin-only affordance is offered to a member', () => {
  // Both are refused server-side, so rendering them only produced buttons that
  // always fail: `/api/schedule` rejects `bypassCache` without admin, and
  // `/api/postseason-overrides` requires admin on write.
  const html = renderWithAppContext(
    <CFBScheduleApp initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']} />
  );
  assert.doesNotMatch(html, /Rebuild schedule/);
  assert.doesNotMatch(html, /Open Data Management/);
  assert.doesNotMatch(html, /\/admin\//, 'no admin deep link');
});
