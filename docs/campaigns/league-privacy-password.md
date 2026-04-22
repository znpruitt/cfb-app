# Campaign: LEAGUE-PRIVACY-PASSWORD

**Branch:** `claude/league-password-protection-91MAy`
**PR:** #285 (merged, commit `faaa7af`)
**Status:** Complete — live in production at turfwar.games

---

## 1. Summary

The LEAGUE-PRIVACY-PASSWORD campaign added per-league password gating to the Turf War platform. Before this work, every `/league/[slug]/*` page and all associated API routes were publicly accessible. League rosters include real member surnames; there was a legitimate privacy concern about those names being indexable and accessible to anyone with a URL.

The implementation uses HMAC-SHA256 signed cookies to authorize access. When a commissioner sets a password via the admin panel, the password is hashed with scrypt and stored alongside a random salt. Visitors must enter the password at a gate UI; upon correct entry a signed cookie is issued that proves authorization without transmitting the password on subsequent requests. The cookie encodes an expiry timestamp, the league slug, a password fingerprint (sha256 of the stored hash, truncated to 16 hex chars), and a signature. Password rotation invalidates all existing cookies automatically because the fingerprint changes.

Every page under `/league/[slug]/*` is gated by `renderLeagueGateIfBlocked()` in the RSC layer before any content renders. Every API route returning league-private data gates via `isAuthorizedForLeague(slug, req)` and returns 404 — not 401/403 — to prevent slug enumeration. Platform admins (Clerk `publicMetadata.role === 'platform_admin'`) bypass the gate on both pages and API routes. A `PublicLeague` type enforces that `passwordHash` and `passwordSalt` never cross server→client or API response boundaries.

---

## 2. Architectural Invariants

These invariants must be preserved by all future work touching league pages or API routes:

**Gate on every league page.** Every page under `/league/[slug]/*` must call `await renderLeagueGateIfBlocked(slug)` and return the result if non-null before rendering any content. This applies even to pages that currently render only universal (non-league-specific) data — the invariant prevents future regressions when league-specific content is added.

**Gate on every league API route.** Every API route that returns league-private data must call `await isAuthorizedForLeague(slug, req)` before responding. Unauthorized or unknown slugs must return `404 null` — not 401/403 — to prevent callers from distinguishing a password-protected league from a nonexistent one.

**PublicLeague is the only external type.** The `League` type from `src/lib/league.ts` is server-internal. `PublicLeague = Omit<League, 'passwordHash' | 'passwordSalt'>` is the only shape permitted to cross server→client (RSC props) or API response boundaries. Use `sanitizeLeague()` / `sanitizeLeagues()` from `src/lib/leagueSanitize.ts` — these are the only sanctioned conversion helpers.

**Single source of truth for platform admin checks.** `isPlatformAdminSession()` in `src/lib/server/adminAuth.ts` is the canonical platform-admin check. Never inline `publicMetadata.role === 'platform_admin'` comparisons outside this helper and the Clerk middleware. `requireAdminAuth()` wraps this for API route use; `requireAdminRequest()` adds a secondary ADMIN_API_TOKEN path for legacy CLI callers.

**Cookie format is stable.** The signed cookie payload format is:
```
<expiresAt>.<slug>.<passwordFingerprint>.<signature>
```
where `expiresAt` is a Unix timestamp, `slug` is the league slug, `passwordFingerprint` is `sha256(passwordHash).slice(0, 16)`, and `signature` is an HMAC-SHA256 over the first three fields using `LEAGUE_AUTH_SECRET`. Changing this format invalidates all existing cookies. If format changes are needed, version the cookie name.

**Validate LEAGUE_AUTH_SECRET before persisting a password.** The admin password-set endpoint (`PUT /api/admin/leagues/[slug]/password`) calls `assertSigningSecretConfigured()` before writing to the database. Without this check, a hash could be persisted but no valid cookie could ever be minted — the league would become inaccessible to non-admins with no recovery path short of a database edit.

---

## 3. Key Files and Their Roles

| File | Role |
|------|------|
| `src/lib/leagueAuth.ts` | Core auth library: `hashLeaguePassword`, `verifyLeagueAuthCookie`, `isAuthorizedForLeague`, `isPlatformAdminSession`, cookie name/format, `assertSigningSecretConfigured` |
| `src/lib/leagueSanitize.ts` | Sanitization helpers: `sanitizeLeague(league)` and `sanitizeLeagues(leagues)` — the only way to convert `League` → `PublicLeague` for external exposure |
| `src/lib/server/adminAuth.ts` | Server-side admin auth: `requireAdminAuth`, `requireAdminRequest`, `isPlatformAdminSession` |
| `src/app/league/[slug]/leagueGate.tsx` | RSC gate: `renderLeagueGateIfBlocked(slug)` — the single call that every league page must make before rendering |
| `src/app/league/[slug]/LeaguePasswordGate.tsx` | Client component: password entry form, cookie claim via `POST /api/league/[slug]/auth`, error display |
| `src/app/api/league/[slug]/auth/route.ts` | Cookie issuance: verifies submitted password, issues signed cookie on success |
| `src/app/api/admin/leagues/[slug]/password/route.ts` | Admin password management: `PUT` sets/changes password (scrypt hash + salt), `DELETE` clears via `clearLeaguePassword` helper |
| `src/components/admin/LeaguePasswordPanel.tsx` | Admin UI: password set/change/remove form within the league admin panel |
| `src/lib/insights/loadInsights.ts` | Extracted insights data loader: `loadInsightsForLeague(slug, year?, options?)` — callable from RSC pages and API route wrappers without SSR self-fetch or credential forwarding |

