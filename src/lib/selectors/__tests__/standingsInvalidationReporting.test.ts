import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeStandingsInvalidation,
  invalidateStandingsForYearReporting,
  isMissingRequestContextError,
} from '../leagueStandings.ts';

/**
 * PLATFORM-693 — the post-commit canonical-standings bust reports instead of
 * swallowing.
 *
 * THE DEFECT: three call sites walked the league registry under ONE bare `catch`
 * whose comment promised recovery "on the next mutation or natural cache turnover".
 * There is none. `dataCachedCanonicalStandings` is `revalidate: false` — tag-only,
 * no time-based expiry — and an unchanged subsequent refresh commits nothing so
 * fires nothing. A swallowed failure left canonical standings stale INDEFINITELY.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE. They pin the fan-out (which leagues the
 * walk reached) and the recorded outcome. They CANNOT observe the staleness itself:
 * `unstable_cache` does not exist under `node:test` — `leagueStandings.ts` documents
 * that outside the RSC runtime it throws `Invariant: incrementalCache missing` and
 * the selector falls back to direct compute — so there is no data cache in this
 * harness to leave stale. Confirming the stale READ needs a request context (dev or
 * preview). Stated rather than worked around: no fake data cache is built here,
 * because a harness that fakes the subject proves only that the fake works.
 *
 * The three failures that used to share one `catch` get one test each, so a
 * mutation tells you WHICH is unwired.
 */

const LEAGUES = [{ slug: 'alpha' }, { slug: 'beta' }, { slug: 'gamma' }];

/** An E263 shaped exactly as Next raises it outside a request context. */
function missingContextError(): Error {
  return Object.assign(new Error('Invariant: static generation store missing'), {
    __NEXT_ERROR_CODE: 'E263',
  });
}

// === Case 1: the registry read throws — the walk never runs ===

test('a failed registry read records registry-failed, and attempted is null rather than zero', async () => {
  const touched: string[] = [];
  const outcome = await invalidateStandingsForYearReporting(
    2026,
    async () => {
      throw new Error('store unavailable');
    },
    (slug) => {
      touched.push(slug);
    }
  );

  assert.equal(outcome.result, 'registry-failed');
  // `null`, NOT 0: the population is UNKNOWN. Recording 0 would assert there were
  // no leagues to invalidate, which is a different and unverified claim.
  assert.equal(outcome.attempted, null);
  assert.equal(outcome.invalidated, 0);
  assert.equal(outcome.failed, 0);
  assert.deepEqual(touched, [], 'nothing can be invalidated when the registry is unreadable');
});

// === Case 2: a mid-loop throw — the case that was silently PARTIAL ===

test('a mid-loop failure is PARTIAL, and the walk continues past it instead of aborting', async () => {
  const touched: string[] = [];
  const outcome = await invalidateStandingsForYearReporting(
    2026,
    async () => LEAGUES,
    (slug) => {
      touched.push(slug);
      if (slug === 'beta') throw new Error('revalidateTag exploded');
    }
  );

  assert.equal(outcome.result, 'partial');
  assert.equal(outcome.attempted, 3);
  assert.equal(outcome.invalidated, 2);
  assert.equal(outcome.failed, 1);
  // THE REGRESSION. The old walk caught OUTSIDE the loop, so a throw on `beta`
  // abandoned `gamma` entirely — and recorded nothing at all. Reaching all three is
  // what makes the failure partial rather than a silent truncation.
  assert.deepEqual(touched, ['alpha', 'beta', 'gamma']);
});

test('a partial failure is neither total success nor total failure', async () => {
  const outcome = await invalidateStandingsForYearReporting(
    2026,
    async () => LEAGUES,
    (slug) => {
      if (slug !== 'alpha') throw new Error('nope');
    }
  );
  // Distinguishable in BOTH directions — the acceptance boundary's requirement.
  assert.notEqual(outcome.result, 'complete');
  assert.notEqual(outcome.result, 'registry-failed');
  assert.equal(outcome.invalidated, 1);
  assert.equal(outcome.failed, 2);
});

// === Case 3: E263 is benign and must NOT be recorded as a failure ===

test('an out-of-request-context E263 is not recorded as a failure', async () => {
  const outcome = await invalidateStandingsForYearReporting(
    2026,
    async () => LEAGUES,
    () => {
      throw missingContextError();
    }
  );

  assert.equal(outcome.result, 'complete', 'E263 is benign — never a recorded failure');
  assert.equal(outcome.failed, 0);
  // Nor is it counted as invalidated: nothing was busted, there was simply no
  // context to bust it in. Counting it as success would manufacture evidence.
  assert.equal(outcome.invalidated, 0);
  assert.equal(outcome.attempted, 3);
});

test('the E263 exemption discriminates — an ordinary error is still a failure', async () => {
  // POSITIVE CONTROL for the test above. Without this, an implementation that
  // swallowed EVERY error would pass the E263 test identically.
  const outcome = await invalidateStandingsForYearReporting(
    2026,
    async () => LEAGUES,
    () => {
      throw new Error('a perfectly ordinary failure');
    }
  );
  assert.equal(outcome.result, 'partial');
  assert.equal(outcome.failed, 3);
});

test('the shared predicate is what discriminates, not a second copy', () => {
  // The acceptance boundary forbids re-implementing the discrimination. This is the
  // predicate `invalidateStandingsSafely` itself uses.
  assert.equal(isMissingRequestContextError(missingContextError()), true);
  assert.equal(
    isMissingRequestContextError(new Error('static generation store missing')),
    true,
    'the message form Next raises without the code property'
  );
  assert.equal(isMissingRequestContextError(new Error('revalidateTag exploded')), false);
  assert.equal(isMissingRequestContextError('not an error'), false);
});

// === The clean path, and the "never walked" sentinel ===

test('a clean walk records complete with every league invalidated', async () => {
  const touched: string[] = [];
  const outcome = await invalidateStandingsForYearReporting(
    2026,
    async () => LEAGUES,
    (slug) => {
      touched.push(slug);
    }
  );
  assert.deepEqual(outcome, { result: 'complete', attempted: 3, invalidated: 3, failed: 0 });
  assert.deepEqual(touched, ['alpha', 'beta', 'gamma']);
});

test('an empty registry is complete, not a failure', async () => {
  const outcome = await invalidateStandingsForYearReporting(
    2026,
    async () => [],
    () => {}
  );
  assert.equal(outcome.result, 'complete');
  assert.equal(outcome.attempted, 0);
});

test('completeStandingsInvalidation is the truthful record for a refresh that never walked', () => {
  // Every pre-commit exit reaches the result builder without having walked the
  // registry. "We never got there" must not read as a failure.
  assert.deepEqual(completeStandingsInvalidation(), {
    result: 'complete',
    attempted: 0,
    invalidated: 0,
    failed: 0,
  });
});
