import { getAppState, setAppState } from './server/appStateStore.ts';

const PROBE_SCOPE = 'schedule-probe';

export type ScheduleProbeState = {
  year: number;
  /** ISO timestamp when base schedule was first cached for this year */
  baseCachedAt: string | null;
  /** ISO timestamp of the earliest game across all weeks */
  firstGameDate: string | null;
};

export async function getScheduleProbeState(
  year: number
): Promise<ScheduleProbeState | null> {
  const record = await getAppState<ScheduleProbeState>(PROBE_SCOPE, String(year));
  return record?.value ?? null;
}

export async function saveScheduleProbeState(
  state: ScheduleProbeState
): Promise<void> {
  await setAppState(PROBE_SCOPE, String(state.year), state);
}

/**
 * Derive the first game date from cached schedule items.
 * Checks ALL weeks (including Week 0) — not just Week 1 — so early-season
 * games are never excluded from the transition trigger.
 * Returns an ISO string or null if no games have dates.
 */
export function deriveFirstGameDate(
  items: Array<{ week: number; startDate: string | null }>
): string | null {
  const dates = items
    .filter((item) => item.startDate)
    .map((item) => new Date(item.startDate!).getTime())
    .filter((t) => Number.isFinite(t));

  if (dates.length === 0) return null;
  return new Date(Math.min(...dates)).toISOString();
}
