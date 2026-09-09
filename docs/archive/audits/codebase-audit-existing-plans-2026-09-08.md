# TurfWar — Consolidated Codebase and Production Audit

**Audit identifier:** `CODEBASE-AUDIT-EXISTING-PLANS`
**Evidence collected:** September 8, 2026 CDT / September 9, 2026 UTC
**Audited main commit:** `4ff239ec53db3eeaebde52f7682af647aa33b5a8`
**Production commit observed:** `3e2385e69af1f1130802e3dea6f2e05a5a4d8681`

> **Status: dated evidence record. This file is the single home for the audit's detail.** Queue entries
> stay concise and link here; do not duplicate this narrative into `docs/next-tasks.md`,
> `docs/completed-work.md` or a campaign document. Findings describe the observed snapshots and are not
> continuous monitoring or a claim that production remains unchanged.
>
> **Independently reproduced by the planning session, 2026-09-08, before the queue was reconciled:**
> **R1** — `fetchUpstreamResponse` (`src/lib/api/fetchUpstream.ts:279`) returns the response and its
> `finally { clearTimeout(timeoutHandle) }` fires on that return, while `fetchUpstreamJson:409` awaits
> `response.json()` afterwards; the body download is outside the deadline. **S1** —
> `src/app/api/insights/[slug]/route.ts` gates on `isAuthorizedForLeague(slug, req)` only, then reads
> `bypassSuppression` from the query string. Both reproduce exactly as written.

No application code, production data, schedules, or deployments were changed. The investigation made two
direct CFBD requests for comparison; these consumed provider quota without publishing their results.

## Executive summary

**TurfWar's core architecture is sound. The immediate priority is recovering outdated production
statistics and closing failure-handling gaps. A broad architectural rewrite is not justified.**

The strongest foundations are:

- Schedule-first canonical games and centralized team resolution.
- Schedule-bound score and odds attachment.
- Durable-first publication, complete-before-commit refreshes, and retention of prior-good provider data.
- Transactional writer controls and concurrency protection for major mutations.
- Provider-free public cache reads with separate administrative refresh authority.
- Shared standings selectors, guarded server actions, and structured scheduler receipts.

The most consequential findings are:

- **Production game statistics are outdated:** five stored records differ from newer CFBD observations,
  including three FBS games already considered "satisfied."
- **Historical identity contamination exists:** eleven Missouri S&T games are archived as Missouri State
  in 2025.
- Provider deadlines end before JSON response bodies finish downloading.
- Database statement and lock waits are unbounded by the application role's settings.
- Planner settings-read failures are reported as intentional quiet holds.
- Failed standings invalidation can leave tag-only cached results stale indefinitely.
- Targeted schedule repairs can remain invisible to whole-season consumers, although no current
  production child-cache divergence was found.
- CFP first-round identity and archive-completeness enforcement remain seasonal readiness gaps.

**No P0 finding was established.** Most findings are P2: concrete defects or bounded risks requiring
correction. Immediate scheduling priority does not automatically make a finding P1.

All **454 comparable final scores agreed** with fresh CFBD observations. This audit establishes outdated
statistics, not incorrect win/loss results in the compared population.

## Verification scope

The original audit ran 87 passing tests across four focused suites covering CFBD schedule normalization,
score attachment, game-stat evidence, and upstream redaction.

The follow-up additionally performed:

- Production hostname-to-deployment resolution through Vercel.
- Comparison of deployed and audited application code.
- Production cache and archive inspection through the `audit_ro` replica.
- Application-role timeout inspection in a session explicitly forced read-only.
- Read-only inspection of all ten QStash schedules.
- Inspection of durable planner records, scheduler receipts, and provider settings.
- Two fresh CFBD requests for 2026 regular-season Week 1: `/games` and `/games/teams`.
- Guarded archive-integrity diagnostics for all six TSC archives.
- Canonical schedule and standings rebuilds against production data.
- Full supported test runner, lint, typecheck, and production build.
- An independent reproduction of the response-body timeout defect.

Not completed:

