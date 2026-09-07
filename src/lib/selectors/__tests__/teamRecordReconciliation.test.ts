import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScheduleWireItem } from '../../schedule.ts';
import type { ScorePack } from '../../scores/types.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import type { TeamRecordItem, TeamRecordsCacheRead } from '../../teamRecords/teamRecordsCache.ts';
import {
  applyTeamRecordReconciliationPlan,
  buildTeamRecordReconciliationPlan,
  type AvailableTeamRecordReconciliationPlan,
  type TeamRecordScoreFact,
  validateScoreConclusionCandidates,
} from '../teamRecordReconciliation.ts';

const YEAR = 2026;

function scheduleGame(params: {
  id: string;
  kickoffIndex: number;
  awayId: number;
  homeId: number;
  completed?: boolean;
  status?: string;
}): ScheduleWireItem {
  return {
    id: params.id,
    week: 1,
    startDate: new Date(Date.UTC(YEAR, 8, 5, 12, params.kickoffIndex)).toISOString(),
    neutralSite: false,
    conferenceGame: false,
    awayTeam: `Away ${params.awayId}`,
    homeTeam: `Home ${params.homeId}`,
    awayId: params.awayId,
    homeId: params.homeId,
    awayConference: 'Away Conference',
    homeConference: 'Home Conference',
    status: params.status ?? 'scheduled',
    completed: params.completed ?? true,
    seasonType: 'regular',
  };
}

function score(
  item: ScheduleWireItem,
  awayScore: number | null,
  homeScore: number | null,
  overrides: Partial<Pick<ScorePack, 'status'>> = {}
): TeamRecordScoreFact {
  return {
    score: {
      id: item.id,
      seasonType: 'regular',
      startDate: item.startDate,
      week: item.week,
      status: overrides.status ?? 'final',
      away: { team: item.awayTeam, score: awayScore },
      home: { team: item.homeTeam, score: homeScore },
      time: null,
    },
  };
}

function record(teamId: number, team: string, total: TeamRecordItem['total']): TeamRecordItem {
  return {
    year: YEAR,
    teamId,
    team,
    classification: 'fbs',
    conference: null,
    total,
  };
}

function recordCache(items: TeamRecordItem[]): TeamRecordsCacheRead {
  return { at: Date.UTC(YEAR, 8, 5, 12), year: YEAR, items, uncreditableTeamIds: [] };
}

function resolverFor(scheduleItems: ReadonlyArray<ScheduleWireItem>) {
  const observedNames = scheduleItems.flatMap((item) => [item.homeTeam, item.awayTeam]);
  return createTeamIdentityResolver({ teams: [], aliasMap: {}, observedNames, cache: false });
}

function reconcile(params: {
  scheduleItems: ScheduleWireItem[];
  records: TeamRecordsCacheRead;
  facts: Map<string, TeamRecordScoreFact>;
}) {
  const resolver = resolverFor(params.scheduleItems);
  const scoreConclusions = validateScoreConclusionCandidates({
    scheduleItems: params.scheduleItems,
    scoreFactsByProviderGameId: params.facts,
    resolver,
  });
  const plan = buildTeamRecordReconciliationPlan({
    scheduleItems: params.scheduleItems,
    recordCache: params.records,
    validatedScoreConclusionProviderGameIds: scoreConclusions.validatedProviderGameIds,
  });
  assert.equal(plan.status, 'available');
  return applyTeamRecordReconciliationPlan({
    plan: plan as AvailableTeamRecordReconciliationPlan,
    recordCache: params.records,
    scoreFactsByProviderGameId: params.facts,
    resolver,
  });
}

test('a first-seen score final is concluded and folds its own result', () => {
  const game = scheduleGame({
    id: 'headline',
    kickoffIndex: 0,
    awayId: 1,
    homeId: 2,
    completed: false,
  });
  const facts = new Map([[game.id, score(game, 17, 24)]]);
  const result = reconcile({
    scheduleItems: [game],
    records: recordCache([
      record(1, game.awayTeam, { games: 0, wins: 0, losses: 0, ties: 0 }),
      record(2, game.homeTeam, { games: 0, wins: 0, losses: 0, ties: 0 }),
    ]),
    facts,
  });

  assert.deepEqual(result.totalsByTeamId.get(1), { games: 1, wins: 0, losses: 1, ties: 0 });
  assert.deepEqual(result.totalsByTeamId.get(2), { games: 1, wins: 1, losses: 0, ties: 0 });
});

