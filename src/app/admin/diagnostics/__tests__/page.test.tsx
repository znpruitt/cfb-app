import assert from 'node:assert/strict';
import test from 'node:test';

import AdminSystemHealthPage from '../page';
import SystemHealthDashboard from '@/components/admin/systemHealth/SystemHealthDashboard';
import { TEST_LEAGUE_SLUG } from '@/lib/league';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';

// PLATFORM-086F2G — System Health page. A current-status surface: it builds ONE
// F2F model for the SERVER-RESOLVED operational season and renders the dashboard.
// There is no `?year=` selection seam (the page function takes no searchParams).

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  // Guarantee no provider network in this test (quota loader fails closed).
  delete process.env.CFBD_API_KEY;
  delete process.env.ODDS_API_KEY;
});

test('builds exactly one dashboard model for the resolved operational season', async () => {
  await setAppState('leagues', 'registry', [
    {
      slug: 'a',
      name: 'A',
      year: 2019,
      createdAt: '2019-01-01T00:00:00.000Z',
      status: { state: 'season', year: 2026 },
    },
  ]);

  const element = await AdminSystemHealthPage();

  // One dashboard, one model.
  assert.equal(element.type, SystemHealthDashboard);
  const model = (
    element.props as {
      model: { year: number; panels: unknown[]; schedulerJobs: unknown[]; datasets: unknown[] };
    }
  ).model;
  // Operational season from active-league status.year (never top-level league.year 2019).
  assert.equal(model.year, 2026);
  // The two axes stay separate and complete.
  assert.equal(model.schedulerJobs.length, 8);
  assert.equal(model.datasets.length, 7);
  assert.equal(model.panels.length, 6);
});

test('falls back deterministically when no league is active', async () => {
  await setAppState('leagues', 'registry', [
    {
      slug: 'a',
      name: 'A',
      year: 2024,
      createdAt: '2024-01-01T00:00:00.000Z',
      status: { state: 'offseason' },
    },
  ]);
  const element = await AdminSystemHealthPage();
  const model = (element.props as { model: { year: number } }).model;
  assert.equal(model.year, 2024); // highest stored league.year
});

// PLATFORM-086F2H1T5 — REGRESSION. The production caller must resolve the year
// from PRODUCTION leagues only. Proves the exclusion is reachable through the
// real page, not just the pure resolver: the demo is active at a HIGHER year
// than the production league, so before this slice the model took the demo's.
test('T5 regression: the page builds its one model for the production-resolved year', async () => {
  // The page reads the real clock, so the fixture years are derived from it. A
  // hard-coded pair goes VACUOUS whenever the demo year sits at or above the
  // `currentUTCYear + 1` clamp ceiling — the clamp then folds the unfiltered
  // answer back onto the production one — and fails outright on a machine whose
  // clock is behind. PRODUCTION_YEAR is always strictly below the ceiling and
  // DEMO_YEAR always strictly above it, at every host year.
  const HOST_YEAR = new Date().getUTCFullYear();
  const PRODUCTION_YEAR = HOST_YEAR;
  const DEMO_YEAR = HOST_YEAR + 1;

  await setAppState('leagues', 'registry', [
    {
      slug: 'a',
      name: 'A',
      year: 2019,
      createdAt: '2019-01-01T00:00:00.000Z',
      status: { state: 'season', year: PRODUCTION_YEAR },
    },
    {
      slug: TEST_LEAGUE_SLUG,
      name: 'Demo',
      year: DEMO_YEAR,
      createdAt: '2019-01-01T00:00:00.000Z',
      status: { state: 'season', year: DEMO_YEAR },
    },
  ]);

  const element = await AdminSystemHealthPage();
  assert.equal(element.type, SystemHealthDashboard);
  const model = (
    element.props as {
      model: { year: number; panels: unknown[]; schedulerJobs: unknown[]; datasets: unknown[] };
    }
  ).model;
  assert.notEqual(PRODUCTION_YEAR, DEMO_YEAR, 'the fixture years must be distinguishable');
  assert.equal(
    model.year,
    PRODUCTION_YEAR,
    'the demo league does not select the operational season'
  );
  // The rest of the model is unchanged by the exclusion.
  assert.equal(model.schedulerJobs.length, 8);
  assert.equal(model.datasets.length, 7);
  assert.equal(model.panels.length, 6);
});

test('the page exposes no ?year= selection seam (takes no arguments)', () => {
  // A caller cannot supply a year: the page component accepts no props/searchParams.
  assert.equal(AdminSystemHealthPage.length, 0);
});
