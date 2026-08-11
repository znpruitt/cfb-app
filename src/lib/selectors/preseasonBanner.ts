import type { DraftPhase } from '../draft.ts';
import type { LeagueStatus } from '../league.ts';
import type { CanonicalStandingsRosterSource } from './leagueStandings.ts';

/**
 * PLATFORM-091 — the ONE place that decides what the league banner claims about
 * a league's readiness for the upcoming season.
 *
 * It lives under `src/lib/selectors/` because AGENTS.md invariant 9 is binding:
 * derived league data is computed here, never inlined in a UI component. The
 * defect this module exists to close was exactly that — `CFBScheduleApp` read
 * `leagueStatus.state === 'preseason'` and rendered `{year} Draft scheduled`
 * from it, appending `· Date TBD` whenever `DraftSettings.scheduledAt` was
 * null. A LIFECYCLE state was standing in as evidence for a DRAFT-STATUS claim
 * that needs a scheduled date to be true, so a league with no confirmed owners
 * and no draft date was told its draft was scheduled.
 *
 * The rule this module enforces: **one authoritative fact per claim.**
 *
 *   claim                     fact that licenses it
 *   ------------------------  ------------------------------------------------
 *   draft is live / paused    `DraftState.phase` — the draft engine's own state
 *   draft complete            `DraftState.phase === 'complete'`
 *   draft scheduled           `DraftSettings.scheduledAt` parses to a real date
 *   a draft is coming at all  `League.assignmentMethod !== 'manual'`
 *   setup complete            `LeagueStatus.setupComplete === true`
 *   roster confirmed          a CURRENT-season source (`csv` | `preseason-owners`)
 *                             AND at least one real (non-NoClaim) owner row
 *   awaiting roster           none of the above
 *
 * Two of those inputs are deliberately NOT the obvious ones, because the
 * obvious ones are tags rather than facts:
 *
 *  - `ownersRosterSource` alone is a STORAGE-SOURCE tag. A current-year CSV
 *    holding only `NoClaim` rows still yields `csv` while `rows` is empty
 *    (pinned by `selectors-leagueStandings.test.ts` — "preseason with CSV
 *    containing only NoClaim"). The source answers WHERE the roster came from;
 *    only the owner count answers WHETHER there is one. Both are required:
 *    `archive` is a PRIOR season's roster with a perfectly healthy row count,
 *    and `/league/[slug]/draft/setup` seeds a draft from last year's archive
 *    owners whenever no preseason-owners record exists, so historical roster
 *    data reaching this decision is a live path.
 *
 *  - the existence of a `DraftState` is NOT evidence that a draft is how this
 *    league assigns teams. `setAssignmentMethod` writes only
 *    `League.assignmentMethod` and leaves any existing draft record intact, so
 *    a commissioner who configures a draft and then switches to manual leaves a
 *    stale `setup`/`settings`/`preview` record behind. Only
 *    `assignmentMethod` says whether a draft is still the plan.
 *
 * Kept pure and JSX-free so every claim is provable without rendering, and so
 * there is exactly one place where the banner's readiness decision is made.
 * Presentation (palette, pulsing dot, link target, localized date) stays in the
 * component; the CLAIM is decided and worded here.
 */

/**
 * A preseason/draft banner state.
 *
 * `headline` is the complete rendered claim. The two states that carry a
 * `scheduledAt` also carry a localized date, appended by the consumer via
 * `formatDraftScheduleDetail` — `toLocaleString` is locale- and
 * timezone-dependent and the countdown is wall-clock-dependent, neither of
 * which belongs in a pure derivation.
 */
