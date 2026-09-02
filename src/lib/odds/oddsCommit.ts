/**
 * PLATFORM-086C1 — the atomic canonical Odds commit + public closing-line
 * maintenance authority.
 *
 * For the canonical/default Odds target the raw odds cache entry
 * (`odds-cache/<seasonScopedKey>`) and the durable per-game store
 * (`durable-odds:<season>/store`) form ONE logical commit. This module is the
 * single writer that binds them: every canonical durable write — the authorized
 * manual refresh, the FUTURE automatic refresh, and the public closing-line
 * maintenance — flows through the SAME advisory-locked transaction and the SAME
 * observation-ordered merge, so an older request can never overwrite newer raw or
 * per-game state, and a canonical-store failure can never leave raw Odds committed
 * with a fabricated success.
 *
 * Lock discipline (enforced by the app-state primitive's monotonic ordering): the
 * transaction is ROOTED on `durable-odds:<season>/store` and acquires the
 * independent `odds-cache/<seasonScopedKey>` lock SECOND. `"durable-odds:<n>"`
 * sorts strictly below `"odds-cache"`, so the acquisition is a legal forward
 * lock and no opposite-root transaction can invert it. The empty-payload writer
 * (route) roots directly on `odds-cache/<key>`, so it serializes on the same
 * advisory lock this commit takes as its secondary — never a cycle, because this
 * commit never waits on a lock the empty writer holds while the empty writer
 * waits on the durable-store root.
 *
 * Commit ordering + process caches: `committedAt`/`commitSeq` are captured
 * IMMEDIATELY after the confirmed transaction, and the process caches (the raw
 * odds cache + the durable-store memo) publish ONLY after that confirmed commit —
 * never before durable success.
 */

import {
  effectiveOddsObservationMs,
  oddsCache,
  ODDS_CACHE_SCOPE,
  type SharedOddsCacheEntry,
} from '@/app/api/odds/routeInternals';

import { attachOddsEventsToSchedule } from '../oddsAttachment.ts';
import { createOddsTeamLabelNormalizer } from '../oddsTeamLabelNormalization.ts';
import {
  applyPregameOddsSnapshot,
  buildDurableOddsSnapshot,
  emptyDurableOddsRecord,
  freezeClosingSnapshotIfNeeded,
  pickPreferredBook,
  reopenClosingSnapshotForDelayedKickoffIfNeeded,
  type DurableOddsRecord,
  type OddsBookmaker,
} from '../odds.ts';
import type { NormalizedOddsEvent } from '@/app/api/odds/routeInternals';
import type { AppGame } from '../schedule.ts';
import { withAppStateKeyTransaction } from '../server/appStateStore.ts';
import {
  DURABLE_ODDS_STORE_KEY,
  durableOddsStoreScope,
  primeDurableOddsStoreMemory,
} from '../server/durableOddsStore.ts';
import { nextProviderCommitSeq } from '../server/providerRefreshStatus.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';

type PreparedOddsEvent = {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  book: OddsBookmaker | undefined;
};

type OddsStore = Record<string, DurableOddsRecord>;

/** The merge inputs shared by the refresh commit and the public maintenance. */
export type OddsStoreMergeInput = {
  /** The built canonical games for the season (one `buildScheduleFromApi` output). */
  games: AppGame[];
  /**
   * The provider events to (re-)apply: the fresh normalized events on a refresh,
   * or the cached events on public maintenance (which the observation ordering
   * renders idempotent). Empty for a valid-empty refresh.
   */
  oddsEvents: NormalizedOddsEvent[];
  resolver: TeamIdentityResolver;
  /** The provider observation time — every generated snapshot's `capturedAt`. */
  observationAt: string;
  /** Wall-clock instant for freeze/reopen kickoff decisions. */
  now: string;
};

function hasStoredOddsData(record: DurableOddsRecord): boolean {
  return Boolean(record.latestSnapshot || record.closingSnapshot || record.closingFrozenAt);
}

function isRawEntry(value: unknown): value is SharedOddsCacheEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { data?: unknown }).data) &&
    typeof (value as { lastFetch?: unknown }).lastFetch === 'number'
  );
}

function normalizeStore(value: unknown): OddsStore {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as OddsStore) : {};
}

