import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  getBootstrapScoreHydrationGames,
  getHydrationSeasonTypes,
  getLazyScoreHydrationGames,
  markScoreHydrationLoaded,
  type ScoreHydrationState,
} from '../../lib/scoreHydration';
import { decideRefresh } from '../../lib/refreshDecision';
import { LIVE_MANUAL_COOLDOWN_MS } from '../../lib/refreshPolicy';
import {
  LIVE_SCORE_POLL_INTERVAL_MS,
  deriveLiveScorePartitions,
  selectLiveScorePollGames,
  type LiveScorePartition,
} from '../../lib/liveScores/browserPolling';
import { getOddsQuotaGuardState } from '../../lib/api/oddsUsage';
import { fetchTeamsCatalog } from '../../lib/teamsCatalog';
import { requireAdminAuthHeaders } from '../../lib/adminAuth';
import { type CombinedOdds } from '../../lib/odds';
import { applyOddsResponse, type OddsClientResponse } from '../../lib/oddsClientPayload';
import { fetchScoresByGame, type ScorePack } from '../../lib/scores';
import { classifyScorePackStatus } from '../../lib/gameStatus';
import type { LiveScoreObservation } from '../../lib/selectors/gameDayConfidence';
import { isLiveIssue, isLiveOddsIssue } from '../../lib/cfbScheduleAppHelpers';
import type { AliasMap } from '../../lib/teamNames';
import type { AppGame } from '../../lib/schedule';
import type { OddsUsageSnapshot } from '../../lib/apiUsage';

type UseLiveRefreshParams = {
  selectedSeason: number;
  selectedTab: number | 'postseason' | null;
  selectedWeek: number | null;
  weeks: number[];
  scheduleLoaded: boolean;
  scheduleGeneration: number;
  games: AppGame[];
  visibleGames: AppGame[];
  scoreScopeGames: AppGame[];
  /**
   * Current per-game score cache (PLATFORM-086B2B). Read only to re-evaluate
   * browser live-poll eligibility each tick — a resolved-final or canceled game
   * drops out of the poll set. Not a write path; the hook still owns updates via
   * `setScoresByKey`.
   */
  scoresByKey: Record<string, ScorePack>;
  aliasMap: AliasMap;
  oddsUsage: OddsUsageSnapshot | null;
  scoreHydrationState: ScoreHydrationState;
  setScoreHydrationState: Dispatch<SetStateAction<ScoreHydrationState>>;
  setScoreHydrationCleanState: Dispatch<SetStateAction<ScoreHydrationState>>;
  setIssues: Dispatch<SetStateAction<string[]>>;
  setOddsByKey: Dispatch<SetStateAction<Record<string, CombinedOdds>>>;
  setScoresByKey: Dispatch<SetStateAction<Record<string, ScorePack>>>;
  setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>>;
  /**
   * Set the freshness timestamp of the odds cache entry served for the selected
   * season (rereview finding #2). Sourced from the odds response's own served-
   * snapshot time so the user-facing label never inherits another season's
   * recency; null when nothing is cached for the season.
   */
  setOddsSnapshotAt: Dispatch<SetStateAction<string | null>>;
  /**
   * Set the served-freshness timestamp of the scores cache (PLATFORM-086B2B):
   * the durable `meta.generatedAt` of the contributing partitions, NOT the client
   * poll time. `null` is only the initial/reset value — a failed or empty read
   * preserves the prior value rather than clearing it (the last known freshness
   * still holds), so the caller never sees freshness regress to null on a miss.
   */
  setScoresSnapshotAt: Dispatch<SetStateAction<string | null>>;
  /**
   * Set the last successful-observation timestamp (client poll time of a CLEAN
   * poll — PLATFORM-086B2B). This, NOT the durable snapshot, drives live-overlay
   * staleness: a poll that succeeds with an unchanged score (halftime, delay) is a
   * fresh observation even though the snapshot does not advance. A failed/partial
   * poll preserves the prior value so the overlay still ages toward stale.
   */
  setScoresObservedAt: Dispatch<SetStateAction<string | null>>;
  loadingLive: boolean;
  setLoadingLive: Dispatch<SetStateAction<boolean>>;
  isDebug: boolean;
  /**
   * Called once per poll when a live poll observes a real non-final → final game
   * transition (PLATFORM-080) OR a material final → final score correction from
   * `/games` reconciliation (PLATFORM-086B2B). Consumers wire this to
   * `router.refresh()` so the server `canonicalStandings` snapshot recomputes and
   * records/ranks update.
   */
  onGamesFinalized?: () => void;
};

