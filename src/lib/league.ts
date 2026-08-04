export type LeagueStatus =
  | { state: 'season'; year: number }
  | { state: 'offseason' }
  | { state: 'preseason'; year: number; setupComplete?: boolean };

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
  foundedYear?: number; // Year the league was founded — auto-set on creation, commissioner-editable
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
