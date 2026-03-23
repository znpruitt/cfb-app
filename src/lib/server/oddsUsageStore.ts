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
  await deleteAppState(oddsUsageScope(), 'latest');
}
