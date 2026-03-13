import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTeamName, isLikelyInvalidTeamLabel } from '../teamNormalization';
import { createTeamIdentityResolver } from '../teamIdentity';
import { buildScheduleFromApi } from '../schedule';

test('normalization cases', () => {
  assert.equal(normalizeTeamName('Fordham'), 'fordham');
  assert.equal(normalizeTeamName('Gardner-Webb'), 'gardnerwebb');
  assert.equal(normalizeTeamName('Miami (FL)'), 'miamifl');
  assert.equal(normalizeTeamName('Texas A&M'), 'texasam');
  assert.equal(normalizeTeamName('Ole Miss'), 'olemiss');
});

test('canonical resolution includes observed FCS opponents', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    observedNames: ['Fordham'],
  });

  const result = resolver.resolveName('Fordham');
  assert.equal(result.status, 'resolved');
  assert.equal(result.identityKey, 'fordham');
});

test('alias resolution works when needed', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: { 'louisiana monroe': 'UL Monroe' },
    teams: [{ school: 'UL Monroe', level: 'FBS' }],
  });

  const result = resolver.resolveName('Louisiana Monroe');
  assert.equal(result.status, 'resolved');
  assert.equal(result.canonicalName, 'UL Monroe');
});

test('invalid rows are filtered before resolution', () => {
  assert.equal(isLikelyInvalidTeamLabel('ACC Championship Game 8pm ET ABC Charlotte, NC'), true);
});

test('game filtering keeps FBS-vs-FCS and drops FCS-vs-FCS', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    scheduleItems: [
      {
        id: '1', week: 1, startDate: null, neutralSite: false, conferenceGame: false,
        homeTeam: 'Boston College', awayTeam: 'Fordham', homeConference: 'ACC', awayConference: 'Patriot', status: 'scheduled',
      },
      {
        id: '2', week: 1, startDate: null, neutralSite: false, conferenceGame: false,
        homeTeam: 'Fordham', awayTeam: 'Colgate', homeConference: 'Patriot', awayConference: 'Patriot', status: 'scheduled',
      },
    ],
  });

  assert.equal(built.games.length, 1);
  assert.equal(built.games[0]?.csvAway, 'Fordham');
});

test('unowned FCS team does not create identity-unresolved issue', () => {
  const built = buildScheduleFromApi({
    aliasMap: {},
    teams: [{ school: 'Boston College', level: 'FBS' }],
    scheduleItems: [{
      id: '1', week: 1, startDate: null, neutralSite: false, conferenceGame: false,
      homeTeam: 'Boston College', awayTeam: 'Fordham', homeConference: 'ACC', awayConference: 'Patriot', status: 'scheduled',
    }],
  });

  assert.equal(built.issues.some((x) => x.includes('identity-unresolved')), false);
});
