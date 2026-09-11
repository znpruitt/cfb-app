import type { ScorePack } from './scores.ts';

export type GameStatusBucket = 'scheduled' | 'inprogress' | 'final' | 'disrupted';

export type GameConclusionEvidence = {
  status: string;
  rawStatus?: string | null;
  completed?: boolean | null;
};

export type GameConclusionKind = 'score-required' | 'scoreless-terminal' | 'unresolved';

/**
 * THE DISRUPTED VOCABULARY IS A FORWARD-LOOKING GUARD. IT HAS NEVER FIRED IN PRODUCTION.
 *
 * This is the one authoritative record of that fact. Every other comment in `src/` that names
 * `postponed` / `canceled` / `suspended` / `delayed` defers here instead of restating it, because
 * four copies of one claim is how they drifted into four different phrasings (Item 661).
 *
 * Measured 2026-09-08 and re-measured 2026-09-11 through the read-only replica (`DATABASE_URL_RO`;
 * `docs/deployment-runbook.md`), over two independent populations:
 *
 *   - schedule cache, 7 partitions (2018, 2021-2026): 22,760 rows, `status` = `scheduled` on
 *     22,760 of 22,760. No row is missing a `status` key.
 *   - score cache, 15 partitions: 20,424 status values, exactly two distinct — `final` (19,524)
 *     and `scheduled` (900).
 *
 * Not one disrupted label on either field, across seven seasons. CFBD leaves a disrupted game
 * `scheduled` — that is how six cancelled Alderson-Broaddus games reached the cache at 0-0, and
 * how the Week 1 power-outage game presented. A disrupted game is therefore indistinguishable
 * from an ordinary scheduled one in production.
 *
 * Those two caches are the only inputs these predicates see, so the coverage is total rather than
 * a sample: `classifyStatusLabel` has never returned `'disrupted'` on real data, and
 * `isDisruptedStatusLabel` has never returned `true` on it.
 *
 * `AppGame.rawStatus` IS POPULATED — it is not an unwritten field. `schedule.ts` sets it at all
 * four `AppGame` construction sites as `item.status ?? null`, so every game carries a value, and
 * that value is `scheduled` because `scheduled` is the only thing the provider has ever sent. A
 * cached schedule ROW carries no `rawStatus` key at all: the field is derived at normalization,
 * not stored. Conflating the two reads as "nothing writes it", which is false — the accurate and
 * more useful statement is that it is written everywhere and can only hold one value.
 *
 * KEEP THE GUARD. A provider that starts emitting these labels is a real possibility, the
 * predicates have live consumers (10 modules, 13 call sites), and `AGENTS.md` requires a guard to
 * say why it exists rather than be removed. What is NOT licensed is reasoning FROM it. The
 * disrupted branch is unreachable on measured data, so any behaviour, test expectation or design
 * premised on a disrupted game OCCURRING is premised on nothing. That has now cost twice: a wrong
 * conclusion about Item 169, and disruption handling built into Schedule's scoreboard derivation
 * for #727 — including a `rawStatus` branch on a field that can only hold one value.
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
