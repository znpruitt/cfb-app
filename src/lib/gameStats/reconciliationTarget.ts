import type { CfbdSeasonType } from '../cfbd.ts';
import type { CanonicalSlate } from './canonicalSlate.ts';
import type { PartitionCoverageState } from './partitionCoverage.ts';

/**
 * PLATFORM-110B — bounded correction-reconciliation target derivation (pure).
 *
 * Ordinary polling stops looking at a partition once its evidence is
 * `satisfied`, and the kickoff window closes 24 hours after kickoff
 * (`pollingTarget.ts`). Satisfaction establishes usability, not an immutable
 * final provider revision, so a record can sit permanently behind a newer CFBD
 * observation. This module derives WHICH already-closed partition deserves one
 * more look, and WHEN.
 *
 * ## The cadence, and the measurement it came from
 *
 * Ruled 2026-09-09 on three billed CFBD calls, not on judgement:
 *
 *   - `2026:1:regular`, re-observed +34h after the cron's last write and +9h
 *     after the Item 110A repair: **zero** of the 26 recognized categories
 *     changed value across 203 games, and no team's points changed. (The 64
 *     games that differ do so only in categories `mergeRawEvidence` cannot
 *     overwrite — frozen cache, not provider drift. Item 193.)
 *   - `2025:16:regular` after 44 days and `2025:1:regular` after 146 days:
 *     **byte-identical** raw category dictionaries, 146 games.
 *
 * Revisions arrive fast and settle fast. So: **one pass at ~48h after the
 * partition's last kickoff, one at ~7 days, then never.** ~20 partitions per
 * season × 2 passes ≈ 40 CFBD calls a season, one per run.
 *
 * **The +7d pass is the half the measurement does NOT support**, and it is
 * labelled that way deliberately: the interval from ~2 days to ~44 days is
 * unmeasured, because both historical partitions were first observed 7.6 months
 * after their games. It is insurance against CFBD's stated weekly cycle — its
 * admin, 2026-09-02: _"I will always do a 'final' data reconciliation on Sundays
 * for that week's games"_ — landing after our +48h look for a partition whose
 * last game is a Sunday or Monday night. The reconciliation ledger records each
 * pass's corrected count so a season of `p2` entries correcting nothing can
 * RETIRE this pass on evidence rather than on argument.
 *
 * ## Why the anchor is the partition's LAST kickoff
 *
 * The provider endpoint is partition-granular (one call per
 * `year:week:seasonType`), so the decision must be too. Anchoring on the
 * earliest kickoff would fire while later games in the same partition are still
 * being played, and CFBD's own reconciliation cycle is weekly — the same unit.
 *
 * A useful consequence, and the reason no separate window check is needed:
 * `dueAt = latestKickoff + 48h`, and every game's polling window closes at its
 * own `kickoff + 24h`, so `now >= dueAt` PROVES every game in the partition is
 * more than 24 hours past kickoff. A reconciliation candidate can never also be
 * an ordinary polling candidate at the same instant. (Two runs reading the clock
 * either side of a boundary still serialize on the partition's advisory lock
 * inside the H2 durable-merge authority, where the per-game fence decides. The
 * authority is named here in prose only — the activation-invariant guard keeps
 * its entry point confined to the ingestion coordinator and H2's own module, and
 * this module never touches it.)
 *
 * ## What this module deliberately does NOT do
 *
 * Everything here is pure: no clocks (now is injected), no durable reads, no
 * provider access, no writes. The caller supplies the canonical slate and the
 * ledger's per-pass state; it gets back a single target or null. Historical
 * seasons are unreachable BY CONSTRUCTION — the caller's slate is the current
 * season's, exactly as it is for ordinary polling — which is what keeps this off
 * the 96 legacy partitions of Item 196.
 */

/** The two passes, in the order they become due. */
export type ReconciliationPass = 'p1' | 'p2';

/** Pass order, oldest first. Iteration order is part of the contract. */
export const RECONCILIATION_PASS_ORDER: readonly ReconciliationPass[] = ['p1', 'p2'];

/**
 * How long after the partition's latest stat-applicable kickoff each pass falls
 * due. `p1` is the pass the measurement supports; `p2` is the labelled
 * insurance described above.
 */
export const RECONCILIATION_PASS_OFFSETS_MS: Readonly<Record<ReconciliationPass, number>> = {
  p1: 48 * 60 * 60 * 1000,
  p2: 7 * 24 * 60 * 60 * 1000,
};

/**
 * How many attempts one pass may RESERVE before it is abandoned. Dueness never
 * expires, so without this a partition the provider or the store keeps failing
 * on would be refetched on every run forever — an unbounded quota consumer that
 * ordinary polling does not have (its 24-hour window bounds it). Three attempts
 * survives a transient fault and costs three calls on a permanent one, not a
 * season of them; `p2` still backstops an exhausted `p1`.
 */
export const RECONCILIATION_MAX_ATTEMPTS = 3;

export type ReconciliationPartitionRef = {
  year: number;
  /** Provider partition week (CFBD week — never the canonical postseason week). */
  week: number;
  seasonType: CfbdSeasonType;
};

export type ReconciliationTarget = ReconciliationPartitionRef & {
  pass: ReconciliationPass;
  /** ISO instant this pass fell due — `anchorKickoff + the pass offset`. */
  dueAt: string;
  /** ISO kickoff of the LATEST stat-applicable game in the partition. */
  anchorKickoff: string;
};

/**
 * What the ledger knows about one `(partition, pass)`. `attempts` counts
 * RESERVED attempts — reserved before the provider request, so the count can
 * never under-report spend. `reachedVerdict` is true once the durable merge
 * authority actually COMPARED the partition and ruled, which CLOSES the pass
 * whatever it ruled. A pass is due while neither bound is met.
 */