- An authenticated comparison against deployed cached standings.
- Verification of the effective database endpoint inside the preview deployment.
- PostgreSQL mutation, contention, or concurrency integration testing.
- Authenticated browser-flow verification.
- Historical provider reconciliation across every archived season.
- Independent verification of Vercel, Neon, QStash, or provider invoices.

The starting local checkout was clean at `eb6adbb4d3952f9e9ed9aa71230ada97fe57b45a`. Another session
committed documentation while verification ran. Application code and relevant configuration remained
identical, but the gates do **not** constitute an immutable-commit release certification or
certification of subsequent documentation changes.

## Plan alignment

| Plan or campaign | Consolidated status | Disposition |
|---|---|---|
| Schedule-first architecture and PLATFORM-075/085 | Substantially complete | Preserve the architecture. Targeted child-cache convergence remains a follow-up. |
| PLATFORM-086 provider automation/control plane | Complete within shipped scope | Keep the campaign closed; track recovery and observability gaps separately. |
| Game-stats writer fence | Complete | Preserve the current fenced merge authority. The older permanent revision/lineage proposal is superseded. |
| Standings Ownership | Foundation complete; hardening incomplete | Address invalidation recovery and archive completeness. |
| League Privacy Password | Complete for password-gated access | This is league privacy, not commissioner/member authorization. |
| Multi-tenant account scoping | Not implemented as an enforced permission model | Complete authorization and concurrency prerequisites before expansion. |
| Season Launch Hardening | Complete; some original framing superseded | Preserve shipped guards. Diagnostic bypass authorization remains open. |
| History Records Phase 2 | Complete | Preserve as a retrospective; Phase 3 remains separate. |
| Active CPU / Items 99 and 102 | Implemented | Retire stale instructions describing planner stages as future work. Savings projections remain unverified as bills. |
| Schedule-refresh forensics / Item 126 | Partially complete | 126B shipped; universal invocation correlation under 126A remains open. |
| Partition-scoped health / Item 132 | Not implemented | Remains warranted by scope mismatch. Reverted Item 88 approaches are superseded. |
| Item 87 scoreboard and follow-ups | Partially complete | Use the current campaign index and resolutions rather than the original mockup alone. |
| Featured intent / Item 113 | Not implemented | State-independent, insight-selected Featured remains planned. Existing competing specifications are already tracked. |
| Section ordering / Overview expansion | Partially complete | Preserve completed ordering work; remaining caps/disclosure work belongs to Item 115. |
| Team colour / highlight | Partially complete | Item 119's accent restoration is distinct from owner highlighting and outcome tinting. |
| Matchups/Schedule presentation | Partially complete | Preview work was not credited as implemented on audited main. |
| Postseason grouping/refinements | Partially complete | CFP identity correction is a separate prerequisite. |
| Identity Items 83/85; recovery Item 110; archive Item 68 | Open | Production evidence strengthens their importance. Item 140 remains score-observation measurement. |
| Slow draft, commissioner signup, ranking/pairing/luck features | Not started or parked | Reasonable deferrals pending their prerequisites. |

## Architecture and correctness findings

### A1 — P2: Targeted schedule repair does not converge on the dominant canonical snapshot

**Confirmed code defect; no current production divergence found.**

`loadCachedScheduleItems` in `src/lib/server/canonicalScheduleCache.ts` returns a populated
`year-all-all` immediately. Otherwise, it reads whole regular/postseason partitions. It does not
reconcile week partitions.

The schedule API supports targeted writes to child keys. Consequently:

- A corrected week can remain invisible to whole-season readers.
- A newer season-type repair can be hidden beneath an older aggregate.
- Standings, Insights, and other canonical consumers can continue using the old schedule.

A local probe reproduced the precedence problem with a corrected kickoff.

The production inventory contained exactly seven schedule keys: whole-year aggregates for 2018 and
2021–2026. **No week or season-type child entries existed**, so this snapshot contained no persisted
child repair for the defect to hide.

**Remediation:** define an authoritative convergence contract for targeted repairs while preserving
completeness, observation ordering, concurrency protection, and dependent-view invalidation.

### A2 — P2: Transactional draft writes lack a mandatory client expectation

**Confirmed concurrency gap.**

The pick route derives the current owner inside its transaction, but the client sends only `{ team }`. An
optional owner check does not establish a mandatory expected pick index or revision.

