import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimRankingsPublicationWindow,
  completeRankingsPublicationWindow,
  isPublicationClaimActive,
  normalizeRankingsPublicationWindowControl,
  RANKINGS_PUBLICATION_CLAIM_DURATION_MS,
  RANKINGS_PUBLICATION_WINDOW_SCOPE,
  releaseRankingsPublicationWindow,
  type RankingsPublicationWindowControl,
} from '../publicationWindowControl.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';

const KEY = '2031:weekly-ap-coaches:2031-10-05';
const T0 = Date.parse('2031-10-05T22:00:10.000Z');

async function readControl(): Promise<RankingsPublicationWindowControl> {
  return normalizeRankingsPublicationWindowControl(
    KEY,
    (await getAppState<unknown>(RANKINGS_PUBLICATION_WINDOW_SCOPE, KEY))?.value
  );
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  __setAppStateKeyLockFailureForTests(null);
});

// 7 — acquisition + active contention.
test('a claimed window refuses a second claimant while the claim is active', async () => {
  const first = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(first.kind, 'claimed');

  const second = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 + 1000 });
  assert.deepEqual(second, { kind: 'in-progress' });

  const control = await readControl();
  assert.equal(control.claim?.token, first.kind === 'claimed' && first.token);
  assert.equal(control.completedAt, null);
});

// 7 — expiry reclaim.
test('an expired unfinished claim is reclaimable', async () => {
  const first = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(first.kind, 'claimed');

  const tooSoon = await claimRankingsPublicationWindow({
    publicationKey: KEY,
    now: T0 + RANKINGS_PUBLICATION_CLAIM_DURATION_MS - 1000,
  });
  assert.deepEqual(tooSoon, { kind: 'in-progress' });

  const reclaimed = await claimRankingsPublicationWindow({
    publicationKey: KEY,
    now: T0 + RANKINGS_PUBLICATION_CLAIM_DURATION_MS + 1000,
  });
  assert.equal(reclaimed.kind, 'claimed');
});

// 7 — malformed reclaim (wrong version / mismatched key / broken claim).
test('malformed controls degrade to a reclaimable unfinished state', async () => {
  for (const malformed of [
    'not-an-object',
    { version: 2, publicationKey: KEY, completedAt: null, claim: null },
    { version: 1, publicationKey: 'some-other-key', completedAt: '2031-01-01T00:00:00.000Z' },
    { version: 1, publicationKey: KEY, completedAt: null, claim: { token: 42 } },
  ]) {
    await setAppState(RANKINGS_PUBLICATION_WINDOW_SCOPE, KEY, malformed);
    const claim = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
    assert.equal(claim.kind, 'claimed', JSON.stringify(malformed));
  }
});

// A malformed record can never PROVE completion — completion needs an intact record.
test('a completion marker inside a corrupt record does not suppress the window', async () => {
  await setAppState(RANKINGS_PUBLICATION_WINDOW_SCOPE, KEY, {
    version: 99,
    publicationKey: KEY,
    completedAt: '2031-10-05T22:01:00.000Z',
  });
  const claim = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(claim.kind, 'claimed');
});

// 7 — completed suppression is immutable.
test('a completed window refuses every later claim', async () => {
  const claim = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(claim.kind, 'claimed');
  const token = claim.kind === 'claimed' ? claim.token : '';

  const completion = await completeRankingsPublicationWindow({
    publicationKey: KEY,
    token,
    completedAt: new Date(T0 + 5000).toISOString(),
  });
  assert.deepEqual(completion, { confirmed: true });

  // Immediately, after expiry, and with a fresh normalize — all refused.
  for (const now of [T0 + 6000, T0 + RANKINGS_PUBLICATION_CLAIM_DURATION_MS * 10]) {
    assert.deepEqual(await claimRankingsPublicationWindow({ publicationKey: KEY, now }), {
      kind: 'complete',
    });
  }
  const control = await readControl();
  assert.equal(control.completedAt, new Date(T0 + 5000).toISOString());
  assert.equal(control.claim, null);
});

