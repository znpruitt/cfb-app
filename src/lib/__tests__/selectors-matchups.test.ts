import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveExcludedGamesSummary,
  deriveOpponentDescriptor,
  deriveOwnerOutcome,
  formatSlateSummaryText,
  getDefaultVisibleGamesCount,
  selectDistinctSlateGames,
  selectSlateGameVisibility,
  summarizeSlateOpponents,
} from '../selectors/matchups.ts';
import { deriveOwnerWeekSlates, deriveWeekMatchupSections } from '../matchups';
import { NO_CLAIM_OWNER } from '../standings';
import type { OwnerSlateGame, OwnerWeekSlate } from '../matchups';
import type { AppGame } from '../schedule';

const MATCHUPS_TEST_NOW_MS = Date.parse('2025-01-01T00:00:00.000Z');

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event',
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
      away: {
        kind: 'team',
        teamId: 'away-id',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
      home: {
        kind: 'team',
        teamId: 'home-id',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
    startTimeTBD: overrides.startTimeTBD,
  };
}

function slateGame(overrides: Partial<OwnerSlateGame>): OwnerSlateGame {
  return {
    owner: overrides.owner ?? 'Alex',
    game: overrides.game ?? game({}),
    ownerTeamSide: overrides.ownerTeamSide ?? 'away',
    ownerTeamId: overrides.ownerTeamId ?? 'away-id',
    ownerTeamName: overrides.ownerTeamName ?? 'Away',
    opponentTeamId: overrides.opponentTeamId ?? 'home-id',
    opponentTeamName: overrides.opponentTeamName ?? 'Home',
    opponentOwner: overrides.opponentOwner,
    isOwnerVsOwner: overrides.isOwnerVsOwner ?? false,
    isOpponentUnownedOrNonLeague: overrides.isOpponentUnownedOrNonLeague ?? true,
  };
}

test('selector derives summary and outcome including self-game edge case', () => {
  const self = slateGame({
    opponentOwner: 'Alex',
    isOwnerVsOwner: true,
    isOpponentUnownedOrNonLeague: false,
  });
  const entries = summarizeSlateOpponents({
    owner: 'Alex',
    games: [self, self],
    opponentOwners: ['Alex'],
    totalGames: 2,
    liveGames: 0,
    finalGames: 2,
    scheduledGames: 0,
    performance: { summary: '1-1', detail: 'x', tone: 'final' },
  } as OwnerWeekSlate);

  // Item 135 retarget. This fixture holds the SAME slate entry twice, which is
  // the shape `buildOwnerSlateGames` produces for one self game — so it is one
  // game, and the summary now says so. It previously read
  // `2 games · vs Self (x2)`, counting the duplicate as a second game.
  // Both original assertions are preserved: the formatter's output for a self
  // slate, and the `finalSelf` outcome tone below.
  assert.deepEqual(entries, [{ label: 'Self', count: 1 }]);
  assert.equal(
    formatSlateSummaryText({ entries, totalGames: 1, expanded: false }),
    '1 game · vs Self'
  );

  const outcome = deriveOwnerOutcome({
    slateGame: self,
    score: {
      status: 'final',
      time: 'Final',
      away: { team: 'Away', score: 21 },
      home: { team: 'Home', score: 14 },
    },
  });
  assert.equal(outcome.tone, 'finalSelf');
});

test('selector summarizes exclusions deterministically', () => {
  assert.equal(
    deriveExcludedGamesSummary({
      ownerMatchups: [],
      secondaryGames: [],
      otherGames: [{ game: game({}), awayIsLeagueTeam: false, homeIsLeagueTeam: false }],
    }),
    '1 excluded game does not involve owned teams.'
  );
  assert.equal(
    deriveExcludedGamesSummary({
      ownerMatchups: [],
      secondaryGames: [],
      otherGames: [
        { game: game({ key: 'o1' }), awayIsLeagueTeam: false, homeIsLeagueTeam: false },
        { game: game({ key: 'o2' }), awayIsLeagueTeam: false, homeIsLeagueTeam: false },
      ],
    }),
    '2 excluded games do not involve owned teams.'
  );
});

