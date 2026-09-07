import { classifyScorePackStatus, hasUsableFinalScore } from '../gameStatus.ts';
import type { ScheduleWireItem } from '../schedule.ts';
import { validateScoreParticipantOrientation } from '../scoreAttachment.ts';
import type { ScorePack } from '../scores/types.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';
import type { TeamRecordsCacheRead, TeamRecordTotal } from '../teamRecords/teamRecordsCache.ts';

export type TeamRecordReconciliationWork = {
  scheduleRowsScanned: number;
  concludedParticipations: number;
  tailGames: number;
  tailParticipations: number;
  tailScoreRowsInspected: number;
};

export type TeamRecordScoreFact = {
  score: ScorePack;
};

export type ScoreConclusionValidation = {
  validatedProviderGameIds: Set<string>;
  rejectedProviderGameIds: Set<string>;
};

type TailParticipation = {
  providerGameId: string;
  kickoffMs: number;
  side: 'away' | 'home';
};

export type AvailableTeamRecordReconciliationPlan = {
  status: 'available';
  tailByTeamId: Map<number, TailParticipation[]>;
  tailScheduleByProviderGameId: Map<string, ScheduleWireItem>;
  work: Omit<TeamRecordReconciliationWork, 'tailScoreRowsInspected'>;
};

export type TeamRecordReconciliationPlan =
  | AvailableTeamRecordReconciliationPlan
  | {
      status: 'unavailable';
      reason:
        | `team-record-reconciliation-duplicate-provider-game-id:${string}`
        | `team-record-reconciliation-unparseable-kickoff:${string}`;
    };

function normalizedProviderGameId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Select schedule rows that need score evidence to establish conclusion. */
export function selectScoreConclusionCandidates(params: {
  scheduleItems: ReadonlyArray<ScheduleWireItem>;
  scoreFactsByProviderGameId: ReadonlyMap<string, TeamRecordScoreFact>;
}): ScheduleWireItem[] {
  const { scheduleItems, scoreFactsByProviderGameId } = params;
  return scheduleItems.filter((item) => {
    if (!item || typeof item !== 'object' || item.completed === true) return false;
    const providerGameId = normalizedProviderGameId(item.id);
    if (!providerGameId) return false;
    return (
      classifyScorePackStatus(scoreFactsByProviderGameId.get(providerGameId)?.score) === 'final'
    );
  });
}

/**
 * Validate score-only conclusion evidence before it can affect positional
 * record coverage. A provider game id identifies a candidate but does not prove
 * its participants: durable CFBD rows have carried both reversed sides and a
 * different opponent under an otherwise-valid id.
 */
export function validateScoreConclusionCandidates(params: {
  scheduleItems: ReadonlyArray<ScheduleWireItem>;
  scoreFactsByProviderGameId: ReadonlyMap<string, TeamRecordScoreFact>;
  resolver: TeamIdentityResolver;
}): ScoreConclusionValidation {
  const { scheduleItems, scoreFactsByProviderGameId, resolver } = params;
  const validatedProviderGameIds = new Set<string>();
  const rejectedProviderGameIds = new Set<string>();

  for (const item of selectScoreConclusionCandidates({
    scheduleItems,
    scoreFactsByProviderGameId,
  })) {
    const providerGameId = normalizedProviderGameId(item.id);
    if (!providerGameId) continue;
    const score = scoreFactsByProviderGameId.get(providerGameId)?.score;
    if (!score) continue;

    const orientation = validateScoreParticipantOrientation({
      scheduleHomeTeam: item.homeTeam,
      scheduleAwayTeam: item.awayTeam,
      scoreHomeTeam: score.home.team,
      scoreAwayTeam: score.away.team,
      resolver,
    });
    if (orientation) validatedProviderGameIds.add(providerGameId);
    else rejectedProviderGameIds.add(providerGameId);
  }

  return { validatedProviderGameIds, rejectedProviderGameIds };
}

function addParticipation(
  target: Map<number, TailParticipation[]>,
  recordsByTeamId: ReadonlyMap<number, TeamRecordTotal>,
  teamId: number | null | undefined,
  participation: TailParticipation
): boolean {
  if (teamId == null || !recordsByTeamId.has(teamId)) return false;
  const existing = target.get(teamId);
  if (existing) existing.push(participation);
  else target.set(teamId, [participation]);
  return true;
}

/**
 * Find each record's chronological, unreflected suffix without constructing
 * canonical games or resolving team names. Schedule participant ids and
 * `/records` team ids are both exact CFBD ids; cached score status is used only
 * as conclusion evidence when the weekly schedule row has not flipped yet.
 */
