/**
 * Shared identifier for the PLATFORM-083 active-season owner-roster overwrite
 * guard. Lives in its own leaf module (no server-only imports) so the API route,
 * the admin roster panels (client), and tests can all reference the same stable
 * error code without importing route internals.
 *
 * When `PUT /api/owners` would replace an already-populated roster for a
 * league's active season, it responds `409` with `{ error: <this> }`; the client
 * detects it and re-sends with `?override=1` after an explicit repair
 * confirmation.
 */
export const OWNER_ROSTER_OVERWRITE_ERROR = 'owner_roster_overwrite_requires_override';
