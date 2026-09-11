import type { ScorePack } from './scores.ts';

export type GameStatusBucket = 'scheduled' | 'inprogress' | 'final' | 'disrupted';

export type GameConclusionEvidence = {
  status: string;
  rawStatus?: string | null;
  completed?: boolean | null;
};

export type GameConclusionKind = 'score-required' | 'scoreless-terminal' | 'unresolved';

/**
 * THE DISRUPTED VOCABULARY IS A FORWARD-LOOKING GUARD. NO DISRUPTED LABEL IS RESTING IN EITHER
 * CACHE.
 *
 * This is the one authoritative record of that measurement. Every other comment in `src/` that
 * names `postponed` / `canceled` / `suspended` / `delayed` defers here instead of restating it,
 * because four copies of one claim is how they drifted into four different phrasings (Item 661).
 *
 * Measured 2026-09-11 through the read-only replica (`DATABASE_URL_RO`;
 * `docs/deployment-runbook.md`), over two independent populations:
 *
 *   - schedule cache, 7 partitions (2018, 2021-2026): 22,760 rows, `status` = `scheduled` on
 *     22,760 of 22,760. No row is missing a `status` key.
 *   - score cache, 15 partitions: 20,424 status values, exactly two distinct — `final` (19,524)
 *     and `scheduled` (900).
 *
 * An earlier run on 2026-09-08 counted 22,761 schedule rows. One row, three days apart; the
 * figures above are the 2026-09-11 run only, so the two dates are not silently averaged.
 *
 * WORKED EXAMPLE, IN THE SCORE CACHE. Alderson-Broaddus shut its programme down mid-2023. Its 11
 * cancelled 2023 games are all still in the SCORE cache, split two ways: SIX carry
 * `status = scheduled` at 0-0, and FIVE carry `status = final` at 0-0. (Its 11 SCHEDULE rows are
 * all `scheduled`, like every other schedule row.) So a cancelled game can arrive marked COMPLETE
 * with a real-looking result, which `hasUsableFinalScore` accepts because 0 is not null. Those
 * particular rows are unreachable — `isTrackedGame` (`scheduleTracking.ts`, applied in
 * `schedule.ts` where the tracked set is built) drops both-non-FBS games before they reach
 * `games` — so this is an illustration, not a live defect. It is why "the provider leaves a
 * disrupted game `scheduled`" is too generous a summary to reason from.
 *
 * SCOPE — WHAT THIS MEASUREMENT CANNOT SEE. It is a snapshot of the RESTING state of two caches.
 * It is not a history of what the classifier has been called with, and no such history exists:
 * nothing in `src/lib` records a game's prior status. Two mechanisms put a label beyond its reach,
 * both found in review:
 *
 *   - A LATER ROW CAN OVERWRITE A DISRUPTED ONE. In `scoreMerge.ts`, `stateOrder` ranks
 *     `disrupted` and `final` EQUALLY, and `mergeScoreRow` rejects only a strict regression
 *     (`next < prior`) — so a final row overwrites a disrupted one rather than being rejected by
 *     it, leaving nothing behind in the rows measured above.
 *   - SOME ROWS ARE CLASSIFIED AND NEVER PERSISTED. The live-score final-reconciliation path calls
 *     `classifyScorePackStatus` on a freshly normalized CFBD `/games` row BEFORE any durable merge
 *     (`finalReconciliation.ts`, the `!== 'final'` guard). A disrupted row there is classified,
 *     skipped as not-yet-final, and discarded — the classifier fires and the cache never sees it.
 *
 * Both are mechanisms in this repo's own code, checkable by reading it. This note deliberately
 * makes NO claim about how provider states evolve over time — whether a given label is transient
 * or terminal is exactly the kind of unmeasured provider assertion the item exists to remove.
 *
 * So the supported claim is exactly this: NO DISRUPTED LABEL IS RESTING IN EITHER CACHE, across
 * 22,760 schedule rows and 20,424 score values. Whether one has ever been classified in flight is
 * NOT established here, and would need invocation telemetry that does not exist.
 *
 * `AppGame.rawStatus` IS POPULATED — it is not an unwritten field. `schedule.ts` sets it at all
 * four `AppGame` construction sites as `item.status ?? null`, so every game carries whatever the
 * provider sent; in the rows measured above that value is `scheduled`. A cached schedule ROW
 * carries no `rawStatus` key at all: the field is derived at normalization, not stored. Conflating
 * the two reads as "nothing writes it", which is false. Some construction paths assign it an
 * explicit `null` rather than a provider string, so a null here is not evidence of absence either.
 *
 * KEEP THE GUARD — that is Item 661's own decision, taken deliberately and recorded here: a
 * provider that starts emitting these labels is a real possibility, and the predicates are widely
 * consumed. (It is NOT the `AGENTS.md` zero-consumer retention rule, which does not apply.)
 *
 * What is NOT licensed is reasoning FROM the absence. No disrupted label rests in the caches, so a
 * behaviour, test expectation or design premised on a disrupted game being VISIBLE THERE is
 * premised on nothing — which has now cost twice, a wrong conclusion about Item 169 and disruption
 * handling built for #727. Equally, this is NOT a licence to DELETE disruption handling: the scope
 * above says a label could be classified in flight unobserved, and deleting a guard on that basis
 * would be the same error in the other direction.
 *
 * AND DO NOT READ IT THROUGH A SHARED BRANCH. `applicability === 'not-expected'`
 * (`canonicalSlate.ts`) covers BOTH `placeholder` and `disrupted`, and the placeholder half is
 * fully live — bowl and playoff shells reach it constantly. Comments about `not-expected` carry
 * the pointer to this note because they name the vocabulary, not because the branch is dead.
 *
 * Existing unit coverage of these predicates is SYNTHETIC: labels constructed in tests, never
 * drawn from a production population. It shows the guard would classify such a label correctly if
 * one arrived. It is not evidence that one does.
 */
