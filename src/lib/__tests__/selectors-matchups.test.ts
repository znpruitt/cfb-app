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
 * is written with the reserved `NoClaim` OWNER, so an unclaimed opponent has a
 * truthy `opponentOwner`. Built through the real derivation rather than by hand.
 */
function noClaimRosterSlate(opponents: string[]): OwnerWeekSlate {
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

  const ownerSlate = deriveOwnerWeekSlates(games, rosterByTeam, {}).find(
    (entry) => entry.owner === 'Taylor'
  );
  assert.ok(ownerSlate, 'owner slate should exist');
  return ownerSlate;
}

/** An owner holding BOTH teams in a game — 39 of these in the 2026 season. */
function selfGameSlate(): OwnerWeekSlate {
  const ownerSlate = deriveOwnerWeekSlates(
    [game({ key: 'self-1', csvAway: 'Jacksonville State', csvHome: 'North Dakota State' })],
    new Map([
      ['Jacksonville State', 'Whited'],
      ['North Dakota State', 'Whited'],
    ]),
    {}
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
  const source = noClaimRosterSlate(['Rice', 'Tulane', 'SMU', 'Navy', 'Temple']);

  assert.ok(
    source.games.every((slateGameItem) => slateGameItem.opponentOwner === NO_CLAIM_OWNER),
    'positive control: every opponent carries the reserved NoClaim owner'
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
