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
- `CRON_SECRET` — long random value (e.g. `openssl rand -hex 32`). Bearer token every scheduled run must present. **Only the two lifecycle crons are declared in `vercel.json`** (`/api/cron/season-transition`, `/api/cron/season-rollover`, both daily 00:00 UTC). `/api/cron/game-stats` (every 15 min, see §8e), `/api/cron/live-scores` (every 3 min, see §8f), `/api/cron/odds` (hourly, see §8g), `/api/cron/schedule-refresh` (weekly, see §8h), and `/api/cron/rankings` (twice daily 04:00/22:00 UTC, see §8j — schedule NOT provisioned until §8j runs) are **not** in `vercel.json` — each is triggered by an external **QStash** schedule that forwards `Authorization: Bearer <CRON_SECRET>` to its unchanged route (Vercel Hobby rejects sub-daily crons). All external schedules forward the SAME `CRON_SECRET`. The cron routes **fail closed**: if this is missing or unset, every scheduled run returns `401` and automated season transition, season rollover, game-stats ingestion, live-score polling, and automatic Odds polling silently stop. `CRON_SECRET` is the route credential and is **deployed in Vercel**; it is distinct from `QSTASH_TOKEN`, the operator-held QStash **management** credential used only to provision/rotate the schedules (§8e/§8f/§8g) — `QSTASH_TOKEN` must never be set in Vercel or committed. Treat `CRON_SECRET` as required in any environment that runs the crons, and supply it locally when provisioning or rotating a QStash schedule.
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

- Production serves the exact reviewed code-bearing artifact: commit `a161e33`, deployment `dpl_73jnt1KDqaAE5dRT9BJ5uLRfpLEt`. Repository `main` carries the post-activation docs-only builds that were deliberately not promoted. Auto-assign Custom Production Domains has since been **re-enabled** (2026-07-26) after the post-activation documentation update.
- Writer control transitioned `legacy → armed → active` and is now durably `active`. Production must never return to `legacy`; emergency fallback is `active → read-only-safe`.
- Provider-free cache, missing-partition, historical Insights, Maleski career, archived-season, and career/season-record checks passed with no identity, unavailable-data, or failed-data warnings.
- The one controlled manual proof targeted `2025 / week 16 / regular`: `success` / `written-clean`, durable coverage `1/1`, published `1`, zero identity mismatch, zero participant-validation unavailable, and exact scoped status `game-stats:week:2025:16:regular` with source `cfbd`, `rowsCommitted: 5`, no partial failure, and no last error.
- CFBD `/info` probes consumed zero calls. The manual `/games/teams` proof consumed exactly one call (`4921 → 4920`); the confirmed remaining quota is `4920`, comfortably above the 1,000-call reserve.
- QStash schedule `turfwar-game-stats-15m` is active and unpaused with the fixed 15-minute `GET` contract, retries `0`, no callbacks/queue/delay/scheduler retry, exactly one forwarded Authorization header, and provider-side credential redaction. Read-only inspection passed.
- With global pause on and game-stats auto disabled, a scheduled delivery returned HTTP `200`; the route credential was therefore accepted, no provider-refresh attempt was created, and CFBD remained `4920`. The gates then opened in order: dataset enabled first, global pause cleared last.
- Current live state: writer control `active`; QStash active/unpaused; game-stats auto enabled; global provider pause off; CFBD remaining `4920`. Score automation remains separate and was not activated.
- **Closeout COMPLETE (2026-07-26):** multiple gates-open scheduled deliveries returned QStash HTTP `200` with CFBD quota unchanged at `4920` (no partition inside the polling window, so no provider-refresh attempt was created), and Auto-assign Custom Production Domains has been re-enabled. **H3E activation is fully closed — no remaining activation or closeout work.** The lack of an app-side structured log for the exact harmless skip reason is a known non-blocking PLATFORM-086F observability gap (the next related slice); it does not reopen H3E or justify a fake provider-refresh attempt.

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

    **Coordinated `CRON_SECRET` rotation:** enable global pause → disable automatic refresh → `npm run manage:game-stats-schedule -- pause --apply` → update the deployed secret in Vercel → re-run `npm run manage:game-stats-schedule -- upsert --apply` (re-forwards the new value and re-applies redaction) → `npm run manage:game-stats-schedule` (inspect, verifies redaction while provider-disabled) → repeat the exact-authentication delivery proof (step 12) → `npm run manage:game-stats-schedule -- resume --apply` → enable the dataset → clear global pause LAST. **Once the live-scores schedule (§8f) also exists, `CRON_SECRET` is shared by BOTH schedules: rotation must pause AND re-upsert BOTH `turfwar-game-stats-15m` and `turfwar-live-scores-3m` before the new secret is re-enabled — see §8f.**

## 8f) PLATFORM-086B2B activation — live-score polling operator sequence — ✅ COMPLETED

