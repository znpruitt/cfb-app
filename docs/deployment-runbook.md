# Production Deployment Runbook

Status: Current
Last verified: 2026-07-26
Owner: Project documentation
Canonical for: detailed hosted-deployment / operator checklist — the step-by-step operational companion to docs/operations/deployment.md
Supersedes: (none)

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
- `CRON_SECRET` — long random value (e.g. `openssl rand -hex 32`). Bearer token every scheduled run must present. **Only the two lifecycle crons are declared in `vercel.json`** (`/api/cron/season-transition`, `/api/cron/season-rollover`, both daily 00:00 UTC). `/api/cron/game-stats` is **not** in `vercel.json` — it is triggered by an external **QStash** schedule that forwards `Authorization: Bearer <CRON_SECRET>` to the unchanged route every 15 minutes (Vercel Hobby rejects sub-daily crons; see §8e). The cron routes **fail closed**: if this is missing or unset, every scheduled run returns `401` and automated season transition, season rollover, and game-stats ingestion silently stop. `CRON_SECRET` is the route credential and is **deployed in Vercel**; it is distinct from `QSTASH_TOKEN`, the operator-held QStash **management** credential used only to provision/rotate the schedule (§8e step 11) — `QSTASH_TOKEN` must never be set in Vercel or committed. Treat `CRON_SECRET` as required in any environment that runs the crons, and supply it locally when provisioning or rotating the QStash schedule.
- `LEAGUE_AUTH_SECRET` — long random value (e.g. `openssl rand -hex 32`). HMAC-SHA256 signing key for the per-league password gate's `league_auth_<slug>` session cookie. Required whenever **any** league has a password set; the gate logic **throws on a missing/empty value** (fails loud), so a passworded league cannot be unlocked without it. No in-code default. See `docs/campaigns/league-privacy-password.md`.

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

This makes the user's `publicMetadata` (including `role`) available in the session JWT, which the middleware and `requireAdminAuth` use to authorize platform-admin access.

### B. Create a platform admin/operator account

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
- **League page access** (`src/lib/leagueAuth.ts`): a league may set a password. When set, its pages are gated behind that password via a signed `league_auth_<slug>` session cookie (HMAC keyed by `LEAGUE_AUTH_SECRET`). This is a **per-league access gate**, separate from — and not a substitute for — Clerk authentication or app-admin authorization: Clerk establishes user identity and the `platform_admin` role; the league password only unlocks that one league's pages. A league with no password set remains open.
- **Public surfaces**: No authentication required. Cross-league/provider surfaces (odds and scores endpoints) are public. Individual league pages/schedules/standings are public **only when that league has no password set**; once a password is configured they sit behind the league access gate above.

These three mechanisms are independent: Clerk (identity + admin role), `ADMIN_API_TOKEN` (admin API fallback), and `LEAGUE_AUTH_SECRET` (league password gate).

## 6) Trigger the first production deployment

1. Save the Vercel environment variables.
2. Trigger a fresh production deploy.
3. Open `turfwar.games`.
4. Confirm the league page loads before deeper validation.

## 7) Must complete before production signoff

### A. Auth verification

1. Navigate to `turfwar.games/login`.
2. Sign in with the platform admin Clerk account.
3. Confirm you are redirected to `/admin`.
4. Confirm the admin dashboard loads without redirect loops.
5. In a separate browser or incognito window (not signed in), navigate to `/admin`.
6. Confirm you are redirected to `/login`.

### B. Storage/admin status

1. Open `/admin` (signed in as platform admin).
2. Find **Shared storage status**.
3. Confirm:
   - mode = `postgres`
   - environment = `production`
   - database configured = `Yes`

### C. Admin/operator flows

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
2. **Public (no-password) league:** confirm the main league page loads anonymously — no Clerk sign-in and no league password required.
3. Confirm owners/aliases/overrides appear as expected.
4. **Passworded league:** confirm the league password gate appears, that unlocking with the correct password loads the page, and that the unlock grants **no** admin or provider-refresh authority — it only unlocks that one league's pages.
5. Navigate to `/admin` — confirm redirect to `/login` (Clerk-gated; the league password does not grant `/admin` access).

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
3. Confirm `/admin` is still usable enough for admin/operator tasks on a smaller screen.

## 8) Should complete before member launch

