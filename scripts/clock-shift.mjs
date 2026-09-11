/**
 * Clock-shift preload for the test suite — the time-bomb detector (Item 137/#696).
 *
 * A fixture pinned to a fixed calendar date is a test that passes until the date
 * arrives and then fails at EVERY commit, forever. That is not hypothetical: it
 * is what put two `writer-convergence.test.ts` tests, and later one in
 * `odds-quota-guard.test.ts`, onto `main` as a standing red baseline. A bisect
 * cannot find them — checking out an older commit does not roll back the clock —
 * so the only way to see one BEFORE it detonates is to move the clock.
 *
 * Usage:
 *
 *   npm run test:clock-shift -- 90        # run the whole suite as if 90 days from now
 *   npm run test:clock-shift -- 730       # two years out
 *
 * READ THE COVERAGE CAVEAT BEFORE TRUSTING A RESULT.
 *
 * At EVERY non-zero shift, exactly one test fails for reasons that are NOT a
 * time bomb:
 *
 *   src/test/__tests__/testStoreLifecycle.test.ts
 *     'the sweep removes orphaned run directories and nothing else'
 *
 * It creates directories whose mtimes come from the REAL filesystem clock and
 * sweeps them against a `now` this shim has moved, so a directory it expects to
 * survive looks stale. It pins no calendar date and will not fail on the real
 * date. Treat that one failure as the expected floor; **any other failure is a
 * real expiry** and names the date it starts.
 *
 * A shift of 0 must be completely green — that is the positive control proving
 * the shim itself changes nothing. If `-- 0` is not green, fix that before
 * reading any other number.
 *
 * `Date.parse` and `Date.UTC` are deliberately left on the real implementation:
 * they convert a supplied string or field list and must not be displaced, or
 * every fixture literal in the suite would move with the clock and nothing
 * would ever expire.
 */
const days = Number(process.env.CLOCK_SHIFT_DAYS ?? '0');
if (!Number.isFinite(days)) {
  throw new Error(`CLOCK_SHIFT_DAYS must be a number; received ${process.env.CLOCK_SHIFT_DAYS}`);
}
const offsetMs = days * 24 * 60 * 60 * 1000;

const RealDate = Date;
const ShiftedDate = class extends RealDate {
  constructor(...args) {
    // Only the no-argument form means "now"; every other form converts an
    // explicit value and must be left exactly as the caller wrote it.
    if (args.length === 0) super(RealDate.now() + offsetMs);
    else super(...args);
  }
  static now() {
    return RealDate.now() + offsetMs;
  }
};
ShiftedDate.parse = RealDate.parse;
ShiftedDate.UTC = RealDate.UTC;

globalThis.Date = ShiftedDate;
