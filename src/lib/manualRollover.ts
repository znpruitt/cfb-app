import type { PublicLeague } from './league.ts';
import type { ChampionshipRolloverSkipReason } from './schedule/nationalChampionshipRollover.ts';
import type { SeasonArchiveDiff } from './seasonArchive.ts';

/**
 * PLATFORM-086F2B — the shared client-safe contract for the per-year rollover
 * status/preview API (`/api/admin/rollover`). The route builds these shapes and
 * the panel decodes through this module, so the client cannot drift from the
 * server on request or response shape. Type-only imports keep this module free
 * of server code.
 *
 * PLATFORM-086F2H3A — the route is PREVIEW-ONLY. There is no execute response
 * type because there is no execution: `GET /api/cron/season-rollover` is the
 * sole rollover executor.
 */

export type ManualRolloverEligibility = 'eligible' | 'not-eligible' | 'unavailable';

export type ManualRolloverReason = ChampionshipRolloverSkipReason | 'read-failed';

export type ManualRolloverYearStatus = {
  year: number;
  eligibility: ManualRolloverEligibility;
  reason: ManualRolloverReason | null;
  championshipDate: string | null;
  rolloverDate: string | null;
  leagues: PublicLeague[];
};

export type ManualRolloverStatusResponse = {
  generatedAt: string;
  years: ManualRolloverYearStatus[];
  /**
   * PLATFORM-086F2H1R4 — active PRODUCTION league records refused this request
   * for a structurally invalid `status.year`. A COUNT only: never a slug and
   * never the unusable value. Counted per league RECORD. Optional on the wire
   * so a client parsing a pre-R4 response still succeeds, normalized to 0.
   */
  invalidLifecycleTargets: number;
};

export type ManualRolloverRequest = {
  year: number;
  /**
   * PLATFORM-086F2H3A — retired. Kept on the type as optional-and-never-set so
   * the REJECTION stays part of the declared contract rather than folklore: the
   * route answers `confirmed: true` with `rollover-execution-retired` (409).
   * `buildManualRolloverRequest` never emits it.
   */
  confirmed?: never;
};

/** Stable refusal error codes returned by POST /api/admin/rollover. */
export type ManualRolloverRefusalError =
  | 'rollover-year-not-active'
  // PLATFORM-086F2H3A — a request asked this route to EXECUTE a rollover. The
  // manual execute path is retired; the daily cron is the only executor. 409 for
  // the same reason as its siblings: the request is well-formed and no
  // dependency is down — the server no longer offers the operation.
  | 'rollover-execution-retired'
  // PLATFORM-086F2H1R4 — the registry record EXISTS but does not hold a league
  // array. 409, not 400 or 503: the request is well-formed and no dependency is
  // down; it is STORED STATE that prevents the operation, exactly like
  // `rollover-year-not-active`.
  | 'rollover-registry-malformed'
  // PLATFORM-086F2H1R4 — the requested year has no active group AND production
  // records were refused for unusable `status.year`. Distinct from
  // `rollover-year-not-active`, which asserts no league is in season for the
  // year — false when the league exists but its year is unusable.
  | 'rollover-unusable-lifecycle-year'
  | 'rollover-not-eligible'
  | 'rollover-eligibility-unavailable';

export type ManualRolloverRefusal = {
  /**
   * PLATFORM-086F2H1R4 — present on refusals produced AFTER target selection.
   * Declared here because the panel decodes through this module; a client
   * wanting to surface the count from a 409 otherwise has no typed field.
   */
  invalidLifecycleTargets?: number;
  error: ManualRolloverRefusalError;
  reason?: ManualRolloverReason;
  detail?: string;
};

export type ManualRolloverTopStanding = {
  position: number;
  owner: string;
  wins: number;
  losses: number;
  ties: number;
};

export type ManualRolloverLeaguePreview = {
  leagueSlug: string;
  displayName: string;
  status: PublicLeague['status'];
  hasExistingArchive: boolean;
  champion: string | null;
  top3: ManualRolloverTopStanding[];
  diff: SeasonArchiveDiff | null;
  error: string | null;
};

export type ManualRolloverPreviewResponse = {
  /** PLATFORM-086F2H1R4 — refused production records this request (count only). */
  invalidLifecycleTargets: number;
  preview: {
    year: number;
    championshipDate: string;
    rolloverDate: string;
    leagues: ManualRolloverLeaguePreview[];
  };
};

