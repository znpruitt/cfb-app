# Production Deployment Runbook

Use this runbook for deploying **turfwar.games** to Vercel with Clerk authentication.

## 1) Create the hosted project

1. Create a new Vercel project from the GitHub repo.
2. Confirm Vercel is building the default branch and preview deploys for pull requests.
3. Set the custom domain to `turfwar.games` in Vercel project settings.

## 2) DNS and domain configuration

1. At the domain registrar (Porkbun), set the DNS records for `turfwar.games`:
   - `A` / `CNAME` record pointing `turfwar.games` to Vercel (per Vercel's custom domain instructions).
2. In the Clerk Dashboard, configure the production domain:
   - Set the production domain to `turfwar.games`.
   - Add the required CNAME records at Porkbun for Clerk's subdomain (e.g. `clerk.turfwar.games`).
3. Confirm both Vercel and Clerk report the domain as verified.

## 3) Create the Postgres database

1. Create one small managed Postgres instance.
2. Copy the full connection string.
3. Confirm the database allows inbound connections from Vercel.
4. Do not disable SSL unless the provider specifically requires it.

## 4) Set required environment variables in Vercel

Set these for **Production** (and **Preview** for preview deploys):

- `DATABASE_URL`
- `CFBD_API_KEY`
- `ODDS_API_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Fallback auth (optional — only needed during Clerk migration):

- `ADMIN_API_TOKEN` — long random value. Used as a fallback when Clerk session is unavailable. Will be removed once all clients use Clerk.

Optional only when needed:

- `NEXT_PUBLIC_SEASON`
- `PGSSLMODE=disable`
- `NEXT_PUBLIC_DEBUG`
- `DEBUG_CFBD`
- `DEBUG_UPSTREAM`

Recommended values/notes:

- Get the Clerk keys from the Clerk Dashboard → API Keys (use the production instance keys).
- Leave debug flags unset for normal production.
- Set `NEXT_PUBLIC_SEASON` only if the app should stay pinned to a specific season.

## 5) Configure Clerk authentication

### A. Session token customization

In the Clerk Dashboard → Sessions → Customize session token:

Add the following claim:

```json
{
  "publicMetadata": "{{user.public_metadata}}"
}
```

This makes the user's `publicMetadata` (including `role`) available in the session JWT, which the middleware and `requireAdminAuth` use to authorize commissioner access.

### B. Create a commissioner account

1. In the Clerk Dashboard → Users → Create user.
2. Set the email and password.
3. After creating the user, open the user detail page.
4. Under **Public metadata**, set:

```json
{
  "role": "platform_admin"
}
```

5. Save. The user can now sign in at `/login` and access `/admin`.

### C. Auth flow summary

- **Middleware** (`src/middleware.ts`): All `/admin` routes require a Clerk session with `publicMetadata.role === "platform_admin"`. Unauthenticated users are redirected to `/login`. Authenticated users without the role are redirected to `/`.
- **API routes** (`src/lib/server/adminAuth.ts`): `requireAdminAuth` checks the Clerk JWT first (platform_admin role required), then falls back to `ADMIN_API_TOKEN` header matching for backward compatibility.
- **Public routes**: No authentication required. League pages, schedules, and standings are publicly accessible.

## 6) Trigger the first production deployment

1. Save the Vercel environment variables.
2. Trigger a fresh production deploy.
3. Open `turfwar.games`.
4. Confirm the league page loads before deeper validation.

## 7) Must complete before production signoff

### A. Auth verification

1. Navigate to `turfwar.games/login`.
2. Sign in with the commissioner Clerk account.
3. Confirm you are redirected to `/admin`.
4. Confirm the admin dashboard loads without redirect loops.
5. In a separate browser or incognito window (not signed in), navigate to `/admin`.
6. Confirm you are redirected to `/login`.

### B. Storage/admin status

1. Open `/admin` (signed in as commissioner).
2. Find **Shared storage status**.
3. Confirm:
   - mode = `postgres`
   - environment = `production`
   - database configured = `Yes`

### C. Commissioner flows

1. Upload the current owners CSV.
2. Refresh the page.
3. Confirm the owners data is still present.
4. Save one safe alias change.
5. Refresh the page.
6. Confirm the alias persists.
7. Save one safe postseason override.
8. Refresh the page.
9. Confirm the override persists.
10. Run each admin refresh flow once:
    - schedule rebuild
    - odds refresh
    - scores refresh
    - team database sync

### D. Non-admin member validation

1. Open the site in a browser that is **not signed in to Clerk**.
2. Confirm the main league page loads.
3. Confirm owners/aliases/overrides appear as expected.
4. Confirm normal viewing does **not** require authentication.
5. Navigate to `/admin` — confirm redirect to `/login`.

### E. Shared-state cross-browser validation

1. Open the site in a second browser or incognito window.
2. Confirm the uploaded owners CSV is visible there.
3. Confirm the saved alias is visible there.
4. Confirm the saved postseason override is visible there.
5. Confirm the second browser did not need local cache warm-up to see shared state.

### F. Mobile/browser smoke test

1. Check the production site in:
   - mobile Safari
   - Android Chrome
   - one desktop browser
2. Confirm the main league view loads.
3. Confirm `/admin` is still usable enough for commissioner tasks on a smaller screen.

## 8) Should complete before member launch

1. Repeat the commissioner flow check with the near-final owners CSV and any real alias/override corrections.
2. Confirm the production deploy is stable after at least one redeploy.
3. Confirm the database survives redeploys and the shared state remains intact.
4. Confirm odds behavior looks acceptable with the real `ODDS_API_KEY` and current quota policy.
5. Confirm scores refresh behavior looks acceptable during a live or recently completed game window.
6. Confirm the `/admin` link is only shared with the commissioner/operator group.

## 9) Common failure diagnosis

### Clerk sign-in fails or redirects loop

- Check:
  1. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set in Vercel for the correct environment.
  2. The Clerk production instance domain matches `turfwar.games`.
  3. The CNAME record for `clerk.turfwar.games` is set at Porkbun and verified in Clerk.
  4. The session token customization includes `publicMetadata`.

### Commissioner can sign in but gets redirected away from `/admin`

- Check:
  1. The user's public metadata in Clerk Dashboard contains `{ "role": "platform_admin" }`.
  2. The session token customization includes `{ "publicMetadata": "{{user.public_metadata}}" }`.
  3. Redeploy after changing session token customization — the change requires a fresh JWT.

### API admin actions fail with `401`

- Check:
  1. The Clerk session is active (user is signed in).
  2. The user has `platform_admin` role in public metadata.
  3. If using the token fallback: `ADMIN_API_TOKEN` is set in Vercel and the request includes the token in the `x-admin-token` header or `Authorization: Bearer <token>` header.

### `DATABASE_URL` missing or DB unreachable

- Symptoms:
  - storage panel does not show `postgres`
  - production routes fail when shared state is read/written
- Check:
  1. `DATABASE_URL` exists in Vercel env vars.
  2. The connection string is complete and not truncated.
  3. The database accepts Vercel connections.
  4. `PGSSLMODE=disable` is **not** set unless the provider requires it.

### `CFBD_API_KEY` missing

- Symptoms:
  - schedule/scores/conferences/rankings/team sync fail
- Check:
  1. `CFBD_API_KEY` is set in Vercel env vars.
  2. The key is valid and not expired/revoked.

### `ODDS_API_KEY` missing

- Symptoms:
  - odds refresh/fetch fails
- Check:
  1. `ODDS_API_KEY` is set in Vercel env vars.
  2. The key has remaining quota.

### Storage panel reports the wrong mode

- If mode is `file-fallback`, you are not validating the intended hosted production path.
- If mode is `production-misconfigured`, stop and fix `DATABASE_URL` before signoff.

### Shared state does not appear across browsers

- Check:
  1. The commissioner save action actually succeeded.
  2. The storage panel reports `postgres`.
  3. The second browser is loading the same URL/environment.
  4. You are not relying on stale local data in only one browser.
