# Auth & Privacy

Status: Current
Last verified: 2026-08-04
Owner: Project documentation
Canonical for: Clerk identity/roles, platform-admin route/API gating, ADMIN_API_TOKEN fallback, league-password privacy gate, cron auth
Supersedes: (none — complements `AGENTS.md` → Auth Architecture Invariants; the deployment-runbook's auth summary is the operator-facing companion)

Three **independent** mechanisms, deliberately kept separate:

1. **Clerk** — user identity + app role (`platform_admin` / `commissioner` / `member`).
2. **`ADMIN_API_TOKEN`** — a transitional admin-API fallback for machine/backward-compat callers.
3. **`LEAGUE_AUTH_SECRET`** — the per-league password gate. It is **not** authentication and grants **no** role.

Do not conflate them. In particular, the league password never authorizes admin actions or provider-quota spending.

## Clerk identity & roles

Clerk is the sole user-identity and app-role provider — no custom sessions or roll-your-own JWT verification. Roles live in `publicMetadata`: `{ role: 'platform_admin' | 'commissioner' | 'member' }` (commissioner league-scoping `{ role: 'commissioner', leagues: [...] }` is defined now, enforced in Phase 7). The single canonical predicate is `isPlatformAdminClaims(sessionClaims)` → `publicMetadata.role === 'platform_admin'` (`src/lib/auth/platformAdmin.ts`).

## Platform-admin page gating (middleware)

Route-level auth lives in exactly one place — the Clerk middleware (`src/middleware.ts`). `requiresPlatformAdminPage(pathname)` matches the `/admin` and `/debug` **page** families (exact or path-segment prefix; not `/administrator`/`/debugger`) and deliberately **excludes `/api/*`**. For those pages the gate **fails closed**:

- not signed in → redirect `/login`
- signed in without the role → redirect `/`

## Admin API gating (`requireAdminAuth`)

`/api/*` admin routes call `requireAdminAuth(req)` (`src/lib/server/adminAuth.ts`), which returns `null` when authorized or a 401 JSON otherwise. It authorizes via `isPlatformAdminSession`:

1. **Clerk session** — `userId` present and `isPlatformAdminClaims(sessionClaims)`; OR
2. **`ADMIN_API_TOKEN`** — token from the `x-admin-token` header or `Authorization: Bearer …`, compared to the configured `ADMIN_API_TOKEN`.

`/api/debug/*` stays **route-gated** by `requireAdminAuth` (not the page middleware) precisely so the `ADMIN_API_TOKEN` fallback — which middleware can't express — keeps working for machine callers.

The game-stats data route **`/api/game-stats` is admin-only** (`src/lib/server/adminAuth`, authenticated BEFORE any query parsing or provider access, PLATFORM-086H3E). It is an operator/admin surface — cache-only projector reads unless an authorized `bypassCache=1` repair is requested — and is distinct from the QStash-triggered `/api/cron/game-stats` covered below.

**`ADMIN_API_TOKEN` is a transitional fallback** (Auth Invariant #5), retained for backward compatibility until the Phase 8 multi-tenant commissioner signup replaces it with commissioner-scoped Clerk roles. Do not build new flows that depend on it. (Note: when no token is configured, non-production environments treat requests as authorized for local dev convenience — production must set real auth.)

Never hardcode `publicMetadata.role` checks in components or handlers; all role assertions go through the middleware, `requireAdminAuth`, and `requireAdminAction`. Draft admin gates go through `src/lib/server/canAccessDraftBoard.ts`.

## Server Action gating (`requireAdminAction`)

The third and final authorization boundary, added by PLATFORM-086F2H1SB. It is
distinct from the two above and does not replace either.

Next.js resolves an exported Server Action from the `Next-Action` header rather
than the request path, so an action is a callable endpoint in its own right.
Route matching is therefore **defense in depth, never the action's authority** —
a lesson learned concretely in F2H1SA, where an unanchored static-file exclusion
let `/admin/audit.css` skip the middleware while still resolving to a worker
where every action was registered.

`requireAdminAction(name)` (`src/lib/auth/requireAdminAction.ts`) is the FIRST
executable statement of all nine exported actions in
`src/app/admin/[slug]/actions.ts`. It:

- resolves `resolvePlatformAdminDecision()` with **no argument**. Passing a
  `Request` would reach `isAuthorizedAdminRequest`, whose no-token branch
  authorizes any caller outside production — an authorization hole, not merely
  inelegant. This is also why `requireAdminAuth` cannot serve here: it requires
  a `Request` and returns a `Response`;
- inherits, rather than duplicates, two properties of that shared decision. The
  blank-`CLERK_SECRET_KEY` refusal lives in `adminAuth.ts` because ALL THREE
  boundaries consume the same verdict — a Server-Action-only check would leave
  the admin API routes and admin pages authorizing against an untrustworthy
  session. And a failed evaluation resolves to `authorization-unavailable`
  rather than `not-platform-admin`, so a Clerk outage is never recorded as a
  role denial;
- emits exactly one structured `admin-action-unauthorized` event built only from
  compile-time constants — a stable event name, the action name, and a closed
  reason. Never arguments, slug, body, claims, cookies, tokens, or exception
  text. This log matters because for the fetch-action path Next does not record
  a thrown action error server-side, so it is the only evidence an unauthorized
  invocation occurred;
- refuses by throwing a stable generic `Error`. **Never `redirect()` or
  `notFound()`** — `notFound()` renders the full unauthorized page, issuing the
  very reads the guard exists to prevent, and `redirect()` issues a real
  server-side GET of the target.

**The guarantee, stated precisely.** Next deserializes a Server Action's
arguments before entering the function, and Clerk performs its own reads while
evaluating the session, so "zero reads" is not claimed. What holds is: after
action entry, no application or durable read, write, cleanup, revalidation,
redirect, or argument-dependent validation occurs before authorization.

A test asserts the guarded name list equals the module's exported functions,
that each action opens with its own matching guard call, and that no second
repository `'use server'` module exists — a new one would be an entirely
separate action surface and requires an explicit authorization decision.

---

## Cron auth (`CRON_SECRET`)

Scheduled cron routes (`/api/cron/*`) authenticate separately via `verifyCronSecret(req)`: the request's `Authorization` header must equal `Bearer ${CRON_SECRET}`. This is independent of `requireAdminAuth`/`ADMIN_API_TOKEN`. The season-transition and season-rollover crons are Vercel-scheduled (`vercel.json`, daily 00:00 UTC). The **game-stats cron is triggered externally by the QStash schedule `turfwar-game-stats-15m`** (every 15 minutes), which forwards the same `Bearer ${CRON_SECRET}` header to the unchanged route — so route authentication is identical whether the trigger is Vercel or QStash — and `/api/cron/game-stats` is intentionally **absent from `vercel.json`** (Vercel Hobby rejects sub-daily crons; PLATFORM-086H3E). The cron routes **fail closed** — a missing/unset `CRON_SECRET` makes every scheduled run return `401`, silently stopping automated season transition, rollover, and game-stats ingestion.

## League-password privacy gate (`LEAGUE_AUTH_SECRET`)

A league may set a password. When set, its pages are gated behind that password via a signed `league_auth_<slug>` cookie, HMAC-keyed by `LEAGUE_AUTH_SECRET` (`src/lib/leagueAuth.ts`). This is a **per-league page-access gate**, fully separate from Clerk:

- It establishes **no** app role and **no** admin authorization, and it grants **no** provider-refresh authority (unlocking a league never lets you spend CFBD/Odds quota).
- `isAuthorizedForLeague(slug, req?)` allows: a league with no password (public), a platform-admin bypass, or a valid signed cookie bound to the current password fingerprint. Rotating the password auto-invalidates outstanding cookies.
- The gate logic **throws on a missing/empty `LEAGUE_AUTH_SECRET`** (fails loud), so a passworded league cannot be unlocked without it. Required whenever any league has a password set.

## Public vs gated surfaces

Cross-league/provider surfaces (`/api/odds`, `/api/scores`) are public **cache readers** (see [game-data-flow.md](game-data-flow.md)). Individual league pages/schedules/standings are public **only when that league has no password**; once a password is configured they sit behind the league gate. `/admin` and `/debug` pages always require platform-admin; `/api/admin/*` and `/api/debug/*` always require `requireAdminAuth`.
