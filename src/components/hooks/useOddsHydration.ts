import { useEffect, type Dispatch, type SetStateAction } from 'react';

import type { CombinedOdds } from '../../lib/odds';
import type { OddsUsageSnapshot } from '../../lib/apiUsage';
import { applyOddsResponse, type OddsClientResponse } from '../../lib/oddsClientPayload';
import { ODDS_HYDRATION_ISSUE } from '../../lib/cfbScheduleAppHelpers';

// The generic, body-free hydration-failure issue is defined next to its classifier
// (`isLiveOddsIssue`) in `cfbScheduleAppHelpers`; re-exported here for callers/tests
// that reference it through the hook (PLATFORM-086C3 remediation).
export { ODDS_HYDRATION_ISSUE };

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
 * with games and re-arms when the season changes OR the schedule is rebuilt (the
 * `scheduleGeneration` bump — a full (re)load or a postseason-override apply that
 * can change canonical keys, since a with-games in-place reload leaves
 * `scheduleLoaded`/`hasGames` unchanged). Week/tab/subview navigation, focus,
 * visibility, and the live-score timer never re-trigger it (their inputs are not in
 * this hook's dependency list).
 */
export function useOddsHydration(params: {
  selectedSeason: number;
  scheduleLoaded: boolean;
  hasGames: boolean;
  /** Monotonic rebuild signal — a change re-hydrates against the new schedule keys. */
  scheduleGeneration: number;
  setOddsByKey: Dispatch<SetStateAction<Record<string, CombinedOdds>>>;
  setOddsSnapshotAt: Dispatch<SetStateAction<string | null>>;
  setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>>;
  setIssues: Dispatch<SetStateAction<string[]>>;
}): void {
  const {
    selectedSeason,
    scheduleLoaded,
    hasGames,
    scheduleGeneration,
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
        const payload = (await res.json()) as OddsClientResponse;
        if (controller.signal.aborted) return;
        // A successful empty response truthfully installs an empty lookup + null
        // snapshot — the season simply has no cached lines yet. The shared applier
        // decodes the response and merges usage freshness-aware.
        applyOddsResponse(payload, { setOddsByKey, setOddsSnapshotAt, setOddsUsage });
      } catch {
        // An abort (stale/unmount) is expected and not a failure; a genuine failure
        // preserves prior-good client Odds and surfaces one generic, body-free issue.
        if (controller.signal.aborted) return;
        surfaceIssue();
      }
    })();

    return () => controller.abort();
    // `scheduleGeneration` is a re-arm trigger (a rebuild changes canonical keys):
    // its change aborts any in-flight response for the prior schedule and starts a
    // fresh cache-only hydration.
  }, [
    selectedSeason,
    scheduleLoaded,
    hasGames,
    scheduleGeneration,
    setOddsByKey,
    setOddsSnapshotAt,
    setOddsUsage,
    setIssues,
  ]);
}
