import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads
// (transitively imported through the page's server-action module).
import '../../../api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';

import AdminLeaguePage from '../page';
import PreseasonPage from '../preseason/page';
import type { League } from '../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — rendering the commissioner page must perform NO durable
// mutation. A legacy missing-status league is presented through the read-only
// `{ state: 'season', year: league.year }` inference; the fire-and-forget
// render-time `updateLeagueStatus` seeding was removed.
// ---------------------------------------------------------------------------

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

/**
 * Find one component's props by its function name.
 *
 * PLATFORM-086F2H3B1 — the lifecycle summary is a separate server component, so
 * `AdminLeaguePage()` returns it as an unrendered element. Its COPY is pinned
 * where the copy is decided (`describeLeagueLifecycle`); what the PAGE owes is
 * the inputs, and the load-bearing one is `storedStatus`: ownership must be
 * decided from the persisted status, never from the display inference, because
 * both lifecycle crons key on the stored value and skip a missing one.
 */
function findProps(node: unknown, name: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findProps(child, name);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    if (typeof el.type === 'function' && (el.type as { name?: string }).name === name) {
      return el.props ?? {};
    }
    if (el.props) return findProps(el.props.children, name);
  }
  return null;
}

/** Collect every string in a JSX element tree (children props, recursively). */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) {
      collectStrings(props.children, out);
      // Breadcrumb labels and similar prop-carried strings.
      for (const [key, value] of Object.entries(props)) {
        if (key !== 'children' && typeof value === 'string') out.push(value);
      }
    }
  }
  return out;
}

test('rendering a missing-status league performs no durable write and keeps the inferred label', async () => {
  const legacy: League = {
    slug: 'legacy',
    displayName: 'Legacy League',
    year: 2025,
    createdAt: '2022-01-01T00:00:00.000Z',
    // Deliberately NO status — the legacy record shape.
  };
  await setAppState('leagues', 'registry', [legacy]);
  const before = await getAppState<League[]>('leagues', 'registry');
  const beforeBytes = JSON.stringify(before?.value);

  const element = await AdminLeaguePage({ params: Promise.resolve({ slug: 'legacy' }) });
  assert.ok(element, 'page rendered');

  // REGRESSION TEST (PLATFORM-086F2H3B1) — the page hands the summary the
  // STORED status, which for a legacy record is absent. Passing the inferred
  // `{ state: 'season' }` instead would make the page claim automatic rollover
  // for a record `groupRolloverTargets` skips outright (`!status` → `continue`).
  const summary = findProps(element, 'LeagueLifecycleSummary');
  assert.ok(summary, 'the lifecycle summary is mounted');
  assert.equal(summary.storedStatus, null, 'the MISSING status is passed through as null');
  assert.equal(summary.fallbackYear, 2025, 'the year that labels the inferred season');
  assert.equal(summary.isDemo, false);

  // Give any (regressive) fire-and-forget write time to land before comparing.
  await new Promise((resolve) => setTimeout(resolve, 25));

  const after = await getAppState<League[]>('leagues', 'registry');
  assert.equal(
    JSON.stringify(after?.value),
    beforeBytes,
    'durable registry byte-equivalent after render'
  );
  assert.equal(after?.value?.[0]?.status, undefined, 'no status seeded by rendering');
});

test('rendering a league WITH status also performs no durable write', async () => {
  const league: League = {
    slug: 'alpha',
    displayName: 'Alpha League',
    year: 2025,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'offseason' },
  };
  await setAppState('leagues', 'registry', [league]);
  const before = await getAppState<League[]>('leagues', 'registry');
  const beforeBytes = JSON.stringify(before?.value);

  const element = await AdminLeaguePage({ params: Promise.resolve({ slug: 'alpha' }) });
  assert.ok(element);
  // POSITIVE CONTROL for the assertion above: on the same helper, a league that
  // DOES have a stored status passes it through, so `storedStatus: null` in the
  // legacy test is a real observation rather than a prop the helper cannot see.
  const summary = findProps(element, 'LeagueLifecycleSummary');
  assert.deepEqual(summary?.storedStatus, { state: 'offseason' });
  const strings = collectStrings(element);
  assert.ok(strings.some((s) => s.includes('Alpha League')));

  await new Promise((resolve) => setTimeout(resolve, 25));
  const after = await getAppState<League[]>('leagues', 'registry');
  assert.equal(JSON.stringify(after?.value), beforeBytes);
});

// REGRESSION TEST (PLATFORM-086F2H3B1) — the SECOND surface carrying the same
// automation claim. The league page was the obvious one; the preseason setup
// page rendered "Season will go live automatically before the first game." too,
// and it has been false for the demo league since F2H1T2 removed it from the
// season-transition cron. Closing the demo-copy deferral means closing it
// everywhere the claim is made, not only where the slice started.
test('the preseason setup page does not promise the demo league an automatic season', async () => {
  await setAppState('leagues', 'registry', [
    {
      slug: 'test',
      displayName: 'Demo League',
      year: 2026,
      createdAt: '2022-01-01T00:00:00.000Z',
      status: { state: 'preseason', year: 2026, setupComplete: true },
    } as League,
  ]);

  const element = await PreseasonPage({ params: Promise.resolve({ slug: 'test' }) });
  const strings = collectStrings(element);
  assert.ok(
    !strings.some((s) => s.includes('go live automatically')),
    `the demo must not be promised automation (got: ${strings.filter((s) => s.trim()).join(' | ')})`
  );
  assert.ok(
    strings.some((s) => s.includes('manually controlled')),
    'and it is told what actually moves it'
  );
});

// POSITIVE CONTROL — a PRODUCTION league on the same page and the same
// `setupComplete` fixture still gets the automation sentence, so the assertion
// above discriminates on the slug rather than on the sentence having been
// deleted outright.
test('a production league still sees the automatic-season promise on that page', async () => {
  await setAppState('leagues', 'registry', [
    {
      slug: 'alpha',
      displayName: 'Alpha League',
      year: 2026,
      createdAt: '2022-01-01T00:00:00.000Z',
      status: { state: 'preseason', year: 2026, setupComplete: true },
    } as League,
  ]);

  const element = await PreseasonPage({ params: Promise.resolve({ slug: 'alpha' }) });
  const strings = collectStrings(element);
  assert.ok(strings.some((s) => s.includes('go live automatically')));
});
