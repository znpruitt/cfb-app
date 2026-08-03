/**
 * The built-in demo/test league. Its lifecycle is managed independently by the
 * test controls on `/admin/[slug]`, so platform-wide lifecycle policy (rollover
 * targeting, missing-status recovery) excludes it. Lives here — the lowest-level
 * league module — so neither the registry nor rollover policy has to depend on
 * the other for it (F2H1 review).
 */
export const TEST_LEAGUE_SLUG = 'test';

export type LeagueStatus =
  | { state: 'season'; year: number }
  | { state: 'offseason' }
  | { state: 'preseason'; year: number; setupComplete?: boolean };

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
