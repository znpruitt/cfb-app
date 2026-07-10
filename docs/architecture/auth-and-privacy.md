# Auth & Privacy

Status: Current
Last verified: 2026-07-09
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

**`ADMIN_API_TOKEN` is a transitional fallback** (Auth Invariant #5), retained for backward compatibility until the Phase 8 multi-tenant commissioner signup replaces it with commissioner-scoped Clerk roles. Do not build new flows that depend on it. (Note: when no token is configured, non-production environments treat requests as authorized for local dev convenience — production must set real auth.)

Never hardcode `publicMetadata.role` checks in components or handlers; all role assertions go through the middleware and `requireAdminAuth`. Draft admin gates go through `src/lib/server/canAccessDraftBoard.ts`.

## Cron auth (`CRON_SECRET`)

Scheduled cron routes (`/api/cron/*`) authenticate separately via `verifyCronSecret(req)`: the request's `Authorization` header must equal `Bearer ${CRON_SECRET}`. This is independent of `requireAdminAuth`/`ADMIN_API_TOKEN`. The cron routes **fail closed** — a missing/unset `CRON_SECRET` makes every scheduled run return `401`, silently stopping automated season transition, rollover, and weekly game-stats ingestion.

## League-password privacy gate (`LEAGUE_AUTH_SECRET`)

A league may set a password. When set, its pages are gated behind that password via a signed `league_auth_<slug>` cookie, HMAC-keyed by `LEAGUE_AUTH_SECRET` (`src/lib/leagueAuth.ts`). This is a **per-league page-access gate**, fully separate from Clerk:

- It establishes **no** app role and **no** admin authorization, and it grants **no** provider-refresh authority (unlocking a league never lets you spend CFBD/Odds quota).
- `isAuthorizedForLeague(slug, req?)` allows: a league with no password (public), a platform-admin bypass, or a valid signed cookie bound to the current password fingerprint. Rotating the password auto-invalidates outstanding cookies.
- The gate logic **throws on a missing/empty `LEAGUE_AUTH_SECRET`** (fails loud), so a passworded league cannot be unlocked without it. Required whenever any league has a password set.

## Public vs gated surfaces

Cross-league/provider surfaces (`/api/odds`, `/api/scores`) are public **cache readers** (see [game-data-flow.md](game-data-flow.md)). Individual league pages/schedules/standings are public **only when that league has no password**; once a password is configured they sit behind the league gate. `/admin` and `/debug` pages always require platform-admin; `/api/admin/*` and `/api/debug/*` always require `requireAdminAuth`.