/**
 * Item 163 pins the descriptor's FIVE branches. Three already have tests below —
 * placeholder/derived, `FCS`, and `NoClaim (FBS)`. This covers the two that did
 * not: `Self`, and the `vs <owner>` form.
 *
 * The `vs <owner>` form is deliberately still PRODUCED after the owner ruling of
 * 2026-09-08 retired it from the Matchups card. The ruling is about a duplicated
 * name on a row that also renders owners inline; this selector's other consumer
 * groups opponents for a summary with no scoreboard, where the owner label is the
 * only thing naming them. `MatchupsWeekPanel` suppresses it at the render seam —
 * see the exactly-once assertions in that component's suite.
 *
 * `NoClaim (FBS)` is asserted AT THE SELECTOR by design and cannot be asserted on
 * rendered output: `hideOpponentDescriptor` suppresses it unconditionally, so it
 * has no rendered form to compare against.
 */
test('deriveOpponentDescriptor still produces Self and the vs <owner> form for the summary path', () => {
  assert.equal(
    deriveOpponentDescriptor(
      slateGame({
        owner: 'Alex',
        opponentOwner: 'Alex',
        isOwnerVsOwner: true,
        isOpponentUnownedOrNonLeague: false,
      })
    ),
    'Self'
  );

  assert.equal(
    deriveOpponentDescriptor(
      slateGame({
        owner: 'Alex',
        opponentOwner: 'Bob',
        isOwnerVsOwner: true,
        isOpponentUnownedOrNonLeague: false,
      })
    ),
    'vs Bob'
  );
});

test('deriveOpponentDescriptor uses non-owner fallback labels', () => {
  const descriptor = deriveOpponentDescriptor(
    slateGame({
      game: game({
        participants: {
          away: {
            kind: 'team',
            teamId: 'away-id',
            displayName: 'Away',
            canonicalName: 'Away',
            rawName: 'Away',
          },
          home: { kind: 'placeholder', slotId: 'slot-home', displayName: 'Winner G1' },
        },
      }),
      opponentOwner: undefined,
    })
  );

  assert.equal(descriptor, 'Winner G1');
});

test('deriveOpponentDescriptor labels a real FCS opponent as FCS (PLATFORM-036)', () => {
  // Owner is the away team; opponent is the home team in a real FCS conference
  // whose name does not contain "FCS" — must still render as FCS, not
  // "NoClaim (FBS)".
  for (const conf of ['Big Sky', 'MVFC']) {
    const descriptor = deriveOpponentDescriptor(
      slateGame({
        ownerTeamSide: 'away',
        opponentOwner: undefined,
        game: game({ homeConf: conf }),
      })
    );
    assert.equal(descriptor, 'FCS', `${conf} opponent should render as FCS`);
  }
});

test('deriveOpponentDescriptor labels an unowned FBS opponent as NoClaim (FBS)', () => {
  const descriptor = deriveOpponentDescriptor(
    slateGame({
      ownerTeamSide: 'away',
      opponentOwner: undefined,
      game: game({ homeConf: 'SEC' }),
    })
  );
  assert.equal(descriptor, 'NoClaim (FBS)');
});

test('deriveWeekMatchupSections resolves owners despite a provider-name mismatch (PLATFORM-039)', () => {
  // csvAway "Wash St" differs from the stored/canonical "Washington State".
  const g = game({
    key: 'mismatch',
    csvAway: 'Wash St',
    canAway: 'Washington State',
    csvHome: 'Oregon',
    canHome: 'Oregon',
    awayConf: 'Big Ten',
    homeConf: 'Big Ten',
  });
  const rosterByTeam = new Map([
    ['Washington State', 'Alice'],
    ['Oregon', 'Bob'],
  ]);

  const sections = deriveWeekMatchupSections([g], rosterByTeam);

  assert.equal(sections.ownerMatchups.length, 1);
  assert.equal(sections.ownerMatchups[0]?.awayOwner, 'Alice');
  assert.equal(sections.ownerMatchups[0]?.homeOwner, 'Bob');
});

