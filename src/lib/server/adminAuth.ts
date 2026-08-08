import { auth } from '@clerk/nextjs/server';

import { isPlatformAdminClaims } from '../auth/platformAdmin.ts';

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
 * The closed platform-admin decision (PLATFORM-086F2H1SB).
 *
 * `authorized`               — a Clerk platform-admin session, or a valid
 *                              ADMIN_API_TOKEN when a Request was supplied.
 * `missing-clerk-secret`     — CLERK_SECRET_KEY is blank. Clerk's header
 *                              signature check is an HMAC keyed on that value
 *                              and an unset key silently becomes `''`, so the
 *                              session verdict cannot be trusted at all.
 * `not-platform-admin`       — evaluation succeeded; the caller is not an admin.
 * `authorization-unavailable`— evaluation itself failed (Clerk unreachable or
 *                              misconfigured). Distinct from the above ON
 *                              PURPOSE: conflating an outage with a role denial
 *                              makes the audit trail actively misleading.
 */
export type PlatformAdminDecision =
  | 'authorized'
  | 'missing-clerk-secret'
  | 'not-platform-admin'
  | 'authorization-unavailable';

/**
 * Single source of truth for "is the current caller a platform admin?", as a
 * CLOSED decision rather than a boolean — so callers that need to tell an
 * infrastructure failure from a role denial can.
 *
 *   1. Refuse outright when CLERK_SECRET_KEY is blank. This lives HERE rather
 *      than at one call site because BOTH consumers of this verdict —
 *      `requireAdminAuth` for API routes and `requireAdminAction` for Server
 *      Actions — inherit the same untrustworthy session if the key is unset.
 *      Middleware is a THIRD, separate boundary: it calls `clerkMiddleware`'s
 *      own `auth()` and `isPlatformAdminClaims` directly and never reaches
 *      this function, so it does NOT inherit this refusal.
 *   2. Clerk session check via auth(); a throw is `authorization-unavailable`,
 *      never a silent denial.
 *   3. If a Request is provided, fall back to the ADMIN_API_TOKEN path —
 *      Phase 6 transition, sunset tracked in docs/next-tasks.md. Server Actions
 *      call WITHOUT a request and therefore cannot reach it, which matters
 *      because the no-token branch authorizes any caller outside production.
 *
 * AGENTS.md prohibits inline publicMetadata.role checks outside these helpers,
 * so new callers use this (or isPlatformAdminClaims) rather than re-reading
 * sessionClaims.
 */
export async function resolvePlatformAdminDecision(req?: Request): Promise<PlatformAdminDecision> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || secret.trim() === '') {
    // A request-bearing caller still gets the UNCHANGED token path, which does
    // not depend on Clerk's signature at all. That path keeps its pre-existing
    // semantics — including the no-token-configured branch that authorizes
    // outside production, which the admin API suites rely on and which is
    // separately deferred for sunset. Narrowing it here would be an unrelated
    // behavioral change smuggled into an authorization fix.
    if (req && isAuthorizedAdminRequest(req)) return 'authorized';
    // No request: Clerk is the only possible evidence, and it cannot be
    // trusted without the secret.
    return 'missing-clerk-secret';
  }

  let unavailable = false;
  try {
    const { userId, sessionClaims } = await auth();
    if (userId && isPlatformAdminClaims(sessionClaims)) return 'authorized';
  } catch {
    // Evaluation failed — remember it rather than letting the token fallback
    // or the final return disguise an outage as a role denial.
    unavailable = true;
  }

  if (req && isAuthorizedAdminRequest(req)) return 'authorized';

  return unavailable ? 'authorization-unavailable' : 'not-platform-admin';
}

/**
 * PLATFORM-088 — both session facts from ONE auth resolution.
 *
 * The homepage needs two things: is anyone signed in (identity), and are they a
 * platform admin (role). Resolving them independently was a defect: the first
 * attempt added a separate `isSignedInSession()` that called `auth()` without the
 * blank-secret precondition `resolvePlatformAdminDecision` applies a few lines
 * above. On a deployment with `CLERK_SECRET_KEY` unset those two disagree —
 * Clerk's header-signature check degrades to an HMAC over the empty string, so
 * the admin decision refuses while the identity check happily reports a session.
 * The page would then tell a LEGITIMATE ADMIN that their account lacks the role.
 *
 * One call, one precondition, both facts, and they cannot contradict each other.
 * Both fail CLOSED: a missing secret or a Clerk outage yields the plain public
 * landing, which is the safe page in every case.
 *
 * This is NOT a replacement for `resolvePlatformAdminDecision` — AGENTS.md
 * invariant 8 requires Server Actions to use that closed decision, which supplies
 * a refusal REASON this boolean pair deliberately does not. It also carries no
 * `Request`, so it never reaches the `ADMIN_API_TOKEN` branch; a page render has
 * no request to authenticate with, exactly as `isPlatformAdminSession()` behaves
 * when called with no argument.
 */
export type SessionFacts = {
  isSignedIn: boolean;
  isPlatformAdmin: boolean;
};

export async function resolveSessionFacts(): Promise<SessionFacts> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || secret.trim() === '') {
    return { isSignedIn: false, isPlatformAdmin: false };
  }

  try {
    const { userId, sessionClaims } = await auth();
    const isSignedIn = Boolean(userId);
    return {
      isSignedIn,
      isPlatformAdmin: isSignedIn && isPlatformAdminClaims(sessionClaims),
    };
  } catch {
    return { isSignedIn: false, isPlatformAdmin: false };
  }
}

/**
 * Boolean compatibility wrapper over `resolvePlatformAdminDecision`. Existing
 * callers (`requireAdminAuth`, `isAuthorizedForLeague`) keep their shape; use
 * the decision directly when the REASON matters.
 */
export async function isPlatformAdminSession(req?: Request): Promise<boolean> {
  return (await resolvePlatformAdminDecision(req)) === 'authorized';
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
