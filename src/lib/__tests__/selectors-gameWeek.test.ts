import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveGameWeekPanelViewModel } from '../selectors/gameWeek.ts';
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
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
      home: {
        kind: 'team',
        teamId: 'home-id',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
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

test('deriveGameWeekPanelViewModel groups games and computes counts', () => {
  const games = [game({ key: 'a' }), game({ key: 'b', status: 'in_progress' })];

  const vm = deriveGameWeekPanelViewModel({
    games,
    oddsByKey: {
      a: {
        favorite: 'Away',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        total: 51.5,
        mlHome: -150,
        mlAway: 130,
        overPrice: -110,
        underPrice: -110,
        source: 'DraftKings',
        bookmakerKey: 'draftkings',
        capturedAt: '2026-09-01T12:00:00.000Z',
        lineSourceStatus: 'latest',
      },
    },
    scoresByKey: {
      b: {
        status: 'in progress',
        time: '5:00',
        away: { team: 'Away', score: 7 },
        home: { team: 'Home', score: 3 },
      },
    },
    rosterByTeam: new Map([
      ['Away', 'Alice'],
      ['Home', 'Bob'],
    ]),
    rankingsByTeamId: new Map([['away-id', { rank: 12, rankSource: 'ap' }]]),
    displayTimeZone: 'America/New_York',
  });

  assert.equal(vm.totalGames, 2);
  assert.equal(vm.scoresAvailableCount, 1);
  assert.equal(vm.oddsAvailableCount, 1);
  assert.equal(vm.hasNoGames, false);
  assert.equal(vm.groupedGames.length, 1);
  assert.equal(vm.groupedGames[0]?.games.length, 2);
  assert.equal(vm.groupedGames[0]?.games[0]?.showOwnerMatchup, true);
});

test('deriveGameWeekPanelViewModel marks placeholders and canonical-label rule', () => {
  const vm = deriveGameWeekPanelViewModel({
    games: [
      game({
        key: 'p',
        stage: 'bowl',
        status: 'placeholder',
        label: 'Winner A vs Winner B',
        csvAway: 'Team TBD',
        csvHome: 'Winner SEC',
      }),
    ],
    oddsByKey: {},
    scoresByKey: {},
    rosterByTeam: new Map(),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'America/New_York',
  });

  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card);
  assert.equal(card?.showCollapsedCanonicalLabel, true);
  assert.ok((card?.summaryState ?? '').length > 0);
});

test('owner matchup resolves despite a provider-name mismatch (PLATFORM-039)', () => {
  // csvAway "Wash St" differs from the stored/canonical "Washington State".
  const vm = deriveGameWeekPanelViewModel({
    games: [
      game({
        key: 'mismatch',
        csvAway: 'Wash St',
        canAway: 'Washington State',
        csvHome: 'Oregon',
        canHome: 'Oregon',
        awayConf: 'Big Ten',
        homeConf: 'Big Ten',
      }),
    ],
    oddsByKey: {},
    scoresByKey: {},
    rosterByTeam: new Map([
      ['Washington State', 'Alice'],
      ['Oregon', 'Bob'],
    ]),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'America/New_York',
  });

  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card);
  assert.equal(card?.awayOwner, 'Alice');
  assert.equal(card?.homeOwner, 'Bob');
  assert.equal(card?.showOwnerMatchup, true);
});

test('an FCS participant cannot create an owner matchup (PLATFORM-036)', () => {
  // Real FCS conference (Big Sky) that does not contain the token "FCS"; even
  // though both teams appear in the roster, the FCS team must not be owned and
  // the game must not surface as an owner matchup.
  const vm = deriveGameWeekPanelViewModel({
    games: [
      game({
        key: 'fbs-vs-fcs',
        csvAway: 'Montana',
        csvHome: 'Washington',
        awayConf: 'Big Sky',
        homeConf: 'Big Ten',
      }),
    ],
    oddsByKey: {},
    scoresByKey: {},
    rosterByTeam: new Map([
      ['Montana', 'Alice'],
      ['Washington', 'Bob'],
    ]),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'America/New_York',
  });

  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card);
  assert.equal(card?.awayOwner, undefined);
  assert.equal(card?.homeOwner, 'Bob');
  assert.equal(card?.showOwnerMatchup, false);
});
