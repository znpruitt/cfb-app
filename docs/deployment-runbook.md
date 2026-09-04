# Production Deployment Runbook

Status: Current
Last verified: 2026-08-26
Owner: Project documentation
Canonical for: detailed hosted-deployment and production-operator procedures
Supersedes: the pre-DOCS-016 deployment runbook, whose completed activation evidence is archived

Use this runbook to deploy and operate **turfwar.games** on Vercel. For the shorter architectural
summary, see [`operations/deployment.md`](operations/deployment.md). Completed 2026 rollout evidence
is preserved in [`archive/operations/provider-activation-2026.md`](archive/operations/provider-activation-2026.md);
it is historical evidence, not a procedure to replay.

## 1) Current production topology

- Vercel hosts the Next.js application. Production domains move only when a deployment is manually
  promoted (§6b).
- Neon Postgres stores shared application state. Preview deployments use child branches, never the
  production connection (§6c).
- Clerk supplies identity and the `platform_admin` role. League passwords use the separate
  `LEAGUE_AUTH_SECRET` gate.
- CFBD supplies schedules, scores, rankings, conferences, and game statistics. The Odds API supplies
  betting lines.
- Vercel Cron owns the two daily lifecycle jobs declared in `vercel.json`.
- QStash runs the seven externally scheduled provider jobs in §8.

| Scheduler | Route | Cadence (UTC) | Owner |
| --- | --- | --- | --- |
| Vercel Cron | `/api/cron/season-transition` | daily 00:00 | lifecycle |
| Vercel Cron | `/api/cron/season-rollover` | daily 00:00 | lifecycle |
| `turfwar-game-stats-15m` | `/api/cron/game-stats` | every 15 minutes | QStash |
| `turfwar-live-scores-3m` | `/api/cron/live-scores` | every 3 minutes | QStash |
| `turfwar-team-records-hourly` | `/api/cron/team-records` | hourly | QStash |
| `turfwar-odds-hourly` | `/api/cron/odds` | hourly | QStash |
| `turfwar-schedule-weekly` | `/api/cron/schedule-refresh` | Tuesdays 12:00 | QStash |
| `turfwar-rankings-publication` | `/api/cron/rankings` | 04:00 and 22:00 daily | QStash |

> **Temporary production hold (owner-confirmed 2026-08-27):** both Vercel lifecycle schedules are
> disabled pending the planned 2026 roster publication on 2026-08-27. Re-enable both afterwards,
> then verify the next authenticated `season-transition` and `season-rollover` System Health
> receipts name the promoted production build. Their repository definitions, cadence, and
> lifecycle-critical policy are unchanged.

All nine routes require the same deployed `CRON_SECRET`. The seven QStash schedules are intentionally
absent from `vercel.json`.

## 2) Create or reconnect the hosted project

1. Connect the GitHub repository to a Vercel project.
2. Set the default branch to `main` and enable preview deployments for pull requests.
3. Add `turfwar.games` and the intended `.vercel.app` production alias.
4. Disable **Settings -> Environments -> Production -> Auto-assign Custom Production Domains** so
   builds do not ship until explicitly promoted (§6b).
5. Confirm the project uses the repository's `vercel.json`, including its ignored-build command and
   exactly the two lifecycle crons.

## 3) DNS, Clerk domain, and Postgres

1. At Porkbun, apply Vercel's current A/CNAME records for `turfwar.games`.
2. In Clerk, set the production domain to `turfwar.games`, apply Clerk's required CNAME records, and
   wait until both Clerk and Vercel report verification.
3. Create or select the production Neon Postgres database and copy its complete SSL connection
   string.
4. Set Preview `DATABASE_URL` to a Neon child branch, not the production database (§6c).
5. Do not set `PGSSLMODE=disable` unless the database provider explicitly requires it.

## 4) Environment variables

Set production values in Vercel. Set Preview values where the preview application requires them,
using preview-safe credentials and the child database.

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required; production and Preview must point to different databases. |
| `CFBD_API_KEY` | Required for CFBD-backed refreshes. |
| `ODDS_API_KEY` | Required for odds refreshes. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Required for Clerk. |
| `CLERK_SECRET_KEY` | Required for Clerk. |
| `CRON_SECRET` | Required bearer credential for all nine cron routes. Use a long random value. |
| `LEAGUE_AUTH_SECRET` | Required when any league has a password. Use a long random value. |

