import assert from 'node:assert/strict';
import test from 'node:test';

import { setAppState } from '@/lib/server/appStateStore';
import type { ScheduleWireItem } from '@/lib/schedule';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import { resolveDraftScheduleGames } from '../draftSchedule';

// PLATFORM-060 — the draft page must resolve its cached schedule through the
// canonical effective alias map (getScopedAliasMap: stored global > league+year
// > year > SEED_ALIASES), NOT a hand-rolled scope merge that missed stored
// global and used inverted precedence. Each case seeds only the layer under
// test with an alias-only home label and asserts the resolved canonical team.

const TEAMS: TeamCatalogItem[] = [
  {
    school: 'Ohio State',
    displayName: 'Ohio State',
    shortDisplayName: 'Ohio State',
    abbreviation: 'OSU',
    level: 'FBS',
    conference: 'Big Ten',
  },
  {
    school: 'Michigan',
    displayName: 'Michigan',
    shortDisplayName: 'Michigan',
    abbreviation: 'MICH',
    level: 'FBS',
    conference: 'Big Ten',
  },
  {
    school: 'Appalachian State',
    displayName: 'Appalachian State',
    shortDisplayName: 'App State',
    abbreviation: 'APP',
    level: 'FBS',
    conference: 'Sun Belt',
  },
];

function scheduleItem(year: number, homeTeam: string): ScheduleWireItem {
  return {
    id: `game-${year}`,
    week: 13,
    startDate: `${year}-11-28T17:00:00.000Z`,
    neutralSite: false,
    conferenceGame: true,
    homeTeam, // alias-only label — resolves only via the effective alias map
    awayTeam: 'Michigan',
    homeConference: 'Big Ten',
    awayConference: 'Big Ten',
    status: 'scheduled',
    seasonType: 'regular',
  };
}

async function resolveHome(
  slug: string,
  year: number,
  homeLabel: string
): Promise<string | undefined> {
  await setAppState('schedule', `${year}-all-all`, { items: [scheduleItem(year, homeLabel)] });
  const { games } = await resolveDraftScheduleGames({
    slug,
    year,
    teams: TEAMS,
    scheduleItems: [scheduleItem(year, homeLabel)],
  });
  return games[0]?.canHome;
}

test('draft schedule resolves a global-only alias (no league/year scope)', async () => {
  const year = 2040;
  await setAppState('aliases:global', 'map', { 'global buckeyes': 'Ohio State' });
  assert.equal(await resolveHome('tsc', year, 'Global Buckeyes'), 'Ohio State');
});

test('draft schedule resolves a year-only alias fallback', async () => {
  const year = 2041;
  await setAppState(`aliases:${year}`, 'map', { 'year buckeyes': 'Ohio State' });
  assert.equal(await resolveHome('tsc', year, 'Year Buckeyes'), 'Ohio State');
});

test('draft schedule resolves a SEED_ALIASES fallback', async () => {
  const year = 2042; // no alias scope seeded — resolves only via code seeds
  // SEED_ALIASES maps 'app state' -> 'appalachian state'.
  assert.equal(await resolveHome('tsc', year, 'App State'), 'Appalachian State');
});

test('draft schedule: stored global beats a conflicting league+year scope', async () => {
  const slug = 'alias-global-wins';
  const year = 2043;
  await setAppState(`aliases:${slug}:${year}`, 'map', { 'conflict team': 'Michigan' });
  await setAppState('aliases:global', 'map', { 'conflict team': 'Ohio State' });
  assert.equal(await resolveHome(slug, year, 'Conflict Team'), 'Ohio State');
});

test('draft schedule: league+year beats a conflicting year-only scope', async () => {
  const slug = 'alias-league-wins';
  const year = 2044;
  await setAppState(`aliases:${year}`, 'map', { 'scoped team': 'Michigan' });
  await setAppState(`aliases:${slug}:${year}`, 'map', { 'scoped team': 'Ohio State' });
  assert.equal(await resolveHome(slug, year, 'Scoped Team'), 'Ohio State');
});
