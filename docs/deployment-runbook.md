# Hosted Preview Deployment Runbook

Use this runbook for the **first real Vercel preview deployment** and the **first hosted validation pass**.

## 1) Create the hosted project

1. Create a new Vercel project from the GitHub repo.
2. Confirm Vercel is building the default branch and preview deploys for pull requests.
3. Do **not** enable extra infrastructure or auth layers for this pass.

## 2) Create the Postgres database

1. Create one small managed Postgres instance.
2. Copy the full connection string.
3. Confirm the database allows inbound connections from Vercel.
4. Do not disable SSL unless the provider specifically requires it.

## 3) Set required environment variables in Vercel

Set these for **Preview** before the first preview deploy:

- `DATABASE_URL`
- `ADMIN_API_TOKEN`
- `CFBD_API_KEY`
- `ODDS_API_KEY`

Optional only when needed:

- `NEXT_PUBLIC_SEASON`
- `PGSSLMODE=disable`
- `NEXT_PUBLIC_DEBUG`
- `DEBUG_CFBD`
- `DEBUG_UPSTREAM`

Recommended values/notes:

- Use a long random value for `ADMIN_API_TOKEN`.
- Leave debug flags unset for normal preview validation.
- Set `NEXT_PUBLIC_SEASON` only if the app should stay pinned to a specific season.

## 4) Trigger the first preview deployment

1. Save the Vercel environment variables.
2. Trigger a fresh preview deploy.
3. Open the preview URL.
4. Confirm the league page loads at all before deeper validation.

## 5) Commissioner browser setup

1. Open the preview in a normal browser window.
2. Open `/admin`.
3. In **Admin access token**, paste the exact `ADMIN_API_TOKEN`.
4. Click **Save token**.
5. Confirm the UI reports that the token is saved/present in this session.

## 6) Must complete before preview signoff

### A. Storage/admin status

1. Open `/admin`.
2. Find **Shared storage status**.
3. Confirm:
   - mode = `postgres`
   - environment = `production`
   - database configured = `Yes`
   - admin token configured on server = `Yes`

### B. Commissioner flows

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

### C. Non-admin member validation

1. Open the preview in a separate browser profile or logged-out browser that has **no saved admin token**.
2. Confirm the main league page loads.
3. Confirm owners/aliases/overrides appear as expected.
4. Confirm normal viewing does **not** require admin credentials.
5. Confirm commissioner actions fail if attempted without the token.

### D. Shared-state cross-browser validation

1. Open the preview in a second browser or incognito window.
2. Confirm the uploaded owners CSV is visible there.
3. Confirm the saved alias is visible there.
4. Confirm the saved postseason override is visible there.
5. Confirm the second browser did not need local cache warm-up to see shared state.

### E. Mobile/browser smoke test

1. Check the hosted preview in:
   - mobile Safari
   - Android Chrome
   - one desktop browser
2. Confirm the main league view loads.
3. Confirm `/admin` is still usable enough for commissioner tasks on a smaller screen.

## 7) Should complete before member launch

1. Repeat the commissioner flow check with the near-final owners CSV and any real alias/override corrections.
2. Confirm the commissioner knows how to re-enter the admin token in a fresh browser session.
3. Confirm the preview deploy is stable after at least one redeploy.
4. Confirm the database survives redeploys and the shared state remains intact.
5. Confirm odds behavior looks acceptable with the real `ODDS_API_KEY` and current quota policy.
6. Confirm scores refresh behavior looks acceptable during a live or recently completed game window.
7. Confirm the `/admin` link is only shared with the commissioner/operator group.

## 8) Optional post-launch follow-ups

1. Add screenshots to this runbook after the first successful hosted validation.
2. Add a short rollback note for swapping env vars or reverting to a prior deploy.
3. Revisit stronger `/admin` page visibility controls only if the current token-gated mutation model feels too exposed for the league.

## 9) Common failure diagnosis

### `DATABASE_URL` missing or DB unreachable

- Symptoms:
  - storage panel does not show `postgres`
  - production routes fail when shared state is read/written
- Check:
  1. `DATABASE_URL` exists in Vercel Preview env vars.
  2. The connection string is complete and not truncated.
  3. The database accepts Vercel connections.
  4. `PGSSLMODE=disable` is **not** set unless the provider requires it.

### `ADMIN_API_TOKEN` missing or misconfigured

- Symptoms:
  - storage panel says admin token configured = `No`
  - commissioner actions fail with `401`
- Check:
  1. `ADMIN_API_TOKEN` is set in Vercel.
  2. The exact same token was pasted into the admin UI.
  3. The token was saved in the current browser session.

### `CFBD_API_KEY` missing

- Symptoms:
  - schedule/scores/conferences/rankings/team sync fail
- Check:
  1. `CFBD_API_KEY` is set in Vercel Preview env vars.
  2. The key is valid and not expired/revoked.

### `ODDS_API_KEY` missing

- Symptoms:
  - odds refresh/fetch fails
- Check:
  1. `ODDS_API_KEY` is set in Vercel Preview env vars.
  2. The key has remaining quota.

### Storage panel reports the wrong mode

- If mode is `file-fallback`, you are not validating the intended hosted production path.
- If mode is `production-misconfigured`, stop and fix `DATABASE_URL` before signoff.

### Shared state does not appear across browsers

- Check:
  1. The commissioner save action actually succeeded.
  2. The storage panel reports `postgres`.
  3. The second browser is loading the same preview URL/environment.
  4. You are not relying on stale local data in only one browser.

### Admin actions fail with `401`

- Check:
  1. The browser session has the saved admin token.
  2. The saved token matches `ADMIN_API_TOKEN` in Vercel exactly.
  3. The deployment was refreshed after env var changes.