The transaction prevents lost updates. It does not prevent two administrators acting on the same
displayed turn from successfully assigning different teams to consecutive owners.

**Remediation:** require an expected draft position or revision and validate it inside the existing
transaction. Complete before expanding multi-user drafting. No replacement of the draft store is
warranted.

Related: Items 13/15/65.

### A3 — P3: Relationship integrity primarily depends on application contracts

**Maintainability risk, not a demonstrated production defect.**

`appStateStore.ts` persists JSON documents under an `app_state(scope, key)` primary key. Many provider,
ownership, archive, and league relationships are enforced through application validators and
transactional authorities rather than foreign keys.

This is coherent with the operating model. The risk is introducing a writer that bypasses those
authorities.

**Remediation:** retain the store, clarify writer ownership, and protect mutation-boundary invariants. A
relational rewrite is not justified.

### C1 — P2: Lossy team normalization conflates distinct schools

**Confirmed resolver defect and historical data contamination.**

A resolver probe using the actual catalog maps **Missouri S&T to Missouri State**.

Provider classification prevents the particular Division II row from becoming an eligible current
schedule game through the newer eligibility path. That protection does not repair historical data or
make the identity resolution correct.

Production inspection confirmed **eleven 2025 archived games** whose provider IDs identify Missouri S&T
games but whose archived canonical school is Missouri State.

Existing project records document the affected 2025 Missouri State roster status as `NoClaim`; the
investigation did not independently recompute every historical ownership consequence.

**Remediation:** prevent silent identity collisions while preserving authoritative provider identity,
then preview and apply historical repair with before/after evidence.

Related: Items 83/85.

### C2 — P2: CFP first-round games share an event identity

**Confirmed identity defect with a seasonal activation risk.**

The 2024 and 2025 durable schedule caches each contain four distinct first-round provider game IDs
sharing:

```text
eventKey: cfp-first-round
```

The current builder uses that event identity for application keys, placeholder addressing, and override
addressing. This creates duplicate UI identity and ambiguous overrides.

The investigation did **not** establish that provider-ID score attachment merges those games. Existing
archived game keys had no duplicates in the archive check.

**Remediation:** separate round identity from individual game/slot identity while preserving
placeholder-to-known-team continuity. Complete before CFP first-round ingestion.

Related: Item 121.

### C3 — P2: "Satisfied" polling coverage does not establish eventual statistical correctness

**Confirmed production impact.**

Game-stat polling excludes satisfied evidence and limits eligibility to approximately kickoff +3–24
hours. Evidence satisfaction establishes usability, not an immutable final provider revision.

The fresh comparison covered 2026 regular-season Week 1:

- `/games` returned 456 rows, including 454 usable finals comparable with cached finals.
- **All 454 comparable final scores agreed.**
- All **99 completed FBS-involving games** in the durable schedule had cached numeric finals.
- All **99 expected game-stat games** were classified as satisfied by the shared evidence authority.
- `/games/teams` returned 203 comparable normalized records.
- **Five differed**, including three FBS-involving games.

| Provider game ID | Game | Examples of cached → newer CFBD values |
|---|---|---|
| `401868170` | Charleston Southern at Georgia Southern | Georgia Southern total yards **424 → 513**, passing yards **281 → 351**, rushing yards **143 → 162**; Charleston Southern total yards **35 → 117** |
| `401858212` | SMU at Florida State | Florida State total yards **329 → 324**, rushing yards **206 → 199**, passing yards **123 → 125** |
| `401856661` | Louisville at Ole Miss | Ole Miss total yards **478 → 488**, rushing yards **142 → 152**, rushing attempts **42 → 41** |
| `401868967` | Texas Southern at Prairie View A&M | Prairie View A&M total yards **397 → 398**, rushing yards **159 → 160** |
| `401867939` | South Carolina State at Florida A&M | Florida A&M possession seconds **1718 → 1787** |

The three FBS records were already satisfied and outside ordinary polling eligibility at measurement
time. Their stored observation fence was `2026-09-08T04:45:06.949Z`.

The comparison covered normalized fields, not raw-stat dictionaries. A difference establishes that the
cache disagrees with the newer authoritative observation; it is not independent play-by-play
adjudication.

