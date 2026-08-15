import type { Insight, InsightType } from '../selectors/insights.ts';
import { TYPE_THRESHOLDS } from './suppression.ts';
import type { LifecycleState } from './types.ts';

/**
 * INSIGHTS-018 — what makes an insight fresh, and what makes it worth repeating.
 *
 * Replaces suppression-as-a-visibility-gate. The defect it exists for: almost
 * every type carried `{ kind: 'unchanged' }` — suppress while the stat value is
 * identical — and **in preseason no games are played, so no stat value can ever
 * change**. Every such insight fired once and was suppressed for the whole
 * preseason. A live league's Overview showed exactly two cards, and both were on
 * the never-suppress list; the pool was not small, it was drained.
 *
 * Two independent questions, which the old model conflated into one:
 *   - **Has this CHANGED?** → earns the NEW label. That is all NEW means.
 *   - **Is this still worth SAYING?** → decides whether it can return to the feed.
 *
 * A drought from 2019 answers "no" to the first and "yes" to the second forever,
 * which is precisely the case the old model could not express: its stat value
 * never moves, so a freshness-only rule buries it exactly as permanently as
 * suppression did.
 */

/**
 * How an insight behaves over time.
 *
 * The owner's rule, which sorts almost every type on its own: **a single-season
 * extreme is news once and history afterwards; the durable version is
 * cumulative.** "Ballard won the toilet bowl 7 times in 2025" is an event.
 * "Ballard has won it 31 times all-time" is a standing fact.
 */
export type InsightKind =
  /**
   * Happened at a point in time. Fires once, decays, never rotates back.
   * Re-showing it months later is noise.
   */
  | 'event'
  /**
   * True until league history changes, and its stat does not drift — a drought,
   * a perfect head-to-head. Rotates back into the feed on a cadence, and is NOT
   * marked NEW when it does: it did not change, it merely resurfaced.
   */
  | 'standing'
  /**
   * True now, with a value that drifts — stat leaders, a tight race. Rotates
   * like `standing`, AND re-earns NEW when the value moves past its existing
   * per-type threshold. This is what the `abs`/`pct` thresholds were built for,
   * so rotation sits above that machinery rather than replacing it.
   */
  | 'standing-moving';

/**
 * Per-type classification. Exhaustive by construction: `Record<InsightType, …>`
 * means a new insight type cannot be added without deciding what it is.
 */
export const INSIGHT_KIND: Record<InsightType, InsightKind> = {
  // --- Events: a single season's outcome, or a threshold crossed once. -------
  movement: 'event',
  surge: 'event',
  collapse: 'event',
  champion_margin: 'event',
  failed_chase: 'event',
  // The league's name for its weekly last-place finisher; this counts how many
  // times an owner won it in ONE season. News at season wrap, history after —
  // the cumulative all-time version is the one worth repeating, and it does not
  // exist yet (queued as INSIGHTS-027).
  toilet_bowl: 'event',
  // A single-season record. Notable when set; not interesting on repeat. Its
  // cumulative cousin, `career_points_leader`, is the standing fact.
  greatest_season: 'event',
  // NOT an event, and this is a correction. It was on `NEVER_SUPPRESS_TYPES`
  // ("always newsworthy"), and classifying it as an event dropped it from
  // candidacy the moment it had been seen once. Two things make that fatal
  // rather than merely wrong: the type covers BOTH "approaching" and
  // "just_crossed" (the status is in the id, not the type), and its `statValue`
  // is the milestone TARGET rather than the owner's running total — so its
  // signature cannot change while an owner closes on the mark. "Alice is 40
  // points from 5,000" would have shown once and died for the season, which is
  // the drain-to-nothing failure this campaign exists to fix.
  // The TYPE covers both an approaching watch and a crossing, so no single value
  // is right — see `insightKind`, which decides per insight. This entry is the
  // default for the approaching case.
  milestone_watch: 'standing',
  trending_up: 'event',
  trending_down: 'event',

  // --- Standing facts, static: true until history itself changes. -----------
  drought: 'standing',
  dynasty: 'standing',
  improvement: 'standing',
  consistency: 'standing',
  lopsided_rivalry: 'standing',
  even_rivalry: 'standing',
  dominance_streak: 'standing',
  perfect_against: 'standing',
  never_last: 'standing',
  title_chaser: 'standing',
  volatility: 'standing',
  rookie_benchmark: 'standing',
  team_identity: 'standing',

  // --- Standing facts, moving: true now, value drifts. ----------------------
  race: 'standing-moving',
  tight_cluster: 'standing-moving',
  career_points_leader: 'standing-moving',
  career_turnover_margin: 'standing-moving',
  ball_security: 'standing-moving',
  takeaway_king: 'standing-moving',
  yards_per_win: 'standing-moving',
  clock_crusher: 'standing-moving',
  third_down: 'standing-moving',
};

/**
 * How this PARTICULAR insight behaves over time.
 *
 * Per insight rather than per type, because `milestone_watch` is both: the same
 * type carries "Alice is 40 points from 5,000" (a standing fact that should keep
 * coming back while it remains true) and "Alice crossed 5,000" (news exactly
 * once). Classifying the type either way is wrong for half its output — the first
 * cut made it an event and killed the watch; making it standing made a crossing
 * rotate for months.
 *
 * The status is in the id, which `milestones.ts` builds as
 * `milestone-{kind}-{target}-{owner}-{status}`.
 */
