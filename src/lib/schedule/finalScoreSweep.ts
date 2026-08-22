import type { CfbdSeasonType } from '@/lib/cfbd';
import { classifyScorePackStatus } from '@/lib/gameStatus';
import { mergeScoresIntoPartition, type ScoreUpdate } from '@/lib/liveScores/scoreMerge';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import { effectiveRowTimestamp, type CacheEntry } from '@/lib/scores/cache';
import { toScorePackFromCfbd } from '@/lib/scores/normalizers';
import type { CfbdGameLoose, ScorePack } from '@/lib/scores/types';
import { getAppStateEntries } from '@/lib/server/appStateStore';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '@/lib/server/providerRefreshStatus';
import { isScoresKeyForSeason, scoreIdentityKey } from '@/lib/server/scoreCacheReader';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import {
  createTeamIdentityResolver,
  resolveTeamIdentityKey,
  type TeamIdentityResolver,
} from '@/lib/teamIdentity';

import type { CfbdScheduleGame, ScheduleItem, SeasonType } from './cfbdSchedule.ts';

/** Keep one cron event bounded even if CFBD revises a large historical slate. */
export const MAX_REPORTED_SCORE_DIFFERENCES = 25;

export type FinalScoreDifferenceIdentity = {
  providerGameId: string;
  week: number;
  seasonType: SeasonType;
};

export type FinalScoreSweepCandidate = {
  identity: FinalScoreDifferenceIdentity;
  pack: ScorePack;
};

export type FinalScoreSweepResult = {
  repaired: number;
  differenceCount: number;
  differences: ReadonlyArray<FinalScoreDifferenceIdentity>;
  differencesTruncated: boolean;
  failedPartitions: ReadonlyArray<{ week: number; seasonType: SeasonType }>;
};

const EMPTY_SCORE_DIFFERENCES = Object.freeze([]) as ReadonlyArray<FinalScoreDifferenceIdentity>;
const EMPTY_SCORE_PARTITIONS = Object.freeze([]) as ReadonlyArray<{
  week: number;
  seasonType: SeasonType;
}>;

export const EMPTY_FINAL_SCORE_SWEEP_RESULT: FinalScoreSweepResult = Object.freeze({
  repaired: 0,
  differenceCount: 0,
  differences: EMPTY_SCORE_DIFFERENCES,
  differencesTruncated: false,
  failedPartitions: EMPTY_SCORE_PARTITIONS,
});

export type FinalScoreCandidateExtraction = {
  candidates: FinalScoreSweepCandidate[];
  /** Provider-week partitions rejected because one id named multiple final rows. */
  duplicatePartitions: Array<{ week: number; seasonType: SeasonType }>;
};

function isUsableFinal(pack: ScorePack | undefined): boolean {
  return (
    pack !== undefined &&
    classifyScorePackStatus(pack) === 'final' &&
    pack.home.score !== null &&
    pack.away.score !== null
  );
}

/**
 * Extract one complete final from a raw CFBD `/games` row. ScheduleItem remains
 * score-free: the points cross this wire-only seam directly into the score
 * authority and are never added to the durable schedule shape.
 */
export function finalScoreCandidateFromScheduleRow(
  row: CfbdScheduleGame,
  seasonType: SeasonType
): FinalScoreSweepCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const pack = toScorePackFromCfbd({ ...row, season_type: seasonType } as CfbdGameLoose);
  const providerGameId = pack?.id?.trim();
  if (
    !pack ||
    !providerGameId ||
    pack.week === null ||
    !Number.isInteger(pack.week) ||
    pack.week < 0 ||
    !isUsableFinal(pack)
  ) {
    return null;
  }

  return {
    identity: { providerGameId, week: pack.week, seasonType },
    pack: {
      ...pack,
      id: providerGameId,
      week: pack.week,
      seasonType,
      status: 'final',
      time: pack.startDate ?? pack.time,
    },
  };
}

/**
 * Normalize a partition's final-score candidates. Duplicate provider ids are
 * rejected rather than applied in response order: one durable update must name
 * one unambiguous provider game.
 */
