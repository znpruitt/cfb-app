import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScheduleFromApi, type AppGame } from '../../schedule.ts';
import { mapCfbdScheduleGame, type CfbdScheduleGame } from '../../schedule/cfbdSchedule.ts';
import type { TeamCatalogItem } from '../../teamIdentity.ts';
import { selectLiveScorePollGames } from '../../liveScores/browserPolling.ts';
import type { ScorePack } from '../../scores.ts';
import {
  isAwaitingScoreGame,
  LIVE_SCORE_OBSERVATION_MAX_AGE_MS,
  selectGameDayConfidence,
  type LiveScoreObservation,
} from '../gameDayConfidence.ts';

const NOW = new Date('2026-09-05T17:00:00.000Z');
const TEAMS: TeamCatalogItem[] = [
  { school: 'Home Team', level: 'FBS', conference: 'Big Ten' },
  { school: 'Away Team', level: 'FBS', conference: 'SEC' },
];

function game(overrides: Partial<AppGame> = {}): AppGame {
  return {
    key: overrides.key ?? 'g-1',
    eventId: overrides.eventId ?? 'event-1',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? NOW.toISOString(),
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event-key-1',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? 'provider-1',
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
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
    csvAway: overrides.csvAway ?? 'Away Team',
    csvHome: overrides.csvHome ?? 'Home Team',
    canAway: overrides.canAway ?? 'Away Team',
    canHome: overrides.canHome ?? 'Home Team',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

function score(status: string): ScorePack {
  return {
    status,
    away: { team: 'Away Team', score: 7 },
    home: { team: 'Home Team', score: 10 },
    time: status,
  };
}

function observation(overrides: Partial<LiveScoreObservation> = {}): LiveScoreObservation {
  return {
    observedAt: overrides.observedAt ?? new Date(NOW.getTime() - 60_000).toISOString(),
    attachedGameKeys: overrides.attachedGameKeys ?? ['g-1'],
  };
}

function gameFromCfbd(rawStatus: string, date: Date): AppGame {
  const raw: CfbdScheduleGame = {
    id: 401_000,
    week: 1,
    start_date: date.toISOString(),
    home_team: 'Home Team',
    away_team: 'Away Team',
    home_conference: 'Big Ten',
    away_conference: 'SEC',
    status: rawStatus,
  };
  const mapped = mapCfbdScheduleGame(raw, 'regular');
  assert.ok(mapped.ok, 'the raw CFBD row should normalize');
  if (!mapped.ok) throw new Error('CFBD schedule normalization failed');
  const built = buildScheduleFromApi({
    scheduleItems: [mapped.item],
    teams: TEAMS,
    aliasMap: {},
    season: 2026,
  });
  assert.equal(built.games.length, 1, 'the normalized game should enter the canonical schedule');
  return built.games[0]!;
}

test('reports Preparing for kickoff only inside the bounded pregame polling window', () => {
  const preparing = selectGameDayConfidence({
    games: [game({ date: new Date(NOW.getTime() + 10 * 60_000).toISOString() })],
    scoresByKey: {},
    season: 2026,
    observation: null,
    now: NOW.getTime(),
  });
  assert.deepEqual(preparing, { kind: 'preparing', label: 'Preparing for kickoff' });

  const tooEarly = selectGameDayConfidence({
    games: [game({ date: new Date(NOW.getTime() + 16 * 60_000).toISOString() })],
    scoresByKey: {},
    season: 2026,
    observation: null,
    now: NOW.getTime(),
  });
  assert.equal(tooEarly, null);
});

test('reports Waiting for scores after kickoff when no usable score has attached', () => {
  const waiting = selectGameDayConfidence({
    games: [game({ date: new Date(NOW.getTime() - 60_000).toISOString() })],
    scoresByKey: {},
    season: 2026,
    observation: null,
    now: NOW.getTime(),
  });

  assert.deepEqual(waiting, { kind: 'waiting', label: 'Waiting for scores' });
});

test('reports Tracking scores only for a freshly observed, same-poll attached live game', () => {
  const tracking = selectGameDayConfidence({
    games: [game({ date: new Date(NOW.getTime() - 30 * 60_000).toISOString() })],
    scoresByKey: { 'g-1': score('Q2 4:31') },
    season: 2026,
    observation: observation(),
    now: NOW.getTime(),
  });

  assert.deepEqual(tracking, { kind: 'tracking', label: 'Tracking scores' });
});

test('does not claim Tracking for an unattached game or a disrupted game', () => {
  const liveGame = game({ date: new Date(NOW.getTime() - 30 * 60_000).toISOString() });

  assert.equal(
    selectGameDayConfidence({
      games: [liveGame],
      scoresByKey: { 'g-1': score('Q2') },
      season: 2026,
      observation: observation({ attachedGameKeys: ['another-game'] }),
      now: NOW.getTime(),
    }),
    null
  );

  assert.equal(
    selectGameDayConfidence({
      games: [liveGame],
      scoresByKey: { 'g-1': score('STATUS_DELAYED') },
      season: 2026,
      observation: observation(),
      now: NOW.getTime(),
    }),
    null
  );
});

test('a stale schedule status cannot support Tracking over a final score', () => {
  const result = selectGameDayConfidence({
    games: [
      game({
        date: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
        status: 'in_progress',
      }),
    ],
    scoresByKey: { 'g-1': score('Final') },
    season: 2026,
    observation: null,
    now: NOW.getTime(),
  });

  assert.equal(result, null);
});

test('a missing score cannot support Tracking even with fresh attached-key evidence', () => {
  const result = selectGameDayConfidence({
    games: [game({ date: new Date(NOW.getTime() - 60_000).toISOString() })],
    scoresByKey: {},
    season: 2026,
    observation: observation(),
    now: NOW.getTime(),
  });

  assert.deepEqual(result, { kind: 'waiting', label: 'Waiting for scores' });
});

test('Tracking evidence covers two poll cycles and expires before the third', () => {
  const liveGame = game({ date: new Date(NOW.getTime() - 30 * 60_000).toISOString() });
  const atBoundary = observation({
    observedAt: new Date(NOW.getTime() - LIVE_SCORE_OBSERVATION_MAX_AGE_MS).toISOString(),
  });

  assert.deepEqual(
    selectGameDayConfidence({
      games: [liveGame],
      scoresByKey: { 'g-1': score('Q2') },
      season: 2026,
      observation: atBoundary,
      now: NOW.getTime(),
    }),
    { kind: 'tracking', label: 'Tracking scores' }
  );

  assert.equal(
    selectGameDayConfidence({
      games: [liveGame],
      scoresByKey: { 'g-1': score('Q2') },
      season: 2026,
      observation: atBoundary,
      now: NOW.getTime() + 1,
    }),
    null
  );
});

test('a missing score cannot make any confidence claim after the polling window closes', () => {
  const result = selectGameDayConfidence({
    games: [game({ date: new Date(NOW.getTime() - 25 * 60 * 60_000).toISOString() })],
    scoresByKey: {},
    season: 2026,
    observation: observation(),
    now: NOW.getTime(),
  });

  assert.equal(result, null);
});

test('a stale live row blocks a misleading pregame claim for a later game', () => {
  const result = selectGameDayConfidence({
    games: [
      game({ key: 'g-1', date: new Date(NOW.getTime() - 30 * 60_000).toISOString() }),
      game({ key: 'g-2', date: new Date(NOW.getTime() + 10 * 60_000).toISOString() }),
    ],
    scoresByKey: { 'g-1': score('Q3') },
    season: 2026,
    observation: null,
    now: NOW.getTime(),
  });

  assert.equal(result, null);
});

test('confidence is disabled outside the current season', () => {
  const result = selectGameDayConfidence({
    games: [game({ date: new Date(NOW.getTime() + 10 * 60_000).toISOString() })],
    scoresByKey: {},
    season: 2025,
    observation: null,
    now: NOW.getTime(),
  });

  assert.equal(result, null);
});

test('a known disrupted game never claims preparation or waiting', () => {
  const future = game({ date: new Date(NOW.getTime() + 10 * 60_000).toISOString() });
  assert.equal(
    selectGameDayConfidence({
      games: [future],
      scoresByKey: { 'g-1': score('STATUS_DELAYED') },
      season: 2026,
      observation: null,
      now: NOW.getTime(),
    }),
    null
  );

  const kickedOff = game({ date: new Date(NOW.getTime() - 10 * 60_000).toISOString() });
  assert.equal(
    selectGameDayConfidence({
      games: [kickedOff],
      scoresByKey: { 'g-1': score('STATUS_SUSPENDED') },
      season: 2026,
      observation: null,
      now: NOW.getTime(),
    }),
    null
  );
});

test('raw CFBD canceled/postponed games never poll or make claims without a score row', () => {
  for (const rawStatus of ['canceled', 'Postponed']) {
    for (const offsetMinutes of [10, -30]) {
      const now = NOW.getTime();
      const normalized = gameFromCfbd(rawStatus, new Date(now + offsetMinutes * 60_000));
      assert.equal(normalized.rawStatus, rawStatus);
      assert.deepEqual(
        selectLiveScorePollGames({ games: [normalized], scoresByKey: {}, season: 2026, now: NOW }),
        [],
        `${rawStatus} should not browser-poll at offset ${offsetMinutes}`
      );
      assert.equal(
        selectGameDayConfidence({
          games: [normalized],
          scoresByKey: {},
          season: 2026,
          observation: null,
          now,
        }),
        null,
        `${rawStatus} should make no header claim at offset ${offsetMinutes}`
      );
      assert.equal(
        isAwaitingScoreGame({ game: normalized, context: { season: 2026, now } }),
        false,
        `${rawStatus} should make no owner-row claim at offset ${offsetMinutes}`
      );
    }
  }
});

test('raw CFBD delayed/suspended games may poll but make no unsupported claim', () => {
  for (const rawStatus of ['STATUS_DELAYED', 'STATUS_SUSPENDED']) {
    for (const offsetMinutes of [10, -30]) {
      const now = NOW.getTime();
      const normalized = gameFromCfbd(rawStatus, new Date(now + offsetMinutes * 60_000));
      assert.equal(normalized.rawStatus, rawStatus);
      assert.deepEqual(
        selectLiveScorePollGames({ games: [normalized], scoresByKey: {}, season: 2026, now: NOW }),
        [normalized],
        `${rawStatus} may still poll for a resumed game`
      );
      assert.equal(
        selectGameDayConfidence({
          games: [normalized],
          scoresByKey: {},
          season: 2026,
          observation: null,
          now,
        }),
        null,
        `${rawStatus} should make no header claim at offset ${offsetMinutes}`
      );
      assert.equal(
        isAwaitingScoreGame({ game: normalized, context: { season: 2026, now } }),
        false,
        `${rawStatus} should make no owner-row claim at offset ${offsetMinutes}`
      );
    }
  }
});
