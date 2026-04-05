# Phase 6 — Admin Cleanup and Auth Design

**Status:** Design approved — ready for implementation.
**Depends on:** Phase 5 (draft tool complete, admin page exists at /admin)

---

## 1. Goals

- Replace the ADMIN_API_TOKEN sessionStorage pattern with proper Clerk-based authentication
- Restructure the admin page into a clean multi-page layout with clear separation of concerns
- Build the auth foundation correctly so commissioner and member roles can be added in Phase 7 without rework
- Establish a clean root route with a public landing page and discrete admin login entry point

---

## 2. Auth Architecture

### Auth Provider: Clerk

Clerk is chosen for:
- Native Next.js App Router support
- Built-in role/permission model via publicMetadata
- Generous free tier (10,000 MAU)
- Scales naturally to commissioner and member roles in Phase 7
- Self-registration with invite links

### Role Model

Three roles defined in Clerk publicMetadata from day one — even if only platform_admin is enforced in Phase 6:

- `platform_admin` — full access to all leagues, all admin tools, `/admin/*`
- `commissioner` — scoped to specific league(s), access to league draft and commissioner tools (Phase 7)
- `member` — league member login for personalized views (Phase 7)

Roles stored as: `{ role: 'platform_admin' | 'commissioner' | 'member' }`

Commissioner league scoping stored as: `{ role: 'commissioner', leagues: ['tsc', 'family'] }` — defined now, enforced in Phase 7.

### Route Protection

Middleware-based protection via Clerk's Next.js middleware:

- `/admin/*` — platform_admin only
- `/league/[slug]/draft/*` — platform_admin or commissioner scoped to that league (Phase 7)
- `/league/[slug]/*` — public (no auth required)
- `/login` — public
- `/` — public

### API Route Protection

Phased replacement of ADMIN_API_TOKEN:

Phase 6: Clerk JWT verification added to admin API routes alongside existing ADMIN_API_TOKEN check. Both accepted during transition.
Phase 7: ADMIN_API_TOKEN removed entirely once all admin surfaces use Clerk.

Helper function: `requireAdminAuth(req)` — checks Clerk JWT first, falls back to ADMIN_API_TOKEN during transition period. Drop-in replacement for existing `requireAdminRequest()`.

---

## 3. Root Route and Landing Page

### Public Landing Page (/)

Unauthenticated visitors see:
- App name and tagline
- "Enter your league URL to get started" message
- Discrete admin login button — small, unobtrusive, links to `/login`
- No league data exposed

Authenticated platform_admin sees:
- League selection dashboard — all leagues from registry as cards
- Each card: league name, slug, active year, owner count, link to `/league/[slug]/`
- Link to `/admin` platform tools
- "Create new league" action

### Login Page (/login)

- Clerk-hosted or Clerk embedded login UI
- On success: redirect to `/` (admin dashboard) or intended destination
- On failure: Clerk handles error messaging

---

## 4. Admin Page Restructure

Current `/admin` is a single page mixing pre-draft tools and diagnostics. Phase 6 restructures into:

- `/admin` — clean landing with section cards linking to sub-pages. Shows active platform status.
- `/admin/draft` — SP+ cache, win total upload, draft initiation status and sequencing guards
- `/admin/data` — schedule refresh, scores, odds, aliases, historical cache tools
- `/admin/leagues` — league management (exists, keep as-is)
- `/admin/season` — rollover, backfill, archive inspection
- `/admin/diagnostics` — API usage, team database, score attachment, storage status

Migration rules:
- Original Admin/Debug panel in league view reviewed — tools migrated to appropriate `/admin/*` sub-page
- Owners CSV upload retained as labeled admin fallback at `/admin/data`
- CFB League Dashboard embed removed from `/admin`
- All existing API endpoints unchanged — UI restructure only

---

## 5. Draft Initiation Sequencing Guards

Built into `/admin/draft`:

1. **Rollover guard** — block draft creation if active league year does not match draft year
2. **Active roster guard** — warn if `owners:${slug}:${year}` already has data, require explicit acknowledgment
3. **Existing draft guard** — already enforced via 409 on `POST /api/draft/[slug]/[year]`

---

## 6. Implementation Sequence

### P6A — Clerk Setup and Login
- Install and configure Clerk in Next.js app
- Define role model in Clerk publicMetadata
- Implement `/login` page
- Implement middleware for route protection
- Update root route: public landing page + admin dashboard when authenticated
- `requireAdminAuth()` helper with ADMIN_API_TOKEN fallback