/**
 * The material scoring signature of a final pack — the two team scores, which are
 * what canonical standings (records/points/ranks) depend on. A final→final change
 * in this signature is a `/games` reconciliation CORRECTION worth a canonical
 * refresh; a status-label-only change (e.g. `Final` → `Final/OT`) is not.
 */
function finalScoreSignature(score: ScorePack): string {
  return `${score.away.score ?? '∅'}~${score.home.score ?? '∅'}`;
}

/**
 * Transition-aware finalization detector (PLATFORM-080; correction-aware in
 * PLATFORM-086B2B). Given a poll's fetched scores, the keys of the games actually
 * watched this poll (the score request scope), and the caller-held memory of
 * previously-observed keys and each already-final game's last scoring signature,
 * returns true iff at least one game this poll either:
 *   - made a REAL non-final → final transition (a game watched in an earlier poll
 *     is now final), OR
 *   - was already final but had its SCORE materially corrected (a scoreboard
 *     provisional final later revised by `/games` reconciliation) — because the
 *     browser now keeps polling in-window finals for exactly this correction, and
 *     the corrected score must reach canonical standings, not just the game card.
 * It deliberately does NOT fire for:
 *   - a game observed for the first time that is already final (initial payload,
 *     or a game entering the score scope already final) — canonical already
 *     reflects it (or navigation will); its signature is recorded so a LATER
 *     correction is still caught,
 *   - an already-final game whose score is unchanged (no repeat refresh),
 *   - a status-label-only change on a final (same scores).
 *
 * `observedKeys` is seeded from the watched SCOPE, not the score payload, so a
 * scheduled game that carried no attached score row on earlier polls (cold/stale
 * public cache, or a failed attach) still counts as observed — otherwise its
 * later finalization would be misread as a first-seen final and suppress the
 * refresh, leaving standings stale. `observedKeys` and `finalScores` are mutated
 * in place to carry memory forward. Callers use the result to trigger exactly one
 * RSC refresh so server `canonicalStandings` recomputes; no client standings
 * derivation is involved.
 */
export function detectScoreFinalizations(params: {
  nextScores: Record<string, ScorePack>;
  scopeGameKeys: Iterable<string>;
  observedKeys: Set<string>;
  finalScores: Map<string, string>;
}): boolean {
  const { nextScores, scopeGameKeys, observedKeys, finalScores } = params;
  let transitioned = false;

  for (const [key, score] of Object.entries(nextScores)) {
    if (classifyScorePackStatus(score) !== 'final') continue;
    const signature = finalScoreSignature(score);
    if (finalScores.has(key)) {
      // Already final on an earlier poll: fire only on a material score CHANGE
      // (a `/games` reconciliation correction), not a repeat of the same score.
      if (finalScores.get(key) !== signature) transitioned = true;
      finalScores.set(key, signature);
      continue;
    }
    // First time this key is final. A refresh is warranted only if we had
    // already watched the game on an earlier poll (necessarily as non-final).
    if (observedKeys.has(key)) transitioned = true;
    finalScores.set(key, signature);
  }

  // Record every game watched this poll (whether or not it had a score row) so a
  // later finalization counts as an observed transition. Seeded AFTER the check
  // so a game first seen already-final on this poll does not self-trigger.
  for (const key of scopeGameKeys) observedKeys.add(key);

  return transitioned;
}

export function nextBootstrapGuardState(params: {
  current: boolean;
  scheduleLoaded: boolean;
  generationChanged?: boolean;
  didBootstrapThisPass?: boolean;
}): boolean {
  // Lifecycle invariant: bootstrap guard is scoped to a loaded schedule lifecycle.
  // When schedule unloads (rebuild/reset), bootstrap must re-arm for the next load.
  const {
    current,
    scheduleLoaded,
    generationChanged = false,
    didBootstrapThisPass = false,
  } = params;
  if (!scheduleLoaded) return false;
  if (generationChanged) return false;
  if (didBootstrapThisPass) return true;
  return current;
}

