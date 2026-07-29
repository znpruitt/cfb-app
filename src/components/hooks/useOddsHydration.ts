import { useEffect, type Dispatch, type SetStateAction } from 'react';

import { buildOddsLookup, type CanonicalOddsItem, type CombinedOdds } from '../../lib/odds';
import type { OddsUsageSnapshot } from '../../lib/apiUsage';

/**
 * The generic, body-free issue surfaced when a cache-only Odds hydration fails. It
 * is prefixed `Odds fetch failed:` so `isLiveOddsIssue` classifies it — a
 * score-only live tick then PRESERVES it rather than silently wiping the "odds
 * unavailable" warning (PLATFORM-086C3). It never contains a response body, URL, or
 * credential.
 */
export const ODDS_HYDRATION_ISSUE = 'Odds fetch failed: unable to load current odds.';

type OddsHydrationResponse = {
  items?: CanonicalOddsItem[];
  meta?: {
    usage?: OddsUsageSnapshot | null;
    snapshotCapturedAt?: string | null;
  };
};

/**
 * PLATFORM-086C3 — hydrate the league's canonical Odds from the durable cache ONCE
 * per selected season, independent of live-score refresh and the kickoff window.
 *
 * The display of already-cached Odds must not depend on how close a game is to
 * kickoff: the retired `refreshPolicy` window suppressed cached lines for
 * far-future and completed games even though the canonical cache held them. Server-
 * side provider polling still governs when NEW odds are fetched (PLATFORM-086C2);
 * this only surfaces what is already cached.
 *
 * The read is strictly cache-only: `GET /api/odds?year=<season>` with NO
 * `refresh=1` and NO admin authorization header, so it can never spend provider
 * quota or trigger an upstream fetch (the public Odds route is a pure cache reader
 * under PLATFORM-075/086C2). It runs when the selected season's schedule has loaded
 * with games and re-arms only when the season changes or the schedule reloads —
 * week/tab/subview navigation, focus, visibility, and the live-score timer never
 * re-trigger it (their effect inputs are not in this hook's dependency list).
 */
export function useOddsHydration(params: {
  selectedSeason: number;
  scheduleLoaded: boolean;
  hasGames: boolean;
  setOddsByKey: Dispatch<SetStateAction<Record<string, CombinedOdds>>>;
  setOddsSnapshotAt: Dispatch<SetStateAction<string | null>>;
  setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>>;
  setIssues: Dispatch<SetStateAction<string[]>>;
}): void {
  const {
    selectedSeason,
    scheduleLoaded,
    hasGames,
    setOddsByKey,
    setOddsSnapshotAt,
    setOddsUsage,
    setIssues,
  } = params;

  useEffect(() => {
    if (!scheduleLoaded || !hasGames) return;

    // Stale-response guard: aborting on cleanup means an in-flight read for a prior
    // season (or a superseded schedule load) can never overwrite the current one —
    // the newer effect's request always wins. The effect depends ONLY on the
    // season + schedule-load lifecycle, so navigation never re-runs it.
    const controller = new AbortController();

    const surfaceIssue = (): void =>
      setIssues((prev) =>
        prev.includes(ODDS_HYDRATION_ISSUE) ? prev : [...prev, ODDS_HYDRATION_ISSUE]
      );

    void (async () => {
      try {
        // Cache-only public read — no `refresh=1`, no auth header, provider-free.
        const res = await fetch(`/api/odds?year=${selectedSeason}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          surfaceIssue();
          return;
        }
        const payload = (await res.json()) as OddsHydrationResponse;
        if (controller.signal.aborted) return;
        // A successful empty response truthfully installs an empty lookup + null
        // snapshot — the season simply has no cached lines yet.
        setOddsByKey(buildOddsLookup(payload.items ?? []));
        setOddsSnapshotAt(payload.meta?.snapshotCapturedAt ?? null);
        setOddsUsage(payload.meta?.usage ?? null);
      } catch {
        // An abort (stale/unmount) is expected and not a failure; a genuine failure
        // preserves prior-good client Odds and surfaces one generic, body-free issue.
        if (controller.signal.aborted) return;
        surfaceIssue();
      }
    })();

    return () => controller.abort();
  }, [
    selectedSeason,
    scheduleLoaded,
    hasGames,
    setOddsByKey,
    setOddsSnapshotAt,
    setOddsUsage,
    setIssues,
  ]);
}