`ADMIN_API_TOKEN` is an optional fallback during Clerk migration. It is not the league-password
secret and should not replace Clerk for normal admin use.

Optional variables: `NEXT_PUBLIC_SEASON`, `PGSSLMODE`, `NEXT_PUBLIC_DEBUG`, `DEBUG_CFBD`, and
`DEBUG_UPSTREAM`. Leave debug variables unset in normal production.

`QSTASH_TOKEN` is different from `CRON_SECRET`: it is an operator-held management credential used
by the seven schedule-manager scripts. Never commit it or configure it in Vercel. The deployed
`CRON_SECRET` is the credential QStash forwards. If `CRON_SECRET` is missing or mismatched, all nine
cron routes fail closed with `401`, stopping lifecycle reconciliation, statistics ingestion,
live-score polling, team-record refresh, odds polling, weekly schedule maintenance, and rankings
publication.

## 5) Configure authentication

### Clerk session claim

In Clerk Dashboard -> Sessions -> Customize session token, add:

```json
{
  "publicMetadata": "{{user.public_metadata}}"
}
```

### Platform administrator

Create or open the operator user in Clerk and set Public metadata to:

```json
{
  "role": "platform_admin"
}
```

After the user obtains a new session, confirm `/login` succeeds and `/admin` is accessible.

The three auth mechanisms are independent:

- Clerk proves identity and the `platform_admin` role for `/admin` and admin APIs.
- `ADMIN_API_TOKEN` is the temporary API fallback.
- `LEAGUE_AUTH_SECRET` signs each passworded league's `league_auth_<slug>` cookie. It does not grant
  platform-admin access.

## 6) First deployment

1. Save the required environment variables.
2. Trigger a production build from `main`.
3. Confirm the build reaches Ready.
4. Promote it using §6b.
5. Open `turfwar.games` and complete §7 before enabling or changing provider automation.

## 6b) Production promotion

Merging to `main` creates a production build but does **not** ship it. With automatic custom-domain
assignment disabled, `turfwar.games` remains on the last promoted deployment. Both the external
QStash jobs and the two Vercel lifecycle crons reach the promoted production deployment.

To promote:

1. Open Vercel -> Deployments.
2. Select the Ready deployment by exact commit SHA. The newest row is not necessarily the intended
   release.
3. Choose **Promote to Production**.
4. Confirm `vercel alias ls` or `vercel inspect turfwar.games` resolves the custom domain to the
   intended deployment. Do not infer custom-domain assignment from `vercel inspect <deployment>`;
   its Aliases block may omit custom domains.
5. Confirm the site and §7 signoff checks before calling the change shipped.

`vercel promote` is the equivalent CLI operation when the Vercel CLI is available.

For scheduled-job attribution, System Health records **Built from**. Read it together with the job's
**Completed** timestamp. A recent receipt should name the promoted commit; an old receipt cannot
establish which build a new run would use. The production binding was measured in 2026 and is
recorded in the operations archive.

Rollback is promotion of the last known-good Ready deployment. If the release affects provider
automation, close the relevant gates and pause the relevant external schedule before changing the
served build (§8), then verify the rollback and reopen controls deliberately.

## 6c) Preview database isolation

Preview uses a Neon child branch. It does not read or write production leagues, rosters, drafts,
archives, provider caches, or scheduler receipts.

The long-lived `preview` Git branch can reuse an old Neon branch and become increasingly stale as
continued deployments keep it alive. A feature branch's own deployment normally receives a newer
child branch copied near branch creation. Use a feature deployment when representative shared data
matters, or deliberately recreate/reset the long-lived preview branch through Neon.

### Preview branches cost money, and Vercel retention is what reclaims them

**Neon deletes a preview branch only after the last Vercel deployment referencing that Git branch is
deleted.** Deleting the Git branch does nothing on its own. So the standing Neon branch count is
governed by **Vercel's Deployment Retention Policy**, not by Git hygiene, and it settles at roughly
`branches-merged-per-day x retention-window`.

Measured 2026-08-31: 58 distinct branches merged in 14 days against a 14-day Pre-Production
retention held **48 Neon branches**, contributing roughly half of a $46 monthly Neon bill. That was
the steady state of the merge rate, not a leak. Pre-Production retention was set to **1 day**, which
holds about four.

