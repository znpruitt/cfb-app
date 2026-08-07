import type { TestLeagueLifecycleState } from './leagueRegistry.ts';

/**
 * PLATFORM-086F2H3B1 — the client-safe result contract for the demo-league
 * lifecycle controls, and the operator language derived from it.
 *
 * Before this, `setTestLeagueStatus` and `resetTestLeague` were `Promise<void>`
 * and THREW on every refusal, so the registry's closed outcomes — which already
 * distinguished a corrupt stored year from an unsupported state from a missing
 * league — were discarded at the action boundary and the operator saw a generic
 * Server Action rejection. In production that message is REDACTED, so the client
 * could not have recovered the reason by parsing it either.
 *
 * This is a deliberately SMALLER union than `TestLeagueLifecycleOutcome`: the
 * action translates rather than passing authority internals to the client, so a
 * future registry outcome does not automatically become a UI concern.
 *
 * Type-only import keeps this module free of server code.
 */

/** Why a lifecycle control refused. Both unusable-year outcomes collapse here. */
export type TestControlRefusalReason =
  | 'unusable-lifecycle'
  | 'unsupported-state'
  | 'league-not-found';

export type TestControlResult =
  /**
   * Committed, and the lifecycle state CHANGED. `cacheStale` marks the case
   * where the write succeeded but post-commit revalidation threw: the transition
   * is durable and cached views are merely stale, which is a different operator
   * condition from a failed write and must not be reported as one.
   *
   * It covers BOTH the standings tag and the admin path, because they share one
   * Next revalidation store — a fault takes both, so a message naming only the
   * standings cache would understate what is stale.
   */
  | {
      kind: 'applied';
      state: TestLeagueLifecycleState;
      year: number | null;
      cacheStale: boolean;
    }
  /**
   * Committed, but the lifecycle state was ALREADY what was requested. These
   * controls make that easy to hit — re-requesting `preseason` deliberately does
   * not double-increment, and `season`/`offseason` are idempotent.
   *
   * A claim about the LIFECYCLE only. An identical status can still write, since
   * `applyLifecycleStatus` may heal a desynchronized `league.year`; the copy
   * below never says "nothing was written".
   */
  | { kind: 'no-change'; state: TestLeagueLifecycleState; year: number | null }
  | { kind: 'refused'; reason: TestControlRefusalReason }
  /** An unexpected failure. Carries NO message — see `describeTestControlResult`. */
  | { kind: 'failed' };

/** How a message should read; the component maps this to colour only. */
export type TestControlFeedbackTone = 'success' | 'neutral' | 'error';

export type TestControlFeedback = {
  tone: TestControlFeedbackTone;
  message: string;
};

function stateLabel(state: TestLeagueLifecycleState, year: number | null): string {
  if (state === 'offseason') return 'Offseason';
  const name = state === 'preseason' ? 'Preseason' : 'Season';
  return year === null ? name : `${name} ${year}`;
}

/**
 * Operator language for a lifecycle-control result.
 *
 * `failed` produces GENERIC copy on purpose. The previous control rendered
 * `(err as Error).message` from a caught Server Action rejection, which in
 * production is an opaque digest string — an unreadable identifier presented as
 * an explanation. A thrown error's text is never operator copy.
 */
export function describeTestControlResult(result: TestControlResult): TestControlFeedback {
  switch (result.kind) {
    case 'applied':
      return {
        tone: 'success',
        message: result.cacheStale
          ? `Moved to ${stateLabel(result.state, result.year)}. Cached views may be briefly stale.`
          : `Moved to ${stateLabel(result.state, result.year)}.`,
      };
    case 'no-change':
      return { tone: 'neutral', message: `Already in ${stateLabel(result.state, result.year)}.` };
    case 'refused':
      return { tone: 'error', message: describeTestControlRefusal(result.reason) };
    case 'failed':
      return { tone: 'error', message: 'Something went wrong. No change was confirmed.' };
  }
}

/** Stable refusal copy, exported so tests pin the reason mapping directly. */
export function describeTestControlRefusal(reason: TestControlRefusalReason): string {
  switch (reason) {
    case 'unusable-lifecycle':
      return 'The stored lifecycle is invalid. No change was made.';
    case 'unsupported-state':
      return 'That lifecycle state is not supported. No change was made.';
    case 'league-not-found':
      return 'The demo league was not found. No change was made.';
  }
}

/**
 * PLATFORM-086F2H3B1 — the draft auto-complete control's result.
 *
 * It is typed for the same reason the lifecycle controls are: it used to throw
 * messages the client rendered directly, and in production a Server Action's
 * error text is redacted to a digest. Replacing that with generic copy would
 * have LOST information rather than fixed it — "no draft exists" and "the draft
 * is already complete" are different answers, and the operator needs both.
 */
export type AutoCompleteDraftResult =
  | { kind: 'completed'; picks: number }
  | {
      kind: 'refused';
      reason:
        | 'league-not-found'
        | 'no-draft'
        | 'already-complete'
        | 'no-draft-order'
        | 'slots-filled';
    }
  | { kind: 'refused-not-enough-teams'; available: number; needed: number };

export function describeAutoCompleteDraftResult(
  result: AutoCompleteDraftResult
): TestControlFeedback {
  if (result.kind === 'completed') {
    return {
      tone: result.picks > 0 ? 'success' : 'neutral',
      message: `Auto-completed ${result.picks} pick${result.picks === 1 ? '' : 's'}.`,
    };
  }
  if (result.kind === 'refused-not-enough-teams') {
    return {
      tone: 'error',
      message: `Not enough available teams (${result.available}) to fill ${result.needed} remaining picks.`,
    };
  }
  switch (result.reason) {
    case 'league-not-found':
      return { tone: 'error', message: 'The demo league was not found.' };
    case 'no-draft':
      return { tone: 'error', message: 'No draft exists for the demo league this season.' };
    case 'already-complete':
      return { tone: 'neutral', message: 'The draft is already complete.' };
    case 'no-draft-order':
      return { tone: 'error', message: 'The draft has no draft order configured.' };
    case 'slots-filled':
      return { tone: 'neutral', message: 'All pick slots are already filled.' };
  }
}
