import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads
// (transitively imported through the page's server-action module).
import '../../../api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';

import AdminLeaguePage from '../page';
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

  // The read-only compatibility inference still presents `{year} Season`.
  const strings = collectStrings(element);
  assert.ok(
    strings.some((s) => s.includes('2025 Season')),
    `inferred season label preserved (got: ${strings.filter((s) => s.trim()).join(' | ')})`
  );

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
  const strings = collectStrings(element);
  assert.ok(strings.some((s) => s.includes('Offseason')));

  await new Promise((resolve) => setTimeout(resolve, 25));
  const after = await getAppState<League[]>('leagues', 'registry');
  assert.equal(JSON.stringify(after?.value), beforeBytes);
});
