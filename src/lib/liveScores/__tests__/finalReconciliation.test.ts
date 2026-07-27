import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFinalReconciliation } from '../finalReconciliation';
import { makeLiveGame } from './fixtures';

function pendingGame(providerGameId: number) {
  return makeLiveGame(
    {
      providerGameId,
      home: { identityKey: 'h', canonicalName: 'Alabama' },
      away: { identityKey: 'a', canonicalName: 'Georgia' },
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
    parseFinalReconciliation({ payload: {}, pendingGames: [pendingGame(1)] }).kind,
    'invalid-payload'
  );
});

test('an empty payload while confirmation targets exist is empty-unexpected', () => {
  assert.equal(
    parseFinalReconciliation({ payload: [], pendingGames: [pendingGame(1)] }).kind,
    'empty-unexpected'
  );
});

test('an empty payload with no pending targets is a benign parsed result', () => {
  const result = parseFinalReconciliation({ payload: [], pendingGames: [] });
  assert.equal(result.kind, 'parsed');
});

test('a completed /games row with both scores confirms the pending final', () => {
  const result = parseFinalReconciliation({
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
    payload: [gamesRow(401001, 24, 21, 'in_progress')],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, []);
});

test('a completed /games row missing a score does not confirm', () => {
  const result = parseFinalReconciliation({
    payload: [gamesRow(401001, 24, null)],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, []);
});

test('some confirmed, some not → a partial parse', () => {
  const result = parseFinalReconciliation({
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
    payload: [null, gamesRow(401001, 24, 21)],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.deepEqual(result.confirmedIds, ['401001']);
});

test('a nonempty payload that normalizes to zero usable rows is schema-drift (Codex round 1, P2)', () => {
  const result = parseFinalReconciliation({
    payload: [null, 'foo', 42, {}],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'schema-drift');
});

test('a corrected final carries the /games score', () => {
  const result = parseFinalReconciliation({
    payload: [gamesRow(401001, 31, 28)],
    pendingGames: [pendingGame(401001)],
  });
  assert.equal(result.kind, 'parsed');
  if (result.kind !== 'parsed') return;
  assert.equal(result.updates[0]!.pack.home.score, 31);
  assert.equal(result.updates[0]!.pack.away.score, 28);
});
