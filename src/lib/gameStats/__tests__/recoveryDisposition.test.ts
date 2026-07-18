import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimGameStatsRecoveryPartition,
  finalizeGameStatsRecoveryClaim,
  gameStatsRecoveryKey,
  isRecoveryEligible,
  readGameStatsRecoveryDisposition,
  readGameStatsRecoveryDispositions,
  retireGameStatsRecoveryDisposition,
  RECOVERY_BACKOFF_TIERS_MS,
  RECOVERY_CLAIM_LEASE_MS,
} from '../recoveryDisposition.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
} from '../../server/appStateStore.ts';

// PLATFORM-086H3 — fenced recovery claims: atomic acquisition, token-
// conditional finalization, lease expiry, and authoritative-progress-only
// backoff. Deterministic: the file-fallback store serializes the per-key
// transaction chain, and overlap is exercised through interleaved awaited
// promises — no sleeps.

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const FP_A = 'coverage-A';
const FP_B = 'coverage-B';
const SCHEDULE_FP = 'schedule-1';

function claimParams(
  overrides: Partial<Parameters<typeof claimGameStatsRecoveryPartition>[0]> = {}
) {
  return {
    year: 2026,
    week: 3,
    seasonType: 'regular' as const,
    now: NOW,
    coverageFingerprint: FP_A,
    scheduleFingerprint: SCHEDULE_FP,
    ...overrides,
  };
}

