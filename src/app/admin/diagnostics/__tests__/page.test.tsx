import assert from 'node:assert/strict';
import test from 'node:test';

import AdminSystemHealthPage from '../page';
import SystemHealthDashboard from '@/components/admin/systemHealth/SystemHealthDashboard';
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
  assert.equal(model.schedulerJobs.length, 7);
  assert.equal(model.datasets.length, 6);
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

test('the page exposes no ?year= selection seam (takes no arguments)', () => {
  // A caller cannot supply a year: the page component accepts no props/searchParams.
  assert.equal(AdminSystemHealthPage.length, 0);
});
