import assert from 'node:assert/strict';
import test from 'node:test';

import { decideRefresh } from '../refreshDecision';

test('skip when manual cooldown is active', () => {
  assert.deepEqual(
    decideRefresh({
      hasGames: true,
      manual: true,
      manualCooldownActive: true,
      includeOddsRequested: true,
      oddsAutoDisabledByQuota: false,
    }),
    { kind: 'skip', reason: 'manual-cooldown' }
  );
});

test('skip when no games are loaded', () => {
  assert.deepEqual(
    decideRefresh({
      hasGames: false,
      manual: false,
      manualCooldownActive: false,
      includeOddsRequested: true,
      oddsAutoDisabledByQuota: false,
    }),
    { kind: 'skip', reason: 'no-games' }
  );
});

test('scores only when odds disabled by plan or quota', () => {
  assert.equal(
    decideRefresh({
      hasGames: true,
      manual: false,
      manualCooldownActive: false,
      includeOddsRequested: false,
      oddsAutoDisabledByQuota: false,
    }).kind,
    'scores_only'
  );

  assert.deepEqual(
    decideRefresh({
      hasGames: true,
      manual: false,
      manualCooldownActive: false,
      includeOddsRequested: true,
      oddsAutoDisabledByQuota: true,
    }),
    { kind: 'scores_only', reason: 'odds-disabled-by-quota' }
  );
});

test('scores and odds when eligible', () => {
  assert.deepEqual(
    decideRefresh({
      hasGames: true,
      manual: false,
      manualCooldownActive: false,
      includeOddsRequested: true,
      oddsAutoDisabledByQuota: false,
    }),
    { kind: 'scores_and_odds', reason: 'scores-and-odds' }
  );
});
