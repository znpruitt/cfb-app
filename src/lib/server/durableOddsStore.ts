import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { DurableOddsRecord, DurableOddsSnapshot } from '../odds.ts';
import { writeJsonFileAtomic } from './atomicFileWrite.ts';

type DurableOddsStoreFile = {
  season: number;
  items: DurableOddsRecord[];
};

let memoryStore = new Map<number, Record<string, DurableOddsRecord> | undefined>();

function dataDir(): string {
  return path.join(process.cwd(), 'data');
}

function durableOddsFile(season: number): string {
  return path.join(dataDir(), `durable-odds-${season}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toSnapshot(value: unknown): DurableOddsSnapshot | null {
  if (!isRecord(value)) return null;

  const capturedAt = toNullableString(value.capturedAt);
  const bookmakerKey = toNullableString(value.bookmakerKey);

  if (!capturedAt || !bookmakerKey) return null;

  return {
    capturedAt,
    bookmakerKey,
    favorite: toNullableString(value.favorite),
    source: toNullableString(value.source),
    spread: toFiniteNumber(value.spread),
    homeSpread: toFiniteNumber(value.homeSpread),
    awaySpread: toFiniteNumber(value.awaySpread),
    spreadPriceHome: toFiniteNumber(value.spreadPriceHome),
    spreadPriceAway: toFiniteNumber(value.spreadPriceAway),
    moneylineHome: toFiniteNumber(value.moneylineHome),
    moneylineAway: toFiniteNumber(value.moneylineAway),
    total: toFiniteNumber(value.total),
    overPrice: toFiniteNumber(value.overPrice),
    underPrice: toFiniteNumber(value.underPrice),
  };
}

function toDurableOddsRecord(value: unknown): DurableOddsRecord | null {
  if (!isRecord(value)) return null;

  const canonicalGameId = toNullableString(value.canonicalGameId);
  if (!canonicalGameId) return null;

  return {
    canonicalGameId,
    latestSnapshot: value.latestSnapshot === null ? null : toSnapshot(value.latestSnapshot),
    closingSnapshot: value.closingSnapshot === null ? null : toSnapshot(value.closingSnapshot),
    closingFrozenAt: toNullableString(value.closingFrozenAt),
  };
}

async function readStoreFile(season: number): Promise<Record<string, DurableOddsRecord>> {
  try {
    const raw = await fs.readFile(durableOddsFile(season), 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
      return {};
    }

    const next: Record<string, DurableOddsRecord> = {};
    for (const item of parsed.items) {
      const record = toDurableOddsRecord(item);
      if (!record) continue;
      next[record.canonicalGameId] = record;
    }

    return next;
  } catch {
    return {};
  }
}

async function writeStoreFile(
  season: number,
  store: Record<string, DurableOddsRecord>
): Promise<void> {
  const file: DurableOddsStoreFile = {
    season,
    items: Object.values(store).sort((a, b) => a.canonicalGameId.localeCompare(b.canonicalGameId)),
  };

  await writeJsonFileAtomic(durableOddsFile(season), file);
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
  memoryStore.set(season, store);
  await writeStoreFile(season, store);
}

export async function getDurableOddsRecord(
  season: number,
  canonicalGameId: string
): Promise<DurableOddsRecord | null> {
  const store = await getDurableOddsStore(season);
  return store[canonicalGameId] ?? null;
}

export async function upsertDurableOddsRecords(
  season: number,
  records: DurableOddsRecord[]
): Promise<Record<string, DurableOddsRecord>> {
  const current = await getDurableOddsStore(season);
  const next: Record<string, DurableOddsRecord> = { ...current };

  for (const record of records) {
    next[record.canonicalGameId] = record;
  }

  await setDurableOddsStore(season, next);
  return next;
}

export function __resetDurableOddsStoreForTests(): void {
  memoryStore = new Map<number, Record<string, DurableOddsRecord> | undefined>();
}

export async function __deleteDurableOddsStoreFileForTests(season: number): Promise<void> {
  memoryStore.delete(season);
  await fs.rm(durableOddsFile(season), { force: true });
}
