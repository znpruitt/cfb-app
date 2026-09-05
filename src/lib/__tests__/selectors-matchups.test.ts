import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveExcludedGamesSummary,
  deriveOpponentDescriptor,
  deriveOwnerOutcome,
  formatSlateSummaryText,
  getDefaultVisibleOpponentsCount,
  selectSlateOpponentVisibility,
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

  assert.equal(
    formatSlateSummaryText({ entries, totalGames: 2, expanded: false }),
    '2 games · vs Self (x2)'
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
// Item 135 — the opponent SUMMARY key. `deriveOpponentDescriptor` collapses
// every unowned opponent onto one of two sentinels, so keying the count map on
// that string made three distinct opponents count as one. The count is keyed on
// opponent team identity for those two branches only; owned opponents, `Self`,
// and placeholder/derived participants keep the keys they already had.
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

test('summarizeSlateOpponents counts distinct unowned FBS opponents separately (Item 135)', () => {
  const entries = summarizeSlateOpponents(
    slate([
      unownedOpponent('rice', 'SEC'),
      unownedOpponent('tulane', 'SEC'),
      unownedOpponent('smu', 'SEC'),
    ])
  );

  assert.equal(entries.length, 3, 'three unowned FBS opponents are three opponents, not one');
  assert.deepEqual(
    entries.map((entry) => entry.count),
    [1, 1, 1]
  );
  // The rendered descriptor is unchanged: each entry still carries the sentinel.
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['NoClaim (FBS)', 'NoClaim (FBS)', 'NoClaim (FBS)']
  );
});

test('summarizeSlateOpponents counts distinct FCS opponents separately (Item 135)', () => {
  const entries = summarizeSlateOpponents(
    slate([
      unownedOpponent('north-dakota', 'MVFC'),
      unownedOpponent('montana', 'Big Sky'),
      unownedOpponent('mercer', 'Southern'),
    ])
  );

  assert.equal(entries.length, 3, 'three FCS opponents are three opponents, not one');
  assert.deepEqual(
    entries.map((entry) => entry.count),
    [1, 1, 1]
  );
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['FCS', 'FCS', 'FCS']
  );
});

test('summarizeSlateOpponents repeats one unowned opponent as a single entry (Item 135)', () => {
  // The split is by opponent identity, not per game: the same unowned team met
  // twice is still ONE opponent.
  const entries = summarizeSlateOpponents(
    slate([
      unownedOpponent('rice', 'SEC'),
      { ...unownedOpponent('rice', 'SEC'), game: game({ key: 'g-rice-2', homeConf: 'SEC' }) },
      unownedOpponent('tulane', 'SEC'),
    ])
  );

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.count),
    [2, 1]
  );
});

test('summarizeSlateOpponents keys owned opponents on the opponent owner (Item 135)', () => {
  // Two DIFFERENT teams owned by the same owner stay one opponent entry — the
  // opponent is the owner, not the team. Keying every branch on team identity
  // would have split this.
  const entries = summarizeSlateOpponents(
    slate([
      slateGame({
        owner: 'Alex',
        opponentOwner: 'Bailey',
        opponentTeamId: 'alabama',
        game: game({ key: 'g-bama' }),
        isOpponentUnownedOrNonLeague: false,
      }),
      slateGame({
        owner: 'Alex',
        opponentOwner: 'Bailey',
        opponentTeamId: 'auburn',
        game: game({ key: 'g-auburn' }),
        isOpponentUnownedOrNonLeague: false,
      }),
      slateGame({
        owner: 'Alex',
        opponentOwner: 'Casey',
        opponentTeamId: 'oregon',
        game: game({ key: 'g-oregon' }),
        isOpponentUnownedOrNonLeague: false,
      }),
    ])
  );

  assert.deepEqual(
    entries.map((entry) => ({ label: entry.label, count: entry.count })),
    [
      { label: 'Bailey', count: 2 },
      { label: 'Casey', count: 1 },
    ]
  );
});

test('summarizeSlateOpponents keeps two Self games as one Self entry (Item 135)', () => {
  const self = slateGame({
    owner: 'Alex',
    opponentOwner: 'Alex',
    isOwnerVsOwner: true,
    isOpponentUnownedOrNonLeague: false,
  });
  const entries = summarizeSlateOpponents(
    slate([
      { ...self, opponentTeamId: 'alabama', game: game({ key: 'g-self-1' }) },
      { ...self, opponentTeamId: 'auburn', game: game({ key: 'g-self-2' }) },
    ])
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.label, 'Self');
  assert.equal(entries[0]?.count, 2);
});

