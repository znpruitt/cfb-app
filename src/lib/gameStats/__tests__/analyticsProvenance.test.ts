import assert from 'node:assert/strict';
import test from 'node:test';

import { assembleArchiveAnalyticsProvenance } from '../analyticsProvenance.ts';
import { buildGameStatSlateSnapshot } from '../slateSnapshot.ts';
import { buildScheduleFromApi } from '../../schedule.ts';
import type { SeasonArchive } from '../../seasonArchive.ts';
import { C1_TEAMS, scheduleItem } from './c1Fixtures.ts';

// PLATFORM-086H3E3 — archive provenance fails CLOSED with DISTINCT reasons for
// every unusable pairing input. Durable archives are untyped at rest, so both
// halves of the pairing (slate snapshot AND score map) validate before
// anything indexes them; nothing here may throw or rebuild live context.

const YEAR = 2025;

function validSnapshot() {
  const scheduleItems = [
    scheduleItem({
      id: '5001',
      week: 3,
      home: 'Alpha State',
      away: 'Beta Tech',
      status: 'final',
      homeId: 101,
      awayId: 202,
    }),
  ];
  const { games } = buildScheduleFromApi({
    scheduleItems,
    teams: C1_TEAMS,
    aliasMap: {},
    season: YEAR,
  });
  return buildGameStatSlateSnapshot({
    year: YEAR,
    games,
    scheduleItems,
    teams: C1_TEAMS,
    aliasMap: {},
    now: new Date('2025-09-07T00:00:00Z'),
  });
}

function archiveWith(overrides: Partial<Record<keyof SeasonArchive, unknown>>): SeasonArchive {
  return {
    leagueSlug: 'prov-league',
    year: YEAR,
    archivedAt: '2026-01-15T00:00:00.000Z',
    ownerRosterSnapshot: '',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
    gameStatSlate: validSnapshot(),
    ...overrides,
  } as SeasonArchive;
}

test('a valid snapshot + object score map pairs, with NO identity payload (archives carry none)', () => {
  const result = assembleArchiveAnalyticsProvenance(
    archiveWith({ scoresByKey: { 'key-1': { status: 'final' } } })
  );
  assert.equal(result.status, 'available');
  if (result.status === 'available') {
    assert.equal(result.identity, null);
    assert.equal(result.input.slate.year, YEAR);
    assert.equal(result.input.slate.games.length, 1);
  }
});

test('a missing snapshot fails closed distinctly', () => {
  assert.deepEqual(assembleArchiveAnalyticsProvenance(archiveWith({ gameStatSlate: undefined })), {
    status: 'unavailable',
    reason: 'archive-slate-missing',
  });
});

test('a malformed snapshot fails closed distinctly', () => {
  assert.deepEqual(
    assembleArchiveAnalyticsProvenance(archiveWith({ gameStatSlate: { snapshotVersion: 2 } })),
    { status: 'unavailable', reason: 'archive-slate-malformed' }
  );
});

test('a year-mismatched snapshot is a provenance violation → malformed', () => {
  const wrongYear = { ...validSnapshot(), year: YEAR - 1 };
  assert.deepEqual(assembleArchiveAnalyticsProvenance(archiveWith({ gameStatSlate: wrongYear })), {
    status: 'unavailable',
    reason: 'archive-slate-malformed',
  });
});

test('a MISSING or null score map fails closed distinctly — never thrown, never rebuilt', () => {
  assert.deepEqual(assembleArchiveAnalyticsProvenance(archiveWith({ scoresByKey: undefined })), {
    status: 'unavailable',
    reason: 'archive-scores-missing',
  });
  assert.deepEqual(assembleArchiveAnalyticsProvenance(archiveWith({ scoresByKey: null })), {
    status: 'unavailable',
    reason: 'archive-scores-missing',
  });
});

test('a non-object score map fails closed distinctly', () => {
  for (const scoresByKey of ['scores', 42, ['final']]) {
    assert.deepEqual(
      assembleArchiveAnalyticsProvenance(archiveWith({ scoresByKey })),
      { status: 'unavailable', reason: 'archive-scores-malformed' },
      String(scoresByKey)
    );
  }
});
