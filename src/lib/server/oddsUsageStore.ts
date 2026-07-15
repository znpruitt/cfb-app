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

/**
 * The three DISTINCT durable odds-usage read outcomes (PLATFORM-086G2, deferred
 * finding #3): an available snapshot, a genuinely absent snapshot (nothing has
 * ever been stored — the honest first-run state), and a durable read that
 * FAILED — which must never be collapsed into "absent", because "no snapshot
 * yet" and "the store is unreachable" demand different operator responses.
 */
export type OddsUsageReadState =
  | { state: 'available'; snapshot: OddsUsageSnapshot }
  | { state: 'absent' }
  | { state: 'unavailable'; error: string };

/**
 * Read the latest known odds usage WITHOUT collapsing a durable-read failure
 * into absence. Never throws; never fabricates usage values. A failed read
 * leaves the process memo untouched, so a later read retries durable storage.
 */
export async function readLatestKnownOddsUsageState(options?: {
  forceRefresh?: boolean;
}): Promise<OddsUsageReadState> {
  try {
    const snapshot = await getLatestKnownOddsUsage(options);
    return snapshot ? { state: 'available', snapshot } : { state: 'absent' };
  } catch (error) {
    return {
      state: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