export type PreseasonBannerState =
  | { kind: 'draft-live'; headline: string }
  | { kind: 'draft-paused'; headline: string }
  | { kind: 'draft-complete'; headline: string }
  | { kind: 'draft-scheduled'; headline: string; scheduledAt: string }
  | { kind: 'awaiting-roster'; headline: string }
  | { kind: 'awaiting-roster-draft-dated'; headline: string; scheduledAt: string }
  | { kind: 'roster-confirmed'; headline: string }
  | { kind: 'draft-unscheduled'; headline: string }
  | { kind: 'ready-for-kickoff'; headline: string };

export type PreseasonBannerInput = {
  /** Stored lifecycle status. `undefined` on routes that do not pass one. */
  leagueStatus: LeagueStatus | undefined;
  /**
   * `CanonicalStandings.ownersRosterSource` — WHERE the roster came from.
   * `undefined` when the route passed no snapshot.
   */
  ownersRosterSource: CanonicalStandingsRosterSource | undefined;
  /**
   * `CanonicalStandings.rows.length` — how many real owners that roster holds.
   * `rows` already excludes `NoClaim` (`splitOutNoClaim` runs inside
   * `deriveStandings`), so this is a count of genuine owners.
   */
  currentSeasonOwnerCount: number | undefined;
  /**
   * `League.assignmentMethod` — how this league assigns teams. `'manual'`
   * suppresses every forward-looking draft claim; `null`/`undefined` means the
   * commissioner has not chosen yet and a draft record still speaks for itself.
   */
  assignmentMethod: 'draft' | 'manual' | null | undefined;
  /** `DraftState.phase`, or null when no draft record exists for the year. */
  draftPhase: DraftPhase | null;
  /** `DraftSettings.scheduledAt` — nullable by design; null means unscheduled. */
  draftScheduledAt: string | null;
  /** Derived round number for the live/paused claim; null when unknown. */
  draftCurrentRound: number | null;
  /** Year the banner speaks about (the lifecycle year for preseason leagues). */
  bannerYear: number;
  /**
   * Whether the first Week 1 kickoff has already passed. Evaluated by the
   * consumer at render time — a `Date.now()` comparison does not belong in a
   * derivation that may be memoized (Season Launch Hardening invariant 3).
   */
  week1HasStarted: boolean;
};

/**
 * Whether `scheduledAt` is real evidence of a scheduled draft.
 *
 * `null` is a legitimate unscheduled state (`defaultDraftSettings`), and the
 * value crosses an HTTP boundary as untyped JSON, so an unparseable string is
 * treated as no evidence rather than rendered as `Invalid Date`.
 */
function resolveScheduledAt(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}

/**
 * Whether a roster exists for the CURRENT season, with real owners in it.
 * Source and count are both required — see the module comment.
 */
function hasCurrentSeasonRoster(
  source: CanonicalStandingsRosterSource | undefined,
  ownerCount: number | undefined
): boolean {
  if (source !== 'csv' && source !== 'preseason-owners') return false;
  return typeof ownerCount === 'number' && ownerCount > 0;
}

/**
 * Decide the banner's readiness claim, or `null` for no banner.
 *
 * Precedence: the draft-engine phases come first, because a running or finished
 * draft is an observed event rather than an inference about readiness.
 *
 * Every remaining claim is gated on a confirmed current-season roster. Nothing
 * downstream of that gate — a recorded `setupComplete`, a draft date — can
 * assert readiness the roster has not reached: both can be set against a roster
 * that no longer (or does not yet) exist for this year, and the earlier stage is
 * the one a member actually needs.
 *
 * A real draft date survives that gate as DETAIL rather than as a claim. The
 * draft-setup page can be reached before owners are confirmed, so a dated draft
 * with no roster is a normal ordering, not a contradiction — the banner leads
 * with the roster gap and still shows the date the league actually has.
 */