export type ReconciliationPassState = {
  attempts: number;
  reachedVerdict: boolean;
};

/**
 * Whether a partition's coverage permits a correction pass.
 *
 * ONLY `complete` — every expected game classified `satisfied` by the shared
 * evidence authority. Owner ruling, 2026-09-09, and the reasoning is the point:
 * a reconciliation that quietly filled a partition ordinary polling never
 * collected would MASK the collection gap instead of surfacing it, which is the
 * failure this whole audit was spent on. A never-collected partition is a health
 * problem (Item 132's scope), and the only evidence anyone would ever see of it
 * is that it stayed empty.
 *
 * So every other state is deliberately excluded, including the ones that look
 * like they deserve help: `partial` and `absent` are collection gaps, `blocked`
 * and `manual-only` need an operator, and `not-applicable` has nothing to
 * correct. This is the predicate for a CORRECTION path — it presumes something
 * correct is already there.
 */
export function isReconcilablePartitionState(state: PartitionCoverageState): boolean {
  return state === 'complete';
}

/** Stable durable key for a partition — the same form `getGameStatsKey` produces. */
export function reconciliationPartitionKey(ref: ReconciliationPartitionRef): string {
  return `${ref.year}:${ref.week}:${ref.seasonType}`;
}

/** Stable ledger key for one pass over one partition. */
export function reconciliationPassKey(partitionKey: string, pass: ReconciliationPass): string {
  return `${partitionKey}#${pass}`;
}

type PartitionAnchor = {
  ref: ReconciliationPartitionRef;
  /** Epoch ms of the latest stat-applicable, parseable kickoff. */
  anchorMs: number;
  anchorKickoff: string;
};

/**
 * The latest stat-applicable kickoff per partition. Games that never produce
 * statistics (`not-expected` — placeholder shells and disrupted games) are
 * excluded exactly as they are from polling, and a game whose kickoff cannot be
 * parsed contributes no anchor: an unprovable kickoff can never prove an age, so
 * it never starts a billed request. A partition with no anchorable game
 * therefore has no due time and is never a candidate.
 */
function collectPartitionAnchors(slate: CanonicalSlate): PartitionAnchor[] {
  const byPartition = new Map<string, PartitionAnchor>();
  for (const game of slate.games) {
    if (game.applicability === 'not-expected') continue;
    const kickoff = game.kickoff;
    if (typeof kickoff !== 'string') continue;
    const kickoffMs = Date.parse(kickoff);
    if (!Number.isFinite(kickoffMs)) continue;
    const ref: ReconciliationPartitionRef = {
      year: slate.year,
      week: game.providerWeek,
      seasonType: game.seasonType,
    };
    const key = reconciliationPartitionKey(ref);
    const existing = byPartition.get(key);
    if (existing === undefined || kickoffMs > existing.anchorMs) {
      byPartition.set(key, { ref, anchorMs: kickoffMs, anchorKickoff: kickoff });
    }
  }
  return [...byPartition.values()];
}

/** Earliest due first; then `p1` before `p2`; then regular before postseason; then lower week. */
function compareCandidates(a: ReconciliationTarget, b: ReconciliationTarget): number {
  const aDue = Date.parse(a.dueAt);
  const bDue = Date.parse(b.dueAt);
  if (aDue !== bDue) return aDue - bDue;
  if (a.pass !== b.pass) return a.pass === 'p1' ? -1 : 1;
  if (a.seasonType !== b.seasonType) return a.seasonType === 'regular' ? -1 : 1;
  return a.week - b.week;
}

export type ReconciliationCandidateInput = {
  slate: CanonicalSlate;
  now: Date;
  /**
   * Ledger state keyed by {@link reconciliationPassKey}. A missing entry means
   * the pass has never been attempted. Supplying an EMPTY map is therefore
   * "nothing has run yet", never "everything is done" — the caller must fail
   * closed on an unreadable ledger rather than pass an empty one.
   */
  passState: ReadonlyMap<string, ReconciliationPassState>;
};

/**
 * Every pass that is due at `now` and still open, in selection order. Exported
 * for tests and diagnostics; the cron consumes {@link selectReconciliationTarget}.
 */
export function listReconciliationCandidates(
  input: ReconciliationCandidateInput
): ReconciliationTarget[] {
  const { slate, now, passState } = input;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const candidates: ReconciliationTarget[] = [];
  for (const anchor of collectPartitionAnchors(slate)) {
    const partitionKey = reconciliationPartitionKey(anchor.ref);
    for (const pass of RECONCILIATION_PASS_ORDER) {
      const dueMs = anchor.anchorMs + RECONCILIATION_PASS_OFFSETS_MS[pass];
      if (nowMs < dueMs) continue;
      const state = passState.get(reconciliationPassKey(partitionKey, pass));
      if (state !== undefined) {
        if (state.reachedVerdict) continue;
        if (state.attempts >= RECONCILIATION_MAX_ATTEMPTS) continue;
      }
      candidates.push({
        ...anchor.ref,
        pass,
        dueAt: new Date(dueMs).toISOString(),
        anchorKickoff: anchor.anchorKickoff,
      });
    }
  }
  return candidates.sort(compareCandidates);
}

/**
 * The single partition this run may reconcile, or `null` when none is due. At
 * most one target per run, exactly as ordinary polling promises at most one
 * fetch per run — the two never both fire in one invocation.
 */
export function selectReconciliationTarget(
  input: ReconciliationCandidateInput
): ReconciliationTarget | null {
  return listReconciliationCandidates(input)[0] ?? null;
}
