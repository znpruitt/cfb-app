/**
 * Shared platform-admin authorization primitives.
 *
 * `isPlatformAdminClaims` is the single definition of "this Clerk identity is a
 * platform admin": the app role stored at `sessionClaims.publicMetadata.role`.
 * It is consumed by both the middleware route gate and the server-side
 * `isPlatformAdminSession` helper so the role literal lives in exactly one place
 * (AGENTS.md Auth invariant — no inline `publicMetadata.role` checks elsewhere).
 *
 * This is Clerk/app-role authorization ONLY. It is deliberately independent of:
 *   - the league password gate (`LEAGUE_AUTH_SECRET`), which only unlocks a
 *     passworded league's pages and grants no role;
 *   - the `ADMIN_API_TOKEN` request fallback, which is layered on top at the API
 *     boundary by `isPlatformAdminSession(req)` / `requireAdminAuth` where a
 *     Request is available. Middleware cannot express that token fallback, which
 *     is why `/api/*` (including `/api/debug/*`) is gated at the route level and
 *     NOT matched by `requiresPlatformAdminPage` below.
 */
export const PLATFORM_ADMIN_ROLE = 'platform_admin';

type ClaimsWithMetadata = Record<string, unknown> & {
  publicMetadata?: Record<string, unknown>;
};

/** Whether a Clerk session's claims carry the platform-admin app role. */
export function isPlatformAdminClaims(sessionClaims: unknown): boolean {
  const claims = sessionClaims as ClaimsWithMetadata | null | undefined;
  return claims?.publicMetadata?.role === PLATFORM_ADMIN_ROLE;
}

/** Browser page families that require a platform-admin Clerk session. */
const PLATFORM_ADMIN_PAGE_PREFIXES = ['/admin', '/debug'] as const;

/**
 * Whether a browser pathname belongs to a platform-admin-only page family.
 *
 * Matches a prefix exactly or as a path segment (`/debug`, `/debug/teams`) but
 * NOT a longer word (`/debugger`, `/administrator`), and deliberately does NOT
 * match `/api/*` — API routes (including `/api/debug/*`) are gated at the route
 * boundary by `requireAdminAuth`, which additionally honors the `ADMIN_API_TOKEN`
 * fallback that middleware cannot.
 */
export function requiresPlatformAdminPage(pathname: string): boolean {
  return PLATFORM_ADMIN_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