### P6B — Admin Page Restructure
- Build `/admin` landing with section cards
- Build `/admin/draft` with SP+ cache, win totals, draft sequencing guards
- Build `/admin/data` with schedule, scores, odds, aliases, historical tools
- Build `/admin/season` with rollover and backfill
- Build `/admin/diagnostics` with all debug panels
- Migrate and deprecate original Admin/Debug panel from league view

### P6C — Root Route and Landing Page Polish
- Public landing page final polish
- Admin dashboard league cards with live stats
- Ensure all redirects are runtime-derived, no hardcoded slugs

---

## 7. Deferred to Phase 7

- Commissioner role enforcement on `/league/[slug]/draft/*` routes
- Commissioner self-registration and invite link flow
- League-scoped permissions in Clerk publicMetadata
- Member login and personalized views
- ADMIN_API_TOKEN full removal

---

## 8. Resolved Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Auth provider | Clerk |
| 2 | Role model | Three roles defined now: platform_admin, commissioner, member |
| 3 | Commissioner access | Self-registration with invite links (Phase 7) |
| 4 | API route migration | Phased — Clerk JWT + token fallback in Phase 6, token removed in Phase 7 |
| 5 | Member login | Deferred to Phase 7 |
| 6 | Admin restructure | Multi-page `/admin/*` layout |
| 7 | Root route | Public landing + admin dashboard when authenticated |

---

## 9. Critical Clerk Configuration — Session Token

### Clerk Session Token Must Include publicMetadata

By default Clerk's session token does **NOT** include user `publicMetadata`. The middleware reads `publicMetadata.role` to enforce `platform_admin` access on `/admin/*` routes. Without this configuration the role will always be `undefined` and authenticated users will be redirected away from `/admin` regardless of their actual role.

**Required configuration (one-time setup, per Clerk instance):**

1. Go to Clerk dashboard → Configure → Sessions → Sessions
2. Scroll to "Customize session token"
3. In the Claims editor add: `{ "publicMetadata": "{{user.public_metadata}}" }`
4. Save

This must be done for **both** Development and Production Clerk instances.

**Without this configuration:**
- Authenticated `platform_admin` users cannot access `/admin`
- The middleware correctly reads `sessionClaims.publicMetadata.role` but the claim is absent from the token
- JWT templates (Configure → Sessions → JWT templates) are **NOT** the same as session token customization and do not fix this

**Important:** JWT templates are for third-party integrations only (e.g. Supabase, Firebase, custom APIs). They do not affect the Clerk session token used by the Next.js middleware. Do not use JWT templates to fix middleware auth — use the session token customization described above.

**Do not use `currentUser()` in middleware.** `currentUser()` requires a route handler context and will fail in middleware. Use `auth()` and read `sessionClaims.publicMetadata.role` directly — this works correctly once the session token is customized as described above.

---

## 10. Admin UI Restructure — Platform Admin vs Commissioner Buckets

### Goal

Restructure the admin experience into two clear buckets — platform admin tools (global, platform operator only) and commissioner tools (scoped per league). This is a prerequisite for Phase 7 commissioner self-service — the buckets must exist before access can be delegated.

### Proposed Structure

**`/admin` landing:**

**Platform Admin section** (one block, global):
- Season rollover
- League creation and management
- Backfill historical seasons
- Cache historical schedule and scores
- SP+ ratings cache
- Diagnostics (API usage, storage, score attachment)

**Per-league Commissioner section** (one block per league in registry):
- Roster Editor — direct ownership map editing
- Draft — link to draft setup and board
- Win Totals — upload win total CSV for draft cards
- Data — schedule rebuild, alias management

### Why This Matters for Phase 7

When a commissioner is granted access to their league, they see only their league's commissioner bucket. Platform admin tools remain invisible and inaccessible to commissioners. No code restructuring needed in Phase 7 — just Clerk role enforcement on the existing bucket routes.

---

## 11. Roster Editor

### Goal

A direct CRUD interface for the ownership map per league. Distinct from the draft tool, which is a structured live event. The roster editor handles:

- Fixing mistakes after draft confirmation
- Setting up a league without a formal draft
- Mid-season ownership transfers
- Testing and development

### Behavior

- Table showing all FBS teams and their current owner assignment for the selected league and year
- Inline edit — click an owner name to reassign a team
- Bulk reassign — move all teams from one owner to another (useful when an owner drops out)
- Save writes to `owners:${slug}:${year}` via existing `PUT /api/owners` endpoint
- Read loads current roster from `appStateStore`
- No fuzzy matching needed — owner names are free-form text, teams come from `teams.json` FBS catalog
