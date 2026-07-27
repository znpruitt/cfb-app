import type { CanonicalGame } from '@/lib/gameStats/canonicalSlate';
import { classifyScorePackStatus } from '@/lib/gameStatus';
import { toScorePackFromCfbd } from '@/lib/scores/normalizers';
import type { CfbdGameLoose, ScorePack } from '@/lib/scores/types';

import type { LiveScoreGame } from './canonicalContext';
import type { ScoreUpdate } from './scoreMerge';

/**
 * PLATFORM-086B1 — final reconciliation of scoreboard finals against CFBD
 * `/games`.
 *
 * A scoreboard `completed` row is displayed as final immediately but recorded
 * pending; this pass confirms it with the authoritative `/games` endpoint for
 * one exact week partition. It reuses the shared `/games` normalizer
 * (`toScorePackFromCfbd`) and its empty/schema-drift protections rather than
 * duplicating them. A pending id is confirmed ONLY when `/games` reports exactly
 * one row for it that is completed (final) with BOTH scores present; the final
 * is then applied through the same durable merge and the id is cleared. Missing,
 * ambiguous, or not-yet-final ids stay pending. A scoreboard final is never
 * regressed (the merge's monotonic protection enforces this).
 */

export type FinalReconciliationParse =
  | { kind: 'invalid-payload' }
  | { kind: 'empty-unexpected' }
  | {
      kind: 'parsed';
      /** Confirmed finals to durably apply/correct (schedule-oriented). */
      updates: ScoreUpdate[];
      /** Provider ids confirmed final (cleared from the pending set). */
      confirmedIds: string[];
      /** Pending targets considered this run. */
      pendingTargetCount: number;
    };

function buildConfirmedFinalPack(canonical: CanonicalGame, gamesPack: ScorePack): ScorePack {
  return {
    id: String(canonical.providerGameId),
    seasonType: canonical.seasonType,
    startDate: canonical.kickoff,
    week: canonical.providerWeek,
    status: 'final',
    home: {
      team: canonical.home?.canonicalName ?? gamesPack.home.team,
      score: gamesPack.home.score,
    },
    away: {
      team: canonical.away?.canonicalName ?? gamesPack.away.team,
      score: gamesPack.away.score,
    },
    time: canonical.kickoff,
  };
}

/**
 * Parse a `/games` payload against the pending confirmation targets for one
 * partition. Pure — the caller performs the durable merge and provider-status
 * bookkeeping. A non-array payload is `invalid-payload`; an empty array while
 * confirmation targets exist is `empty-unexpected` (both failures that preserve
 * prior-good state).
 */
export function parseFinalReconciliation(params: {
  payload: unknown;
  pendingGames: LiveScoreGame[];
}): FinalReconciliationParse {
  const { payload, pendingGames } = params;
  if (!Array.isArray(payload)) return { kind: 'invalid-payload' };

  const pendingByProviderId = new Map<string, LiveScoreGame>();
  for (const game of pendingGames) {
    pendingByProviderId.set(String(game.canonical.providerGameId), game);
  }

  if (payload.length === 0) {
    return pendingByProviderId.size > 0
      ? { kind: 'empty-unexpected' }
      : { kind: 'parsed', updates: [], confirmedIds: [], pendingTargetCount: 0 };
  }

  // Group normalized `/games` rows by provider id. Only completed rows with both
  // scores can confirm a final.
  const packsByProviderId = new Map<string, ScorePack[]>();
  for (const raw of payload) {
    const pack = toScorePackFromCfbd(raw as CfbdGameLoose);
    const id = pack?.id?.trim();
    if (!pack || !id) continue;
    const bucket = packsByProviderId.get(id);
    if (bucket) bucket.push(pack);
    else packsByProviderId.set(id, [pack]);
  }

  const updates: ScoreUpdate[] = [];
  const confirmedIds: string[] = [];
  for (const [providerId, game] of pendingByProviderId) {
    const candidates = packsByProviderId.get(providerId) ?? [];
    if (candidates.length !== 1) continue; // absent or ambiguous → stays pending
    const pack = candidates[0]!;
    if (classifyScorePackStatus(pack) !== 'final') continue; // not final yet → stays pending
    if (pack.home.score === null || pack.away.score === null) continue; // incomplete → stays pending
    updates.push({ pack: buildConfirmedFinalPack(game.canonical, pack), provisionalFinal: false });
    confirmedIds.push(providerId);
  }

  return {
    kind: 'parsed',
    updates,
    confirmedIds,
    pendingTargetCount: pendingByProviderId.size,
  };
}
