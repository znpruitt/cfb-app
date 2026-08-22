import type { CfbdSeasonType } from '@/lib/cfbd';
import { classifyScorePackStatus } from '@/lib/gameStatus';
import { mergeScoresIntoPartition, type ScoreUpdate } from '@/lib/liveScores/scoreMerge';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import { effectiveRowTimestamp, type CacheEntry } from '@/lib/scores/cache';
import { toScorePackFromCfbd } from '@/lib/scores/normalizers';
import type { CfbdGameLoose, ScorePack } from '@/lib/scores/types';
import { getAppStateEntries } from '@/lib/server/appStateStore';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '@/lib/server/providerRefreshStatus';
import { isScoresKeyForSeason } from '@/lib/server/scoreCacheReader';
import type { CfbdScheduleGame, ScheduleItem, SeasonType } from './cfbdSchedule.ts';
type SweepPartition = { week: number; seasonType: SeasonType };
export type FinalScoreDifferenceIdentity = SweepPartition & { providerGameId: string };
export type FinalScoreSweepCandidate = {
  identity: FinalScoreDifferenceIdentity;
  pack: ScorePack;
};
export type FinalScoreSweepResult = {
  repaired: number;
  differenceCount: number;
  differences: ReadonlyArray<FinalScoreDifferenceIdentity>;
  differencesTruncated: boolean;
  failedPartitions: ReadonlyArray<SweepPartition>;
  cannotTellCount: number;
};
const EMPTY_PARTITIONS = Object.freeze([]) as ReadonlyArray<SweepPartition>;
export const EMPTY_FINAL_SCORE_SWEEP_RESULT: FinalScoreSweepResult = Object.freeze({
  repaired: 0,
  differenceCount: 0,
  differences: Object.freeze([]) as ReadonlyArray<FinalScoreDifferenceIdentity>,
  differencesTruncated: false,
  failedPartitions: EMPTY_PARTITIONS,
  cannotTellCount: 0,
});
function isUsableFinal(pack: ScorePack | undefined): boolean {
  return (
    pack !== undefined &&
    classifyScorePackStatus(pack) === 'final' &&
    pack.home.score !== null &&
    pack.away.score !== null
  );
}
function normalizedFinal(row: CfbdScheduleGame, seasonType: SeasonType): ScorePack | null {
  if (!row || typeof row !== 'object') return null;
  const pack = toScorePackFromCfbd({ ...row, season_type: seasonType } as CfbdGameLoose);
  if (!pack || pack.week === null || !Number.isInteger(pack.week) || pack.week < 0) return null;
  if (!isUsableFinal(pack)) return null;
  return {
    ...pack,
    week: pack.week,
    seasonType,
    status: 'final',
    time: pack.startDate ?? pack.time,
  };
}
function candidateFor(pack: ScorePack, seasonType: SeasonType): FinalScoreSweepCandidate | null {
  const providerGameId = pack.id?.trim();
  if (!providerGameId || pack.week === null) return null;
  return {
    identity: { providerGameId, week: pack.week, seasonType },
    pack: { ...pack, id: providerGameId },
  };
}
export function finalScoreCandidateFromScheduleRow(
  row: CfbdScheduleGame,
  seasonType: SeasonType
): FinalScoreSweepCandidate | null {
  const pack = normalizedFinal(row, seasonType);
  return pack ? candidateFor(pack, seasonType) : null;
}
export function finalScoreCandidatesFromSchedulePayload(
  rows: CfbdScheduleGame[],
  seasonType: SeasonType
) {
  const byId = new Map<string, FinalScoreSweepCandidate[]>();
  const cannotTell = new Map<string, SweepPartition>();
  let cannotTellCount = 0;
  for (const row of rows) {
    const pack = normalizedFinal(row, seasonType);
    if (!pack || pack.week === null) continue;
    const candidate = candidateFor(pack, seasonType);
    if (!candidate) {
      cannotTellCount += 1;
      cannotTell.set(`${seasonType}:${pack.week}`, { week: pack.week, seasonType });
      continue;
    }
    const bucket = byId.get(candidate.identity.providerGameId);
    if (bucket) bucket.push(candidate);
    else byId.set(candidate.identity.providerGameId, [candidate]);
  }
  const candidates: FinalScoreSweepCandidate[] = [];
  const duplicates = new Map<string, SweepPartition>();
  for (const bucket of byId.values()) {
    if (bucket.length === 1) candidates.push(bucket[0]!);
    else {
      for (const { identity } of bucket) {
        duplicates.set(`${identity.seasonType}:${identity.week}`, {
          week: identity.week,
          seasonType: identity.seasonType,
        });
      }
    }
  }
  return {
    candidates,
    duplicatePartitions: [...duplicates.values()],
    cannotTellCount,
    cannotTellPartitions: [...cannotTell.values()],
  };
}
type CachedObservation = { pack: ScorePack; effectiveAt: number };
type CachedGame = { latest: CachedObservation; final?: CachedObservation };
const scoreKey = (seasonType: SeasonType, id: string): string => `${seasonType}:${id}`;
const partitionKey = (partition: SweepPartition): string =>
  `${partition.seasonType}:${partition.week}`;
