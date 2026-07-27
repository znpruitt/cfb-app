import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POLLING_WINDOW_AFTER_KICKOFF_MS,
  POLLING_WINDOW_BEFORE_KICKOFF_MS,
  collectWindowGames,
  selectPollingPlan,
} from '../pollingTarget';
import { makeContext, makeLiveGame } from './fixtures';

const NOW = new Date('2025-10-11T20:00:00.000Z');
const NOW_MS = NOW.getTime();

function kickoffAt(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString();
}

// ---- Window boundaries (prompt case 5) ------------------------------------

test('a game exactly 15 minutes before kickoff is in the window (inclusive)', () => {
  const ctx = makeContext([
    makeLiveGame({ providerGameId: 1, kickoff: kickoffAt(POLLING_WINDOW_BEFORE_KICKOFF_MS) }),
  ]);
  assert.equal(collectWindowGames(ctx, NOW).length, 1);
});

test('a game one ms earlier than 15 minutes before kickoff is excluded', () => {
  const ctx = makeContext([
    makeLiveGame({ providerGameId: 1, kickoff: kickoffAt(POLLING_WINDOW_BEFORE_KICKOFF_MS + 1) }),
  ]);
  assert.equal(collectWindowGames(ctx, NOW).length, 0);
});

test('a game exactly 24 hours after kickoff is in the window (inclusive)', () => {
  const ctx = makeContext([
    makeLiveGame({ providerGameId: 1, kickoff: kickoffAt(-POLLING_WINDOW_AFTER_KICKOFF_MS) }),
  ]);
  assert.equal(collectWindowGames(ctx, NOW).length, 1);
});

test('a game past 24 hours after kickoff is excluded', () => {
  const ctx = makeContext([
    makeLiveGame({ providerGameId: 1, kickoff: kickoffAt(-POLLING_WINDOW_AFTER_KICKOFF_MS - 1) }),
  ]);
  assert.equal(collectWindowGames(ctx, NOW).length, 0);
});

test('a missing or unparseable kickoff is never in the window (fail-safe)', () => {
  const ctx = makeContext([
    makeLiveGame({ providerGameId: 1, kickoff: null }),
    makeLiveGame({ providerGameId: 2, kickoff: 'not-a-date' }),
  ]);
  assert.equal(collectWindowGames(ctx, NOW).length, 0);
});

// ---- Participant / disruption eligibility (prompt case 6) -----------------

test('a game with an unresolved participant is excluded', () => {
  const ctx = makeContext([
    makeLiveGame({ providerGameId: 1, kickoff: kickoffAt(-3600_000), home: null }),
    makeLiveGame({ providerGameId: 2, kickoff: kickoffAt(-3600_000), away: null }),
  ]);
  assert.equal(collectWindowGames(ctx, NOW).length, 0);
});

test('canceled and postponed games are excluded; delayed and suspended remain eligible', () => {
  const ctx = makeContext([
    makeLiveGame({ providerGameId: 1, kickoff: kickoffAt(-3600_000), rawStatus: 'canceled' }),
    makeLiveGame({
      providerGameId: 2,
      kickoff: kickoffAt(-3600_000),
      rawStatus: 'STATUS_POSTPONED',
    }),
    makeLiveGame({ providerGameId: 3, kickoff: kickoffAt(-3600_000), rawStatus: 'delayed' }),
    makeLiveGame({ providerGameId: 4, kickoff: kickoffAt(-3600_000), rawStatus: 'suspended' }),
  ]);
  const ids = collectWindowGames(ctx, NOW)
    .map((w) => w.game.canonical.providerGameId)
    .sort();
  assert.deepEqual(ids, [3, 4]);
});

// ---- Mode selection --------------------------------------------------------

test('no in-window game → mode none', () => {
  const ctx = makeContext([makeLiveGame({ providerGameId: 1, kickoff: kickoffAt(48 * 3600_000) })]);
  assert.equal(selectPollingPlan(ctx, NOW).mode, 'none');
});

test('an open in-window game selects scoreboard mode with its partitions', () => {
  const ctx = makeContext([
    makeLiveGame({
      providerGameId: 1,
      kickoff: kickoffAt(-3600_000),
      providerWeek: 3,
      seasonType: 'regular',
    }),
    makeLiveGame(
      {
        providerGameId: 2,
        kickoff: kickoffAt(-3600_000),
        providerWeek: 1,
        seasonType: 'postseason',
      },
      { cachedStatus: 'inprogress' }
    ),
  ]);
  const plan = selectPollingPlan(ctx, NOW);
  assert.equal(plan.mode, 'scoreboard');
  if (plan.mode !== 'scoreboard') return;
  assert.equal(plan.targets.length, 2);
  // Deterministic partition order: regular before postseason.
  assert.deepEqual(
    plan.partitions.map((p) => `${p.week}-${p.seasonType}`),
    ['3-regular', '1-postseason']
  );
});

test('a confirmed final is resolved (not a target); slate with only finals → mode none', () => {
  const ctx = makeContext([
    makeLiveGame(
      { providerGameId: 1, kickoff: kickoffAt(-3600_000) },
      { cachedStatus: 'final', pendingConfirmation: false }
    ),
  ]);
  assert.equal(selectPollingPlan(ctx, NOW).mode, 'none');
});

test('a pending-confirmation final with no open game selects final-reconciliation (one partition)', () => {
  const ctx = makeContext([
    makeLiveGame(
      {
        providerGameId: 1,
        kickoff: kickoffAt(-4 * 3600_000),
        providerWeek: 5,
        seasonType: 'regular',
      },
      { cachedStatus: 'final', pendingConfirmation: true }
    ),
    makeLiveGame(
      {
        providerGameId: 2,
        kickoff: kickoffAt(-3 * 3600_000),
        providerWeek: 6,
        seasonType: 'regular',
      },
      { cachedStatus: 'final', pendingConfirmation: true }
    ),
  ]);
  const plan = selectPollingPlan(ctx, NOW);
  assert.equal(plan.mode, 'final-reconciliation');
  if (plan.mode !== 'final-reconciliation') return;
  // Earliest pending kickoff wins the single partition (game 1, week 5).
  assert.equal(plan.partition.week, 5);
  assert.equal(plan.pendingGames.length, 1);
  assert.equal(plan.pendingGames[0]!.canonical.providerGameId, 1);
});

test('any open game outranks pending confirmations → scoreboard, not reconciliation', () => {
  const ctx = makeContext([
    makeLiveGame(
      { providerGameId: 1, kickoff: kickoffAt(-3600_000) },
      { cachedStatus: 'inprogress' }
    ),
    makeLiveGame(
      { providerGameId: 2, kickoff: kickoffAt(-4 * 3600_000) },
      { cachedStatus: 'final', pendingConfirmation: true }
    ),
  ]);
  assert.equal(selectPollingPlan(ctx, NOW).mode, 'scoreboard');
});
