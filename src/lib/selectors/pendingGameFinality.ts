import { hasGameBeenAbandoned, type PendingGame } from '../standingsHistory';

export type PendingGameFinality = {
  /** Vacuously true when there are no pending games, matching season finality. */
  allPendingGamesConcluded: boolean;
  /** Games accepted without positive result evidence by the elapsed-time rule. */
  acceptedWithoutResult: PendingGame[];
};

/**
 * Apply the request-time abandonment allowance once for every consumer.
 *
 * A game is surfaced as accepted without a result only when the complete
 * pending population clears the season-finality gate. An individually old game
 * beside a future, TBD, or disrupted game has not yet made the season final and
 * therefore is not reported as an accepted conclusion.
 */
export function selectPendingGameFinality(input: {
  pendingGames: readonly PendingGame[];
  now: Date;
}): PendingGameFinality {
  const allPendingGamesConcluded = input.pendingGames.every((game) =>
    hasGameBeenAbandoned(game, input.now)
  );

  return {
    allPendingGamesConcluded,
    acceptedWithoutResult:
      allPendingGamesConcluded && input.pendingGames.length > 0 ? [...input.pendingGames] : [],
  };
}
