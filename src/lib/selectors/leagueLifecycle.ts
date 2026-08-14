import { type LeagueStatus } from '../league.ts';

/**
 * PLATFORM-086F2H3B1 — the ONE lifecycle-ownership authority behind every admin
 * surface that states who advances a league.
 *
 * It lives under `src/lib/selectors/` because AGENTS.md invariant 9 is binding:
 * all derived league data is computed here and never inlined in a UI component.
 * The first version of this module sat in `src/lib/` and the preseason page
 * separately re-derived the same demo-versus-automatic policy — two authorities
 * for one rule, which is exactly what that invariant forbids. It answers TWO SEPARATE questions and never merges them into one
 * ambiguous "status":
 *
 *   1. What lifecycle state is this league in, and for which year?
 *   2. What moves it forward next — and is that automatic?
 *
 * Kept pure and JSX-free so the operator-facing sentences can be pinned by
 * behavioural tests without rendering, and so there is exactly one place where a
 * claim about automation ownership is made.
 *
 * It introduces NO second lifecycle authority: it reads the stored
 * `LeagueStatus` and decides nothing about it.
 */

/** The demo league is excluded from every automatic lifecycle job. */
const DEMO_NEXT_STEP =
  'Manually controlled. This league is excluded from automatic lifecycle jobs; use the Test Controls below to move it.';

/**
 * A record with NO stored status. The page infers `{ state: 'season' }` for
 * DISPLAY, but both lifecycle crons key on the STORED status —
 * `groupRolloverTargets` skips `!status`, and the season-transition cron filters
 * `status?.state === 'preseason'` — so nothing automatic will ever touch it.
 * Stating the inferred season's ownership here would be a falsehood the moment
 * this summary exists.
 *
 * No repair link: there is no supported operation that writes a lifecycle status
 * onto a production record (`updateLeague` throws on `year`/`status`, the admin
 * PATCH refuses both, and the settings year field is read-only). Recovery is
 * PLATFORM-087's, unscheduled.
 */
const MISSING_STATUS_NEXT_STEP =
  'No lifecycle status is recorded for this league, so no automatic job will advance it.';

/**
 * WHO advances this league. Three values, not a boolean: "not automatic" and
 * "nobody can" are different operator conditions, and collapsing them claims an
 * operator-owned path exists where none does.
 *
 *  - `automatic` — a lifecycle cron owns the next transition.
 *  - `operator`  — a person advances it, through a control that exists.
 *  - `unowned`   — nothing advances it. A legacy record with no stored status
 *                  reaches no cron AND has no supported repair (`updateLeague`
 *                  throws on `year`/`status`, the admin PATCH refuses both, and
 *                  the settings year field is read-only). Recovery is
 *                  PLATFORM-087's, unscheduled.
 */
export type LeagueLifecycleOwnership = 'automatic' | 'operator' | 'unowned';

export type LeagueLifecycleSummary = {
  /** "Season 2026" | "Preseason 2026" | "Offseason". */
  stateLabel: string;
  /** One sentence naming what advances the league, in operator language. */
  nextStep: string;
  ownership: LeagueLifecycleOwnership;
};

/**
 * The read-only status a surface should DISPLAY for a league record.
 *
 * A legacy record with no stored status is shown as its active season; nothing
 * is persisted by reading (AGENTS.md, Lifecycle Authority). Exported so the
 * five `/league/[slug]/*` routes share one definition — three of them inlined
 * `league?.status` raw while two applied this fallback, so the surfaces
 * disagreed for exactly the records the fallback exists to cover.
 */
export function resolveDisplayLeagueStatus(
  league: { status?: LeagueStatus | null; year: number } | null | undefined
): LeagueStatus | undefined {
  if (!league) return undefined;
  return league.status ?? { state: 'season', year: league.year };
}

/**
 * The season a league is OPERATING IN — PLATFORM-099.
 *
 * `preseason` and `season` carry the year on the status; `offseason` does not,
 * so the registry's top-level `year` is the source there. `applyLifecycleStatus`
 * projects one from the other for every non-offseason state, so the two agree
 * for anything written through the lifecycle authority — but this module's own
 * header records that a desynchronized top-level year is reachable on legacy
 * records, and a surface that reads the wrong one edits the wrong season.
 *
 * Lives here rather than inline because it is derived league data (AGENTS.md
 * invariant 9), and because `/league/[slug]/draft/*` already inline this exact
 * ternary — the same divergence `resolveDisplayLeagueStatus` above was extracted
 * to end.
 */
export function resolveLeagueOperatingYear(league: {
  status?: LeagueStatus | null;
  year: number;
}): number {
  const status = league.status;
  if (status?.state === 'preseason' || status?.state === 'season') return status.year;
  return league.year;
}

function stateLabelFor(status: LeagueStatus): string {
  switch (status.state) {
    case 'offseason':
      return 'Offseason';
    case 'preseason':
      return `Preseason ${status.year}`;
    case 'season':
      return `Season ${status.year}`;
  }
}

/**
 * Derive the summary from the STORED status plus the top-level year projection.
 *
 * `storedStatus` is deliberately separate from the display inference: the label
 * may describe an inferred season, while ownership must be decided from what is
 * actually persisted.
 */
export function describeLeagueLifecycle(input: {
  storedStatus: LeagueStatus | null;
  /** `league.year`, used only to label a legacy missing-status record. */
  fallbackYear: number;
  isDemo: boolean;
}): LeagueLifecycleSummary {
  const { storedStatus, fallbackYear, isDemo } = input;

  // The same read-only inference the rest of the app uses for legacy records.
  // Rendering never persists lifecycle state (AGENTS.md, Lifecycle Authority).
  const displayStatus: LeagueStatus = storedStatus ?? { state: 'season', year: fallbackYear };
  const stateLabel = stateLabelFor(displayStatus);

  // The demo answer replaces every per-state claim rather than qualifying one:
  // it is excluded from BOTH lifecycle crons (F2H1T2 for season-transition, the
  // rollover selector for rollover), so no state of it is automatic.
  if (isDemo) return { stateLabel, nextStep: DEMO_NEXT_STEP, ownership: 'operator' };

  if (storedStatus === null) {
    return { stateLabel, nextStep: MISSING_STATUS_NEXT_STEP, ownership: 'unowned' };
  }

  switch (storedStatus.state) {
    case 'offseason':
      // `beginPreseason` is an operator-triggered Server Action; no job advances
      // an offseason league.
      return {
        stateLabel,
        nextStep: "Waiting on you — start pre-season setup when you're ready.",
        ownership: 'operator',
      };
    case 'preseason':
      // The daily season-transition cron targets EVERY preseason league — it is
      // not gated on `setupComplete`, so this is true during setup too.
      return {
        stateLabel,
        nextStep: `Advances to the ${storedStatus.year} season automatically once the schedule is published.`,
        ownership: 'automatic',
      };
    case 'season':
      return {
        stateLabel,
        nextStep:
          'Rolls over to offseason automatically about a week after the national championship.',
        ownership: 'automatic',
      };
  }
}