---

## 4. Commit History

Chronological commits on the campaign branch, squash-merged to main as `faaa7af`:

| Commit | Summary |
|--------|---------|
| `d93de04` | Initial implementation: scrypt hashing, HMAC cookies, `renderLeagueGateIfBlocked`, admin panel, cookie issuance route |
| `53af51b` | Remediation: timing-safe compares, unknown-slug deny, parallel auth delay to resist timing attacks |
| `d41ad3c` | Unknown-slug 404 from gate helper itself (not just API routes) |
| `b435375` | Cookie versioning via password fingerprint (sha256 of hash), API route gating on insights/history/owners |
| `6671967` | Shared `isPlatformAdminSession` helper extracted; insights page forwards cookies on SSR self-fetch so gate honors auth context |
| `3ee6d2f` | `PublicLeague` type + `sanitizeLeague` / `sanitizeLeagues` applied at all server→client and API response trust boundaries |
| `dbd8590` | Password admin hardening: `LEAGUE_AUTH_SECRET` validation before persist, `clearLeaguePassword` using rest-destructuring (no `undefined` key remnants), 8-character minimum (was 4), admin-leagues-GET header compatibility |
| `a119d58` | Insights page SSR self-fetch refactor: `loadInsightsForLeague` extracted to `src/lib/insights/loadInsights.ts`; page calls it directly, eliminating SSRF credential-exfiltration vector |
| `a1b666b` | Rankings page gated (`renderLeagueGateIfBlocked`) for structural consistency — page renders only national poll data but gating closes slug-enumeration gap |
| `2060503` | `export const revalidate = 60` replaced with `export const dynamic = 'force-dynamic'` on the three gated league pages that had ISR (league root, standings, matchups) |

---

## 5. Cross-Model Review Pattern

This campaign used a two-model review cycle that proved significantly more effective than single-model self-review: Opus implemented security-critical code, Codex reviewed with fresh context (no shared memory of implementation decisions).

**Why cross-model review caught more:** Opus's cycle-2 self-audit passed 5 of 8 checks and marked 3 as PARTIAL. Codex's cycle-3 review of the same code caught two new CRITICAL-severity issues that Opus's self-audit had marked SAFE:
1. **Cookie not bound to password version** — an old cookie remained valid after a password change because nothing tied the cookie to the current hash. Codex identified this as a CRITICAL finding; Opus had not flagged it.
2. **API routes returning league-private data were ungated** — `/api/insights/[slug]`, `/api/history/[slug]`, `/api/owners` returned data to any caller because only page-level gates had been installed. Codex flagged this as CRITICAL.

**Pattern conclusion:** Cross-model review is not redundant. The two models catch different failure modes. Single-model self-review has a structural blind spot: the reviewing model shares the same assumptions as the implementing model, so systematic gaps in the original design remain invisible. Cross-model review with context isolation is recommended for any future security-sensitive campaign.

**Recommended protocol for future security work:**
1. Implement with Opus (capability + reasoning)
2. Review with Codex (fresh context, adversarial framing)
3. Remediate findings with Opus
4. Verify remediations with Codex
5. Final audit before merge

---

## 6. Phase 7/8 Extension Points

### Phase 7: Commissioner-per-league roles

`isAuthorizedForLeague` currently has three conditions: (1) no password set → public, (2) platform admin bypass, (3) valid signed cookie. Phase 7 adds conditions 4 and 5:

```typescript
// Condition 4: user is commissioner of this specific league
if (await isLeagueCommissioner(slug, userId)) return true;

// Condition 5: user is a rostered member of this league
if (await isLeagueMember(slug, userId)) return true;
```

Both are additive — no existing code needs restructuring. Commissioner/member identity can be stored in the existing `appStateStore` (e.g., `commissioners:{slug}` key) or Clerk organization membership if the platform moves to Clerk orgs. The cookie path remains available as a fallback for users who prefer password entry over account-based auth.

### Phase 8: Multi-tenant

- Add optional `adminOnly: boolean` on the `League` type for sandbox/internal leagues not exposed via any public UI.
- Separate `LEAGUE_AUTH_SECRET` between preview and production environments. Currently both use the same secret, meaning a cookie issued against a preview deployment is technically valid in production (same slug, same password). Separate secrets close this cross-environment cookie validity gap.
- Consider tag-based ISR revalidation (`revalidateTag`) on league pages once per-request gating overhead becomes measurable — this is safe only after Phase 7 commissioner roles are in place, because the revalidation logic must know whether the requesting user is authorized before deciding what to cache.