export function selectPreseasonBannerState(
  input: PreseasonBannerInput
): PreseasonBannerState | null {
  const {
    leagueStatus,
    ownersRosterSource,
    currentSeasonOwnerCount,
    assignmentMethod,
    draftPhase,
    draftScheduledAt,
    draftCurrentRound,
    bannerYear,
    week1HasStarted,
  } = input;

  const isPreseason = leagueStatus?.state === 'preseason';

  // Nothing to say about a league that is neither in preseason nor drafting.
  if (!isPreseason && draftPhase === null) return null;

  if (draftPhase === 'live') {
    return {
      kind: 'draft-live',
      headline: draftCurrentRound
        ? `Draft is live · Round ${draftCurrentRound} in progress`
        : 'Draft is live',
    };
  }

  if (draftPhase === 'paused') {
    return {
      kind: 'draft-paused',
      headline: draftCurrentRound ? `Draft paused · Round ${draftCurrentRound}` : 'Draft paused',
    };
  }

  if (draftPhase === 'complete') {
    // The results banner stands down once the season it prepared for begins.
    if (week1HasStarted) return null;
    return { kind: 'draft-complete', headline: `${bannerYear} Draft complete — view results` };
  }

  // Everything below is a readiness claim about a preseason league. A draft
  // stuck in `setup`/`settings`/`preview` on a league the lifecycle authority
  // does not call preseason licenses no readiness statement.
  if (!isPreseason) return null;

  // A manual league is not heading for a draft at all, so a leftover draft
  // record must not speak for it. Its date is suppressed with it.
  const draftIsThePlan = assignmentMethod !== 'manual';
  const scheduledAt = draftIsThePlan ? resolveScheduledAt(draftScheduledAt) : null;

  // The roster gate precedes every later CLAIM, but does not discard the date.
  if (!hasCurrentSeasonRoster(ownersRosterSource, currentSeasonOwnerCount)) {
    const headline = `Awaiting ${bannerYear} roster confirmation`;
    return scheduledAt !== null
      ? { kind: 'awaiting-roster-draft-dated', headline, scheduledAt }
      : { kind: 'awaiting-roster', headline: `${headline} · Contact your commissioner` };
  }

  // `Draft scheduled` requires a date. This is the claim the defect fabricated.
  if (scheduledAt !== null) {
    return { kind: 'draft-scheduled', headline: `${bannerYear} Draft scheduled`, scheduledAt };
  }

  if (leagueStatus.setupComplete === true) {
    return {
      kind: 'ready-for-kickoff',
      headline: `${bannerYear} setup complete · Ready for kickoff`,
    };
  }

  // A draft record exists (`setup`/`settings`/`preview`) but carries no date.
  if (draftIsThePlan && draftPhase !== null) {
    return { kind: 'draft-unscheduled', headline: 'Roster confirmed · Draft to be scheduled' };
  }

  // No draft is coming, or none has been started — either way the banner cannot
  // claim one. Manual leagues and undecided leagues both land here.
  return { kind: 'roster-confirmed', headline: 'Roster confirmed · Season setup in progress' };
}

/**
 * The date detail appended to the two states that carry a `scheduledAt`.
 *
 * `formatDateTime` is injected rather than called directly so the join logic —
 * the part that actually decides what a member reads — is provable without
 * pinning `toLocaleString` output, which varies by locale, timezone, and ICU
 * build. The consumer passes the real formatter.
 *
 * `countdown` is only appended for a firm `draft-scheduled`; a date attached to
 * an unconfirmed roster is penciled in, and counting down to it would restate
 * the certainty the roster gate just withheld.
 */
export function formatDraftScheduleDetail(params: {
  state: PreseasonBannerState;
  formatDateTime: (iso: string) => string;
  countdown: string | null;
}): string | null {
  const { state, formatDateTime, countdown } = params;

  if (state.kind === 'draft-scheduled') {
    const formatted = formatDateTime(state.scheduledAt);
    return countdown ? ` · ${formatted} · ${countdown}` : ` · ${formatted}`;
  }

  if (state.kind === 'awaiting-roster-draft-dated') {
    return ` · Draft penciled in for ${formatDateTime(state.scheduledAt)}`;
  }

  return null;
}
