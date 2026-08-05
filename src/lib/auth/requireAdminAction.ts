import { isPlatformAdminSession } from '@/lib/server/adminAuth';

/**
 * PLATFORM-086F2H1SB — the platform-admin authorization boundary for Server
 * Actions.
 *
 * There are three distinct boundaries in this app and this is the third:
 *   1. `src/middleware.ts` gates the `/admin` and `/debug` PAGE families.
 *   2. `requireAdminAuth` gates the admin API ROUTES (it takes a `Request` and
 *      returns a `Response`, so it cannot serve here).
 *   3. This guard gates the ACTION itself.
 *
 * Routing is defense in depth, not the action's authority: Next treats an
 * exported Server Action as a public endpoint reachable by its action id, so
 * every action authorizes itself regardless of how the request was routed.
 * F2H1SA closed a demonstrated matcher bypass; this closes the class.
 *
 * NOTE: this module deliberately carries NO `'use server'` directive. Adding
 * one would make its exports Server Actions in their own right — a new
 * unguarded surface created by the very module meant to guard.
 *
 * What the guard can and cannot promise, stated precisely:
 *
 *   Next deserializes a Server Action's arguments BEFORE entering the function
 *   (`action-handler.js` decodes the reply, then resolves the action module),
 *   and Clerk's `auth()` performs its own reads while evaluating the session.
 *   So the guarantee is NOT "zero reads" and NOT "authorization before
 *   deserialization". It is:
 *
 *     After action entry, no application or durable read, write, cleanup,
 *     revalidation, redirect, or argument-dependent validation occurs before
 *     authorization.
 */

/**
 * The closed set of admin Server Action names. Compile-time constants only —
 * the refusal log carries one of these and never a caller-supplied value.
 */
export const ADMIN_SERVER_ACTION_NAMES = [
  'setTestLeagueStatus',
  'resetTestDraft',
  'resetTestLeague',
  'beginPreseason',
  'setAssignmentMethod',
  'confirmPreseasonOwners',
  'completeSetup',
  'migrateTestOwnersCsv',
  'autoCompleteDraft',
] as const;

export type AdminServerActionName = (typeof ADMIN_SERVER_ACTION_NAMES)[number];

/** Closed, caller-independent refusal reasons. Safe to log verbatim. */
type RefusalReason = 'missing-clerk-secret' | 'not-platform-admin' | 'authorization-unavailable';

/** The message every refusal throws. Deliberately generic and stable. */
const REFUSAL_MESSAGE = 'Not authorized';

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Test-only authorizer override. `null` means "use the real path".
 *
 * Hardened in two INDEPENDENT places: the setter refuses to install in
 * production, and `requireAdminAction` ignores any installed value there. One
 * check alone would be a single point of failure for a production bypass.
 */
let __authorizerForTests: (() => boolean | Promise<boolean>) | null = null;

/**
 * Resolve authorization. Any thrown evaluation is a refusal, never a pass.
 */
async function evaluate(): Promise<{ ok: true } | { ok: false; reason: RefusalReason }> {
  if (!isProductionRuntime() && __authorizerForTests) {
    try {
      return (await __authorizerForTests())
        ? { ok: true }
        : { ok: false, reason: 'not-platform-admin' };
    } catch {
      return { ok: false, reason: 'authorization-unavailable' };
    }
  }

  // Clerk's session verification is anchored on CLERK_SECRET_KEY: with it
  // blank, the header signature check degrades to an HMAC over the empty
  // string and the token is only decoded, not verified. Refuse outright rather
  // than consult a predicate that cannot be trusted.
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || secret.trim() === '') return { ok: false, reason: 'missing-clerk-secret' };

  try {
    // NO argument, deliberately. Passing a `Request` would reach
    // `isAuthorizedAdminRequest`, whose no-token branch authorizes ANY caller
    // outside production — an authorization hole, not merely inelegant.
    return (await isPlatformAdminSession())
      ? { ok: true }
      : { ok: false, reason: 'not-platform-admin' };
  } catch {
    return { ok: false, reason: 'authorization-unavailable' };
  }
}

/**
 * Refuse unless the caller holds a platform-admin Clerk session.
 *
 * Must be the FIRST executable statement of every exported admin Server
 * Action, with the literal matching that action's exported name.
 *
 * Throws a stable generic `Error` on refusal — never `redirect()`,
 * `notFound()`, `unauthorized()`, or `forbidden()`. That is a security
 * constraint, not a style choice: `notFound()` renders the full unauthorized
 * page (issuing the reads the guard exists to prevent) and `redirect()` issues
 * a real server-side GET of the target. A plain throw stops the action with no
 * further tree walk.
 */
export async function requireAdminAction(action: AdminServerActionName): Promise<void> {
  const result = await evaluate();
  if (result.ok) return;

  // Exactly one structured event, built only from compile-time constants. For
  // the fetch-action path Next does not log a thrown action error server-side,
  // so this is the ONLY record that an unauthorized invocation occurred. Never
  // include arguments, slug, body, claims, cookies, tokens, or exception text.
  console.warn(
    JSON.stringify({
      event: 'admin-action-unauthorized',
      action,
      reason: result.reason,
    })
  );

  throw new Error(REFUSAL_MESSAGE);
}

/**
 * Test-only: run `run` with `authorizer` installed, restoring the previous
 * value afterwards — including on the redirect throw that terminates several
 * of these actions.
 *
 * Scoped rather than bare set/reset so the override cannot leak through a
 * forgotten teardown. Refuses in production; `requireAdminAction` independently
 * ignores it there.
 */
export async function __withAdminActionAuthorizerForTests<T>(
  authorizer: () => boolean | Promise<boolean>,
  run: () => Promise<T>
): Promise<T> {
  if (isProductionRuntime()) {
    throw new Error('__withAdminActionAuthorizerForTests must not be used in production');
  }
  const previous = __authorizerForTests;
  __authorizerForTests = authorizer;
  try {
    return await run();
  } finally {
    __authorizerForTests = previous;
  }
}
