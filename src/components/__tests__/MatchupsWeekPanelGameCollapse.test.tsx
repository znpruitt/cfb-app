// Item 135 — the "Show N more games" control on an owner card.
//
// Three defects, one root. The control was INERT: `isExpanded` was read only for
// the button's own text while the list rendered every slate entry, so clicking
// hid nothing. Its count grouped OPPONENTS, borrowed from the dormant
// `formatSlateSummaryText`, so a label counting one unit sat above a list
// rendering another — which is how three distinct unowned opponents counted as
// one, and how a drafted league's reserved `NoClaim` owner collapsed every
// unclaimed team into a single group. And `buildOwnerSlateGames` emits one entry
// per owned SIDE, so an owner holding both teams got two mirrored rows for one
// game. Counting and rendering the same unit — the game — removes all three.
//
// This suite needs a real DOM because the interaction is the subject; the other
// `MatchupsWeekPanel` suite renders to static markup and can only observe the
// collapsed state.
import '../../test/domEnvironment.ts';

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';

import MatchupsWeekPanel from '../MatchupsWeekPanel';
import { deriveOwnerWeekSlates } from '../../lib/matchups';
import {
  getDefaultVisibleGamesCount,
  selectSlateGameVisibility,
} from '../../lib/selectors/matchups';
import { NO_CLAIM_OWNER } from '../../lib/standings';
import type { AppGame } from '../../lib/schedule';

afterEach(() => cleanup());

const OWNER = 'Taylor';