test('owner slates sort every non-final by kickoff before finals (Item 724)', () => {
  const nowMs = Date.parse('2026-09-01T19:30:00.000Z');
  const games = [
    game({
      key: 'final-first-kickoff',
      date: '2026-09-01T17:00:00.000Z',
      csvAway: 'Owned Final',
      canAway: 'Owned Final',
    }),
    game({
      key: 'scheduled-later',
      date: '2026-09-01T21:00:00.000Z',
      csvAway: 'Owned Scheduled',
      canAway: 'Owned Scheduled',
    }),
    game({
      key: 'live-middle',
      date: '2026-09-01T19:00:00.000Z',
      csvAway: 'Owned Live',
      canAway: 'Owned Live',
    }),
    game({
      key: 'awaiting-earlier',
      date: '2026-09-01T18:00:00.000Z',
      csvAway: 'Owned Awaiting',
      canAway: 'Owned Awaiting',
    }),
    game({
      key: 'invalid-b',
      date: 'not-a-kickoff-b',
      csvAway: 'Owned Invalid B',
      canAway: 'Owned Invalid B',
    }),
    game({
      key: 'invalid-a',
      date: 'not-a-kickoff-a',
      csvAway: 'Owned Invalid A',
      canAway: 'Owned Invalid A',
    }),
    game({
      key: 'invalid-tbd',
      date: '2026-09-01T16:00:00.000Z',
      csvAway: 'Owned Invalid TBD',
      canAway: 'Owned Invalid TBD',
      startTimeTBD: true,
    }),
  ];
  const rosterByTeam = new Map(
    games.map((scheduledGame) => [scheduledGame.csvAway, 'Alex'] as const)
  );
  const scoresByKey = {
    'final-first-kickoff': {
      status: 'Final',
      time: 'Final',
      away: { team: 'Owned Final', score: 24 },
      home: { team: 'Home', score: 17 },
    },
    'live-middle': {
      status: 'In Progress',
      time: 'Q3 8:14',
      away: { team: 'Owned Live', score: 21 },
      home: { team: 'Home', score: 17 },
    },
  };

  const slate = deriveOwnerWeekSlates(games, rosterByTeam, scoresByKey, nowMs)[0];
  assert.ok(slate);
  assert.deepEqual(
    slate.games.map((slateGameItem) => slateGameItem.game.key),
    [
      'awaiting-earlier',
      'live-middle',
      'scheduled-later',
      'invalid-a',
      'invalid-b',
      'invalid-tbd',
      'final-first-kickoff',
    ],
    'state does not outrank kickoff inside the non-final group'
  );
});

// ---------------------------------------------------------------------------
// Item 135, after the model change — the owner-card control counts GAMES.
//
// It previously counted opponent GROUPS, a shape borrowed from the dormant
// `formatSlateSummaryText`, while the list rendered games. Every defect on this
// control came from that mismatch, including a `NoClaim` collision that
// survived a full remediation round. These tests pin the rendered unit.
// ---------------------------------------------------------------------------

function slate(games: OwnerSlateGame[], owner = 'Alex'): OwnerWeekSlate {
  return {
    owner,
    games,
    opponentOwners: [],
    totalGames: games.length,
    liveGames: 0,
    finalGames: 0,
    scheduledGames: games.length,
    performance: { summary: '0-0', detail: '', tone: 'scheduled' },
  } as OwnerWeekSlate;
}

function unownedOpponent(teamId: string, conference: string): OwnerSlateGame {
  return slateGame({
    owner: 'Alex',
    ownerTeamSide: 'away',
    opponentOwner: undefined,
    opponentTeamId: teamId,
    opponentTeamName: teamId,
    game: game({ key: `g-${teamId}`, csvHome: teamId, homeConf: conference }),
  });
}

function unownedSlateOfSize(gameCount: number): OwnerWeekSlate {
  return slate(
    Array.from({ length: gameCount }, (_, index) => unownedOpponent(`opponent-${index}`, 'SEC'))
  );
}

/**
 * The production shape a confirmed draft produces: every undrafted eligible team
 * is written with the reserved `NoClaim` OWNER in the ROSTER. Built through the
 * real derivation rather than by hand.
 *
 * Item 713 changed what that derivation does with it — the sentinel no longer
 * enters `MatchupBucket`, so an unclaimed opponent now has an ABSENT
 * `opponentOwner` rather than a truthy one. The roster is returned alongside the
 * slate so a caller can assert both halves: that the fixture wrote the sentinel,
 * and that the derivation resolved it away.
 */