/**
 * Build the next per-game store from `prior` by applying, for every canonical
 * game, kickoff freeze/reopen maintenance, and, for every attached provider
 * event, the observation-ordered pregame snapshot. Pure: no I/O. Returns the next
 * store and whether any record actually changed (so callers skip a no-op durable
 * write). The observation ordering lives in `applyPregameOddsSnapshot`, so a
 * re-application of the same-`capturedAt` cached events (public maintenance) is an
 * idempotent no-op and only genuine kickoff freeze/reopen transitions register as
 * changes.
 */
export function buildNextOddsStore(
  prior: OddsStore,
  input: OddsStoreMergeInput
): { store: OddsStore; changed: boolean } {
  const { games, oddsEvents, resolver, observationAt, now } = input;
  const preparedEvents: PreparedOddsEvent[] = oddsEvents.map((event) => ({
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    commenceTime: event.commenceTime,
    book: pickPreferredBook(event),
  }));
  const teamLabelNormalizer = createOddsTeamLabelNormalizer({ games, resolver });
  const attached = attachOddsEventsToSchedule({
    games,
    events: preparedEvents,
    resolver,
    teamLabelNormalizer,
  });
  const gameByKey = new Map(games.map((game) => [game.key, game]));

  const nextStore: OddsStore = { ...prior };
  let changed = false;
  const assignRecord = (gameKey: string, nextRecord: DurableOddsRecord): void => {
    const prevSerialized = JSON.stringify(nextStore[gameKey] ?? null);
    const hasData = hasStoredOddsData(nextRecord);
    const nextSerialized = JSON.stringify(hasData ? nextRecord : null);
    if (prevSerialized === nextSerialized) return;
    changed = true;
    if (hasData) nextStore[gameKey] = nextRecord;
    else delete nextStore[gameKey];
  };

  for (const game of games) {
    const currentRecord = nextStore[game.key] ?? emptyDurableOddsRecord(game.key);
    assignRecord(
      game.key,
      freezeClosingSnapshotIfNeeded({
        record: reopenClosingSnapshotForDelayedKickoffIfNeeded({
          record: currentRecord,
          kickoff: game.date,
          now,
        }),
        kickoff: game.date,
        now,
      })
    );
  }

  for (const match of attached) {
    const game = gameByKey.get(match.gameKey);
    if (!game) continue;
    const snapshot = buildDurableOddsSnapshot({
      game,
      event: match.event,
      resolver,
      teamLabelNormalizer,
      capturedAt: observationAt,
    });
    if (!snapshot) continue;
    const currentRecord = nextStore[game.key] ?? emptyDurableOddsRecord(game.key);
    const updated = applyPregameOddsSnapshot({
      record: currentRecord,
      snapshot,
      kickoff: game.date,
      now,
    });
    assignRecord(
      game.key,
      freezeClosingSnapshotIfNeeded({ record: updated, kickoff: game.date, now })
    );
  }

  return { store: nextStore, changed };
}

export type CanonicalOddsCommitOutcome =
  | {
      kind: 'committed';
      store: OddsStore;
      rawEntry: SharedOddsCacheEntry;
      committedAt: string;
      commitSeq: number;
      wroteStore: boolean;
      rowsCommitted: number;
    }
  | { kind: 'stale-observation'; store: OddsStore; rawEntry: SharedOddsCacheEntry | undefined }
  | { kind: 'store-unavailable' };

/**
 * Atomically commit a canonical Odds refresh: the raw odds cache entry AND the
 * durable per-game store in ONE transaction. Re-reads both records inside the
 * transaction and re-runs the observation decision against the transaction-fresh
 * raw entry — a prior raw entry whose effective observation is >= the incoming
 * one WINS, yielding `stale-observation` (nothing rewritten, no per-game
 * regression, no process-cache publication, no success). Otherwise both records
 * commit together; the store write is skipped when unchanged. A transaction
 * failure leaves BOTH durable keys at prior-good and returns `store-unavailable`.
 */