// 7 — token-safe finalize: an older reclaimed claimant cannot complete.
test('a stale token can neither complete nor clear a newer claim', async () => {
  const stale = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(stale.kind, 'claimed');
  const staleToken = stale.kind === 'claimed' ? stale.token : '';

  const fresh = await claimRankingsPublicationWindow({
    publicationKey: KEY,
    now: T0 + RANKINGS_PUBLICATION_CLAIM_DURATION_MS + 1000,
  });
  assert.equal(fresh.kind, 'claimed');
  const freshToken = fresh.kind === 'claimed' ? fresh.token : '';

  // Stale finalize → unconfirmed, window NOT completed.
  const completion = await completeRankingsPublicationWindow({
    publicationKey: KEY,
    token: staleToken,
    completedAt: new Date().toISOString(),
  });
  assert.deepEqual(completion, { confirmed: false });

  // Stale release → newer claim untouched.
  await releaseRankingsPublicationWindow({ publicationKey: KEY, token: staleToken });
  const control = await readControl();
  assert.equal(control.completedAt, null, 'stale finalize never completed the window');
  assert.equal(control.claim?.token, freshToken, 'newer claim survives the stale release');
});

// 7 — token-checked release clears only the holder's own unfinished claim.
test('release clears the holder’s claim without completing the window', async () => {
  const claim = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(claim.kind, 'claimed');
  const token = claim.kind === 'claimed' ? claim.token : '';

  await releaseRankingsPublicationWindow({ publicationKey: KEY, token });
  const control = await readControl();
  assert.equal(control.claim, null);
  assert.equal(control.completedAt, null);

  // The window is immediately claimable again (no expiry wait).
  const reclaimed = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 + 1000 });
  assert.equal(reclaimed.kind, 'claimed');
});

// 7 — store failure while acquiring fails closed.
test('a control-store failure fails closed with no confirmed token', async () => {
  __setAppStateKeyLockFailureForTests(
    new Error('control store down'),
    RANKINGS_PUBLICATION_WINDOW_SCOPE
  );
  try {
    assert.deepEqual(await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 }), {
      kind: 'store-unavailable',
    });
  } finally {
    __setAppStateKeyLockFailureForTests(null);
  }
});

// Completion during a store failure is UNCONFIRMED, never thrown.
test('a completion-store failure reports unconfirmed without throwing', async () => {
  const claim = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(claim.kind, 'claimed');
  const token = claim.kind === 'claimed' ? claim.token : '';

  __setAppStateKeyLockFailureForTests(
    new Error('control store down'),
    RANKINGS_PUBLICATION_WINDOW_SCOPE
  );
  try {
    const completion = await completeRankingsPublicationWindow({
      publicationKey: KEY,
      token,
      completedAt: new Date().toISOString(),
    });
    assert.deepEqual(completion, { confirmed: false });
  } finally {
    __setAppStateKeyLockFailureForTests(null);
  }

  // The claim survives (unconfirmed completion left it to expire/reconcile).
  const control = await readControl();
  assert.equal(control.completedAt, null);
  assert.equal(control.claim?.token, token);
});

// An already-complete window makes a repeated confirmed finalize idempotent.
test('finalizing an already-completed window is idempotent success', async () => {
  const claim = await claimRankingsPublicationWindow({ publicationKey: KEY, now: T0 });
  assert.equal(claim.kind, 'claimed');
  const token = claim.kind === 'claimed' ? claim.token : '';
  await completeRankingsPublicationWindow({
    publicationKey: KEY,
    token,
    completedAt: new Date().toISOString(),
  });

  const again = await completeRankingsPublicationWindow({
    publicationKey: KEY,
    token,
    completedAt: new Date().toISOString(),
  });
  assert.deepEqual(again, { confirmed: true });
});

// isPublicationClaimActive: unparseable expiry is reclaimable, never a wedge.
test('an unparseable claim expiry is treated as expired', () => {
  const control: RankingsPublicationWindowControl = {
    version: 1,
    publicationKey: KEY,
    completedAt: null,
    claim: { token: 't', acquiredAt: 'x', expiresAt: 'not-a-date' },
  };
  assert.equal(isPublicationClaimActive(control, T0), false);
});
