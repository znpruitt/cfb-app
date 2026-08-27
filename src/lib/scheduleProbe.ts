import { getAppState, setAppState } from './server/appStateStore.ts';
import { getScopedAliasMap } from './server/globalAliasStore.ts';
import { getTeamDatabaseItems } from './server/teamDatabaseStore.ts';
import { createTeamIdentityResolver } from './teamIdentity.ts';

const PROBE_SCOPE = 'schedule-probe';

export type ScheduleProbeState = {
  year: number;
  /** ISO timestamp when base schedule was first cached for this year */
  baseCachedAt: string | null;
  /** UTC midnight on the earliest league-visible game date */
  firstGameDate: string | null;
};

export type ScheduleProbeItem = {
  startDate: string | null;
  homeTeam: string;
  awayTeam: string;
  /** Provider timing confidence does not affect the calendar-date anchor. */
  startTimeTBD?: boolean;
};

export async function getScheduleProbeState(year: number): Promise<ScheduleProbeState | null> {
  const record = await getAppState<ScheduleProbeState>(PROBE_SCOPE, String(year));
  return record?.value ?? null;
}

export async function saveScheduleProbeState(state: ScheduleProbeState): Promise<void> {
  await setAppState(PROBE_SCOPE, String(state.year), state);
}

/**
 * Derive the calendar-date anchor used by the preseason lifecycle.
 *
 * A row is league-visible when at least one participant resolves as FBS through
 * the durable team catalog and league-agnostic alias map. Deliberately omit
 * `observedNames` from the resolver: provider-only names must not become
 * synthetic identities that make every row appear catalog-backed.
 *
 * Exact kickoff time and `startTimeTBD` are irrelevant to this daily policy.
 * The result is midnight UTC on the earliest eligible date. If no dated row is
 * catalog-backed, fall back to midnight UTC on the earliest parseable date in
 * the payload; return null only when the payload has no parseable dates.
 */
export async function deriveFirstGameDate(
  year: number,
  items: ScheduleProbeItem[]
): Promise<string | null> {
  const datedItems = items.flatMap((item) => {
    if (!item.startDate) return [];
    const kickoff = new Date(item.startDate);
    if (!Number.isFinite(kickoff.getTime())) return [];
    return [
      {
        item,
        utcDateMs: Date.UTC(kickoff.getUTCFullYear(), kickoff.getUTCMonth(), kickoff.getUTCDate()),
      },
    ];
  });

  if (datedItems.length === 0) return null;

  const [teams, aliasMap] = await Promise.all([
    getTeamDatabaseItems(),
    getScopedAliasMap('', year),
  ]);
  const resolver = createTeamIdentityResolver({ teams, aliasMap });

  let earliestEligibleMs: number | null = null;
  let earliestFallbackMs = Number.POSITIVE_INFINITY;

  for (const { item, utcDateMs } of datedItems) {
    earliestFallbackMs = Math.min(earliestFallbackMs, utcDateMs);
    if (!resolver.isFbsName(item.homeTeam) && !resolver.isFbsName(item.awayTeam)) continue;
    earliestEligibleMs =
      earliestEligibleMs === null ? utcDateMs : Math.min(earliestEligibleMs, utcDateMs);
  }

  return new Date(earliestEligibleMs ?? earliestFallbackMs).toISOString();
}