1. Repeat the admin/operator flow check with the near-final owners CSV and any real alias/override corrections.
2. Confirm the production deploy is stable after at least one redeploy.
3. Confirm the database survives redeploys and the shared state remains intact.
4. Confirm odds behavior looks acceptable with the real `ODDS_API_KEY` and current quota policy.
5. Confirm scores refresh behavior looks acceptable during a live or recently completed game window.
6. Confirm the `/admin` link is only shared with the platform-admin/operator group.

## 8b) Post-merge team-catalog sync (PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY)

After the derived-alias-safety fix (or any future `src/data/alias-overrides.json` change) is merged and deployed, resync the durable team catalog so the stored snapshot itself carries the corrected aliases. (Read-time override application already sanitizes SERVED items from deploy; the resync makes the durable record canonical and rebuilds every derived alias.)

1. Sign in as `platform_admin`, open `/admin/diagnostics`, expand **Team Database**, click **Update Team Database**; confirm the response reports `ok: true`, `source: "cfbd"`, a current `updatedAt`, and a nonzero written count. Machine equivalent (with `ADMIN_API_TOKEN` configured):

   ```bash
   curl --fail-with-body --silent --show-error \
     --request POST \
     --header "Accept: application/json" \
     --header "Authorization: Bearer ${ADMIN_API_TOKEN}" \
     https://turfwar.games/api/admin/team-database
   ```

   This rebuilds the catalog through the corrected `buildTeamDatabaseFile`, applies `alias-overrides.json`, writes `team-database/current`, and invalidates all canonical standings.

2. Verify the durable catalog served by `/api/teams`:

   ```bash
   curl --fail-with-body --silent --show-error \
     "https://turfwar.games/api/teams?level=FBS" |
   jq -e '
     ([.items[] | select(.school == "San Diego State")][0]) as $sdsu |
     ([.items[] | select(.school == "San José State")][0]) as $sjsu |
     ([.items[] | select(.school == "New Mexico State")][0]) as $nmsu |
     (($sdsu.alts | index("sandiego")) == null) and
     (($sdsu.alts | index("sdsu")) != null) and
     (($sjsu.alts | index("san jose")) != null) and
     (($nmsu.alts | index("newmexico")) == null)
   '
   ```

3. Verify resolution through the admin-gated resolver diagnostic (`/api/debug/resolve-team`): `San Diego` must NOT resolve to `sandiegostate` (distinct or unresolved); `SDSU` → `sandiegostate`; `San Jose` → `sanjosestate`; `New Mexico` → `newmexico`. If any check fails, stop and inspect the effective alias diagnostic — never edit owners, drafts, archives, or CSV data as a workaround.

4. Rerun the established `PLATFORM-086H3E` production parity audit (the approved read-only audit procedure — there is no checked-in CLI) with the synced catalog's `updatedAt` recorded as its prerequisite. Do not claim H3E parity until that rerun completes.

## 8c) Post-merge schedule refresh (PLATFORM-086-SCHEDULE-NON-FBS-POSTSEASON-CLASSIFICATION-SAFETY)

After the non-FBS postseason classification fix is merged and deployed, the durable 2024 and 2025 schedule caches still carry the defective shared `cfp-semifinal` identities on FCS / Division III championship rows and must be re-normalized. Deploy the merged correction before refreshing data. If the pending team-catalog sync from §8b has not been completed, perform and verify that first.

Refresh the canonical full-year durable schedule for both affected seasons through the supported schedule route. Do **not** use the Historical Data Cache button: it sends `force: false` and can return `alreadyCached` without replacing the defective snapshot.

```bash
for year in 2024 2025; do
  curl --fail-with-body --silent --show-error \
    --header "Accept: application/json" \
    --header "Authorization: Bearer ${ADMIN_API_TOKEN}" \
    "https://turfwar.games/api/schedule?year=${year}&bypassCache=1" \
    --output "/tmp/platform-086-schedule-${year}.json"

  jq -e '
    .meta.source == "cfbd" and
    .meta.cache == "miss" and
    .meta.fallbackUsed == false and
    .meta.partialFailure == false and
    ((.meta.failedSeasonTypes // []) | length == 0) and
    (.items | length > 0)
  ' "/tmp/platform-086-schedule-${year}.json"
done
```

Verify 2024 identities:

```bash
jq -e '
  . as $root
  | def byid($id): first($root.items[] | select(.id == $id));
    ["401729786", "401738295", "401738307", "401729787"] as $nonfbs
  | ["401677189", "401677191"] as $semis
  | all($nonfbs[];
      byid(.) != null and
      (((byid(.).eventKey // "") | startswith("cfp-")) | not))
    and
    (([$nonfbs[] | byid(.).eventKey] | unique | length) == ($nonfbs | length))
    and
    all($semis[];
      byid(.).postseasonSubtype == "playoff" and
      byid(.).playoffRound == "semifinal" and
      ((byid(.).eventKey // "") | startswith("cfp-semifinal"))
    )
    and
    byid("401677192").postseasonSubtype == "playoff"
    and
    byid("401677192").playoffRound == "national_championship"
    and
    byid("401677192").eventKey == "national-championship"
' /tmp/platform-086-schedule-2024.json
```

Verify 2025 identities:

```bash
jq -e '
  . as $root
  | def byid($id): first($root.items[] | select(.id == $id));
    ["401840097", "401833989", "401840096", "401833990"] as $nonfbs
  | ["401769075", "401769074"] as $semis
  | all($nonfbs[];
      byid(.) != null and
      (((byid(.).eventKey // "") | startswith("cfp-")) | not))
    and
    (([$nonfbs[] | byid(.).eventKey] | unique | length) == ($nonfbs | length))
    and
    all($semis[];
      byid(.).postseasonSubtype == "playoff" and
      byid(.).playoffRound == "semifinal" and
      ((byid(.).eventKey // "") | startswith("cfp-semifinal"))
    )
    and
    byid("401769076").postseasonSubtype == "playoff"
    and
    byid("401769076").playoffRound == "national_championship"
    and
    byid("401769076").eventKey == "national-championship"
' /tmp/platform-086-schedule-2025.json
```

For each year, verify `/api/admin/provider-status?year=<year>` reports the schedule year scope with `latestAttemptOutcome: "succeeded"`, `partialFailure: false`, `rowsCommitted > 0`, and a current `lastSuccessAt`. Then make a cache-only `/api/schedule?year=<year>` request and repeat the identity assertions against the served response. If another process still serves a pre-refresh process-cache entry, wait for the established one-hour schedule TTL and recheck. Do not delete app-state rows or mutate other production records as a workaround.

Finally, rerun the established read-only `PLATFORM-086H3E` production parity audit for 2024 (the approved audit procedure — there is no checked-in H3E CLI; do not invent one). Record as prerequisites: the synced team catalog's `updatedAt`; the 2024 schedule refresh response's `meta.generatedAt`; the schedule provider-status `lastSuccessAt`. Do not claim H3E parity until the rerun completes. Do not modify game-stat evidence, ownership, archives, or activation state during the audit.

## 8d) Post-merge schedule-identity correction (PLATFORM-086H3E4-SECOND-ROUND-CONFERENCE-COLLISION-REMEDIATION) — ✅ COMPLETED

**Status: this correction sequence has been PERFORMED and verified clean (2026-07-26).** The durable 2021–2025 schedule caches carry the corrected identities, the 2024 archive holds the genuine Texas–Georgia game (no hybrid), and the refreshes, dual audits, and 2021–2025 archive backfills are all done. This section is retained as the **historical operator record**; it is NOT a step to repeat during activation. The §8e activation sequence VERIFIES these prerequisites READ-ONLY and STOPS on any drift — it does not re-refresh or re-backfill. Any future detected prerequisite drift is a stop condition requiring separately approved investigation.

Completed record (for audit reference):

