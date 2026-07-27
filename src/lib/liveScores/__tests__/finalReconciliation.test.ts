import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTeamIdentityResolver,
  resolveTeamIdentityKey,
  type TeamCatalogItem,
} from '@/lib/teamIdentity';

import { parseFinalReconciliation } from '../finalReconciliation';
import { makeLiveGame } from './fixtures';

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

function pendingGame(providerGameId: number) {
  return makeLiveGame(
    {
      providerGameId,
      home: { identityKey: ALA, canonicalName: 'Alabama' },
      away: { identityKey: UGA, canonicalName: 'Georgia' },
    },
    { cachedStatus: 'final', pendingConfirmation: true }
  );
}

function gamesRow(
  id: number,
  homePoints: number | null,
  awayPoints: number | null,
  status = 'final'
) {
  return {
    id,
    home_team: 'Alabama',
    away_team: 'Georgia',
    home_points: homePoints,
    away_points: awayPoints,
    status,
  };
}

test('a non-array payload is invalid-payload', () => {
  assert.equal(
    parseFinalReconciliation({ resolver, payload: {}, pendingGames: [pendingGame(1)] }).kind,
    'invalid-payload'
  );
});

test('an empty payload while confirmation targets exist is empty-unexpected', () => {
  assert.equal(
    parseFinalReconciliation({ resolver, payload: [], pendingGames: [pendingGame(1)] }).kind,
    'empty-unexpected'
  );
});

test('an empty payload with no pending targets is a benign parsed result', () => {
  const result = parseFinalReconciliation({ resolver, payload: [], pendingGames: [] });
  assert.equal(result.kind, 'parsed');
});

test('a completed /games row with both scores confirms the pending final', () => {
  const result = parseFinalReconciliation({
    resolver,
    payload: [gamesRow(401001, 24, 21)],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, ['401001']);
  assert.equal(result.pendingTargetCount, 1);
  assert.equal(result.updates[0]!.pack.status, 'final');
  assert.equal(result.updates[0]!.pack.home.score, 24);
  assert.equal(result.updates[0]!.provisionalFinal, false);
});

test('a /games row still in progress does not confirm; the id stays pending', () => {
  const result = parseFinalReconciliation({
    resolver,
    payload: [gamesRow(401001, 24, 21, 'in_progress')],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, []);
});

test('a completed /games row missing a score does not confirm', () => {
  const result = parseFinalReconciliation({
    resolver,
    payload: [gamesRow(401001, 24, null)],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, []);
});

test('some confirmed, some not → a partial parse', () => {
  const result = parseFinalReconciliation({
    resolver,
    payload: [gamesRow(401001, 24, 21), gamesRow(401002, 10, 10, 'in_progress')],
    pendingGames: [pendingGame(401001), pendingGame(401002)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, ['401001']);
  assert.equal(result.pendingTargetCount, 2);
});

test('a null entry in the /games payload does not throw (Codex round 1, P2)', () => {
  const result = parseFinalReconciliation({
    resolver,
    payload: [null, gamesRow(401001, 24, 21)],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, ['401001']);
});

test('a nonempty payload that normalizes to zero usable rows is schema-drift (Codex round 1, P2)', () => {
  const result = parseFinalReconciliation({
    resolver,
    payload: [null, 'foo', 42, {}],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'schema-drift');
});

test('a /games row whose participants are swapped relative to the schedule does not confirm (Codex round 2, P1)', () => {
  const swapped = {
    id: 401001,
    home_team: 'Georgia', // schedule home is Alabama
    away_team: 'Alabama',
    home_points: 24,
    away_points: 21,
    status: 'final',
  };
  const result = parseFinalReconciliation({
    resolver,
    payload: [swapped],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, []); // inverted orientation → not confirmed
});

test('a corrected final carries the /games score', () => {
  const result = parseFinalReconciliation({
    resolver,
    payload: [gamesRow(401001, 31, 28)],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.equal(result.updates[0]!.pack.home.score, 31);
  assert.equal(result.updates[0]!.pack.away.score, 28);
});
