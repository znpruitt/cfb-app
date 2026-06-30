import assert from 'node:assert/strict';
import test from 'node:test';

import { setAppState } from '@/lib/server/appStateStore';
import type { ScheduleWireItem } from '@/lib/schedule';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import { selectDraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import { loadSpectatorBoardSchedule } from '../boardData';

// ---------------------------------------------------------------------------
// PLATFORM-035 — the spectator draft board must resolve its cached schedule
// through server-safe scoped aliases (appState), not the browser-era loader in
// src/lib/aliases.ts. With the legacy loader, server render fetched a relative
// `/data/team-aliases.json` URL, failed silently, and left schedule-derived
// draft insights empty even when cached schedule + aliases existed.
//
// The "Ohio State" game below uses a home label ("The Ohio State Buckeyes")
// that is resolvable ONLY via the seeded alias map — so a populated, correctly
// canonicalized schedule proves the server-safe alias path is actually used.
// ---------------------------------------------------------------------------

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
];

function scheduleItem(year: number): ScheduleWireItem {
  return {
    id: 'osu-mich',
    week: 13,
    startDate: `${year}-11-28T17:00:00.000Z`,
    neutralSite: false,
    conferenceGame: true,
    // Alias-only label: not present in the teams catalog (school/alts), so it
    // resolves to canonical "Ohio State" only through the seeded alias map.
    homeTeam: 'The Ohio State Buckeyes',
    awayTeam: 'Michigan',
    homeConference: 'Big Ten',
    awayConference: 'Big Ten',
    status: 'scheduled',
    seasonType: 'regular',
  };
}

function ohioStateInsight(schedule: Awaited<ReturnType<typeof loadSpectatorBoardSchedule>>) {
  const insights = selectDraftTeamInsights({
    teams: TEAMS,
    spRatings: null,
    winTotals: null,
    schedule,
    apPoll: null,
    year: 2026,
  });
  return insights.find((i) => i.teamId === 'Ohio State');
}

test('spectator board schedule resolves cached games via server-safe scoped aliases', async () => {
  const slug = 'tsc';
  const year = 2026;

  // Seed the cached schedule + a league/year-scoped alias map (server-side
  // source) — the only way the alias-only home label can canonicalize.
  await setAppState('schedule', `${year}-all-all`, { items: [scheduleItem(year)] });
  await setAppState(`aliases:${slug}:${year}`, 'map', {
    'the ohio state buckeyes': 'Ohio State',
  });

  const games = await loadSpectatorBoardSchedule({ slug, year, teams: TEAMS });

  assert.equal(games.length, 1);
  assert.equal(games[0]?.canHome, 'Ohio State');
  assert.equal(games[0]?.canAway, 'Michigan');

  // Schedule-derived draft insights are populated for the resolved team.
  const insight = ohioStateInsight(games);
  assert.ok(insight, 'expected an Ohio State insight');
  assert.equal(insight?.homeGames + insight?.awayGames + insight?.neutralGames, 1);
});

test('current global aliases override a conflicting deprecated league/year scope', async () => {
  const slug = 'tsc';
  const year = 2028;

  // A distinct alias label (never used by the other tests) keeps this case
  // independent of shared appState. The deprecated league/year scope maps it to
  // the WRONG team; the canonical global store maps it correctly. Global must win.
  await setAppState('schedule', `${year}-all-all`, {
    items: [{ ...scheduleItem(year), homeTeam: 'Buckeye Nation' }],
  });
  await setAppState(`aliases:${slug}:${year}`, 'map', { 'buckeye nation': 'Michigan' });
  await setAppState('aliases:global', 'map', { 'buckeye nation': 'Ohio State' });

  const games = await loadSpectatorBoardSchedule({ slug, year, teams: TEAMS });

  assert.equal(games.length, 1);
  assert.equal(games[0]?.canHome, 'Ohio State');
});

test('without server-side aliases the schedule does not canonicalize and insights stay empty', async () => {
  const slug = 'tsc';
  const year = 2027; // distinct year → no alias scope seeded for it

  // Cached schedule exists, but NO alias scope is seeded — mirroring the
  // legacy browser loader's effective server result (empty alias map).
  await setAppState('schedule', `${year}-all-all`, { items: [scheduleItem(year)] });

  const games = await loadSpectatorBoardSchedule({ slug, year, teams: TEAMS });

  // The alias-only home label fails to resolve to canonical "Ohio State", so
  // the team receives no schedule-derived games.
  assert.notEqual(games[0]?.canHome, 'Ohio State');

  const insight = ohioStateInsight(games);
  assert.ok(insight, 'expected an Ohio State insight row');
  assert.equal(insight?.homeGames + insight?.awayGames + insight?.neutralGames, 0);
});
