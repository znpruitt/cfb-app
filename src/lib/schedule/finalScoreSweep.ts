import type { CfbdSeasonType } from '@/lib/cfbd';
import { classifyScorePackStatus } from '@/lib/gameStatus';
import { mergeScoresIntoPartition, type ScoreUpdate } from '@/lib/liveScores/scoreMerge';
import { effectiveRowTimestamp, type CacheEntry } from '@/lib/scores/cache';
import { toScorePackFromCfbd } from '@/lib/scores/normalizers';
import type { CfbdGameLoose, ScorePack } from '@/lib/scores/types';
import { getAppStateEntries } from '@/lib/server/appStateStore';
import { isScoresKeyForSeason } from '@/lib/server/scoreCacheReader';

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
  differences: FinalScoreDifferenceIdentity[];
  differencesTruncated: boolean;
  failedPartitions: Array<{ week: number; seasonType: SeasonType }>;
};

export const EMPTY_FINAL_SCORE_SWEEP_RESULT: FinalScoreSweepResult = {
  repaired: 0,
  differenceCount: 0,
  differences: [],
  differencesTruncated: false,
  failedPartitions: [],
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
): FinalScoreSweepCandidate[] {
  const byId = new Map<string, FinalScoreSweepCandidate[]>();
  for (const row of rows) {
    const candidate = finalScoreCandidateFromScheduleRow(row, seasonType);
    if (!candidate) continue;
    const bucket = byId.get(candidate.identity.providerGameId);
    if (bucket) bucket.push(candidate);
    else byId.set(candidate.identity.providerGameId, [candidate]);
  }
  return [...byId.values()].flatMap((bucket) => (bucket.length === 1 ? bucket : []));
}

type CachedScore = { pack: ScorePack; effectiveAt: number };

function scoreKey(seasonType: SeasonType, providerGameId: string): string {
  return `${seasonType}:${providerGameId}`;
}

function scoresDiffer(a: ScorePack, b: ScorePack): boolean {
  return a.home.score !== b.home.score || a.away.score !== b.away.score;
}

async function readCachedScoresByProviderId(year: number): Promise<{
  freshest: Map<string, CachedScore>;
  finals: Map<string, CachedScore>;
}> {
  const records = await getAppStateEntries<CacheEntry>('scores', `${year}-`);
  const freshest = new Map<string, CachedScore>();
  const finals = new Map<string, CachedScore>();

  for (const record of records) {
    for (const seasonType of ['regular', 'postseason'] as const) {
      if (!record.value || !isScoresKeyForSeason(record.key, year, seasonType)) continue;
      for (const pack of record.value.items) {
        const providerGameId = pack.id?.trim();
        if (!providerGameId) continue;
        const key = scoreKey(seasonType, providerGameId);
        const cached = { pack, effectiveAt: effectiveRowTimestamp(record.value, pack) };
        const prior = freshest.get(key);
        if (!prior || cached.effectiveAt >= prior.effectiveAt) freshest.set(key, cached);
        if (isUsableFinal(pack)) {
          const priorFinal = finals.get(key);
          if (!priorFinal || cached.effectiveAt >= priorFinal.effectiveAt) finals.set(key, cached);
        }
      }
    }
  }

  return { freshest, finals };
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
  observedAtMs: number;
}): Promise<FinalScoreSweepResult> {
  const { year, observedAtMs } = params;
  if (params.candidates.length === 0) return EMPTY_FINAL_SCORE_SWEEP_RESULT;

  let cached: Awaited<ReturnType<typeof readCachedScoresByProviderId>>;
  try {
    cached = await readCachedScoresByProviderId(year);
  } catch {
    return {
      ...EMPTY_FINAL_SCORE_SWEEP_RESULT,
      failedPartitions: Array.from(
        new Map(
          params.candidates.map((candidate) => [
            `${candidate.identity.seasonType}:${candidate.identity.week}`,
            {
              week: candidate.identity.week,
              seasonType: candidate.identity.seasonType,
            },
          ])
        ).values()
      ),
    };
  }

  const differences: FinalScoreDifferenceIdentity[] = [];
  let differenceCount = 0;
  const updatesByPartition = new Map<
    string,
    { week: number; seasonType: SeasonType; updates: ScoreUpdate[] }
  >();

  for (const candidate of params.candidates) {
    const { providerGameId, week, seasonType } = candidate.identity;
    const key = scoreKey(seasonType, providerGameId);
    const existingFinal = cached.finals.get(key);
    if (existingFinal) {
      if (scoresDiffer(existingFinal.pack, candidate.pack)) {
        differenceCount += 1;
        if (differences.length < MAX_REPORTED_SCORE_DIFFERENCES) {
          differences.push(candidate.identity);
        }
      }
      continue;
    }

    const baseline = cached.freshest.get(key);
    const partitionKey = `${seasonType}:${week}`;
    const partition = updatesByPartition.get(partitionKey) ?? {
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
    updatesByPartition.set(partitionKey, partition);
  }

  let repaired = 0;
  const failedPartitions: FinalScoreSweepResult['failedPartitions'] = [];
  const partitions = [...updatesByPartition.values()].sort(
    (a, b) =>
      a.week - b.week || (a.seasonType === b.seasonType ? 0 : a.seasonType === 'regular' ? -1 : 1)
  );
  for (const partition of partitions) {
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
    } catch {
      failedPartitions.push({ week: partition.week, seasonType: partition.seasonType });
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

function scheduleIdentity(item: ScheduleItem): string {
  return `${item.seasonType ?? 'regular'}:${item.id}`;
}

function sameKickoff(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  return Number.isFinite(aMs) && Number.isFinite(bMs) ? aMs === bMs : a.trim() === b.trim();
}

/** Count changed kickoff instants for games present in both schedule observations. */
export function countChangedKickoffs(prior: ScheduleItem[], next: ScheduleItem[]): number {
  const priorByIdentity = new Map(prior.map((item) => [scheduleIdentity(item), item]));
  let changed = 0;
  for (const item of next) {
    const previous = priorByIdentity.get(scheduleIdentity(item));
    if (previous && !sameKickoff(previous.startDate, item.startDate)) changed += 1;
  }
  return changed;
}