const uniquePartitions = (partitions: readonly SweepPartition[]): SweepPartition[] => [
  ...new Map(
    partitions.map(({ week, seasonType }) => [`${seasonType}:${week}`, { week, seasonType }])
  ).values(),
];
async function readCachedScores(year: number) {
  const records = await getAppStateEntries<CacheEntry>('scores', `${year}-`);
  const byId = new Map<string, CachedGame>();
  const cannotTell = new Map<string, SweepPartition>();
  const cannotTellSeasonTypes = new Set<SeasonType>();
  let cannotTellCount = 0;
  for (const record of records) {
    for (const seasonType of ['regular', 'postseason'] as const) {
      if (!record.value || !isScoresKeyForSeason(record.key, year, seasonType)) continue;
      for (const pack of record.value.items) {
        const id = pack.id?.trim();
        if (isUsableFinal(pack) && !id) {
          cannotTellCount += 1;
          if (pack.week !== null && Number.isInteger(pack.week) && pack.week >= 0) {
            cannotTell.set(`${seasonType}:${pack.week}`, { week: pack.week, seasonType });
          } else cannotTellSeasonTypes.add(seasonType);
          continue;
        }
        if (!id) continue;
        const observation = { pack, effectiveAt: effectiveRowTimestamp(record.value, pack) };
        const key = scoreKey(seasonType, id);
        const prior = byId.get(key);
        const latest =
          !prior || observation.effectiveAt >= prior.latest.effectiveAt
            ? observation
            : prior.latest;
        const final =
          isUsableFinal(pack) &&
          (!prior?.final || observation.effectiveAt >= prior.final.effectiveAt)
            ? observation
            : prior?.final;
        byId.set(key, { latest, ...(final ? { final } : {}) });
      }
    }
  }
  return {
    byId,
    cannotTellCount,
    cannotTellPartitions: [...cannotTell.values()],
    cannotTellSeasonTypes,
  };
}
async function beginAttempt(
  year: number,
  partition: SweepPartition,
  observedAtMs: number
): Promise<ProviderRefreshAttempt | null> {
  try {
    return await beginProviderRefreshAttempt(
      'scores',
      weekPartitionScope(year, partition.week, partition.seasonType),
      { startedAt: new Date(observedAtMs).toISOString() }
    );
  } catch {
    return null;
  }
}
type AttemptOutcome =
  | { kind: 'success'; committed: number }
  | { kind: 'no-op' }
  | { kind: 'failure'; code: string; status: number };