This is safe because the owner's walkthrough surface is the long-lived `preview` Git branch, which
`CLAUDE.md` requires be force-pushed on every commit — it always has a minutes-old deployment, so no
retention window reaches it. Per-feature preview URLs are the occasional case described above and
regenerate on the next push. A useful side effect: any gap in pushing now expires the deployment, so
the next push gets a **fresh** child branch and the staleness described in the paragraph above
largely self-corrects.

Leave the other retention settings alone. Canceled at 1 day covers the docs-only build skips (§6d),
and Production at 30 days is the rollback window — load-bearing because auto-promotion is off and a
merge does not ship.

### Post-merge cleanup is automatic — do not add it to a checklist

Enabled 2026-08-31, so nothing here is a manual step:

| Stage | Mechanism |
| --- | --- |
| Git branch | GitHub `delete_branch_on_merge: true` — the head branch is deleted when the PR merges |
| Vercel deployments | Pre-Production retention, 1 day |
| Neon branch | reclaimed once the last deployment for that Git branch is gone |

Verify with `gh api repos/znpruitt/cfb-app --jq .delete_branch_on_merge`. If preview branches start
accumulating in Neon again, check that flag and the retention window **before** deleting anything by
hand — the count is downstream of both, and a manual sweep against a broken setting just refills.

This covers only branches merged **through a PR**. Work pushed straight to `main` (post-merge docs
closeouts, per `AGENTS.md`) creates no branch and needs no cleanup.

### Removing deployments by hand

Retention sweeps run as a background job, not on save. To clear a backlog, remove deployments
explicitly and verify production between batches:

```bash
vercel remove <deployment-url> ... --yes
vercel inspect turfwar.games | grep -E "url|status"   # must still name the promoted deployment
```

`vercel inspect <hostname>` is the only reliable way to ask what is actually being served.
`vercel inspect <deployment>` lists aliases a deployment has held, and a **superseded** production
deployment still lists the production aliases it no longer serves — so it cannot answer "is this
live?"

Deployments carrying an alias for a **deleted** Git branch still pin their Neon branch. Those are the
ones a retention window has not yet reached and a naive "unaliased only" sweep skips.

### Read-only production access — `DATABASE_URL_RO`

Because Preview is isolated and can be stale, questions of the form *"does this behave correctly
against the REAL schedule?"* cannot be answered there. The `cfb-audit-read-replica` compute
(`ep-plain-term-amtt3ekz`, `main` branch) answers them against production data **read-only**.

- **Operator and agent use only.** The application must NEVER read through it —
  `src/` contains no reference to it and must not gain one. This is an observability rail, not part
  of the read path.
- Connection string lives in `.env.operator.local` as `DATABASE_URL_RO` (gitignored). Use the
  **direct** host, not `-pooler`: operator diagnostics want a full session.
- **Autosuspend is 5 minutes** (set 2026-08-31; it was `never`, which cost ~$19/month for a compute
  with zero connections — see `next-tasks.md` Item 96). It suspends between uses and wakes on
  connect, so expect a sub-second cold start.
- **Two independent guarantees, deliberately.** The **role** `audit_ro` holds only `CONNECT`,
  `USAGE ON SCHEMA public`, and `SELECT` (plus a default-privileges grant so new tables are covered).
  The **endpoint** is `RO`. Either alone would do; both means a leaked string pointed at the primary
  read-write host still cannot write.
- **Verified 2026-08-31 against the PRIMARY (read-write) endpoint** — the only test that proves the
  ROLE rather than the endpoint: `SELECT` returned rows; `INSERT`, `UPDATE`, `DELETE` and
  `CREATE TABLE` were all refused. Re-run that probe rather than assuming it, since the safety of
  handing this to tooling rests on it.
- **`audit_ro` was created by SQL rather than the console**, which matters for privileges, not
  visibility — it DOES appear under Branches → `main` → Roles. Verified 2026-08-31: it is **not** a
  member of `neon_superuser` (unlike `neondb_owner`), owns nothing, and carries no `SUPERUSER`,
  `CREATEROLE`, `CREATEDB`, `BYPASSRLS` or `REPLICATION` attribute. Rotate it from the console or
  with `ALTER ROLE audit_ro WITH PASSWORD ...` through `DATABASE_URL`. **Rotating it never touches
  the application credential** — which is the point: on 2026-08-31 a `neondb_owner` rotation took
  production's DB routes down until a redeploy, and that class of outage should never be the price
  of rotating an operator credential.

