import type { DurableOddsRecord } from '../odds.ts';
import { deleteAppState, getAppState, setAppState } from './appStateStore.ts';

let memoryStore = new Map<number, Record<string, DurableOddsRecord> | undefined>();
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

function durableOddsScope(season: number): string {
  return `durable-odds:${season}`;
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
  season: number
): Promise<Record<string, DurableOddsRecord>> {
  const cached = memoryStore.get(season);
  if (cached !== undefined) return cached;

  const loaded = await readStoreFile(season);
  memoryStore.set(season, loaded);
  return loaded;
}

export async function setDurableOddsStore(
  season: number,
  store: Record<string, DurableOddsRecord>
): Promise<void> {
  await runSeasonScopedMutation(season, async () => {
    memoryStore.set(season, store);
    await writeStoreFile(season, store);
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
    memoryStore.set(season, current);

    const next = await updater({ ...current });
    memoryStore.set(season, next);
    await writeStoreFile(season, next);
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

export function __resetDurableOddsStoreForTests(): void {
  memoryStore = new Map<number, Record<string, DurableOddsRecord> | undefined>();
  seasonWriteQueue = new Map<number, Promise<void>>();
}

export async function __deleteDurableOddsStoreFileForTests(season: number): Promise<void> {
  memoryStore.delete(season);
  await deleteAppState(durableOddsScope(season), 'store');
}