test('a record three games behind folds a win, loss, and tie', () => {
  const games = [
    scheduleGame({ id: 'win', kickoffIndex: 1, awayId: 10, homeId: 20 }),
    scheduleGame({ id: 'loss', kickoffIndex: 2, awayId: 10, homeId: 21 }),
    scheduleGame({ id: 'tie', kickoffIndex: 3, awayId: 10, homeId: 22 }),
  ];
  const facts = new Map([
    ['win', score(games[0]!, 20, 10)],
    ['loss', score(games[1]!, 10, 20)],
    ['tie', score(games[2]!, 14, 14)],
  ]);
  const result = reconcile({
    scheduleItems: games,
    records: recordCache([record(10, 'Away 10', { games: 0, wins: 0, losses: 0, ties: 0 })]),
    facts,
  });

  assert.deepEqual(result.totalsByTeamId.get(10), { games: 3, wins: 1, losses: 1, ties: 1 });
});

test('a current record is unchanged and validates no score rows', () => {
  const game = scheduleGame({ id: 'current', kickoffIndex: 0, awayId: 30, homeId: 31 });
  const result = reconcile({
    scheduleItems: [game],
    records: recordCache([record(30, game.awayTeam, { games: 1, wins: 1, losses: 0, ties: 0 })]),
    facts: new Map([[game.id, score(game, 21, 7)]]),
  });

  assert.deepEqual(result.totalsByTeamId.get(30), { games: 1, wins: 1, losses: 0, ties: 0 });
  assert.equal(result.work.tailGames, 0);
  assert.equal(result.work.tailScoreRowsValidated, 0);
});

test('an unreadable tail game is skipped while later readable games still fold', () => {
  const games = [
    scheduleGame({ id: 'credited', kickoffIndex: 0, awayId: 40, homeId: 50 }),
    scheduleGame({ id: 'unreadable', kickoffIndex: 1, awayId: 40, homeId: 51 }),
    scheduleGame({ id: 'readable', kickoffIndex: 2, awayId: 40, homeId: 52 }),
  ];
  const facts = new Map([
    ['credited', score(games[0]!, 21, 7)],
    ['unreadable', score(games[1]!, null, 7)],
    ['readable', score(games[2]!, 24, 10)],
  ]);
  const result = reconcile({
    scheduleItems: games,
    records: recordCache([record(40, 'Away 40', { games: 1, wins: 1, losses: 0, ties: 0 })]),
    facts,
  });

  assert.deepEqual(result.totalsByTeamId.get(40), { games: 2, wins: 2, losses: 0, ties: 0 });
  assert.equal(result.work.tailScoreRowsValidated, 2);
});

test('generated reconciliation covers game counts, lag, ties, and unreadable tail rows', () => {
  let scenarios = 0;
  for (let completed = 0; completed <= 8; completed += 1) {
    for (let behind = 0; behind <= completed; behind += 1) {
      for (const tieOffset of [-1, 0, 1]) {
        for (const unreadableOffset of [-1, 0, 2]) {
          const games = Array.from({ length: completed }, (_, index) =>
            scheduleGame({
              id: `generated-${completed}-${behind}-${tieOffset}-${unreadableOffset}-${index}`,
              kickoffIndex: index,
              awayId: 100,
              homeId: 200 + index,
            })
          );
          const reflected = completed - behind;
          const facts = new Map<string, TeamRecordScoreFact>();
          let expected = { games: reflected, wins: reflected, losses: 0, ties: 0 };
          for (let index = 0; index < games.length; index += 1) {
            const tailOffset = index - reflected;
            const unreadable = tailOffset >= 0 && tailOffset === unreadableOffset;
            const tie = tailOffset >= 0 && tailOffset === tieOffset;
            facts.set(
              games[index]!.id,
              unreadable
                ? score(games[index]!, null, 7)
                : tie
                  ? score(games[index]!, 14, 14)
                  : score(games[index]!, 21, 7)
            );
            if (tailOffset >= 0 && !unreadable) {
              expected = {
                ...expected,
                games: expected.games + 1,
                wins: expected.wins + (tie ? 0 : 1),
                ties: expected.ties + (tie ? 1 : 0),
              };
            }
          }

          const result = reconcile({
            scheduleItems: games,
            records: recordCache([
              record(100, 'Away 100', {
                games: reflected,
                wins: reflected,
                losses: 0,
                ties: 0,
              }),
            ]),
            facts,
          });
          assert.deepEqual(result.totalsByTeamId.get(100), expected);
          scenarios += 1;
        }
      }
    }
  }
  assert.equal(scenarios, 405);
});