function noClaimRosterSlate(opponents: string[]): {
  slate: OwnerWeekSlate;
  rosterByTeam: Map<string, string>;
} {
  const games = opponents.map((opponent, index) =>
    game({
      key: `g-${index}`,
      csvAway: `Owned${index}`,
      canAway: `Owned${index}`,
      csvHome: opponent,
      canHome: opponent,
      participants: {
        away: {
          kind: 'team',
          teamId: `Owned${index}-id`,
          displayName: `Owned${index}`,
          canonicalName: `Owned${index}`,
          rawName: `Owned${index}`,
        },
        home: {
          kind: 'team',
          teamId: `${opponent}-id`,
          displayName: opponent,
          canonicalName: opponent,
          rawName: opponent,
        },
      },
    })
  );

  const rosterByTeam = new Map<string, string>();
  opponents.forEach((_, index) => rosterByTeam.set(`Owned${index}`, 'Taylor'));
  for (const opponent of opponents) rosterByTeam.set(opponent, NO_CLAIM_OWNER);

  const ownerSlate = deriveOwnerWeekSlates(games, rosterByTeam, {}, MATCHUPS_TEST_NOW_MS).find(
    (entry) => entry.owner === 'Taylor'
  );
  assert.ok(ownerSlate, 'owner slate should exist');
  return { slate: ownerSlate, rosterByTeam };
}

/** An owner holding BOTH teams in a game — 39 of these in the 2026 season. */
function selfGameSlate(): OwnerWeekSlate {
  const ownerSlate = deriveOwnerWeekSlates(
    [game({ key: 'self-1', csvAway: 'Jacksonville State', csvHome: 'North Dakota State' })],
    new Map([
      ['Jacksonville State', 'Whited'],
      ['North Dakota State', 'Whited'],
    ]),
    {},
    MATCHUPS_TEST_NOW_MS
  ).find((entry) => entry.owner === 'Whited');
  assert.ok(ownerSlate, 'owner slate should exist');
  return ownerSlate;
}

test('selectDistinctSlateGames collapses the mirrored entries of a self game (Item 135)', () => {
  const source = selfGameSlate();

  // Positive control: the fixture must actually carry the duplicate, or it
  // proves nothing about the deduplication.
  assert.equal(source.games.length, 2, 'buildOwnerSlateGames emits one entry per owned side');
  assert.deepEqual(
    source.games.map((slateGameItem) => slateGameItem.ownerTeamSide),
    ['away', 'home']
  );

  const distinct = selectDistinctSlateGames(source);

  assert.equal(distinct.length, 1, 'one real game is one game');
  assert.equal(distinct[0]?.ownerTeamSide, 'away', 'first occurrence wins, deterministically');
});

test('a self game renders one row and counts once (Item 135)', () => {
  const visibility = selectSlateGameVisibility(selfGameSlate(), false);

  assert.equal(visibility.distinctGames.length, 1);
  assert.equal(visibility.visibleGames.length, 1);
  assert.equal(visibility.hasHiddenGames, false);
  assert.equal(visibility.hiddenGameCount, 0);
});

test('selectDistinctSlateGames keeps every genuinely distinct game (Item 135)', () => {
  // Deduplication is by game key, so two different games against the same
  // opponent both survive — the count is of games, not opponents.
  const source = slate([
    unownedOpponent('rice', 'SEC'),
    { ...unownedOpponent('rice', 'SEC'), game: game({ key: 'g-rice-2', homeConf: 'SEC' }) },
    unownedOpponent('tulane', 'SEC'),
  ]);

  assert.deepEqual(
    selectDistinctSlateGames(source).map((slateGameItem) => slateGameItem.game.key),
    ['g-rice', 'g-rice-2', 'g-tulane']
  );
});

test('selectSlateGameVisibility withholds games beyond the default count (Item 135)', () => {
  const visible = getDefaultVisibleGamesCount();
  const source = unownedSlateOfSize(visible + 2);

  const collapsed = selectSlateGameVisibility(source, false);
  const expanded = selectSlateGameVisibility(source, true);

  assert.equal(collapsed.hasHiddenGames, true);
  assert.equal(collapsed.visibleGames.length, visible);
  assert.ok(
    collapsed.visibleGames.length < expanded.visibleGames.length,
    'collapsed must render FEWER games than expanded'
  );
  assert.deepEqual(
    expanded.visibleGames,
    source.games,
    'every game returns when expanded — nothing is dropped'
  );
  assert.deepEqual(
    collapsed.visibleGames,
    source.games.slice(0, visible),
    'collapsed keeps the first games, in slate order'
  );
});