Precedent for why it exists: PLATFORM-105 was verified against the real 3,610-game 2026 production
schedule and roster through this replica, which is what exposed the season reading as over after
Week 1 because unplayed weeks were treated as resolved.

Never use preview System Health to judge production scheduler or provider health:

- Vercel and QStash invoke production URLs, so scheduler receipts are not written to Preview.
- Provider status, quota observations, and durable cache freshness are separate preview records.
- Empty/stale preview cards do not imply a production failure, and green preview cards do not prove
  production health.

Preview remains useful for UI, auth, and mutations against isolated data. Inspect production through
the production domain and production store.

## 6d) Docs-only build gate

`vercel.json` owns the ignored-build command:

```sh
files=$(git diff --name-only HEAD^ HEAD) || exit 1;
[ -z "$files" ] && exit 1;
echo "$files" | grep -qvE "^docs/|^mockups/|\.md$" && exit 1;
exit 0
```

`^mockups/` was added 2026-08-31. `AGENTS.md:254` puts mockups (HTML/PNG) in `mockups/` and design
specs (markdown) in `docs/`, so a mockup edit is a docs-only change that the original pattern missed
— it is at the repo root, not under `docs/`, and not `.md`. Nothing imports from `mockups/` and it is
not in `public/`, so it cannot affect build output. A commit touching a mockup **and** app code still
builds.

**Testing this pattern locally can mislead.** `grep` may be shell-aliased to `ugrep`, whose `-q -v`
combination reports differently and will show a mixed docs+code commit as `skip`. Vercel runs GNU
grep; test with `/usr/bin/grep` before concluding the gate is wrong.

**Consequence for reviving `preview`:** resetting `preview` to `main` produces a deployment only if
`main`'s TIP commit touches code. When the tip is a docs closeout — the common case, since closeouts
land last — the build is skipped, and `preview` gets no deployment, no branch alias, and therefore no
Neon child branch. It restores itself on the next code commit pushed to `preview`. Observed
2026-08-31.

Vercel's exit semantics are important: `0` skips the build; `1` continues it. The command fails safe
toward building:

| Git result | Vercel action |
| --- | --- |
| Diff errors or no parent | build |
| No changed files | build |
| Any file outside `docs/` and `*.md` | build |
| Every changed file is under `docs/` or ends in `.md` | skip |

A skipped build still creates a canceled deployment record and counts toward deployment quotas; it
saves build work, not deployment-record quota. An empty commit forces a build if the ignore rule
itself must be tested. Current Vercel limits can change, so consult Vercel's limits page before
making quota decisions rather than preserving an old measurement here.

## 7) Release signoff

Run the full list for a new environment, auth/storage/provider-boundary change, or substantial
release. For a narrow routine promotion, run the impacted subset plus the first four checks.

1. The custom domain resolves to the intended commit.
2. The main league page loads without a server error.
3. `/login` works and a `platform_admin` can open `/admin`.
4. Admin System Health reports storage mode `postgres`, not `file-fallback` or
   `production-misconfigured`.
5. A second browser observes shared admin changes, proving durable—not local-only—state.
6. Schedule data loads through the API-backed route.
7. Scores and odds public reads succeed without triggering unauthorized provider fetches.
8. Owners upload/repair, alias editing, and diagnostics still load where the release touches them.
9. The two Vercel lifecycle cron definitions remain present and the seven QStash routes remain absent
   from `vercel.json`.
10. Each affected scheduler has a recent truthful receipt and **Built from** identifies the promoted
    deployment.

Do not open an automation gate merely to make a signoff card green. Diagnose the existing state
first; mutations require the specific operating procedure below.

## 8) Provider automation operations

All manager scripts are read-only by default. A mutating action requires both the action and
`--apply`. Always inspect first. On exit `4`, durability is indeterminate: inspect again and stop;
never blind-retry.

Every QStash schedule must use GET, retries 0, no callback/failure callback/queue/delay/flow-control
policy, exactly one forwarded `Authorization: Bearer <CRON_SECRET>` header, and provider-side
redaction whose readback is `REDACTED:<opaque>`. Readback proves schedule structure and redaction,
not exact authentication. A gates-closed HTTP 200 delivery proves the forwarded credential; `401`,
a missing delivery, provider activity despite closed gates, or an unexpected response is a stop
condition.