**Status: this activation sequence has been PERFORMED — live-score polling is ACTIVE in production (2026-07-28).** The section below is retained as the **historical operator procedure** and the ongoing **emergency-stop / `CRON_SECRET`-rotation reference**; it is NOT a step to repeat. **Do NOT replay any step merely because this documentation is being read** — the QStash schedule is provisioned, both automation gates are open, and re-running provisioning/gate changes would be an unintended production mutation.

**Production activation checkpoint (2026-07-28):**

- QStash schedule `turfwar-live-scores-3m` is **active and unpaused**, fixed cadence **every 3 minutes**, `GET /api/cron/live-scores`.
- **Gates-closed** scheduled delivery: HTTP `200`, result/reason `skipped / automation-paused-or-disabled` — the forwarded route credential was accepted, no provider-refresh attempt was created.
- **Gates-open** scheduled delivery: HTTP `200`, result/reason `skipped / no-polling-target` — with `quotaChecked: false` and `providerCallAttempted: false` (no game inside the kickoff window at delivery time, so no quota probe and no provider call).
- **CFBD quota held at the controlled activation baseline `4914 → 4914`** across these deliveries; no unexpected score-refresh attempt or durable score write occurred. (The earlier movement from `4920` to `4914` occurred **before** this controlled activation baseline and is **not** attributed to these deliveries — do not speculatively explain it.)
- Final production settings: **Scores automatic refresh On**, **Global provider pause Off**, browser polling strictly cache-only, `vercel.json` unchanged (the schedule is external QStash, not a Vercel cron).
- **The first legitimate game-window `/scoreboard` or final-reconciliation call is ordinary in-season monitoring, NOT an activation blocker or pending activation work** — activation is complete; that first billed call simply happens the next time a game is inside the kickoff window with the gates open.

---

