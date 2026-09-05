// Item 135 — the "Show N more opponents" control on an owner card.
//
// Two defects shipped together and only make sense together. The opponent COUNT
// keyed on `deriveOpponentDescriptor`, which collapses every unowned FBS
// opponent onto one sentinel, so five distinct opponents counted as one. And the
// control the count labels was inert: `isExpanded` was read only for the
// button's own text while the list rendered `slate.games` unsliced, so clicking
// hid nothing. Correcting the count alone would have made a dead button appear
// on MORE cards, because the collapse was what suppressed it.
//
// This suite needs a real DOM because the interaction is the subject — the other
// `MatchupsWeekPanel` suite renders to static markup and can only ever observe
// the collapsed state.
import '../../test/domEnvironment.ts';

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import React from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';

import MatchupsWeekPanel from '../MatchupsWeekPanel';
import { deriveOwnerWeekSlates } from '../../lib/matchups';
import {
  getDefaultVisibleOpponentsCount,
  selectSlateOpponentVisibility,
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

/**
 * One owner, `opponentCount` games, each against a DISTINCT unowned FBS
 * opponent. Every one of those opponents describes itself as `NoClaim (FBS)`,
 * which is exactly the collapse Item 135 fixes: before the fix this whole slate
 * summarised to one opponent.
 */
function unownedOpponentSlate(opponentCount: number): {
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  opponentNames: string[];
} {
  const opponentNames = Array.from({ length: opponentCount }, (_, index) => `Opponent${index}`);
  const games = opponentNames.map((opponent, index) =>
    game({ key: `g${index}`, csvAway: `Owned${index}`, csvHome: opponent })
  );
  const rosterByTeam = new Map(opponentNames.map((_, index) => [`Owned${index}`, OWNER]));
  return { games, rosterByTeam, opponentNames };
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

function ownerCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>(`[data-owner-card="${OWNER}"]`);
  assert.ok(card, 'owner card should render');
  return card;
}

function gameRowCount(container: HTMLElement): number {
  return ownerCard(container).querySelectorAll('ul > li').length;
}

test('matchups opponent control collapses the game list and restores it when expanded (Item 135)', () => {
  const visible = getDefaultVisibleOpponentsCount();
  const { games, rosterByTeam } = unownedOpponentSlate(visible + 2);
  const { container } = renderPanel(games, rosterByTeam);

  const collapsedRows = gameRowCount(container);
  assert.equal(
    collapsedRows,
    visible,
    'collapsed shows only the games of the first visible opponents'
  );
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

test('matchups opponent control withholds whole opponents, not arbitrary games (Item 135)', () => {
  const visible = getDefaultVisibleOpponentsCount();
  const { games, rosterByTeam, opponentNames } = unownedOpponentSlate(visible + 2);
  const { container } = renderPanel(games, rosterByTeam);

  const card = ownerCard(container);
  for (const shown of opponentNames.slice(0, visible)) {
    assert.match(card.innerHTML, new RegExp(shown), `${shown} is within the visible window`);
  }
  for (const hidden of opponentNames.slice(visible)) {
    assert.doesNotMatch(
      card.innerHTML,
      new RegExp(hidden),
      `${hidden} is withheld while collapsed`
    );
  }

  fireEvent.click(within(ownerCard(container)).getByRole('button'));

  for (const opponent of opponentNames) {
    assert.match(ownerCard(container).innerHTML, new RegExp(opponent));
  }
});

test('the opponent control label states the number of opponents actually withheld (Item 135)', () => {
  const visible = getDefaultVisibleOpponentsCount();
  const { games, rosterByTeam } = unownedOpponentSlate(visible + 2);

  // Derive the expectation the way the surface does, from the slate itself,
  // rather than restating a literal that would pass against a wrong slice.
  const slate = deriveOwnerWeekSlates(games, rosterByTeam, {}).find(
    (entry) => entry.owner === OWNER
  );
  assert.ok(slate, 'owner slate should exist');
  const collapsed = selectSlateOpponentVisibility(slate, false);
  const expectedWithheld = collapsed.entries.length - visible;
  assert.ok(expectedWithheld > 0, 'fixture must actually withhold opponents');

  const { container } = renderPanel(games, rosterByTeam);
  const toggle = within(ownerCard(container)).getByRole('button');

  assert.equal(toggle.textContent, `Show ${expectedWithheld} more opponents ↓`);

  fireEvent.click(toggle);
  assert.equal(toggle.textContent, 'Show less ↑');
});

test('distinct unowned FBS opponents each count once toward the control label (Item 135)', () => {
  // The count defect end to end: five distinct unowned FBS opponents all
  // describe themselves as `NoClaim (FBS)`. Keyed on that descriptor the slate
  // summarised to ONE opponent, so this control never rendered at all.
  const visible = getDefaultVisibleOpponentsCount();
  const { games, rosterByTeam } = unownedOpponentSlate(visible + 2);
  const { container } = renderPanel(games, rosterByTeam);

  const toggle = within(ownerCard(container)).getByRole('button');
  assert.equal(toggle.textContent, 'Show 2 more opponents ↓');
});

test('the rendered opponent descriptor is unchanged by the count re-key (Item 135)', () => {
  // The gate on this item: `NoClaim (FBS)` stays suppressed from a row's
  // metadata and `FCS` stays rendered, because an FBS-over-FCS result means
  // something different. Re-keying the COUNT must not disturb either.
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

// ---------------------------------------------------------------------------
// Codex review of 1259bd61 — the production roster shape, at the surface.
//
// A confirmed draft writes `NoClaim` as the OWNER of every undrafted eligible
// team, and those rows reach `rosterByTeam` unfiltered. The fixtures above omit
// unowned teams from the roster instead, which is a real shape but NOT the one
// a drafted league ships with — and the original fix passed against them while
// leaving the defect fully intact here.
// ---------------------------------------------------------------------------

function noClaimRoster(opponentCount: number): {
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  opponentNames: string[];
} {
  const built = unownedOpponentSlate(opponentCount);
  const rosterByTeam = new Map(built.rosterByTeam);
  for (const opponent of built.opponentNames) rosterByTeam.set(opponent, NO_CLAIM_OWNER);
  return { ...built, rosterByTeam };
}

test('the control counts NoClaim-rostered opponents on a drafted league (Item 135)', () => {
  const visible = getDefaultVisibleOpponentsCount();
  const { games, rosterByTeam } = noClaimRoster(visible + 2);

  // Positive control: the fixture must actually carry the reserved owner, or it
  // degenerates into the roster-absent case that already passed.
  const slate = deriveOwnerWeekSlates(games, rosterByTeam, {}).find(
    (entry) => entry.owner === OWNER
  );
  assert.ok(slate, 'owner slate should exist');
  assert.ok(
    slate.games.every((slateGame) => slateGame.opponentOwner === NO_CLAIM_OWNER),
    'every opponent carries the reserved NoClaim owner'
  );

  const { container } = renderPanel(games, rosterByTeam);
  const toggle = within(ownerCard(container)).getByRole('button');

  assert.equal(toggle.textContent, 'Show 2 more opponents ↓');
  assert.equal(gameRowCount(container), visible);
});

test('a NoClaim-rostered opponent is not rendered as an owner (Item 135)', () => {
  // The reserved sentinel must stay out of member-facing copy — it is a marker,
  // not somebody's name.
  const { games, rosterByTeam } = noClaimRoster(2);
  const { container } = renderPanel(games, rosterByTeam);

  assert.doesNotMatch(ownerCard(container).innerHTML, /NoClaim/);
});

test('the control label is singular when exactly one opponent is withheld (Item 135)', () => {
  const { games, rosterByTeam } = noClaimRoster(getDefaultVisibleOpponentsCount() + 1);
  const { container } = renderPanel(games, rosterByTeam);

  const toggle = within(ownerCard(container)).getByRole('button');
  assert.equal(toggle.textContent, 'Show 1 more opponent ↓');
});

test('the collapse control carries disclosure state for assistive technology (Item 135)', () => {
  const { games, rosterByTeam } = noClaimRoster(getDefaultVisibleOpponentsCount() + 2);
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