async function resolveAttempt(
  year: number,
  partition: SweepPartition,
  observedAtMs: number,
  outcome: AttemptOutcome,
  priorAttempt?: ProviderRefreshAttempt | null
): Promise<void> {
  try {
    const attempt = priorAttempt ?? (await beginAttempt(year, partition, observedAtMs));
    const scope = weekPartitionScope(year, partition.week, partition.seasonType);
    const common = {
      ...(attempt ? { attempt } : {}),
      source: 'cfbd',
      durationMs: Math.max(0, Date.now() - observedAtMs),
    };
    if (outcome.kind === 'success') {
      await recordProviderRefreshSuccess('scores', scope, {
        ...common,
        committedAt: new Date().toISOString(),
        commitSeq: nextProviderCommitSeq(),
        rowsCommitted: outcome.committed,
      });
    } else if (outcome.kind === 'no-op') {
      await recordProviderRefreshNoop('scores', scope, common);
    } else {
      await recordProviderRefreshFailure('scores', scope, {
        ...common,
        error: `score sweep ${year} week ${partition.week} ${partition.seasonType} failed`,
        code: outcome.code,
        status: outcome.status,
      });
    }
  } catch {
    // Best-effort status never changes score truth.
  }
}
const scorePair = (pack: ScorePack): string => `${pack.home.score}:${pack.away.score}`;
export async function sweepMissingFinalScores(params: {
  year: number;
  candidates: FinalScoreSweepCandidate[];
  rejectedDuplicatePartitions?: ReadonlyArray<SweepPartition>;
  rejectedCannotTellPartitions?: ReadonlyArray<SweepPartition>;
  providerCannotTellCount?: number;
  observedAtMs: number;
}): Promise<FinalScoreSweepResult> {
  const { year, observedAtMs } = params;
  const duplicates = uniquePartitions(params.rejectedDuplicatePartitions ?? []);
  const providerCannotTell = uniquePartitions(params.rejectedCannotTellPartitions ?? []);
  const providerCannotTellCount = params.providerCannotTellCount ?? 0;
  if (params.candidates.length === 0 && duplicates.length === 0 && providerCannotTellCount === 0) {
    return EMPTY_FINAL_SCORE_SWEEP_RESULT;
  }
  let cached: Awaited<ReturnType<typeof readCachedScores>>;
  try {
    cached = await readCachedScores(year);
  } catch {
    const failedPartitions = uniquePartitions([
      ...duplicates,
      ...providerCannotTell,
      ...params.candidates.map(({ identity }) => identity),
    ]);
    const duplicateKeys = new Set(duplicates.map(partitionKey));
    const cannotTellKeys = new Set(providerCannotTell.map(partitionKey));
    await Promise.all(
      failedPartitions.map((partition) => {
        const key = partitionKey(partition);
        const ambiguous = duplicateKeys.has(key) || cannotTellKeys.has(key);
        return resolveAttempt(year, partition, observedAtMs, {
          kind: 'failure',
          code: duplicateKeys.has(key)
            ? 'score-sweep-duplicate-provider-id'
            : cannotTellKeys.has(key)
              ? 'score-sweep-missing-provider-id'
              : 'score-sweep-cache-unavailable',
          status: ambiguous ? 502 : 503,
        });
      })
    );
    return {
      ...EMPTY_FINAL_SCORE_SWEEP_RESULT,
      failedPartitions,
      cannotTellCount: providerCannotTellCount,
    };
  }
  const observed = uniquePartitions(params.candidates.map(({ identity }) => identity));
  const cannotTell = uniquePartitions([
    ...providerCannotTell,
    ...cached.cannotTellPartitions,
    ...observed.filter(({ seasonType }) => cached.cannotTellSeasonTypes.has(seasonType)),
  ]);
  const duplicateKeys = new Set(duplicates.map(partitionKey));
  const blocked = uniquePartitions([...duplicates, ...cannotTell]);
  const blockedKeys = new Set(blocked.map(partitionKey));
  await Promise.all(
    blocked.map((partition) =>
      resolveAttempt(year, partition, observedAtMs, {
        kind: 'failure',
        code: duplicateKeys.has(partitionKey(partition))
          ? 'score-sweep-duplicate-provider-id'
          : 'score-sweep-missing-provider-id',
        status: 502,
      })
    )
  );
  const plans = new Map<string, SweepPartition & { updates: ScoreUpdate[] }>();
  for (const partition of observed) {
    if (!blockedKeys.has(partitionKey(partition))) {
      plans.set(partitionKey(partition), { ...partition, updates: [] });
    }
  }
  const differences: FinalScoreDifferenceIdentity[] = [];
  let differenceCount = 0;
  for (const candidate of params.candidates) {
    const { providerGameId, seasonType } = candidate.identity;
    const key = partitionKey(candidate.identity);
    if (blockedKeys.has(key)) continue;
    const cachedGame = cached.byId.get(scoreKey(seasonType, providerGameId));
    if (cachedGame?.final) {
      if (scorePair(cachedGame.final.pack) !== scorePair(candidate.pack)) {
        differenceCount += 1;
        if (differences.length < 25) {
          differences.push(candidate.identity);
        }
      }
      continue;
    }
    plans.get(key)!.updates.push({
      pack: candidate.pack,
      provisionalFinal: false,
      baseline: cachedGame?.latest.pack ?? null,
      baselineAt: cachedGame?.latest.effectiveAt ?? null,
    });
  }
  let repaired = 0;
  const failedPartitions = [...blocked];
  const orderedPlans = [...plans.values()].sort(
    (a, b) =>
      a.week - b.week || (a.seasonType === b.seasonType ? 0 : a.seasonType === 'regular' ? -1 : 1)
  );
  for (const plan of orderedPlans) {
    const attempt = await beginAttempt(year, plan, observedAtMs);
    if (plan.updates.length === 0) {
      await resolveAttempt(year, plan, observedAtMs, { kind: 'no-op' }, attempt);
      continue;
    }
    try {
      const merged = await mergeScoresIntoPartition({
        year,
        week: plan.week,
        seasonType: plan.seasonType as CfbdSeasonType,
        updates: plan.updates,
        onlyIfMissingUsableFinal: true,
        now: observedAtMs,
      });
      repaired += merged.committed;
      await resolveAttempt(
        year,
        plan,
        observedAtMs,
        merged.wrote ? { kind: 'success', committed: merged.committed } : { kind: 'no-op' },
        attempt
      );
    } catch {
      failedPartitions.push({ week: plan.week, seasonType: plan.seasonType });
      await resolveAttempt(
        year,
        plan,
        observedAtMs,
        {
          kind: 'failure',
          code: 'score-sweep-durable-commit-failed',
          status: 500,
        },
        attempt
      );
    }
  }
  return {
    repaired,
    differenceCount,
    differences,
    differencesTruncated: differenceCount > differences.length,
    failedPartitions,
    cannotTellCount: providerCannotTellCount + cached.cannotTellCount,
  };
}
function scheduleIdentity(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const candidate = item as Partial<ScheduleItem>;
  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) return null;
  const seasonType = candidate.seasonType === 'postseason' ? 'postseason' : 'regular';
  return `${seasonType}:${candidate.id.trim()}`;
}
function sameKickoff(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a !== null && typeof a !== 'string') || (b !== null && typeof b !== 'string')) return true;
  if (a === null || b === null) return false;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  return Number.isFinite(aMs) && Number.isFinite(bMs) ? aMs === bMs : a.trim() === b.trim();
}
export function countChangedKickoffs(
  prior: readonly unknown[],
  next: readonly ScheduleItem[]
): number {
  const priorByIdentity = new Map<string, unknown>();
  for (const item of prior) {
    const identity = scheduleIdentity(item);
    if (identity) priorByIdentity.set(identity, item);
  }
  let changed = 0;
  for (const item of next) {
    const identity = scheduleIdentity(item);
    if (!identity) continue;
    const previous = priorByIdentity.get(identity);
    const previousStart =
      previous && typeof previous === 'object'
        ? (previous as { startDate?: unknown }).startDate
        : undefined;
    if (previous && !sameKickoff(previousStart, item.startDate)) changed += 1;
  }
  return changed;
}
