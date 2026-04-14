import { getAppState, setAppState } from './server/appStateStore.ts';

const PROBE_SCOPE = 'schedule-probe';

export type ScheduleProbeState = {
  year: number;
  /** ISO timestamp when base schedule was first cached for this year */
  baseCachedAt: string | null;
  /** ISO timestamp of the earliest Week 1 game */
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
 * Returns an ISO string or null if no Week 1 games have dates.
 */
export function deriveFirstGameDate(
  items: Array<{ week: number; startDate: string | null }>
): string | null {
  const week1Dates = items
    .filter((item) => item.week === 1 && item.startDate)
    .map((item) => new Date(item.startDate!).getTime())
    .filter((t) => Number.isFinite(t));

  if (week1Dates.length === 0) return null;
  return new Date(Math.min(...week1Dates)).toISOString();
}