test('Saturday-scale cold work validates only a 300-game six-hour tail', () => {
  const tailGames = Array.from({ length: 300 }, (_, index) =>
    scheduleGame({
      id: `tail-${index}`,
      kickoffIndex: index,
      awayId: 1000 + index * 2,
      homeId: 1001 + index * 2,
    })
  );
  const filler = Array.from({ length: 3380 }, (_, index) =>
    scheduleGame({
      id: `future-${index}`,
      kickoffIndex: index,
      awayId: 10000 + index * 2,
      homeId: 10001 + index * 2,
      completed: false,
    })
  );
  const records = recordCache(
    tailGames.flatMap((game) => [
      record(game.awayId!, game.awayTeam, { games: 0, wins: 0, losses: 0, ties: 0 }),
      record(game.homeId!, game.homeTeam, { games: 0, wins: 0, losses: 0, ties: 0 }),
    ])
  );
  const facts = new Map(tailGames.map((game) => [game.id, score(game, 14, 21)]));
  const result = reconcile({ scheduleItems: [...tailGames, ...filler], records, facts });

  assert.deepEqual(result.work, {
    scheduleRowsScanned: 3680,
    concludedParticipations: 600,
    tailGames: 300,
    tailParticipations: 600,
    tailScoreRowsValidated: 300,
  });
});

test('duplicate provider IDs and unparseable concluded kickoffs fail the enrichment guard', () => {
  const duplicate = scheduleGame({ id: 'duplicate', kickoffIndex: 0, awayId: 1, homeId: 2 });
  const records = recordCache([
    record(1, duplicate.awayTeam, { games: 0, wins: 0, losses: 0, ties: 0 }),
  ]);
  const duplicatePlan = buildTeamRecordReconciliationPlan({
    scheduleItems: [duplicate, { ...duplicate }],
    recordCache: records,
  });
  assert.deepEqual(duplicatePlan, {
    status: 'unavailable',
    reason: 'team-record-reconciliation-duplicate-provider-game-id:duplicate',
  });

  const invalidKickoffPlan = buildTeamRecordReconciliationPlan({
    scheduleItems: [{ ...duplicate, id: 'undated', startDate: null }],
    recordCache: records,
  });
  assert.deepEqual(invalidKickoffPlan, {
    status: 'unavailable',
    reason: 'team-record-reconciliation-unparseable-kickoff:undated',
  });
});

test('participant validation supports a safe reversal and rejects a wrong opponent', () => {
  const game = scheduleGame({
    id: 'orientation',
    kickoffIndex: 0,
    awayId: 70,
    homeId: 71,
    completed: false,
  });
  const reversed = score(game, 10, 27);
  reversed.score = {
    ...reversed.score,
    away: { team: game.homeTeam, score: 27 },
    home: { team: game.awayTeam, score: 10 },
  };
  const reversedResult = reconcile({
    scheduleItems: [game],
    records: recordCache([record(70, game.awayTeam, { games: 0, wins: 0, losses: 0, ties: 0 })]),
    facts: new Map([[game.id, reversed]]),
  });
  assert.deepEqual(reversedResult.totalsByTeamId.get(70), {
    games: 1,
    wins: 0,
    losses: 1,
    ties: 0,
  });

  const wrongOpponent = score(game, 10, 27);
  wrongOpponent.score.away.team = 'Different Opponent';
  const rejectedResult = reconcile({
    scheduleItems: [game],
    records: recordCache([record(70, game.awayTeam, { games: 0, wins: 0, losses: 0, ties: 0 })]),
    facts: new Map([[game.id, wrongOpponent]]),
  });
  assert.deepEqual(rejectedResult.totalsByTeamId.get(70), {
    games: 0,
    wins: 0,
    losses: 0,
    ties: 0,
  });
});

test('a wrong-game final cannot enter the prefix and displace the real unreflected result', () => {
  const wrongGame = scheduleGame({
    id: '401858427',
    kickoffIndex: 0,
    awayId: 80,
    homeId: 90,
    completed: false,
  });
  const credited = scheduleGame({
    id: 'credited-after-wrong',
    kickoffIndex: 1,
    awayId: 80,
    homeId: 91,
  });
  const unreflected = scheduleGame({
    id: 'unreflected-after-wrong',
    kickoffIndex: 2,
    awayId: 80,
    homeId: 92,
  });
  const wrongScore = score(wrongGame, 10, 27);
  wrongScore.score.away.team = 'Howard';
  const scheduleItems = [wrongGame, credited, unreflected];
  const facts = new Map([
    [wrongGame.id, wrongScore],
    [credited.id, score(credited, 21, 7)],
    [unreflected.id, score(unreflected, 24, 10)],
  ]);
  const resolver = resolverFor(scheduleItems);
  const validation = validateScoreConclusionCandidates({
    scheduleItems,
    scoreFactsByProviderGameId: facts,
    resolver,
  });
  assert.deepEqual([...validation.rejectedProviderGameIds], ['401858427']);

  const result = reconcile({
    scheduleItems,
    records: recordCache([
      record(80, wrongGame.awayTeam, { games: 1, wins: 1, losses: 0, ties: 0 }),
    ]),
    facts,
  });
  assert.deepEqual(result.totalsByTeamId.get(80), {
    games: 2,
    wins: 2,
    losses: 0,
    ties: 0,
  });
});