export function finalScoreCandidatesFromSchedulePayload(
  rows: CfbdScheduleGame[],
  seasonType: SeasonType
): FinalScoreCandidateExtraction {
  const byId = new Map<string, FinalScoreSweepCandidate[]>();
  for (const row of rows) {
    const candidate = finalScoreCandidateFromScheduleRow(row, seasonType);
    if (!candidate) continue;
    const bucket = byId.get(candidate.identity.providerGameId);
    if (bucket) bucket.push(candidate);
    else byId.set(candidate.identity.providerGameId, [candidate]);
  }
  const candidates: FinalScoreSweepCandidate[] = [];
  const duplicatePartitions = new Map<string, { week: number; seasonType: SeasonType }>();
  for (const bucket of byId.values()) {
    if (bucket.length === 1) {
      candidates.push(bucket[0]!);
      continue;
    }
    for (const candidate of bucket) {
      const partition = candidate.identity;
      duplicatePartitions.set(`${partition.seasonType}:${partition.week}`, {
        week: partition.week,
        seasonType: partition.seasonType,
      });
    }
  }
  return { candidates, duplicatePartitions: [...duplicatePartitions.values()] };
}

type CachedScore = { pack: ScorePack; effectiveAt: number };

function scoreKey(seasonType: SeasonType, providerGameId: string): string {
  return `${seasonType}:${providerGameId}`;
}

function scoresDiffer(a: ScorePack, b: ScorePack, resolver: TeamIdentityResolver): boolean {
  const aHome = resolveTeamIdentityKey(resolver, a.home.team);
  const aAway = resolveTeamIdentityKey(resolver, a.away.team);
  const bHome = resolveTeamIdentityKey(resolver, b.home.team);
  const bAway = resolveTeamIdentityKey(resolver, b.away.team);
  if (aHome && aAway && aHome === bAway && aAway === bHome) {
    return a.home.score !== b.away.score || a.away.score !== b.home.score;
  }
  return a.home.score !== b.home.score || a.away.score !== b.away.score;
}

async function readCachedScores(
  year: number,
  candidates: readonly FinalScoreSweepCandidate[]
): Promise<{
  freshest: Map<string, CachedScore>;
  finalsByProviderId: Map<string, CachedScore>;
  finalsByCanonicalIdentity: Map<string, CachedScore>;
  resolver: TeamIdentityResolver;
}> {
  const [records, teams, aliasMap] = await Promise.all([
    getAppStateEntries<CacheEntry>('scores', `${year}-`),
    getTeamDatabaseItems(),
    getScopedAliasMap('', year),
  ]);
  if (teams.length === 0) throw new Error('score sweep canonical team catalog unavailable');

  const observedNames = new Set<string>();
  for (const candidate of candidates) {
    observedNames.add(candidate.pack.home.team);
    observedNames.add(candidate.pack.away.team);
  }
  for (const record of records) {
    for (const item of record.value?.items ?? []) {
      observedNames.add(item.home.team);
      observedNames.add(item.away.team);
    }
  }
  const resolver = createTeamIdentityResolver({
    teams,
    aliasMap,
    observedNames: [...observedNames],
  });
  const freshest = new Map<string, CachedScore>();
  const finalsByProviderId = new Map<string, CachedScore>();
  const finalsByCanonicalIdentity = new Map<string, CachedScore>();

  for (const record of records) {
    for (const seasonType of ['regular', 'postseason'] as const) {
      if (!record.value || !isScoresKeyForSeason(record.key, year, seasonType)) continue;
      for (const pack of record.value.items) {
        const providerGameId = pack.id?.trim();
        const cached = { pack, effectiveAt: effectiveRowTimestamp(record.value, pack) };
        if (providerGameId) {
          const key = scoreKey(seasonType, providerGameId);
          const prior = freshest.get(key);
          if (!prior || cached.effectiveAt >= prior.effectiveAt) freshest.set(key, cached);
        }
        if (isUsableFinal(pack)) {
          if (providerGameId) {
            const providerKey = scoreKey(seasonType, providerGameId);
            const priorFinal = finalsByProviderId.get(providerKey);
            if (!priorFinal || cached.effectiveAt >= priorFinal.effectiveAt) {
              finalsByProviderId.set(providerKey, cached);
            }
          }
          const canonicalKey = `${seasonType}:${scoreIdentityKey(resolver, pack)}`;
          const priorCanonical = finalsByCanonicalIdentity.get(canonicalKey);
          if (!priorCanonical || cached.effectiveAt >= priorCanonical.effectiveAt) {
            finalsByCanonicalIdentity.set(canonicalKey, cached);
          }
        }
      }
    }
  }

  return { freshest, finalsByProviderId, finalsByCanonicalIdentity, resolver };
}

