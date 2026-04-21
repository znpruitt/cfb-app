import { auth } from '@clerk/nextjs/server';
import { headers as nextHeaders } from 'next/headers';

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

async function readAdminTokenFromHeaders(): Promise<string> {
  try {
    const hdrs = await nextHeaders();
    const headerToken = hdrs.get('x-admin-token')?.trim();
    if (headerToken) return headerToken;

    const authHeader = hdrs.get('authorization')?.trim() ?? '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }
    return '';
  } catch {
    return '';
  }
}

export function isAuthorizedAdminRequest(req: Request): boolean {
  const configured = getConfiguredAdminToken();
  if (!configured) {
    return !isProductionRuntime();
  }

  return readAdminTokenFromRequest(req) === configured;
}

/**
 * Boolean check for whether the current Clerk session is a platform_admin.
 * Single source of truth for session-based admin detection — consumed by
 * both `requireAdminAuth` (API route boundary) and `isAuthorizedForLeague`
 * (page + API gate). AGENTS.md invariant #6 bans inline role checks outside
 * these designated helpers, so new code needing the answer calls this
 * instead of re-reading `sessionClaims.publicMetadata.role` directly.
 */
export async function isPlatformAdminSession(): Promise<boolean> {
  try {
    const { userId, sessionClaims } = await auth();
    if (!userId) return false;
    const claims = sessionClaims as Record<string, unknown> & {
      publicMetadata?: Record<string, unknown>;
    };
    return claims?.publicMetadata?.role === 'platform_admin';
  } catch {
    return false;
  }
}

/**
 * Unified admin-caller check accepting either an explicit Request (API route
 * handler context) or no argument (page/server-component context, reads from
 * `next/headers`). Returns true when caller has a platform_admin Clerk session
 * OR presents a valid `ADMIN_API_TOKEN` via `x-admin-token` / `Authorization: Bearer`.
 *
 * Phase 7 sunset of `ADMIN_API_TOKEN` removes the token branch here in one place.
 */
export async function isAuthorizedAdminCaller(req?: Request): Promise<boolean> {
  if (await isPlatformAdminSession()) return true;

  const configured = getConfiguredAdminToken();
  if (!configured) {
    // In non-production with no token configured, allow — mirrors
    // isAuthorizedAdminRequest for local dev ergonomics.
    return !isProductionRuntime();
  }

  const provided = req ? readAdminTokenFromRequest(req) : await readAdminTokenFromHeaders();
  return provided.length > 0 && provided === configured;
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
 * a 401 JSON Response when not. Accepts platform_admin Clerk session OR a
 * valid `ADMIN_API_TOKEN` (Phase 6 transition path, slated for Phase 7 removal).
 */
export async function requireAdminAuth(req: Request): Promise<Response | null> {
  if (await isAuthorizedAdminCaller(req)) return null;

  const failure = buildAdminAuthFailure(req);
  return Response.json(failure, { status: 401 });
}

/** @deprecated Use requireAdminAuth — this alias will be removed in Phase 7 */
export const requireAdminRequest = requireAdminAuth;