async function claimOrFail(
  overrides: Partial<Parameters<typeof claimGameStatsRecoveryPartition>[0]> = {}
) {
  const result = await claimGameStatsRecoveryPartition(claimParams(overrides));
  assert.ok(result.claimed, 'claim expected to succeed');
  return result.claimed ? result.claim : (null as never);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === Claim acquisition ===

test('a claim persists a fenced lease with atomic attempt increment', async () => {
  const claim = await claimOrFail();
  assert.equal(claim.attemptCount, 1);
  assert.ok(claim.attemptToken.length > 0);
  assert.equal(claim.leaseExpiresAt, new Date(NOW + RECOVERY_CLAIM_LEASE_MS).toISOString());

  const stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(stored!.attemptToken, claim.attemptToken);
  assert.equal(stored!.lastReason, 'claimed');
  assert.equal(stored!.coverageFingerprint, FP_A);
  assert.equal(
    isRecoveryEligible(stored, NOW + 1),
    false,
    'an actively claimed partition is never eligible'
  );
});

test('overlapping claimants cannot both claim one partition (second refuses)', async () => {
  // The per-key transaction chain serializes these; interleave without awaiting
  // the first before starting the second.
  const [a, b] = await Promise.all([
    claimGameStatsRecoveryPartition(claimParams()),
    claimGameStatsRecoveryPartition(claimParams()),
  ]);
  const claims = [a, b].filter((r) => r.claimed).length;
  const refusals = [a, b].filter((r) => !r.claimed && r.reason === 'active-claim').length;
  assert.equal(claims, 1, 'exactly one claimant wins');
  assert.equal(refusals, 1, 'the loser sees the active claim');
});

test('attempt counts cannot lose updates across sequential claim/finalize cycles', async () => {
  let at = NOW;
  for (let i = 0; i < 6; i++) {
    const claim = await claimOrFail({ now: at });
    assert.equal(claim.attemptCount, i + 1, 'atomic increments');
    await finalizeGameStatsRecoveryClaim({
      year: 2026,
      week: 3,
      seasonType: 'regular',
      attemptToken: claim.attemptToken,
      reason: 'empty-unexpected',
      now: at,
      postCoverageFingerprint: FP_A,
      priorCoverageFingerprint: FP_A,
      scheduleChanged: false,
    });
    // Wait out the escalating backoff before the next claim.
    const stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
    assert.ok(stored);
    at = Date.parse(stored!.nextEligibleAt!);
  }
  const final = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(final!.attemptCount, 6, 'every increment survived');
});

test('a backing-off partition refuses claims until the window passes', async () => {
  const claim = await claimOrFail();
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: claim.attemptToken,
    reason: 'schema-drift',
    now: NOW,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  const refused = await claimGameStatsRecoveryPartition(claimParams({ now: NOW + 1000 }));
  assert.ok(!refused.claimed && refused.reason === 'backing-off');
  const allowed = await claimGameStatsRecoveryPartition(
    claimParams({ now: NOW + RECOVERY_BACKOFF_TIERS_MS[0]! + 1 })
  );
  assert.ok(allowed.claimed, 'eligibility returns after the tier window');
});

test('claim persistence failure prevents returning a claim (no provider access without one)', async () => {
  __setAppStateWriteFailureForTests(new Error('disposition store down'), 'game-stats-recovery');
  try {
    await assert.rejects(
      () => claimGameStatsRecoveryPartition(claimParams()),
      /disposition store down|cleanup|finalization/i
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
});

// === Token-conditional finalization ===

test('only the active token may finalize; duplicates and stale tokens no-op', async () => {
  const claim = await claimOrFail();
  const first = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: claim.attemptToken,
    reason: 'empty-unexpected',
    now: NOW + 5,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(first, 'finalized');
  const duplicate = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: claim.attemptToken,
    reason: 'satisfied',
    now: NOW + 6,
    postCoverageFingerprint: FP_B,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(duplicate, 'stale-token', 'a completed token cannot finalize again');
  const stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(stored!.lastReason, 'empty-unexpected', 'the duplicate changed nothing');
});

test('lease expiry: reclamation issues a new token and the old token cannot finalize', async () => {
  const abandoned = await claimOrFail();
  // A dies. Its lease expires; B reclaims with history preserved.
  const reclaimAt = NOW + RECOVERY_CLAIM_LEASE_MS + 1;
  const reclaimed = await claimGameStatsRecoveryPartition(claimParams({ now: reclaimAt }));
  assert.ok(reclaimed.claimed);
  const b = reclaimed.claimed ? reclaimed.claim : (null as never);
  assert.notEqual(b.attemptToken, abandoned.attemptToken);
  assert.equal(b.attemptCount, 2, 'attempt history preserved across reclamation');
  const record = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(record!.lastReason, 'claim-abandoned', 'abandonment is typed');

  // B succeeds; A's LATE failure cannot overwrite B's outcome.
  const bDone = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: b.attemptToken,
    reason: 'satisfied',
    now: reclaimAt + 5,
    postCoverageFingerprint: FP_B,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(bDone, 'cleared');
  const late = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: abandoned.attemptToken,
    reason: 'provider-unavailable',
    now: reclaimAt + 10,
    postCoverageFingerprint: null,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(late, 'stale-token');
  assert.equal(
    await readGameStatsRecoveryDisposition(2026, 3, 'regular'),
    null,
    "B's satisfied outcome survives A's late failure"
  );
});

test('inverse race: a late SUCCESS cannot clear a newer failure or reduce its backoff', async () => {
  const stale = await claimOrFail();
  const reclaimAt = NOW + RECOVERY_CLAIM_LEASE_MS + 1;
  const newer = await claimGameStatsRecoveryPartition(claimParams({ now: reclaimAt }));
  assert.ok(newer.claimed);
  const newerToken = newer.claimed ? newer.claim.attemptToken : '';
  // The NEWER claimant fails (tier escalates).
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: newerToken,
    reason: 'merge-conflict',
    now: reclaimAt + 5,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  const afterFailure = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(afterFailure!.lastReason, 'merge-conflict');
  const tierAfterFailure = afterFailure!.backoffTier;

  // The STALE claimant's late "success" must change nothing.
  const late = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: stale.attemptToken,
    reason: 'satisfied',
    now: reclaimAt + 10,
    postCoverageFingerprint: FP_B,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(late, 'stale-token');
  const final = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(final!.lastReason, 'merge-conflict', 'the newer failure survives');
  assert.equal(final!.backoffTier, tierAfterFailure, 'the backoff tier is not reduced');
});

// === Authoritative-progress backoff ===

test('coverage-fingerprint progress resets the tier; unchanged coverage escalates', async () => {
  // Escalate twice with unchanged coverage.
  let at = NOW;
  for (let i = 0; i < 2; i++) {
    const claim = await claimOrFail({ now: at });
    await finalizeGameStatsRecoveryClaim({
      year: 2026,
      week: 3,
      seasonType: 'regular',
      attemptToken: claim.attemptToken,
      reason: 'empty-unexpected',
      now: at,
      postCoverageFingerprint: FP_A,
      priorCoverageFingerprint: FP_A,
      scheduleChanged: false,
    });
    const stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
    assert.equal(stored!.backoffTier, i);
    at = Date.parse(stored!.nextEligibleAt!);
  }
  // Real committed-coverage improvement resets to tier 0.
  const progressing = await claimOrFail({ now: at });
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: progressing.attemptToken,
    reason: 'partial-coverage',
    now: at,
    postCoverageFingerprint: FP_B,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  const reset = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(reset!.backoffTier, 0, 'authoritative coverage change resets escalation');
  assert.equal(reset!.lastMeaningfulChangeAt, new Date(at).toISOString());
});

test('a fence-only refresh (identical coverage fingerprint) is NOT progress and escalates', async () => {
  const first = await claimOrFail();
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: first.attemptToken,
    reason: 'partial-coverage', // provider succeeded, rows accepted (fence-only)
    now: NOW,
    postCoverageFingerprint: FP_A, // …but committed coverage did NOT change
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  const stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(stored!.backoffTier, 0 + 0, 'first unresolved attempt sits at the base tier');
  assert.equal(stored!.lastMeaningfulChangeAt, null, 'no meaningful progress recorded');

  // Repeat at eligibility: the tier escalates — the partition cannot sit at
  // the minimum tier forever on fence-only refreshes.
  const at2 = Date.parse(stored!.nextEligibleAt!);
  const second = await claimOrFail({ now: at2 });
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: second.attemptToken,
    reason: 'partial-coverage',
    now: at2,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  const escalated = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(escalated!.backoffTier, 1, 'fence-only repetition escalates backoff');
});

test('a meaningful canonical-schedule change resets the tier', async () => {
  const first = await claimOrFail();
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: first.attemptToken,
    reason: 'empty-unexpected',
    now: NOW,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  let stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  const at2 = Date.parse(stored!.nextEligibleAt!);
  // The schedule fingerprint differs at the next claim (e.g. a placeholder
  // resolved) — the claim reports scheduleChanged and finalization resets.
  const second = await claimGameStatsRecoveryPartition(
    claimParams({ now: at2, scheduleFingerprint: 'schedule-2' })
  );
  assert.ok(second.claimed);
  assert.equal(second.claimed && second.claim.scheduleChanged, true);
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: second.claimed ? second.claim.attemptToken : '',
    reason: 'empty-unexpected',
    now: at2,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: second.claimed ? second.claim.scheduleChanged : false,
  });
  stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(stored!.backoffTier, 0, 'substantive schedule change resets escalation');
});

test('satisfied clears the disposition entirely', async () => {
  const claim = await claimOrFail();
  const outcome = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: claim.attemptToken,
    reason: 'satisfied',
    now: NOW + 1,
    postCoverageFingerprint: FP_B,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(outcome, 'cleared');
  assert.equal(await readGameStatsRecoveryDisposition(2026, 3, 'regular'), null);
  assert.equal(isRecoveryEligible(null, NOW + 2), true);
});

// === Manual override semantics ===

test('override claims take over an active lease and fence out the previous claimant', async () => {
  const scheduled = await claimOrFail();
  const manual = await claimGameStatsRecoveryPartition(
    claimParams({ now: NOW + 1000, override: true })
  );
  assert.ok(manual.claimed, 'operator override claims through an active lease');
  const manualClaim = manual.claimed ? manual.claim : (null as never);

  // The superseded scheduled claimant can no longer finalize.
  const stale = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: scheduled.attemptToken,
    reason: 'provider-unavailable',
    now: NOW + 2000,
    postCoverageFingerprint: null,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(stale, 'stale-token');

  const done = await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: manualClaim.attemptToken,
    reason: 'satisfied',
    now: NOW + 3000,
    postCoverageFingerprint: FP_B,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  assert.equal(done, 'cleared');
});

test('override also bypasses backoff (documented operator semantics)', async () => {
  const claim = await claimOrFail();
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: claim.attemptToken,
    reason: 'merge-conflict',
    now: NOW,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });
  const refused = await claimGameStatsRecoveryPartition(claimParams({ now: NOW + 1000 }));
  assert.ok(!refused.claimed, 'scheduled claims respect the backoff');
  const manual = await claimGameStatsRecoveryPartition(
    claimParams({ now: NOW + 1000, override: true })
  );
  assert.ok(manual.claimed, 'operator intent overrides the backoff gate');
});