| Dataset | Manager | Application gate | Emergency stop |
| --- | --- | --- | --- |
| game stats | `manage:game-stats-schedule` | `game-stats` + global pause | close gates, pause schedule; writer `active -> read-only-safe` only if separately required |
| scores | `manage:live-scores-schedule` | `scores` + global pause | close gates, pause schedule |
| records | `manage:team-records-schedule` | `records` + global pause | close gates, pause schedule |
| odds | `manage:odds-schedule` | `odds` + global pause | close gates, pause schedule |
| schedule | `manage:schedule-refresh-schedule` | `schedule` + global pause for ordinary work | pause schedule; this is mandatory in a critical window |
| rankings | `manage:rankings-schedule` | `rankings` + global pause | close gates, pause schedule |

Generic inspect and control forms:

```bash
npm run <manager>
npm run <manager> -- pause --apply
npm run <manager> -- resume --apply
npm run <manager> -- upsert --apply
```

The `upsert` form requires operator-held `QSTASH_TOKEN` and local `CRON_SECRET`. Inspect does not
need `CRON_SECRET`. To stop one noncritical job: enable global pause, disable its dataset, pause its
schedule, and inspect. Resume in reverse: resume the schedule, enable the dataset, clear global
pause last. The global pause is broader than a single-job stop.

### §8b) Team-catalog correction — completed