function game(overrides: Partial<AppGame> & { key: string }): AppGame {
  return {
    key: overrides.key,
    eventId: overrides.key,
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: '2025-08-30T20:00:00.000Z',
    stage: 'regular',
    status: 'scheduled',
    stageOrder: 1,
    slotOrder: 0,
    eventKey: overrides.key,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: null,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: {
        kind: 'team',
        teamId: `${overrides.csvAway ?? 'Away'}-id`,
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
      home: {
        kind: 'team',
        teamId: `${overrides.csvHome ?? 'Home'}-id`,
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.csvAway ?? 'Away',
    canHome: overrides.csvHome ?? 'Home',
    awayConf: 'Big 12',
    homeConf: overrides.homeConf ?? 'Big 12',
    sources: undefined,
  };
}

/** One owner, `gameCount` games, each against a distinct opponent absent from the roster. */
function slateOfSize(gameCount: number): {
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  opponentNames: string[];
} {
  const opponentNames = Array.from({ length: gameCount }, (_, index) => `Opponent${index}`);
  const games = opponentNames.map((opponent, index) =>
    game({ key: `g${index}`, csvAway: `Owned${index}`, csvHome: opponent })
  );
  const rosterByTeam = new Map(opponentNames.map((_, index) => [`Owned${index}`, OWNER]));
  return { games, rosterByTeam, opponentNames };
}

/**
 * The shape a confirmed draft actually writes: every undrafted eligible team
 * carries the reserved `NoClaim` OWNER, so an unclaimed opponent has a truthy
 * `opponentOwner`. A fixture that merely omits them from the roster cannot reach
 * the branch this covers.
 */
function noClaimRoster(gameCount: number): {
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  opponentNames: string[];
} {
  const built = slateOfSize(gameCount);
  const rosterByTeam = new Map(built.rosterByTeam);
  for (const opponent of built.opponentNames) rosterByTeam.set(opponent, NO_CLAIM_OWNER);
  return { ...built, rosterByTeam };
}

function renderPanel(games: AppGame[], rosterByTeam: Map<string, string>) {
  return render(
    <MatchupsWeekPanel
      games={games}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={rosterByTeam}
      displayTimeZone="America/New_York"
    />
  );
}

function ownerCard(container: HTMLElement, owner = OWNER): HTMLElement {
  const card = container.querySelector<HTMLElement>(`[data-owner-card="${owner}"]`);
  assert.ok(card, `owner card for ${owner} should render`);
  return card;
}

function gameRowCount(container: HTMLElement, owner = OWNER): number {
  return ownerCard(container, owner).querySelectorAll('ul > li').length;
}

test('the control collapses the game list and restores it when expanded (Item 135)', () => {
  const visible = getDefaultVisibleGamesCount();
  const { games, rosterByTeam } = slateOfSize(visible + 2);
  const { container } = renderPanel(games, rosterByTeam);

  const collapsedRows = gameRowCount(container);
  assert.equal(collapsedRows, visible, 'collapsed shows only the first games');
  assert.ok(
    collapsedRows < games.length,
    'the control must actually withhold games — it hid nothing before Item 135'
  );

  const toggle = within(ownerCard(container)).getByRole('button');
  fireEvent.click(toggle);

  assert.equal(gameRowCount(container), games.length, 'every game returns when expanded');

  fireEvent.click(toggle);
  assert.equal(gameRowCount(container), collapsedRows, 'collapsing again withholds them again');
});

test('the withheld games are the ones beyond the visible window (Item 135)', () => {
  const visible = getDefaultVisibleGamesCount();
  const { games, rosterByTeam, opponentNames } = slateOfSize(visible + 2);
  const { container } = renderPanel(games, rosterByTeam);

  const card = ownerCard(container);
  for (const shown of opponentNames.slice(0, visible)) {
    assert.match(card.innerHTML, new RegExp(`${shown}<`), `${shown} is within the window`);
  }
  for (const hidden of opponentNames.slice(visible)) {
    assert.doesNotMatch(card.innerHTML, new RegExp(`${hidden}<`), `${hidden} is withheld`);
  }

  fireEvent.click(within(ownerCard(container)).getByRole('button'));

  for (const opponent of opponentNames) {
    assert.match(ownerCard(container).innerHTML, new RegExp(`${opponent}<`));
  }
});

test('the control label states the number of games actually withheld (Item 135)', () => {
  const visible = getDefaultVisibleGamesCount();
  const { games, rosterByTeam } = slateOfSize(visible + 2);

  // Derive the expectation the way the surface does, from the slate itself,
  // rather than restating a literal that would pass against a wrong slice.
  const slate = deriveOwnerWeekSlates(games, rosterByTeam, {}).find(
    (entry) => entry.owner === OWNER
  );
  assert.ok(slate, 'owner slate should exist');
  const collapsed = selectSlateGameVisibility(slate, false);
  const expectedWithheld = collapsed.distinctGames.length - collapsed.visibleGames.length;
  assert.ok(expectedWithheld > 0, 'fixture must actually withhold games');

  const { container } = renderPanel(games, rosterByTeam);
  const toggle = within(ownerCard(container)).getByRole('button');

  assert.equal(toggle.textContent, `Show ${expectedWithheld} more games ↓`);

  fireEvent.click(toggle);
  assert.equal(toggle.textContent, 'Show less ↑');
});

test('the label is singular when exactly one game is withheld (Item 135)', () => {
  const { games, rosterByTeam } = slateOfSize(getDefaultVisibleGamesCount() + 1);
  const { container } = renderPanel(games, rosterByTeam);

  const toggle = within(ownerCard(container)).getByRole('button');
  assert.equal(toggle.textContent, 'Show 1 more game ↓');
});

test('the count is indifferent to who owns the opponents (Item 135)', () => {
  // The bug class the model change removed. On a drafted league every unclaimed
  // team carries the reserved `NoClaim` OWNER, which grouped them into ONE
  // opponent and suppressed the control entirely. Counting games ignores that.
  const visible = getDefaultVisibleGamesCount();
  const { games, rosterByTeam } = noClaimRoster(visible + 2);

  const slate = deriveOwnerWeekSlates(games, rosterByTeam, {}).find(
    (entry) => entry.owner === OWNER
  );
  assert.ok(slate, 'owner slate should exist');
  assert.ok(
    slate.games.every((slateGame) => slateGame.opponentOwner === NO_CLAIM_OWNER),
    'positive control: every opponent carries the reserved NoClaim owner'
  );

  const { container } = renderPanel(games, rosterByTeam);

  assert.equal(within(ownerCard(container)).getByRole('button').textContent, 'Show 2 more games ↓');
  assert.equal(gameRowCount(container), visible);
});

test('a self game renders one row, not two mirrored rows (Item 135)', () => {
  // 39 games in the 2026 season have one owner holding both teams. Each renders
  // twice today, because `buildOwnerSlateGames` emits one entry per owned side
  // and the row key carried `ownerTeamSide`.
  const games = [game({ key: 'self-1', csvAway: 'Jacksonville State', csvHome: 'North Dakota' })];
  const rosterByTeam = new Map([
    ['Jacksonville State', 'Whited'],
    ['North Dakota', 'Whited'],
  ]);

  const slate = deriveOwnerWeekSlates(games, rosterByTeam, {}).find(
    (entry) => entry.owner === 'Whited'
  );
  assert.ok(slate, 'owner slate should exist');
  assert.equal(slate.games.length, 2, 'positive control: the slate really does carry two entries');

  const { container } = renderPanel(games, rosterByTeam);

  assert.equal(gameRowCount(container, 'Whited'), 1, 'one game is one row');
  // And no control appears, because one game hides nothing.
  assert.equal(ownerCard(container, 'Whited').querySelector('button'), null);
});

test('the collapse control carries disclosure state for assistive technology (Item 135)', () => {
  const { games, rosterByTeam } = slateOfSize(getDefaultVisibleGamesCount() + 2);
  const { container } = renderPanel(games, rosterByTeam);

  const card = ownerCard(container);
  const toggle = within(card).getByRole('button');
  const controlled = toggle.getAttribute('aria-controls');

  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(controlled, 'the button must name the region it controls');
  // Compared by id rather than by selector lookup: `React.useId` emits colons,
  // which are not valid unescaped in a CSS id selector.
  assert.equal(
    card.querySelector('ul')?.id,
    controlled,
    'aria-controls must point at the game list it actually shows and hides'
  );

  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
});

test('the rendered opponent descriptor is unchanged by the count model (Item 135)', () => {
  // The standing gate: `NoClaim (FBS)` stays suppressed from a row's metadata
  // and `FCS` stays rendered, because an FBS-over-FCS result means something
  // different. Neither the re-key nor the move to counting games disturbs it.
  const games = [
    game({ key: 'g-fbs', csvAway: 'OwnedFbs', csvHome: 'Houston', homeConf: 'Big 12' }),
    game({ key: 'g-fcs', csvAway: 'OwnedFcs', csvHome: 'North Dakota', homeConf: 'MVFC' }),
  ];
  const rosterByTeam = new Map([
    ['OwnedFbs', OWNER],
    ['OwnedFcs', OWNER],
  ]);

  const { container } = renderPanel(games, rosterByTeam);
  const card = ownerCard(container);

  assert.doesNotMatch(card.innerHTML, /NoClaim/, 'the unowned-FBS sentinel stays suppressed');
  assert.match(card.innerHTML, /FCS/, 'the FCS marker still renders');
});

test('a NoClaim-rostered opponent is not rendered as an owner (Item 135)', () => {
  const { games, rosterByTeam } = noClaimRoster(2);
  const { container } = renderPanel(games, rosterByTeam);

  assert.doesNotMatch(ownerCard(container).innerHTML, /NoClaim/);
});