test('selectSlateGameVisibility hides nothing when the slate fits (Item 135)', () => {
  const source = unownedSlateOfSize(getDefaultVisibleGamesCount());

  const collapsed = selectSlateGameVisibility(source, false);

  assert.equal(collapsed.hasHiddenGames, false);
  assert.equal(collapsed.hiddenGameCount, 0);
  assert.deepEqual(collapsed.visibleGames, source.games);
});

test('hiddenGameCount equals the games no visible row represents (Item 135)', () => {
  // Derived from the visible list rather than restating the literal the
  // selector used, so a slice that kept the wrong games would fail here.
  for (const gameCount of [4, 5, 9]) {
    const source = unownedSlateOfSize(gameCount);
    const collapsed = selectSlateGameVisibility(source, false);

    assert.equal(
      collapsed.hiddenGameCount,
      collapsed.distinctGames.length - collapsed.visibleGames.length,
      `${gameCount} games: the label must equal the games actually withheld`
    );
    assert.equal(collapsed.distinctGames.length, gameCount);
  }
});

test('the game count is unaffected by how opponents group (Item 135)', () => {
  // The bug class this model change removes. Five games against five unowned
  // FBS opponents, five games against ONE repeated opponent, and five games
  // against a mix all count five, because the count no longer asks who the
  // opponent is.
  const distinctOpponents = unownedSlateOfSize(5);
  const oneRepeatedOpponent = slate(
    Array.from({ length: 5 }, (_, index) => ({
      ...unownedOpponent('rice', 'SEC'),
      game: game({ key: `g-rice-${index}`, csvHome: 'rice', homeConf: 'SEC' }),
    }))
  );
  const fcsOpponents = slate(
    ['north-dakota', 'montana', 'mercer', 'furman', 'elon'].map((id) =>
      unownedOpponent(id, 'Big Sky')
    )
  );

  for (const [name, source] of [
    ['distinct unowned FBS', distinctOpponents],
    ['one repeated opponent', oneRepeatedOpponent],
    ['FCS opponents', fcsOpponents],
  ] as const) {
    const collapsed = selectSlateGameVisibility(source, false);
    assert.equal(collapsed.distinctGames.length, 5, `${name}: five games`);
    assert.equal(collapsed.hiddenGameCount, 5 - getDefaultVisibleGamesCount(), `${name}: hidden`);
  }
});

test('NoClaim-rostered opponents do not collapse the game count (Item 135)', () => {
  // The Codex finding that prompted the model change. On a drafted league every
  // unclaimed team carries the reserved `NoClaim` OWNER, which grouped them all
  // into one opponent. Counting games is indifferent to it.
  const opponents = ['Rice', 'Tulane', 'SMU', 'Navy', 'Temple'];
  const { slate: source, rosterByTeam } = noClaimRosterSlate(opponents);

  // The positive control has TWO halves since Item 713, and it needs both. The
  // ROSTER carrying the sentinel is what makes this fixture reach the branch —
  // asserting only the derived half would pass on a fixture that never wrote a
  // sentinel at all.
  assert.ok(
    opponents.every((opponent) => rosterByTeam.get(opponent) === NO_CLAIM_OWNER),
    'positive control: every opponent is rostered with the reserved NoClaim owner'
  );
  assert.ok(
    source.games.every((slateGameItem) => slateGameItem.opponentOwner === undefined),
    'Item 713: the sentinel is resolved away before it reaches the slate'
  );

  const collapsed = selectSlateGameVisibility(source, false);

  assert.equal(collapsed.distinctGames.length, 5, 'five games, whoever owns the opponents');
  assert.equal(collapsed.hiddenGameCount, 5 - getDefaultVisibleGamesCount());
});

