import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { ReactElement } from 'react';

import { addLeague } from '@/lib/leagueRegistry';
import { __deleteAppStateFileForTests, __resetAppStateForTests } from '@/lib/server/appStateStore';
import type { CanonicalStandings } from '@/lib/selectors/leagueStandings';
import type { LeagueStatus } from '@/lib/league';

import LeagueSchedulePage from '../page';
import LeagueRootPage from '../../page';

// ---------------------------------------------------------------------------
// PLATFORM-043 — /league/[slug]/schedule must supply the same canonical
// standings/status/archive inputs as the root league route, so entering
// directly through /schedule is a route-specific entry point into the same
// canonical app state (not a lighter fallback-only entry) when WeekViewTabs
// switches locally to Standings/Overview/Matchups/Members.
// ---------------------------------------------------------------------------

const SLUG = 'tsc';

// The page returns <main><CFBScheduleApp {...props} /></main>. We construct the
// element tree (no render) and read the props handed to CFBScheduleApp.
type CFBScheduleAppProps = {
  leagueSlug?: string;
  leagueStatus?: LeagueStatus;
  mostRecentArchivedYear?: number;
  canonicalStandings?: CanonicalStandings;
  initialWeekViewMode?: string;
};

function appProps(page: ReactElement): CFBScheduleAppProps {
  const main = page as ReactElement<{ children: ReactElement<CFBScheduleAppProps> }>;
  return main.props.children.props;
}

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('schedule route passes canonical standings, league status, and archive context', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2026 },
  });

  const page = await LeagueSchedulePage({ params: Promise.resolve({ slug: SLUG }) });
  const props = appProps(page);

  assert.equal(props.leagueSlug, SLUG);
  assert.equal(props.initialWeekViewMode, 'schedule');
  assert.deepEqual(props.leagueStatus, { state: 'season', year: 2026 });
  assert.ok(props.canonicalStandings, 'canonicalStandings must be passed through');
  assert.equal(props.canonicalStandings?.slug, SLUG);
  // No archives seeded → undefined (matches root route behavior).
  assert.equal(props.mostRecentArchivedYear, undefined);
});

test('schedule route supplies the same canonical inputs as the root league route', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2026 },
  });

  const [schedule, root] = await Promise.all([
    LeagueSchedulePage({ params: Promise.resolve({ slug: SLUG }) }),
    LeagueRootPage({ params: Promise.resolve({ slug: SLUG }) }),
  ]);
  const scheduleProps = appProps(schedule);
  const rootProps = appProps(root);

  assert.deepEqual(scheduleProps.leagueStatus, rootProps.leagueStatus);
  assert.equal(scheduleProps.mostRecentArchivedYear, rootProps.mostRecentArchivedYear);
  assert.equal(scheduleProps.canonicalStandings?.slug, rootProps.canonicalStandings?.slug);
  assert.equal(scheduleProps.canonicalStandings?.source, rootProps.canonicalStandings?.source);
  // Only the entry-point view mode differs.
  assert.equal(scheduleProps.initialWeekViewMode, 'schedule');
});

test('schedule route still passes a canonical snapshot for an empty/unavailable league (fallback intact)', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    // No status, no archives, no roster → canonical resolves to an empty snapshot.
  });

  const page = await LeagueSchedulePage({ params: Promise.resolve({ slug: SLUG }) });
  const props = appProps(page);

  // Canonical is still supplied (never null); the component's fallback branches
  // handle empty rows. Status defaults to the league's active season.
  assert.ok(props.canonicalStandings);
  assert.equal(props.canonicalStandings?.slug, SLUG);
  assert.deepEqual(props.leagueStatus, { state: 'season', year: 2026 });
  assert.equal(props.initialWeekViewMode, 'schedule');
});
