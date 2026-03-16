import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  buildOddsUsageSnapshot,
  type OddsUsageContext,
  type OddsUsageSnapshot,
} from '@/lib/api/oddsUsage';

let memorySnapshot: OddsUsageSnapshot | null | undefined;

function dataDir(): string {
  return path.join(process.cwd(), 'data');
}

function oddsUsageFile(): string {
  return path.join(dataDir(), 'odds-usage-snapshot.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function toSnapshot(value: unknown): OddsUsageSnapshot | null {
  if (!isRecord(value)) return null;

  const used = Number(value.used);
  const remaining = Number(value.remaining);
  const lastCost = Number(value.lastCost);
  const limit = Number(value.limit);

  if (
    !Number.isFinite(used) ||
    !Number.isFinite(remaining) ||
    !Number.isFinite(lastCost) ||
    !Number.isFinite(limit)
  ) {
    return null;
  }

  const capturedAt = typeof value.capturedAt === 'string' ? value.capturedAt : '';
  const source = value.source;
  if (!capturedAt || (source !== 'odds-response-headers' && source !== 'quota-error-fallback'))
    return null;

  return {
    used,
    remaining,
    lastCost,
    limit,
    capturedAt,
    source,
    sportKey: typeof value.sportKey === 'string' ? value.sportKey : undefined,
    markets: isStringArray(value.markets) ? value.markets : undefined,
    regions: isStringArray(value.regions) ? value.regions : undefined,
    endpointType: typeof value.endpointType === 'string' ? value.endpointType : undefined,
    cacheStatus:
      value.cacheStatus === 'hit' || value.cacheStatus === 'miss' || value.cacheStatus === 'unknown'
        ? value.cacheStatus
        : undefined,
  };
}

async function readSnapshotFile(): Promise<OddsUsageSnapshot | null> {
  try {
    const raw = await fs.readFile(oddsUsageFile(), 'utf8');
    return toSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeSnapshotFile(snapshot: OddsUsageSnapshot): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(oddsUsageFile(), JSON.stringify(snapshot, null, 2), 'utf8');
}

export async function getLatestKnownOddsUsage(): Promise<OddsUsageSnapshot | null> {
  if (memorySnapshot !== undefined) return memorySnapshot;

  memorySnapshot = await readSnapshotFile();
  return memorySnapshot;
}

export async function setLatestKnownOddsUsage(snapshot: OddsUsageSnapshot): Promise<void> {
  memorySnapshot = snapshot;
  await writeSnapshotFile(snapshot);
}

export async function captureOddsUsageSnapshot(
  headers: Headers,
  context: OddsUsageContext = {}
): Promise<OddsUsageSnapshot | null> {
  const next = buildOddsUsageSnapshot(headers, context);
  if (!next) {
    return await getLatestKnownOddsUsage();
  }

  await setLatestKnownOddsUsage(next);
  return next;
}

export function __resetOddsUsageStoreForTests(): void {
  memorySnapshot = undefined;
}

export async function __deleteOddsUsageStoreFileForTests(): Promise<void> {
  memorySnapshot = undefined;
  await fs.rm(oddsUsageFile(), { force: true });
}
