import { auth } from '@clerk/nextjs/server';

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getConfiguredAdminToken(): string {
  return process.env.ADMIN_API_TOKEN?.trim() ?? '';
}

export function isAdminTokenConfigured(): boolean {
  return getConfiguredAdminToken().length > 0;
}

export function readAdminTokenFromRequest(req: Request): string {
  const headerToken = req.headers.get('x-admin-token')?.trim();
  if (headerToken) return headerToken;

  const authHeader = req.headers.get('authorization')?.trim() ?? '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return '';
}

export function isAuthorizedAdminRequest(req: Request): boolean {
  const configured = getConfiguredAdminToken();
  if (!configured) {
    return !isProductionRuntime();
  }

  return readAdminTokenFromRequest(req) === configured;
}

/**
 * Single source of truth for "is the current caller a platform admin?" as a
 * boolean predicate (contrast with `requireAdminAuth`, which is the API-route
 * boundary helper that returns a Response).
 *
 * Behavior:
 *   1. Clerk session check via auth() — returns true if a signed-in user's
 *      sessionClaims.publicMetadata.role === 'platform_admin'.
 *   2. If a Request is provided, falls back to the ADMIN_API_TOKEN path via
 *      isAuthorizedAdminRequest(req) — Phase 6 transition fallback; sunset
 *      tracked under docs/next-tasks.md item #5.
 *   3. Returns false on any auth() failure (Clerk misconfigured, etc.).
 *
 * Consumed by requireAdminAuth (passes req) and isAuthorizedForLeague (passes
 * req from gated API routes; page-render context calls without req and gets
 * Clerk-only evaluation). AGENTS.md invariant #6 prohibits inline
 * publicMetadata.role checks outside these helpers, so new callers use this
 * instead of re-reading sessionClaims.
 */
export async function isPlatformAdminSession(req?: Request): Promise<boolean> {
  try {
    const { userId, sessionClaims } = await auth();
    if (userId) {
      const claims = sessionClaims as Record<string, unknown> & {
        publicMetadata?: Record<string, unknown>;
      };
      if (claims?.publicMetadata?.role === 'platform_admin') return true;
    }
  } catch {
    // Clerk not configured or session unreadable — fall through to token path.
  }

  if (req && isAuthorizedAdminRequest(req)) return true;

  return false;
}

function buildAdminAuthFailure(req: Request): { error: string; detail: string } {
  const configured = getConfiguredAdminToken();
  const provided = readAdminTokenFromRequest(req);

  if (!configured) {
    return {
      error: 'admin-token-server-misconfigured',
      detail:
        'ADMIN_API_TOKEN is not configured on the server. Commissioner actions are disabled until the server is configured.',
    };
  }

  if (!provided) {
    return {
      error: 'admin-token-required',
      detail:
        'This commissioner action requires an admin token. Save the token in the Admin / Debug panel and try again.',
    };
  }

  return {
    error: 'admin-token-invalid',
    detail: 'The provided admin token was rejected. Verify the token and try again.',
  };
}

/**
 * requireAdminAuth — API-route boundary helper. Returns null when authorized,
 * a 401 JSON Response when not. Delegates the predicate to
 * isPlatformAdminSession(req) so the role-check logic lives in exactly one place.
 */
export async function requireAdminAuth(req: Request): Promise<Response | null> {
  if (await isPlatformAdminSession(req)) return null;

  const failure = buildAdminAuthFailure(req);
  return Response.json(failure, { status: 401 });
}

/** @deprecated Use requireAdminAuth — this alias will be removed in Phase 7 */
export const requireAdminRequest = requireAdminAuth;