The 2026 catalog correction and H3E parity verification are complete. Current production
reverification found 138 catalog entries and kept San Diego distinct from San Diego State. Do not
rerun the historical repair. Evidence is in the [activation archive](archive/operations/provider-activation-2026.md#team-catalog-correction).

### §8c) Schedule correction — completed

The 2024–2025 postseason identity correction is complete and production-reverified. Non-FBS
postseason games remain distinct from CFP rounds. Do not force refreshes merely to repeat that
repair. Evidence and canonical provider IDs are in the [activation archive](archive/operations/provider-activation-2026.md#schedule-correction).

### §8d) Schedule identity and archive backfills — completed

The 2021–2025 schedule refresh, participant audit, and archive rebuild are complete. Evidence is in
the [activation archive](archive/operations/provider-activation-2026.md#schedule-identity-and-archive-backfills).

### §8e) Game statistics — active

Contract: `turfwar-game-stats-15m`, GET `/api/cron/game-stats`, `*/15 * * * *`, retries 0.

```bash
npm run manage:game-stats-schedule
```

Writer control must remain `active` for ingestion. Never transition back to `legacy`. For an
ingestion incident: enable global pause, disable game-stats automation, pause and inspect the
schedule, then—only if the incident calls for a durable writer fence—validate and apply the stop:

```bash
npm run transition:writer-control -- --from active --to read-only-safe
npm run transition:writer-control -- --from active --to read-only-safe --apply
```

Resume only after the root cause is resolved. Validate and apply recovery before resuming the
schedule, enabling the dataset, and clearing global pause last:

```bash
npm run transition:writer-control -- --from read-only-safe --to active
npm run transition:writer-control -- --from read-only-safe --to active --apply
```

Exit `0` is the only confirmed dry run or transition. Exit `2` is a refusal, exit `3` means the
Postgres store is unavailable or not writable, and exit `4` means commit durability is
**indeterminate**. On exit `4`, do not retry, repair, or assume which state won: rerun the relevant
dry-run command, use its actual/expected-state report to confirm the durable state, and stop until the
state is known. See [`ai/game-stats-writer-fence.md`](ai/game-stats-writer-fence.md) for the
writer-control authority and the
[activation archive](archive/operations/provider-activation-2026.md#game-stats-automation) for
rollout evidence.

### §8f) Live scores — active

Contract: `turfwar-live-scores-3m`, GET `/api/cron/live-scores`, `*/3 * * * *`, retries 0.

```bash
npm run manage:live-scores-schedule
```

Server-side provider polling is bounded by the canonical kickoff-window target and handles at most
one applicable partition per run. A visible current-season browser tab performs a cache-only score
read on the same three-minute cadence; it never calls CFBD and is intentionally not gated by the
provider automation settings. For an incident: global pause on, Scores automation off, pause and
inspect the schedule. Activation evidence is [archived](archive/operations/provider-activation-2026.md#live-score-automation).

**§8f step 5 (CLI authentication-proof reference):** with global pause on and Scores automation
off, a scheduled delivery must return authenticated HTTP 200 `automation-paused-or-disabled`, open
no provider-refresh attempt, and leave CFBD quota unchanged. `401` or provider work is a stop.

### §8g) Odds — active

Contract: `turfwar-odds-hourly`, GET `/api/cron/odds`, `0 * * * *`, retries 0.

```bash
npm run manage:odds-schedule
```

The application—not the hourly heartbeat—decides whether provider work is due. Provider-free skips,
including `early-lines-withdrawn` outside the expectation horizon, can be healthy. For an incident:
global pause on, Odds automation off, pause and inspect the schedule. Activation evidence is
[archived](archive/operations/provider-activation-2026.md#odds-automation).

**§8g step 5 (CLI authentication-proof reference):** with global pause on and Odds automation off,
a scheduled delivery must return authenticated HTTP 200 `automation-paused-or-disabled`, open no
provider-refresh attempt, and leave provider quota unchanged. `401` or provider work is a stop.

### §8h) Weekly schedule maintenance — active

Contract: `turfwar-schedule-weekly`, GET `/api/cron/schedule-refresh`, `0 12 * * 2` (Tuesday 12:00
UTC), retries 0.

```bash
npm run manage:schedule-refresh-schedule
```

Ownership is determined by application state:

```text
Preseason, schedule/probe not armed             -> daily season-transition discovery
Preseason, start-date anchor >7d away           -> weekly preseason maintenance
Preseason, within 7d of start-date anchor       -> daily transition freshness/lifecycle
Active season                                   -> weekly ordinary maintenance
Postseason boundary                             -> sticky lifecycle-critical maintenance
```

`preseason-maintenance` and `ordinary-maintenance` honor the Schedule toggle and global pause.
`postseason-boundary` is lifecycle-critical and bypasses both settings. During that critical window,
pausing `turfwar-schedule-weekly` is the authoritative stop. A transition-owned preseason delivery
truthfully skips as `season-transition-owner` without provider work.

A successful refresh may emit `schedule-games-vanished` when numeric CFBD game records disappear.
That is observability, not another provider call or a refresh failure; follow
[`operations/diagnostics.md`](operations/diagnostics.md#vanished-cfbd-schedule-records).

Postseason checkpoint: when CFBD publishes the championship slate, verify the durable championship
row has a numeric provider ID, valid kickoff, structured playoff competition,
`playoffRound: national_championship`, and `playoffRoundSource: cfbd-structured`. If provider data
does not support those fields, stop and open a reviewed normalization task. Do not restore text
inference or a latest-postseason fallback. Activation evidence is
[archived](archive/operations/provider-activation-2026.md#weekly-schedule-maintenance).

### §8i) Schedule-presentation observation — pending

There is nothing to provision or toggle. Presentation refresh is already attached to the active
weekly schedule and daily season-transition authorities.

Complete these observations from real production evidence:

1. A provider-free weekly `season-transition-owner` skip emits one `schedule-refresh-cron` event and
   no `schedule-presentation-refresh` event.
2. The first qualifying populated `written-clean` or `unchanged-clean` canonical success emits a
   separate `schedule-presentation-refresh` event with trigger `weekly` or `season-transition`.
3. Record media and venue reasons plus quota evidence if available. `fresh-cache` with no `/venues`
   call is normal while the venue catalog is younger than 30 days; `/venues` is due only at 30 days
   or older.
4. Close the matching item in `next-tasks.md` and add the production evidence here in a docs-only
   closeout.

The 2026-07-30 manual seed is already complete and must not be repeated. Ordinary schedule gates
also stop presentation work because canonical refresh never begins. Lifecycle-critical transition
and postseason-boundary work remains exempt; pausing the weekly QStash schedule is the weekly-route
stop. Prior evidence is [archived](archive/operations/provider-activation-2026.md#schedule-presentation-observation).

### §8j) Rankings publication — active

Contract: `turfwar-rankings-publication`, GET `/api/cron/rankings`, `0 4,22 * * *`, retries 0.

```bash
npm run manage:rankings-schedule
```

The publication policy—not every heartbeat—decides whether provider work is due. Healthy
provider-free reasons include `not-a-heartbeat-slot`, `no-window-due`, and
`publication-window-complete`. Delayed delivery beyond an exact slot skips truthfully; persistent
delays warrant QStash latency investigation, not adding retries. For an incident: global pause on,
Rankings automation off, pause and inspect the schedule. Authorized manual refresh remains
available. Activation evidence is [archived](archive/operations/provider-activation-2026.md#rankings-publication).

**§8j step 6 (CLI authentication-proof reference):** with global pause on and Rankings automation
off, a scheduled delivery must return authenticated HTTP 200 `automation-paused-or-disabled`, make
no quota check or provider attempt, and commit no rows. `401` or provider work is a stop.

### §8k) Team records — provision after merge

Contract: `turfwar-team-records-hourly`, GET `/api/cron/team-records`, `0 * * * *`, retries 0.

```bash
npm run manage:team-records-schedule
```

The hourly schedule is only a heartbeat. The shared records authority refreshes immediately when
live-scores observes a newly final game after the six-hour floor, or whenever cache age reaches the
independent twelve-hour ceiling. Healthy intervening deliveries are provider-free. A due automatic
run performs one fresh CFBD `/info` reserve probe and at most one billed `/records` request; `/info`
is measured as zero billed CFBD calls on this project. A quota refusal records the refusal and the
next hourly heartbeat probes again—there is intentionally no durable quota-refusal backoff.

The records diagnostic warns after fourteen hours, a two-hour cache-age margin beyond the ceiling.
Because a cache commit can land between hourly slots, the first ceiling-eligible heartbeat can be up
to 59 minutes later; the actionable margin after that slot is therefore between one and two hours,
not two complete hourly delivery slots. Scheduler delivery grace remains an independent signal. The
threshold assumes this hourly job is unpaused. Item 96 must preserve that assumption or add a
generalized lifecycle-applicability rule when it introduces offseason pausing; this job has no
records-only offseason exception today.

Provision after the reviewed implementation is merged and promoted:

1. Run the manager in default inspect mode. Before first provisioning, a clean not-found refusal is
   expected; any existing divergent contract is a stop.
2. Enable global pause and disable Team records automation.
3. Run `npm run manage:team-records-schedule -- upsert --apply` with the operator-held credentials.
4. Inspect again. Require the exact contract, retries 0, active state, and one provider-redacted
   forwarded Authorization header.
5. With both application gates still closed, require one authenticated HTTP 200
   `automation-paused-or-disabled` delivery, no quota check or provider attempt, and no committed
   rows. `401` or provider work is a stop.
6. If the proof is clean, enable Team records automation and clear global pause last. Confirm the
   next System Health scheduler receipt names the promoted build.

Before step 3, System Health will report the newly known `team-records` delivery as missing; that is
expected provisioning state, not evidence that another job regressed. For an incident after
activation: global pause on, Team records automation off, pause and inspect the schedule.

### §8m) CFBD usage sampler (Item 127)

`GET /api/cron/usage-sample`, driven by the QStash schedule `turfwar-usage-sample-6h` at
`0 */6 * * *`. Manage it with `tsx scripts/manage-usage-sample-schedule.ts`; `inspect` is read-only.

**It spends no quota.** The route reads CFBD `/info`, which is not a billed call, and writes one
bounded entry per UTC day to `app_state` scope `provider-usage`, key `cfbd-daily`. It touches no
canonical data, has no dataset toggle, and returns HTTP 200 even when the durable write fails —
retrying a sample would produce a different observation, not repair the missed one.

**Why it exists.** `/info` reports usage for the current period only and CFBD exposes no history, so
a month boundary destroys the prior month's burn permanently. Every other observation point is
conditional — the game-stats probe sits behind an exact-target gate, System Health only reads on an
admin page view — so a series built from them samples expensive days and misses cheap ones.

**Authentication proof:** resume the schedule, confirm one HTTP 200 delivery, and verify a new entry
appears for today under `provider-usage / cfbd-daily`. A `401` is the same stop condition as every
other job.

### §8l) Rotate `CRON_SECRET` across all seven QStash schedules

All seven schedules forward the same secret, so rotation is one coordinated operation:

1. Enable global pause.
2. Disable automatic game-stats, scores, records, odds, schedule, and rankings refresh. The usage
   sampler has no dataset toggle — it reads `/info` only and writes no canonical data.
3. Pause all seven managers with `pause --apply`; inspect all seven and confirm they are paused. In a
   postseason-boundary window, this Schedule pause—not its dataset toggle—is the critical stop.
4. Update `CRON_SECRET` in Vercel Production, trigger a fresh production deployment, wait for it to
   become Ready, and promote it. Environment-variable changes do not alter an already-built runtime.
5. With the matching new `CRON_SECRET` and operator-held `QSTASH_TOKEN` local, run `upsert --apply`
   for all seven managers. This forwards the new bearer value and reapplies redaction.
6. Inspect all seven. Require the exact contracts, paused state, and one redacted Authorization
   header. Exit `4` remains indeterminate: inspect and stop.
7. Resume each schedule only long enough to obtain its gates-closed authentication delivery. Require
   HTTP 200 and no provider attempt/quota change for the five noncritical jobs and ordinary schedule
   maintenance. If Schedule is in `postseason-boundary`, its application gates are intentionally
   bypassed: keep it paused until one normal provider-backed delivery is authorized, then use that
   HTTP 200 as the authentication proof. A `401` or any policy-divergent activity is a stop condition.
8. Pause again immediately if any proof fails. Otherwise resume all seven, re-enable their datasets,
   and clear global pause last.
9. Confirm the two Vercel lifecycle routes also return authenticated results with the new secret at
   their next run or through an authorized operator invocation.

Do not rotate only one external schedule: that leaves the other five forwarding the retired secret.

## 9) Common failure diagnosis

### A merge is Ready but the site still shows old behavior

The deployment is probably unpromoted. Compare the site's resolved deployment and commit SHA with
the intended build, then use §6b. Do not change data or scheduler controls to compensate for an old
served build.

### Preview System Health is stale, empty, or contradictory

Confirm the URL and Neon branch. Preview has isolated provider caches and no production scheduler
receipts (§6c); inspect production before diagnosing a production outage.

### A scheduled route returns `401`

1. Confirm `CRON_SECRET` is present in the promoted Vercel Production deployment.
2. For QStash, inspect the relevant schedule and require exactly one redacted Authorization header.
3. If the secret was rotated, follow the complete seven-schedule procedure in §8l.
4. Keep gates closed until an HTTP 200 provider-free authentication proof succeeds.

### Clerk sign-in fails or redirects repeatedly

1. Confirm the publishable and secret keys belong to the production Clerk instance.
2. Confirm Clerk's production domain and DNS records.
3. Confirm the session token includes `publicMetadata`.
4. Obtain a fresh session after claim changes.

### A signed-in user cannot open `/admin`

Confirm Clerk Public metadata contains `{ "role": "platform_admin" }`, the customized session token
includes it, and the user has refreshed their session.

### Admin API actions return `401`

Confirm the Clerk session and role. If intentionally using the fallback, confirm `ADMIN_API_TOKEN`
is deployed and the request supplies it in `x-admin-token` or `Authorization: Bearer <token>`.

### Postgres is missing or unreachable

Confirm `DATABASE_URL` is complete, uses the intended environment, permits Vercel connections, and
has the required SSL mode. `file-fallback` or `production-misconfigured` is a stop condition for
production signoff. If two browsers disagree, verify they use the same environment and that the
write actually succeeded.

### A provider refresh fails

- CFBD-backed schedule, scores, rankings, conference, or statistics failures: confirm
  `CFBD_API_KEY`, then inspect the exact scoped provider-refresh status and prior-good cache. Do not
  interpret a valid no-op as failure or overwrite prior-good data manually.
- Odds failures: confirm `ODDS_API_KEY`, quota, the canonical odds-cache status, and the hourly job's
  policy reason.
- For any job, read the latest structured cron event, outcome, scope, provider-call flag, rows
  received/committed, and **Built from** before retrying.

## 10) Backup, rollback, and incident record

- Rely on Neon backups/branching according to the database plan, and verify restore capability
  before a high-risk data migration.
- Prefer Vercel promotion of a known-good Ready deployment for application rollback (§6b).
- Close provider gates and pause affected QStash schedules before rolling back scheduler or writer
  code. Never move the game-stats writer to `legacy`; use `read-only-safe` when its fence is needed.
- Do not delete QStash schedules during an incident. Pause them so the contract remains inspectable
  and recovery is reversible.
- Record the incident timeline, exact commit/deployment, affected scope, controls changed, durable
  state, and reopening proof in the appropriate diagnostics or campaign closeout document.