const DISRUPTED_RE = /\b(postponed|canceled|cancelled|suspended|delayed)\b/;
const CANCELED_RE = /\b(canceled|cancelled)\b/;
const CANCELED_OR_POSTPONED_RE = /\b(?:canceled|cancelled|postponed)\b/;
const LIVE_OT_RE = /\b(?:\d+ot|ot)\b/;

// Status semantics invariant: this module is the single classifier for UI-facing
// schedule/score state buckets so surfaces do not drift on status interpretation.

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? '').trim();
}

/**
 * Canonicalize a raw provider/cache status label into lowercase, space-delimited
 * tokens BEFORE classification. Provider and cache enums arrive in several
 * separator styles — `STATUS_CANCELED`, `status-canceled`, `Status Canceled` —
 * and because `_` is a regex WORD character, a bare `\b...\b` matcher silently
 * FAILS to fire on the underscore forms (`\bcanceled\b` never matches inside
 * `status_canceled`, the boundary the reviewer flagged in 6th-review finding #3).
 * Replacing every non-alphanumeric run with a single space makes all separator
 * styles (`_`, `-`, `/`, punctuation, whitespace) classify identically, so the
 * score diagnostics and game-stats applicability logic that both consume these
 * predicates agree on canceled/postponed/suspended/delayed enum labels.
 */