export function insightKind(insight: Insight): InsightKind {
  if (insight.type === 'milestone_watch') {
    return insight.id.endsWith('-just_crossed') ? 'event' : 'standing';
  }
  return INSIGHT_KIND[insight.type];
}

/**
 * The insight's identity WITHOUT its stat value — id, hook and owners.
 *
 * Split out because a `standing-moving` type needs numeric tolerance on the stat
 * and NO tolerance on anything else. Comparing whole signatures made every 1%
 * drift read as news; comparing only stat values made a hook transition
 * invisible, so "Alice crosses 5,000 career points" — the single most newsworthy
 * thing these types produce, and by nature a small delta — was classified
 * unchanged.
 */
export function insightIdentity(insight: Insight): string {
  const owners = [insight.owner ?? '', ...(insight.relatedOwners ?? insight.owners ?? [])]
    .filter((name) => name !== '')
    .sort();
  return JSON.stringify([insight.id, insight.newsHook, owners]);
}

/**
 * The semantic identity of an insight — what has to change for it to be NEW.
 *
 * **Injective, not hashed, and that is a lesson rather than a preference.**
 * PLATFORM-094 shipped a 32-bit digest whose comment called it "practically
 * collision-free"; review produced two real collisions on catalog data within a
 * day. `JSON.stringify` over an ordered tuple cannot collide, and the cost is
 * a few hundred bytes on a record that is written once per insight per season.
 *
 * **Template wording is deliberately excluded.** Copy variation rewrites the
 * description without the underlying fact changing, and an edit to a template
 * must never make a league's whole feed light up as new.
 */
export function insightSignature(insight: Insight): string {
  const owners = [insight.owner ?? '', ...(insight.relatedOwners ?? insight.owners ?? [])]
    .filter((name) => name !== '')
    .sort();
  return JSON.stringify([insight.id, insight.newsHook, owners, insight.statValue]);
}

/**
 * How long a changed insight wears the NEW label.
 *
 * Shorter in season because the data moves weekly and a stale badge is worse
 * than none; longer outside it because nothing else will change for months and a
 * 48-hour window would mean nobody ever sees a badge.
 */
export const NEW_WINDOW_IN_SEASON_MS = 48 * 60 * 60 * 1000;
export const NEW_WINDOW_OUT_OF_SEASON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Exported and shared with `rotation.ts`. It was duplicated verbatim in both, so
 * adding a lifecycle state to one and not the other would silently decouple the
 * NEW window from the rotation cadence with no type error.
 */
export const IN_SEASON_LIFECYCLES: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
]);

export function newWindowMs(lifecycleState: LifecycleState): number {
  return IN_SEASON_LIFECYCLES.has(lifecycleState)
    ? NEW_WINDOW_IN_SEASON_MS
    : NEW_WINDOW_OUT_OF_SEASON_MS;
}

/**
/**
 * Whether a stat has moved ENOUGH to count as a change, for the kinds whose value
 * drifts.
 *
 * `standing-moving`'s doc promised NEW is re-earned "past its existing per-type
 * threshold", and the implementation compared exact `statValue` equality inside
 * the signature — so a one-unit move re-badged. Both reviewers found the
 * consequence: in season these values move weekly, so all nine such types sat
 * permanently in the changed bucket, headed the feed, and squeezed static
 * standing facts out of rotation entirely.
 *
 * The thresholds are the ones `suppression.ts` already carried. Reusing them is
 * the point — this classification was always meant to sit ABOVE that machinery.
 */
export function statMovedEnough(type: InsightType, before: number, after: number): boolean {
  if (before === after) return false;
  const rule = TYPE_THRESHOLDS[type];
  if (!rule) return true;
  const delta = Math.abs(after - before);
  if (rule.kind === 'abs') return delta > rule.value;
  if (rule.kind === 'pct') {
    if (before === 0) return true;
    return delta / Math.abs(before) > rule.value;
  }
  // 'unchanged' and 'snapshot' carry no tolerance: any movement is a change.
  return true;
}

/**
 * Whether an insight should wear the NEW label.
 *
 * **NEW means CHANGED — owner decision, 2026-08-15.** A standing fact that
 * rotates back into view is not new: it did not change, it merely resurfaced,
 * and badging it would train a reader to distrust the badge. "New to you" is not
 * something this app can know — freshness is league-global because members have
 * no individual accounts.
 *
 * An insight with no observation on record has never been seen by the league and
 * is genuinely new.
 */
export function isNewInsight(
  lastChangedAt: string | null | undefined,
  lifecycleState: LifecycleState,
  now: Date
): boolean {
  if (!lastChangedAt) return true;
  const changedMs = new Date(lastChangedAt).getTime();
  // A malformed timestamp must not mint a permanent NEW badge. Treating it as
  // not-new is the conservative direction: the failure is a missing badge, not a
  // feed that claims everything is fresh forever.
  if (!Number.isFinite(changedMs)) return false;
  return now.getTime() - changedMs <= newWindowMs(lifecycleState);
}
