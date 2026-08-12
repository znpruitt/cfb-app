export type LeagueStatus =
  | { state: 'season'; year: number }
  | { state: 'offseason' }
  | { state: 'preseason'; year: number; setupComplete?: boolean };

/**
 * The demo/sandbox league. Defined here — the lifecycle-neutral league module —
 * so neither the rollover policy nor the demo lifecycle controls has to import
 * the other merely to learn it. Its lifecycle is driven by the dedicated demo
 * controls; `groupRolloverTargets` excludes it from automatic rollover.
 */
export const TEST_LEAGUE_SLUG = 'test';

/** Earliest year accepted when a new league is created. */
export const MIN_SEASON_YEAR = 2000;

/** Latest year accepted when a new league is created. */
export function maxCreatableSeasonYear(nowMs: number): number {
  return new Date(nowMs).getUTCFullYear() + 1;
}

/**
 * Whether a persisted value can safely participate in lifecycle arithmetic.
 *
 * This is deliberately broader than the creation horizon: legacy records must
 * remain advanceable, while non-integers, pre-football years, and values whose
 * successor cannot be represented exactly are refused instead of persisted.
 * 1869 is the first intercollegiate football season.
 */
export function isStructurallyValidSeasonYear(year: unknown): year is number {
  return typeof year === 'number' && Number.isSafeInteger(year) && year >= 1869;
}

/**
 * PLATFORM-093 — the season a NEWLY CREATED league is for.
 *
 * There is only ever one season in play: either it is under way or it is about to
 * be. So there is nothing for a commissioner to choose, and creation derives this
 * rather than accepting it.
 *
 * The rule is simply the calendar year, and the absence of an adjustment is the
 * part worth explaining:
 *
 *  - February through July — the season has not started; the upcoming one is this
 *    calendar year.
 *  - August through December — that same season is under way.
 *  - January — the previous season's bowls and playoff are still finishing, but a
 *    league created then is being set up for the FOLLOWING autumn, not joining a
 *    season that ends within days. January therefore belongs to the upcoming
 *    season, which is again the calendar year.
 *
 * **Do NOT reuse `seasonYearForToday`.** It answers "which season's data am I
 * looking at" and returns the PREVIOUS year from January through June — correct
 * there, because in February you are still reading the previous season's results,
 * and wrong here, because a league created in February is for the season about to
 * start.
 */
export function seasonYearForNewLeague(now: Date): number {
  return now.getUTCFullYear();
}

/** Whether a year may enter the registry through new-league creation. */
export function isCreatableSeasonYear(year: unknown, nowMs: number): year is number {
  return (
    isStructurallyValidSeasonYear(year) &&
    year >= MIN_SEASON_YEAR &&
    year <= maxCreatableSeasonYear(nowMs)
  );
}

/**
 * Server-internal league record. Contains credential material (passwordHash,
 * passwordSalt) that must NEVER cross a server→client RSC boundary or an API
 * response boundary. Use `PublicLeague` (or `sanitizeLeague`/`sanitizeLeagues`
 * from `src/lib/leagueSanitize.ts`) whenever a league value is handed to a
 * client component or returned from an API route.
 */
export type League = {
  slug: string; // URL identifier — permanent, lowercase alphanumeric with hyphens
  displayName: string; // Human-readable name shown in UI
  year: number; // Active season year
  createdAt: string; // ISO timestamp
  /**
   * The calendar year this league record was created, rendered as `Est. N`.
   *
   * PLATFORM-086F2J — server-derived at creation and IMMUTABLE afterwards
   * (`PATCH` answers `league-founded-year-immutable`). The previous comment
   * called it "commissioner-editable": there is no commissioner identity in this
   * codebase, and the field is no longer editable by anyone. Optional because
   * records created before it existed do not carry one.
   */
  foundedYear?: number;
  status?: LeagueStatus;
  assignmentMethod?: 'draft' | 'manual' | null; // How teams are assigned each preseason
  manualAssignmentComplete?: boolean; // Set to true when commissioner finishes manual team assignment
  // Optional per-league password gate. When unset, the league is public.
  // Hash is scrypt(password, salt) — see src/lib/leagueAuth.ts.
  passwordHash?: string;
  passwordSalt?: string;
};

/**
 * Client-safe league shape. This is the only league type permitted to cross a
 * server→client RSC boundary or be returned from an API route. Credential
 * fields are stripped via `sanitizeLeague`/`sanitizeLeagues`.
 */
export type PublicLeague = Omit<League, 'passwordHash' | 'passwordSalt'>;
