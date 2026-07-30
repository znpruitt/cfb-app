/**
 * PLATFORM-086E2A — pure, dormant rankings publication-slot classifier
 * (built and tested for the FUTURE PLATFORM-086E2B cron; called from NO
 * production code in E2A).
 *
 * The E2B heartbeat delivers two fixed UTC slots per day (04:00 and 22:00); this
 * classifier decides whether ONE scheduled slot falls inside a rankings
 * publication window, using only caller-supplied cache-derived context. It
 * performs no cache read, durable write, provider call, lifecycle mutation, or
 * marker update — E2B owns context loading and the durable per-window completion
 * marker keyed by the returned publication key.
 *
 * Windows (all UTC; day 0 = Sunday):
 *   - `preseason-discovery`     Monday 22:00, from 45 days before the first
 *                               canonical kickoff, while AP or Coaches data is
 *                               still absent.
 *   - `weekly-ap-coaches`       Sunday 22:00 during the late-preseason/active
 *                               interval (from 45 days before the first kickoff
 *                               until seven days past the structured
 *                               championship kickoff, when known).
 *   - `opening-week-exception`  Tuesday 22:00 within the first 14 days after the
 *                               first canonical kickoff.
 *   - `cfp-publication`         Wednesday 04:00 from November 1 through
 *                               December 10 of the season year.
 *   - `final-ap-coaches`        Wednesday 04:00 within seven days after the
 *                               structured national-championship kickoff.
 *
 * Overlapping conditions resolve by fixed precedence:
 *   final-ap-coaches → cfp-publication → opening-week-exception
 *   → weekly-ap-coaches → preseason-discovery.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Discovery begins this many days before the first canonical kickoff. */
export const RANKINGS_PRESEASON_DISCOVERY_LEAD_DAYS = 45;
/** The opening-poll exception covers the first N days after the first kickoff. */
export const RANKINGS_OPENING_WEEK_EXCEPTION_DAYS = 14;
/** The final-poll window covers N days after the structured championship kickoff. */
export const RANKINGS_FINAL_POLL_WINDOW_DAYS = 7;

export type RankingsPublicationContext = {
  /** The scheduled UTC heartbeat slot being classified (not the delivery time). */
  scheduledAt: Date;
  year: number;
  /**
   * League-registry lifecycle of the target year. Offseason years never reach
   * the classifier (E2B excludes them during target selection), so no window
   * branches on this field — it rides along for E2B event reporting.
   */
  lifecycle: 'preseason' | 'season';
  /** First canonical kickoff of the season year (ISO), when the schedule knows it. */
  firstKickoffAt: string | null;
  /** Structured CFP national-championship kickoff (ISO), when known. */
  structuredChampionshipKickoffAt: string | null;
  hasAp: boolean;
  hasCoaches: boolean;
  hasCfp: boolean;
};

export type RankingsPublicationWindowKind =
  | 'final-ap-coaches'
  | 'cfp-publication'
  | 'opening-week-exception'
  | 'weekly-ap-coaches'
  | 'preseason-discovery';

export type RankingsPublicationDecision =
  | {
      due: true;
      kind: RankingsPublicationWindowKind;
      /**
       * Deterministic duplicate-suppression key: `<year>:<kind>:<YYYY-MM-DD>` of
       * the scheduled UTC slot. E2B stores it durably so one window is delivered
       * at most once.
       */
      key: string;
    }
  | { due: false; reason: 'not-a-heartbeat-slot' | 'no-window-due' };

function parseInstant(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function utcDateStamp(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Classify one scheduled heartbeat slot. Pure and deterministic: the same
 * context always yields the same decision and key.
 */
export function evaluateRankingsPublicationWindow(
  context: RankingsPublicationContext
): RankingsPublicationDecision {
  const at = context.scheduledAt;
  const hour = at.getUTCHours();
  const day = at.getUTCDay();
  if (at.getUTCMinutes() !== 0 || (hour !== 4 && hour !== 22)) {
    return { due: false, reason: 'not-a-heartbeat-slot' };
  }

  const t = at.getTime();
  const firstKickoff = parseInstant(context.firstKickoffAt);
  const championship = parseInstant(context.structuredChampionshipKickoffAt);
  const discoveryStart =
    firstKickoff === null ? null : firstKickoff - RANKINGS_PRESEASON_DISCOVERY_LEAD_DAYS * DAY_MS;

  const due = (kind: RankingsPublicationWindowKind): RankingsPublicationDecision => ({
    due: true,
    kind,
    key: `${context.year}:${kind}:${utcDateStamp(at)}`,
  });

  // Precedence order — first match wins.
  if (
    hour === 4 &&
    day === 3 &&
    championship !== null &&
    t >= championship &&
    t <= championship + RANKINGS_FINAL_POLL_WINDOW_DAYS * DAY_MS
  ) {
    return due('final-ap-coaches');
  }

  if (
    hour === 4 &&
    day === 3 &&
    t >= Date.UTC(context.year, 10, 1) &&
    t < Date.UTC(context.year, 11, 11)
  ) {
    return due('cfp-publication');
  }

  if (
    hour === 22 &&
    day === 2 &&
    firstKickoff !== null &&
    t >= firstKickoff &&
    t <= firstKickoff + RANKINGS_OPENING_WEEK_EXCEPTION_DAYS * DAY_MS
  ) {
    return due('opening-week-exception');
  }

  if (
    hour === 22 &&
    day === 0 &&
    discoveryStart !== null &&
    t >= discoveryStart &&
    (championship === null || t <= championship + RANKINGS_FINAL_POLL_WINDOW_DAYS * DAY_MS)
  ) {
    return due('weekly-ap-coaches');
  }

  if (
    hour === 22 &&
    day === 1 &&
    discoveryStart !== null &&
    t >= discoveryStart &&
    (!context.hasAp || !context.hasCoaches)
  ) {
    return due('preseason-discovery');
  }

  return { due: false, reason: 'no-window-due' };
}