The separate final-score sweep repairs missing usable finals but reports differences against existing
finals without replacing them. No final-score difference was observed in this comparison.

> **RECOVERY RAN — 2026-09-09.** Item 110A
> (`PLATFORM-110A-GAME-STAT-RECOVERY-CLAUDE-v1`) re-observed the five named provider IDs through a
> bounded path over the existing ingestion authority. A capture at `2026-09-09T05:43:43.425Z`
> confirmed **all five still differed**; the owner applied it at `2026-09-09T05:57:02.928Z` —
> `written-clean`, five rows updated, 202 retained untouched, new fence
> `2026-09-09T05:43:43.425Z`.
>
> **Three corrections to the measurements above, established while building the recovery:**
>
> 1. **These records were not left stale since kickoff.** `provider-refresh-status` shows a
>    successful game-stats commit of **203 rows** at `2026-09-08T04:45:12.739Z` — the stored values
>    this section compared were written by an app refresh that same day, and CFBD revised the five
>    again afterwards. That is a different finding from the one recorded above, and it strengthens
>    110B's case rather than weakening it: the partition WAS visited, and satisfaction still left it
>    wrong.
> 2. **"Outside ordinary polling eligibility at measurement time" does not hold for `401858212`.**
>    SMU at Florida State kicked off `2026-09-07T23:30Z`; its stored fence was kickoff **+5h15m**,
>    inside the `[3h, 24h)` window. Its window closed `2026-09-08T23:30Z`. Relatedly, `401868170`
>    was **20h past its own window** when that same run wrote its row — the cron fetches and merges
>    a whole PARTITION once any single game in it is eligible, so per-game eligibility never gated
>    the write.
> 3. **The partition holds 207 games, not the 203 compared.** Four rows carry older fences and were
>    absent from the 09-08 response — `401868288`, `401891332`, `401913104`
>    (`2026-08-30T06:00:14.291Z`) and `401868284` (`2026-09-06T12:45:00.807Z`). Prior-good retention
>    working as specified; recorded so the before/after row counts are not misread as a discrepancy.
>
> **The recovery is partial, and permanently so on this path (Item 193).** `mergeRawEvidence`
> replaces an existing raw category only when `parseCategoryValue(...).status === 'valid'`, and
> `tackles`, `sacks`, `qbHurries`, `tacklesForLoss`, `passesDeflected`, `totalFumbles`,
> `yardsPerPass`, `yardsPerRushAttempt` and `completionAttempts` are all `unknown-category`. So the
> five rows now carry corrected modelled statistics beside stale raw-only ones — `401858212` holds
> `totalYards: 324` next to `tackles: "0"` and `completionAttempts: "12-23"`. Replaying the capture
> cannot fix it: the fence now matches and the merge returns `unchanged`.
>
> **`provider-refresh-status` for this partition is false as of this note (Item 194)** — it still
> reports the 2026-09-08 cron's 203-row success, because the applied script recorded no scoped
> status. It stays wrong until a cron success overwrites it.

**Remediation:**

1. Recover the measured statistics through the existing authorized writer.
2. Separately introduce bounded correction reconciliation that revisits satisfied partitions.
3. Preserve canonical identity, writer fencing, prior-good retention, quota controls, and truthful
   outcomes.
4. Record changed games and failures, and support missed-run recovery.

Extending the initial polling window alone is insufficient. A later identical observation may
legitimately advance its durable observation fence; repeatability should not be defined as zero database
writes.

Related: Item 110. Item 131 concerns collection/cadence optimization. Item 140 measures when **scores**
first read final and cannot by itself measure when statistics stop changing.

### C4 — P2: Rollover can freeze incomplete results

**Confirmed enforcement gap; current owned-game coverage checks were reassuring.**

`buildSeasonArchive` builds final history and drops live `pending`/`played` fields. Snapshot validation
does not establish complete season result coverage.

The championship-final and elapsed-time gates are lifecycle conditions, not equivalent coverage
guarantees. Archive-before-status mutation is correct, but it can archive an incomplete interpretation.

Six TSC archives were checked against current canonical builds using archived rosters:

| Season | Archived games | Owned canonical games checked | Missing owned provider IDs | Owned games without numeric scores |
|---|---:|---:|---:|---|
| 2018 | 885 | 884 | 0 | 0 |
| 2021 | 918 | 809 | 0 | 0 |
| 2022 | 933 | 843 | 0 | 0 |
| 2023 | 921 | 909 | 0 | 0 |
| 2024 | 931 | 915 | 0 | 1: documented Liberty–App State cancellation |
| 2025 | 945 | 918 | 0 | 0 |

The guarded integrity endpoint reported no score differences against its matched stored game-stat
evidence. This was not a fresh historical-provider comparison.

Additional qualifications:

- Ownership checks excluded `NoClaim` and used current shared identity/ownership helpers, which have
  known identity limitations.
- Unowned archived games are not automatically missing-results defects.
- The 2022 duplicate assignment is **Florida International under Maleski and `NoClaim`**, not two real
  owners.
- The eleven misidentified 2025 Missouri S&T games remain historical contamination.

**Remediation:** require a completeness gate or an explicit incomplete, recoverable archive state before
rollover completion. Treat genuine cancellations as valid exceptions.

Related: Item 68.

### C5 — P2: Self-matchups can count twice in slate aggregates

**Confirmed aggregation gap.**

Owner-slate construction retains both owned participations. Item 135 deduplicated displayed game rows
without completing aggregate reconciliation, so header counts can disagree with unique games displayed.

Both participations may legitimately contribute a win and a loss to standings.

**Remediation:** distinguish unique-game counts from owned-team participation results.

Related: Items 136/138.

## Reliability and operations findings

### R1 — P2: Provider timeout excludes response-body consumption

**Confirmed and independently reproduced.**

`fetchUpstreamResponse` clears its abort timer before returning the response. `fetchUpstreamJson`
subsequently awaits `response.json()` outside that deadline.

The follow-up reproduction completed an approximately 80ms JSON body successfully with a 5ms timeout;
measured elapsed time was 81ms.

Body failures also fall outside the fetch retry boundary and can receive inaccurate parsing
classifications.

**Remediation:** carry the deadline through body consumption, preserve timeout/network classification,
and test delayed and truncated bodies. Prior-good data must survive failure.

### R2 — P2: Unreadable planner settings become an intentional quiet hold

**Confirmed code defect; no settings outage observed during inspection.**

The planner catches a settings-store failure as `null`, counts jobs as held, and records
`no-op / plan-held`. Its test explicitly expects that classification.

Avoiding scheduler mutations under uncertain settings is appropriate. Reporting that uncertainty as an
operator-requested pause is not.

**Remediation:** retain fail-closed mutation behavior while emitting a distinct settings-unavailable
failure. Preserve the previous plan and expose the recovery action.

Current scheduler observations were healthy:

- All ten QStash inspections exited successfully.
- The latest planner run started at `2026-09-08T23:50:00.639Z`.
- It planned September 9, reporting four applied schedules and zero failures, held jobs, or unwritten
  records.
- Both dense jobs were intentionally paused for the empty window.
- Both slow jobs were active at `1 0 * * *`.
- The planner trigger was active at `50 23 * * *`.
- Global pause was false and dataset toggles were enabled.
- Subsequent score/stat deliveries reported no polling target without provider calls.

These observations establish current operation, not future recovery behavior during an outage.

### R3 — P2: Failed invalidation can leave standings stale indefinitely

**Confirmed code defect; current user-visible impact unresolved.**

Schedule refresh paths swallow lookup/invalidation errors, while canonical standings use
`revalidate: false`.

The comment promising natural cache turnover does not match tag-only caching. A subsequent unchanged
provider refresh need not retry a missed invalidation.

Fresh canonical rebuilds succeeded for TSC and Pruitt, producing 15 and eight owner rows. However,
deployed page requests returned the league-password gate, so no valid cached-versus-fresh comparison was
completed.

**Remediation:** report post-commit invalidation failure separately and support replay without another
provider fetch.

### R4 — P2: Database waits are not bounded within the invocation budget

**Confirmed code exposure with live configuration evidence.**

The application pool has a maximum of three connections and no configured connection timeout.
Transactional paths acquire blocking advisory locks without local lock or statement deadlines.

