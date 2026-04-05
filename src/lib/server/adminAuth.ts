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
 * requireAdminAuth — checks Clerk JWT first (platform_admin role required),
 * then falls back to ADMIN_API_TOKEN for backward compatibility.
 *
 * TODO Phase 7: remove ADMIN_API_TOKEN fallback once all clients use Clerk.
 */
export async function requireAdminAuth(req: Request): Promise<Response | null> {
  // 1. Try Clerk session — requires publicMetadata.role === 'platform_admin'
  try {
    const { userId, sessionClaims } = await auth();
    if (userId) {
      const claims = sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> };
      const role = claims?.publicMetadata?.role;
      if (role === 'platform_admin') return null;
    }
  } catch {
    // Clerk not configured or session unreadable — fall through to token check
  }

  // 2. Fall back to ADMIN_API_TOKEN (Phase 6 transition — remove in Phase 7)
  if (isAuthorizedAdminRequest(req)) return null;

  const failure = buildAdminAuthFailure(req);
  return Response.json(failure, { status: 401 });
}

/** @deprecated Use requireAdminAuth — this alias will be removed in Phase 7 */
export const requireAdminRequest = requireAdminAuth;
