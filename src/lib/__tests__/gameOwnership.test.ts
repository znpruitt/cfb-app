import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame, ParticipantSlot } from '../schedule';
import {
  getGameOwners,
  getGameSideForTeam,
  getOwnerForGameSide,
  sideIdentityCandidates,
} from '../gameOwnership.ts';

function teamParticipant(overrides: Partial<Extract<ParticipantSlot, { kind: 'team' }>>) {
  return {
    kind: 'team' as const,
    teamId: overrides.teamId ?? 'team-id',
    displayName: overrides.displayName ?? 'Team',
    canonicalName: overrides.canonicalName ?? 'Team',
    rawName: overrides.rawName ?? 'Team',
  };
}

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: 'e',
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: '2026-09-01T17:00:00.000Z',
    stage: 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: 1,
    slotOrder: 1,
    eventKey: 'event',
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
    participants: overrides.participants ?? {
      away: teamParticipant({
        teamId: 'washingtonstate',
        displayName: 'Washington State',
        canonicalName: 'Washington State',
        rawName: 'Wash St',
      }),
      home: teamParticipant({
        teamId: 'oregon',
        displayName: 'Oregon',
        canonicalName: 'Oregon',
        rawName: 'Oregon',
      }),
    },
    // Provider labels intentionally differ from canonical (the bug this fixes).
    csvAway: overrides.csvAway ?? 'Wash St',
    csvHome: overrides.csvHome ?? 'Oregon',
    canAway: overrides.canAway ?? 'Washington State',
    canHome: overrides.canHome ?? 'Oregon',
    awayConf: 'Pac-12',
    homeConf: 'Big Ten',
    ...overrides,
  };
}

test('resolves owner via canonical candidate when the provider name differs', () => {
  const roster = new Map([['Washington State', 'Alice']]);
  assert.equal(getOwnerForGameSide(game({}), 'away', roster), 'Alice');
});

test('resolves owner via participant team id when the roster is keyed by id', () => {
  const roster = new Map([['washingtonstate', 'Bob']]);
  assert.equal(getOwnerForGameSide(game({}), 'away', roster), 'Bob');
});

test('falls back to the raw provider label when only the provider key exists', () => {
  const roster = new Map([['Wash St', 'Cara']]);
  assert.equal(getOwnerForGameSide(game({}), 'away', roster), 'Cara');
});

test('placeholder/derived side does not falsely resolve to an owner', () => {
  const placeholderGame = game({
    participants: {
      away: teamParticipant({
        teamId: 'washingtonstate',
        displayName: 'Washington State',
        canonicalName: 'Washington State',
        rawName: 'Wash St',
      }),
      home: { kind: 'placeholder', slotId: 'slot-home', displayName: 'Winner G1' },
    },
    csvHome: 'TBD',
    canHome: 'TBD',
  });
  const roster = new Map([['Washington State', 'Alice']]);
  assert.equal(getOwnerForGameSide(placeholderGame, 'home', roster), undefined);
  assert.equal(getOwnerForGameSide(placeholderGame, 'away', roster), 'Alice');
});

test('distinct-team safety: only the matching side resolves', () => {
  const roster = new Map([['Washington State', 'Alice']]);
  const owners = getGameOwners(game({}), roster);
  assert.equal(owners.awayOwner, 'Alice');
  assert.equal(owners.homeOwner, undefined);
});

test('getGameSideForTeam resolves side by canonical identity, null when absent', () => {
  const g = game({});
  assert.equal(getGameSideForTeam(g, 'Washington State'), 'away');
  assert.equal(getGameSideForTeam(g, 'Wash St'), 'away'); // provider label still works
  assert.equal(getGameSideForTeam(g, 'Oregon'), 'home');
  assert.equal(getGameSideForTeam(g, 'Nebraska'), null);
  assert.equal(getGameSideForTeam(g, ''), null);
});

test('sideIdentityCandidates are ordered and deduped', () => {
  const candidates = sideIdentityCandidates(game({}), 'away');
  // teamId → canonical/display/raw → canAway → csvAway, deduped.
  assert.deepEqual(candidates, ['washingtonstate', 'Washington State', 'Wash St']);
});
