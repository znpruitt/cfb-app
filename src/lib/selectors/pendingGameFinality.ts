import { hasGameBeenAbandoned, type PendingGame } from '../standingsHistory';

export type PendingGameFinality = {
  /** Vacuously true when the caller-defined pending population is empty. */
  allPendingGamesConcluded: boolean;
  /** Games accepted without positive result evidence by the elapsed-time rule. */
  acceptedWithoutResult: PendingGame[];
};

/**
 * Apply the request-time abandonment allowance to a caller-defined population.
 *
 * A game is surfaced as accepted without a result only when the complete
 * input population clears the gate. An individually old game beside a future,
 * TBD, or disrupted sibling is therefore not reported as an accepted conclusion.
 * The caller owns the population boundary; this result alone does not imply that
 * an entire week or season is final.
 *
 * Disrupted-label vocabulary is a FORWARD-LOOKING guard, not observed behaviour: read the
 * measurement note above `DISRUPTED_RE` in `src/lib/gameStatus.ts` before reasoning from this
 * comment (Item 661).
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