// === Retirement ===

test('retirement clears satisfied dispositions and terminalizes manual-action ones', async () => {
  const claim = await claimOrFail();
  await finalizeGameStatsRecoveryClaim({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    attemptToken: claim.attemptToken,
    reason: 'empty-unexpected',
    now: NOW,
    postCoverageFingerprint: FP_A,
    priorCoverageFingerprint: FP_A,
    scheduleChanged: false,
  });

  const terminal = await retireGameStatsRecoveryDisposition({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    now: NOW + 10,
    state: 'manual-action',
  });
  assert.equal(terminal, 'terminal');
  const stored = await readGameStatsRecoveryDisposition(2026, 3, 'regular');
  assert.equal(stored!.terminal, 'manual-action');
  assert.equal(isRecoveryEligible(stored, NOW + 365 * 24 * 60 * 60 * 1000), false);

  const cleared = await retireGameStatsRecoveryDisposition({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    now: NOW + 20,
    state: 'satisfied',
  });
  assert.equal(cleared, 'cleared');
  assert.equal(await readGameStatsRecoveryDisposition(2026, 3, 'regular'), null);
});

test('retirement never touches an ACTIVE claim', async () => {
  await claimOrFail();
  const skipped = await retireGameStatsRecoveryDisposition({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    now: NOW + 10,
    state: 'satisfied',
  });
  assert.equal(skipped, 'skipped-active-claim');
  assert.ok(await readGameStatsRecoveryDisposition(2026, 3, 'regular'));
});

// === Reads ===

test('dispositions read back per year and never leak across partitions', async () => {
  await claimOrFail();
  const post = await claimGameStatsRecoveryPartition(
    claimParams({ week: 1, seasonType: 'postseason' })
  );
  assert.ok(post.claimed);
  const byKey = await readGameStatsRecoveryDispositions(2026);
  assert.deepEqual([...byKey.keys()].sort(), ['2026:1:postseason', '2026:3:regular']);
  assert.equal(byKey.get('2026:3:regular')!.partitionKey, gameStatsRecoveryKey(2026, 3, 'regular'));
  assert.equal((await readGameStatsRecoveryDispositions(2025)).size, 0);
});
