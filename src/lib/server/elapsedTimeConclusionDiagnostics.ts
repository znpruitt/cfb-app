import { selectPendingGameFinality } from '../selectors/pendingGameFinality.ts';
import type { LiveScoreContext } from '../liveScores/canonicalContext.ts';
import {
  buildProviderDiagnosticGameRef,
  type ProviderDiagnosticGameRef,
} from './scoreGapDiagnostics.ts';

export type ElapsedTimeConclusionCoverage = {
  /** Complete accepted population, including any game without a provider id. */
  affectedGameCount: number;
  /** Provider-addressable identities available for bounded operator display. */
  games: ProviderDiagnosticGameRef[];
};

/**
 * PLATFORM-113 — project the league-agnostic canonical pending-game inference
 * into the cache-only operator diagnostics model.
 *
 * `pendingGames` is derived by the same authority used by standings. The shared
 * selector then owns the eight-hour/all-pending gate. This adapter adds only
 * canonical provider identities; it does not reinterpret conclusion evidence,
 * time, or any league-scoped postseason override.
 */
export function deriveElapsedTimeConclusionCoverage(input: {
  context: LiveScoreContext;
  now: Date;
}): ElapsedTimeConclusionCoverage {
  const selection = selectPendingGameFinality({
    pendingGames: input.context.pendingGames,
    now: input.now,
  });
  const canonicalByKey = new Map(
    input.context.games.map((game) => [game.canonical.key, game.canonical] as const)
  );
  const games = selection.acceptedWithoutResult.flatMap((pending) => {
    const canonical = canonicalByKey.get(pending.key);
    return canonical ? [buildProviderDiagnosticGameRef(canonical, 'elapsed-time-conclusion')] : [];
  });

  return {
    affectedGameCount: selection.acceptedWithoutResult.length,
    games,
  };
}
