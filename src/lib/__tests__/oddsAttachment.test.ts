import assert from 'node:assert/strict';
import test from 'node:test';

import { attachOddsEventsToSchedule } from '../oddsAttachment.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';

test('odds attachment uses centralized resolver equality for aliases and casing', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: { 'wash st': 'Washington State' },
    teams: [
      { school: 'Washington State', level: 'FBS' },
      { school: 'Boise State', level: 'FBS' },
    ],
  });

  const attached = attachOddsEventsToSchedule({
    games: [
      {
        key: 'wazzu-boise',
        week: 1,
        canHome: 'Washington State',
        canAway: 'Boise State',
        csvHome: 'Washington State',
        csvAway: 'Boise State',
      },
    ],
    events: [
      {
        homeTeam: 'wash st',
        awayTeam: 'BOISE STATE',
      },
    ],
    resolver,
  });

  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.gameKey, 'wazzu-boise');
});

test('odds attachment keeps distinct teams from cross-matching', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: {},
    teams: [
      { school: 'Washington State', level: 'FBS' },
      { school: 'Washington', level: 'FBS' },
      { school: 'Boise State', level: 'FBS' },
      { school: 'Boise', level: 'OTHER' },
    ],
  });

  const attached = attachOddsEventsToSchedule({
    games: [
      {
        key: 'wazzu-boise-state',
        week: 1,
        canHome: 'Washington State',
        canAway: 'Boise State',
        csvHome: 'Washington State',
        csvAway: 'Boise State',
      },
    ],
    events: [
      {
        homeTeam: 'Washington',
        awayTeam: 'Boise',
      },
    ],
    resolver,
  });

  assert.equal(attached.length, 0);
});