The B2B build (live-score activation wiring, PR #418) merged the previously-dormant B1 engine (`GET /api/cron/live-scores`) and B2A writer-lock convergence into an **operator-activatable** state, which the sequence below then activated. **Promoting the build does NOT start server-side score automation** — no `turfwar-live-scores-3m` QStash schedule exists until step 4 below, so the route stays dormant. What promotion DOES change immediately, and harmlessly: a **visible browser tab** on the **current season** now issues a **cache-only** `/api/scores` read every 3 minutes for games inside `[kickoff − 15 min, kickoff + 24 h]` (excluding canceled/postponed; in-window finals stay eligible so a `/games` reconciliation correction still reaches an open page, and age out of the window). These reads use a `live=1` durable-cache hint and spend **no CFBD/Odds quota and never trigger a provider fetch** (public cache-only path, PLATFORM-075); until the QStash schedule is provisioned they simply re-read a cache that only manual admin refresh updates, so the freshness label will read stale between manual refreshes. The browser read is intentionally NOT gated by the auto-refresh toggle/global pause (those gate quota-spending automation; a free cache read is not that).

The **server-side** automation — the QStash `turfwar-live-scores-3m` schedule that makes `GET /api/cron/live-scores` poll CFBD `/scoreboard`+`/games` and durably merge scores — is gated by BOTH `isAutoRefreshAllowed('scores')` conditions (`globalPause == false` AND the `scores` dataset `enabled != false`); a scheduled delivery arriving while EITHER gate is closed returns HTTP `200` with a provider-free paused/disabled skip. **This activation is independent of the game-stats writer-control state** (score automation has no writer-control) and is a **distinct post-merge phase** — execute only after the PR is merged and deployed. On any CLI exit `4` (indeterminate durability), inspect read-only and STOP; never blind-retry.

1. **Confirm the merged build is deployed** and the two lifecycle crons are still the only entries in `vercel.json` (`/api/cron/live-scores` is NOT a Vercel cron — Vercel Hobby rejects the `*/3` cadence; it is triggered externally by QStash).
2. **Confirm both automation gates are CLOSED**: global provider pause **enabled** and the `scores` dataset auto-refresh **disabled** (admin provider-status panel). Both gate the server cron.
3. **Confirm operator credentials are present** in the operator's environment (never in Vercel/repo): `QSTASH_TOKEN` (management-only) and `CRON_SECRET` (the deployed route credential Vercel holds, forwarded by QStash — the SAME value both schedules forward).
4. **Provision the external QStash trigger** (gates STILL closed):
   - **4a. Upsert**: `npm run manage:live-scores-schedule -- upsert --apply`. The CLI emits the FIXED contract only — schedule id `turfwar-live-scores-3m`, `POST /v2/schedules/https://turfwar.games/api/cron/live-scores`, `Upstash-Cron: */3 * * * *`, `Upstash-Method: GET`, `Upstash-Retries: 0`, `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`, **`Upstash-Redact-Fields: header[Authorization]`**, no callback/failure-callback/queue/workflow/scheduler-retry. Exit `4` → inspect (read-only) before any retry.
   - **4b. Inspect**: `npm run manage:live-scores-schedule` (read-only default; needs NO `CRON_SECRET`). Exit `0` requires the readback to match the fixed contract AND the forwarded Authorization to read back **REDACTED** (`REDACTED:<opaque>`, never plaintext/`Bearer`). This proves schedule STRUCTURE + provider-side REDACTION, not exact route authentication (proven by step 5).
5. **Exact-authentication delivery proof** (gates STILL closed): wait for one scheduled delivery and require **HTTP 200 with the paused/disabled skip** (`automation-paused-or-disabled`), zero provider-refresh attempt created, CFBD quota unchanged. A **401**, a missing delivery, or any other result is a **STOP** condition (a 401 means QStash's forwarded `Bearer <CRON_SECRET>` does not match the deployed route credential — do not open the gates).
6. **Open both gates in order**: first **enable the `scores` dataset** (global pause STILL enabled); then **clear global pause LAST**. Verify BOTH gates open before waiting for a live delivery.
7. **Verify one LIVE 3-minute delivery** via QStash logs (filter by schedule id) AND application status: exactly one delivery with `maxRetries: 0`, an authenticated route response, at most ONE billed CFBD `/scoreboard` or `/games` request honoring the kickoff-window bound and the 1,000-call monthly reserve, both gates open, and a durable score merge (monotonic/newer-live protection intact). **QStash at-least-once delivery is accepted without a durable lease**: a duplicate delivery re-runs the same idempotent poll and the per-key advisory-locked merge tolerates it (no double-count; a re-observed row is a no-op or a monotonic no-op).
8. **Post-activation record.** Complete a separate docs-only status update recording the exact deployed commit, QStash provisioning + inspection, the exact-authentication proof, the first live delivery, and final gate state.

   **Emergency stop order (gates + schedule):** (1) **enable global pause**; (2) **disable the `scores` dataset auto-refresh**; (3) `npm run manage:live-scores-schedule -- pause --apply` (stop QStash deliveries). Resume reverses it: `npm run manage:live-scores-schedule -- resume --apply` → enable the dataset → clear global pause LAST. Any rollback after provisioning: close both gates and pause the schedule FIRST, so no delivery can reach a provider before the gates are intentionally reopened.

   **Coordinated `CRON_SECRET` rotation now spans BOTH schedules** (they share the secret): enable global pause → disable BOTH the `game-stats` and `scores` datasets → `npm run manage:game-stats-schedule -- pause --apply` AND `npm run manage:live-scores-schedule -- pause --apply` → update the deployed secret in Vercel → re-run `upsert --apply` for BOTH schedules (re-forwards the new value + re-applies redaction) → inspect BOTH (verifies redaction while provider-disabled) → repeat the exact-authentication delivery proof for BOTH → `resume --apply` for BOTH → re-enable both datasets → clear global pause LAST. **Once the Odds schedule (§8g) also exists, `CRON_SECRET` is shared by all THREE schedules — rotation must pause AND re-upsert `turfwar-game-stats-15m`, `turfwar-live-scores-3m`, AND `turfwar-odds-hourly` before the new secret is re-enabled (see §8g).**

## 8g) PLATFORM-086C2 activation — automatic Odds polling operator sequence — ✅ COMPLETED

**Status: this activation sequence has been PERFORMED — automatic Odds polling is ACTIVE in production.** The `turfwar-odds-hourly` QStash schedule is provisioned and both automation gates are open, so `GET /api/cron/odds` runs on its hourly cadence. The section below is retained as the **historical operator procedure** and the ongoing **emergency-stop / `CRON_SECRET`-rotation reference**; it is NOT a step to repeat. **Do NOT replay any step merely because this documentation is being read** — the schedule is provisioned and re-running provisioning/gate changes would be an unintended production mutation.

The C2 build (PR #420) converged the manual `GET /api/odds?refresh=1` route and the automatic cron onto ONE shared server-side execution authority (`executeOddsRefresh`), closed the pre-existing `ODDS_API_KEY` credential-exposure seam (upstream URL/message redaction), made public/member Odds reads durable-cache-only with a bounded (120 s) cross-instance memo, and activated the Odds provider descriptor (`hasActiveAutomation: true`, `autoRefreshSettingConsumed: true`) — all resting on the PLATFORM-086C1 refresh authority (durable per-target lease + observation ordering + atomic commit). Merging the build did not by itself start server-side Odds automation; the §8g sequence below then provisioned the schedule and opened the gates. Public/member `/api/odds` serves the **durable cache only** (never a self-fetch, never quota) and reflects cross-instance cron commits within the 120 s memo window; the hourly cron is what now keeps that cache warm (in addition to manual admin refresh).

The **server-side** automation — the QStash `turfwar-odds-hourly` schedule that makes `GET /api/cron/odds` decide cadence and, only when a refresh is DUE, issue at most ONE billed `/odds` request — is gated by BOTH `isAutoRefreshAllowed('odds')` conditions (`globalPause == false` AND the `odds` dataset `enabled != false`); a scheduled delivery arriving while EITHER gate is closed returns HTTP `200` with a provider-free `skipped / automation-paused-or-disabled`. The hourly cadence is a CEILING, not the request rate: the pure policy issues a request only when the freshest completed signal is older than the cadence threshold for the STAGE the target is in, an eligible in-horizon game exists, and the durable automatic backoff is not active — so most hourly deliveries are provider-free `skipped / refresh-not-due` or `skipped / no-eligible-target`.

**Staged cadence (PLATFORM-089).** The stage is chosen by the distance to the NEAREST eligible canonical kickoff:

| Nearest eligible kickoff | Cadence | Receipt/event `cadence` |
| --- | --- | --- |
| Inside the 6 h before that America/Chicago date's first kickoff | 2 h | `pregame` |
| ≤ 7 days | 6 h | `baseline` |
| > 7 and ≤ 45 days | 24 h | `early` |
| Nothing eligible inside 45 days | no request | `null` (`skipped / no-eligible-target`) |

The polling horizon is **45 days**; it was 7 days through PLATFORM-086C2, which left already-downloaded lines unmaintained for weeks before a season and produced a standing `odds-cache-stale` health warning no operator action could clear. **Budget impact: about 3 credits/day** (one canonical request) while the nearest game is 7–45 days out — the 50-credit automation reserve, the quota-free `/sports` probe, the one-billed-request-per-due-invocation rule, and the hourly schedule itself are all unchanged. Expect `skipped / no-eligible-target` to be rare in the ~6 weeks before a season and normal in deep offseason.

**`no-op / early-lines-withdrawn`** is an expected reason in the early window, not a fault: prior lines existed and the provider returned none while no game is inside the 7-day expectation horizon — a book withdrawing a far-out line. It records a completed check and, like any valid no-op, CLEARS the automatic failure count and backoff window — it is a successful check, not a suppressed error. The same disappearance with a game inside 7 days remains `failure / odds-empty-unexpected` (502, backoff), and a manual refresh is unchanged.

**Odds health freshness** is judged from the canonical `odds-cache` entry (per binding invariant 1) and is only reported as actionable when a non-disrupted game falls inside that same 45-day polling horizon — so an old snapshot with nothing to poll for no longer warns. On any CLI exit `4` (indeterminate durability), inspect read-only and STOP; never blind-retry.

1. **Confirm the merged build is deployed** and the two lifecycle crons are still the only entries in `vercel.json` (`/api/cron/odds` is NOT a Vercel cron — it is triggered externally by QStash, like game-stats and live-scores).
2. **Confirm both automation gates are CLOSED**: global provider pause **enabled** and the `odds` dataset auto-refresh **disabled** (admin provider-status panel). Both gate the server cron.
3. **Confirm operator credentials are present** in the operator's environment (never in Vercel/repo): `QSTASH_TOKEN` (management-only) and `CRON_SECRET` (the deployed route credential Vercel holds, forwarded by QStash — the SAME value all three schedules forward). `ODDS_API_KEY` must be set in Vercel (the cron fails closed with `500 / odds-api-key-missing`, release-only, if it is absent).
4. **Provision the external QStash trigger** (gates STILL closed):
   - **4a. Upsert**: `npm run manage:odds-schedule -- upsert --apply`. The CLI emits the FIXED contract only — schedule id `turfwar-odds-hourly`, `POST /v2/schedules/https://turfwar.games/api/cron/odds`, `Upstash-Cron: 0 * * * *`, `Upstash-Method: GET`, `Upstash-Retries: 0`, `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`, **`Upstash-Redact-Fields: header[Authorization]`**, no callback/failure-callback/queue/workflow/scheduler-retry. Exit `4` → inspect (read-only) before any retry.
   - **4b. Inspect**: `npm run manage:odds-schedule` (read-only default; needs NO `CRON_SECRET`). Exit `0` requires the readback to match the fixed contract AND the forwarded Authorization to read back **REDACTED** (`REDACTED:<opaque>`, never plaintext/`Bearer`). This proves schedule STRUCTURE + provider-side REDACTION, not exact route authentication (proven by step 5).
5. **Exact-authentication delivery proof** (gates STILL closed): wait for one scheduled delivery and require **HTTP 200 with the paused/disabled skip** (`automation-paused-or-disabled`), zero provider-refresh attempt created, CFBD/Odds quota unchanged. A **401**, a missing delivery, or any other result is a **STOP** condition (a 401 means QStash's forwarded `Bearer <CRON_SECRET>` does not match the deployed route credential — do not open the gates).
6. **Open both gates in order**: first **enable the `odds` dataset** (global pause STILL enabled); then **clear global pause LAST**. Verify BOTH gates open before waiting for a live delivery.
7. **Verify one LIVE delivery** via QStash logs (filter by schedule id) AND the `odds-cron` runtime event (§8 diagnostics): exactly one delivery with `maxRetries: 0`, an authenticated route response, and either a provider-free skip (`refresh-not-due` / `no-eligible-target` / `quota-reserve`) or — when a refresh is genuinely due — the quota-free `/sports` probe followed by AT MOST ONE billed `/odds` request honoring the 50-credit automation reserve, both gates open, and a durable commit through the per-target lease. **QStash at-least-once delivery is accepted without a duplicate-spend risk**: the durable per-target lease serializes concurrent runs, the post-acquisition cadence re-check suppresses a redundant request after a just-completed manual refresh, and observation ordering makes a re-observed row a monotonic no-op.
8. **Post-activation record.** Complete a separate docs-only status update recording the exact deployed commit, QStash provisioning + inspection, the exact-authentication proof, the first live delivery, and final gate state.

   **Emergency stop order (gates + schedule):** (1) **enable global pause**; (2) **disable the `odds` dataset auto-refresh**; (3) `npm run manage:odds-schedule -- pause --apply` (stop QStash deliveries). Resume reverses it: `npm run manage:odds-schedule -- resume --apply` → enable the dataset → clear global pause LAST. Any rollback after provisioning: close both gates and pause the schedule FIRST, so no delivery can reach a provider before the gates are intentionally reopened.

   **Coordinated `CRON_SECRET` rotation now spans all FOUR schedules** (they share the secret) — see §8h for the full four-schedule rotation order (`turfwar-game-stats-15m`, `turfwar-live-scores-3m`, `turfwar-odds-hourly`, `turfwar-schedule-weekly`).

## 8h) PLATFORM-086E1B activation — weekly schedule maintenance operator sequence — ✅ COMPLETED

**Status: this activation sequence has been PERFORMED — weekly schedule maintenance is ACTIVE in production (2026-07-29).** The section below is retained as the **historical operator procedure** and the ongoing **emergency-stop / `CRON_SECRET`-rotation reference**; it is NOT a step to repeat. **Do NOT replay any step merely because this documentation is being read** — the `turfwar-schedule-weekly` QStash schedule is provisioned, active, and unpaused, Schedule automation is On, and re-running provisioning/gate changes would be an unintended production mutation. (History preserved: E1B merged DORMANT via PR #423 — merging activated nothing; activation was then held for the E1B1 preseason coverage gap; the bounded correction E1B1 merged via PR #424; this operator sequence was executed afterward. The procedure below reflects the corrected E1B1 behavior.)

**Production activation checkpoint — 2026-07-29.** PLATFORM-086E1B/E1B1 weekly schedule maintenance is active in production. QStash schedule `turfwar-schedule-weekly` was provisioned and inspected against the fixed Tuesday 12:00 UTC GET contract with retries 0 and provider-side Authorization redaction. A provider-free exact-authentication delivery while Schedule automation was Off returned HTTP 200 with `skipped / season-transition-owner` for 2026, `providerCallAttempted: false`, zero rows received or committed, and no data change. Schedule automation was then enabled, and a second authenticated delivery returned the same truthful provider-free deferral. This is the expected current state because the 2026 leagues remain in preseason and the daily season-transition cron currently owns schedule discovery/freshness. Final state: weekly QStash schedule active and unpaused, Schedule automation On, global provider pause Off. The first later `preseason-maintenance` or active-season provider refresh is ordinary ongoing operation and is not an activation blocker.

Checkpoint evidence detail:

- **Deployment:** PLATFORM-086E1B deployed from PR #423; PLATFORM-086E1B1 deployed from PR #424.
- **Inspected fixed QStash contract** (`turfwar-schedule-weekly`, active and unpaused): `GET https://turfwar.games/api/cron/schedule-refresh`; cron `0 12 * * 2`; retries 0; exactly one forwarded Authorization header; provider-side Authorization redaction enabled.
- **Provider-free exact-authentication delivery while Schedule automation was Off:** QStash message `msg_7YoJxFpwkEy5zBp3k2p1FanPwPaaCiDhrB3afW9BLnPYnmMK9P72h` → HTTP `200`, `skipped / season-transition-owner`, `providerCallAttempted: false`, zero rows received, zero rows committed, no data change. This proves QStash delivered the forwarded credential successfully and that the route made the truthful provider-free ownership decision. It does **NOT** prove ordinary Schedule-toggle gating — the result did not depend on the closed gate, because `season-transition-owner` defers before ordinary settings are relevant.
- **Open-gate delivery** (after Schedule automation was turned On), 2026-07-29 20:47:44 UTC: HTTP `200`, `skipped / season-transition-owner`, `providerCallAttempted: false`, zero rows received, zero rows committed, no data change — expected, because the 2026 leagues remain in `preseason` and the durable schedule-probe/lifecycle conditions currently assign schedule discovery/freshness to the daily season-transition cron.
- **No provider call was attempted by either delivery.**
- **Final production state:** `turfwar-schedule-weekly` active and unpaused; Schedule automatic refresh **On**; global provider pause **Off**; current 2026 refresh owner: the daily season-transition cron; the weekly schedule route is active and authenticated, currently deferring provider work truthfully. Weekly provider maintenance begins automatically when ownership changes to `preseason-maintenance` or active-season maintenance. Probe arming and the first natural weekly provider-backed refresh are **not** activation blockers — activation is complete.

---

The corrected route delegates each targeted year to the E1A full-season schedule authority (`refreshFullSeasonSchedule` — durable per-year lease, complete-before-commit, observation-ordered transaction) with **operation-aware** gating under this ownership model:

```text
Preseason, schedule/probe not armed        → daily season-transition owns discovery
Preseason, first game known and > 7d away  → weekly E1B ordinary maintenance (`preseason-maintenance`)
Preseason, within 7 days of first kickoff  → daily season-transition owns freshness + lifecycle transition
Active season                              → weekly E1B `ordinary-maintenance`
Postseason boundary                        → weekly E1B sticky lifecycle-critical `postseason-boundary`
```

**Ordinary operations** (`preseason-maintenance`, `ordinary-maintenance`) honor the global pause + the Schedule dataset toggle; **postseason-boundary maintenance** (from 7 days before the latest regular-season kickoff, sticky while leagues remain in `season`) is **lifecycle-critical and EXEMPT** — like the season-transition/rollover crons themselves. A transition-owned preseason year is an intentional provider-free deferral (`skipped / season-transition-owner`), never a failure. Every eligible refresh fetches the complete regular+postseason season; E1A's lease + observation ordering make duplicate/overlapping QStash deliveries safe. On any CLI exit `4` (indeterminate durability), inspect read-only and STOP; never blind-retry.

### Preflight

1. **Confirm the reviewed E1B1 commit is serving production**, and `vercel.json` still contains ONLY the two daily lifecycle jobs (season-transition, season-rollover) — `/api/cron/schedule-refresh` is externally triggered by QStash, never a Vercel cron.
2. **Confirm the active year's current classification.** Safe provider-free activation-proof states:

   ```text
   preseason-maintenance + Schedule Off  → skipped / automation-paused-or-disabled
   ordinary-maintenance  + Schedule Off  → skipped / automation-paused-or-disabled
   season-transition-owner               → skipped / season-transition-owner (provider-free deferral)
   ```

   **STOP for user-approved activation planning ONLY if the year already classifies `postseason-boundary`** — that operation intentionally bypasses the Schedule toggle, so no gated proof exists in that window.

3. **Turn the Schedule automatic-refresh toggle Off** (admin provider-status panel). Global pause may remain Off — the dataset toggle alone is sufficient for the ordinary proof.
4. **Confirm operator credentials**: `QSTASH_TOKEN` (management-only; operator environment ONLY — never Vercel or the repo) and `CRON_SECRET` (the deployed route credential Vercel holds; the SAME value all four schedules forward).
5. **Confirm no `turfwar-schedule-weekly` schedule exists** (`npm run manage:schedule-refresh-schedule` — read-only inspect), or inspect any existing schedule before mutation.

### Provision

```bash
npm run manage:schedule-refresh-schedule -- upsert --apply
npm run manage:schedule-refresh-schedule            # read-only inspect
```

Require: schedule id `turfwar-schedule-weekly`; destination `https://turfwar.games/api/cron/schedule-refresh`; cron `0 12 * * 2` (Tuesdays 12:00 UTC — QStash evaluates cron in UTC); method GET; retries 0; no callback/failure-callback/queue/delay/flow-control policy; exactly ONE forwarded Authorization header whose readback is **`REDACTED:<opaque>`** (provider-side redaction active; never plaintext). Inspect proves structure + redaction, NOT exact route authentication — that is the next step. Exit `4` is indeterminate: inspect before any retry.

### Exact-authentication proof

Keep the Schedule toggle **Off** and wait for the first scheduled delivery. Require **HTTP 200** with `providerCallAttempted: false` on every year entry, `rowsCommitted: 0`, exactly one `schedule-refresh-cron` runtime event, NO new schedule provider-refresh attempt, NO schedule write, and CFBD quota unchanged. The expected body/event depends on the year's window:

- **Early preseason** (armed probe, first game > 7 days away): `skipped / automation-paused-or-disabled` with `operation: preseason-maintenance`.
- **Within the final seven days (or unarmed probe)**: `skipped / season-transition-owner` — the daily transition cron owns the year; this is equally a valid provider-free authentication proof.
- **Active season (ordinary window)**: `skipped / automation-paused-or-disabled` with `operation: ordinary-maintenance`.

A **401**, a missing delivery, any unexpected provider call/attempt/write, a divergent contract, or any other response is a **STOP** condition.

### Open the gate

1. Turn Schedule automation **On** (only after the proof above).
2. Perform one deliberate authorized route invocation, or wait for the following Tuesday's delivery.
3. **If the year is still early preseason (or active-season ordinary)**: verify ONE complete E1A regular+postseason refresh for the year (`written-clean`/`unchanged-clean`, or a truthful no-op); exactly one structured event; the exact year-scoped provider-refresh status advanced; bounded provider usage (two CFBD `/games` requests per refreshed year); no partial/empty replacement (prior-good retained on any failure).
4. **If the year is transition-owned** (inside the final seven days): leave the schedule active and verify the delivery reports `skipped / season-transition-owner` while the DAILY season-transition cron owns freshness — weekly provider work begins automatically once the lifecycle state becomes `season`.
5. **Post-activation record**: complete a separate docs-only update recording the deployed commit, the QStash contract readback, the exact-authentication proof delivery, the first gated run's result/reason/operation/rows/data-change state, and the CFBD quota evidence.

### Emergency stop

- **Ordinary window**: turn Schedule automation **Off** → `npm run manage:schedule-refresh-schedule -- pause --apply`.
- **Critical (postseason-boundary) window**: `pause --apply` is the AUTHORITATIVE stop — the critical operation intentionally ignores the ordinary settings gates, so pausing the QStash schedule is what stops deliveries.
- **Resume**: `npm run manage:schedule-refresh-schedule -- resume --apply` → enable Schedule automation. If the year is currently critical, resume the schedule only after the underlying issue is resolved.

### Coordinated `CRON_SECRET` rotation (all FOUR schedules)

`CRON_SECRET` now spans `turfwar-game-stats-15m`, `turfwar-live-scores-3m`, `turfwar-odds-hourly`, and `turfwar-schedule-weekly`. Rotation order:

1. Enable global pause.
2. Disable the `game-stats`, `scores`, `odds`, AND `schedule` (ordinary) dataset toggles.
3. `pause --apply` for ALL FOUR schedule managers.
4. Update `CRON_SECRET` in Vercel.
5. Re-run `upsert --apply` for ALL FOUR (re-forwards the new value + re-applies redaction).
6. Inspect ALL FOUR (exact contract + redaction).
7. Repeat the scheduled exact-authentication proofs with provider gates closed.
8. `resume --apply` for ALL FOUR.
9. Re-enable the datasets.
10. Clear global pause LAST.

For a **postseason-boundary** Schedule window, pausing `turfwar-schedule-weekly` — NOT the Schedule toggle — is what guarantees no delivery during rotation (the critical operation ignores the toggle).

### Postseason structured-data checkpoint

When CFBD first publishes the postseason/championship slate, inspect the normalized durable schedule read-only. The CFP championship row must eventually carry: a numeric provider id, a valid kickoff, a structured playoff competition, `playoffRound: national_championship`, and `playoffRoundSource: cfbd-structured`. Until that evidence exists, automatic rollover remains fail-closed (PLATFORM-086E1A). **Do NOT restore text inference or the latest-postseason fallback if the provider shape differs** — treat a mismatch as a separately reviewed normalization task. This checkpoint does not block preseason E1B activation.

## 8i) PLATFORM-086E1C2 — automatic schedule-presentation observation checkpoint — ⏳ PENDING (post-merge; NO provisioning step)

**There is nothing to provision or toggle.** E1C2 wires the E1C1 presentation authority into the two ALREADY-ACTIVE canonical schedulers (`turfwar-schedule-weekly` and the daily season-transition Vercel cron), so merging the PR makes presentation refresh eligible on the next qualifying canonical success — activation is OBSERVATION ONLY. Do not create a schedule, change a toggle, or invoke anything to "activate" it. Record the observations below from actual production evidence only (Vercel Runtime Logs; the CFBD quota panel if captured) — never fabricate delivery IDs, call counts, timestamps, or quota values.

What to observe, in order:

1. **The E1C1 manual proof is already complete** (pre-E1C2): the 2026-07-30 02:37 UTC manual full-year seed committed media `written-clean` (456 rows) + venues `written-clean` (844 rows), aggregate `success`, terminal CFBD remaining `4899`. Nothing to repeat.
2. **A provider-free weekly skip proves no presentation call occurs on non-qualifying runs.** While 2026 remains transition-owned (`skipped / season-transition-owner`), a weekly delivery emits ONE `schedule-refresh-cron` event and NO `schedule-presentation-refresh` event — the correct negative proof.
3. **The first qualifying automatic canonical success** (a `written-clean`/`unchanged-clean` populated year on either cron) should emit a SEPARATE `schedule-presentation-refresh` event (`trigger: weekly` or `season-transition`) alongside the unchanged canonical event/response. Expected media reason: `written-clean` or `unchanged-clean`.
4. **Normal venue behavior is `fresh-cache` with zero `/venues` calls** while the durable catalog (seeded 2026-07-30) is younger than 30 days; a `/venues` fetch is expected only once the catalog is ≥30 days old. Normal per-year bound: 2 canonical `/games` + 1 `/games/media` (+1 `/venues` only when due).
5. **Emergency stop (ordinary weekly maintenance):** the existing Schedule toggle / global pause stops ordinary canonical years before E1A runs, which also stops their presentation work (no separate presentation gate exists). **Lifecycle-critical paths remain exempt by design:** the season-transition cron and a `postseason-boundary` weekly success still run canonical work and their piggybacked presentation refresh regardless of the gates; pausing `turfwar-schedule-weekly` (schedule manager `pause --apply`) is the authoritative stop for the weekly route, exactly as in §8h.

After observing (2) and (3), complete a docs-only checkpoint here recording the observed events (date, trigger, media/venues reasons, and quota evidence if captured), then proceed to PLATFORM-086E2.

## 8j) PLATFORM-086E2B activation — automatic rankings publication operator sequence — ✅ COMPLETED (2026-07-30)

**Production activation record (2026-07-30):** the sequence below was EXECUTED and verified. `turfwar-rankings-publication` is provisioned, active, and unpaused; the contract readback verified exactly (`GET https://turfwar.games/api/cron/rankings`, cron `0 4,22 * * *`, retries `0`, exactly one provider-redacted forwarded Authorization header). **Gates-closed proof**: QStash message `msg_7YoJxFpwkEy4DbXxFQZ91MK8xiB1wPdpTVwXqzbabbkFQqCevikHu` delivered HTTP `200` `skipped / automation-paused-or-disabled` with no quota check and no provider work. **Open-gate proof**: an authenticated delivery returned HTTP `200` `skipped / not-a-heartbeat-slot` with `quotaChecked: false`, `providerCallAttempted: false`, and no rows or data changes — one of the sanctioned provider-free outcomes (step 8); per step 9, a provider-backed publication is ordinary monitoring, NOT an activation blocker. **Final state**: Rankings automation On, global pause Off, schedule active/unpaused, CFBD quota and provider status unchanged. The first natural due-window refresh (e.g. a Sunday 22:00 UTC weekly slot once polls exist) is observed via the `rankings-cron` event as routine monitoring.

The original sequence (retained as the procedure record):

**Merging the E2B build activates nothing**: the route (`GET /api/cron/rankings`), the descriptor flip (Rankings toggle interactive), and the management CLI ship dormant — **no `turfwar-rankings-publication` QStash schedule exists until this sequence provisions it**, and the application's publication policy (not the heartbeat) decides when provider work is due. Perform in order; record actual evidence only.

1. **Deploy the reviewed merge** to production (ordinary promote flow).
2. **Turn Rankings automation Off** (`/admin/diagnostics` → Provider Data Status → Rankings toggle). Leave every other dataset schedule untouched.
3. **Read-only inspect** — `npm run manage:rankings-schedule` (no action = inspect) with operator-held `QSTASH_TOKEN` — and confirm no divergent `turfwar-rankings-publication` schedule already exists.
4. **Provision**: `npm run manage:rankings-schedule -- upsert --apply` (requires `QSTASH_TOKEN` + `CRON_SECRET` locally; neither is ever printed).
5. **Inspect the readback**: exact destination `https://turfwar.games/api/cron/rankings`, cron `0 4,22 * * *`, method GET, retries 0, exactly ONE forwarded Authorization header whose readback is provider-redacted (`REDACTED:<opaque>` — never the plaintext secret).
6. **Gates-closed authentication proof**: with Rankings Off, verify one delivery (QStash logs + the `rankings-cron` runtime event) returns an authenticated HTTP 200 `skipped / automation-paused-or-disabled` with `quotaChecked: false`, no provider attempt, and zero `/info`/rankings requests.
7. **Turn Rankings automation On.**
8. **Open-gate policy proof**: observe one authenticated delivery that is either a provider-free skip (`not-a-heartbeat-slot`, `no-window-due`, or `publication-window-complete`) or a legitimate due-window refresh (fresh `/info` probe ≥ 1,007 remaining → at most one two-partition rankings refresh → durable window completion).
9. **A first provider-backed publication is ordinary monitoring, not an activation blocker** — exact authentication plus truthful open-gate policy evaluation is sufficient to declare activation complete.
10. **Record the actual evidence** (dates, event results/reasons, quota values if captured) in a later docs-only production checkpoint here.
11. **Emergency stop**: Rankings toggle Off first (every automatic rankings refresh is noncritical and gated), then `npm run manage:rankings-schedule -- pause --apply` for the schedule itself; the global pause is the broader emergency control. The authorized manual refresh remains available throughout.
12. **Coordinated `CRON_SECRET` rotation now spans all FIVE schedules** (they share the secret): enable global pause → disable the game-stats, scores, odds, schedule, AND rankings datasets → `pause --apply` for ALL FIVE (`turfwar-game-stats-15m`, `turfwar-live-scores-3m`, `turfwar-odds-hourly`, `turfwar-schedule-weekly`, `turfwar-rankings-publication`) → update the deployed secret in Vercel → `upsert --apply` for all five (re-forwards the new value + re-applies redaction) → inspect all five → repeat the exact-authentication delivery proof → `resume --apply` for all five → re-enable the datasets → clear global pause LAST.

Operational notes: QStash at-least-once delivery is accepted without duplicate-spend risk (a completed publication window is durably immutable; unfinished claims are 5-minute token-safe; E2A's per-year lease + observation ordering protect the refresh itself). A delivery delayed past the minute-exact 04:00/22:00 slot skips truthfully as `not-a-heartbeat-slot` and the window waits for its next occurrence (retries are 0 by contract) — persistent delay-skips warrant checking QStash delivery latency, not the application.

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