1. **Deployed** the merged correction (E4) while writer control remained `legacy`, provider pause remained enabled, and automatic game-stats refresh remained disabled.
2. **Forced full-year schedule refreshes for 2021–2025** completed (`/api/schedule?year=<year>&bypassCache=1`, admin-authenticated): each new durable generation CFBD-backed, non-partial, duplicate-free, carrying positive numeric participant ids, with the year-scoped provider status succeeded and a cache-only recheck per year.
3. **Corrected identities verified** per year: no "Second Round" row classifies `sec-championship` (or any FBS conference championship); `401673469` is Texas home / Georgia away with the genuine SEC Championship identity; `401729753` remains the UC Davis–Illinois State non-FBS game and is not activation-eligible; no unrelated schedule population or identity churn occurred.
4. **`PLATFORM-086H3E-2024-ARCHIVE-PARTICIPANT-COLLISION-AUDIT-v1` rerun clean**: zero archive-versus-schedule participant mismatches attributable to this defect.
5. **Complete PLATFORM-086H3E production participant-validation and archive/canonical parity audit rerun clean**: positive numeric ids everywhere applicable, **zero** `participant-validation-unavailable`, **zero** unexpected `identity-mismatch`, and parity with **only** the accepted 2022 game `401506450` excluded (analytics-incomplete upstream; not reopened, not special-cased).
6. **All five 2021–2025 archive replacements completed** through the established `POST /api/admin/backfill` preview → explicit confirmed flow; each rebuilt archive carries a valid `gameStatSlate` snapshot paired with that archive's own `scoresByKey` (the 2024 backfill replaced the corrupted hybrid with the genuine Texas–Georgia game and its paired snapshot); `401506450` remains the sole accepted analytics-incomplete residual.

## 8e) PLATFORM-086H3E activation — operator sequence + production record

