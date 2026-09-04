import { getGameOwners } from '../gameOwnership.ts';
import { gameStateFromScore } from '../gameUi.ts';
import { getGameParticipantTeamId, type AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';
import { NO_CLAIM_OWNER } from '../standings.ts';
import type { CanonicalStandings } from './leagueStandings.ts';

/**
 * Default client-poll watchdog: 7 minutes (PLATFORM-086B2B). This wall-clock
 * threshold bounds how long a member-facing live overlay stays fresh when browser
 * polling wedges. The 90-second browser cadence means this intentionally remains
 * the existing product threshold rather than a two-missed-tick bound; provider-data
 * freshness is governed separately by the unchanged server refresh cadence.
 */
export const DEFAULT_LIVE_DELTA_STALE_THRESHOLD_MS = 7 * 60 * 1000;

export type LiveGameStatus = 'scheduled' | 'inprogress' | 'final' | 'unknown';

/**
 * Per-game annotation derived from the live scores cache. `score` is the raw
 * polled pack so consumers can render whatever projection of it they need;
 * `participantTeamIds` is convenient for matrix/matchup highlight wiring
 * without re-walking `game.participants`.
 */
export type LiveGameDelta = {
  status: LiveGameStatus;
  score: ScorePack | null;
  participantTeamIds: string[];
};

/**
 * Per-owner pending diff aggregated from in-progress games only. `pendingWins`
 * counts in-progress games where the owner is currently leading; a tied game
 * or a live score awaiting numeric points contributes a zero-decision delta so
 * consumers can still render `+0–0`. Final games are intentionally excluded —
 * those are already reflected in the canonical snapshot.
 */
export type LivePendingOwnerDelta = {
  owner: string;
  pendingWins: number;
  pendingLosses: number;
  pendingPointsFor: number;
  pendingPointsAgainst: number;
};

export type LiveDelta = {
  /** Identifies the "current unresolved week" context this delta describes. */
  weekKey: string;
  /** Generation timestamp for downstream coherence checks / debugging. */
  generatedAt: string;
  /** Per-game annotations keyed by `game.key`. */
  byGame: Record<string, LiveGameDelta>;
  /** Per-owner pending diffs keyed by owner name (NoClaim excluded). */
  byOwner: Record<string, LivePendingOwnerDelta>;
  /**
   * `true` when the most recent successful scores fetch is older than
   * `staleThresholdMs`, OR when no fetch has ever completed. Consumers can use
   * this to dim "live" badges or annotate that the overlay is not fresh.
   */
  isStale: boolean;
};

export type SelectLiveDeltaInput = {
  /** Canonical snapshot. Currently unused by the computation but accepted so
   *  later phases can reconcile delta vs. canonical without changing the
   *  selector signature. */
  canonical: CanonicalStandings | null;
  scoresByKey: Record<string, ScorePack>;
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  weekKey: string;
  /** ISO 8601 (or any `Date`-parseable) timestamp of the last successful scores
   *  fetch. `null` means scores have never been fetched in this session. */
  lastFetchedAt: string | null;
  staleThresholdMs?: number;
  /** Override the "current time" anchor. Defaults to `Date.now()`. Tests pass
   *  a fixed value to keep the selector deterministic. */
  now?: number;
};

/**
 * Pure selector that derives the client-side live overlay from polled scores.
 *
 * Architectural contract: canonical owns the "official" standings rows and
 * history; this selector owns only the partial-week annotations layered on
 * top. Consumers receive both as separate inputs and decide which surfaces
 * render the overlay (badges, chips, "leading right now" indicators).
 *
 * Determinism: same inputs produce the same outputs. The only time-dependent
 * input is `now`, which defaults to `Date.now()` but can be overridden so
 * tests are stable.
 */
export function selectLiveDelta(input: SelectLiveDeltaInput): LiveDelta {
  const {
    scoresByKey,
    games,
    rosterByTeam,
    weekKey,
    lastFetchedAt,
    staleThresholdMs = DEFAULT_LIVE_DELTA_STALE_THRESHOLD_MS,
    now = Date.now(),
  } = input;

  const byGame: Record<string, LiveGameDelta> = {};
  const byOwner: Record<string, LivePendingOwnerDelta> = {};

  for (const game of games) {
    const score = scoresByKey[game.key];
    const status = gameStateFromScore(score);
    const participantTeamIds = collectParticipantTeamIds(game);

    byGame[game.key] = {
      status,
      score: score ?? null,
      participantTeamIds,
    };

    if (status !== 'inprogress' || !score) continue;

    const { awayOwner, homeOwner } = getGameOwners(game, rosterByTeam);
    if (awayOwner && awayOwner !== NO_CLAIM_OWNER) {
      ensurePendingOwner(byOwner, awayOwner);
    }
    if (homeOwner && homeOwner !== NO_CLAIM_OWNER) {
      ensurePendingOwner(byOwner, homeOwner);
    }

    const awayScore = score.away.score;
    const homeScore = score.home.score;
    if (awayScore == null || homeScore == null) continue;

    if (awayOwner && awayOwner !== NO_CLAIM_OWNER) {
      const isLeading = awayScore > homeScore;
      const isTrailing = awayScore < homeScore;
      accumulatePending(byOwner, awayOwner, {
        win: isLeading ? 1 : 0,
        loss: isTrailing ? 1 : 0,
        pointsFor: awayScore,
        pointsAgainst: homeScore,
      });
    }

    if (homeOwner && homeOwner !== NO_CLAIM_OWNER) {
      const isLeading = homeScore > awayScore;
      const isTrailing = homeScore < awayScore;
      accumulatePending(byOwner, homeOwner, {
        win: isLeading ? 1 : 0,
        loss: isTrailing ? 1 : 0,
        pointsFor: homeScore,
        pointsAgainst: awayScore,
      });
    }
  }

  return {
    weekKey,
    generatedAt: new Date(now).toISOString(),
    byGame,
    byOwner,
    isStale: deriveIsStale(lastFetchedAt, now, staleThresholdMs),
  };
}

function collectParticipantTeamIds(game: AppGame): string[] {
  const ids: string[] = [];
  const away = getGameParticipantTeamId(game, 'away');
  const home = getGameParticipantTeamId(game, 'home');
  if (away) ids.push(away);
  if (home) ids.push(home);
  return ids;
}

function accumulatePending(
  byOwner: Record<string, LivePendingOwnerDelta>,
  owner: string,
  contribution: { win: number; loss: number; pointsFor: number; pointsAgainst: number }
): void {
  const existing = ensurePendingOwner(byOwner, owner);
  byOwner[owner] = {
    owner,
    pendingWins: existing.pendingWins + contribution.win,
    pendingLosses: existing.pendingLosses + contribution.loss,
    pendingPointsFor: existing.pendingPointsFor + contribution.pointsFor,
    pendingPointsAgainst: existing.pendingPointsAgainst + contribution.pointsAgainst,
  };
}

function ensurePendingOwner(
  byOwner: Record<string, LivePendingOwnerDelta>,
  owner: string
): LivePendingOwnerDelta {
  const existing = byOwner[owner];
  if (existing) return existing;

  const pending = {
    owner,
    pendingWins: 0,
    pendingLosses: 0,
    pendingPointsFor: 0,
    pendingPointsAgainst: 0,
  };
  byOwner[owner] = pending;
  return pending;
}

function deriveIsStale(lastFetchedAt: string | null, now: number, thresholdMs: number): boolean {
  if (!lastFetchedAt) return true;
  const parsed = Date.parse(lastFetchedAt);
  if (!Number.isFinite(parsed)) return true;
  return now - parsed > thresholdMs;
}

/**
 * Resolves the last-known pending delta for one owner without making a
 * freshness claim. A zero-decision delta is meaningful here: it represents an
 * in-progress game that is currently tied or awaiting numeric scores.
 *
 * Consumers must pair this accessor with their own current game-state gate.
 * That keeps stale-score policy honest: the delta decides what a badge says,
 * while current game state decides whether the badge still renders.
 */
export function selectOwnerPendingDelta(
  liveDelta: LiveDelta | null | undefined,
  owner: string | null | undefined
): LivePendingOwnerDelta | null {
  if (!liveDelta || !owner || owner === NO_CLAIM_OWNER) return null;
  return liveDelta.byOwner[owner] ?? null;
}

/**
 * Resolves owners whose currently attached score is in progress. This selector
 * deliberately reads the current score packs rather than `liveDelta.byGame`,
 * because a held stale delta must stop rendering as soon as a newer score marks
 * the game final.
 */
export function selectOwnersWithInProgressGames(input: {
  scoresByKey: Record<string, ScorePack>;
  games: AppGame[];
  rosterByTeam: Map<string, string>;
}): Set<string> {
  const owners = new Set<string>();

  for (const game of input.games) {
    if (gameStateFromScore(input.scoresByKey[game.key]) !== 'inprogress') continue;
    const { awayOwner, homeOwner } = getGameOwners(game, input.rosterByTeam);
    if (awayOwner && awayOwner !== NO_CLAIM_OWNER) owners.add(awayOwner);
    if (homeOwner && homeOwner !== NO_CLAIM_OWNER) owners.add(homeOwner);
  }

  return owners;
}

/**
 * Resolves the fresh, decision-bearing pending delta for a single owner, or
 * `null` when no live badge should render. Centralizes the rules shared by the
 * Standings and Members "Live this week" annotations:
 *
 *  - stale overlays are suppressed (`liveDelta.isStale`),
 *  - a missing owner / missing delta yields `null`,
 *  - `NoClaim` is never annotated,
 *  - a zero-decision delta (no pending wins or losses — e.g. only tied or
 *    score-unavailable in-progress games) yields `null`.
 *
 * This is a pure read of the overlay; it never mutates canonical rows and does
 * not compute projected rank/record/win%/differential.
 */
export function selectFreshOwnerPendingDelta(
  liveDelta: LiveDelta | null | undefined,
  owner: string | null | undefined
): LivePendingOwnerDelta | null {
  if (!liveDelta || liveDelta.isStale) return null;
  const pending = selectOwnerPendingDelta(liveDelta, owner);
  if (!pending) return null;
  if (pending.pendingWins + pending.pendingLosses <= 0) return null;
  return pending;
}
