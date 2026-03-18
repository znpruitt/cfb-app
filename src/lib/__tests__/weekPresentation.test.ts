import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../schedule';
import {
  deriveWeekDateMetadata,
  deriveWeekDateMetadataByWeek,
  groupGamesByDisplayDate,
  sortGamesChronologically,
} from '../weekPresentation';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? overrides.key ?? 'g',
    week: overrides.week ?? 0,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 0,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 0,
    date: overrides.date ?? null,
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'g',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.canAway ?? overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'IND',
    homeConf: overrides.homeConf ?? 'IND',
    sources: overrides.sources,
  };
}

test('single-date week shows a single-date label', () => {
  const metadata = deriveWeekDateMetadata(
    [game({ key: 'w0', week: 0, date: '2025-08-23T18:00:00.000Z' })],
    0
  );

  assert.equal(metadata.label, 'Aug 23');
});

test('multi-date week shows a compact range label', () => {
  const metadata = deriveWeekDateMetadata(
    [
      game({ key: 'w1a', week: 1, date: '2025-08-29T23:00:00.000Z' }),
      game({ key: 'w1b', week: 1, date: '2025-09-03T23:00:00.000Z' }),
    ],
    1
  );

  assert.equal(metadata.label, 'Aug 29 – Sep 3');
});

test('cross-month week labels format correctly', () => {
  const metadata = deriveWeekDateMetadata(
    [
      game({ key: 'w5a', week: 5, date: '2025-09-28T18:00:00.000Z' }),
      game({ key: 'w5b', week: 5, date: '2025-10-04T18:00:00.000Z' }),
    ],
    5
  );

  assert.equal(metadata.label, 'Sep 28 – Oct 4');
});

test('future-season week labels adapt without hardcoded dates', () => {
  const byWeek = deriveWeekDateMetadataByWeek([
    game({ key: 'future-0', week: 0, date: '2026-08-22T18:00:00.000Z' }),
    game({ key: 'future-1a', week: 1, date: '2026-08-29T18:00:00.000Z' }),
    game({ key: 'future-1b', week: 1, date: '2026-08-31T18:00:00.000Z' }),
  ]);

  assert.equal(byWeek.get(0)?.label, 'Aug 22');
  assert.equal(byWeek.get(1)?.label, 'Aug 29 – Aug 31');
});

test('games are grouped by ascending display date and kickoff order with TBD times last', () => {
  const ordered = sortGamesChronologically([
    game({ key: 'late', week: 1, date: '2025-08-30T20:00:00.000Z' }),
    game({ key: 'tbd', week: 1, date: null }),
    game({ key: 'early', week: 1, date: '2025-08-30T15:00:00.000Z' }),
    game({ key: 'next-day', week: 1, date: '2025-08-31T15:00:00.000Z' }),
  ]);

  assert.deepEqual(
    ordered.map((item) => item.key),
    ['early', 'late', 'next-day', 'tbd']
  );

  const groups = groupGamesByDisplayDate(ordered);
  assert.deepEqual(
    groups.map((group) => ({ label: group.label, keys: group.games.map((item) => item.key) })),
    [
      { label: 'Saturday, Aug 30', keys: ['early', 'late'] },
      { label: 'Sunday, Aug 31', keys: ['next-day'] },
      { label: 'Date TBD', keys: ['tbd'] },
    ]
  );
});
