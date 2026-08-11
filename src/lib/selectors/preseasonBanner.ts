import type { DraftPhase } from '../draft.ts';
import type { LeagueStatus } from '../league.ts';
import type { CanonicalStandingsRosterSource } from './leagueStandings.ts';

/**
 * PRESEASON-STATUS-BANNER-TRUTHFULNESS — the ONE place that decides what the
 * league banner claims about a league's readiness for the upcoming season.
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
 *   setup complete            `LeagueStatus.setupComplete === true`
 *   roster confirmed          `CanonicalStandings.ownersRosterSource` names a
 *                             CURRENT-season roster (`csv` | `preseason-owners`)
 *   awaiting roster           none of the above
 *
 * `ownersRosterSource` is an allowlist, not a `!== 'none'` test. `archive` is a
 * PRIOR season's roster, and the draft-setup page will happily seed a draft
 * from last year's archive owners when no preseason-owners record exists — so
 * historical roster data must never read as current-season readiness. In
 * preseason `getCanonicalStandings` cannot return `archive` today; the
 * allowlist means this module stays correct if that ever changes.
 *
 * Kept pure and JSX-free so every claim is provable without rendering, and so
 * there is exactly one place where the banner's readiness decision is made.
 * Presentation (palette, pulsing dot, link target, localized date) stays in the
 * component; the CLAIM is decided and worded here.
 */

/**
 * A preseason/draft banner state. `headline` is the complete rendered claim
 * except for `draft-scheduled`, whose localized date and countdown are appended
 * by the consumer — `toLocaleString` is locale- and timezone-dependent and
 * the countdown is wall-clock-dependent, neither of which belongs in a pure
 * derivation.
 */
export type PreseasonBannerState =
  | { kind: 'draft-live'; headline: string }
  | { kind: 'draft-paused'; headline: string }
  | { kind: 'draft-complete'; headline: string }
  | { kind: 'draft-scheduled'; headline: string; scheduledAt: string }
  | { kind: 'awaiting-roster'; headline: string }
  | { kind: 'roster-confirmed'; headline: string }
  | { kind: 'draft-unscheduled'; headline: string }
  | { kind: 'ready-for-kickoff'; headline: string };

export type PreseasonBannerInput = {
  /** Stored lifecycle status. `undefined` on routes that do not pass one. */
  leagueStatus: LeagueStatus | undefined;
  /**
   * `CanonicalStandings.ownersRosterSource` — the canonical current-season
   * ownership authority. `undefined` when the route passed no snapshot.
   */
  ownersRosterSource: CanonicalStandingsRosterSource | undefined;
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
 * Whether a roster exists for the CURRENT season. Allowlist — see the module
 * comment on why `archive` is excluded.
 */
function hasCurrentSeasonRoster(source: CanonicalStandingsRosterSource | undefined): boolean {
  return source === 'csv' || source === 'preseason-owners';
}

/**
 * Decide the banner's readiness claim, or `null` for no banner.
 *
 * Precedence: the draft-engine phases come first, because a running or finished
 * draft is an observed event rather than an inference about readiness.
 *
 * Every remaining claim is gated on a confirmed current-season roster. Nothing
 * downstream of that gate — a draft date, a recorded `setupComplete` — can
 * assert readiness the roster has not reached: both can be set against a roster
 * that no longer (or does not yet) exist for this year, and the earlier stage is
 * the one a member actually needs.
 */
export function selectPreseasonBannerState(
  input: PreseasonBannerInput
): PreseasonBannerState | null {
  const {
    leagueStatus,
    ownersRosterSource,
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

  // The roster gate precedes every later claim. A scheduled date does NOT clear
  // it: `/league/[slug]/draft/setup` seeds a draft from last season's archive
  // owners whenever no preseason-owners record exists, so a date can be set
  // against a roster that does not exist for this year yet. Until the owners are
  // confirmed, the stage a member needs to hear about is the missing roster —
  // and who to ask about it — not a draft date that may still move.
  if (!hasCurrentSeasonRoster(ownersRosterSource)) {
    return {
      kind: 'awaiting-roster',
      headline: `Awaiting ${bannerYear} roster confirmation · Contact your commissioner`,
    };
  }

  // `Draft scheduled` requires a date. This is the claim the defect fabricated.
  const scheduledAt = resolveScheduledAt(draftScheduledAt);
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
  if (draftPhase !== null) {
    return { kind: 'draft-unscheduled', headline: 'Roster confirmed · Draft to be scheduled' };
  }

  // No draft record at all, so the banner cannot claim a draft is coming — this
  // league may be assigning teams manually.
  return { kind: 'roster-confirmed', headline: 'Roster confirmed · Season setup in progress' };
}