test('summarizeSlateOpponents counts a self game once (Item 135)', () => {
  // The dormant formatter's input is deduplicated too, so it can no longer
  // report `2 games · vs Self (x2)` for one game. Item 117 owns its fate; this
  // pins the consequence rather than changing the function.
  const entries = summarizeSlateOpponents(selfGameSlate());

  assert.deepEqual(entries, [{ label: 'Self', count: 1 }]);
  assert.equal(
    formatSlateSummaryText({ entries, totalGames: 1, expanded: false }),
    '1 game · vs Self'
  );
});

// ---------------------------------------------------------------------------
// Item 713 — the reserved sentinel is resolved away where owners ENTER the model.
//
// `buildConfirmedOwnersCsv` writes `NoClaim` as a real owner row for every
// undrafted eligible team, so after a draft is confirmed `getOwnerForGameSide`
// resolves an UNOWNED team to a truthy string. Every predicate on the Matchups
// path decided ownership by truthiness, so each one counted the sentinel as a
// member — the sectioning, the owner set that builds slates, the opponent list
// and the self-matchup check alike.
//
// These pin the CONSEQUENCES at the seam rather than at each reader, because the
// fix is one resolution in `deriveWeekMatchupSections` and not four guards.
// Every fixture below carries the sentinel in the ROSTER: a fixture that omits
// unowned teams reads `''` and cannot reach any of this.
// ---------------------------------------------------------------------------

function confirmedDraftScenario() {
  const games = [
    game({
      key: 'g-mixed',
      csvAway: 'Alabama',
      canAway: 'Alabama',
      csvHome: 'Akron',
      canHome: 'Akron',
      participants: {
        away: {
          kind: 'team',
          teamId: 'Alabama-id',
          displayName: 'Alabama',
          canonicalName: 'Alabama',
          rawName: 'Alabama',
        },
        home: {
          kind: 'team',
          teamId: 'Akron-id',
          displayName: 'Akron',
          canonicalName: 'Akron',
          rawName: 'Akron',
        },
      },
    }),
    game({
      key: 'g-unclaimed',
      csvAway: 'Akron',
      canAway: 'Akron',
      csvHome: 'Tulane',
      canHome: 'Tulane',
      participants: {
        away: {
          kind: 'team',
          teamId: 'Akron-id',
          displayName: 'Akron',
          canonicalName: 'Akron',
          rawName: 'Akron',
        },
        home: {
          kind: 'team',
          teamId: 'Tulane-id',
          displayName: 'Tulane',
          canonicalName: 'Tulane',
          rawName: 'Tulane',
        },
      },
    }),
    game({
      key: 'g-owned',
      csvAway: 'Michigan',
      canAway: 'Michigan',
      csvHome: 'Georgia',
      canHome: 'Georgia',
      participants: {
        away: {
          kind: 'team',
          teamId: 'Michigan-id',
          displayName: 'Michigan',
          canonicalName: 'Michigan',
          rawName: 'Michigan',
        },
        home: {
          kind: 'team',
          teamId: 'Georgia-id',
          displayName: 'Georgia',
          canonicalName: 'Georgia',
          rawName: 'Georgia',
        },
      },
    }),
  ];

  const rosterByTeam = new Map<string, string>([
    ['Alabama', 'Alice'],
    ['Michigan', 'Alice'],
    ['Georgia', 'Bob'],
    ['Akron', NO_CLAIM_OWNER],
    ['Tulane', NO_CLAIM_OWNER],
  ]);

  assert.ok(
    ['Akron', 'Tulane'].every((teamName) => rosterByTeam.get(teamName) === NO_CLAIM_OWNER),
    'positive control: both unclaimed teams are rostered with the reserved sentinel'
  );

  return { games, rosterByTeam };
}

test('an undrafted opponent does not make a game an owner matchup (Item 713)', () => {
  const { games, rosterByTeam } = confirmedDraftScenario();
  const sections = deriveWeekMatchupSections(games, rosterByTeam);

  assert.deepEqual(
    sections.ownerMatchups.map((bucket) => bucket.game.key),
    ['g-owned'],
    'only a game with two REAL owners is a head-to-head'
  );
  assert.deepEqual(
    sections.secondaryGames.map((bucket) => bucket.game.key),
    ['g-mixed'],
    'one real owner against an unclaimed team is secondary, not head-to-head'
  );
  assert.deepEqual(
    sections.otherGames.map((bucket) => bucket.game.key),
    ['g-unclaimed'],
    'two unclaimed teams involve no owner at all'
  );

  const mixed = sections.secondaryGames[0]!;
  assert.equal(mixed.awayOwner, 'Alice');
  assert.equal(mixed.homeOwner, undefined, 'the sentinel never enters the bucket');
});

