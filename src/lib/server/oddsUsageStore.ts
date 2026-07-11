import { deleteAppState, getAppState, setAppState } from './appStateStore.ts';
import {
  buildOddsUsageSnapshot,
  type OddsUsageContext,
  type OddsUsageSnapshot,
} from '../api/oddsUsage.ts';

let memorySnapshot: OddsUsageSnapshot | null | undefined;

function oddsUsageScope(): string {
  return 'odds-usage';
}

async function readSnapshotFile(): Promise<OddsUsageSnapshot | null> {
  const record = await getAppState<OddsUsageSnapshot>(oddsUsageScope(), 'latest');
  return record?.value ?? null;
}

async function writeSnapshotFile(snapshot: OddsUsageSnapshot): Promise<void> {
  await setAppState(oddsUsageScope(), 'latest', snapshot);
}

export async function getLatestKnownOddsUsage(options?: {
  forceRefresh?: boolean;
}): Promise<OddsUsageSnapshot | null> {
  // `forceRefresh` reads through to durable storage and refreshes the
  // process-local memo. Callers that must not act on a stale memoized snapshot
  // (e.g. the /api/odds quota guard in a multi-instance deployment) pass this.
  if (!options?.forceRefresh && memorySnapshot !== undefined) return memorySnapshot;

  memorySnapshot = await readSnapshotFile();
  return memorySnapshot;
}

export async function setLatestKnownOddsUsage(snapshot: OddsUsageSnapshot): Promise<void> {
  // Durable-first (PLATFORM-085A): persist the provider-derived usage snapshot
  // before updating the process-local memo, so a failed durable write does not
  // leave this instance's quota memo ahead of durable state (which other
  // instances and forceRefresh reads rely on).
  await writeSnapshotFile(snapshot);
  memorySnapshot = snapshot;
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
  await deleteAppState(oddsUsageScope(), 'latest');
}