test('summarizeSlateOpponents keys placeholder and derived opponents on their display name (Item 135)', () => {
  const placeholder = slateGame({
    owner: 'Alex',
    ownerTeamSide: 'away',
    opponentOwner: undefined,
    opponentTeamId: 'slot-home',
    game: game({
      key: 'g-placeholder',
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
  });
  const derived = slateGame({
    owner: 'Alex',
    ownerTeamSide: 'away',
    opponentOwner: undefined,
    opponentTeamId: 'slot-derived',
    game: game({
      key: 'g-derived',
      participants: {
        away: {
          kind: 'team',
          teamId: 'away-id',
          displayName: 'Away',
          canonicalName: 'Away',
          rawName: 'Away',
        },
        home: {
          kind: 'derived',
          slotId: 'slot-derived',
          displayName: 'Winner G2',
          sourceEventId: 'e1',
          derivation: 'winner',
        },
      },
    }),
  });

  const entries = summarizeSlateOpponents(
    slate([
      placeholder,
      { ...placeholder, game: { ...placeholder.game, key: 'g-placeholder-2' } },
      derived,
    ])
  );

  assert.deepEqual(
    entries.map((entry) => ({ label: entry.label, count: entry.count })),
    [
      { label: 'Winner G1', count: 2 },
      { label: 'Winner G2', count: 1 },
    ]
  );
});

// ---------------------------------------------------------------------------
// Item 135 — the control the count labels. Before this item `isExpanded` was
// read only for the button's own text while the list rendered every game
// unconditionally, so the button hid nothing. Collapsing slices by OPPONENT,
// because that is what the label counts.
// ---------------------------------------------------------------------------

function unownedSlateOfSize(opponentCount: number): OwnerWeekSlate {
  return slate(
    Array.from({ length: opponentCount }, (_, index) => unownedOpponent(`opponent-${index}`, 'SEC'))
  );
}

test('selectSlateOpponentVisibility withholds games beyond the default opponent count (Item 135)', () => {
  const visible = getDefaultVisibleOpponentsCount();
  const source = unownedSlateOfSize(visible + 2);

  const collapsed = selectSlateOpponentVisibility(source, false);
  const expanded = selectSlateOpponentVisibility(source, true);

  assert.equal(collapsed.hasHiddenOpponents, true);
  assert.equal(
    collapsed.visibleGames.length,
    visible,
    'collapsed renders only the games of the first visible opponents'
  );
  assert.ok(
    collapsed.visibleGames.length < expanded.visibleGames.length,
    'collapsed must render FEWER games than expanded'
  );
  assert.deepEqual(
    expanded.visibleGames,
    source.games,
    'every game returns when expanded — nothing is dropped'
  );
  // Collapsed keeps the FIRST opponents, in first-appearance order.
  assert.deepEqual(
    collapsed.visibleGames.map((slateGameItem) => slateGameItem.opponentTeamId),
    source.games.slice(0, visible).map((slateGameItem) => slateGameItem.opponentTeamId)
  );
});

test('selectSlateOpponentVisibility hides nothing when opponents fit (Item 135)', () => {
  const source = unownedSlateOfSize(getDefaultVisibleOpponentsCount());

  const collapsed = selectSlateOpponentVisibility(source, false);

  assert.equal(collapsed.hasHiddenOpponents, false);
  assert.equal(collapsed.hiddenOpponentCount, 0);
  assert.deepEqual(collapsed.visibleGames, source.games);
});

test('hiddenOpponentCount equals the opponents no visible game represents (Item 135)', () => {
  // The label states a number of OPPONENTS. Derive the withheld count from the
  // visible games rather than restating the literal the selector used, so a
  // slice that kept the wrong games would fail here.
  for (const opponentCount of [4, 5, 9]) {
    const source = unownedSlateOfSize(opponentCount);
    const collapsed = selectSlateOpponentVisibility(source, false);
    const opponentsShown = summarizeSlateOpponents(slate(collapsed.visibleGames)).length;

    assert.equal(
      collapsed.hiddenOpponentCount,
      collapsed.entries.length - opponentsShown,
      `${opponentCount} opponents: label must equal the opponents actually withheld`
    );
    assert.equal(collapsed.entries.length, opponentCount);
  }
});

test('selectSlateOpponentVisibility keeps every game of a retained opponent (Item 135)', () => {
  // Slicing by opponent, not by game: a repeated opponent inside the visible
  // window brings BOTH of its games, so the collapsed card can show more games
  // than opponents.
  const source = slate([
    unownedOpponent('rice', 'SEC'),
    { ...unownedOpponent('rice', 'SEC'), game: game({ key: 'g-rice-2', homeConf: 'SEC' }) },
    unownedOpponent('tulane', 'SEC'),
    unownedOpponent('smu', 'SEC'),
    unownedOpponent('navy', 'SEC'),
  ]);

  const collapsed = selectSlateOpponentVisibility(source, false);

  assert.equal(collapsed.entries.length, 4);
  assert.equal(collapsed.hiddenOpponentCount, 1);
  assert.equal(collapsed.visibleGames.length, 4, 'three opponents, four games');
  assert.deepEqual(
    collapsed.visibleGames.map((slateGameItem) => slateGameItem.game.key),
    ['g-rice', 'g-rice-2', 'g-tulane', 'g-smu']
  );
});

// ---------------------------------------------------------------------------
// Item 135, Codex review of 1259bd61 — the PRODUCTION roster shape.
//
// A confirmed draft writes `NoClaim` as the OWNER of every undrafted eligible
// team (`buildConfirmedOwnersCsv`), and `CFBScheduleApp` puts those rows into
// `rosterByTeam` unfiltered. So on a real league an unclaimed opponent has a
// TRUTHY `opponentOwner`, takes the owned branch, and never reaches the team
// key — which left the original defect fully intact where it actually ships.
// The first fixture for this item omitted unowned teams from the roster
// instead, and could not reach that path.
// ---------------------------------------------------------------------------

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
  // The rows a confirmed draft writes for undrafted teams.
  for (const opponent of opponents) rosterByTeam.set(opponent, NO_CLAIM_OWNER);

  const ownerSlate = deriveOwnerWeekSlates(games, rosterByTeam, {}).find(
    (entry) => entry.owner === 'Taylor'
  );
  assert.ok(ownerSlate, 'owner slate should exist');
  return ownerSlate;
}

test('summarizeSlateOpponents counts NoClaim-rostered opponents as distinct opponents (Item 135)', () => {
  const source = noClaimRosterSlate(['Rice', 'Tulane', 'SMU', 'Navy', 'Temple']);

  // The fixture must actually reach the owned branch, or it proves nothing.
  assert.deepEqual(
    source.games.map((slateGameItem) => slateGameItem.opponentOwner),
    Array.from({ length: 5 }, () => NO_CLAIM_OWNER),
    'positive control: every opponent carries the reserved NoClaim owner'
  );

  const entries = summarizeSlateOpponents(source);

  assert.equal(entries.length, 5, 'five unclaimed teams are five opponents, not one');
  assert.deepEqual(
    entries.map((entry) => entry.count),
    [1, 1, 1, 1, 1]
  );
  assert.ok(
    entries.every((entry) => entry.key.startsWith('team:')),
    'the reserved sentinel is not a real owner — it must not key an owner group'
  );
});

test('the reserved NoClaim owner never forms an owner group (Item 135)', () => {
  const source = noClaimRosterSlate(['Rice', 'Tulane', 'SMU', 'Navy']);

  const entries = summarizeSlateOpponents(source);

  assert.equal(
    entries.filter((entry) => entry.key === `owner:${NO_CLAIM_OWNER}`).length,
    0,
    'NoClaim is an unowned marker, not an opponent'
  );
});

test('the collapse control counts NoClaim-rostered opponents (Item 135)', () => {
  // The end of the chain: with the defect present this slate summarised to ONE
  // opponent, so the control was suppressed entirely on a real roster.
  const source = noClaimRosterSlate(['Rice', 'Tulane', 'SMU', 'Navy', 'Temple']);

  const collapsed = selectSlateOpponentVisibility(source, false);

  assert.equal(collapsed.hasHiddenOpponents, true);
  assert.equal(collapsed.hiddenOpponentCount, 5 - getDefaultVisibleOpponentsCount());
  assert.equal(collapsed.visibleGames.length, getDefaultVisibleOpponentsCount());
});

test('an owner literally named FCS stays out of the FCS opponent group (Item 135)', () => {
  // The key namespaces are load-bearing: without the `owner:` / `team:` prefixes
  // a real owner whose name equals a sentinel would merge with unowned teams.
  const entries = summarizeSlateOpponents(
    slate([
      slateGame({
        owner: 'Alex',
        opponentOwner: 'FCS',
        opponentTeamId: 'montana',
        game: game({ key: 'g-owned-by-fcs' }),
        isOpponentUnownedOrNonLeague: false,
      }),
      unownedOpponent('north-dakota', 'MVFC'),
    ])
  );

  assert.equal(entries.length, 2, 'the owner named FCS is not the FCS group');
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ['owner:FCS', 'team:north-dakota']
  );
});