/** Apply a full-scope hydration outcome only to the schedule phases that request covered. */
export function updateScoreHydrationCleanState(
  state: ScoreHydrationState,
  seasonTypes: Array<'regular' | 'postseason'>,
  clean: boolean
): ScoreHydrationState {
  if (seasonTypes.length === 0) return state;
  return {
    regular: seasonTypes.includes('regular') ? clean : state.regular,
    postseason: seasonTypes.includes('postseason') ? clean : state.postseason,
  };
}

export function useLiveRefresh(params: UseLiveRefreshParams): {
  refreshLiveData: (options?: {
    manual?: boolean;
    includeOdds?: boolean;
    scoreScopeGamesOverride?: AppGame[];
    /**
     * Exact `(providerWeek, seasonType)` partitions to read cache-only
     * (PLATFORM-086B2B auto ticks). When present, scores are fetched from only
     * these partitions via week-scoped URLs — never season-wide, never a refresh.
     */
    scorePartitions?: LiveScorePartition[];
  }) => Promise<void>;
  liveScoreObservation: LiveScoreObservation | null;
} {
  const {
    selectedSeason,
    selectedTab,
    selectedWeek,
    weeks,
    scheduleLoaded,
    scheduleGeneration,
    games,
    visibleGames,
    scoreScopeGames,
    scoresByKey,
    aliasMap,
    oddsUsage,
    scoreHydrationState,
    setScoreHydrationState,
    setScoreHydrationCleanState,
    setIssues,
    setOddsByKey,
    setScoresByKey,
    setOddsUsage,
    setOddsSnapshotAt,
    setScoresSnapshotAt,
    setScoresObservedAt,
    loadingLive,
    setLoadingLive,
    isDebug,
    onGamesFinalized,
  } = params;

  const liveRefreshInFlightRef = useRef<boolean>(false);
  const lastManualLiveRefreshMsRef = useRef<number>(0);
  const lastAutoScoresRefreshMsRef = useRef<number>(0);
  const hasAutoBootstrappedLiveRef = useRef<boolean>(false);
  const bootstrappedScheduleGenerationRef = useRef<number | null>(null);
  const hasAttemptedLazyPostseasonHydrationRef = useRef<boolean>(false);
  // PLATFORM-080: memory of game keys observed across polls and those already
  // counted final, so we fire an RSC refresh only on a real non-final → final
  // transition (see detectScoreFinalizations).
  const observedScoreKeysRef = useRef<Set<string>>(new Set());
  // key → last-seen final scoring signature; carries memory of already-final games
  // AND their scores so a later `/games` correction (final→final score change) is
  // detected, not just the initial non-final → final transition (PLATFORM-086B2B).
  const finalizedScoreKeysRef = useRef<Map<string, string>>(new Map());
  const [liveScoreObservation, setLiveScoreObservation] = useState<LiveScoreObservation | null>(
    null
  );

  // Latest eligibility inputs for the visible-tab live-score timer
  // (PLATFORM-086B2B). Held in a ref so the 3-minute interval reads fresh
  // games/scores/season on each tick without the timer resetting on every score
  // update (the effect depends only on the memoized refreshLiveData).
  const liveScoreInputsRef = useRef({ games, scoresByKey, selectedSeason });
  liveScoreInputsRef.current = { games, scoresByKey, selectedSeason };

  useEffect(() => {
    const generationChanged =
      scheduleLoaded && bootstrappedScheduleGenerationRef.current !== scheduleGeneration;
    hasAutoBootstrappedLiveRef.current = nextBootstrapGuardState({
      current: hasAutoBootstrappedLiveRef.current,
      scheduleLoaded,
      generationChanged,
    });
    bootstrappedScheduleGenerationRef.current = scheduleLoaded ? scheduleGeneration : null;
    if (generationChanged) hasAttemptedLazyPostseasonHydrationRef.current = false;
  }, [scheduleGeneration, scheduleLoaded]);

  useEffect(() => {
    // Observation evidence belongs to one loaded season lifecycle. Navigation
    // within it keeps the signal; an unload/rebuild or season change clears it.
    setLiveScoreObservation(null);
  }, [scheduleGeneration, scheduleLoaded, selectedSeason]);

  const refreshLiveData = useCallback(
    async (options?: {
      manual?: boolean;
      includeOdds?: boolean;
      scoreScopeGamesOverride?: AppGame[];
      scorePartitions?: LiveScorePartition[];
    }): Promise<void> => {
      const manual = options?.manual ?? false;
      if (liveRefreshInFlightRef.current) return;

      const nowMs = Date.now();
      // Odds are NOT fetched automatically here anymore — cache-only Odds display is
      // owned by `useOddsHydration` (PLATFORM-086C3), decoupled from the kickoff
      // window. This path fetches odds ONLY when a caller explicitly opts in
      // (`includeOdds: true`), preserving the dormant authorized manual-refresh seam
      // (which pairs `manual: true` with `refresh=1` + admin auth).
      const shouldFetchOdds = options?.includeOdds ?? false;
      const quota = getOddsQuotaGuardState(oddsUsage?.remaining);
      const refreshDecision = decideRefresh({
        hasGames: games.length > 0,
        manualCooldownActive:
          manual && nowMs - lastManualLiveRefreshMsRef.current < LIVE_MANUAL_COOLDOWN_MS,
        includeOddsRequested: shouldFetchOdds,
        oddsAutoDisabledByQuota: !manual && quota.disableAutoRefresh,
      });
      if (refreshDecision.kind === 'skip') {
        if (refreshDecision.reason === 'no-games') {
          setIssues((p) => [...p, 'No games loaded. CFBD schedule load may have failed.']);
        }
        return;
      }

      // Clear this poll's transient live issues before re-deriving them — but a
      // score-only tick (`!shouldFetchOdds`) must NOT wipe an unresolved odds
      // failure it will not retry, or the user would silently lose the warning
      // that displayed odds are stale/unavailable (PLATFORM-086B2B).
      setIssues((prev) =>
        prev.filter((issue) => {
          if (!isLiveIssue(issue)) return true;
          if (!shouldFetchOdds && isLiveOddsIssue(issue)) return true;
          return false;
        })
      );

      liveRefreshInFlightRef.current = true;
      setLoadingLive(true);
      if (manual) {
        lastManualLiveRefreshMsRef.current = nowMs;
      } else {
        // Stamp the auto-poll throttle at poll INITIATION, not completion. The
        // 3-minute timer's throttle threshold equals its interval, so stamping at
        // completion would offset the mark by the fetch latency and make every
        // other tick fall a few ms short of the threshold — silently halving the
        // cadence to ~6 minutes. Anchoring to `nowMs` keeps consecutive ticks
        // exactly one interval apart.
        lastAutoScoresRefreshMsRef.current = nowMs;
      }

      try {
        const teams = await fetchTeamsCatalog().catch(() => []);

        if (refreshDecision.reason === 'odds-disabled-by-quota') {
          setIssues((p) => [
            ...p,
            `Odds auto-refresh skipped: low remaining quota (${oddsUsage?.remaining ?? 'unknown'}).`,
          ]);
        }

        if (refreshDecision.kind === 'scores_and_odds') {
          if (manual && quota.manualWarningOnly) {
            setIssues((p) => [
              ...p,
              `Odds refresh warning: remaining quota critically low (${oddsUsage?.remaining ?? 'unknown'}).`,
            ]);
          }
          try {
            const oddsRes = await fetch(
              `/api/odds?year=${selectedSeason}${manual ? '&refresh=1' : ''}`,
              {
                cache: 'no-store',
                headers: manual ? requireAdminAuthHeaders() : undefined,
              }
            );
            if (oddsRes.ok) {
              const oddsPayload = (await oddsRes.json()) as OddsClientResponse;
              // Shared decoder (PLATFORM-086C3): decodes `{ items, meta }` and applies
              // it — served-snapshot freshness for THIS season, and usage merged
              // freshness-aware so it never clobbers a newer admin usage reading.
              applyOddsResponse(oddsPayload, { setOddsByKey, setOddsSnapshotAt, setOddsUsage });
            } else {
              const t = await oddsRes.text().catch(() => '');
              setIssues((p) => [
                ...p,
                oddsRes.status === 402 || oddsRes.status === 429
                  ? `Odds quota error ${oddsRes.status}: ${t}`
                  : `Odds error ${oddsRes.status}: ${t}`,
              ]);
            }
          } catch (err) {
            setIssues((p) => [...p, `Odds fetch failed: ${(err as Error).message}`]);
          }
        }

        // Attachment invariant: scores are always requested against schedule-derived game scope.
        const scoreScopeForRequest = options?.scoreScopeGamesOverride ?? scoreScopeGames;
        const hydrationSeasonTypes = options?.scorePartitions
          ? []
          : getHydrationSeasonTypes(scoreScopeForRequest);

        try {
          const {
            scoresByKey: nextScores,
            issues: scoreIssues,
            snapshotAt,
            liveObservedAt,
            debugSnapshot,
          } = await fetchScoresByGame({
            games,
            fallbackScopeGames: scoreScopeForRequest,
            aliasMap,
            season: selectedSeason,
            teams,
            debugTrace: isDebug,
            // Manual refresh authorizes the scores upstream refresh (mirrors the
            // odds path) so it can update scores; the public/auto path stays
            // cache-only (PLATFORM-075). The manual trigger is retained refresh
            // infrastructure — no live caller passes it since AdminDebugSurface
            // was removed, but the authorized-refresh capability is preserved.
            refresh: manual,
            authHeaders: manual ? requireAdminAuthHeaders() : undefined,
            // Auto ticks read only the exact kickoff-window partitions cache-only;
            // omitted (season-wide) for hydration and manual refresh.
            partitions: options?.scorePartitions,
          });

          if (isDebug) {
            console.log('scores refresh scope', {
              selectedTab,
              selectedWeek,
              regularWeeks: weeks,
              visibleGamesCount: visibleGames.length,
              visibleGamesSample: visibleGames.slice(0, 5).map((game) => game.key),
              visibleSeasonTypes: Array.from(
                new Set(
                  visibleGames.map((game) => (game.stage === 'regular' ? 'regular' : 'postseason'))
                )
              ),
              visibleWeeks: Array.from(new Set(visibleGames.map((game) => game.week))).sort(
                (a, b) => a - b
              ),
              scoreScopeCount: scoreScopeForRequest.length,
              scoreScopeSample: scoreScopeForRequest.slice(0, 5).map((game) => game.key),
              scoreScopeSeasonTypes: Array.from(
                new Set(
                  scoreScopeForRequest.map((game) =>
                    game.stage === 'regular' ? 'regular' : 'postseason'
                  )
                )
              ),
              scoreScopeWeeks: Array.from(
                new Set(scoreScopeForRequest.map((game) => game.week))
              ).sort((a, b) => a - b),
              emptyScopeEarlyReturn: scoreScopeForRequest.length === 0,
              providerRowCount: debugSnapshot?.providerRowCount ?? null,
              attachedScoreCount: debugSnapshot?.attachedCount ?? null,
              scoreRequests: debugSnapshot?.requestUrls ?? [],
            });
          }

          if (scoreIssues.length) setIssues((p) => [...p, ...scoreIssues]);
          // Hydration/manual reads (no exact partitions) cannot establish or renew
          // this evidence. They leave any prior exact-poll observation at its
          // original timestamp, so navigation preserves it only until the selector TTL.
          if (options?.scorePartitions) {
            const attachedGameKeys = Object.keys(nextScores);
            // Header confidence covers the whole exact-partition poll, not one
            // lucky sibling. Any requested-partition issue makes that read
            // incomplete, so fail closed even when another game attached.
            setLiveScoreObservation(
              liveObservedAt && scoreIssues.length === 0 && attachedGameKeys.length > 0
                ? { observedAt: liveObservedAt, attachedGameKeys }
                : null
            );
          }
          setScoresByKey((prev) => {
            const retained: Record<string, ScorePack> = {};
            for (const game of games) {
              const nextScore = nextScores[game.key];
              if (nextScore) {
                retained[game.key] = nextScore;
                continue;
              }
              const prevScore = prev[game.key];
              if (prevScore) {
                retained[game.key] = prevScore;
              }
            }
            return retained;
          });

          // PLATFORM-080: if this poll observed a game transition non-final →
          // final, refresh the RSC tree so server canonicalStandings recomputes
          // (the /api/scores write path already invalidated the standings tag).
          // liveDelta excludes final games, so without this the new final would
          // not reach standings until navigation. Transition-gated: never fires
          // on the initial payload's already-final games or repeat finals.
          const observedFinalization = detectScoreFinalizations({
            nextScores,
            // Seed observed from the watched scope (not the score payload) so a
            // scheduled game with no attached score row is still tracked and its
            // later finalization triggers the refresh.
            scopeGameKeys: scoreScopeForRequest.map((g) => g.key),
            observedKeys: observedScoreKeysRef.current,
            finalScores: finalizedScoreKeysRef.current,
          });
          if (observedFinalization) onGamesFinalized?.();

          // Two DISTINCT freshness signals (PLATFORM-086B2B):
          //  1. `scoresSnapshotAt` (durable served-snapshot = last time a row
          //     materially changed) drives the "Scores updated …" data-freshness
          //     label. Null (empty/suppressed) preserves the prior value.
          //  2. `scoresObservedAt` (client time of a CLEAN successful poll) drives
          //     the live-overlay staleness. It must NOT be the data-change time:
          //     during a halftime/delay a poll succeeds with an unchanged row, so
          //     the overlay stays fresh (we are observing) even though the snapshot
          //     does not advance. Only a clean poll (no partition read failures)
          //     counts as an observation; a failed/partial poll preserves the prior
          //     value so the overlay ages honestly toward stale.
          if (snapshotAt) setScoresSnapshotAt(snapshotAt);
          if (scoreIssues.length === 0) setScoresObservedAt(new Date().toISOString());
          // Only a HYDRATION request (season-wide bootstrap / lazy full-tab load)
          // may mark a season type hydrated. An exact-partition auto tick
          // (`scorePartitions` present) reads only a subset of a season type's
          // partitions, so marking the whole type hydrated would let
          // `getLazyScoreHydrationGames` skip the real full load — leaving other
          // partitions' scores absent (e.g. one in-window bowl marking all of
          // postseason hydrated). Targeted ticks never complete hydration.
          if (!options?.scorePartitions) {
            setScoreHydrationCleanState((prev) =>
              updateScoreHydrationCleanState(prev, hydrationSeasonTypes, scoreIssues.length === 0)
            );
            if (hydrationSeasonTypes.length > 0) {
              setScoreHydrationState((prev) =>
                markScoreHydrationLoaded(prev, hydrationSeasonTypes)
              );
            }
          }
          // The auto-poll throttle was stamped at poll initiation (above), not here,
          // so the timer's cadence is not offset by fetch latency.
        } catch (err) {
          if (!options?.scorePartitions) {
            setScoreHydrationCleanState((prev) =>
              updateScoreHydrationCleanState(prev, hydrationSeasonTypes, false)
            );
          }
          if (options?.scorePartitions) setLiveScoreObservation(null);
          setIssues((p) => [...p, `Scores fetch failed: ${(err as Error).message}`]);
        }
      } finally {
        liveRefreshInFlightRef.current = false;
        setLoadingLive(false);
      }
    },
    [
      aliasMap,
      games,
      isDebug,
      oddsUsage,
      onGamesFinalized,
      scoreScopeGames,
      selectedSeason,
      selectedTab,
      selectedWeek,
      setIssues,
      setScoresSnapshotAt,
      setScoresObservedAt,
      setOddsByKey,
      setOddsUsage,
      setOddsSnapshotAt,
      setScoreHydrationState,
      setScoreHydrationCleanState,
      setScoresByKey,
      visibleGames,
      weeks,
    ]
  );

  // Latest `refreshLiveData` for the visible-tab timer (PLATFORM-086B2B). The
  // callback's identity changes on every navigation (games/visibleGames/tab/week/
  // season are in its deps); reading it through a ref keeps the 3-minute interval
  // effect stable so navigation cannot tear down and re-arm the interval — which
  // would restart its countdown and starve the auto-poll under active clicking.
  const refreshLiveDataRef = useRef(refreshLiveData);
  refreshLiveDataRef.current = refreshLiveData;

  useEffect(() => {
    if (!scheduleLoaded || hasAutoBootstrappedLiveRef.current) return;
    const bootstrapScoreGames = getBootstrapScoreHydrationGames({
      games,
      selectedTab,
    });

    if (bootstrapScoreGames.length === 0) return;

    hasAutoBootstrappedLiveRef.current = nextBootstrapGuardState({
      current: hasAutoBootstrappedLiveRef.current,
      scheduleLoaded,
      didBootstrapThisPass: true,
    });
    // Score-only bootstrap — Odds are hydrated separately by `useOddsHydration`
    // (PLATFORM-086C3), never through this live-refresh path.
    void refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: bootstrapScoreGames,
    });
  }, [games, refreshLiveData, scheduleGeneration, scheduleLoaded, selectedTab]);

  // Visible-tab live-score polling (PLATFORM-086B2B): a self-rescheduling 3-minute
  // timer that re-evaluates eligibility every tick AND whenever the tab gains
  // focus/becomes visible, so a page opened before kickoff arms itself as the
  // window opens without any re-render. Eligible games are read cache-only from
  // just their `(providerWeek, seasonType)` partitions.
  //
  // The next tick is always scheduled ONE interval after the LAST attempt rather
  // than on a fixed wall-clock grid: a `setInterval` grid desyncs from the
  // last-poll throttle, so an off-grid focus/visibility poll would leave the next
  // grid tick throttled out and stretch the effective cadence to ~2 intervals. A
  // rescheduling timeout keeps every gap between polls at ~one interval. Polls
  // fire only while visible; the throttle dedupes rapid focus/visibility events.
  useEffect(() => {
    if (!scheduleLoaded) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const attemptPoll = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastAutoScoresRefreshMsRef.current < LIVE_SCORE_POLL_INTERVAL_MS) return;
      const {
        games: currentGames,
        scoresByKey: currentScores,
        selectedSeason: currentSeason,
      } = liveScoreInputsRef.current;
      const eligibleGames = selectLiveScorePollGames({
        games: currentGames,
        scoresByKey: currentScores,
        season: currentSeason,
      });
      if (eligibleGames.length === 0) return;
      // `lastAutoScoresRefreshMsRef` is stamped at poll initiation inside
      // refreshLiveData, so `reschedule()` below lands the next tick one interval
      // after this poll starts.
      void refreshLiveDataRef.current({
        manual: false,
        includeOdds: false,
        scoreScopeGamesOverride: eligibleGames,
        scorePartitions: deriveLiveScorePartitions(eligibleGames),
      });
    };

    // Always re-arm one interval out; the throttle inside attemptPoll bounds the
    // real poll rate, and re-arming after event polls keeps the cadence steady.
    const reschedule = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        attemptPoll();
        reschedule();
      }, LIVE_SCORE_POLL_INTERVAL_MS);
    };

    const onVisible = (): void => {
      const before = lastAutoScoresRefreshMsRef.current;
      attemptPoll();
      // If this event actually polled, restart the countdown from it so the next
      // tick is one interval away (not left on the previous, now-stale schedule).
      if (lastAutoScoresRefreshMsRef.current !== before) reschedule();
    };

    reschedule();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Intentionally NOT depending on `refreshLiveData` — it is read via a ref so
    // the timer survives navigation (see refreshLiveDataRef above). The timer arms
    // once per loaded schedule and reads fresh inputs each tick.
  }, [scheduleLoaded]);

  useEffect(() => {
    if (selectedTab !== 'postseason') {
      hasAttemptedLazyPostseasonHydrationRef.current = false;
      return;
    }

    if (!scheduleLoaded || loadingLive) return;

    const lazyPostseasonGames = getLazyScoreHydrationGames({
      games,
      selectedTab,
      hydrationState: scoreHydrationState,
      hasAttemptedPostseasonHydration: hasAttemptedLazyPostseasonHydrationRef.current,
    });

    if (lazyPostseasonGames.length === 0) return;

    hasAttemptedLazyPostseasonHydrationRef.current = true;
    void refreshLiveData({
      manual: false,
      includeOdds: false,
      scoreScopeGamesOverride: lazyPostseasonGames,
    });
  }, [games, loadingLive, refreshLiveData, scheduleLoaded, scoreHydrationState, selectedTab]);

  return { refreshLiveData, liveScoreObservation };
}
