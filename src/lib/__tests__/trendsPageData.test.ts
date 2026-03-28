import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCanonicalTrendsPageData } from '../trendsPageData';
import type { BuiltSchedule } from '../schedule';
import type { ScorePack } from '../scores';

const season = 2026;

const baseBuiltSchedule: BuiltSchedule = {
  games: [
    {
      key: 'g1',
      eventId: 'g1',
      week: 1,
      providerWeek: 1,
      canonicalWeek: 1,
      date: '2026-09-01T00:00:00.000Z',
      stage: 'regular',
      status: 'final',
      stageOrder: 1,
      slotOrder: 1,
      eventKey: 'g1',
      label: null,
      conference: null,
      bowlName: null,
      playoffRound: null,
      postseasonRole: null,
      providerGameId: 'cfbd-g1',
      neutral: false,
      neutralDisplay: 'home_away',
      venue: null,
      isPlaceholder: false,
      participants: {
        home: {
          kind: 'team',
          teamId: 'home-team',
          displayName: 'Home Team',
          canonicalName: 'Home Team',
          rawName: 'Home Team',
        },
        away: {
          kind: 'team',
          teamId: 'away-team',
          displayName: 'Away Team',
          canonicalName: 'Away Team',
          rawName: 'Away Team',
        },
      },
      csvAway: 'Away Team',
      csvHome: 'Home Team',
      canAway: 'Away Team',
      canHome: 'Home Team',
      awayConf: '',
      homeConf: '',
    },
  ],
  weeks: [1],
  byes: {},
  conferences: [],
  issues: [],
  hydrationDiagnostics: [],
};

const baseScoresByKey: Record<string, ScorePack> = {
  g1: {
    status: 'Final',
    away: { team: 'Away Team', score: 14 },
    home: { team: 'Home Team', score: 24 },
    time: null,
  },
};

function createDeps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fetchTeamsCatalog: async () => [],
    loadServerAliases: async () => ({}),
    loadServerOwnersCsv: async () => ({
      csvText: 'team,owner\nHome Team,Alice\nAway Team,Bob',
      hasStoredValue: true,
    }),
    fetchSeasonSchedule: async () => ({
      items: [],
      meta: { source: 'test', cache: 'miss' as const },
    }),
    buildScheduleFromApi: () => baseBuiltSchedule,
    fetchScoresByGame: async () => ({ scoresByKey: baseScoresByKey, issues: [], diag: [] }),
    ...overrides,
  };
}

test('successful load returns derived standings with no issues and hasPartialData false', async () => {
  const result = await loadCanonicalTrendsPageData(season, createDeps() as any);

  assert.notEqual(result.standingsHistory, null);
  assert.notEqual(result.seasonContext, null);
  assert.deepEqual(result.issues, []);
  assert.equal(result.hasPartialData, false);
});

test('schedule failure returns null standings/seasonContext and records issue', async () => {
  const result = await loadCanonicalTrendsPageData(
    season,
    createDeps({
      fetchSeasonSchedule: async () => {
        throw new Error('boom');
      },
    }) as any
  );

  assert.equal(result.standingsHistory, null);
  assert.equal(result.seasonContext, null);
  assert.ok(result.issues.includes('Failed to load schedule'));
  assert.equal(result.hasPartialData, true);
});

test('scores failure still returns standingsHistory and marks partial data', async () => {
  const result = await loadCanonicalTrendsPageData(
    season,
    createDeps({
      fetchScoresByGame: async () => {
        throw new Error('scores down');
      },
    }) as any
  );

  assert.notEqual(result.standingsHistory, null);
  assert.ok(result.issues.includes('Failed to load scores'));
  assert.equal(result.hasPartialData, true);
});

test('owners missing still returns standingsHistory and includes owners issue', async () => {
  const result = await loadCanonicalTrendsPageData(
    season,
    createDeps({
      loadServerOwnersCsv: async () => ({ csvText: null, hasStoredValue: false }),
    }) as any
  );

  assert.notEqual(result.standingsHistory, null);
  assert.ok(result.issues.includes('Owners CSV missing or empty'));
  assert.equal(result.hasPartialData, true);
});

test('mixed partial failures accumulate issues and keep stable output shape', async () => {
  const result = await loadCanonicalTrendsPageData(
    season,
    createDeps({
      fetchTeamsCatalog: async () => {
        throw new Error('teams down');
      },
      loadServerAliases: async () => {
        throw new Error('aliases down');
      },
      fetchScoresByGame: async () => {
        throw new Error('scores down');
      },
    }) as any
  );

  assert.notEqual(result.standingsHistory, null);
  assert.notEqual(result.seasonContext, null);
  assert.ok(result.issues.includes('Failed to load teams catalog'));
  assert.ok(result.issues.includes('Failed to load aliases'));
  assert.ok(result.issues.includes('Failed to load scores'));
  assert.equal(result.hasPartialData, true);
});
