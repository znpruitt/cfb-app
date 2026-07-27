import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTeamIdentityResolver,
  resolveTeamIdentityKey,
  type TeamCatalogItem,
} from '@/lib/teamIdentity';

import { matchScoreboardRows } from '../scoreboardMatch';
import { makeLiveGame, makeScoreboardRow } from './fixtures';

const TEAMS: TeamCatalogItem[] = [
  { school: 'Alabama', classification: 'fbs', conference: 'SEC' },
  { school: 'Georgia', classification: 'fbs', conference: 'SEC' },
];
const resolver = createTeamIdentityResolver({
  teams: TEAMS,
  aliasMap: {},
  observedNames: ['Alabama', 'Georgia'],
});
const ALA = resolveTeamIdentityKey(resolver, 'Alabama');
const UGA = resolveTeamIdentityKey(resolver, 'Georgia');

// ---- Numeric participant-id attachment (prompt case 9) --------------------

test('matches by provider id and validates numeric participant ids side-for-side', () => {
  const target = makeLiveGame({ providerGameId: 401001, homeId: 333, awayId: 61 });
  const row = makeScoreboardRow({
    providerGameId: 401001,
    status: 'in_progress',
    period: 2,
    clock: '05:00',
    homeId: 333,
    awayId: 61,
    homePoints: 14,
    awayPoints: 7,
  });
  const result = matchScoreboardRows([target], [row], resolver);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.expectedCount, 1);
  const pack = result.matched[0]!.pack;
  assert.equal(pack.id, '401001');
  assert.equal(pack.home.score, 14);
  assert.equal(pack.away.score, 7);
  assert.equal(pack.status, 'Q2 5:00');
});

// ---- Legacy identity fallback (prompt case 10) ----------------------------

test('a legacy schedule row without numeric ids matches via centralized team identity', () => {
  const target = makeLiveGame({
    providerGameId: 401002,
    homeId: null,
    awayId: null,
    home: { identityKey: ALA, canonicalName: 'Alabama' },
    away: { identityKey: UGA, canonicalName: 'Georgia' },
  });
  const row = makeScoreboardRow({
    providerGameId: 401002,
    status: 'completed',
    homeTeam: 'Alabama',
    awayTeam: 'Georgia',
    homePoints: 30,
    awayPoints: 24,
  });
  const result = matchScoreboardRows([target], [row], resolver);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.matched[0]!.pack.home.team, 'Alabama');
  assert.equal(result.matched[0]!.provisionalFinal, true);
});

// ---- Rejections (prompt case 11) ------------------------------------------

test('a numeric-id swap is rejected (never positionally attached)', () => {
  const target = makeLiveGame({ providerGameId: 401003, homeId: 333, awayId: 61 });
  const row = makeScoreboardRow({
    providerGameId: 401003,
    status: 'in_progress',
    homeId: 61,
    awayId: 333,
  });
  assert.equal(matchScoreboardRows([target], [row], resolver).matchedCount, 0);
});

test('a legacy label swap is rejected', () => {
  const target = makeLiveGame({
    providerGameId: 401004,
    homeId: null,
    awayId: null,
    home: { identityKey: ALA, canonicalName: 'Alabama' },
    away: { identityKey: UGA, canonicalName: 'Georgia' },
  });
  const swapped = makeScoreboardRow({
    providerGameId: 401004,
    status: 'in_progress',
    homeTeam: 'Georgia',
    awayTeam: 'Alabama',
  });
  assert.equal(matchScoreboardRows([target], [swapped], resolver).matchedCount, 0);
});

test('a participant mismatch is rejected', () => {
  const target = makeLiveGame({ providerGameId: 401005, homeId: 333, awayId: 61 });
  const row = makeScoreboardRow({
    providerGameId: 401005,
    status: 'in_progress',
    homeId: 333,
    awayId: 999,
  });
  assert.equal(matchScoreboardRows([target], [row], resolver).matchedCount, 0);
});

test('two rows for the same provider id are ambiguous and both leave the target unmatched', () => {
  const target = makeLiveGame({ providerGameId: 401006, homeId: 333, awayId: 61 });
  const rowA = makeScoreboardRow({
    providerGameId: 401006,
    status: 'in_progress',
    homeId: 333,
    awayId: 61,
  });
  const rowB = makeScoreboardRow({
    providerGameId: 401006,
    status: 'completed',
    homeId: 333,
    awayId: 61,
  });
  assert.equal(matchScoreboardRows([target], [rowA, rowB], resolver).matchedCount, 0);
});

test('a scoreboard row for a game absent from the targets is ignored (never minted)', () => {
  const target = makeLiveGame({ providerGameId: 401007, homeId: 333, awayId: 61 });
  const foreign = makeScoreboardRow({
    providerGameId: 999999,
    status: 'in_progress',
    homeId: 1,
    awayId: 2,
  });
  const result = matchScoreboardRows([target], [foreign], resolver);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.expectedCount, 1);
});

test('a target absent from the scoreboard response leaves it unmatched (missing, not final)', () => {
  const target = makeLiveGame({ providerGameId: 401008, homeId: 333, awayId: 61 });
  assert.equal(matchScoreboardRows([target], [], resolver).matchedCount, 0);
});
