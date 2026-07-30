import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
import { scoresAggregateScope } from '@/lib/providerRefreshScope';
import type { CacheEntry, CacheKey } from '@/lib/scores/cache';
import {
  classifyEmptyScoresResponse,
  type ScheduleScoreEvidenceItem,
} from '@/lib/scores/emptyScoresClassifier';
import {
  classifyHistoricalScoreWrites,
  HISTORICAL_REPAIR_SEASON_TYPES,
} from '@/lib/scores/historicalScoreWrites';
import { seasonYearForToday, toScorePackFromCfbd } from '@/lib/scores/normalizers';
import type { CfbdGameLoose, ScorePack, SeasonType } from '@/lib/scores/types';

export const dynamic = 'force-dynamic';

const CFBD_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;

const CFBD_PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

const REPAIR_SEASON_TYPES = HISTORICAL_REPAIR_SEASON_TYPES;

async function fetchScoreItems(
  year: number,
  seasonType: SeasonType,
  cfbdApiKey: string
): Promise<ScorePack[]> {
  const cfbdUrl = buildCfbdGamesUrl({ year, seasonType, week: null });
  const rawGames = await fetchUpstreamJson<CfbdGameLoose[]>(cfbdUrl.toString(), {
    cache: 'no-store',
    timeoutMs: 12_000,
    headers: { Authorization: `Bearer ${cfbdApiKey}` },
    retry: CFBD_RETRY_POLICY,
    pacing: CFBD_PACING_POLICY,
  });

  const items: ScorePack[] = [];
  for (const game of rawGames) {
    const pack = toScorePackFromCfbd(game);
    if (pack) items.push(pack);
  }
  return items;
}

/** Loose historical-schedule-cache rows → the classifier's evidence slice. */
function toScheduleEvidence(raw: unknown): ScheduleScoreEvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>;
    return [
      {
        week: typeof o.week === 'number' ? o.week : -1,
        seasonType: typeof o.seasonType === 'string' ? o.seasonType : null,
        startDate: typeof o.startDate === 'string' ? o.startDate : null,
        status: typeof o.status === 'string' ? o.status : null,
      },
    ];
  });
}