test('the excluded-games summary counts a game between two unclaimed teams (Item 713)', () => {
  // With the sentinel truthy, `otherGames` was empty and this claimed every game
  // appeared on an owner card while one of the three involved no owner.
  const { games, rosterByTeam } = confirmedDraftScenario();

  assert.equal(
    deriveExcludedGamesSummary(deriveWeekMatchupSections(games, rosterByTeam)),
    '1 excluded game does not involve owned teams.'
  );
});

test('no owner slate is built for the reserved sentinel (Item 713)', () => {
  const { games, rosterByTeam } = confirmedDraftScenario();
  const slates = deriveOwnerWeekSlates(games, rosterByTeam, {}, MATCHUPS_TEST_NOW_MS);

  assert.deepEqual(
    slates.map((slate) => slate.owner).sort(),
    ['Alice', 'Bob'],
    'the sentinel is not an owner and gets no card'
  );

  const alice = slates.find((slate) => slate.owner === 'Alice');
  assert.ok(alice, "Alice's slate should exist");
  assert.deepEqual(
    alice.opponentOwners,
    ['Bob'],
    'the sentinel is not listed as an opponent — this is what OwnerPanel joins'
  );

  const unclaimedOpponent = alice.games.find((slateGame) => slateGame.game.key === 'g-mixed');
  assert.ok(unclaimedOpponent, 'the mixed game is on the slate');
  assert.equal(unclaimedOpponent.opponentOwner, undefined);
  assert.equal(unclaimedOpponent.isOwnerVsOwner, false, 'an unclaimed opponent is not an owner');
  assert.equal(unclaimedOpponent.isOpponentUnownedOrNonLeague, true);
});

test('an unclaimed FBS opponent takes the non-owner descriptor branch (Item 713)', () => {
  // `displayOwner` returning null is the right TEST but the wrong VALUE here: the
  // descriptor must fall through to the FCS/placeholder/NoClaim (FBS) ladder
  // rather than substitute an empty owner. Previously this rendered `vs NoClaim`.
  const { games, rosterByTeam } = confirmedDraftScenario();
  const alice = deriveOwnerWeekSlates(games, rosterByTeam, {}, MATCHUPS_TEST_NOW_MS).find(
    (slate) => slate.owner === 'Alice'
  );
  assert.ok(alice, "Alice's slate should exist");
  const unclaimedOpponent = alice.games.find((slateGame) => slateGame.game.key === 'g-mixed');
  assert.ok(unclaimedOpponent, 'the mixed game is on the slate');

  assert.equal(deriveOpponentDescriptor(unclaimedOpponent), 'NoClaim (FBS)');
});

test('two unclaimed teams are not a self matchup (Item 713)', () => {
  // `SELF_DESCRIPTOR` and `isSelfGame` both fire on `opponentOwner === owner`.
  // Two sentinels compared equal, so a game between two undrafted teams was
  // reported as one owner playing themselves — with a `Counts as 1W / 1L`
  // accounting claim — for a game no member owns.
  const { games, rosterByTeam } = confirmedDraftScenario();
  const slates = deriveOwnerWeekSlates(games, rosterByTeam, {}, MATCHUPS_TEST_NOW_MS);

  assert.equal(
    slates.some((slate) => slate.owner === NO_CLAIM_OWNER),
    false,
    'the sentinel has no slate, so it cannot play itself'
  );
  assert.equal(
    slates.some((slate) => slate.games.some((slateGame) => slateGame.game.key === 'g-unclaimed')),
    false,
    'the game between two unclaimed teams reaches no owner card'
  );
  assert.equal(
    slates.some((slate) =>
      slate.games.some((slateGame) => slateGame.opponentOwner === slateGame.owner)
    ),
    false,
    'no slate game is a self matchup, so no finalSelf tone or 1W / 1L claim is reachable'
  );
});