export async function commitCanonicalOddsRefresh(params: {
  season: number;
  seasonScopedKey: string;
  rawEntry: SharedOddsCacheEntry;
  games: AppGame[];
  oddsEvents: NormalizedOddsEvent[];
  resolver: TeamIdentityResolver;
  observationAt: string;
  now: string;
}): Promise<CanonicalOddsCommitOutcome> {
  const { season, seasonScopedKey, rawEntry, games, oddsEvents, resolver, observationAt, now } =
    params;

  let outcome:
    | { kind: 'committed'; store: OddsStore; wroteStore: boolean; rowsCommitted: number }
    | { kind: 'stale-observation'; store: OddsStore; rawEntry: SharedOddsCacheEntry | undefined };
  try {
    outcome = await withAppStateKeyTransaction(
      durableOddsStoreScope(season),
      DURABLE_ODDS_STORE_KEY,
      async (txn) => {
        // Acquire the independent raw-cache key SECOND (legal forward order).
        await txn.lockKey(ODDS_CACHE_SCOPE, seasonScopedKey);
        const priorRawValue = (await txn.readKey<unknown>(ODDS_CACHE_SCOPE, seasonScopedKey))
          ?.value;
        const priorRaw = isRawEntry(priorRawValue) ? priorRawValue : undefined;
        const priorStore = normalizeStore((await txn.read<unknown>())?.value);

        // Observation ordering: a prior raw entry captured at/after the incoming
        // observation wins — this stale request rewrites nothing and regresses
        // no per-game line.
        if (
          priorRaw &&
          effectiveOddsObservationMs(priorRaw) >= effectiveOddsObservationMs(rawEntry)
        ) {
          return { kind: 'stale-observation' as const, store: priorStore, rawEntry: priorRaw };
        }

        const { store, changed } = buildNextOddsStore(priorStore, {
          games,
          oddsEvents,
          resolver,
          observationAt,
          now,
        });
        await txn.writeKey(ODDS_CACHE_SCOPE, seasonScopedKey, rawEntry);
        if (changed) await txn.write(store);
        return {
          kind: 'committed' as const,
          store,
          wroteStore: changed,
          rowsCommitted: rawEntry.data.length,
        };
      }
    );
  } catch {
    // The transaction callback's only fallible operations are the store
    // reads/writes (the merge is pure over pre-validated games/events), so ANY
    // fault — the typed lock/finalize/cleanup wrappers OR a rethrown raw
    // read/write statement error — is store-unavailable, not a propagated failure
    // (review remediation). Callers map this to a truthful durable-commit failure.
    return { kind: 'store-unavailable' };
  }

  if (outcome.kind === 'stale-observation') {
    // A stale no-op committed NOTHING, so it publishes NOTHING to either process
    // cache (review remediation): priming the memo with this transaction's read
    // snapshot could regress it below a fresher commit another instance made after
    // our read released the lock. The read snapshot is returned only to serve
    // THIS response's prior-good selection.
    return { kind: 'stale-observation', store: outcome.store, rawEntry: outcome.rawEntry };
  }

  // Capture commit ordering immediately after the confirmed transaction, then
  // publish process caches — never before durable success.
  const committedAt = new Date().toISOString();
  const commitSeq = nextProviderCommitSeq();
  primeDurableOddsStoreMemory(season, outcome.store);
  oddsCache.entries[seasonScopedKey] = rawEntry;
  return {
    kind: 'committed',
    store: outcome.store,
    rawEntry,
    committedAt,
    commitSeq,
    wroteStore: outcome.wroteStore,
    rowsCommitted: outcome.rowsCommitted,
  };
}

export type FilteredOddsCommitOutcome =
  | { kind: 'committed'; rawEntry: SharedOddsCacheEntry; committedAt: string; commitSeq: number }
  | { kind: 'stale-observation'; rawEntry: SharedOddsCacheEntry | undefined }
  | { kind: 'store-unavailable' };

/**
 * Commit a FILTERED (non-canonical) Odds refresh: transact ONLY against the exact
 * `odds-cache/<seasonScopedKey>` raw key — never seeding or mutating the canonical
 * durable per-game store, preserving filtered-response isolation. Observation
 * ordering still applies: a prior raw entry captured at/after the incoming one
 * wins (`stale-observation`, nothing rewritten). The raw process cache publishes
 * only after the confirmed commit, and `committedAt`/`commitSeq` are captured
 * immediately after it so success-status ordering breaks a same-millisecond tie
 * exactly as the canonical commit does (review remediation).
 */