// PLATFORM-086F2C — this manual recovery route now records ONE truthful,
// year-scoped `provider-refresh-status` attempt whenever provider work is
// required (the always-both-partitions repair resolves to the exact year
// rollup via `scoresAggregateScope`). Auth failures, invalid requests,
// protected active years, and already-cached short-circuits fabricate no
// attempt. Status recording is best-effort and never replaces the route's
// provider/cache outcome; no raw provider bodies, credential-bearing URLs, or
// thrown storage errors are stored.
export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const { year, force } = body as { year?: unknown; force?: unknown };

  if (
    typeof year !== 'number' ||
    !Number.isFinite(year) ||
    !Number.isInteger(year) ||
    year < 2000
  ) {
    return NextResponse.json(
      { error: 'year must be a finite integer >= 2000', field: 'year' },
      { status: 400 }
    );
  }

  const activeSeason = seasonYearForToday();
  if (year === activeSeason) {
    return NextResponse.json(
      {
        error: `year ${year} is the active season — use the existing scores route to refresh active season cache`,
        field: 'year',
      },
      { status: 400 }
    );
  }

  const regularKey = `${year}-all-regular` as CacheKey;
  const postseasonKey = `${year}-all-postseason` as CacheKey;

  if (!force) {
    const [existingRegular, existingPostseason] = await Promise.all([
      getAppState<CacheEntry>('scores', regularKey),
      getAppState<CacheEntry>('scores', postseasonKey),
    ]);
    if (existingRegular && existingPostseason) {
      return NextResponse.json({ alreadyCached: true, year });
    }
  }

  // Provider work is required from here on — begin the ONE scoped attempt
  // BEFORE credential validation so a missing-key exit is a visible failure.
  // The repair always targets both complete historical partitions, so the
  // scope resolves to the exact year rollup.
  const startedMs = Date.now();
  const scope = scoresAggregateScope(year, ['regular', 'postseason'], ['regular', 'postseason']);
  const attempt = await beginProviderRefreshAttempt('scores', scope, {
    startedAt: new Date(startedMs).toISOString(),
  });

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    await recordProviderRefreshFailure('scores', scope, {
      attempt,
      error: 'CFBD_API_KEY missing',
      code: 'cfbd-api-key-missing',
      status: 502,
      failedPartitions: [...REPAIR_SEASON_TYPES],
      durationMs: Date.now() - startedMs,
    });
    return NextResponse.json({ error: 'CFBD_API_KEY missing' }, { status: 502 });
  }

  const fetchResults = await Promise.allSettled(
    REPAIR_SEASON_TYPES.map((seasonType) => fetchScoreItems(year, seasonType, cfbdApiKey))
  );
  const fetchFailures = REPAIR_SEASON_TYPES.filter(
    (_, i) => fetchResults[i]!.status === 'rejected'
  );

  if (fetchFailures.length > 0) {
    const firstErr = fetchResults.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    )!.reason;
    // Status storage stays sanitized: a stable generic code + partition list —
    // never provider bodies, URLs, or stack traces.
    await recordProviderRefreshFailure('scores', scope, {
      attempt,
      error: `historical score fetch failed for partition(s): ${fetchFailures.join(', ')}`,
      code: 'cfbd-fetch-failed',
      status: firstErr instanceof UpstreamFetchError ? (firstErr.details.status ?? 502) : 502,
      failedPartitions: [...fetchFailures],
      durationMs: Date.now() - startedMs,
    });
    // Response shape preserved from the pre-F2C route.
    if (firstErr instanceof UpstreamFetchError) {
      return NextResponse.json(
        { error: 'CFBD API error', detail: firstErr.details },
        { status: firstErr.details.status ?? 502 }
      );
    }
    return NextResponse.json(
      {
        error:
          firstErr instanceof Error ? firstErr.message : 'unknown error fetching scores from CFBD',
      },
      { status: 502 }
    );
  }

  const regularItems = (fetchResults[0] as PromiseFulfilledResult<ScorePack[]>).value;
  const postseasonItems = (fetchResults[1] as PromiseFulfilledResult<ScorePack[]>).value;
  const itemsByPartition: Record<SeasonType, ScorePack[]> = {
    regular: regularItems,
    postseason: postseasonItems,
  };
  const keysByPartition: Record<SeasonType, CacheKey> = {
    regular: regularKey,
    postseason: postseasonKey,
  };

  // An empty CFBD partition is NOT automatically a valid result (Codex review;
  // shared scores empty policy — PLATFORM-086G1 finding #6): classify BEFORE any
  // durable write against target-scoped evidence (prior-good durable rows for
  // the exact key, or started non-disrupted games in the cached schedule). An
  // unexpected empty is a provider FAILURE that writes nothing — prior-good
  // historical rows are never replaced by an empty payload — and a genuinely
  // absent target resolves as a NO-OP with no empty commit.
  const emptyPartitions = REPAIR_SEASON_TYPES.filter(
    (seasonType) => itemsByPartition[seasonType].length === 0
  );
  if (emptyPartitions.length > 0) {
    const [scheduleRecord, priorRegular, priorPostseason] = await Promise.all([
      getAppState<{ items?: unknown[] }>('schedule', `${year}-all-all`),
      getAppState<CacheEntry>('scores', regularKey),
      getAppState<CacheEntry>('scores', postseasonKey),
    ]);
    const scheduleItems = toScheduleEvidence(scheduleRecord?.value?.items);
    const priorRowsByPartition: Record<SeasonType, number> = {
      regular: priorRegular?.value?.items?.length ?? 0,
      postseason: priorPostseason?.value?.items?.length ?? 0,
    };
    const nowMs = Date.now();
    const rejectedPartitions = emptyPartitions.filter(
      (seasonType) =>
        classifyEmptyScoresResponse({
          priorGoodRowCount: priorRowsByPartition[seasonType],
          scheduleItems,
          seasonType,
          week: null,
          now: nowMs,
        }).kind === 'unexpected-empty'
    );
    if (rejectedPartitions.length > 0) {
      await recordProviderRefreshFailure('scores', scope, {
        attempt,
        error: `CFBD returned 0 rows but score rows are expected for partition(s): ${rejectedPartitions.join(', ')}; prior-good data retained`,
        code: 'cfbd-empty-unexpected',
        status: 502,
        failedPartitions: [...rejectedPartitions],
        durationMs: Date.now() - startedMs,
      });
      return NextResponse.json(
        {
          error: `CFBD returned 0 score rows but rows are expected for partition(s): ${rejectedPartitions.join(', ')} — prior cached rows retained`,
        },
        { status: 502 }
      );
    }
  }

  // Only nonempty partitions are written — a valid-absence empty is never a
  // durable empty commit (it would silently replace or poison the key).
  const writePartitions = REPAIR_SEASON_TYPES.filter(
    (seasonType) => itemsByPartition[seasonType].length > 0
  );

  if (writePartitions.length === 0) {
    // Every partition is a genuinely absent target: a valid no-op — resolves
    // the attempt without advancing last-success and writes nothing.
    await recordProviderRefreshNoop('scores', scope, {
      attempt,
      source: 'cfbd',
      durationMs: Date.now() - startedMs,
    });
    return NextResponse.json({ success: true, year, scoreCount: 0, noOp: true });
  }

  const now = Date.now();

  const writeResults = await Promise.allSettled(
    writePartitions.map((seasonType) =>
      setAppState<CacheEntry>('scores', keysByPartition[seasonType], {
        at: now,
        items: itemsByPartition[seasonType],
        source: 'cfbd',
        cfbdFallbackReason: 'none',
      })
    )
  );
  // Capture the confirmed commit time + sequence immediately after the writes.
  const committedAt = new Date().toISOString();
  const commitSeq = nextProviderCommitSeq();

  const writes = classifyHistoricalScoreWrites(writePartitions, writeResults);

  if (!writes.allOk) {
    // A durable-write failure NEVER records success or advances last-success;
    // a lone committed sibling is a truthful partial failure.
    await recordProviderRefreshFailure('scores', scope, {
      attempt,
      error: `historical score cache write failed for partition(s): ${writes.failedPartitions.join(', ')}`,
      code: 'durable-write-failed',
      status: 500,
      partialFailure: writes.partialFailure,
      failedPartitions: writes.failedPartitions,
      durationMs: Date.now() - startedMs,
    });
    // Previously an uncaught throw; now a generic JSON 500 that never exposes
    // the thrown storage error.
    return NextResponse.json(
      { error: 'failed to persist historical scores', year },
      { status: 500 }
    );
  }

  const rowsCommitted = writePartitions.reduce(
    (total, seasonType) => total + itemsByPartition[seasonType].length,
    0
  );

  await recordProviderRefreshSuccess('scores', scope, {
    attempt,
    committedAt,
    commitSeq,
    source: 'cfbd',
    rowsCommitted,
    durationMs: Date.now() - startedMs,
  });

  return NextResponse.json({
    success: true,
    year,
    scoreCount: rowsCommitted,
    cachedAt: new Date(now).toISOString(),
  });
}