export function normalizeStatusTokens(status: string | null | undefined): string {
  return normalizeStatus(status)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isDisruptedStatusLabel(status: string | null | undefined): boolean {
  return DISRUPTED_RE.test(normalizeStatusTokens(status));
}

/**
 * A canceled/cancelled game is TERMINAL: it will never produce a final score, so
 * for coverage purposes (provider-data diagnostics) it is "resolved" and must not
 * raise an impossible missing-final warning. This is deliberately NARROWER than
 * {@link isDisruptedStatusLabel}: postponed / suspended / delayed are also
 * disrupted but are NOT terminal — they are unresolved and should still be
 * treated as missing a final result.
 */
export function isCanceledStatusLabel(status: string | null | undefined): boolean {
  return CANCELED_RE.test(normalizeStatusTokens(status));
}

/**
 * Canceled/postponed are terminal for live polling: unlike delayed/suspended,
 * they must not keep a provider or browser polling window armed.
 */
export function isCanceledOrPostponedStatusLabel(status: string | null | undefined): boolean {
  return CANCELED_OR_POSTPONED_RE.test(normalizeStatusTokens(status));
}

export function classifyStatusLabel(status: string | null | undefined): GameStatusBucket {
  // Classify off the separator-normalized token string so enum forms
  // (`STATUS_FINAL`, `STATUS_IN_PROGRESS`) bucket the same as spaced labels.
  const tokens = normalizeStatusTokens(status);

  if (!tokens) return 'scheduled';
  if (DISRUPTED_RE.test(tokens)) return 'disrupted';
  if (tokens.includes('final')) return 'final';
  if (
    tokens.includes('progress') ||
    tokens.includes('quarter') ||
    tokens.includes('half') ||
    LIVE_OT_RE.test(tokens) ||
    tokens.includes('live') ||
    /\bq\d\b/.test(tokens)
  ) {
    return 'inprogress';
  }

  return 'scheduled';
}

export function classifyScorePackStatus(score?: ScorePack): GameStatusBucket {
  if (!score) return 'scheduled';
  return classifyStatusLabel(score.status);
}

/** A final status is displayable as a result only when both team scores exist. */
export function hasUsableFinalScore(score?: ScorePack): boolean {
  return (
    classifyScorePackStatus(score) === 'final' &&
    score?.away.score != null &&
    score.home.score != null
  );
}

/**
 * Classify positive game-conclusion evidence once for both standings progress
 * and standings coverage.
 *
 * `score-required` means the game has been played and must contribute a usable
 * final score before a standings snapshot is complete. `scoreless-terminal` is
 * deliberately limited to cancellation, which legitimately ends a game
 * without producing a result. Strong score-bearing evidence wins if provider
 * fields conflict, keeping coverage fail-closed instead of publishing a
 * possibly incomplete snapshot.
 */
export function classifyGameConclusionEvidence(
  game: GameConclusionEvidence,
  score: ScorePack | undefined
): GameConclusionKind {
  if (classifyScorePackStatus(score) === 'final') return 'score-required';
  if (game.completed === true) return 'score-required';
  if (game.status === 'final') return 'score-required';
  if (isCanceledStatusLabel(game.rawStatus) || isCanceledStatusLabel(score?.status)) {
    return 'scoreless-terminal';
  }
  return 'unresolved';
}

export function formatScheduleStatusLabel(
  status: string | null | undefined,
  options?: { isPlaceholder?: boolean }
): string | null {
  const trimmed = normalizeStatus(status);
  const isPlaceholder = options?.isPlaceholder ?? false;

  if (!trimmed) return isPlaceholder ? 'Placeholder' : null;
  if (trimmed === 'scheduled') return isPlaceholder ? 'Placeholder' : 'Scheduled';
  if (trimmed === 'final') return 'FINAL';
  if (trimmed === 'in_progress') return 'IN PROGRESS';
  if (trimmed === 'matchup_set') return 'Scheduled';
  return trimmed.replace(/_/g, ' ');
}

export function formatScoreSummaryLabel(score?: ScorePack): string | null {
  if (!score) return null;
  const trimmed = normalizeStatus(score.status);
  if (!trimmed) return null;

  const bucket = classifyStatusLabel(trimmed);
  if (bucket === 'final') return 'FINAL';
  if (bucket === 'inprogress') return trimmed.toUpperCase();
  return trimmed;
}

export function formatCompactGameStatus(score?: ScorePack): string {
  const bucket = classifyScorePackStatus(score);
  if (bucket === 'final') return 'Final';
  if (bucket === 'inprogress') return score?.status ?? 'In Progress';
  if (bucket === 'disrupted') return score?.status ?? 'Scheduled';
  if (bucket === 'scheduled') return score?.status ?? 'Scheduled';
  return 'Scheduled';
}