type SweepPartition = { week: number; seasonType: SeasonType };

function partitionKey(partition: SweepPartition): string {
  return `${partition.seasonType}:${partition.week}`;
}

function uniquePartitions(partitions: readonly SweepPartition[]): SweepPartition[] {
  return [...new Map(partitions.map((partition) => [partitionKey(partition), partition])).values()];
}

async function beginScoreSweepAttempt(
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

async function recordScoreSweepFailure(params: {
  year: number;
  partition: SweepPartition;
  observedAtMs: number;
  attempt?: ProviderRefreshAttempt | null;
  code: string;
  status: number;
}): Promise<void> {
  try {
    const attempt =
      params.attempt ??
      (await beginScoreSweepAttempt(params.year, params.partition, params.observedAtMs));
    await recordProviderRefreshFailure(
      'scores',
      weekPartitionScope(params.year, params.partition.week, params.partition.seasonType),
      {
        ...(attempt ? { attempt } : {}),
        error: `score sweep ${params.year} week ${params.partition.week} ${params.partition.seasonType} failed`,
        code: params.code,
        status: params.status,
        durationMs: Math.max(0, Date.now() - params.observedAtMs),
      }
    );
  } catch {
    // Provider-refresh status is best-effort and never changes score truth.
  }
}

async function recordScoreSweepCompletion(params: {
  year: number;
  partition: SweepPartition;
  observedAtMs: number;
  attempt: ProviderRefreshAttempt | null;
  committed: number;
  wrote: boolean;
}): Promise<void> {
  try {
    const scope = weekPartitionScope(
      params.year,
      params.partition.week,
      params.partition.seasonType
    );
    const common = {
      ...(params.attempt ? { attempt: params.attempt } : {}),
      source: 'cfbd',
      durationMs: Math.max(0, Date.now() - params.observedAtMs),
    };
    if (params.wrote) {
      await recordProviderRefreshSuccess('scores', scope, {
        ...common,
        committedAt: new Date().toISOString(),
        commitSeq: nextProviderCommitSeq(),
        rowsCommitted: params.committed,
      });
    } else {
      await recordProviderRefreshNoop('scores', scope, common);
    }
  } catch {
    // Provider-refresh status is best-effort and never changes score truth.
  }
}

/**
 * Fill only finals missing from the durable score cache, grouped by provider
 * week + season type. Existing finals are never handed to the ordinary merge;
 * their differing scores are reported instead. The writer repeats the guard
 * transaction-fresh to close the live-writer race between this scan and commit.
 */
export async function sweepMissingFinalScores(params: {
  year: number;
  candidates: FinalScoreSweepCandidate[];
  rejectedDuplicatePartitions?: ReadonlyArray<SweepPartition>;
  observedAtMs: number;
}): Promise<FinalScoreSweepResult> {
  const { year, observedAtMs } = params;
  const duplicatePartitions = uniquePartitions(params.rejectedDuplicatePartitions ?? []);
  if (params.candidates.length === 0 && duplicatePartitions.length === 0) {
    return EMPTY_FINAL_SCORE_SWEEP_RESULT;
  }

  for (const partition of duplicatePartitions) {
    await recordScoreSweepFailure({
      year,
      partition,
      observedAtMs,
      code: 'score-sweep-duplicate-provider-id',
      status: 502,
    });
  }

  let cached: Awaited<ReturnType<typeof readCachedScores>>;
  try {
    cached = await readCachedScores(year, params.candidates);
  } catch {
    const failedPartitions = uniquePartitions([
      ...duplicatePartitions,
      ...params.candidates.map((candidate) => candidate.identity),
    ]);
    for (const partition of failedPartitions) {
      if (
        duplicatePartitions.some((duplicate) => partitionKey(duplicate) === partitionKey(partition))
      ) {
        continue;
      }
      await recordScoreSweepFailure({
        year,
        partition,
        observedAtMs,
        code: 'score-sweep-cache-or-identity-unavailable',
        status: 503,
      });
    }
    return {
      ...EMPTY_FINAL_SCORE_SWEEP_RESULT,
      failedPartitions,
    };
  }

  const differences: FinalScoreDifferenceIdentity[] = [];
  let differenceCount = 0;
  const updatesByPartition = new Map<
    string,
    { week: number; seasonType: SeasonType; updates: ScoreUpdate[] }
  >();
  const blockedPartitions = new Set(duplicatePartitions.map(partitionKey));

  for (const candidate of params.candidates) {
    const { providerGameId, week, seasonType } = candidate.identity;
    if (blockedPartitions.has(partitionKey(candidate.identity))) continue;
    const key = scoreKey(seasonType, providerGameId);
    const existingFinal =
      cached.finalsByProviderId.get(key) ??
      cached.finalsByCanonicalIdentity.get(
        `${seasonType}:${scoreIdentityKey(cached.resolver, candidate.pack)}`
      );
    if (existingFinal) {
      if (scoresDiffer(existingFinal.pack, candidate.pack, cached.resolver)) {
        differenceCount += 1;
        if (differences.length < MAX_REPORTED_SCORE_DIFFERENCES) {
          differences.push(candidate.identity);
        }
      }
      continue;
    }

    const baseline = cached.freshest.get(key);
    const partitionId = `${seasonType}:${week}`;
    const partition = updatesByPartition.get(partitionId) ?? {
      week,
      seasonType,
      updates: [],
    };
    partition.updates.push({
      pack: candidate.pack,
      provisionalFinal: false,
      baseline: baseline?.pack ?? null,
      baselineAt: baseline?.effectiveAt ?? null,
    });
    updatesByPartition.set(partitionId, partition);
  }

  let repaired = 0;
  const failedPartitions: SweepPartition[] = [...duplicatePartitions];
  const partitions = [...updatesByPartition.values()].sort(
    (a, b) =>
      a.week - b.week || (a.seasonType === b.seasonType ? 0 : a.seasonType === 'regular' ? -1 : 1)
  );
  for (const partition of partitions) {
    const attempt = await beginScoreSweepAttempt(year, partition, observedAtMs);
    try {
      const merged = await mergeScoresIntoPartition({
        year,
        week: partition.week,
        seasonType: partition.seasonType as CfbdSeasonType,
        updates: partition.updates,
        onlyIfMissingUsableFinal: true,
        now: observedAtMs,
      });
      repaired += merged.committed;
      await recordScoreSweepCompletion({
        year,
        partition,
        observedAtMs,
        attempt,
        committed: merged.committed,
        wrote: merged.wrote,
      });
    } catch {
      failedPartitions.push({ week: partition.week, seasonType: partition.seasonType });
      await recordScoreSweepFailure({
        year,
        partition,
        observedAtMs,
        attempt,
        code: 'score-sweep-durable-commit-failed',
        status: 500,
      });
    }
  }

  return {
    repaired,
    differenceCount,
    differences,
    differencesTruncated: differenceCount > differences.length,
    failedPartitions,
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
  // Malformed durable JSON cannot prove that a kickoff changed. Treat the
  // measurement as unavailable for this row rather than throwing or guessing.
  if ((a !== null && typeof a !== 'string') || (b !== null && typeof b !== 'string')) return true;
  if (a === null || b === null) return false;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  return Number.isFinite(aMs) && Number.isFinite(bMs) ? aMs === bMs : a.trim() === b.trim();
}

/** Count changed kickoff instants for games present in both schedule observations. */
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