export function buildTeamRecordReconciliationPlan(params: {
  scheduleItems: ReadonlyArray<ScheduleWireItem>;
  recordCache: TeamRecordsCacheRead;
  validatedScoreConclusionProviderGameIds?: ReadonlySet<string>;
}): TeamRecordReconciliationPlan {
  const {
    scheduleItems,
    recordCache,
    validatedScoreConclusionProviderGameIds = new Set<string>(),
  } = params;
  const recordsByTeamId = new Map(
    recordCache.items.map((record) => [record.teamId, record.total] as const)
  );
  const finishedByTeamId = new Map<number, TailParticipation[]>();
  const scheduleByProviderGameId = new Map<string, ScheduleWireItem>();
  let concludedParticipations = 0;

  for (const item of scheduleItems) {
    if (!item || typeof item !== 'object') continue;
    const providerGameId = normalizedProviderGameId(item.id);
    if (!providerGameId) continue;
    if (scheduleByProviderGameId.has(providerGameId)) {
      return {
        status: 'unavailable',
        reason: `team-record-reconciliation-duplicate-provider-game-id:${providerGameId}`,
      };
    }
    scheduleByProviderGameId.set(providerGameId, item);

    // Conclusion membership and outcome readability are deliberately separate.
    // Only participant-validated score evidence may supplement the schedule.
    if (item.completed !== true && !validatedScoreConclusionProviderGameIds.has(providerGameId)) {
      continue;
    }

    const kickoffMs = Date.parse(item.startDate ?? '');
    if (!Number.isFinite(kickoffMs)) {
      return {
        status: 'unavailable',
        reason: `team-record-reconciliation-unparseable-kickoff:${providerGameId}`,
      };
    }

    if (
      addParticipation(finishedByTeamId, recordsByTeamId, item.awayId, {
        providerGameId,
        kickoffMs,
        side: 'away',
      })
    ) {
      concludedParticipations += 1;
    }

    if (
      addParticipation(finishedByTeamId, recordsByTeamId, item.homeId, {
        providerGameId,
        kickoffMs,
        side: 'home',
      })
    ) {
      concludedParticipations += 1;
    }
  }

  const tailByTeamId = new Map<number, TailParticipation[]>();
  const tailScheduleByProviderGameId = new Map<string, ScheduleWireItem>();
  let tailParticipations = 0;

  for (const record of recordCache.items) {
    const finished = finishedByTeamId.get(record.teamId) ?? [];
    if (finished.length <= record.total.games) continue;
    finished.sort(
      (left, right) =>
        left.kickoffMs - right.kickoffMs || left.providerGameId.localeCompare(right.providerGameId)
    );
    const tail = finished.slice(record.total.games);
    tailByTeamId.set(record.teamId, tail);
    tailParticipations += tail.length;
    for (const participation of tail) {
      const scheduleItem = scheduleByProviderGameId.get(participation.providerGameId);
      if (scheduleItem) {
        tailScheduleByProviderGameId.set(participation.providerGameId, scheduleItem);
      }
    }
  }

  return {
    status: 'available',
    tailByTeamId,
    tailScheduleByProviderGameId,
    work: {
      scheduleRowsScanned: scheduleItems.length,
      concludedParticipations,
      tailGames: tailScheduleByProviderGameId.size,
      tailParticipations,
    },
  };
}

type GameOutcomes = {
  away: 'win' | 'loss' | 'tie' | null;
  home: 'win' | 'loss' | 'tie' | null;
};

const NO_OUTCOMES: GameOutcomes = { away: null, home: null };

function outcomesForTailGame(params: {
  scheduleItem: ScheduleWireItem;
  scoreFact: TeamRecordScoreFact | undefined;
  resolver: TeamIdentityResolver;
}): GameOutcomes {
  const { scheduleItem, scoreFact, resolver } = params;
  const score = scoreFact?.score;
  // Here usability has its second, narrower job: whether an already-selected
  // tail game has a result safe to fold.
  if (!score || !hasUsableFinalScore(score)) return NO_OUTCOMES;

  const orientation = validateScoreParticipantOrientation({
    scheduleHomeTeam: scheduleItem.homeTeam,
    scheduleAwayTeam: scheduleItem.awayTeam,
    scoreHomeTeam: score.home.team,
    scoreAwayTeam: score.away.team,
    resolver,
  });
  if (!orientation) return NO_OUTCOMES;

  const homeScore = orientation === 'direct' ? score.home.score : score.away.score;
  const awayScore = orientation === 'direct' ? score.away.score : score.home.score;
  if (homeScore == null || awayScore == null) return NO_OUTCOMES;
  if (homeScore === awayScore) return { away: 'tie', home: 'tie' };
  return homeScore > awayScore ? { away: 'loss', home: 'win' } : { away: 'win', home: 'loss' };
}

function applyOutcome(total: TeamRecordTotal, outcome: NonNullable<GameOutcomes['away']>): void {
  total.games += 1;
  if (outcome === 'win') total.wins += 1;
  else if (outcome === 'loss') total.losses += 1;
  else total.ties += 1;
}

/** Validate and fold only the plan's unique tail games. */
export function applyTeamRecordReconciliationPlan(params: {
  plan: AvailableTeamRecordReconciliationPlan;
  recordCache: TeamRecordsCacheRead;
  scoreFactsByProviderGameId: ReadonlyMap<string, TeamRecordScoreFact>;
  resolver: TeamIdentityResolver;
}): {
  totalsByTeamId: Map<number, TeamRecordTotal>;
  work: TeamRecordReconciliationWork;
} {
  const { plan, recordCache, scoreFactsByProviderGameId, resolver } = params;
  const outcomesByProviderGameId = new Map<string, GameOutcomes>();
  let tailScoreRowsInspected = 0;

  for (const [providerGameId, scheduleItem] of plan.tailScheduleByProviderGameId) {
    const scoreFact = scoreFactsByProviderGameId.get(providerGameId);
    if (scoreFact) tailScoreRowsInspected += 1;
    outcomesByProviderGameId.set(
      providerGameId,
      outcomesForTailGame({ scheduleItem, scoreFact, resolver })
    );
  }

  const totalsByTeamId = new Map<number, TeamRecordTotal>();
  for (const record of recordCache.items) {
    const total = { ...record.total };
    for (const participation of plan.tailByTeamId.get(record.teamId) ?? []) {
      const outcome = outcomesByProviderGameId.get(participation.providerGameId)?.[
        participation.side
      ];
      if (outcome) applyOutcome(total, outcome);
    }
    totalsByTeamId.set(record.teamId, total);
  }

  return {
    totalsByTeamId,
    work: { ...plan.work, tailScoreRowsInspected },
  };
}