The E3 build (final atomic wiring, MERGED via PR #410) changes serving behavior when it is promoted, but **writing stays operator-gated**: the fenced legacy writer persists only under writer-control `legacy`, H2 only under `active`, and in `armed` both refuse. **Automatic** refreshes are additionally gated by BOTH `isAutoRefreshAllowed('game-stats')` conditions — `globalPause == false` **and** the game-stats dataset `enabled != false`; a scheduled QStash delivery that arrives while EITHER gate is closed returns a provider-free paused/disabled result. Execute these steps **in order**; on ANY unexpected residual, refusal anomaly, prerequisite drift, or CLI exit `4` (indeterminate durability — reread with a dry run and STOP; never blind-retry), stop and investigate.

**Production activation checkpoint — 2026-07-26.** Steps 1–13 below are complete; they are retained as the historical sequence and must not be replayed merely because this document is being read.

- Production serves the exact reviewed code-bearing artifact: commit `a161e33`, deployment `dpl_73jnt1KDqaAE5dRT9BJ5uLRfpLEt`. Repository `main` is `34ffdd8`, a docs-only build that was deliberately not promoted. Auto-assign Custom Production Domains remains disabled until this post-activation documentation update is complete.
- Writer control transitioned `legacy → armed → active` and is now durably `active`. Production must never return to `legacy`; emergency fallback is `active → read-only-safe`.
- Provider-free cache, missing-partition, historical Insights, Maleski career, archived-season, and career/season-record checks passed with no identity, unavailable-data, or failed-data warnings.
- The one controlled manual proof targeted `2025 / week 16 / regular`: `success` / `written-clean`, durable coverage `1/1`, published `1`, zero identity mismatch, zero participant-validation unavailable, and exact scoped status `game-stats:week:2025:16:regular` with source `cfbd`, `rowsCommitted: 5`, no partial failure, and no last error.
- CFBD `/info` probes consumed zero calls. The manual `/games/teams` proof consumed exactly one call (`4921 → 4920`); the confirmed remaining quota is `4920`, comfortably above the 1,000-call reserve.
- QStash schedule `turfwar-game-stats-15m` is active and unpaused with the fixed 15-minute `GET` contract, retries `0`, no callbacks/queue/delay/scheduler retry, exactly one forwarded Authorization header, and provider-side credential redaction. Read-only inspection passed.
- With global pause on and game-stats auto disabled, a scheduled delivery returned HTTP `200`; the route credential was therefore accepted, no provider-refresh attempt was created, and CFBD remained `4920`. The gates then opened in order: dataset enabled first, global pause cleared last.
- Current live state: writer control `active`; QStash active/unpaused; game-stats auto enabled; global provider pause off; CFBD remaining `4920`. Score automation remains separate and was not activated.
- **Closeout still pending:** observe one scheduled delivery after both gates opened; require QStash HTTP `200`, unchanged CFBD quota (`4920`) because no partition should currently be inside the polling window, and no unexpected game-stats provider attempt. After recording that evidence, re-enable Auto-assign Custom Production Domains. The lack of an app-side structured log for the exact harmless skip reason is a known non-blocking PLATFORM-086F observability gap; it does not reopen H3E or justify a fake provider-refresh attempt.

**Preflight — read-only verification of the completed prerequisites (NO refresh, NO backfill).** The §8d correction sequence, the current-season refreshes, the participant/parity audits, and all five 2021–2025 archive backfills are **already complete** (§8d). Do NOT repeat them here. VERIFY read-only and STOP on any drift:

1. **Confirm the exact staged, code-bearing deployment** is the reviewed merged build and is NOT yet serving `turfwar.games`.
2. **Confirm writer control is `legacy`** (`npm run transition:writer-control -- --from legacy --to armed` as a DRY RUN only reports the current state; do not apply yet).
3. **Confirm global provider pause is ENABLED.**
4. **Confirm automatic game-stats refresh is DISABLED** (the per-dataset toggle).
5. **Read-only verify the recorded prerequisites and fingerprints** from §8d: corrected schedule identities are durable for 2021–2025; the 2024 archive is the genuine Texas–Georgia game; every archive carries a valid paired `gameStatSlate` snapshot; participant/parity results are clean (zero `participant-validation-unavailable`, zero unexpected `identity-mismatch`, only `401506450` excluded).
6. **STOP on any drift.** Do not automatically refresh schedules or run archive backfills during activation; any detected drift is a stop condition requiring separately approved investigation.

7. **Activation — both automation gates stay CLOSED until the very end. Writer control `legacy → armed`**: dry-run then apply `npm run transition:writer-control -- --from legacy --to armed --apply`. In `armed` the old build's legacy writer refuses — automatic refreshes are already disabled and global pause is on.
8. **Controlled release of the exact reviewed build** (verified against current Vercel docs): the E3 PR is merged with **Auto-assign Custom Production Domains** DISABLED (Vercel → Project → Settings → Environments → Production → Branch Tracking), so the merge built a true Production-environment deployment in **Staged** state serving no traffic. With control `armed`, **Promote** that exact staged deployment (dashboard ellipsis → Promote, or `vercel promote`) — instant, no rebuild. Re-enable the toggle after the post-activation docs update. **Pre-`active` rollback order (mandatory): Instant Rollback to the prior production deployment FIRST (still `armed`), verify the old fenced writer is serving, then `armed → legacy`. Never transition to `legacy` while the E build serves.**
   **External trigger note:** the 15-minute game-stats poll is NOT a Vercel cron — `vercel.json` carries only the two daily lifecycle crons, and the poll is triggered by an external QStash schedule calling the unchanged `GET /api/cron/game-stats` (Vercel Hobby rejects sub-daily crons at deploy time, so there is **no Vercel-plan requirement** for the `*/15` cadence). The QStash schedule is provisioned in step 11 and is NOT part of this build's promotion.
9. **Smoke test (strictly NO provider calls)**: authenticated cache-only `/api/game-stats` reads (admin-only on every request; distinct absence/read-failure/context outcomes; projector-only wire with no internal metadata), Insights/history/career analytics over the backfilled archives, and evidence-based diagnostics. Confirm the control record reads `armed` via a CLI dry-run — in `armed` both writers refuse by construction. Do NOT exercise a `bypassCache=1` refresh here.
10. **`armed → active`** then **one controlled manual provider proof**: dry-run then apply `npm run transition:writer-control -- --from armed --to active --apply` (exit `4`: reread and stop). Then an explicit admin `bypassCache=1` refresh for one approved current-season `(year, providerWeek, seasonType)` target — this deliberate manual action is NOT subject to the automation gates. Verify ingestion (`refresh.outcome`/`reason`), the confirmed durable reread in `durable`, projection, analytics gating, exact scoped provider status, and quota accounting. **Determine empirically whether `/info` spends quota** (compare `remaining` before/after a usage probe) and record it.
11. **Provision the external QStash trigger** — only AFTER the manual proof is clean, with global pause STILL enabled and the game-stats dataset STILL disabled. `QSTASH_TOKEN` (management-only; operator-held, never in Vercel or the repo) and `CRON_SECRET` (the deployed route credential Vercel holds, forwarded by QStash) must be in the operator's environment.
    - **11a. Upsert the schedule**: `npm run manage:game-stats-schedule -- upsert --apply`. The CLI emits the FIXED contract only — schedule id `turfwar-game-stats-15m`, `POST /v2/schedules/https://turfwar.games/api/cron/game-stats`, `Upstash-Cron: */15 * * * *`, `Upstash-Method: GET`, `Upstash-Retries: 0`, `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`, **`Upstash-Redact-Fields: header[Authorization]`** (provider-side redaction of the forwarded route credential), no callback/failure-callback/queue/workflow/scheduler-retry. Exit `4` (unconfirmed) → inspect (read-only) before any retry; never blind-retry.
    - **11b. Inspect to verify the readback**: `npm run manage:game-stats-schedule` (read-only default; needs NO `CRON_SECRET`). Exit `0` requires the readback to match the fixed contract AND the forwarded Authorization to be **REDACTED** — a single entry of the form `REDACTED:<opaque>` (never plaintext or a `Bearer` value; plaintext means redaction is missing and the route secret would be exposed in QStash). This proves schedule STRUCTURE and provider-side REDACTION; it does **not** prove exact route authentication — the redacted digest is undocumented and unreproducible, so exact route auth is proven by step 12. A PAUSED note prints if the schedule is paused. The CLI never prints the token, forwarded secret, or digest.
12. **Exact-authentication delivery proof** (gates STILL closed): wait for one scheduled QStash delivery.
    - Provision + inspect (step 11) succeeded with global pause enabled and game-stats automation disabled.
    - Wait for one scheduled delivery.
    - Require **HTTP 200 with the paused/disabled result** (`skipped: "automatic game-stats refresh is paused or disabled"`).
    - Verify **zero provider calls and no refresh attempt** (provider status shows no new attempt; CFBD `remaining` unchanged).
    - A **401**, a missing delivery, or **any other result is a STOP condition** (a 401 means QStash's forwarded `Bearer <CRON_SECRET>` does not match the deployed route credential — do not open the gates).
    - Only after this proof passes may the automation gates be opened (step 13).
13. **Open both automation gates in order**: first **enable the game-stats dataset** (global pause STILL enabled); then **clear global pause LAST**. Verify BOTH gates are open (`globalPause == false` and the dataset `enabled != false`) before waiting for a live delivery.
14. **Verify one LIVE scheduled 15-minute delivery** through QStash logs (filter by schedule id) AND application status: exactly one delivery with `maxRetries: 0`, an authenticated route response, at most one partition fetch honoring the kickoff-window bound, the 1,000-call reserve, both automation gates open, and the exact status mapping — with no score automation.
15. **Post-activation record + operational procedures.** The emergency stop is `active → read-only-safe` (resume via `read-only-safe → active`); **never return to `legacy`**. Complete a separate docs-only status update recording the exact deployed commit, control transitions, refreshed years, audit evidence, archive backfills, manual proof, QStash provisioning + inspection, the exact-authentication delivery proof, the first live delivery, quota state (incl. the `/info` cost finding), and final control + gate state.

    **Emergency stop order (both gates + schedule before any writer transition):** (1) **enable global pause**; (2) **disable automatic game-stats refresh** (dataset); (3) `npm run manage:game-stats-schedule -- pause --apply` (stop QStash deliveries); (4) perform any separately authorized writer transition (`active → read-only-safe`). Resume reverses it: writer `read-only-safe → active` → `npm run manage:game-stats-schedule -- resume --apply` → enable the dataset → clear global pause LAST. **Any rollback after schedule provisioning:** enable global pause, disable automatic refresh, and pause the QStash schedule FIRST — so no delivery can reach a provider before both controls are intentionally reopened.

    **Coordinated `CRON_SECRET` rotation:** enable global pause → disable automatic refresh → `npm run manage:game-stats-schedule -- pause --apply` → update the deployed secret in Vercel → re-run `npm run manage:game-stats-schedule -- upsert --apply` (re-forwards the new value and re-applies redaction) → `npm run manage:game-stats-schedule` (inspect, verifies redaction while provider-disabled) → repeat the exact-authentication delivery proof (step 12) → `npm run manage:game-stats-schedule -- resume --apply` → enable the dataset → clear global pause LAST.

## 9) Common failure diagnosis

### Clerk sign-in fails or redirects loop

- Check:
  1. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set in Vercel for the correct environment.
  2. The Clerk production instance domain matches `turfwar.games`.
  3. The CNAME record for `clerk.turfwar.games` is set at Porkbun and verified in Clerk.
  4. The session token customization includes `publicMetadata`.

### A platform-admin user can sign in but gets redirected away from `/admin`

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
  1. The admin save action actually succeeded.
  2. The storage panel reports `postgres`.
  3. The second browser is loading the same URL/environment.
  4. You are not relying on stale local data in only one browser.