The configured application role reported:

| Setting | Observed value |
|---|---|
| `statement_timeout` | `0` |
| `lock_timeout` | `0` |
| `idle_in_transaction_session_timeout` | `5min` |
| `idle_session_timeout` | `0` |

The audit replica also reported statement and lock timeouts of zero. No role/database overrides were
returned by `pg_db_role_setting`.

Vercel's project default function timeout was 300 seconds with Fluid enabled. The idle-transaction
timeout does not protect an actively running query or lock wait.

**Remediation:** establish connection, lock, and statement bounds that accommodate legitimate operations
while fitting the invocation budget. Verify rollback, client disposal, pool recovery, and distinguishable
failure reporting. Increasing pool size is not a substitute.

Related: Item 20.

## Security and isolation findings

### S1 — P2: Insights diagnostic bypass lacks admin authorization

**Confirmed authorization gap.**

The Insights route checks league access, then accepts `bypassSuppression=1` without requiring
administrative authorization.

An ordinary authorized league reader can activate diagnostic behavior. For a passwordless league, that
includes anonymous callers. This exposes normally withheld editorial output and additional computation;
it is not an established arbitrary-write vulnerability.

**Remediation:** admin-gate the diagnostic option and preserve public correctness guards independently of
diagnostic suppression controls.

Related: Item 47.

### S2 — P2: Effective preview database isolation remains unverified

**Configuration-dependent risk; no cross-environment write observed.**

The app selects `DATABASE_URL` without an environment-to-database identity assertion. Production
correctly refuses file fallback, but this does not prevent a preview deployment from receiving a
production database URL.

Observed:

- The preview alias resolved to a separate READY deployment at
  `7d6c28ca3c2d8d83e7d10b73b53fc5a9bdcbc5ec`.
- The runbook documents Neon child-branch isolation.
- Preview integration completion was recorded.
- The decrypted project-level `DATABASE_URL` template applied to production, preview, and development and
  identified the production endpoint and `neondb_owner`.
- Deployment metadata exposed environment names, not their effective injected values.

The shared template is not proof of cross-environment access because Neon may override it per deployment.
It is also insufficient to prove isolation.

**Next action:** verify the effective preview endpoint, Neon branch, and role. Add enforcement only if
existing configuration controls do not reliably provide isolation.

Positive security findings remain:

- Administrative pages, routes, and server actions have distinct authorization boundaries.
- Reviewed debug routes use administrative authorization.
- Cron routes require `CRON_SECRET`.
- League-password cookies are league-bound and confer no administrative refresh authority.
- Commissioner/member enforcement remains planned rather than silently equated with platform-admin
  permissions.

## Performance, cost, and observability

### P1 — P2: Recap assembly starts before determining useful eligibility

**Confirmed unnecessary work.**

The Insights route invokes weekly recap loading, and recap context assembles season data before
composition determines whether an active recap can be produced. Memoization is request-local, while other
Insights loaders perform their own build.

**Remediation:** add a cheap authoritative eligibility check where feasible, then share suitable immutable
inputs. Measure CPU before broader cache changes.

Related: Item 141.

Other cost conclusions:

- Public schedule, score, and odds reads do not automatically spend provider quota.
- Planner and hot-build optimizations already exist.
- Remaining polling reductions should be assessed against the busiest month.
- Raw all-division schedule retention supports legitimate consumers; it is not inherently an eligibility
  violation.
- Repeated reconstruction and blocked queries are more consequential with a small database pool.
- Own-origin requests remain a measured optimization follow-up, not justification for a broad server-fetch
  rewrite.

Historical production CPU and invocation queries for September 1–8 were rejected with `payment_required`,
requiring Observability Plus.

Available durable quota observations were:

- CFBD: **4,713 of 5,000 remaining**, September 9 at 00:00:17 UTC.
- Odds: **401 of 500 remaining**, September 9 at 01:00:03 UTC.

These preceded the audit's two direct CFBD requests. They are quota observations, not invoices or proof of
realized savings.

### O1 — P2: Health scope and forensic reconstruction remain incomplete

**Confirmed observability gaps.**