/** Build the POST body for a preview request — one explicit year, always. */
export function buildManualRolloverRequest(year: number): ManualRolloverRequest {
  return { year };
}

const ELIGIBILITIES: readonly ManualRolloverEligibility[] = [
  'eligible',
  'not-eligible',
  'unavailable',
];

/**
 * Decode the GET status response. Returns null when the payload does not match
 * the contract (a panel then reports a load failure rather than rendering off a
 * malformed shape).
 */
export function parseManualRolloverStatusResponse(
  payload: unknown
): ManualRolloverStatusResponse | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.generatedAt !== 'string' || !Array.isArray(obj.years)) return null;
  const years: ManualRolloverYearStatus[] = [];
  for (const entry of obj.years) {
    if (!entry || typeof entry !== 'object') return null;
    const y = entry as Record<string, unknown>;
    if (typeof y.year !== 'number' || !Number.isFinite(y.year)) return null;
    if (typeof y.eligibility !== 'string') return null;
    if (!ELIGIBILITIES.includes(y.eligibility as ManualRolloverEligibility)) return null;
    if (!Array.isArray(y.leagues)) return null;
    years.push({
      year: y.year,
      eligibility: y.eligibility as ManualRolloverEligibility,
      reason: typeof y.reason === 'string' ? (y.reason as ManualRolloverReason) : null,
      championshipDate: typeof y.championshipDate === 'string' ? y.championshipDate : null,
      rolloverDate: typeof y.rolloverDate === 'string' ? y.rolloverDate : null,
      leagues: y.leagues as PublicLeague[],
    });
  }
  // Optional on the wire: a pre-R4 server omits it, and a client that rejected
  // the payload for that would report a load failure against a valid response.
  const rawCount = obj.invalidLifecycleTargets;
  if (
    rawCount !== undefined &&
    (typeof rawCount !== 'number' || !Number.isInteger(rawCount) || rawCount < 0)
  ) {
    return null;
  }
  return {
    generatedAt: obj.generatedAt,
    years,
    invalidLifecycleTargets: typeof rawCount === 'number' ? rawCount : 0,
  };
}

/**
 * Operator-readable language for a POST refusal payload. Returns null when the
 * payload is not a recognized refusal (callers fall back to a generic HTTP
 * error message).
 */
export function describeManualRolloverRefusal(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.error !== 'string') return null;
  const reason = typeof obj.reason === 'string' ? (obj.reason as ManualRolloverReason) : null;
  switch (obj.error as ManualRolloverRefusalError) {
    case 'rollover-year-not-active':
      return 'This year is no longer an active season group — reload the rollover status.';
    case 'rollover-registry-malformed':
      return 'The league registry could not be read as a list of leagues. No rollover can run until the stored record is repaired.';
    case 'rollover-unusable-lifecycle-year':
      return 'This year has no active season group, and one or more league records in season were refused for an unusable season year. Repair those records, then reload — the year you meant may be among them.';
    case 'rollover-execution-retired':
      // No "reload the page" instruction: the only client that can reach this
      // branch is one built from F2H3A onward, which is already current. A stale
      // pre-F2H3A bundle ships the older `default: return null` and renders the
      // generic HTTP message instead — the 409 is what protects that caller, not
      // this string.
      return 'Manual rollover execution has been retired — the daily rollover cron is the only executor.';
    case 'rollover-not-eligible':
      return `Rollover refused: ${describeManualRolloverReason(reason)}`;
    case 'rollover-eligibility-unavailable':
      return describeManualRolloverReason('read-failed');
    default:
      return null;
  }
}

/** Operator-readable language for the stable eligibility/refusal reasons. */
export function describeManualRolloverReason(reason: ManualRolloverReason | null): string {
  switch (reason) {
    case 'no-season-schedule':
      return 'No cached schedule exists for this season yet.';
    case 'no-structured-championship':
      return 'No structured CFP national championship game is present in the cached schedule.';
    case 'score-missing':
      return 'The national championship game has no attached score yet.';
    case 'not-final':
      return 'The national championship game is not final yet.';
    case 'disrupted':
      return 'The national championship game is canceled, postponed, suspended, or delayed.';
    case 'waiting-period':
      return 'The seven-day waiting period after the national championship has not elapsed.';
    case 'read-failed':
      return 'Eligibility could not be determined — a durable store read failed. Try again.';
    default:
      return 'Rollover is not currently eligible.';
  }
}
