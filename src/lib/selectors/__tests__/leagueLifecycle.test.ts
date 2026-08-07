import assert from 'node:assert/strict';
import test from 'node:test';

import { describeLeagueLifecycle } from '../leagueLifecycle.ts';
import type { LeagueStatus } from '../../league.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3B1 — lifecycle STATE and OWNERSHIP are two separate facts.
//
// The copy is pinned here rather than through rendering because this module is
// where the claim is decided; a component test would pin the same strings one
// layer further from the decision.
//
// The claims are derived from the real jobs:
//   offseason  — `beginPreseason`, an operator-triggered Server Action
//   preseason  — the daily season-transition cron (`status?.state === 'preseason'`)
//   season     — the daily season-rollover cron (`groupRolloverTargets`)
//   no status  — NEITHER, because both crons key on the STORED status
//   demo       — neither; excluded from both (F2H1T2 + the rollover selector)
// ---------------------------------------------------------------------------

const PRODUCTION = { fallbackYear: 2025, isDemo: false };

test('each production state names its own owner, and only the automatic ones claim automation', () => {
  const offseason = describeLeagueLifecycle({
    ...PRODUCTION,
    storedStatus: { state: 'offseason' },
  });
  assert.equal(offseason.stateLabel, 'Offseason');
  assert.match(offseason.nextStep, /Waiting on you/);
  assert.equal(offseason.ownership, 'operator', 'no job advances an offseason league');

  const preseason = describeLeagueLifecycle({
    ...PRODUCTION,
    storedStatus: { state: 'preseason', year: 2026 },
  });
  assert.equal(preseason.stateLabel, 'Preseason 2026');
  assert.match(preseason.nextStep, /Advances to the 2026 season automatically/);
  assert.equal(preseason.ownership, 'automatic');

  const season = describeLeagueLifecycle({
    ...PRODUCTION,
    storedStatus: { state: 'season', year: 2026 },
  });
  assert.equal(season.stateLabel, 'Season 2026');
  assert.match(season.nextStep, /Rolls over to offseason automatically/);
  assert.equal(season.ownership, 'automatic');
});

// The three sentences must be DISTINGUISHABLE, not merely present. A single
// generic string would satisfy every assertion above.
test('the three production next-steps are distinct sentences', () => {
  const steps = (
    [
      { state: 'offseason' },
      { state: 'preseason', year: 2026 },
      { state: 'season', year: 2026 },
    ] as LeagueStatus[]
  ).map((storedStatus) => describeLeagueLifecycle({ ...PRODUCTION, storedStatus }).nextStep);
  assert.equal(
    new Set(steps).size,
    3,
    `expected three distinct sentences, got ${steps.join(' | ')}`
  );
});

// The preseason sentence names the year the league will BECOME, taken from the
// stored status — not the top-level projection, which can be desynchronized on a
// legacy record.
test('the preseason sentence names the stored status year, not the projection', () => {
  const summary = describeLeagueLifecycle({
    storedStatus: { state: 'preseason', year: 2027 },
    fallbackYear: 2019,
    isDemo: false,
  });
  assert.match(summary.nextStep, /2027/);
  assert.ok(!summary.nextStep.includes('2019'), 'the stale projection never reaches the copy');
});

// REGRESSION TEST — the defect this component would otherwise INTRODUCE.
//
// The page infers `{ state: 'season' }` for a legacy record with no stored
// status, but `groupRolloverTargets` skips it (`if (!status ...) continue`) and
// the season-transition cron filters `status?.state === 'preseason'`. So it
// reaches NO lifecycle job. Labelling the inferred season is correct; claiming
// its automation is not.
test('a missing status keeps the inferred season LABEL but claims no automatic owner', () => {
  const summary = describeLeagueLifecycle({
    storedStatus: null,
    fallbackYear: 2025,
    isDemo: false,
  });
  assert.equal(summary.stateLabel, 'Season 2025', 'the read-only inference still labels it');
  assert.equal(
    summary.ownership,
    'unowned',
    'NOT `operator` — no supported operation writes a lifecycle status onto a production record, ' +
      'so calling it manual would claim a path that does not exist'
  );
  assert.match(summary.nextStep, /No lifecycle status is recorded/);

  // POSITIVE CONTROL — a league that DOES store `season(2025)` produces the same
  // label with the OPPOSITE ownership, so the assertion above is discriminating
  // rather than a property of the label.
  const stored = describeLeagueLifecycle({
    storedStatus: { state: 'season', year: 2025 },
    fallbackYear: 2025,
    isDemo: false,
  });
  assert.equal(stored.stateLabel, summary.stateLabel, 'identical label');
  assert.equal(stored.ownership, 'automatic', 'opposite ownership');
  assert.notEqual(stored.nextStep, summary.nextStep);
});

// REGRESSION TEST — the LIVE falsehood this slice removes. Before F2H3B1 the
// demo league rendered "Season will go live automatically before the first
// game." whenever it was preseason with setup complete, which has been false
// since F2H1T2 removed it from the season-transition cron.
test('the demo league claims no automation in ANY state', () => {
  const statuses: Array<LeagueStatus | null> = [
    { state: 'offseason' },
    { state: 'preseason', year: 2026 },
    { state: 'preseason', year: 2026, setupComplete: true },
    { state: 'season', year: 2025 },
    null,
  ];
  for (const storedStatus of statuses) {
    const summary = describeLeagueLifecycle({ storedStatus, fallbackYear: 2025, isDemo: true });
    assert.equal(
      summary.ownership,
      'operator',
      `demo ${JSON.stringify(storedStatus)} is operator-owned, never automatic`
    );
    assert.match(summary.nextStep, /Manually controlled/);
    assert.ok(
      !/automatically/i.test(summary.nextStep),
      `demo copy must not claim automation: ${summary.nextStep}`
    );
  }
});

// The demo answer replaces the per-state claim; it does not suppress the STATE.
test('the demo league still reports its own state and year', () => {
  const summary = describeLeagueLifecycle({
    storedStatus: { state: 'preseason', year: 2026 },
    fallbackYear: 2025,
    isDemo: true,
  });
  assert.equal(summary.stateLabel, 'Preseason 2026');
});

// CONTRACT PIN — `setupComplete` does not change ownership. The cron targets
// every preseason league, so a league still in setup has the same owner.
test('setupComplete does not change who owns the next transition', () => {
  const inSetup = describeLeagueLifecycle({
    ...PRODUCTION,
    storedStatus: { state: 'preseason', year: 2026 },
  });
  const complete = describeLeagueLifecycle({
    ...PRODUCTION,
    storedStatus: { state: 'preseason', year: 2026, setupComplete: true },
  });
  assert.deepEqual(inSetup, complete);
});

// The three ownership values are three DIFFERENT operator conditions, and the
// distinction the review caught is the one between them: "not automatic" is not
// the same as "nobody can move it". A boolean collapsed the last two and badged
// an unrecoverable record as operator-owned.
test('ownership distinguishes automatic, operator-owned, and unowned', () => {
  const ownership = (input: Parameters<typeof describeLeagueLifecycle>[0]) =>
    describeLeagueLifecycle(input).ownership;

  assert.equal(
    ownership({ ...PRODUCTION, storedStatus: { state: 'season', year: 2026 } }),
    'automatic'
  );
  assert.equal(ownership({ ...PRODUCTION, storedStatus: { state: 'offseason' } }), 'operator');
  assert.equal(ownership({ storedStatus: null, fallbackYear: 2025, isDemo: true }), 'operator');
  assert.equal(ownership({ ...PRODUCTION, storedStatus: null }), 'unowned');
});
