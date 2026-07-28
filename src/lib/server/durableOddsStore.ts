import type { DurableOddsRecord } from '../odds.ts';
import { deleteAppState, getAppState, setAppState } from './appStateStore.ts';

/**
 * The process memo is BOUNDED (PLATFORM-086C2): each season's cached store carries
 * the time it was cached, and a read older than {@link ODDS_MEMO_TTL_MS} re-reads
 * durable storage. This closes the C1 best-effort limitation so a cross-instance
 * cron commit becomes visible to a public reader on another Vercel instance within
 * the same 120-second window the raw odds cache already revalidates on — without
 * any provider request or durable write.
 */
export const ODDS_MEMO_TTL_MS = 120_000;

type OddsMemoEntry = { store: Record<string, DurableOddsRecord>; at: number };
let memoryStore = new Map<number, OddsMemoEntry>();
let seasonWriteQueue = new Map<number, Promise<void>>();

async function runSeasonScopedMutation<T>(season: number, task: () => Promise<T>): Promise<T> {
  const prior = seasonWriteQueue.get(season) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  seasonWriteQueue.set(
    season,
    prior.then(() => current)
  );

  await prior;
  try {
    return await task();
  } finally {
    release();
    if (seasonWriteQueue.get(season) === current) {
      seasonWriteQueue.delete(season);
    }
  }
}

/**
 * The durable app-state scope + key holding one season's per-game Odds store.
 * Exported (PLATFORM-086C1) so the atomic canonical commit and public
 * closing-line maintenance can root their `withAppStateKeyTransaction` on the
 * EXACT same record every reader/writer uses — the single advisory-locked
 * durable Odds target.
 */
export function durableOddsStoreScope(season: number): string {
  return `durable-odds:${season}`;
}
export const DURABLE_ODDS_STORE_KEY = 'store';

function durableOddsScope(season: number): string {
  return durableOddsStoreScope(season);
}

async function readStoreFile(season: number): Promise<Record<string, DurableOddsRecord>> {
  const record = await getAppState<Record<string, DurableOddsRecord>>(
    durableOddsScope(season),
    'store'
  );
  const store = record?.value;
  return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
}

async function writeStoreFile(
  season: number,
  store: Record<string, DurableOddsRecord>
): Promise<void> {
  await setAppState(durableOddsScope(season), 'store', store);
}

export async function getDurableOddsStore(
  season: number,
  opts: { forceDurableRead?: boolean; now?: number } = {}
): Promise<Record<string, DurableOddsRecord>> {
  const now = opts.now ?? Date.now();
  const cached = memoryStore.get(season);
  // A fresh memo is the fast path; a memo older than the TTL (or an explicit
  // forced read, used when the caller already knows its raw entry was durably
  // refreshed) re-reads durable so a cross-instance write cannot be masked
  // indefinitely. A durable read FAILURE propagates — never treated as absence.
  if (!opts.forceDurableRead && cached !== undefined && now - cached.at < ODDS_MEMO_TTL_MS) {
    return cached.store;
  }
  const loaded = await readStoreFile(season);
  memoryStore.set(season, { store: loaded, at: now });
  return loaded;
}

export async function setDurableOddsStore(
  season: number,
  store: Record<string, DurableOddsRecord>
): Promise<void> {
  await runSeasonScopedMutation(season, async () => {
    // Durable-first (PLATFORM-085A): persist before updating the process-local
    // memoryStore so a failed durable write leaves memory reflecting the last
    // durable state, never a process-only version other instances can't read.
    await writeStoreFile(season, store);
    memoryStore.set(season, { store, at: Date.now() });
  });
}

export async function getDurableOddsRecord(
  season: number,
  canonicalGameId: string
): Promise<DurableOddsRecord | null> {
  const store = await getDurableOddsStore(season);
  return store[canonicalGameId] ?? null;
}

export async function updateDurableOddsStore(
  season: number,
  updater: (
    current: Record<string, DurableOddsRecord>
  ) => Promise<Record<string, DurableOddsRecord>> | Record<string, DurableOddsRecord>
): Promise<Record<string, DurableOddsRecord>> {
  return await runSeasonScopedMutation(season, async () => {
    const current = await readStoreFile(season);
    // Cache the freshly-read durable value; safe because it equals durable.
    memoryStore.set(season, { store: current, at: Date.now() });

    const next = await updater({ ...current });
    // Durable-first (PLATFORM-085A): commit `next` durably BEFORE publishing it
    // to the process memoryStore. If the write throws, memory still holds
    // `current` (the last durable state) rather than an unpersisted `next`.
    await writeStoreFile(season, next);
    memoryStore.set(season, { store: next, at: Date.now() });
    return next;
  });
}

export async function upsertDurableOddsRecords(
  season: number,
  records: DurableOddsRecord[]
): Promise<Record<string, DurableOddsRecord>> {
  return await updateDurableOddsStore(season, (current) => {
    const next: Record<string, DurableOddsRecord> = { ...current };

    for (const record of records) {
      next[record.canonicalGameId] = record;
    }

    return next;
  });
}

/**
 * Publish an already-durably-committed store to the process-local memo
 * (PLATFORM-086C1). The atomic canonical Odds commit and the public
 * closing-line maintenance run their own `withAppStateKeyTransaction` on
 * `durable-odds:<season>/store`; after that transaction CONFIRMS commit they
 * call this to update the memo so process caches publish ONLY after durable
 * success. It performs NO durable write — the durable write already happened
 * inside the transaction — so it can never publish a value other instances
 * cannot read.
 */
export function primeDurableOddsStoreMemory(
  season: number,
  store: Record<string, DurableOddsRecord>,
  now: number = Date.now()
): void {
  memoryStore.set(season, { store, at: now });
}

export function __resetDurableOddsStoreForTests(): void {
  memoryStore = new Map<number, OddsMemoEntry>();
  seasonWriteQueue = new Map<number, Promise<void>>();
}

export async function __deleteDurableOddsStoreFileForTests(season: number): Promise<void> {
  memoryStore.delete(season);
  await deleteAppState(durableOddsScope(season), 'store');
}