Provider health selects year-level canonical scopes while automatic score/stat maintenance often records
partition-level activity. Scheduler execution receipts are latest-only, and invocation IDs are not
consistently carried through structured cron logs.

The issue layer retains additional signals, so System Health is not wholly blind. The planner also retains
separate run history, which should not be confused with universal receipt retention.

**Remediation:**

- Complete partition-scoped health under Item 132.
- Complete invocation correlation under Item 126A.
- Preserve 126B's shipped incident evidence.
- Evaluate bounded historical retention against actual troubleshooting needs.
- Avoid imposing unnecessary per-target schemas on simple jobs.

Controlled job failures returning HTTP 200 are not inherently defective where receipts carry truthful
outcomes and retries are intentionally suppressed. Incorrect or missing outcomes are the problem.

## Release-check results

| Check | Result |
|---|---|
| `npm run lint` | Exit 0 |
| `npx tsc --noEmit` | Exit 0 |
| `npm run build` | Exit 0 |
| `npm test` | Exit 1; exactly the two documented Item 137 failures |

The two failures were:

```text
convergence #10: a canonical success is recorded only after the atomic commit
compatibility #46: an authorized manual refresh returns the compatible 200 shape
```

Both are in:

```text
src/app/api/odds/__tests__/writer-convergence.test.ts
```

No additional failures occurred. No tests were added or changed. This matches the accepted known-failure
baseline; it is not an all-green suite.

High-value missing or insufficient assertions remain:

- Targeted repair visibility through canonical whole-year readers.
- Distinct-school normalization collisions.
- Multiple same-round CFP game identities.
- Slow/truncated response bodies respecting deadlines.
- Settings-unavailable differing from intentional pause.
- Durable publication followed by failed invalidation.
- Upstream corrections after evidence satisfaction.
- Rollover refusing incomplete result coverage.
- Two stale draft clients submitting against one displayed turn.

## Prioritized remediation

### Immediate work

1. **Recover measured stale statistics** through the existing authorized partition writer, retaining
   before/after evidence.
2. **Design and implement recurring correction reconciliation separately**, including satisfied partitions
   and missed-run recovery.
3. **Extend provider deadlines through response bodies.**
4. **Bound database waits** and verify rollback/pool recovery.
5. **Classify planner settings failures truthfully.**
6. **Make failed standings invalidation observable and replayable.**
7. **Admin-gate Insights diagnostic bypass.**

### Immediate validation gates

- Verify effective preview database isolation.
- Compare deployed cached standings with a fresh canonical rebuild using an authorized session.
- Obtain actual cost evidence through available access; do not label projections as realized savings.

These investigations do not themselves authorize configuration or data changes.

### Near-term integrity and readiness

- Resolve team identity collisions, then repair affected history.
- Establish targeted schedule convergence.
- Separate CFP round and game identity before first-round ingestion.
- Enforce archive completeness before rollover.
- Complete partition-scoped health and invocation correlation.
- Require expected-position validation before expanded draft participation.

### Valuable but deferrable

- Correct unique-game slate aggregates.
- Avoid unnecessary recap construction.
- Measure remaining polling reductions.
- Resolve Item 137's known test failures.
- Evaluate bounded forensic retention.
- Continue presentation work with its existing dependencies.

## Documentation and queue disposition

The agreed documentation direction is **audit-first dispatch after work already in progress**, across both
implementation lanes.

Required cleanup:

- Establish one authoritative current execution order.
- Remove instructions to implement already-shipped planner stages.
- Update Item 110 with measured production impact, separating recovery from prevention.
- Preserve Item 140's score-measurement scope and Item 131's collection/cadence scope.
- Add distinct entries for body deadlines, planner failure classification, invalidation recovery, and
  targeted schedule convergence.
- Keep PLATFORM-086 complete within its shipped scope.
- Preserve existing supersession of the old writer-lineage design.
- Use Item 113 and the existing campaign index for Featured's specification conflict.
- Record seasonal gates and unresolved runtime investigations explicitly.
- Store detailed findings once as dated audit evidence; keep current queue entries concise and linked.

**The practical priority is to repair the observed statistical drift, prevent silent operational failures,
and complete identity and postseason safeguards while preserving the existing architecture.**