export async function commitFilteredOddsRefresh(params: {
  seasonScopedKey: string;
  rawEntry: SharedOddsCacheEntry;
}): Promise<FilteredOddsCommitOutcome> {
  const { seasonScopedKey, rawEntry } = params;
  try {
    const outcome = await withAppStateKeyTransaction<
      | { kind: 'committed' }
      | { kind: 'stale-observation'; rawEntry: SharedOddsCacheEntry | undefined }
    >(ODDS_CACHE_SCOPE, seasonScopedKey, async (txn) => {
      const priorValue = (await txn.read<unknown>())?.value;
      const priorRaw = isRawEntry(priorValue) ? priorValue : undefined;
      if (
        priorRaw &&
        effectiveOddsObservationMs(priorRaw) >= effectiveOddsObservationMs(rawEntry)
      ) {
        return { kind: 'stale-observation', rawEntry: priorRaw };
      }
      await txn.write(rawEntry);
      return { kind: 'committed' };
    });
    if (outcome.kind === 'stale-observation') return outcome;
    // Capture commit ordering immediately after the confirmed transaction, then
    // publish the raw process cache.
    const committedAt = new Date().toISOString();
    const commitSeq = nextProviderCommitSeq();
    oddsCache.entries[seasonScopedKey] = rawEntry;
    return { kind: 'committed', rawEntry, committedAt, commitSeq };
  } catch {
    // The transaction callback's only fallible operations are the store
    // reads/writes (the merge is pure over pre-validated games/events), so ANY
    // fault — the typed lock/finalize/cleanup wrappers OR a rethrown raw
    // read/write statement error — is store-unavailable, not a propagated failure
    // (review remediation). Callers map this to a truthful durable-commit failure.
    return { kind: 'store-unavailable' };
  }
}

export type CanonicalOddsMaintainOutcome =
  | { kind: 'maintained'; store: OddsStore; wroteStore: boolean }
  | { kind: 'store-unavailable' };

/**
 * Public closing-line maintenance for the canonical target (PLATFORM-086C1
 * §7): freeze/reopen the durable per-game store against a transaction-fresh read
 * and re-apply the cached events (idempotent under observation ordering). Routes
 * through the SAME durable-store advisory transaction the refresh commit uses, so
 * a public read and a manual refresh serialize on the store lock. Writes ONLY
 * when the recomputed store differs; never touches the raw cache; never updates
 * process memory before durable success. A transaction failure returns
 * `store-unavailable` and leaves the durable store at prior-good — a stale served
 * fallback can never downgrade it.
 */
export async function maintainCanonicalClosingLines(params: {
  season: number;
  games: AppGame[];
  oddsEvents: NormalizedOddsEvent[];
  resolver: TeamIdentityResolver;
  observationAt: string;
  now: string;
}): Promise<CanonicalOddsMaintainOutcome> {
  const { season, games, oddsEvents, resolver, observationAt, now } = params;
  let result: { store: OddsStore; changed: boolean };
  try {
    result = await withAppStateKeyTransaction(
      durableOddsStoreScope(season),
      DURABLE_ODDS_STORE_KEY,
      async (txn) => {
        const priorStore = normalizeStore((await txn.read<unknown>())?.value);
        const built = buildNextOddsStore(priorStore, {
          games,
          oddsEvents,
          resolver,
          observationAt,
          now,
        });
        if (built.changed) await txn.write(built.store);
        return built;
      }
    );
  } catch {
    // The transaction callback's only fallible operations are the store
    // reads/writes (the merge is pure over pre-validated games/events), so ANY
    // fault — the typed lock/finalize/cleanup wrappers OR a rethrown raw
    // read/write statement error — is store-unavailable, not a propagated failure
    // (review remediation). Callers map this to a truthful durable-commit failure.
    return { kind: 'store-unavailable' };
  }

  // The returned store is the confirmed durable value (just-written or
  // freshly-read-and-unchanged) — safe to publish to the memo either way.
  primeDurableOddsStoreMemory(season, result.store);
  return { kind: 'maintained', store: result.store, wroteStore: result.changed };
}