---

## 7. Deferred Items (Backlog)

Items that surfaced during the campaign and were explicitly not addressed. Each is a candidate for a future focused prompt.

| Item | Finding | Why deferred |
|------|---------|--------------|
| **AUTH-RATE-LIMITING** | No rate limit on `POST /api/league/[slug]/auth` (password submission). A motivated attacker can brute-force. | Scrypt + 8-char minimum + 500ms artificial delay on failure provide sufficient defense for current threat model. Not worth the operational complexity of Redis/KV-backed rate limiting before Phase 7. |
| **VERCEL-ENV-SENSITIVE-MIGRATION** | `CFBD_API_KEY` rotation depends on CFBD support email (no self-service rotation). | Not privacy-campaign scope; CFBD process constraint. |
| **ORPHAN-ROSTER-UPLOAD-PANEL** | `src/components/RosterUploadPanel.tsx` has no importers in the current codebase. Likely superseded. | Low risk to leave in place; delete when convenient. |
| **COOKIE-PATH-TIGHTENING** | Auth cookie is issued with `path: '/'`, which makes it available to all routes. Tightening to `/league/{slug}` would scope it to only the routes that need it. | Defense-in-depth opportunity only; no active exploit path. |
| **UNAUTHENTICATED-ADMIN-ENDPOINTS** | `/api/admin/storage`, `/api/admin/odds-usage`, `/api/admin/usage` lack auth guards. | Adjacent to privacy scope but not league-privacy specific. Separate remediation prompt. |
| **STARTUP-ENV-VALIDATION** | No boot-time assertion that `LEAGUE_AUTH_SECRET` and other required secrets are present. Currently discovered at request time. | Operational improvement; doesn't change security posture given `assertSigningSecretConfigured` runs at password-set time. |
| **SERVER-FETCH-ARCHITECTURE** | Broader elimination of SSR self-fetches (insights refactored; other places may exist). | Audited during campaign; insights was the only path with credential forwarding. Other self-fetches are non-credentialed. Flag for future audit if new pages are added. |
| **ISR-CLERK-COMPATIBILITY** | Clerk middleware sets `Cache-Control: private, no-cache` on league route responses, defeating ISR at the edge. This was the underlying reason ISR never actually cached these pages in production. | Resolved by removing ISR (`force-dynamic`) on gated pages. If ISR is re-enabled for public leagues in Phase 7, this interaction needs re-auditing. |
| **PG-CONNECTION-STRING-SSL-MODE** | Future `pg` v9 / `pg-connection-string` v3 may break `sslmode=require` in connection strings. | Upgrade-time concern; set `sslmode=verify-full` explicitly when upgrading. |
| **PHASE-8-ENV-SECRET-SEPARATION** | `LEAGUE_AUTH_SECRET` is the same value in production and preview Vercel environments. A preview-issued cookie for a league slug is technically valid in production. | Only matters if the same league slug exists in both environments simultaneously with the same password. Acceptable risk at current scale; address before Phase 8 multi-tenant launch. |

---

## 8. Operational Notes

**LEAGUE_AUTH_SECRET rotation:** The secret is stored in Vercel env vars as Sensitive (Production + Preview). If rotated, **all existing league_auth cookies become immediately invalid** — every user of every password-protected league must re-enter their password. No database migration is needed; only the cookie validity window is affected. Coordinate rotation with commissioners and do it during low-traffic hours.

**Adding/changing a league password:** Via the admin panel at `/admin/leagues`, click into the league and use the League Password Panel section. The UI enforces 8-character minimum and requires confirmation. The `LEAGUE_AUTH_SECRET` must be set in the deployment environment before this works — if it isn't, the admin panel returns a 503 with an explanatory message.

**League password storage:** TSC League password and Test League password are both in Dashlane (Secure Notes). Test League password is a throwaway; TSC password is shared with commissioners.

**Clerk production scoping:** The production Clerk instance is scoped to `turfwar.games`. Vercel deployment-hash URLs and `.vercel.app` URLs cannot complete Clerk authentication against the production instance. Platform-admin bypass testing (and any admin panel work) must be done on `turfwar.games`.

**Preview deployments:** Vercel Standard Protection is active on preview deployments by default (Vercel visitor auth). This means preview builds of password-gated pages are double-gated: Vercel auth first, then the league password gate. This is intentional — preview deployments should not be accessible to league members.

**Vercel production deployment protection:** Currently unused (Hobby tier limitation on custom domains). All-Deployments protection on `turfwar.games` requires a Pro plan. If the plan is upgraded, adding deployment protection would eliminate the need for league password gates on production — but that's a platform cost decision, not a substitute for the password-gate architecture, which also handles per-league granularity.
