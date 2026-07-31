# Prompt Registry

Status: Current ledger
Last verified: 2026-07-30
Owner: Project documentation
Canonical for: prompt ledger / historical implementation record (not an active backlog)
Supersedes: (none)

Purpose:

- track important prompts
- provide reusable references
- document prompt evolution

The registry should remain:

- concise
- high-signal
- manually maintained

`Last verified` for this ledger means the structure, newest entries, ordering, cross-links, and
this file-level guidance were verified — not that every historical implementation claim was
re-proven against the runtime.

## Entry format (required for future entries)

New entries use this compact template (DOCS-012) and ordinarily stay five concise bullets,
linking to the architecture/operations/completed-work documents for extensive detail:

```md
### <PROMPT_ID>

- Purpose:
- Scope:
- Outcome:
- Review / verification:
- Status:
```

Rules:

- `Status` records implementation/merge state only (e.g. `Merged (PR #N, <commit>, <date>)`,
  `Implemented — PR open`, `Superseded/unimplemented`). It must NOT carry a mutable `NEXT`
  pointer — the current queue lives only in `docs/next-tasks.md`.
- Keep most-recent-first ordering.
- **Older entry formats are grandfathered.** Do not rewrite historical entries to the new
  template; their status text is point-in-time evidence.

---

## Prompt ledger (most recent first)

This is a historical record of executed prompts — a ledger, not a backlog. Active/queued work lives in `docs/next-tasks.md`; entries here describe work that has shipped, or that is implemented and in final pre-merge review when the entry explicitly says so.

### PLATFORM-086F2C-MAINTENANCE-ACTION-MODEL-v1

- Purpose: Establish the Data Maintenance & Recovery page foundation — truthful per-action
  cost/scope/effect disclosure for every existing maintenance action, lifecycle rollover removed
  from the maintenance surface, and closure of the historical-score repair's missing
  provider-status record (the binding F2A round-3 decision).
- Scope: New presentation-only contract `src/lib/admin/maintenanceActions.ts` +
  `MaintenanceActionDetails` disclosure, wired into all five maintenance panels;
  `/admin/data/cache` renamed/reorganized (URL stable) + `/admin` landing card;
  `SeasonRolloverPanel` relocated to `/admin/season` (its owner); `POST
  /api/admin/cache-historical-scores` instrumented with scoped provider-refresh status (+ shared
  empty/drift classification); new pure `src/lib/scores/historicalScoreWrites.ts`. No new
  endpoints, no Diagnostics relocation (F2D), no scheduler receipts, no rollover behavior change.
- Outcome: Eight allowlisted descriptors (routine/recovery/emergency — only the full game-stats
  backfill is emergency, identified at rest) render as compact keyboard-accessible `<details>`
  disclosures adjacent to every action, with request construction pinned unchanged. The repair
  route records ONE truthful year-rollup attempt whenever provider work is required
  (begin-before-credential; `cfbd-api-key-missing` / `cfbd-fetch-failed` incl. schema-drift and
  id-less-row parity with `/api/scores` / `cfbd-empty-unexpected` via the shared classifier over
  prior-good rows + composed schedule evidence / `durable-write-failed` with partial-write truth /
  valid-absence no-op with NO empty commit / success only after the attempted commits with
  `committedAt`+`commitSeq`+rows); auth/validation/active-year/cached exits fabricate no attempt;
  the panel distinguishes a no-op from a cache write.
- Review / verification: Claude subagent self-review (1 P2 — the removal orphaned
  `SeasonRolloverPanel`; relocated to Season Management — plus 4 P3s recorded). Codex round 1
  (1 P2 — empty partitions could record success; fixed via the shared empty-scores classifier).
  Round 2 (4 P2 — three fixed: schema-drift parity, composed schedule evidence via
  `loadCachedScheduleItems`, throw-free independent evidence reads; one rejected as spec-pinned —
  the active-year-guard extension is a named follow-up (`computeProtectedActiveYears`) in
  `docs/architecture/admin-control-plane.md`). Round 3 (1 P2 — no-op rendered as "Cached 0
  scores"; fixed with user authorization at the post-round-3 gate). 37 new focused tests; full
  suite 2883 green; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check`
  clean. Browser smoke check unavailable (Chrome extension not installed) — deterministic render
  tests are the acceptance authority. No provider, scheduler, production, or rollover operation
  performed.
- Status: Implemented — PR open (PR #432).

### PLATFORM-086F2B-LIFECYCLE-AUTHORITY-SAFETY-v1

- Purpose: Eliminate the three lifecycle correctness risks identified by PLATFORM-086F2A —
  unsafe manual rollover, competing league-year authorities, and durable lifecycle writes during
  Server Component rendering — as the correctness prerequisite for the remaining admin
  control-plane slices (F2C–F2J).
- Scope: Code + focused tests + binding docs. `src/lib/leagueRegistry.ts` (serialized
  single-authority lifecycle mutations via the registry-key transaction; guarded
  `completeSeasonRollover`); new `src/lib/rolloverTargeting.ts` (shared per-year targeting) and
  `src/lib/manualRollover.ts` (shared client contract); rewritten `/api/admin/rollover`;
  `/api/cron/season-rollover` converged on the shared helpers (behavior preserved); narrowed
  `PATCH /api/admin/leagues/[slug]` + status-seeding creation; `/admin/leagues` and
  `/admin/[slug]` pages; both rollover panels; lifecycle callers (`[slug]/actions.ts`,
  season-transition cron); dead `isSeasonComplete` deleted. New `AGENTS.md` → **Lifecycle
  Authority Invariants** (binding); `docs/architecture/admin-control-plane.md` F2B findings
  flipped to resolved.
- Outcome: `updateLeagueStatus` is the ONE lifecycle mutation authority — season/preseason
  synchronize `league.year = status.year` in one serialized transactional write; offseason writes
  the outgoing `status.year` (healing desynchronized legacy projections); generic
  `updateLeague`/PATCH reject lifecycle fields (`409 league-year-lifecycle-managed`); new leagues
  are born with an explicit status; admin rendering performs no durable write; `beginPreseason` is
  offseason-guarded. Manual rollover is per-year behind the SAME strict gate as the cron
  (`resolveNationalChampionshipRollover` re-evaluated on every POST; `groupRolloverTargets`
  targeting by `status.year` only; group-atomic archive-first manual execution vs preserved
  per-league cron isolation; guarded conditional transitions in both paths; truthful partial
  failures; no force/emergency bypass; eligibility cache-only). Both panels consume one shared
  per-year client contract with persistent result banners.
- Review / verification: Claude subagent self-review (1 P2 — unguarded `beginPreseason`
  double-increment — + 5 P3; the P2 and 4 P3s fixed, 1 P3 test-strength note deferred as a
  non-blocker: no clean seam pins "exactly one registry write" in a test). Codex round 1 (4 P1 +
  2 P2): registry serialization, offseason year-heal, guarded stale-transition protection,
  invariant-wording correction, and the panel's misleading global rollover date all fixed; the
  legacy missing-status repair path dispositioned as spec-deferred (owned by F2H lifecycle
  recovery). Codex round 2: clean. 53 new focused tests; full suite 2846 green; `npx tsc
  --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` clean. No provider, QStash,
  Vercel, or production rollover operation performed.
- Status: Merged (PR #431, `5658413`, 2026-07-30).

### PLATFORM-086F2A-ADMIN-CONTROL-PLANE-IA-v1

- Purpose: Establish the audited admin control-plane inventory and target information architecture
  as canonical documentation before any PLATFORM-086F2 code slice — routes, action
  costs/mutations, correctness findings, locked decisions, the scheduler-receipt contract, and the
  F2A–F2J migration map.
- Scope: Documentation-only. New `docs/architecture/admin-control-plane.md` (canonical); queue and
  roadmap projections (`docs/next-tasks.md` Active priority 1, `docs/roadmap.md` 086 table);
  doc-index rows (`docs/README.md`, `docs/architecture/overview.md`); this entry. No runtime files.
- Outcome: The audit (read-only, `main` @ `7d5741a`, 2026-07-30) is recorded with independent
  source verification, including corrections: the rollover cron path is
  `/api/cron/season-rollover`; the `/admin/leagues` legacy-token copy references a panel that IS
  present (the real defect is a label mismatch plus legacy-fallback wording); five co-located
  `route.test.ts` convention violations exist (the team-database one also behaviorally drifted).
  The three high-priority correctness findings (manual rollover bypassing
  `resolveNationalChampionshipRollover` and assuming one global `league.year`; the
  `league.year`-vs-`status.year` dual authority; render-time `updateLeagueStatus` seeding on
  `/admin/[slug]`) are confirmed with code evidence and assigned to F2B. The
  `scheduler-execution-status/<job>` scope is verified unused and reserved for F2E1/F2E2.
- Review / verification: `npm run lint:markdown` clean; relative links validated; the route/action
  matrix was checked against `src/app/admin/**`, `src/app/api/admin/**`, and the seven cron routes
  by an independent read-only verification pass before writing. Claude self-review: 3 P3s, fixed.
  Codex round 1 (1 P1 + 4 P2 + 1 P3: receipt auth gating, monotonic receipt ordering,
  `bypassCache=1` correction, diagnostic-cost truth, historical-scores status gap, follow-up
  label): all fixed. Round 2 (2 P2: per-week score-fallback cost, lifecycle execution-log gap):
  both fixed. Round 3 (1 P2: the status-silent branch conflicted with the binding provider-status
  invariant): fixed with user authorization — mandatory status recording assigned to F2C.
- Status: Merged (PR #430, `4d6b897`, 2026-07-30).

### DOCS-012-CURRENT-LEDGER-DECONFLICTION-v2

- Purpose: Reconcile the current planning and historical ledgers so each document has one clear
  responsibility — current work findable without reading shipped history, completed detail not
  repeated across planning docs, and consistent formats for future ledger entries. v2 (amended
  pre-implementation, superseding the unregistered v1 draft scope) adds the binding governance
  mechanism to `AGENTS.md`.
- Scope: Documentation-only, six files — `AGENTS.md` (new binding "Ledger ownership during
  closeout" subsection under Documentation closeout timing) plus `docs/README.md` (ownership
  contract summary, status vocabulary, `Last verified` policy), `docs/next-tasks.md` (compact
  execution order; completed narratives replaced with links; canonical deferrals preserved;
  server-fetch backlog corrected to the verified audit findings), `docs/roadmap.md` (PLATFORM-086
  arc collapsed to a status table), `docs/prompt-registry.md` (this template + grandfather note),
  `docs/completed-work.md` (point-in-time warning; H3 planning preamble replaced with a historical
  annotation; new milestone template).
- Outcome: One canonical execution queue and deferrals list (`next-tasks.md`); roadmap describes
  direction, not PR internals; historical ledgers keep their evidence without masquerading as
  current planning; future closeouts write per-ledger projections instead of copying full final
  reports (binding in `AGENTS.md`).
- Review / verification: `npm run lint:markdown` + `git diff --check` clean; prompt-ID uniqueness,
  link resolution, and single-`NEXT` checks pass. Independent review round 1: 2 P1 (the §8c/parity-
  rerun evidence deleted from next-tasks with dangling registry pointers — rehomed into the registry
  entries; the `AGENTS.md` canonical-deferrals pointer naming the deleted heading — updated) + 2 P2
  (the PRE-LAUNCH-TIDYUP record — restored as a completed-work milestone; the frozen
  `PLATFORM-086H-GAME-STATS-RECOVERY-v1` prompt ID — named in its registry entry) remediated;
  6 P3s dispositioned (see the entry's PR). Confirming round: all six remediations verified; 1
  residual P2 (a second dangling next-tasks pointer phrasing) + 1 P3 (this verdict recorded
  prematurely) — both fixed in the final commit and mechanically re-verified.
- Status: Merged (PR #429, `ea4fa60`, 2026-07-30).

### PLATFORM-086E2B-RANKINGS-PUBLICATION-AUTOMATION-v1

- Purpose: Activate the merged PLATFORM-086E2A rankings authority through a publication-aware cron route, durable per-window duplicate suppression, a fixed external QStash heartbeat contract, operator settings consumption, secret-safe runtime logging, and a documented (NOT executed) staged rollout. Reuses E2A unchanged as the only rankings writer; no QStash provisioning, CFBD contact, `vercel.json` change, public/manual-rankings change, or UI work.
- Scope: New `GET /api/cron/rankings` (`src/app/api/cron/rankings/route.ts`) — order: start instant + pessimistic tracker → `CRON_SECRET` (401s) → `isAutoRefreshAllowed('rankings')` (all rankings automation noncritical; Off/pause → whole-run skip; settings failure fails closed) → registry-selected `preseason`/`season` years ascending (`season` owns a mixed year; never calendar/`league.year`) → per-year sequential: cache-only context (`src/lib/rankings/automaticContext.ts` — earliest valid canonical kickoff + structured championship via the E1A `resolveStructuredChampionshipItem`; absent schedule = known absence/null kickoffs; element-level corruption, malformed records, and store read failures = `canonical-context-unavailable`; poll coverage counts only well-formed poll ARRAYS on weeks labeled with the target season) → the merged E2A publication classifier at the single route-entry instant → durable exact-window claim (`src/lib/rankings/publicationWindowControl.ts`, scope `rankings-publication-window`, key `<year>:<kind>:<YYYY-MM-DD>`: version-1 records; COMPLETED windows immutable and provider-free forever; 5-minute `crypto.randomUUID` token-safe claims, reclaimable when missing/malformed/expired; token-checked finalize/release; claim store failure fails closed pre-quota; unconfirmed completion reported, never blindly retried) → fresh `fetchCfbdUsage({fresh:true})` per due year through `evaluateRankingsAutomationQuota` (≥1,007; thrown probe = `quota-usage-unavailable`; refusals release the claim, never invoke E2A) → `refreshSeasonRankings({trigger:'automatic'})` (no `now`) → success/no-op finalizes the window; contention/failure releases it with the exact E2A reason; unconfirmed completion = `partial/publication-completion-unconfirmed`. One secret-safe single-line `rankings-cron` event per invocation from one `finally` (`src/lib/rankings/cronExecutionLog.ts` — allowlisted fields only; aggregation: skips excluded, any partial → partial, failure+non-failure → partial, only failures → failure, any success → success, only no-ops → no-op, only contention → in-progress; uniform reason or `year-results`). `scripts/manage-rankings-schedule.ts` binds the FIXED contract (`turfwar-rankings-publication`, `https://turfwar.games/api/cron/rankings`, `0 4,22 * * *`, GET, retries 0, forwarded+provider-redacted Authorization, §8j) into the shared QStash CLI (inspect-first, `--apply`-gated, no delete); `manage:rankings-schedule` package script; sibling CLI rotation comments generalized four → five schedules. Rankings descriptor flipped `hasActiveAutomation`/`autoRefreshSettingConsumed` true (`lifecycleCritical` false, 8-day staleness unchanged) — the provider-status toggle is interactive; conferences is the only remaining planned dataset. Test-only `__resetUpstreamPacingForTests` added to `src/lib/api/fetchUpstream.ts` (mocked-Date suites would otherwise inherit a cross-test future pacing deadline — production-inert).
- Result: no provider work outside a due, newly claimed publication window; a completed publication key never spends quota again (at-least-once QStash delivery safe end-to-end: immutable completed windows + token-safe claims + E2A's per-year lease and observation ordering); E2A remains the only rankings writer and its typed result the outcome truth; manual/public rankings behavior untouched; `vercel.json` untouched (source-pinned); merging alone activates nothing — the §8j operator sequence (provision → gates-closed auth proof → toggle On → open-gate policy proof) is the remaining activation checkpoint.
- Review: converged in cycle 1 + a clean confirming round (`/code-review`/`/codex:review` are user-invocation-only in the active environment — independent Claude subagent + Codex rescue-runtime substituted). Independent Claude: no P0–P2; 4 P3s — 2 fixed (per-year event truth preserved on a defensive mid-loop double-fault via early `exec.years` aliasing; the multi-year test now pins the exact probe→spend interleaving `['info','2031','2031','info','2032','2032']`), 2 dispositioned (minute-exact heartbeat slot vs delayed delivery — spec-mandated, documented as a §8j/diagnostics operational note; completed-window record accumulation ~50–60/season-year — accepted housekeeping, noted in storage docs). Codex round 1: no P0/P1; 2 P2s fixed (element-level schedule corruption was accepted as usable context — items must now each be plain objects or the year is `canonical-context-unavailable`; poll coverage counted foreign-season weeks and malformed poll values (string `.length`), which could suppress a discovery window — coverage now counts only well-formed matching-season arrays, with the deliberate self-healing disposition that uncounted corruption leaves the year refreshable rather than wedged). Codex round 2 against the complete remediated diff: **CLEAN — no credible P0/P1/P2**; all four remediations verified. Cycle 3 never triggered.
- Verification: focused E2B suites — cron route 28, automatic context 15, window control 11, QStash CLI 16 — plus the full E2A/descriptor set: 210 focused green; full `npm test` **2791/2791**; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All provider fetches stubbed/injected — no CFBD, QStash, Vercel, or production contact; no quota spent; BotID stash preserved.
- Status: **✅ complete, MERGED to `main` via PR #428 (merge commit `1c34352`, 2026-07-30); §8j EXECUTED 2026-07-30 — PRODUCTION-ACTIVE** (`turfwar-rankings-publication` provisioned/active/unpaused with the exact redacted-auth contract; gates-closed proof msg `msg_7YoJxFpwkEy4DbXxFQZ91MK8xiB1wPdpTVwXqzbabbkFQqCevikHu` HTTP 200 `skipped/automation-paused-or-disabled`; open-gate proof HTTP 200 `skipped/not-a-heartbeat-slot` with `quotaChecked/providerCallAttempted` false; Rankings On, global pause Off, CFBD quota unchanged — full record in `docs/deployment-runbook.md` §8j; a provider-backed publication is ordinary monitoring, not a closeout blocker; the passive E1C2 §8i observation does not block). NEXT: **PLATFORM-086F2** (diagnostics IA redesign) — the remaining provider-campaign implementation item.

### PLATFORM-086E2A-RANKINGS-REFRESH-AUTHORITY-v1

- Purpose: The first bounded slice of PLATFORM-086E2 (rankings automation) — build ONE concurrency-safe, complete-before-commit season-rankings refresh authority shared by the existing authorized manual route and the future E2B automatic caller, and make public rankings reads provably cache-only. Dormant: no cron route, QStash schedule, settings/descriptor activation, UI change, or production operation.
- Scope: New `src/lib/rankings/{refreshAuthority,refreshLease,refreshResult,publicationPolicy,quotaPolicy}.ts` + four focused suites; `src/lib/server/rankings.ts` reworked into a strictly cache-only reader (normalization/classification helpers retained and exported for the authority); `src/app/api/rankings/route.ts` reduced to a thin adapter (public → `loadSeasonRankings`; authorized `bypassCache` → `refreshSeasonRankings({trigger:'manual'})`, intentional `409 {"error":"rankings-refresh-in-progress"}` on contention); `src/lib/gameStats/quotaPolicy.ts` `evaluateAutomationQuota` extended with a caller-supplied `minRemaining` (default 1,002 unchanged); the uncollected `src/app/api/rankings/route.test.ts` relocated to `__tests__/` (now in the `npm test` glob) with its two stale one-request assertions corrected to two-partition truth (one refresh = 2 upstream requests). Authority lifecycle: 5-min token-safe durable lease `rankings-refresh-control/<year>` → year-scoped attempt (begun before credential validation) → forced durable prior read (read outage fails closed pre-provider) → `CFBD_API_KEY` → observation instant captured immediately pre-fetch → regular+postseason fetched outside the transaction (pre-E2A retry/pacing verbatim) → independent partition validation (`provider-fetch-failed`/`invalid-provider-payload`/`rankings-partition-schema-drift`; foreign-season weeks never usable — cross-year guard) → observation-ordered `withAppStateKeyTransaction('rankings', <year>)` commit enforcing stale-observation no-ops, empty-replacement rejection, prior-relative completeness (`rankings-partition-incomplete` when previously cached weeks or previously populated `ap`/`coaches`/`cfp` sources would be lost — coverage may only grow), `unchanged-clean` metadata-only freshness vs `written-clean` replacement → memo published ONLY post-commit → status resolved exactly once from the typed result → token-checked release in `finally`. Freshness split: 120 s process-memo visibility bound (forced durable re-read after) vs the 8-day rankings-data horizon (descriptor-sourced; the 6-hour process TTL is retired as a staleness signal). Dormant pure E2B policies: publication-slot classifier (five UTC windows, precedence `final-ap-coaches → cfp-publication → opening-week-exception → weekly-ap-coaches → preseason-discovery`, discovery strictly pre-kickoff, deterministic `<year>:<kind>:<date>` duplicate-suppression keys) and the rankings automation quota gate (trustworthy remaining ≥ 1,007 = 1,000 reserve + 1 `/info` + 3+3 attempts, via the shared trust evaluator — no second algorithm).
- Result: manual refresh available / public reads cache-only / automatic refresh dormant. Same-year concurrent refreshes cannot duplicate provider work under a valid lease; stale observations cannot overwrite newer durable rankings; empty, drifted, incomplete, or cross-year partitions cannot erase prior-good weeks or poll sources; cross-instance writes become visible within the 120 s memo bound; existing consumers (Draft/Insights/admin manual refresh) unchanged aside from the intentional 409.
- Review: converged in 2 cycles + a clean confirming round (`/code-review`/`/codex:review` are user-invocation-only in the active environment — independent Claude subagent + Codex rescue-runtime reviews substituted, reported per the availability rule). Cycle 1 — independent Claude: no P0–P2, 3 P3s (fixed: reader memo-regression race, with a deterministic race test; declined: observedAt-capture pin needing new test-only delay seams; tracked follow-up: the narrow post-remap synthetic-final-poll replacement window inherent to the documented canonical representation); Codex round 1: 1 P2 fixed (cross-year contamination — a structurally valid payload labeled with a different season could pass completeness and commit as this year; foreign-season weeks now unusable, both interleavings test-pinned). External user-forwarded Codex review: 2 P2s fixed (preseason-discovery could keep firing all season while a poll source stayed absent — now strictly pre-kickoff; pre-fetch exits fabricated `attemptedSeasonTypes` — now populated only when the fetch pair begins, mirroring `providerCallAttempted`), 1 P1 dispositioned NOT-TAKEN (a `durable-commit-indeterminate` outcome for lost-acknowledgment commits — conflicts with the prompt's closed reason union and Section 4's mandated `failure/durable-commit-failed`, and matches the merged E1A sibling's semantics; the result-contract doc now states the caveat honestly; uniform cross-authority vocabulary expansion tracked as a follow-up). Codex round 2 against the complete remediated diff: **CLEAN — no credible findings at any severity** (store-backed suites EPERM-blocked in its read-only sandbox — environmental, covered by local runs).
- Verification: focused rankings suites 82/82 (route 12, authority 19, lease 6, publication policy 19, quota policy 5, normalization 8, commit-order 11 incl. the memo-race pin, request-guard 2); full `npm test` **2720/2720**; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All provider fetches stubbed — no CFBD, QStash, Vercel, or production contact; no quota spent; BotID stash preserved.
- Status: **✅ complete, MERGED to `main` via PR #427 (merge commit `a656861`, 2026-07-30); DORMANT** (rankings dataset remains manual/API-only; descriptor untouched; merging activated nothing). NEXT: PLATFORM-086E2B (publication-aware cron, `turfwar-rankings-publication` QStash heartbeat, durable per-window duplicate suppression, descriptor/settings activation, staged rollout).

### PLATFORM-086E1C2-SCHEDULE-PRESENTATION-AUTOMATION-WIRING-v1

- Purpose: Invoke the proven E1C1 schedule-presentation authority automatically after successful canonical weekly and season-transition schedule refreshes — without another scheduler and without letting optional enrichment affect canonical schedule or lifecycle truth. (The authority was production-proven manually before this slice: the 2026-07-30 02:37 UTC seed committed media `written-clean` 456 rows + venues `written-clean` 844 rows, aggregate success, terminal CFBD remaining 4899.)
- Scope: ROUTES + TESTS ONLY — `src/app/api/cron/schedule-refresh/route.ts` and `src/app/api/cron/season-transition/route.ts` plus their suites and the E1C1 route suite. Weekly: after each year's E1A refresh, canonical entry recording, and (preseason-maintenance) probe update, invoke `refreshSchedulePresentation({year, trigger:'weekly'})` ONLY when `refresh.status === 'success' && refresh.items.length > 0` (covers `written-clean` AND `unchanged-clean` — an unchanged canonical schedule still refreshes media because broadcast assignments change independently). Season-transition: a per-year `shouldRefreshPresentation` flag set ONLY by the same qualifying condition and consumed AFTER that year's probe save, preseason→season flips, standings invalidation, and league-year sync (`trigger:'season-transition'`). Both call sites omit `now` (fresh authority clock — route latency never shortens presentation leases or ages observations) and sit behind a narrow defensive catch; neither route records presentation provider status, parses the authority's event, or lets a presentation outcome touch the per-year `ScheduleRefreshCronYearExecution`, aggregate result/reason, HTTP status/body, the `schedule-refresh-cron` event, probe truth, `transitionBlocked`/`partialFailure`/`fatalStoreError`, or lifecycle/settings policy. No invocation for: auth failure, no maintenance target, `season-transition-owner` deferral, canonical-context refusal, closed Schedule/global gate, settings-store failure, E1A failure/no-op (`empty-response`, `stale-observation`)/`in-progress`, or an unpopulated success; `shouldFetch: false` and un-probed transition years never qualify. UNCHANGED: the E1C1 authority/result/reason/cache/lease/status/event contracts, normalizers, cache keys, 30-day venue TTL, 120 s memo, manual seeding, cache-only `/api/schedule` joins, UI, E1A behavior, E1B/E1B1 classification + sticky latch, the automation gates, transition `shouldFetch`/lifecycle timing, standings, rollover, descriptors/settings API, QStash schedule/CLI, `vercel.json`, credentials, retry/pacing/quota policies, historical repair, targeted refresh paths. Automatic bounds per qualifying year: 2 canonical `/games` + 1 `/games/media` + `/venues` only when the durable catalog is ≥30 days old (a later qualifying year in the same invocation observes the fresh commit → `fresh-cache`). Deliberate, test-pinned semantic: presentation follows a lifecycle-critical `postseason-boundary` canonical success even with the operator gates closed (the gates pause ordinary CANONICAL automation; exempt canonical success carries its ≤2 cheap presentation calls).
- Result: presentation data refreshes automatically alongside every qualifying canonical weekly/season-transition success under the existing schedulers — no new cadence, provisioning, toggle, storage, normalization, UI, or public provider path; ownership mirrors canonical ownership (weekly: cache-armed early preseason, active season, postseason boundary; transition: unarmed/final-week preseason); overlapping deliveries stay safe under E1A's canonical lease + E1C1's independent media/venue leases.
- Review: converged in 1 remediation round + a clean independent round. Independent Claude self-review (subagent — `/code-review` is user-invocation-only in the active environment): no P0–P2; 3 P3s — (fixed) event-level invocation-leak assertions added to the non-qualifying subtests (a provider-free leak would otherwise pass the fetch-log-only assertions); (rejected as spec-mandated) the gate-exemption piggyback; (deferred, tracked) cron `maxDuration`/latency-envelope hardening — a pre-existing E1A exposure the wiring roughly doubles in a sustained-brownout worst case, self-healing and speculative. Independent Codex round 1 against the complete remediated diff: **CLEAN — "no credible P0/P1/P2 exists"** (its read-only sandbox could not execute store-backed suites — environmental, covered by local runs).
- Verification: +13 focused tests (weekly invocation/ordering/isolation/multi-year + venue-TTL accounting 7, season-transition lifecycle-first/shared-year/distinct-year/non-qualifying 5, manual-trigger regression pin 1); the existing cron fetch stubs made presentation-aware with a SEPARATE `presentationFetchLog` (canonical `/games` accounting byte-identical, no weakened assertions). Full `npm test` **2658/2658**; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All provider fetches stubbed — no CFBD, QStash, Vercel, or production contact; BotID stash preserved.
- Status: **✅ complete, MERGED to `main` via PR #426 (merge commit `29976c1`, 2026-07-30).** Presentation refresh is now ELIGIBLE on the next qualifying canonical success (both schedulers are already active in production) — the runbook **§8i observation checkpoint remains PENDING** (observation only, no provisioning step; recorded from actual evidence when it occurs). NEXT after the §8i observation: PLATFORM-086E2 (rankings refresh).

### PLATFORM-086E1C1-SCHEDULE-PRESENTATION-CACHE-UI-v1

- Purpose: The first combined E1C slice — cache normalized CFBD game-media and venue metadata, join it cache-only into schedule responses, and display truthful kickoff, broadcast, and venue details on game cards WITHOUT activating automatic enrichment (the canonical schedule stays authoritative for existence/identity/participants/kickoff/lifecycle/postseason/standings/rollover; automatic wiring is E1C2).
- Scope: New `src/lib/schedule/{schedulePresentation,schedulePresentationResult,schedulePresentationLease,schedulePresentationLog,schedulePresentationRefresh,schedulePresentationJoin}.ts` + CFBD URL builders (`/games/media?year=`, `/venues`) + two new `ProviderRefreshScope` kinds (`schedule-media`/`venue-catalog` → keys `schedule:media:<year>`/`schedule:venues`). Normalized allowlisted models (`ScheduleMediaItem` gameId/mediaType/outlet with the closed tv/radio/web/ppv/mobile union, dedup by `(gameId, mediaType, ci-outlet)`, deterministic sort; `VenueCatalogItem` id/name/city/state/countryCode/timezone/capacity/grass/dome — conflicting rows for one venue id reject the payload; media `startTime`/`isStartTimeTBD` never modeled — canonical `/games` stays the only kickoff truth) persisted at `schedule-media/<year>-all` + `venue-catalog/current`. Authority `refreshSchedulePresentation({year, trigger})`: canonical context read cache-only (absent/empty → `no-eligible-games` with NO provider call; read failure or zero usable ids → `canonical-context-unavailable`); independent 5-min token-safe leases; provider attempts begun after the lease and before credential validation; ≤1 request per part (media year-wide WITHOUT a classification filter — filtered afterward against canonical ids, so tracked FBS-vs-FCS games are never lost); 30-day venue TTL via forced durable freshness read + post-lease-acquisition re-check; observation-ordered `withAppStateKeyTransaction` commits with prior-good/empty-replacement/schema-drift protections; durable write → guarded ~120 s memo publish → per-scope status; corrupted (nonempty-all-invalid) stored entries normalize to absence and self-heal; one allowlisted `schedule-presentation-refresh` event per invocation from one `finally`. Route: ONLY the authorized full-year `bypassCache=1` refresh with a populated E1A success seeds (`trigger: 'manual'`, after the probe update, never blocking the canonical response); EVERY successful response path joins cache-only (media by exact `item.id`; venue display fill by exact `venueId`; wire model gains optional `media`; canonical durable records never mutated; presentation faults serve base rows). UI: TBD-aware shared `formatExpandedKickoff` (confirmed format byte-identical; `startTimeTBD` → date + `Time TBD`) adopted by GameWeekPanel/Matchups/Overview (local duplicates retired); `formatPrimaryBroadcastLabel` (tv → web → ppv → mobile → radio; `Streaming · X` / `Radio · X`); GameWeekPanel expanded metadata gains broadcast + enriched venue; collapsed summary/chips/odds/scores/tags unchanged; capacity/surface/dome/timezone cached, not displayed. UNCHANGED: canonical schedule storage/identity, E1A completeness/lease/status/commit/rollover, schedule probe/lifecycle, standings invalidation, QStash schedules/CLIs, `vercel.json`, automation settings/descriptors, weekly/season-transition callers, public provider-free reads. PR-size note: 23 changed files crosses the 15-file stop-and-reassess signal — expected and justified as one cohesive objective (authority + cache-only join + focused presentation + tests), mirroring the E1B precedent; no unrelated cleanup.
- Result: presentation data is manually seedable and automatically dormant; public traffic remains provider-free; game cards truthfully separate confirmed kickoffs from `Time TBD`, show one deterministic preferred outlet, and display catalog-enriched venue lines, all degrading to exact prior output when enrichment is absent.
- Review: converged in 2 cycles + a clean confirming round. Independent Claude self-review (subagent — `/code-review` is user-invocation-only in the active environment, reported per the availability rule): no P0–P2; 3 P3 hardenings remediated (guarded memo fill, row-validated cache entries, canonical id grammar). Independent Codex round 1 (a first attempt died to a Codex-runtime stream disconnect after 1h29m with no findings — reported honestly, not treated as a pass; the fresh scoped round completed): no P0/P1 — 1 P2 (the memo guard compared a pre-`await` snapshot, so a commit racing an in-flight read — including one observing pre-commit absence — could roll the memo back; fixed with a post-await re-read that lets a concurrently published fresher entry win) + 2 P3s (nonempty-all-invalid stored entries previously normalized to a "fresh empty" catalog suppressing repair for up to 30 days — now absence; the venue TTL read→lease TOCTOU could spend a duplicate `/venues` request — closed with a post-acquisition freshness re-check mirroring the Odds cron, pinned by a source-scan test because the interleave is not deterministically constructible), all remediated. Codex round 2 against the complete remediated diff: CLEAN — "No credible P0/P1/P2 findings remain"; all three remediations verified correct and regression-free.
- Verification: +63 focused tests (normalization/identity 14, authority 20, join/memo 9, route presentation 7, wire→AppGame carry 2, card presentation 6, component renders 5 incl. Matchups/Overview TBD pins); full `npm test` **2645/2645**; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All provider fetches stubbed — no CFBD, QStash, Vercel, or production contact; no quota spent; the BotID stash preserved.
- Status: **✅ complete, MERGED to `main` via PR #425 (merge commit `1f27f5c`, 2026-07-30); MANUAL-ONLY — automatic enrichment stays dormant until E1C2.** NEXT: PLATFORM-086E1C2 (automatic enrichment wiring — the authority's `weekly`/`season-transition` triggers); 086E2 rankings follows E1C2.

### PLATFORM-086E1B1-PRESEASON-WEEKLY-COVERAGE-v1

- Purpose: Close the dormant E1B preseason freshness gap before provisioning `turfwar-schedule-weekly`: E1B (merged, unactivated) targeted only `season` leagues, while the daily season-transition cron refreshes preseason schedules ONLY when unarmed or within 7 days of the first game — so a populated preseason schedule with a known first game more than 7 days away received no automatic maintenance. E1B1 lets cache-armed early-preseason years receive ordinary weekly maintenance while deferring discovery and the final-seven-day freshness to season-transition. **E1B activation (§8h) was held for this correction and cannot resume until E1B1 merges.**
- Scope: `src/lib/schedule/weeklyRefreshOperation.ts` — operation union gains `preseason-maintenance`; new PURE `classifyPreseasonWeeklyRefreshOperation({entry, probe, now})` (no reads/writes) mirroring season-transition's exact `shouldFetch` comparison (no probe record / missing-or-invalid `baseCachedAt` / missing-or-invalid `firstGameDate` / `now >= firstGameDate − 7d`, the exact boundary included → stable `season-transition-owner` deferral; the one deliberate conservative divergence: an unparseable `firstGameDate` defers even though transition's NaN comparison would not fetch — no provider work either way); cache-armed early preseason additionally requires the canonical entry to pass THE SAME context checks as the active-season classifier (shared `resolveLatestRegularKickoff` extraction — behavior-identical); an armed early-preseason probe whose canonical entry is missing/empty/malformed is `canonical-context-unavailable` (genuine failures are never converted into deferrals). Route: targets `season` AND `preseason` leagues (offseason excluded); ONE effective owner per year (`season` wins a mixed year — one execution under the active-season policy; E1A never invoked twice per year; ascending sequential); preseason years read the durable schedule probe and NEVER read/write the postseason latch; `preseason-maintenance` is ordinary/noncritical (settings read once when any ordinary-class year exists; closed gate skips BOTH ordinary types; a settings failure blocks both; postseason-boundary stays exempt; `season-transition-owner` consults neither settings nor E1A); no-target reason renamed `no-active-season` → `no-maintenance-target` (contract updated directly — E1B was never activated, so no emitted alias is retained; source-scan-pinned). `cronExecutionLog.ts`: reasons `no-maintenance-target` + `season-transition-owner` (per-year + uniform top-level); deferrals are skips excluded from the partial comparison (a transition-owned year never makes a sibling success partial). UNCHANGED: E1A storage/fetch/lease behavior, lifecycle transitions (E1B never updates league status), active-season/postseason-boundary policy + sticky latch, the QStash CLI/contract (`turfwar-schedule-weekly`, `0 12 * * 2`, retries 0, forwarded+redacted Authorization), `vercel.json`. Season-transition's three `shouldFetch` cases (+ the E1B-owned early-preseason complement) are now test-pinned; the transition ROUTE itself has zero diff.
- Result: the corrected ownership model — preseason unarmed → daily transition owns discovery; preseason first-game > 7d → weekly E1B ordinary maintenance; preseason within 7d → transition owns freshness + lifecycle transition; active season / postseason boundary → existing E1B policy. Runbook §8h updated for the corrected preflight/proof states (early preseason proves via `skipped / automation-paused-or-disabled` with `operation: preseason-maintenance`; the final-week window proves via `skipped / season-transition-owner`; STOP-for-planning only on `postseason-boundary`). QStash remained unprovisioned at merge (activation followed via §8h — see Status).
- Review: converged in 1 remediation cycle + a clean confirming round. Independent Claude review CLEAN (exhaustive property comparison of the preseason classifier against a verbatim replica of the season-transition `shouldFetch` predicate — within the reachable stored-type domain the only divergence is the documented conservative unparseable-`firstGameDate` deferral; statement-by-statement extraction diff vs main; ownership/settings/event/scope checks all confirmed; non-blocking observations only). Independent Codex round 1 — 2 findings: **(P1, ACCEPTED + remediated)** a successful `preseason-maintenance` refresh committing an EARLIER first game left the durable probe stale, so the season-transition handoff stayed idle past the true first kickoff → the route now re-derives the probe's `firstGameDate` from the committed items (preserving `baseCachedAt`, best-effort, mirroring the manual full-year refresh's probe update; +2 regression tests incl. the earlier-kickoff-crosses-handoff scenario); **(P2, REJECTED as contradicting the explicit specification)** the claim that a within-seven-days year with a missing/malformed schedule must be `canonical-context-unavailable` — the prompt's §4 table mandates `skipped / season-transition-owner` unconditionally for the within-seven-days window (the context-failure rule binds the early-preseason branch), the deferral is semantically correct (the daily transition cron fetches and rebuilds the schedule itself there), and the independent Claude review verified the ordering as correct. Codex round 2 against the remediated diff: CLEAN — "No new credible P0/P1/P2 defects; the remediation is correct and regression-free."
- Verification: +32 focused tests (preseason classifier 7, preseason route 15 incl. the probe re-derivation regressions, new `cronExecutionLog` unit suite 7, season-transition `shouldFetch` pins, contract source-scans); full `npm test` **2582/2582**; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All fetches/durable fixtures local/stubbed — no CFBD, QStash, Vercel, or production contact.
- Status: **✅ complete, MERGED to `main` via PR #424 (merge commit `587d5e3`, 2026-07-29); merged DORMANT, then ACTIVATED IN PRODUCTION 2026-07-29 with E1B via the runbook §8h operator sequence** (`turfwar-schedule-weekly` provisioned/active/unpaused; Schedule automation On; global pause Off; current 2026 deliveries defer provider work truthfully — `skipped / season-transition-owner` — while the leagues remain in preseason; checkpoint in `docs/deployment-runbook.md` §8h). **E1C is next; 086E2 rankings follows E1C.**

### PLATFORM-086E1B-WEEKLY-SCHEDULE-AUTOMATION-v2

- Purpose: Activate the merged E1A full-season schedule authority through one weekly, cache-armed QStash trigger with **operation-aware** controls: ordinary maintenance honors operator pause settings, while postseason-boundary maintenance remains lifecycle-critical and exempt. **Supersedes the unimplemented `PLATFORM-086E1B-WEEKLY-SCHEDULE-AUTOMATION-v1`**, which incorrectly selected Vercel Cron — the scheduling boundary is external provider polling → QStash, internal lifecycle reconciliation → Vercel Cron (the daily season-transition/rollover jobs stay in `vercel.json`; the weekly provider refresh does not). v1 was never implemented and is recorded only as superseded.
- Scope: New pure classifier `src/lib/schedule/weeklyRefreshOperation.ts` (per active `season` year, from invocation time + the prior-good canonical `schedule/<year>-all-all` entry ONLY: boundary = latest regular-season kickoff − 7 days; before → `ordinary-maintenance`, at/after → `postseason-boundary`, sticky while in season; missing/empty/malformed context or no valid regular kickoff → `canonical-context-unavailable`, never provider work). Operation-aware settings: `isAutoRefreshAllowed` STRICTLY evaluates globalPause + dataset toggle (descriptor lifecycle bypass REMOVED; lifecycle routes exempt by not calling it — source-scan-pinned); Schedule descriptor flips `autoRefreshSettingConsumed: true` (admin toggle honestly interactive: Off pauses ordinary weekly maintenance only), `lifecycleCritical` retained with operations-based wording; panel/API copy updated. E1A instrumentation: `FullSeasonScheduleRefreshResult.providerCallAttempted` (false pre-provider; true immediately before the regular/postseason fetch pair, retained through transport/payload/completeness/commit failures). New route `GET /api/cron/schedule-refresh`: CRON_SECRET first (401 auth literals); cache-only season-year targeting ascending; classify-all-then-gate (settings read ONCE, only when an ordinary year exists; a settings failure blocks ordinary years with `settings-unavailable`, never critical years); one `refreshFullSeasonSchedule({year})` per allowed year sequentially; outcome map success→success, no-op/`in-progress`→no-op, failure→failure; controlled outcomes HTTP 200; exactly one secret-safe `schedule-refresh-cron` event from one `finally` (`src/lib/schedule/cronExecutionLog.ts`; aggregate: none/all-skipped→skipped, failure+nonfailure among non-skipped→partial, all-failed→failure, ≥1 success no failure→success, else no-op; uniform gated/context/settings reason vs `year-results`). New CLI `scripts/manage-schedule-refresh-schedule.ts` + `npm run manage:schedule-refresh-schedule` bound to the shared `scripts/lib/qstashSchedule.ts` (fixed contract: `turfwar-schedule-weekly` → `https://turfwar.games/api/cron/schedule-refresh`, `0 12 * * 2` UTC, GET, retries 0, `Upstash-Forward-Authorization` + `Upstash-Redact-Fields: header[Authorization]`, read-only default, `--apply`-gated, no delete; shared-manager comment generalized beyond subdaily; `CRON_SECRET` rotation docs now span all FOUR schedules). `vercel.json` UNCHANGED (test-pinned to the two lifecycle jobs). PR-size note: 20 changed files crosses the 15-file stop-and-reassess signal — expected and justified: the prompt's sections each mandate a focused module/route/CLI + tests for one cohesive objective (weekly automation); no unrelated cleanup.
- Result: at merge the weekly route was production-capable but **DORMANT — no QStash schedule existed**; activation is the separate operator-run runbook **§8h** sequence (since EXECUTED — see Status) (preflight → provision gates-closed → exact-authentication scheduled proof (`skipped / automation-paused-or-disabled`, `providerCallAttempted: false`, quota unchanged) → open the Schedule toggle → verify one gated run → docs-only record). Ordinary maintenance honors the pause/toggle; postseason-boundary and the preseason transition remain exempt; unavailable context never triggers provider work; duplicate/overlapping deliveries are safe under E1A's lease + observation ordering.
- Review: converged in 1 remediation cycle + a clean confirming round. Independent Claude review of the full diff **CLEAN** (invariant-by-invariant trace: the settings-bypass removal verified dead code for every pre-existing caller — grep-complete over the four `isAutoRefreshAllowed` call sites; classifier boundary math, route gating/eventing, `providerCallAttempted`, CLI contract, and preserved behavior all confirmed; 3 P3 observations — sibling-parity non-constant-time secret compare, deliberate typed weekly refusal on unparseable kickoffs, conference-championship rows opening the boundary before championship weekend — not actionable). Independent Codex round 1 — 3 findings, all remediated: **(P1)** the postseason-boundary classification could REVERT to ordinary when a refresh moved the latest regular kickoff later → durable per-year boundary latch (`schedule-weekly-control/<year>`) written on first critical classification and fed back into the still-pure classifier (`latched` input; context-unavailability keeps precedence; best-effort read/write degrades to the recomputed classification); **(P2)** a present-but-unrecognized `seasonType` (e.g. `"post-season"`) counted as a boundary-extending regular row → `classifyRowPartition` restricts the gamePhase fallback to an ABSENT seasonType and poisons a malformed value as `canonical-context-unavailable`; **(P2)** a partition failure reported `rowsReceived: 0` despite fulfilled sibling rows → fulfilled-partition rows counted before the completeness gate and reported truthfully. Codex round 2 against the complete remediated diff: **CLEAN — "No new credible P0/P1/P2 defects or regressions found."**
- Verification: +53 focused tests (classifier 11, cron route 23, QStash manager 14, E1A instrumentation + partition-rows 3, settings 2) plus updated admin/settings suites; full `npm test` **2550/2550**; `npx tsc --noEmit`, `npm run lint:all`, `npm run build` (route registered), `git diff --check` all clean. All provider and QStash requests stubbed/injected — no CFBD, QStash, Vercel, or production contact; no schedule provisioned; no quota spent.
- Status: **✅ complete, MERGED to `main` via PR #423 (merge commit `2ddf5c4`, 2026-07-29); merged DORMANT (the merge activated nothing), §8h activation subsequently HELD, then ACTIVATED IN PRODUCTION 2026-07-29.** After merge, the preseason coverage gap was discovered (E1B targeted only `season` leagues while season-transition refreshes preseason schedules only when unarmed or within 7 days — leaving cache-armed early preseason unmaintained); `PLATFORM-086E1B1-PRESEASON-WEEKLY-COVERAGE-v1` (above) is the bounded correction — MERGED (PR #424), after which the **§8h operator sequence was EXECUTED (2026-07-29)**: `turfwar-schedule-weekly` provisioned/active/unpaused, Schedule automation On, global pause Off; current 2026 deliveries defer provider work truthfully (`skipped / season-transition-owner`) while the leagues remain in preseason (checkpoint in `docs/deployment-runbook.md` §8h). **E1C is next; 086E2 rankings follows E1C.**

### PLATFORM-086E1A-SCHEDULE-REFRESH-AUTHORITY-v1

- Purpose: The correctness prerequisite for weekly schedule automation (PLATFORM-086E1B). Converge every production full-season CFBD schedule writer onto ONE completeness-checked, observation-ordered, concurrency-safe authority, and require an authoritative structured championship identity plus a confirmed final before automatic season rollover. Dormant — no weekly automation, scheduler configuration, settings activation, presentation enrichment, weather, or UI.
- Scope: New `src/lib/schedule/{fullSeasonScheduleRefreshResult,scheduleRefreshLease,fullSeasonScheduleRefresh,nationalChampionshipRollover}.ts` + focused suites. The authority `refreshFullSeasonSchedule` owns: fail-fast prior-durable-state read, a durable token-safe per-year lease (`schedule-refresh-control/<year>`, `crypto.randomUUID`, 5-min, no backoff), a year-scoped provider-refresh attempt begun BEFORE credential validation, the regular+postseason fetch reusing the route's URL/retry/pacing/`mapCfbdScheduleGame` normalization with the shared complete-before-commit gate (thrown/non-array/nonempty→zero = uncertainty rejecting the aggregate; exact `[]` = valid absence), an observation-ordered `withAppStateKeyTransaction` commit on `schedule/<year>-all-all` (stale-observation preserve; `unchanged-clean` metadata-only; `written-clean` replace), post-commit ordering (durable → process cache → standings invalidation only on content change → status), and token-checked release. Migrated callers: the authorized full-year `/api/schedule?bypassCache=1` refresh (409 `refresh-in-progress` on contention; targeted season-type/week writers UNCHANGED), the season-transition cron (drives the authority, maps outcomes to the transition gate, 500 only on store outages), and the historical repair (`/api/admin/cache-historical-schedule`: August cutoff removed; rejects the inferred current season year + any preseason/season league year, `force` cannot bypass). Rollover hardening (`/api/cron/season-rollover` + `resolveNationalChampionshipRollover`): structured `cfbd-structured` CFP national championship (numeric provider id + valid kickoff + nested-`playoff` competition/round) + confirmed complete final via centralized `attachScoresToSchedule` + seven-day gate; latest-postseason fallback removed; per-year independent; durable read failure → failure not absence. Metadata: `startTimeTBD`/`venueId`/`completed`/`playoffCompetition`/`playoffRound`/`playoffRoundSource` retained provider → cache → `AppGame`; raw `playoff` object/row never persisted. `findNationalChampionshipGameDate`/`isSeasonComplete` retained for admin presentation/manual rollover only.
- Result: one authority for every full-season writer; concurrent writers cannot duplicate provider work or overwrite newer state (lease + observation ordering); complete-before-commit + empty-response truth preserved; only confirmed durable commits publish cache/status success/invalidation; the active-season historical bypass is closed; rollover requires a structured championship + confirmed canonical final; useful no-extra-call schedule metadata is retained. No scheduler/settings/enrichment/weather/UI added; `/api/cron/schedule-refresh` NOT added; E1A stays dormant.
- Review: converged over 2 remediation cycles under the three-cycle gate. Independent Claude review of the initial diff CLEAN (full invariant-by-invariant trace, no credible P0/P1/P2). **Cycle 1** — independent Codex review, 3 findings all remediated: (P1) a nested structured `playoff` without `game_phase` fell to the text-only branch and never became `cfbd-structured` → shared `derivePlayoffProvenance` used by BOTH postseason branches; (P1) flat `playoff_round` + any competition was mis-tagged `cfbd-structured` → structured provenance now requires round AND competition from the nested object, flat/mixed is `explicit-provider-field`; (P2) `stale-observation` left an older process-cached schedule until TTL → the newer durable entry is forwarded into the process cache only when strictly newer (no regression/success/invalidation). **Cycle 2** — the first confirming Codex round hung (~53 min, no progress) and was **cancelled** (a Codex-runtime limitation, not a clean result — reported honestly, not treated as a pass); a fresh tightly-scoped Codex confirming round AND an independent Claude confirming round then BOTH found the SAME one regression the cycle-1 refactor introduced and prescribed the SAME minimal fix — (P1/P2) the `seasonType === 'postseason'` fallback dropped the `!explicitNonFbs` guard around `playoffEventKey`, so a non-FBS row with a provider round + no `game_phase` could mint a shared `cfp-*` key (PLATFORM-086H3E4 collision class) → guarded with `round != null && !explicitNonFbs`, mirroring the sibling branch. Both cycle-2 reviewers also re-validated cycle-1's three fixes as correct and confirmed no other regression.
- Verification: +42 focused tests (authority core, lease, rollover, metadata + 3 provenance/collision regressions, historical repair, full-year 409, season-transition shared-attempt, multi-year rollover). Full `npm test` **2497/2497**; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All provider fetches stubbed; no CFBD/QStash/Vercel/production contact; no provider quota spent.
- Status: **✅ complete, MERGED to `main` via PR #422 (merge commit `f320a7e`, 2026-07-29); merged DORMANT (no scheduler/settings activation existed at merge; no provider quota was spent).** Review-converged (Codex cycle-1 3 findings + cycle-2 1 regression remediated; both cycle-2 reviewers agreed and confirmed the rest correct). The authority is now driven by the ACTIVE weekly automation: E1B/E1B1 merged and were activated in production 2026-07-29 via the runbook §8h sequence.

### PLATFORM-086C3-ODDS-CACHE-UI-HYDRATION-v1

- Purpose: Fix the confirmed production gap where a successful Odds refresh populated the durable canonical cache but game cards showed no lines, because the browser only loaded Odds when a visible game was within the retired `refreshPolicy` `[-12h, +3d]` kickoff window — so far-future and completed games' stored lines were hidden. Separate **cache hydration (what the client displays)** from **provider polling (when new data is fetched)**: display every available, canonically matched Odds record regardless of game time, while server-side polling (PLATFORM-086C2) continues to govern quota-spending fetches unchanged. Client-display only — no provider call, no QStash/`vercel.json`/automation-gate/durable-schema change.
- Scope: New `src/components/hooks/useOddsHydration.ts` — ONE cache-only read per selected season (`GET /api/odds?year=<season>`, NO `refresh=1`, NO admin auth header; the public route is a pure cache reader under PLATFORM-075/086C2) that hydrates `oddsByKey` via the existing `buildOddsLookup` and applies served-snapshot + usage meta; an `AbortController` stale-season guard (an older season's response can never overwrite a newer one); a successful empty response installs empty state + null snapshot; a failure preserves prior-good client Odds and surfaces ONE generic, body-free issue (`Odds fetch failed: unable to load current odds.`, classified by `isLiveOddsIssue`); it re-arms on season change or a schedule rebuild (a monotonic `scheduleGeneration` signal, so a with-games in-place reload still re-hydrates) — week/tab/subview navigation, focus, visibility, and the live-score timer never re-trigger it. Edits: `src/components/hooks/useLiveRefresh.ts` (bootstrap no longer fetches Odds; `shouldFetchOdds` defaults `false`, preserving the dormant authorized manual-refresh seam — explicit `includeOdds: true` + `manual: true` + `refresh=1`), `src/components/CFBScheduleApp.tsx` (wires `useOddsHydration`; drops the retired plan), `src/lib/refreshPolicy.ts` (RETIRED `getRefreshPlan`/`RefreshPlan`/`RefreshContext`/`SCORES_AUTO_REFRESH_MS` — the `odds.fetchOnStartup` window gate and the already-dead `scores` sub-plan superseded by `liveScores/browserPolling.ts`; kept `LIVE_MANUAL_COOLDOWN_MS`), deleted `src/lib/__tests__/refreshPolicy.test.ts` (tested the removed function). Explicitly UNCHANGED: server Odds polling cadence/lease/backoff/quota-probe/reserve, the shared executor, canonical attachment + durable storage, latest/closing semantics, the public `/api/odds` read-only behavior + 120 s memo, score polling/hydration, QStash config, `vercel.json`, provider descriptors, and automation gates.
- Result: every cached canonical Odds record reaches its matching game card regardless of kickoff time (far-future, live, completed, postseason); browser Odds traffic is cache-only and provider-free; Odds hydrate once per selected season, not periodically; the misleading window policy no longer suppresses cached-line display. `GameScoreboard` renders spread / over-under / moneyline from the hydrated cache as before (no UI redesign).
- Remediation additions (review cycles): centralized the hydration issue constant with its classifier (`ODDS_HYDRATION_ISSUE` co-located with `isLiveOddsIssue` in `cfbScheduleAppHelpers.ts`, matched by EXACT VALUE not a prefix); freshness-aware `mergeFresherOddsUsage` (`apiUsage.ts`) applied by BOTH `useOddsHydration` and `useAdminOddsUsage`, so the two concurrent writers of shared `oddsUsage` converge on the newest `capturedAt` (a null/older reading never clobbers a newer one); one shared response decoder `applyOddsResponse` (`src/lib/oddsClientPayload.ts`) used by the hydration hook AND the manual seam; and a `scheduleGeneration` monotonic counter (`CFBScheduleApp`, bumped on every full schedule (re)build) threaded into the hydration deps so a with-games in-place schedule reload (which does not toggle `scheduleLoaded`) still re-hydrates against the new canonical keys.
- Review: Codex round 1 clean; then the owner ran Claude `/code-review` (xhigh) → 4 low findings (issue-string prefix fragility, two-writer `oddsUsage` race, duplicated response decode, decouple test-coverage gap) — ALL FIXED; then a cycle-2 confirming Codex round found one credible P2 (a with-games in-place schedule reload did not re-hydrate odds — pre-existing, but the C3 docs overstated reload behavior) — FIXED via `scheduleGeneration`; then a further confirming round found one more P2 that the `scheduleGeneration` retry newly exposed (a successful re-hydration after an earlier failure left the stale hydration-failure warning up, since score-only ticks preserve odds issues) — FIXED (the success path now clears `ODDS_HYDRATION_ISSUE`); then a final confirming round found one P3 (the override-apply generation bump was redundant + ineffective — the optimistic `applyOverride` keeps the old canonical key) — FIXED (removed; `scheduleGeneration` bumps only on a full `loadScheduleFromApi` rebuild). The stale PLATFORM-086C2 activation documentation was corrected in the same effort (C2 is ACTIVE in production; §8g executed).
- Verification: +23 focused tests total — the 10 original (9 `useOddsHydration` cases + 1 `GameScoreboard` far-future render) plus 13 remediation tests (freshness-merge + shared-applier units, exact-value issue classification, admin-usage freshness, decouple regression ×2, schedule-rebuild re-hydration, and successful-recovery warning-clear); full `npm test` 2455/2455; `npx tsc --noEmit`, `npm run lint:all`, `npm run lint:markdown`, `npm run build`, `git diff --check` all clean. All fetches stubbed; no provider or production request.
- Status: **✅ complete, review-converged (Codex r1 clean → Claude `/code-review` 4 findings fixed → Codex cycle-2 1 P2 fixed → confirming P2 fixed → confirming P3 fixed), full gate green; MERGED to `main` via PR #421 (merge commit `8029136`, 2026-07-29).** A bounded client-display follow-up to PLATFORM-086C2's production rollout — it does NOT reopen or alter C2 activation (the runbook §8g operator sequence, now executed, is a separate step). NEXT: PLATFORM-086E1 (weekly schedule refresh).

### PLATFORM-086C2-ODDS-POLLING-ACTIVATION-v1

- Purpose: Activate the merged, DORMANT PLATFORM-086C1 Odds refresh authority in CODE ONLY (one reviewed PR): extract a single shared server-side Odds execution authority used by BOTH the manual `GET /api/odds?refresh=1` route and a NEW automatic `GET /api/cron/odds`, close the pre-existing `ODDS_API_KEY` credential-exposure seam (the C1 deferral), add a schedule-armed cache-only cron with a secret-safe runtime event, make public/member Odds reads strictly durable-cache-only with a bounded cross-instance memo, add a fixed-contract QStash management CLI, and flip the Odds provider descriptor active. Operational activation (creating the production `turfwar-odds-hourly` QStash schedule) remains a DISTINCT operator-run post-merge phase (deployment-runbook §8g) that this PR documents but does NOT execute. Second slice of PLATFORM-086C (C1 = refresh authority; C2 = polling activation).
- Scope: New `src/lib/odds/oddsRefreshExecutor.ts` (the ONE shared `executeOddsRefresh` — provider transport, payload interpretation, canonical/filtered/empty durable commit, and attempt resolution; never throws for a reachable provider/payload/commit fault; credential-sanitized diagnostics only), `src/app/api/cron/odds/route.ts` (the automatic cron: CRON_SECRET auth → `isAutoRefreshAllowed('odds')` gate → cache-only context + closing maintenance → pure cadence → durable lease + post-acquisition re-check → quota-free `/sports` probe + 50-credit reserve → at most ONE billed `/odds` → single secret-safe event), `src/lib/odds/cronExecutionLog.ts` (allowlisted `odds-cron` runtime event), `scripts/manage-odds-schedule.ts` (fixed QStash contract CLI — id `turfwar-odds-hourly`, `0 * * * *`, read-only default, `--apply`-gated, redacted Authorization). Edits: `src/lib/api/fetchUpstream.ts` (`sanitizeUpstreamUrl` credential redaction for URL + a fixed network-error message), `src/app/api/odds/route.ts` (manual route → the shared executor, preload canonical inputs BEFORE the billed request, public path strictly READ-ONLY), `src/lib/odds/oddsCommit.ts` (store-fault tolerance → `store-unavailable`), `src/lib/server/durableOddsStore.ts` (bounded 120 s memo + forced-durable-read), `src/lib/odds/refreshResult.ts` (automatic-flow reasons), `src/lib/odds/canonicalOddsContext.ts` (+`scheduleItems`/`teams`/`aliasMap`), `src/lib/odds/quotaPolicy.ts` (bounded probe timeout), `src/lib/providerDatasets.ts` (odds descriptor `hasActiveAutomation`/`autoRefreshSettingConsumed` → true), `package.json` (`manage:odds-schedule`). Explicitly NOT in scope and NOT done: creating the production QStash schedule, contacting the Odds provider, `vercel.json`, the BotID stash, any unrelated cleanup.
- Result: the manual and automatic Odds refresh paths cannot diverge (one executor); `ODDS_API_KEY` is redacted from every provider-error detail, debug log, and network-error message; public/member `/api/odds` never self-fetches, never spends quota, and never writes the durable store (closing-line maintenance moved to the authorized manual path + the cron), with cross-instance cron commits visible within a bounded 120 s memo; the automatic cron issues at most ONE billed `/odds` only when a refresh is genuinely due, protected against duplicate spend by the durable per-target lease + a post-acquisition cadence re-check (a manual refresh completing just before acquisition suppresses a redundant request) + observation ordering; quota accounting is conservative and self-healing (a billed failure with untrusted headers deducts an estimate, a 402/429 records the authoritative zero from header trustworthiness, a headerless success commits null usage rather than a pre-spend balance); a genuinely-due empty payload is classified against the already-loaded context (no misclassifying re-read); every begun attempt resolves exactly once and the lease releases from a `finally` with the truthful billed/non-billed resolution. `odds.hasActiveAutomation`/`odds.autoRefreshSettingConsumed` are `true`, but no `turfwar-odds-hourly` schedule exists, so the cron is never invoked on a schedule — DORMANT until §8g.
- Review: independent Claude self-review + independent Codex reviews, converged over FOUR remediation cycles + a CLEAN confirming Codex round. Cycle 1: transport-message credential leak (fixed message) — fixed; store/durable faults propagating as unexpected errors (executor + `oddsCommit` tolerance + cron begun-attempt backstop) — fixed; usage-header trust validation on both response paths — fixed; MANUAL canonical refresh mis-billing a post-fetch context failure (preload before the billed request → pre-billing `canonical-context-unavailable`, release-only) — fixed; closing maintenance skipped on a polling-state failure (reordered before the gate) — fixed; unbounded `/sports` probe (12 s timeout) — fixed. Cycle 2 (Codex round 2): a manual-then-cron cadence TOCTOU (post-acquisition re-check against the transaction-fresh control) — fixed; a billed failure with untrusted headers leaving an overstated balance (conservative estimate) — fixed; an expected empty misclassified on a transient schedule re-read (classify against the loaded context) — fixed; post-call bookkeeping able to mask a committed success as a 500 (best-effort, result recorded first) — fixed. Cycle 4 (Codex round 3, user-authorized after the 3-cycle gate): lease timestamped at handler entry not acquisition (fresh clock) — fixed; 402/429 zero fallback skipped on malformed headers / stale usage reported (gate on header trustworthiness, adopt the zero snapshot) — fixed; a headerless success committing the pre-spend probe balance (null usage) — fixed. Codex round 4 (confirming) clean. Considered and KEPT with rationale: quota-probe failures return HTTP `200` with `result: 'failure'` (not a non-2xx), matching the sibling live-scores cron's `quota-usage-unknown → 200 failure` convention and the prompt spec — monitoring keys on the structured event `result`/`reason`; documented in `docs/operations/diagnostics.md`.
- Verification: focused C2 tests across the cron control-flow + event contract, the QStash CLI, upstream credential redaction, the bounded durable memo, public/manual compatibility, and every review-remediation case (including a deterministic isolation that breaks the schedule re-read exactly at `/odds` response time); full `npm test` 2435/2435; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All fetches stubbed; no provider quota spent.
- Status: **✅ complete, MERGED to `main` via PR #420 (merge commit `262fdf0`, 2026-07-28); ACTIVE in production (§8g executed).** Review converged over 4 remediation cycles + a clean confirming Codex round; full gate green (2435/2435). Merging did not by itself start automatic Odds polling; the separate deployment-runbook §8g operator activation (provision `turfwar-odds-hourly`, exact-authentication proof gates-closed, then open both gates) **has since been executed**, so Odds polling is active in production. PLATFORM-086C2 completes the 086C slice; PLATFORM-086D/086E schedule-maintenance and rankings cadences remain planned.

### PLATFORM-086C1-ODDS-REFRESH-AUTHORITY-v1

- Purpose: Build the shared, concurrency-safe Odds refresh authority required before automatic Odds polling (PLATFORM-086C2) can be activated. Converge every current and future durable Odds writer onto one advisory-lock + observation-ordering contract, add durable duplicate-spend protection, and implement the cache-only polling/cadence + automatic quota policy as DORMANT reusable logic — all while preserving truthful manual/public Odds behavior and keeping automatic Odds polling completely inactive. First of two 086C slices (C1 = refresh authority; C2 = polling activation).
- Scope: Refactored `src/app/api/odds/route.ts` into an adapter over new focused modules and left HTTP parsing/response mapping in the route. New `src/lib/odds/`: `refreshResult.ts` (typed shared refresh-result: `skipped`/`success`/`no-op`/`failure` + stable secret-free reasons + lease-resolution mapping), `refreshLease.ts` (durable per-target lease `odds-refresh-control/<seasonScopedKey>`, `crypto.randomUUID` token, 5-min duration, token-checked finalize, durable automatic 1h/2h/6h/12h/24h backoff), `oddsCommit.ts` (atomic canonical raw+durable multi-key commit rooted at `durable-odds:<season>/store` with `odds-cache/<key>` second; filtered-only raw commit; public closing-line maintenance through the same durable-store transaction; shared observation-ordered merge builder), `pollingPolicy.ts` (DORMANT pure eligibility + 6h-baseline / 2h-pregame America/Chicago-date cadence with `automaticNotBefore` override), `quotaPolicy.ts` (DORMANT canonical cost estimator = 3, `remaining ≥ cost + 50` reserve gate, one-attempt quota-free `/sports` probe, conservative post-`/odds` estimate), `canonicalOddsContext.ts` (DORMANT cache-only one-`buildScheduleFromApi` context; unavailable ≠ empty). Edits: `routeInternals.ts` (`observedAt` field + `effectiveOddsObservationMs` + `ODDS_CACHE_SCOPE`), `odds.ts` (observation ordering in `applyPregameOddsSnapshot`), `durableOddsStore.ts` (exported scope/key + `primeDurableOddsStoreMemory`), `oddsUsage.ts` (`odds-automation-estimate` source literal). Explicitly NOT in scope and NOT added: `src/app/api/cron/odds`, any QStash schedule / `manage:odds-schedule`, `vercel.json`, browser Odds polling, the Odds descriptor flip, the ~50-credit-reserve/market/bookmaker policy changes, production/provider operations.
- Result: Manual `/api/odds?refresh=1`, the future automatic refresh, and public canonical closing-line maintenance share the lease + observation-ordering authority; an older request can never overwrite newer raw or per-game Odds state; the raw odds cache + durable per-game store commit atomically (a canonical-store failure no longer leaves raw odds committed with a fabricated success); process caches + success status publish only after the confirmed durable commit; concurrent provider requests are suppressed by one token-safe durable lease and a concurrent manual refresh returns a truthful **409 / `odds-refresh-in-progress`** with no provider call or fabricated attempt; empty-response truthfulness (`odds-invalid-payload` / `odds-schema-drift` / `odds-empty-unexpected` / valid no-op) is preserved against transaction-fresh state; the polling/quota/context/result logic is deterministic and dormant. `odds.hasActiveAutomation` and `odds.autoRefreshSettingConsumed` remain `false`; no cron route, QStash schedule, descriptor flip, browser polling, provider call, or production operation occurred.
- Review: independent Claude + independent Codex reviews across TWO cycles / THREE remediation rounds, with combined evaluation. Cycle 1 — Claude: P2 empty-refresh cache published before commit (regression) — fixed; P3 lease resolution reclassified after a resolved no-op/success — fixed. Codex (7; two already covered by the Claude remediation): P1 empty-writer observation ordering — fixed; P1 stale-observation memo non-publication — fixed; P2 lease store-failure classification (broadened to `store-unavailable`) — fixed; P2 filtered-commit `committedAt`/`commitSeq` ordering — fixed; P2 quota-probe fail-closed on out-of-range headers — fixed. Cycle 2 (Codex re-review of the remediation) — confirmed areas 2–5 correct/complete and found one additional P1: the empty-writer guard compared the incoming observation against the `lastFetch`-freshest prior, so a split-brain (memo newer `lastFetch`, durable newer `observedAt`) could still overwrite the observation-newer durable entry — fixed to compare against the freshest OBSERVATION across memo + durable (round 3, regression test F1b). Deferred (tracked, not diff-attributable / out of C1 scope): a pre-existing `ODDS_API_KEY` in the `UpstreamFetchError` detail body (admin-gated) → separate security follow-up; the committed-path durable-memo prime under cross-instance concurrency is the documented best-effort memo limitation (durable authoritative; served responses use the committed store directly; self-healing).
- Verification: +50 focused tests (writer convergence, lease/control, polling policy, quota/provider, compatibility); full `npm test` 2377/2377; `npx tsc --noEmit`, `npm run lint:all`, `npm run build`, `git diff --check` all clean. All fetches stubbed; no provider quota spent.
- Status: **✅ complete, MERGED to `main` via PR #419 (merge commit `b9c6cb3`, 2026-07-28); DORMANT (no activation).** PR-size note: 17 changed files (5 modified + 6 new modules + 6 test files) crosses the 15-file stop-and-reassess signal — expected and justified because the prompt's Sections 1–9 each mandate a focused module + tests for one cohesive objective (the Odds refresh authority); no unrelated cleanup was folded in. PLATFORM-086C2 (Odds polling activation) is the next provider-campaign task.

### DOCS-011-PLATFORM-086B2B-PRODUCTION-ACTIVATION-CLOSEOUT-v1

- Purpose: Documentation-and-memory-only closeout recording that the PLATFORM-086B2B live-score activation sequence (deployment-runbook §8f) was executed successfully in production on 2026-07-28. No code, configuration, QStash, Vercel, provider, quota, or production-data change; explicitly opted out of the automatic review/remediation convergence (trivial factual closeout).
- Scope: `docs/deployment-runbook.md` §8f (marked ✅ COMPLETED + a dated production checkpoint; retained as the historical procedure + emergency-stop/rotation reference with a do-not-replay note), current operations/architecture docs (`docs/operations/deployment.md`, `docs/operations/diagnostics.md`, `docs/architecture/game-data-flow.md` — stale present-tense "dormant/unscheduled/planned/awaiting §8f" claims about live-score automation corrected to current truth), campaign ledgers (`docs/next-tasks.md`, `docs/roadmap.md`, `docs/prompt-registry.md`, `docs/completed-work.md` — B2B flipped to merged + production-active; the per-game overlay-freshness deferral preserved; 086C kept as next without auditing), and persistent memory. Committed directly to `main` (no branch/PR/preview).
- Verified activation evidence recorded (from the operator): QStash `turfwar-live-scores-3m` active/unpaused, `*/3` → `GET /api/cron/live-scores`; gates-closed delivery HTTP `200` `skipped / automation-paused-or-disabled`; gates-open delivery HTTP `200` `skipped / no-polling-target` (`quotaChecked: false`, `providerCallAttempted: false`); CFBD quota baseline `4914 → 4914` with no unexpected attempt/durable write (the prior `4920 → 4914` movement predates the baseline and is not attributed to these deliveries); final settings Scores auto-refresh On, global pause Off, browser polling cache-only; the first game-window provider call is normal in-season monitoring, not pending activation.
- Status: **✅ complete — documentation + memory closeout committed directly to `main` (post-merge docs convention, no PR).** No provider/production interaction; `npm run lint:markdown` + `git diff --check` clean; the diff contains no runtime files. PLATFORM-086C (Odds polling) remains next and was NOT audited, planned, prompted, or implemented.

### PLATFORM-086B2B-LIVE-SCORE-ACTIVATION-v1

- Purpose: Activate the merged, dormant PLATFORM-086B1 live-score engine + PLATFORM-086B2A writer-lock in CODE ONLY (one reviewed PR). Provide the operator tooling and browser/route wiring for schedule-armed 3-minute live-score polling. Operational activation (creating the QStash schedule against production) remains a DISTINCT operator-run post-merge phase (deployment-runbook §8f) that this PR documents but does NOT execute. Second slice of PLATFORM-086B2 (B2A = writer-lock convergence, B2B = activation).
- Scope: (1) Shared QStash schedule manager — game-stats CLI policy extracted into contract-parameterized `scripts/lib/qstashSchedule.ts` (game-stats behavior byte-identical; its suite passes unchanged); new `scripts/manage-live-scores-schedule.ts` + `npm run manage:live-scores-schedule` with the FIXED contract (id `turfwar-live-scores-3m` → GET `/api/cron/live-scores`, `*/3 * * * *`, method GET, retries 0, forwarded `Authorization: Bearer <CRON_SECRET>` with provider-side `Upstash-Redact-Fields` redaction, read-only default, `--apply`-gated mutations, NO delete action; per-job `authProofRef` so inspect cites the right runbook section — §8f for live-scores, §8e for game-stats). (2) Browser polling — new client-safe `src/lib/liveScores/browserPolling.ts` (eligibility: canonical current season + `[kickoff−15min, kickoff+24h]`, excludes canceled/postponed; in-window finals STAY eligible so a `/games` reconciliation correction still propagates; conference-championship partition → `regular`) + a self-rescheduling 3-minute visible-tab timer in `useLiveRefresh.ts` (re-arms one interval after the last poll and after focus/visibility polls; survives navigation via a `refreshLiveData` ref; throttle stamped at poll initiation). (3) `fetchScoresByGame` exact-partition cache-read mode (unique `(providerWeek, seasonType)`, week-scoped, never `refresh=1`/creds/season-wide/Odds/CFBD) carrying a cache-only `&live=1` durable-read hint. (4) Route — `live=1` week reads serve the RECONCILED week view (new `loadReconciledWeekScores`: full season-type reconcile incl. `-all-` aggregate + canonical-week alias children, filtered to the provider week) so a live poll cannot overwrite/miss an admin correction nor diverge from standings; week-scoped `generatedAt` derives from the newest effective ROW timestamp (`newestEffectiveRowTimestamp`). (5) Freshness — nullable durable `snapshotAt` (oldest `meta.generatedAt` over nonempty contributors; any partition read failure nulls it) drives a NEW "Scores updated …" `FreshnessLabel`; a SEPARATE `scoresObservedAt` (client time of a clean poll) drives live-overlay `isStale`, which is fed a 60-second ticking clock so it stays reactive during outages; stale threshold 16min→7min. (6) `detectScoreFinalizations` is correction-aware (fires on a material final→final score change, not just non-final→final). (7) `scores` provider descriptor flipped to `hasActiveAutomation: true` + `autoRefreshSettingConsumed: true` (the B1 cron consumes `isAutoRefreshAllowed('scores')`), new currentAutomation/plannedPolicy, broad `staleAfterMs: 2*DAY` retained. Docs: deployment-runbook §8f (activation sequence, documented not executed) + §4/§8e `CRON_SECRET` rotation now spans BOTH schedules. QStash duplicate deliveries accepted without a durable lease (the idempotent poll + per-key advisory-locked merge tolerate them). No `vercel.json`/cron change; no live provider/QStash/production contact.
- Status: **✅ MERGED to `main` via PR #418 (merge commit `57fab82`, 2026-07-28); branch `platform/086b2b-live-score-activation` from `main` @ `7ffda99` (feature `4392ae9` + docs-closeout `abfc43d`). ACTIVATED IN PRODUCTION 2026-07-28 (runbook §8f executed) — see the DOCS-011 activation-closeout entry.** Production state: QStash schedule `turfwar-live-scores-3m` active and unpaused, fixed `*/3 * * * *` → `GET /api/cron/live-scores`; **Scores automatic refresh On, Global provider pause Off**, browser polling cache-only, `vercel.json` unchanged. Activation proofs: a **gates-closed** scheduled delivery returned HTTP `200` `skipped / automation-paused-or-disabled` (route credential accepted, no attempt created); a **gates-open** scheduled delivery returned HTTP `200` `skipped / no-polling-target` with `quotaChecked: false` and `providerCallAttempted: false`; **CFBD quota held at the controlled baseline `4914 → 4914`** with no unexpected score-refresh attempt or durable score write (the earlier `4920 → 4914` movement predates this baseline and is not attributed to these deliveries). The first game-window `/scoreboard` / final-reconciliation call is ordinary in-season monitoring, not pending activation. Review: Claude `/code-review` self-review (5 findings — 1 fixed [3-min timer reset-on-navigation], 4 skipped as negligible/documented/disproportionate) + **eight Codex review passes, 13 findings, 12 remediated / 1 deferred**: pass 1 (P1 in-window finals kept eligible; P2 `live=1` durable read past the in-process TTL; P2 partition read failure nulls global freshness); pass 2 (P2 corrected-final → correction-aware `detectScoreFinalizations`); pass 3 (P2 odds-warning preserved on score-only ticks; P2 self-rescheduling timer for the 6-min cadence gap); pass 4 (**P1 per-game freshness granularity DEFERRED per owner**; P2 partition ticks no longer complete season hydration); pass 5 (P1 `live=1` reconciled with the `-all-` aggregate; P2 CLI inspect cites §8f not §8e); pass 6 (P2 `isStale` uses successful-observation time, fixing the ~13-min halftime false-stale); pass 7 (P2 `loadReconciledWeekScores` reconciles canonical-week alias children); pass 8 (P2 `isStale` made time-reactive via a 60s clock — pre-existing, fixed under owner authorization). Verification: full `npm test` **2322/2322**; `npx tsc --noEmit` clean; `npm run lint:all` clean; `npm run build` OK (`/api/cron/live-scores` route registered); `git diff --check` clean. No provider quota spent (fetch/QStash fully stubbed; no live CFBD/QStash/Vercel-prod contact).
- Notes: **Deferred (owner decision):** per-game overlay freshness — `snapshotAt`/`isStale` are per-partition/global, not per-game, so in a provider-gap scenario a fresh game can ride over a stale sibling (strictly better than pre-B2B, which reported every game fresh on any poll; true fix = per-game timestamps → per-game staleness, a separate slice). Documented in `src/lib/scores.ts` and `docs/next-tasks.md` deferrals. **Activation completed 2026-07-28** (runbook §8f, now a completed historical procedure): the QStash `turfwar-live-scores-3m` schedule was provisioned and gate-verified with both automation gates closed (exact-authentication delivery proof passed), then the gates were opened in order — the production checkpoint (delivery proofs, `4914 → 4914` quota baseline, final On/Off settings) lives in §8f and the DOCS-011 entry below. Post-merge status-flip (registry → MERGED, `docs/completed-work.md` milestone) is done; §8f must not be replayed merely because it is being read.

### PLATFORM-086B2A-SCORE-WRITER-LOCK-CONVERGENCE-v1

- Purpose: Eliminate the concurrency gap between authorized manual score refreshes and the dormant PLATFORM-086B1 live-score engine BEFORE automation is activated — the B1-deferred item. Move the `/api/scores?refresh=1` durable write onto the same per-key advisory-locked transaction protocol the live engine uses, keeping manual-refresh behavior and keeping live-score automation DORMANT. First slice of PLATFORM-086B2 (B2A = writer-lock convergence, code-only; B2B = activation).
- Scope: New score-domain `src/lib/scores/manualPartitionMerge.ts` (pure authoritative-replacement merge with concurrency handling) + `refreshScorePartition` in `src/app/api/scores/route.ts` (its `setAppState('scores', cacheKey, …)` upsert replaced with `withAppStateKeyTransaction('scores', cacheKey, …)` — fetch/normalize OUTSIDE the transaction, read→merge→write inside; process cache/prune/standings-invalidation/commit-metadata only after commit; a transaction failure is a truthful refresh failure preserving prior-good) + the B1 deferral comment in `scoreMerge.ts` retired + focused suites (`manualPartitionMerge.test.ts`, `writer-lock-convergence.test.ts`). Merge policy: authoritative partition replacement, EXCEPT (a) a prior row whose effective per-row timestamp is ≥ the manual observation is preserved as a later live update (tie preserves the live row); (b) a manual `/games` strict monotonic state ADVANCE (scheduled→in-progress→final; a final needs both scores; disrupted excluded) overrides a protected live row (a game cannot regress); (c) pending-final metadata clears only when a manual `/games` final CONFIRMS the same score (a differing final retains pending); (d) the enclosing entry version is bumped monotonically (`max(now, prior.at + 1)`) so a cross-instance week-scoped read never prefers a stale cached copy; (e) any id-less normalized `/games` row is partition uncertainty → schema drift (prior-good retained), never an incomplete replacement. Both production writers of a `scores/<year>-<week>-<seasonType>` key now share the same advisory lock (different merge policies, shared lock + per-row effective-timestamp ordering). No QStash, `vercel.json`, browser polling, or provider-automation setting change.
- Status: **✅ MERGED to `main` via PR #417 (merge commit `4039c98`, 2026-07-28); branch `platform/086b2a-score-writer-lock-convergence` from `main` @ `9239f16`; live-score automation DORMANT (no scheduler, no descriptor flip).** Review: Claude `/code-review` self-review (3 findings — 2 fixed via remediation, 1 benign) + **five Codex rounds, each remediated** — round 1 (P1): merged entry version made monotonic (a cross-instance week-scoped read selects by `at`; a backward `at` would hide manual corrections past TTL); round 2 (P2): an authoritative `/games` final overrides a newer live non-final + clears pending on confirmation; round 3 (P2×2): preserve a live row on a same-millisecond timestamp tie, reject id-less rows; round 4 (P2×2): a DIFFERING manual final retains pending (never falsely confirmed), a mixed id-less payload is schema drift (no incomplete replacement deleting prior-good); round 5 (P2): the override generalized from finals to any strict monotonic state advance. Every finding is inert while the engine is dormant (the manual-vs-concurrent-live window is unreachable until B2B). Verification: full `npm test` **2288/2288**; `npx tsc --noEmit` clean; `npm run lint:all` clean; `npm run build` OK; `git diff --check` clean. No provider quota spent (fetch fully stubbed).
- Notes: Code-only prerequisite; **no activation** — B2B still owns the QStash schedule, browser refresh, descriptor flip, and rollout. The rounds-2–5 findings were all merge-policy corner cases in the concurrent manual-vs-live window (inert while dormant); the core lock mechanism was stable from round 1. After eventual merge, follow the post-merge status-flip convention with the real merge commit.

### PLATFORM-086B1-LIVE-SCORE-POLLING-ENGINE-v1

- Purpose: Implement and verify the DORMANT backend engine for schedule-armed CFBD live-score polling — canonical target selection, `/scoreboard` ingestion, durable score merge, `/games` final reconciliation, exact week-partition scoped status, and secret-safe runtime logging. Production-capable but unscheduled: after merge no scheduler invokes it. First slice of the PLATFORM-086B split (B1 = engine; B2 = activation — the QStash schedule, cache-only browser refresh, score-automation descriptor flip, and rollout).
- Scope: New `GET /api/cron/live-scores` route + `src/lib/liveScores/*` (scoreboard payload normalizer/status mapping, cache-only canonical context, `[-15 min, +24 h]` polling-target/mode selection, provider-id + numeric/identity side-safe scoreboard matcher, durable per-partition merge, `/games` final reconciliation, `live-scores-cron` execution log) + focused suites. Shared-infra changes: `CacheEntry.itemUpdatedAtById`/`pendingFinalConfirmationIds`; the season reconciler (`scoreCacheReader.ts`) gains per-row EFFECTIVE-timestamp reconciliation + `newestEffectiveAt`/`effectiveAtById` (a preserved child row can no longer out-rank a genuinely newer copy, and a metadata-only rewrite cannot fabricate served-score freshness); `/api/scores` season read uses `newestEffectiveAt`; `gameStateFromScore` (`gameUi.ts`) delegates to `classifyScorePackStatus` so live labels (`Q3 8:14`, `OT`) are recognized; `buildCfbdScoreboardUrl` (`cfbd.ts`); and the `scores` `plannedPolicy` (`providerDatasets.ts`) corrected to name B1 (dormant engine) / B2 (activation) — `hasActiveAutomation`/`autoRefreshSettingConsumed` stay `false`. One invocation performs at most ONE billed CFBD request (global `/scoreboard?classification=fbs` OR one partition `/games`) plus one `/info` quota probe; every begun `weekPartitionScope` attempt resolves exactly once and no `year` rollup is written; monotonic + null protection reference the reconciled prior score (child + season-wide aggregate); exactly one secret-safe `live-scores-cron` event is emitted from a single `finally`. No QStash schedule, `vercel.json`, browser polling, Odds work, or diagnostics redesign introduced.
- Status: **✅ MERGED to `main` via PR #416 (merge commit `4cbea60`, 2026-07-27); branch `platform/086b1-live-score-polling-engine` from `main` @ `7ffda99`; engine DORMANT (no scheduler).** Review: Claude `/code-review` self-review (1 test-coverage finding fixed; 3 minor deferred) + **three Codex rounds converged** — round 1 (6 findings): 5 remediated (P1 reconciled-baseline merge protection; P2 observation-ordering; P2 fail-closed malformed reconciliation; P2 write-free-confirmation no-op; P2 pre-invalidation commit-metadata capture), 1 deferred to B2 (documented); round 2 (3 findings): all remediated (P1 freshest-timestamp baseline selection via `effectiveAtById`/`cachedScoreAt`/`baselineAt`; P1 `/games` side-safe participant validation before confirming a final; P2 ID-less retained-row timestamp preservation); round 3: no code findings (only these closeout docs — a `partial` scoped-outcome wording fix + queue advancement, both applied). Verification: full `npm test` **2268/2268**; `npx tsc --noEmit` clean; `npm run lint:all` clean; `npm run build` OK (`/api/cron/live-scores` registered); `git diff --check` clean. No provider quota spent (no live CFBD/QStash/Vercel-prod contact).
- Notes: Engine stays dormant until **PLATFORM-086B2** activates it. One deferred non-blocker (documented in `scoreMerge.ts`): the `/api/scores?refresh=1` manual-repair path still writes the partition via a plain `setAppState` upsert that does not honor the live-merge advisory lock — a B2 concern (inert while dormant, self-healing). `cfbd-api-key-missing` is unreachable when the key is truly absent (the fresh `/info` quota probe throws first → `quota-usage-unavailable`), mirroring the game-stats cron's deliberate ordering. After eventual merge, follow the post-merge status-flip convention with the real merge commit.

### PLATFORM-086F1-GAME-STATS-CRON-EXECUTION-LOGGING-v1

- Purpose: Add one secret-safe, machine-readable runtime event for every invocation of the QStash-triggered game-stats cron, making scheduler decisions (harmless skips included) visible in Vercel Runtime Logs without fabricating provider-refresh attempts or adding durable observability state. First bounded slice of the former PLATFORM-086F, now formally split: F1 = this logging slice; F2 = the broader admin-diagnostics IA redesign (parked, last).
- Scope: `GET /api/cron/game-stats` instrumentation + new `src/lib/gameStats/cronExecutionLog.ts` (event contract, stable reason vocabulary, mutable tracker + initializer, best-effort single-`console.log` emitter) + new focused suite `src/app/api/cron/game-stats/__tests__/execution-logging.test.ts`. One `console.log(JSON.stringify(event))` per invocation from a single outer `finally` (exactly-once for skips/outcomes/auth-failures/throws). Allowlisted fields only: `event`, `result` (skipped|success|partial|no-op|failure), `reason` (fixed pre-provider literals, `quota-${QuotaRefusalReason}`, or the interpreter's exact reason — never collapsed, incl. `partial`), `year`, nullable `week`/`seasonType`, `quotaChecked` (before the `/info` probe), `providerCallAttempted` (billed `/games/teams` only), `committedGames` (confirmed durable-commit count), `durationMs` (nonnegative integer). Never serializes a request/response object, thrown error/message, provider payload, env value, URL, credential, or authorization header; the free-form canonical-context reason is excluded. No QStash/`vercel.json`/cadence/provider/HTTP-response/refresh-status/admin-UI change; no durable heartbeat/state; the paused/no-context/no-target invariant (no provider-refresh attempt) is preserved.
- Status: **✅ MERGED to `main` via PR #414 (merge commit `a7f5db2`, 2026-07-27); independent Claude foreground review clean (10-angle, no findings) and Codex review clean (cycle 1).** Branch was `platform/086f1-game-stats-cron-logging` from `main` @ `31074fd` (impl `a030e9a` + review-finding fixes `6882d00` + docs closeout `cfb59f0`). Review cycle 1 surfaced four low-severity test-only findings (untested reachable context-unavailable event; a test-restore outside `finally`; untested unreachable defensive-branch mappings; an unused injection param) — all fixed (commit `6882d00`): added a context-unavailable runtime test, a static source-pin for the two unreachable defensive branches (matching `coverage.test.ts`), the try/finally hygiene fix, and the param removal. Verification: focused suite 36/36 (execution-logging 15/15 + coverage/pause 21/21); `npx tsc --noEmit` clean; `npm run lint:all` clean; full `npm test` 2181/2181; `npm run build` OK; `git diff --check` clean.
- Notes: `partial` is a first-class truthful outcome (never collapsed to success/failure). `cfbd-api-key-missing` and the defensive `ingestion-failed` catch are unreachable at runtime (`fetchCfbdUsage` throws on an empty key so the quota gate refuses first with `usage-unavailable`; H2 funnels every expected ingestion fault into a typed interpreter outcome), so their event mappings are guarded by a static source-pin rather than fabricated runtime states. Next in campaign order: PLATFORM-086B (live-score polling). The broader diagnostics IA redesign + optional last-scheduler-check heartbeat remain PLATFORM-086F2.

### PLATFORM-086I-SETTINGS-FEEDBACK-v1

- Purpose: Surface the global-pause and per-dataset auto-refresh toggle mutation errors the Provider Data Status panel already stored but never rendered — the last remnant of the PLATFORM-086A operator-controls work (deferred finding #2 / the retired 086D). Client-only presentation: no server API, persisted-settings, refresh-behavior, provider-job, or diagnostics information-architecture change.
- Scope: `src/components/admin/ProviderDataStatusPanel.tsx` (rendering only) + a new JSDOM component suite `src/components/admin/__tests__/ProviderDataStatusPanel.feedback.test.tsx`. Global pause → a `w-full` `role="alert"` beneath the pause row with a conditional `aria-describedby` from the button to a stable id (`provider-global-pause-error`); interactive dataset toggle (Game Stats today) → a `role="alert"` beneath the card's control row with a conditional `aria-describedby` from the checkbox (`provider-toggle-<dataset>-error`). Authoritative-state behavior preserved (no optimistic toggle, no reload after failure, setting applied only after a successful POST reload; a retry sets `loading`, which clears the stale alert). Displays the existing stored message after a short control-specific prefix — no new error-response schema or toast system.
- Status: **✅ MERGED to `main` via PR #413 (merge commit `da99a11`, 2026-07-27); independent Codex-review CLEAN (single foreground review, no findings).** Branch was `platform/086i-settings-feedback` from `main` @ `ec54644` (impl `dd5f4ef` + docs closeout `5a5e7fe`). Verification: new feedback suite 3/3; provider-panel helper suites (`manualRefresh` + `providerStatusSummary`) 55/55; `provider-status` route suite 23/23; `npx tsc --noEmit` clean; `npm run lint:all` clean (ESLint + Prettier + markdown); full `npm test` 2166/2166. Only the two files above changed vs `main` (+368).
- Notes: Only a setting-consumed (`interactive`) dataset can populate a toggle-error key, so the toggle alert renders only on the Game Stats card today; planned/lifecycle-exempt datasets have no toggle and no alert. The manual-refresh feedback path is separate and unchanged. This closes the PLATFORM-086 deferred finding #2; provider automation continues with 086B (live-score polling) per the campaign execution order.

### DOCS-010-CURRENT-DOCUMENTATION-RECONCILIATION-v1

- Purpose: Post-PLATFORM-086H3E-activation reconciliation of the repository's current/canonical documentation and production-code comments with the activated game-stats architecture, plus the confirmed onboarding, campaign-status, cron-topology, and documentation-index drift. Documentation- and comment-only; no runtime behavior, exports, types, configuration, provider calls, or operations.
- Scope: `AGENTS.md` (game-stats invariants → activated ingestion/merge/projection vocabulary; hard-coded "Active campaigns" list → pointer to `docs/next-tasks.md`/`docs/roadmap.md`); the five current architecture docs (`docs/architecture/overview.md`, `game-data-flow.md`, `storage-and-caching.md`, `auth-and-privacy.md`, `docs/CFB_APP_ARCHITECTURE.md`); `docs/ai/game-stats-writer-fence.md` (full audit — E3 merged, artifact `a161e33` active, writer control `active`, H2 the only writer, emergency `read-only-safe`, §5/§6 relabelled historical/executed, closeout preserved as pending); present-tense comments in `src/lib/gameStats/*.ts` (retired the "DORMANT"/"future caller"/"E3 will wire" claims on now-active modules; retained operator-CLI-only `writerControlTransition` framing); `docs/operations/diagnostics.md` (active ingestion/interpreter vocabulary; fixed the broken `../deployment.md` link → sibling); `docs/roadmap.md` (Season Rollover + Game Stats Pipeline cron topology → two lifecycle crons + QStash); `CLAUDE.md` (retired the false client `deriveStandings`-fallback claim); root `README.md` (project onboarding replacing create-next-app boilerplate); `docs/README.md` (index rows for the README and `docs/ai/*`, DOCS-002x-vs-DOCS-010 qualification); lifecycle-metadata normalization + `Last verified` bumps on reviewed docs only.
- Status: **✅ COMPLETE — self-verified and independent Codex review clean.** Documentation/comment-only; no runtime behavior change. Verification: `git diff --check` clean; `npm run lint:markdown` 0 errors; `npm run lint:all` clean (ESLint + Prettier + markdown); `npx tsc --noEmit` clean; activation-invariant guard 13/13 (comment-inclusive symbol scans pass — no banned/restricted symbol entered a production comment); full `npm test` **2163/2163**; read-only Markdown local-link check clean; targeted proof-searches confirm no current/canonical doc references `classifyGameStatsPayload`, no writer-fence statement says E3 is pending / activation never ran / production remains `legacy` (as a current claim), the roadmap agrees with `vercel.json`'s two lifecycle crons, `CLAUDE.md` no longer claims the client `deriveStandings` fallback exists, and every root-README path/command is valid. **Independent review: Codex ran three rounds over the working tree; all findings were remediated in-session** (round 1 — runbook cron topology, roadmap quota estimate, `contract.ts` writer-module reference; round 2 — retained-fence vs. deleted-writer wording in AGENTS.md, a residual `next-tasks.md` "activation unwritten" claim, `operations/deployment.md` diagnostics/cadence model; round 3 — the same retained-writer wording in `game-data-flow.md`, since corrected there and in `coverage.ts`). Claude `/code-review` findings (outcome-vocabulary layering, storage TTL/H1-gating precision, evidence-attachment wording, single-test env vars, point-in-time comments) were all remediated too. Preserved throughout: the pre-existing user activation-status edits. The two **operational** closeouts (gates-open scheduled-delivery observation; restoring Auto-assign Custom Production Domains) have since been COMPLETED (2026-07-26): gates-open deliveries returned HTTP `200` with CFBD unchanged at `4920` and domains re-enabled — activation-ops that were always separate from DOCS-010 work. A later docs-only closeout commit flipped those pending statements to complete.

### PLATFORM-086H3E3-FINAL-ATOMIC-WIRING-v1

- Purpose: The single behaviorally atomic activation slice of PLATFORM-086H3E: connect every live game-stats seam AT ONCE — the admin-only route (projector-only reads; manual refresh through the ONE ingestion path + ONE interpreter + durable reread with explicit `bypassCache=1`/`quotaOverride=1` grammar), the 15-minute kickoff-window cron (max one partition fetch, fresh quota probes, truthful scoped statuses), the analytics consumer cutover (every owner/Insights/history/career value from `projectAnalyticsPartition` over ONE paired provenance: live = the exact scored season build, archive = the archive's own `gameStatSlate` + `scoresByKey`, both fail-closed), evidence-based diagnostics, the truthful descriptor + `*/15` cadence, and the activation-invariant guard replacing the dormant guard. Writing remains operator-gated: legacy writes only under `legacy`, H2 only under `active`, both refuse in `armed`.
- Status: **✅ MERGED to `main` via PR #410 (merge commit `23baf4f`, 2026-07-26); Codex-review CLEAN; PRODUCTION ACTIVE. The exact reviewed code-bearing artifact is commit `a161e33`, deployment `dpl_73jnt1KDqaAE5dRT9BJ5uLRfpLEt`; writer control is durably `active`, the QStash schedule is provisioned and unpaused, and both game-stats automation gates are open. Activation is FULLY CLOSED (2026-07-26): gates-open scheduled deliveries returned HTTP `200` with CFBD quota unchanged at `4920` (no eligible partition ⇒ no provider attempt), and Auto-assign Custom Production Domains is re-enabled.** Branch `platform/086h3e3-final-atomic-wiring` from `main` @ `b4b7c19` (impl `438b7e0`/`0aeb90a`/`3d38660`/`724c921`; remediations `fbdec1c`, `5219388`, `b0c9ed1`, `4fea8ec`). Review history: round 1 — four blockers (transport retries breaking the one-request promise and quota arithmetic; unvalidated archive score maps; non-provenance-atomic owner attribution; failure responses omitting the durable reread) + four should-fix (loose flag grammar; blanket family guard exemption; spread/seam textual gaps; descriptor overstatement) — all remediated; round 2 — three blockers (entry-level score-status throw; remaining rereads; parenthesized-spread evasion) + strict flag literal — remediated; round 3 — two blockers in surrounding wiring (admin panel on the retired wire; 600s-cached quota probes under the 19-step backfill burst) — remediated; round 4 — two panel should-fix (truthful 429 stop reasons; outcome-aware backfill tallies) — remediated; round 5 **CLEAN**. Gates: `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 2107/2107; production build OK. Isolated semantic comparison: `buildSeasonArchive` byte-identical to `main` over identical seeded state (the `seasonBuild` extraction is behavior-preserving); schedule/scores/odds/rankings surfaces file-identical; the intended deltas (admin-gated projector reads, ingestion-path refresh, analytics gating) are each pinned by the rewritten route/cron/diagnostics/consumer suites.
- Notes: 34 files vs `main` measured at the docs-closeout commit `2d4463e` (+2,803/−2,581 for that exact range; subsequent wording-remediation commits shift the totals trivially; the code+tests slice alone is 30 files, +2,756/−2,577): route + cron rewrites; `seasonBuild.ts` (extracted shared scored build) + `analyticsProvenance.ts` (paired live/archive assemblies with distinct fail-closed reasons incl. entry-strict archive score maps and provenance-atomic identity); consumer cutover with the compile-time `AnalyticsGameStats` boundary and the insights cache-identity version; evidence-based `providerDataDiagnostics`; retired legacy classifier trio deleted with `coverage.ts` narrowed to the presence probe; `debug/game-stats-diagnostic` deleted, `debug/archive-integrity` retained under a justified guard allowlist; `GameStatsCachePanel` on the activated wire with outcome-aware backfill and truthful quota stops; `fetchCfbdUsage({fresh})` for gate-path probes; `activation-invariants.test.ts` (exact per-file allowlists, paren-spread ban, comment-masked seam/order checks, CLI-only transition module, `vercel.json` cadence + descriptor assertions, self-tested). **Production activation evidence (2026-07-26):** `legacy → armed → active`; cache-only production checks clean; controlled `2025 / week 16 / regular` manual refresh `success` / `written-clean`, durable `1/1`, published `1`, status scope `game-stats:week:2025:16:regular`, `rowsCommitted: 5`, no mismatch/unavailable/partial/error; `/info` costs zero calls and the provider proof moved quota `4921 → 4920`; QStash schedule `turfwar-game-stats-15m` passed structural/redaction inspection and a gates-closed authenticated HTTP `200` delivery with zero provider calls/attempts; gates opened dataset-first/global-pause-last. Production must never return to `legacy`; emergency fallback is `active → read-only-safe`. Activation is fully closed (2026-07-26): gates-open scheduled deliveries returned HTTP `200`, CFBD held at `4920` with no provider attempt, and Auto-assign Custom Production Domains is re-enabled. A dedicated app-side structured log for harmless scheduler decisions is intentionally deferred to the first PLATFORM-086F slice and must not be implemented by fabricating provider-refresh attempts. Full operator record: `docs/deployment-runbook.md` §8e.

### PLATFORM-086H3E-EXTERNAL-SCHEDULER-MIGRATION-v1

- Purpose: Move the 15-minute game-stats poll off Vercel crons (Vercel Hobby rejects sub-daily cron expressions at deploy time, which blocked the E3 staged-production build) onto an external QStash schedule that calls the UNCHANGED `GET /api/cron/game-stats` with a forwarded `Bearer <CRON_SECRET>`. The route, writer-control, quota, one-request, no-retry, and durable-reporting behavior are untouched; only the trigger mechanism changes. Delivered as part of PR #410 (on the E3 branch).
- Status: **✅ MERGED to `main` via PR #410 (merge commit `23baf4f`, 2026-07-26); Codex-review CLEAN (final review "CLEAN — merge-ready"); EXECUTED in production. QStash schedule `turfwar-game-stats-15m` is provisioned, unpaused, and inspection-clean; the gates-closed HTTP `200` delivery proved exact route authentication with zero provider calls and no provider-refresh attempt. The Vercel deploy check is GREEN and there is no Vercel-plan requirement for the `*/15` cadence. Activation is fully closed (2026-07-26): gates-open scheduled deliveries returned HTTP `200` with CFBD unchanged at `4920` and no provider attempt.** Migration commits on the branch: `263949a` (externalization + CLI) → hardening `53ff156`/`9adc990`/`16729ea`/`67ca7e0` (five CLI security rounds: contract-verification strictness, credential-echo redaction across args/summary/debug, QStash host allowlist, raw-entry auth cardinality) → `a181bdc`/`00801f0` (inspect exit-0 requires exact `CRON_SECRET` verification; `process.exitCode`; loud PAUSED note) → `8354589` (revert a mistaken `/code-review` "dead branch" removal — the interpreter `partial` kind is a live confirmed-commit outcome). Gates: `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 2163/2163; production build OK.
- Notes: Changes only `vercel.json` (removed the `/api/cron/game-stats` cron; kept the two daily lifecycle crons), `package.json` (`manage:game-stats-schedule` script), `src/lib/gameStats/__tests__/activation-invariants.test.ts` (flipped: the game-stats cron must be ABSENT), and adds `scripts/manage-game-stats-schedule.ts` + its test. The route (`src/app/api/cron/game-stats/route.ts`) and the E3 serving behavior are byte-unchanged. The CLI is inspect-first (read-only default; `upsert`/`pause`/`resume` require `--apply`; no delete; no QStash runtime dependency — plain fetch) with a FIXED contract (schedule id `turfwar-game-stats-15m`, dest `https://turfwar.games/api/cron/game-stats`, cron `*/15 * * * *`, `GET`, retries 0, forwarded Authorization, no callback/queue/retry-delay). Safety invariants (all test-pinned): `QSTASH_TOKEN`/`CRON_SECRET` never printed on any path (redacted args, derived summary, constant-only divergence messages, scrubbed debug output); `QSTASH_URL` validated to an https origin on the `qstash[-region].upstash.io` allowlist (default port) before any credential is attached; forwarded-Authorization cardinality judged on RAW entries (>1 ⇒ ambiguous); inspect exit `0` requires exact `CRON_SECRET` verification (absent ⇒ exit `2` INCOMPLETE) — **SUPERSEDED by `PLATFORM-086H3E-EXTERNAL-SCHEDULER-PRE-ACTIVATION-REMEDIATION-v1`: the upsert now redacts the forwarded credential and inspect instead verifies the readback is `REDACTED:<opaque>`, needing no `CRON_SECRET`; exact route auth is proven by the §8e delivery test**; mutation exit mapping confirmed=`0`/absent=`2`/unconfirmed=`4`/missing-cred=`3`. Operator sequence: runbook §8e step 11 (`-- upsert --apply` → inspect) provisions it after the manual proof; emergency stop pauses the schedule before the writer transition; `CRON_SECRET` rotation re-runs `-- upsert --apply`.

### PLATFORM-086H3E-EXTERNAL-SCHEDULER-PRE-ACTIVATION-REMEDIATION-v1

- Purpose: The bounded fix-forward remediation required before PLATFORM-086H3E activation, on `main` after PR #410: (1) secure the QStash schedule's forwarded route credential with provider-side redaction, and (2) correct the activation runbook to match the completed §8d production prerequisites and BOTH automation gates. No cron-route, scheduler ownership, cadence, provider, production, deployment, archive, or writer-control changes.
- Status: **✅ MERGED to `main` via PR #412 (merge commit `a161e33`, 2026-07-26); Codex-review CLEAN; EXECUTED as the reviewed production artifact. Deployment `dpl_73jnt1KDqaAE5dRT9BJ5uLRfpLEt` is serving, writer control is `active`, QStash is active/unpaused, game-stats auto is enabled, and global pause is off.** Branch was `platform/086h3e-scheduler-preactivation-remediation` from `main` @ `9e4c371`.
- Notes: **CLI (`scripts/manage-game-stats-schedule.ts`):** the upsert request now includes the exact raw HTTP header `Upstash-Redact-Fields: header[Authorization]` (NOT the SDK's `header: true`), so QStash stores/returns the forwarded route credential as `REDACTED:<opaque>` while still delivering the real `Bearer <CRON_SECRET>` to the route — keeping the plaintext secret out of QStash's readable state. Inspection is re-specified: it no longer requires `CRON_SECRET` (which cannot validate the opaque, undocumented digest) and instead requires exactly one raw `Authorization` readback entry that begins with `REDACTED:` and has a nonempty opaque suffix (rejecting plaintext/`Bearer`/missing/malformed/multiple), never computing or assuming the digest encoding or a 64-hex length. Inspect exit `0` therefore proves schedule STRUCTURE + provider-side REDACTION, and states that exact route authentication is NOT yet proven; upsert still requires `CRON_SECRET`. The design decision was owner-approved after a documented stop-and-report: QStash's redaction howto and security doc do not specify the SHA-256 preimage/encoding/salting, so the exact digest is unreproducible without a live schedule (forbidden) — verifying "is redacted" rather than "is the exact secret" is the deterministic, non-weakening check, with exact route auth proven by the §8e scheduled-delivery test. **Runbook:** §8d flipped to ✅ COMPLETED (the E4 refreshes, dual audits, and all five 2021–2025 archive backfills are done — retained as historical evidence, NOT a step to repeat; drift is a stop condition); §8e rewritten to read-only VERIFY the completed prerequisites (stop on drift, no re-refresh/backfill), keep BOTH automation gates closed through activation, add the exact-authentication scheduled-delivery proof (one HTTP 200 paused/disabled result, zero provider calls, before opening gates), open the gates in order (enable dataset, then clear global pause LAST), fix the emergency-stop/rollback/rotation ordering (global pause → disable dataset → pause QStash → writer transition), and correct every operator command to `npm run manage:game-stats-schedule -- <action> --apply`. Boundaries held: `src/app/api/cron/game-stats/route.ts`, `vercel.json`, cadence, destination, method, schedule id, retry policy, and route authentication are unchanged; no live QStash probe or credential use during implementation.

### PLATFORM-086H3E4-SECOND-ROUND-CONFERENCE-COLLISION-REMEDIATION-v1

- Purpose: Correct the reproducible postseason identity collision that corrupted the 2024 TSC archive: substring alias matching read the `sec` inside "Second Round" as the SEC alias, the FCS second-round row `401729753` (UC Davis vs Illinois State) acquired the `sec-championship` identity, and the authoritative collection fieldwise-merged it with the genuine SEC Championship `401673469` (Texas vs Georgia) into an order-dependent hybrid (one game's provider id under the other's participants). A bounded dormant prerequisite: classification + canonical-collection corrections, regression tests, operator documentation — no H3E activation, no production-data operations.
- Status: **MERGED to `main` via PR #411 (merge commit `4e4535d`, 2026-07-25); Codex-review CLEAN across seven rounds. The post-merge refresh → dual-audit → backfill sequence (runbook §8d) has since been PERFORMED and verified clean (2026-07-26): the 2024 durable archive now holds the genuine Texas–Georgia game, 2021–2025 schedule caches carry corrected identities, and all five archives carry valid paired `gameStatSlate` snapshots.** Branch `platform/086h3e4-second-round-conference-collision-safety` from `main` @ `b4b7c19` (impl `b4dc496`; remediations `7d0f6ec`, `a2a12ac`, `39745f4`, `3f35cfc`, `353f213`, `413c716`). Review history: round 1 — no production findings, two test gaps + a comment nit remediated; the owner withheld approval over a documented three-way input-order dependency and mandated full permutation invariance; rounds 3–6 progressively eliminated every statically-demonstrable order dependency (deferred two-phase resolution; distinct numeric provider ids never merge; provider-id-preserving merges; safe-integer id parsing; fixed-fulls-set fragment routing with fail-closed ambiguity; byte-total content ordering; arrival-independent cross-group base-key ownership) with counter-example regressions at each step; round 6 verified the production implementation with one vacuous-test finding; round 7 **CLEAN**. Gates: `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 2116/2116; only the five intended files changed (3 production, 2 test); `src/lib/teamIdentity.ts` untouched; no provider game id special-cased (test-enforced source scan).
- Notes: The three corrections: (1) `matchConferenceChampionshipSlotByText` matches aliases as complete normalized tokens/phrases (space-padded includes; first-match slot order unchanged); (2) explicit non-FBS classification (fcs/ii/iii) suppresses FBS conference-championship inference exactly as it suppresses CFP inference (`!explicitNonFbs` on `isConferenceChampionship`); (3) `buildAuthoritativeGameCollection` resolves each merge-key group in two deferred, content-deterministic phases — fully resolved games first (distinct numeric ids never merge; same-id duplicates merge as before), fragments attach by content affinity against the fixed fulls-only set (exact-id affinity → sole-compatible → fail-closed standalone), a numeric provider id always survives a merge, and key ownership is assigned by byte-total content order across all groups. Regression evidence: the confirmed pair end-to-end in both input orders; all-orderings (6-way and 24-way) collection permutation tests; a byte-distinct-Unicode fold regression proven to discriminate; the downstream archive test proving stale colliding caches yield the genuine Texas–Georgia game (19–22, correct ownership, correct E1 snapshot pairing). Relationship to E3: this fix must be merged and deployed BEFORE the PLATFORM-086H3E3 operator sequence's audit/backfill steps run — those audits fail on the 2024 mismatch until the refreshed schedules carry the corrected identities. **Post-merge operator sequence (`docs/deployment-runbook.md` §8d) — ✅ PERFORMED and verified clean 2026-07-26: deployed this correction while writer control remained `legacy` and refresh automation stayed disabled → forced full-year schedule refreshes 2021–2025 → verify no "Second Round" row classifies `sec-championship`, `401673469` is Texas-home/Georgia-away with the genuine identity, `401729753` remains the non-FBS game and not activation-eligible, and no unrelated churn occurred → rerun `PLATFORM-086H3E-2024-ARCHIVE-PARTICIPANT-COLLISION-AUDIT-v1` → rerun the complete H3E participant/parity audit → only then the archive backfills. `401506450` remains the sole accepted analytics-incomplete parity exclusion.**

### PLATFORM-086H3E2-DORMANT-REFRESH-POLLING-PREREQUISITE-v1

- Purpose: Second prerequisite slice of the approved PLATFORM-086H3E activation decomposition: the pure, dormant policy primitives E3's final atomic wiring will consume — (1) the ONE typed refresh-outcome interpreter over the complete C2/H2 matrix, (2) the schedule/evidence polling-target derivation for the approved 15-minute cadence, and (3) the CFBD quota-reserve policy. Pure and unwired: no routes, cron, provider status, diagnostics, analytics consumers, or `vercel.json` change; no I/O, injected clocks only; no provider or production access. The three modules are pure additions guarded as dormant homes; the only change to a pre-existing file is behavior-preserving and inside the dormant boundary — `publicProjection.ts` exports its envelope validator as `validateGameStatsEnvelope` (rename of the internal function, no logic change) so the polling selector reuses the ONE envelope policy.
- Status: **MERGED to `main` via PR #409 (merge commit `d04f3b3`, 2026-07-25); Codex-review CLEAN across five rounds (round 1: two should-fix — invalid-clock NaN fall-through to eligible, missing bare-symbol self-tests — remediated; round 2 clean; final full-diff review: three should-fix — unvalidated durable records in the polling selector, one writer-fence matrix sentence, one stale E1 cross-reference — remediated; round 4 code-clean with one doc-wording remediation; round 5 clean). Nothing activated; production remains in `legacy`; E3 remains unwritten.** Branch `platform/086h3e2-dormant-refresh-polling-prerequisite` from `main` @ `f412382` (impl `17323a0` + tests `6534d6c` + remediations `9a1adb7`, `0de9629`). Gates: `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 2095/2095; production build OK. Semantic comparison holds by construction: `git diff --name-status main -- src/` shows only the three added dormant modules, the behavior-preserving validator export/rename inside the dormant `publicProjection.ts`, and the guard test — no live surface consumes any of them, so every served surface is byte-identical to `main`.
- Notes: `refreshOutcome.ts` — `interpretGameStatsRefreshOutcome` classifies a `GameStatsIngestionResult` (H2's `DurableMergeResult` nested unchanged) into 13 stable reasons per the locked matrix: empty response and clean unchanged/stale → `no-op` (no last-success advance); rejections and mixed unchanged/stale → failure 502 (prior-good preserved); written+clean → success and written+mixed / partially-merged → partial (only these confirmed commits set `advanceLastSuccess`); conflict → 409; unavailable → known-unchanged 503; indeterminate → 503 with durability UNKNOWN (reread required, no same-run retry); `knownUnchanged` and `durabilityUnknown` are mutually exclusive everywhere. `pollingTarget.ts` — deliberately NOT score-gated (scores have no automation until 086B): a game polls while addressable, stat-applicable, kickoff-aged `[3h, 24h)` (entry inclusive, exit exclusive), and its evidence is not `satisfied` per the shared evidence authority (no second policy); candidates order by earliest UNRESOLVED eligible kickoff, then regular before postseason, then lower provider week; the selector returns AT MOST one target; unprovable kickoffs and invalid clocks poll nothing (quota fail-safe); two-phase API so the caller reads committed records cache-only between listing and selection, and the selector validates each RAW read through the shared `validateGameStatsEnvelope` authority (newly exported from the dormant public projection — no second envelope policy): malformed, partition-mismatched, or invalid-timestamp durable context resolves nothing and can never suppress a poll. `quotaPolicy.ts` — automation requires trustworthy finite provider-reported usage ≥ 1,002 remaining (1,000-call reserve + 2-call margin covering the usage check possibly spending a call plus the fetch); missing → `usage-unavailable`, malformed/inconsistent → `usage-untrustworthy`, both fail closed and are never fabricated in either direction; the manual gate refuses 429 on any refusal reason unless the second explicit `quotaOverride=1` parameter is supplied, and overrides carry their exact reason/remaining truthfully. Attempt bookkeeping (one scoped attempt after target resolution, before credential/usage checks; quota refusal resolves it once as a truthful failure) is E3's wiring contract, documented at the seam. The dormant-boundary guard adds all three modules and their six entry-point symbols with flagged-import and bare-symbol self-tests; the E1 allowlist is untouched. E3 (final atomic wiring) remains unimplemented.

### PLATFORM-086H3E1-PAIRED-ANALYTICS-PROVENANCE-v1

- Purpose: First prerequisite slice of the approved PLATFORM-086H3E activation decomposition (E1 → E2 → E3): give future archived-analytics reads a paired, archive-owned provenance by (1) adding `deriveCanonicalGameStatsSlateFromBuild` — canonical game-stat slate derivation from the EXACT `buildScheduleFromApi` build (its unmodified games plus the exact wire rows), so a league-scoped build's aliases, manual postseason overrides, and attachment keys are inherited instead of rebuilt league-agnostically — and (2) persisting a minimal, strict, versioned `gameStatSlate` snapshot on newly built/backfilled `SeasonArchive`s, derived from the same build that produced `archive.games` and paired ONLY with that archive's own `scoresByKey`. Additive and non-activating: no live consumer lifecycle, no writer, no provider access, no behavior change beyond the new archive field.
- Status: **MERGED to `main` via PR #408 (merge commit `a4dd9d5`, 2026-07-24); Codex-review CLEAN (six rounds + clean final full-diff review). Nothing activated; production remains in `legacy`; E2/E3 were unwritten as of this merge (current status: their own ledger entries).** Branch `platform/086h3e1-paired-analytics-provenance` from `main` @ `ef4133e` (impl `6c50884`/`aa309fa`/`c1143af`/`df94dfb`; remediation rounds `c5e9a53`, `1441ed9`, `c06b8d4`, `a847493`, `4ebb068`). Review history: round 1 — one blocker (a manual override rewriting `providerGameId` let slate derivation silently mis-associate wire metadata: season type defaulted to `regular`, participant ids nulled — now FAILS CLOSED with "no associated schedule wire row") plus three should-fix (launderable guard allowlist; present-`null` snapshot classified as absence; missing archive-level coverage); rounds 2–5 progressively hardened the dormant-boundary allowlist (positional + form-strict sanctioned import; comment/string-masked statement boundaries; template-literal, comment-separated, and escape-decoded specifiers; single-pass escape decoding with line-continuation semantics) and added snapshot build-time self-validation; round 6 **CLEAN — no findings**. Gates: `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 2055/2055; production build OK. Local isolated semantic comparison (two detached worktrees at baseline vs head, identical seeded file-fallback app-state, no network): `buildSeasonArchive` output byte-identical to `main` on every pre-existing surface — the sole delta is the additive `gameStatSlate` block.
- Notes: Snapshot schema is a minimal strict allowlist (`snapshotVersion: 1`; per game: `providerGameId`, attachment `key`, `providerWeek`, `seasonType`, name-resolved participants, numeric `homeId`/`awayId`) — never a serialized runtime `CanonicalGame`; non-stat-applicable (placeholder/disrupted) games are not persisted; content is independent of the build instant; the builder self-verifies through the strict parser, so an unvalidated override (blank key, invalid week) fails the archive build instead of persisting a snapshot the reader would reject. Parser distinguishes `absent` (pre-E1 archive, field missing) from `malformed` (anything else, including present `null` and `expectedYear` mismatch); E3 consumers fail closed on both with distinct reasons — the established preview/confirm backfill is the only repair. The recursive dormant-boundary guard gains its single exact production crossing (`slateSnapshot.ts` → `canonicalSlate`, derive entry only), positional and form-strict, with laundering self-tests (re-exports, renamed/namespace imports, dynamic/template/escaped specifiers, value aliasing) and a documented honest static scope. **Operator ordering: full-year schedule refreshes (2021–2025 + activation season) → participant/parity audit → preview/confirm archive backfills — all ✅ DONE (§8d, 2026-07-26); E3 activation (§8e) remains pending** — backfilling before the refreshes would bake null participant ids into snapshots. E2 (dormant refresh-outcome/polling/quota primitives) and E3 (final atomic wiring) were unimplemented as of this merge — see their own ledger entries for current status.

### PLATFORM-086H3C5-DORMANT-NUMERIC-PARTICIPANT-VALIDATION-v1

- Status: **MERGED to `main` via PR #407 (merge commit `a0cfff0`, 2026-07-24); Codex review of the code/test diff clean on the FIRST pass, one approved-scope-exception P2 remediation on the full-diff review (schedule-eligibility diagnostic id passthrough, `2d27eed`), final complete code+tests+docs re-review clean.** Branch `platform/086h3c5-numeric-participant-validation` from `main` @ `b301774` (impl `d95de9e` + docs closeout `a90bd8b` + remediation `2d27eed`); local + remote branches deleted. Gates: focused schedule suites 82/82 and dormant game-stats suites 179/179 (dormant-boundary guard UNMODIFIED and green); `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 2030/2030; `npm run build` clean. Local-only runtime probes (file store; no provider or production contact): an old-shaped seeded schedule cache serves with NO fabricated ids, a new-shaped cache serves ids verbatim, and all seven schedule/game-stats probes are **byte-identical to `main`**.
- Purpose: Resolve the PLATFORM-086H3C1 numeric participant-validation deferral before PLATFORM-086H3E activation: persist CFBD numeric schedule participant ids and make the existing dormant evidence authority validate stored `schoolId` values against schedule-owned home/away participants. No H3E activation, live game-stats wiring, provider access, production access, writer transition, polling, recovery, diagnostics, migration, or identity-system redesign.
- Result: (1) **Schedule persistence (additive, shared-mapper only):** `CfbdScheduleGame` recognizes `homeId`/`awayId` in camel and snake casings; `mapCfbdScheduleGame` normalizes each to a positive safe integer or explicit `null` (strict grammar — zero, negatives, fractions, exponent/hex/signed forms, unsafe integers, blanks, and coercive forms all normalize to `null`; an invalid id never drops the row); `ScheduleItem` owns explicit nullable ids; `ScheduleWireItem` gains OPTIONAL compatibility fields (pre-C5 durable records legitimately lack both; reads never fabricate or write back). All three durable write paths (`/api/schedule` incl. week-children, admin historical cache, season-transition cron) persist the shared mapper output unchanged — none reconstructs an item. A refreshed `/api/schedule` response exposes the additive fields (the only live wire-shape change); cache hits over old rows serve byte-identically. (2) **Canonical slate:** `CanonicalGame` carries nullable `homeId`/`awayId` copied from the uniquely associated wire row and revalidated (positive safe integer only — no second normalization authority); `ParticipantSlot.teamId` remains the resolver-produced canonical string and `teamIdentity.ts` is untouched. (3) **Evidence authority (dormant):** new fail-closed states `participant-validation-unavailable` and `identity-mismatch` plus a typed `participantValidation` outcome on `EvidenceDecision` (`verified` / `schedule-ids-unavailable` / `stored-ids-unavailable` / `mismatch` — deliberately no broad `unverified`). Ordering: id+partition association → schema blockers (before any participant interpretation) → EXACT ORIENTED numeric validation (a reversal is a mismatch; neutral-site changes nothing; names/aliases/conferences never consulted) → rank VERIFIED candidates only through the existing sufficiency/fence/equivalence rules. A mismatched or unverifiable candidate of ANY sufficiency never displaces a verified sibling; with no verified candidate, a known contradiction wins `identity-mismatch`, otherwise the typed unavailable reason; valid schedule ids with no candidate rows stay plain `absent`. (4) **Projections:** `PublicAvailability` adds aggregate `participantValidationUnavailable` / `identityMismatch` counts; neither class publishes a public row or enters analytics (only verified `satisfied` evidence passes `projectAnalyticsPartition`'s existing final-score + `toAnalyticsGameStats` gate); coverage keeps the existing coarse partition vocabulary (validation-gap-only partitions stay coarse `absent`; mixed verified + gap is `partial`). Tests: +34 across cfbdSchedule / canonicalSlate / evidenceAuthority / partitionCoverage / publicProjection, including the full §5.3 matrix; ONE C1-era test asserting the superseded "id-associated row satisfies regardless of participants" deferral was rewritten to the fail-closed truth.
- Notes: No provider, production API, database, or durable data was contacted or modified. C1–C5 and H2 remain dormant (recursive dormant-boundary guard unmodified and green); production stays on the fenced legacy writer with writer control in `legacy`; H3E final activation remains unwritten. **Post-merge rollout prerequisite (`docs/ai/game-stats-writer-fence.md` §4/§6) — ✅ DONE 2026-07-26 (via §8d):** the full-year `bypassCache=1` schedule refresh for EVERY season H3E will consume (2021–2025 + the activation-scope current season) so canonical games carry numeric participant ids; verify per year (refresh success, cache-only reread, positive ids on every addressable stat-producing game), then run the established read-only participant-validation/parity audit — zero `participant-validation-unavailable` for activation-eligible games, zero unexpected `identity-mismatch`, and the accepted 2022 `401506450` exclusion as the sole parity residual. Old caches fail CLOSED (validation-unavailable, never mismatch) until refreshed; if any year has missing ids or contradictions, STOP activation — never infer ids or mutate data as a workaround. The accepted `401506450` decision and the `manual-only` rename terminology debt are unchanged by this PR.

### PLATFORM-086-SCHEDULE-NON-FBS-POSTSEASON-CLASSIFICATION-SAFETY-IMPLEMENTATION-v1

- Status: **MERGED to `main` via PR #406 (merge commit `a015348`, 2026-07-24); Codex-review clean on the first pass (and on the final full-diff review) and `/verify`-verified. The post-merge 2024/2025 schedule refreshes and the PLATFORM-086H3E parity-audit rerun were PERFORMED 2026-07-24 — **parity confirmed** (2021/2023/2024/2025 exact; 2022's sole residual is the accepted game `401506450`); the executed record is preserved HERE (rehomed by DOCS-012; procedure in `docs/deployment-runbook.md` §8c).** Branch `platform/086-schedule-non-fbs-postseason-classification-safety` from `main` @ `e25cca7` (impl `535f54e` + docs closeout `13cb93f`). Codex review of the code/tests diff returned a **clean pass — no actionable findings** ("the classification guard correctly prevents explicit non-FBS postseason rows from receiving CFP identities while preserving existing FBS and missing-classification behavior"); a final review of the complete code+tests+docs diff gates the PR. `/verify` (local only, no production contact): the served `/api/schedule` surface is **byte-identical to `main`** against an identical seeded 2024 cache carrying the defective rows (cache-hit 200 serving cached items verbatim, `year=abc`/`year=1999` → 400, cache miss → 503) — the correction changes normalization at REFRESH time only; the intended identity change is proven by regressions that fail 9/9 against pre-fix logic. Gates: focused cfbdSchedule / schedulePostseasonClassification / postseason-classify-normalized / schedule-eligibility / schedule-route suites 101/101; `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 1994/1994.
- Purpose: Correct the schedule-normalization defect that assigns CFP event identities to explicitly non-FBS postseason games. Generic wording ("semifinal") on FCS and Division III championship rows minted the SHARED `cfp-semifinal` event key: the 2024 partition's four such rows (FCS `401729786`/`401729787`, D-III `401738295`/`401738307`) collapsed into one canonical postseason slot, and the authoritative collection produced a HYBRID record — North Dakota State vs South Dakota State participants under the D-III provider id `401738295` — once the resynced team catalog made NDSU resolvable (found by the post-resync PLATFORM-086H3E parity rerun, which failed 2024 closed at alignment). The 2025 partition carries the same defect class (`401840097`/`401840096` D-III, `401833989`/`401833990` FCS). No identity, ownership, archive, ingestion, polling, quota, or H3E redesign.
- Result: One production file — `src/lib/schedule/cfbdSchedule.ts`. The previously discarded CFBD `homeClassification`/`awayClassification` fields (camel + snake case) are now read and normalized (trim + lowercase); `fcs`, `ii`, and `iii` are explicit negative evidence — when either participant carries one, text-based CFP inference is suppressed in BOTH text-inference branches of `deriveEventMetadata` (the normalized-postseason branch and the `seasonType === 'postseason'` fallback) and no `cfp-*`/`national-championship` key is minted; such rows keep the existing non-CFP row-specific key/fallback behavior. Missing classifications preserve the legacy text fallback; explicitly supplied normalized metadata and curated non-CFP event keys pass through verbatim; explicit `fbs/fbs` CFP semifinals, distinct bowl-specific keys, and the national championship are unchanged; eligibility is untouched (FBS-vs-FCS remains eligible; non-FBS-vs-non-FBS remains excluded by the existing centralized path); no provider game id is special-cased. The protected modules (`postseason-classify.ts`, `schedule.ts`, `schedulePostseasonHelpers.ts`, `scheduleTracking.ts`, `scheduleEligibility.ts`, `teamIdentity.ts`) are untouched. Tests (+14; fail-against-main proven): classification-field acceptance in both casings; FCS/D-II/D-III semifinal text cannot mint `cfp-*`; one non-FBS side suffices; value normalization; missing-classification legacy fallback; `fbs/fbs` CFP semifinal + distinct bowl-specific keys + `national-championship` retention; preserved explicit metadata; the guarded normalized branch; the 2025 fixture class; the two same-kickoff 2024 pairs receiving distinct non-CFP identities; and canonical collection keeping each row's participants aligned with its own provider id through the exported `buildScheduleFromApi` path (nothing carrying `providerGameId: "401738295"` may hold the FCS matchup's participants); FBS-vs-FCS eligibility green.
- Notes: No production API, database, or durable data was contacted or modified during implementation. **Post-merge activation is operational** (documented in `docs/deployment-runbook.md` §8c, NOT executed): forced full-year schedule refresh for 2024 AND 2025 via `/api/schedule?year=X&bypassCache=1` (never the Historical Data Cache button — `force: false` can return `alreadyCached` without replacing the defective snapshot), the per-year `jq` identity verifications, provider-status checks, a cache-only recheck, and then the required **PLATFORM-086H3E parity-audit rerun for 2024** with three recorded prerequisites (synced catalog `updatedAt`; 2024 refresh `meta.generatedAt`; schedule provider-status `lastSuccessAt`) — all PERFORMED 2026-07-24; the executed record (rehomed here by DOCS-012): forced full-year refreshes committed 2024 `meta.generatedAt` 2026-07-24T16:18:59.006Z (provider-status `lastSuccessAt` 2026-07-24T16:19:00.037Z; 3,801 rows) and 2025 `meta.generatedAt` 2026-07-24T16:22:14.071Z (`lastSuccessAt` 2026-07-24T16:22:14.955Z; 3,831 rows), with the per-year `jq` identity verifications, provider-status checks, and cache-only rechecks clean; then the **PLATFORM-086H3E-PRODUCTION-PARITY-RERUN-v1** parity-audit rerun (read-only, from clean `main` @ `36defc5`, production DB snapshot 2026-07-24T17:23:23Z, synced catalog `updatedAt` 2026-07-24T05:50:09.813Z): **parity confirmed** — 2021/2023/2024/2025 EXACT (canonical and archive game sets align perfectly — 918/921/931/945 games; contributing = projected per season), and 2022 differs ONLY by game `401506450`, now an accepted upstream CFBD data-quality limitation (analytics-incomplete provider row; backfill verified unable to repair it; exclusion intentional — see the canonical deferrals list in `docs/next-tasks.md`).

### PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY-IMPLEMENTATION-v1

- Status: **MERGED to `main` via PR #405 (merge commit `d5ee260`, 2026-07-24); twice Codex-remediated, third review clean; `/verify`-verified. The post-merge production catalog resync (catalog `updatedAt` 2026-07-24T05:50:09.813Z) and the PLATFORM-086H3E parity-audit rerun were PERFORMED 2026-07-24 — the executed parity record is preserved in the PR #406 entry below (`PLATFORM-086-SCHEDULE-NON-FBS-POSTSEASON-CLASSIFICATION-SAFETY-IMPLEMENTATION-v1`, rehomed by DOCS-012).** Branch `platform/086-team-catalog-derived-alias-safety` from `main` @ `c8705dd` (impl `47b34de` + read-time-override remediation `4d31b7c` + cache-identity remediation `d1d9218` + docs closeout `f7db872`). Review history: round 1 flagged P1 — a durable `team-database/current` synced pre-fix takes precedence over the regenerated bundled catalog, so the misattribution would persist until an operator resync; remediated by applying curated `alias-overrides.json` at durable-store READ time (`readStoreFile`, no write-back, resync remains canonical). Round 2 flagged P1 — warm `revalidate: false` standings/insights snapshots keyed only `SEED_ALIASES_HASH`, so cached pre-fix attribution survived deploy; remediated by folding new `ALIAS_OVERRIDES_HASH` (FNV-1a over the curated override policy) into `canonicalStandingsCacheKeyParts` + `insightsCacheKeyParts`. Round 3: **clean pass — no actionable regressions**. `/verify` (local file store only, no production contact): game-stats HTTP surface **byte-identical to `main`**; `/api/teams` on the branch serves the corrected aliases from the bundled fallback AND serves a seeded PRE-FIX durable catalog sanitized at read time while the stored record is proven byte-untouched. Gates: focused suites green (incl. cache-key suites); `tsc` / `lint:all` / `git diff --check` clean; full `npm test` 1980/1980.
- Purpose: Correct the generated team-identity collision that mapped CFBD's bare `San Diego` label to San Diego State — crediting University of San Diego statistics to SDSU owners (Shambaugh 2022 / Pruitt 2023 / Ciprys 2024 / Maleski 2025 per the PLATFORM-086H3E production parity audit) — while preserving legitimate curated shorthand and production sync behavior. No resolver, ownership-schema, draft, archive, CSV, ingestion, or H3E redesign; `src/lib/teamIdentity.ts` untouched.
- Result: (1) Both alias generators (`buildDerivedAlts` in `scripts/fetch-cfbd-teams.ts`; `buildDerivedTeamAliases` in `src/lib/teamDatabase.ts`) now emit the compact tokens-first join ONLY when the two tokens are the whole variant (`tokens.length === 2`); three-token compaction preserved. (2) `src/data/alias-overrides.json`: San Diego State gains `{add: ["sdsu"], remove: ["sandiego"]}` (exact compact removal key) plus three PRESERVATION entries (`la tech` → Louisiana Tech, `miami (fl)` → Miami, `louisiana monroe` → UL Monroe) keeping previously-shipped legitimate shorthand the current generator no longer derives, so the committed catalog stays reproducible via `npm run fetch:teams`. (3) `src/data/teams.json` regenerated through the supported workflow (read-only CFBD call) and reconciled to an alias-focused diff — 19 schools lose exactly the unsafe two-token-prefix class (`sandiego`, `newmexico`, `sanjose`, `texasa` + 15 junk mascot prefixes such as `dukeblue`); SDSU gains `sdsu`; the generator's optional `displayName`/`shortDisplayName`/`abbreviation` output fields were stripped from the committed file (all-catalog metadata expansion excluded and reported); no team/mascot/conference/order churn. (4) Read-time override application (`mergeAliasOverrides`, exported) in `teamDatabaseStore.readStoreFile` sanitizes served items from a stale pre-fix durable snapshot without rewriting it. (5) `ALIAS_OVERRIDES_HASH` folded into the standings + insights cache identities so this deploy — and every future curated-override change — automatically misses pre-override snapshots. Tests: derived-alias truncation guards, override application, checked-in catalog invariants, real-catalog identity resolution (bare `San Diego` unresolved / distinct non-ownable `sandiego` when observed; `San Diego State`+`SDSU` → `sandiegostate`; `San Jose` → `sanjosestate`; isolated NMSU cannot claim bare `New Mexico`), stored bare-`San Diego` row NOT credited to the SDSU owner (aggregation code unchanged) with an SDSU control row still credited, mocked-CFBD durable sync persisting corrected alts with standings invalidation unchanged, stale-durable-catalog read-time sanitization without write-back, and exact cache-key coverage of both hashes.
- Notes: No production data was contacted or mutated during implementation (regeneration was one read-only CFBD `/teams/fbs` call). **Post-merge activation is operational** (documented in `docs/deployment-runbook.md` §8b, NOT executed): admin team-database resync → `/api/teams` alias verification → resolver-diagnostic checks → **rerun the PLATFORM-086H3E production parity audit** with the synced catalog's `updatedAt` as prerequisite; both PERFORMED 2026-07-24 (the executed parity record is preserved in the PR #406 entry below — rehomed by DOCS-012). Separate follow-up debt (explicitly out of scope): canonical ownership IDs for current-season draft ownership (identity-audit recommendation). The single 2022 Akron@Buffalo `stats-manual-only` parity difference that remains after this fix was later traced and accepted as an upstream CFBD data-quality limitation (see `docs/next-tasks.md` → "Unresolved decisions & known deferrals").

### PLATFORM-086H3C4-DORMANT-ANALYTICS-READINESS-CORRECTION-v1

- Status: **MERGED to `main` via PR #404 (merge commit `aa91391`, 2026-07-22); Codex-review clean after one P2 remediation and `/verify`-verified; dormant.** Branch `platform/086h3c4-dormant-analytics-readiness-correction` from `main` @ `7ffca8d` (impl `3b79aac` + P2 remediation `efc1449` + docs closeout `b5bd112`; 3 code/test files, +393/−75 vs `main`). First background Codex review (branch diff vs `main`) flagged one P2 — the new direct durable-record parameter bypassed the module's envelope validation, so a matching-identity-but-malformed committed record could publish analytics from a corrupt envelope or throw in row grouping; remediated in `efc1449` by routing every non-null committed record through the existing `validateEnvelope` authority (the same one the public path uses — no second schema policy) and failing closed to `[]` on ANY non-ok outcome BEFORE row grouping or evidence selection. The re-review returned a **clean pass — no actionable regressions** ("correctly decouples final-and-complete eligibility from the six-hour coverage threshold while preserving shared evidence selection and failing closed on invalid durable envelopes"). `/verify` on the game-stats HTTP surface passed **byte-identical to `main`** (same fixture seed on both servers; `diff -r` of every probe body + status matched: cache-hit 200, bad `week`/`year` 400, `bypassCache=1` without admin 401 BEFORE any fetch, `seasonType` coercion 200, cache miss 503, corrupt store 500 with restore-recovery 200) — the modules are dormant/unwired, so the projection is covered by its unit suite + the recursive dormant-boundary guard, not by HTTP. `tsc` / `lint:all` / `git diff --check` clean; focused C1–C4 + contract + dormancy suites 97/97; full `npm test` 1970/1970.
- Purpose: Correct the dormant canonical analytics path so final-and-complete eligibility is INDEPENDENT of C1's six-hour missing-data/recovery threshold (`EXPECTED_KICKOFF_MIN_AGE_MS`), while preserving incremental in-progress ingestion and a future provisional live-stat path. C3's finality gate was correct but consumed recovery-filtered `PartitionCoverage.games` (expected games only), so a game finishing within six hours of kickoff was excluded even with a final score and complete stats. A small dormant read-model signature + evidence-selection correction with focused tests; no production wiring, no archive assembly, no consumers, no polling/routes/activation.
- Result: `projectAnalyticsPartition` (`src/lib/gameStats/publicProjection.ts`) now takes the required paired input `CanonicalAnalyticsReadInput = { slate, scoresByKey }` plus `(week, seasonType, committedRecord: WeeklyGameStats | null, seasonRelation)` — the old `(PartitionCoverage, scoresByKey)` signature is REMOVED with no overload or compatibility path. The projection considers every addressable, stat-producing canonical game in the partition — `expected` AND `pending` — so a final-and-complete game is analytics-eligible immediately after finality, without waiting six hours or for the rest of the weekly slate; placeholders and disrupted games remain excluded by partition selection. Gate order per game: (1) `classifyScorePackStatus(input.scoresByKey[game.key]) === 'final'` (`game.key` is the ONLY lookup key — never `eventId`/provider id/labels/rebuilt keys); (2) the shared `selectGameEvidence` authority over the committed record's rows; (3) `satisfied` + selected + strict `toAnalyticsGameStats`. **Malformed committed envelopes fail closed** (P2 remediation): every non-null record runs through the module's single `validateEnvelope` authority — malformed envelope fields, partition mismatch, invalid/missing `fetchedAt`, and non-array/missing `games` all yield `[]`, never a throw and never analytics from a corrupt envelope; `null` strictly means caller-established absence (a read failure must never be converted to `null`). The function is PURE (no store reads, no provider, no schedule/archive loads, no mutation) and reuses C1's association (`groupRowsById`, now exported from `partitionCoverage.ts` as the one shared helper), evidence selection, duplicate authority, and strict analytics projection — no second envelope/selection/completeness policy. **In-progress complete evidence is preserved**: it remains durable, merged, and selectable (a future provisional live-stat view can consume it) but is excluded from launch analytics until finality — finality is an ANALYTICS eligibility rule only, never an ingestion/persistence/merge/evidence-selection requirement. C1's applicability classification, `evaluatePartitionCoverage`, recovery gap states, diagnostics, and the public projection are UNCHANGED. Tests: the retained C3 matrix under the new signature plus regressions — sub-six-hour final+complete inclusion; the same game staying `pending`/`not-applicable` for C1 coverage; in-progress exclusion WITHOUT mutating committed evidence (and inclusion from the same record once final); final+sparse/absent/conflicting/blocked exclusions; one final game included while slate-mates are scheduled/in-progress; live-shaped vs archive-shaped key namespaces behaving identically with CROSS-pairing failing closed; shared-`eventId` distinct-key disambiguation; null-record and matching-but-malformed-envelope fail-closed matrices; compile-time rejection (`@ts-expect-error`) of the old signature and an omitted committed record.
- Notes: Dormant/unwired — the recursive dormant-boundary guard passes unchanged (module already excluded, symbol already forbidden; no guard edit needed) and no production consumer, route, cron, or reader is touched. **Required E follow-up (recorded, NOT implemented):** live and archived callers MUST supply key-aligned slate and score inputs from the SAME provenance — a live season pairs the canonical build's game keys with the reconciled scores attached under those same keys; an archived season pairs `archive.games` with that archive's own `scoresByKey` — and must never mix a live-rebuilt slate with an archived score map (cross-pairing fails closed to silently-empty analytics by design, so E's assembly code is where a mixed pairing must be prevented). The earlier C3 E follow-ups (final-gated projection as the analytics source; operator/admin-only `/api/game-stats` reads) and the temporary in-progress-refresh constraint remain in force. The `completed-work.md` milestone + the MERGED status flip are the post-merge step.

### PLATFORM-086H3D-DORMANT-WRITER-CONTROL-ROLLOUT-SAFETY-v1

- Status: **MERGED to `main` via PR #403 (merge commit `ddc356e`, 2026-07-22); Codex-review clean and `/verify`-verified; dormant.** Branch `platform/086h3d-dormant-writer-control-rollout-safety` from `main` @ `b3a043c` (impl commit `8008af4` + docs closeout `881325b`; 13 code/test/doc files, +1685/−38 vs `main`). Background Codex review (branch diff vs `main`) returned a **clean pass — no actionable findings** ("the transition authority, operator CLI, and active-only merge authorization consistently enforce the documented state graph and transactional serialization barriers without affecting current production behavior"). `/verify` on the game-stats HTTP surface passed **byte-identical to `main`**: the same fixture-built seed (legacy weekly partition + the initial `legacy` writer-control record) on both servers, and `diff -r` of every probe body + status matched exactly (cache-hit → 200; `week=abc` / `year=1999` → 400; `bypassCache=1` without admin → 401 BEFORE any fetch; `seasonType=banana` coerced to `regular` → 200; cache miss → 503; corrupt store → 500 with immediate restore-recovery to 200). `tsc` / `lint:all` / `git diff --check` clean; focused writer-control / transition / H2 / C2 / transaction / barrier / dormancy suites green; full `npm test` 1962/1962. **Production remains in `legacy`; no transition has ever been executed; deploying D performs no transition; E retains sole ownership of activation.**
- Purpose: Complete the PLATFORM-086H3B writer-control fence into a full — but dormant — rollout mechanism per the approved read-only audit: ONE strict transition authority over the existing `game-stats-writer-control/state` record, an operator CLI, and an in-transaction `active`-only permission check for H2, plus deterministic serialization-barrier proofs and the documented (NOT executed) activation runbook. Explicitly excluded and untouched: polling/cadence/cron/targeting; routes or public/admin HTTP surfaces; readers/projections/Insights/history/career analytics; provider fetching/normalization/retries/refresh status; recovery/repair/leases/claims/backoff/quota policy; additional control records, feature flags, locks, lineage, ledgers, or revisions; production activation.
- Result: (1) `src/lib/gameStats/writerControlTransition.ts` — `transitionWriterControl({expected, to, apply})`, one atomic operation in one transaction rooted (advisory-locked) on the control key: presence-aware reread → strict parse → expected-state check → edge validation → conditional write of ONLY the exact `{recordVersion, state}` shape. The graph is closed and directional (`legacy ⇄ armed → active ⇄ read-only-safe`); absent/malformed control, expected-state mismatch (reports the actual state), same-state requests, every unlisted edge, and — by construction — every return to `legacy` after activation all refuse without writing. Typed outcomes: `transitioned` (confirmed COMMIT only), `would-transition` (dry run — NOT a reservation), the four refusals, `store-unavailable` (known-unchanged), and `store-indeterminate` (mutation SQL submitted, commit unconfirmed — EITHER state may be durable; the operator must reread, never retry/repair/infer). (2) `scripts/transition-game-stats-writer-control.ts` (`npm run transition:writer-control`) — explicit `--from`/`--to` required, READ-ONLY dry run by default, `--apply` only against a writable PostgreSQL store, resolved storage mode reported, unexpected errors redacted (`TRANSITION_WRITER_CONTROL_DEBUG=1` for detail), stable exits (0 success/valid dry run; 2 refused incl. invalid arguments; 3 store unavailable / not writable PostgreSQL; 4 indeterminate durability with an explicit reread instruction; 1 unexpected). The one-shot initializer is untouched and remains create-if-absent `legacy` only — tests prove it still cannot transition. (3) H2 active-only permission (`durableMerge.ts`): EVERY `mergeGameStatsPartitionDurable` invocation — including batches that would be unchanged, stale, conflicting, or entirely non-persistable — takes the control key EXCLUSIVE via `lockKey` under the partition primary lock (canonical `game-stats partition → game-stats-writer-control/state` order preserved), rereads and strictly parses the record UNDER both locks, and merges ONLY when exactly `active`; otherwise it refuses BEFORE the partition read, merge computation, or any write with new typed known-unchanged `unavailable` reasons (`control-lock-unavailable` / `control-read-failed` / `control-absent` / `control-malformed` / `control-not-active` + a `controlState` field on not-active); all pre-existing H2 outcomes (`written`/`partially-merged`/`unchanged`/`stale`/`conflict`/`unavailable`/`indeterminate`) are preserved after authorization; lock-order violations still throw loudly. Tests (+38, full suite 1962): the complete 16-pair transition-graph sweep, concurrency (same expected state — exactly one commits, the loser rereads a truthful mismatch), dry-run-never-writes (write seam armed), initializer incapability, store-failure truthfulness (lock/read/file-commit → `store-unavailable`; fake-pg lost COMMIT → `store-indeterminate`), CLI parsing/exit codes, the H2 authorization matrix, and BOTH serialization barriers proven deterministically on BOTH backends — gated fake-pg with the REAL writers parked at their write statements (a legacy write holding control completes before `legacy → armed`; an H2 write holding control completes before `active → read-only-safe`; the next writer rereads the new state and refuses) plus file-fallback held critical sections reproducing the writers' exact lock shape, the completed-stop-defeats-stale-`active`-observation proof, and reverse lock-order rejection. Dormancy: the recursive guard is EXTENDED, not weakened — `writerControlTransition.ts` joins `EXCLUDED_FILES`/`DORMANT_MODULE_BASENAMES`, `transitionWriterControl`/`isAllowedWriterControlTransition` join `FORBIDDEN_SYMBOLS`, and `writerFence.ts` is explicitly asserted as still SCANNED; existing H2/C2 tests seed `active` via the extended `writerControlSeed.ts` (live-path tests still seed `legacy`).
- Notes: One deliberate concurrency consequence: H2 merges of DIFFERENT partitions now serialize briefly on the single control lock (held to COMMIT) — the same brief global serialization the fenced legacy writer already accepts (immaterial at current cadence; recorded in the updated `unrelated partitions serialize briefly on the control lock` transaction test). The activation runbook lives in `docs/ai/game-stats-writer-fence.md` §6 (10 steps: confirm valid `legacy` → confirm fenced writer deployed → deploy D with no transition → dry-run then apply `legacy → armed` during E and drain → deploy/verify E in `armed` → rollback path `armed → legacy` ONLY before activation succeeds → `armed → active` → never back to `legacy` → stop/resume via `active ⇄ read-only-safe`); reader smoke tests, controlled refreshes, and production transition execution remain E responsibilities, and bounded recovery (claims/leases/backoff/quota) is deferred future work that is NOT part of D (doc §4 updated). The `completed-work.md` milestone + the MERGED status flip are the post-merge step.

### PLATFORM-086H3C3-DORMANT-ANALYTICS-FINALITY-GATE-v1

- Status: **MERGED to `main` via PR #402 (merge commit `c41121b`, 2026-07-22); twice Codex-review clean and `/verify`-verified.** Branch `platform/086h3c3-dormant-analytics-finality-gate` from `main` @ `a0c2cd2` (`300ae79` feat + `c920d26` attachment-key fix + `ef4e758` docs closeout; 4 code/fixture/test files, +246/−27 vs `main` — the two dormant C1 modules plus fixtures/tests). Two background Codex reviews (branch diff vs `main`): the first flagged one P2 (score lookup keyed by `eventId` instead of the disambiguated `AppGame.key`); remediated in `c920d26`; the re-review returned a **clean pass — no new issues**. `/verify` on the game-stats HTTP surface passed unchanged from `main` (bad `week`/`year` → 400; `bypassCache=1` without admin → 401 BEFORE any fetch; `seasonType=banana` coerced to `regular`; seeded partition → 200 `meta.cache=hit`; corrupt store → 500 with immediate restore-recovery) — the modules are dormant/unwired, so the surface is byte-identical and the gate itself is covered by its unit suite + the dormant-boundary guard, not by HTTP. `tsc` / `lint:all` / `git diff --check` clean; publicProjection suite 21/21; coverage 13, dormancy 7, status-classification 6, evidence 19, slate 12; full `npm test` 1924/1924.
- Purpose: Make C1's dormant analytics projection require canonical FINAL-score evidence IN ADDITION to complete game-stat evidence, per the approved read-only audit — not a reader redesign, and not reopening the product decision. Score reconciliation, attachment, fetching, normalization, caching, and provider access all remain outside this task.
- Result: `projectAnalyticsPartition(coverage, scoresByKey)` in `src/lib/gameStats/publicProjection.ts` gains a REQUIRED `scoresByKey` map keyed by the canonical `AppGame.key` (the attachment key). Per canonical game, in order: (1) read `scoresByKey[game.key]`; (2) require `classifyScorePackStatus(score) === 'final'` (the shared status classifier — separator/case variants bucket consistently; a missing key classifies as `scheduled`, so absence excludes without a special case); (3) then the existing C1 requirements — decision `satisfied`, a selected row, and `toAnalyticsGameStats` acceptance. A game is excluded when its score is missing / scheduled / in-progress / disrupted / ambiguous / unavailable, OR when its game-stat evidence is sparse / conflicting / blocked; no raw schedule status (including the canonical game's own `rawStatus`) substitutes for a final score. The map stays required — no optional/default/empty map, no complete-only compatibility path, no raw-status matching. **Attachment-key remediation (`c920d26`):** the gate originally keyed by `eventId`, which key disambiguation (`buildAuthoritativeGameCollection`) can intentionally diverge from `AppGame.key` (the key scores attach under), so `CanonicalGame` now carries `key` (from `AppGame.key`, populated in `buildCanonicalGameStatsSlate`; `eventId` retained for reporting only) and the gate reads `scoresByKey[game.key]`. Tests: the fixture defaults `key`/`eventId` to DISTINCT values so every finality test exercises `key ≠ eventId`, plus the approved finality×completeness matrix, separator/case status-variant consistency, a "no raw schedule status confers eligibility" case, the mandatory-argument proof (`@ts-expect-error` + runtime guard), a shared-`eventId`/distinct-key disambiguation regression, and the unchanged public projection.
- Notes: No production wiring or behavior change — public game-stats projection, public response/availability types, coverage/completeness rules, durable ingestion/merge, and existing live analytics consumers are unchanged and dormant; the recursive dormant-boundary guard already forbids `projectAnalyticsPartition` and passes unchanged (no guard edit needed). **Required E follow-ups (recorded, NOT implemented):** (1) Insights / owner / season / history / career analytics must consume this final-gated projection instead of raw cached game-stat partitions; (2) `/api/game-stats` must become operator/admin-only before H2 v2 rows can be exposed. **Temporary operational constraint until E lands:** avoid authorized manual game-stat refreshes while games are in progress when those cached rows could affect Insights. The `completed-work.md` milestone + the MERGED status flip are the post-merge step.

### PLATFORM-086H3C2-DORMANT-SAFE-INGESTION-COORDINATION-v1

- Status: **MERGED to `main` via PR #401 (merge commit `61fe69c`, 2026-07-22); Codex-review clean and `/verify`-verified.** Branch `platform/086h3c2-dormant-safe-ingestion-coordination` from `main` @ `8a95222` (1 impl commit `ebcf2eb` + docs closeout `abd1251`; 3 files, +645/−4 vs `main` — the dormant adapter, its test suite, and the dormant-boundary guard extension). Background Codex review (branch diff vs `main`) returned a **clean pass — no actionable regressions** (the coordinator validates/classifies as documented, delegates parse + merge policy to H1/H2, and stays behind the dormant-boundary guard). `/verify` on the game-stats HTTP surface passed unchanged from `main` (bad `week`/`year` → 400; `bypassCache=1` without admin → 401 BEFORE any fetch; `seasonType=banana` coerced to `regular`; seeded partition → 200 `meta.cache=hit`; corrupt store → 500 with immediate restore-recovery) — the adapter is dormant/unwired, so the read/write surface is byte-identical and the adapter itself is covered by its unit suite + the dormant-boundary guard, not by HTTP. `tsc` / `lint:all` / `git diff --check` clean; ingestion-coordinator suite 16/16; dormancy + H1 + H2 51/51; full `npm test` 1913/1913.
- Purpose: The smallest dormant adapter connecting ONE already-fetched CFBD `/games/teams` response to H1 parsing (`contract.ts`) and H2 durable merge (`durableMerge.ts`) — the "C2" batch-coordination slice of the lineage-free **C** in `docs/ai/game-stats-writer-fence.md`. It owns ONLY batch coordination and duplicates no parse / merge / conflict / stale-data / completeness / persistence-filter / duplicate-selection policy. No CFBD fetch/credentials/retry/pacing/quota; no route or status-code mapping; no cron/cadence/targeting/arming/final-status; no provider-refresh record; no schedule association or whole-slate coverage; no reader/analytics/Insights surface; no writer-control check; no recovery/lease/backoff/repair. Binding plan: the approved C2 handoff (in-conversation).
- Result: `src/lib/gameStats/ingestionCoordinator.ts` — one export `ingestGameStatsPartitionResponse({ year, week, seasonType, fetchStartedAt, payload })` returning a discriminated result: `no-op` (`empty-response`, exact `[]`; H2 not called, no write/delete); `rejected` (`invalid-payload` = non-array top level; `no-persistable-observations` = nonempty array but no parsed observation passes H1's `isPersistableIncomingRow`; H2 not called, prior durable data untouched); `merge-result` (H2's complete `DurableMergeResult` VERBATIM — outcome never renamed/collapsed — plus batch diagnostics: raw/parsed/persistable/non-persistable counts, parse-failure counts grouped by H1's reason, `clean`|`mixed` row acceptance). EVERY successfully parsed observation — not only the persistable subset — is passed to H2, which filters non-persistable rows and reports `skippedNonPersistable`; `fetchStartedAt` is forwarded verbatim (the adapter never generates a later timestamp); unexpected H2 programming errors propagate. Dormancy: `dormant-boundary.test.ts` extended (adapter in `EXCLUDED_FILES`, `ingestionCoordinator` in `DORMANT_MODULE_BASENAMES`, `ingestGameStatsPartitionResponse` in `FORBIDDEN_SYMBOLS`, + 3 self-tests); not exported from any barrel. `__tests__/ingestionCoordinator.test.ts` (16) covers top-level validation, the persistence gate, mixed-batch diagnostics, H2-owned non-persistable filtering, incremental single-game writes, partial-response retention + omitted-category preservation, sparse-without-analytics-completeness, and verbatim pass-through of stale / conflict / partially-merged / unavailable (2 reasons) / indeterminate / idempotent.
- Notes: No production caller or behavior change — the legacy route and cron writer are byte-identical to `main`; the recursive dormant-boundary guard proves no live file imports or references the adapter. The locked launch policy (scores/status ≈3-min + game-stats 15-min polling; no live game-stat UI at launch; analytics eligibility = final score/status + complete game-stat evidence; a 1,000-call/mo CFBD reserve; never waiting for the whole weekly slate before accepting good incremental evidence) is binding for later PRs but NOT implemented here — polling, scheduler, route, reader, and production activation belong to E. GOTCHA (tests): H2 `indeterminate` needs the PostgreSQL `writeAttempted: true` path (lost COMMIT after a submitted write); the file store's atomic-rename commit failure is `writeAttempted: false` → `unavailable`, so the indeterminate pass-through test drives a minimal inline fake pg pool. The `completed-work.md` milestone + the MERGED status flip are the post-merge step.

### PLATFORM-086H3C1-CANONICAL-EVIDENCE-READ-MODEL-v1

- Status: **MERGED to `main` via PR #400 (merge commit `cf8c584`, 2026-07-22); `/verify`-verified and review-clean.** Branch `platform/086h3c1-canonical-evidence-read-model` from `main` @ `220cbe7` (10 impl commits + docs closeout `1900922`; 15 files, ~3.0k insertions vs `main`; merged HEAD `c48645c`). Final background Codex review (branch diff vs `main`) returned a **clean pass — no actionable findings**. `/verify` on the game-stats HTTP surface passed (bad `week`/`year` → 400 with field; `bypassCache=1` without admin → 401 BEFORE any fetch; `seasonType=banana` coerced to `regular`; seeded fresh partition → 200 `meta.cache=hit`; corrupt durable store → 500 with immediate restore-recovery to 503) — the C1 modules are dormant/unwired, so the read model itself is covered by its unit suites + the recursive dormant-boundary guard, not by HTTP. `tsc` / `lint:all` / `git diff --check` clean; `canonicalSlate` suite 12/12; full `npm test` green across the branch. Review history: initial impl (`1c0a53d`) → 3 Codex P2 fixes (`4ecfc7c`) → 4 Codex P2 fixes (`d136bdd`) → CFBD-id attachment-authority revision v1 (`662f785`) → 2 Codex P2 fixes (`038abc1`) → CFBD numeric-id validation revision v2 (`2c3d63b`) → stored-`homeAway` fingerprint fix (`075aaeb`) → proportionate simplification to id+partition association, net −575 lines (`1d9800b`) → reused-raw-id rejection (`5ee907e`) → parsed-numeric-id duplicate detection closing the final Codex finding (`c48645c`).
- Purpose: The dormant, schedule-authoritative canonical game-stats evidence **READ** model ("C1" — the first meaningful slice of the lineage-free **C** in `docs/ai/game-stats-writer-fence.md`): decide which games each weekly partition expects, associate durable rows by CFBD id + partition, select the authoritative evidence per game (sufficiency + fence freshness), and project public + analytics views — with no route/cron/insights wiring and no writes. Binding plan: `docs/ai/platform-086h3c1-implementation-handoff.md`.
- Result: 4 dormant modules under `src/lib/gameStats/` — `canonicalSlate.ts` (schedule-authoritative expectation via `buildScheduleFromApi`; addressable-game slate; duplicate CFBD-id rejection by parsed numeric id), `evidenceAuthority.ts` (per-game evidence selection: schema-blocking, sufficiency classes, deterministic fence freshness + order-invariant representative tie-break), `partitionCoverage.ts` (typed coverage states satisfied/incomplete/absent/blocked/duplicate-conflict/manual-only with season-relative disposition), `publicProjection.ts` (public + analytics projections with deterministic diagnostics: pending / deferredPlaceholders / unmatchedStoredIds / duplicateConflicts) — plus the shared RFC 3339 fence parser `observationFence.ts` (now reused by `durableMerge.ts`, so there is exactly one freshness parser), and `contract.ts` refactored to drop the duplicate `selectAnalyticsRows` authority (leaving `toAnalyticsGameStats` projection-only). Association = unique CFBD game id + partition agreement; CFBD `homeAway` is trusted (no reorientation); duplicate ids fail the canonical build. `dormant-boundary.test.ts` extended to guard the new modules; new suites `canonicalSlate` / `evidenceAuthority` / `partitionCoverage` / `publicProjection` + shared `c1Fixtures.ts`. Supersedes the participant-validation / integrity / quarantine wording of the frozen `docs/ai/platform-086h3-contract.md`.
- Notes: **Numeric participant validation is DEFERRED as a separate pre-activation prerequisite** — validating a stored row's `schoolId`s against the schedule's numeric `homeId`/`awayId` (and the `identity-mismatch` state it produces) is gated on the schedule cache-write path FIRST persisting those numeric ids, which it does not today; see the handoff doc → "Participant validation (DEFERRED)". **Finding accepted/deferred (not production-reachable):** a nonempty-but-registry-unusable team catalog (`[{ school: '' }]`) bypassing the exported pure builder's `teams.length === 0` catalog-authority guard is TEST-ONLY — production `getTeamDatabaseItems()` sanitizes every entry through `toTeamCatalogItem` (drops empty-`school` items) so an unusable catalog collapses to `[]` and is already caught as `catalog-load-failed`; the builder stays exported as the unit-test entry point (not privatized). Both deferrals are recorded in `docs/next-tasks.md` → "Unresolved decisions & known deferrals". C1 stays dormant until a later activation change (E) explicitly connects production consumers.

### PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE-v1

- Status: **MERGED to `main` via PR #399 (merge commit `69d3770`, 2026-07-21); `/verify` passed (read surface byte-identical to `main`; write fence test-covered).** Branch `platform/086h3b-replacement-legacy-writer-fence` from `main` @ `2793a6f` (the frozen `platform/086h3b-revision-status-authority` @ `30705b9` is a read-only reference and was NOT cherry-picked). Supersedes B as designed. Review-remediation pass 1 (four bounded findings): (1) distinguish `store-indeterminate` (lost-COMMIT ack, `writeAttempted`) from `store-unavailable` known-unchanged failures; (2) make the initializer read-and-create atomic via `withAppStateKeyTransaction` on the control key; (3) the initializer loads `.env.local`/`.env` and reports the resolved storage mode; (4) unexpected CLI errors are redacted (stable code; detail only behind `INIT_WRITER_CONTROL_DEBUG=1`). Review-remediation pass 2 (doc truthfulness + two bounded code findings): docs no longer claim `store-indeterminate` writes nothing (only fence refusals + `store-unavailable` are known-unchanged); the fence RE-THROWS a lock-order programming error (`AppStateTxnLockOrderError`) instead of masking it as `store-unavailable`; and a `production-misconfigured` store gives a clear "no PostgreSQL configured" refusal (exit 3) for the dry run, not a redacted error. Findings deferred/accepted: the `store-indeterminate` reason is exposed but not yet consumed by the route/cron; all game-stats writes serialize on the single control lock (immaterial at current cadence).
- Purpose: Replace the frozen PLATFORM-086H3B revision-status authority with the small reliability core the audits endorsed — a durable writer-control fence for the LIVE legacy game-stats writer, reusing prerequisite A. No lineage, revision, ledger, high-water, witness, failed-begin provenance, repair, recovery, shared locks, transactional status ownership, `fetchedAt` stale guard, semantic parser, or capability graph.
- Result: (1) `src/lib/gameStats/writerFence.ts` — durable writer-control record (scope `game-stats-writer-control`, key `state`, `{ recordVersion, state: legacy|armed|active|read-only-safe }`), strict parser (exact key allowlist; rejects null/primitive/array/unknown-version/missing/unsupported/extra), presence-aware `toWriterControlRead`/`classifyLegacyWrite` (absent and malformed are NEVER `legacy`), and the initial `legacy` constructor — no transitions/repair/lineage/HTTP. (2) `src/lib/gameStats/cache.ts` — `setCachedGameStats` runs one transaction: partition `E(P)` exclusive → writer-control exclusive `lockKey` (canonical forward order) → revalidate → write only on exactly valid `legacy`; never reports success unless it commits. Fence refusals (absent/malformed/`armed`/`active`/`read-only-safe`) and `store-unavailable` are known-unchanged (prior partition intact); `store-indeterminate` (lost COMMIT ack after mutation SQL, `writeAttempted`) MAY have committed and must be retried/re-read without assuming either version durable; a lock-order programming error is re-thrown, not masked. Byte-identical committed shape while `legacy`; no new metadata; provider work stays outside the transaction. (3) `scripts/init-game-stats-writer-control.ts` (`npm run init:writer-control`) — create-if-absent only, dry-run default, PostgreSQL-only apply, idempotent on valid `legacy`, refuses malformed/non-legacy, never arms/activates/repairs/deletes. Tests: `src/lib/gameStats/__tests__/writerFence.test.ts` (24 — strict parse; legacy parity/first-write; same-partition serialization; lock order; absent/malformed/armed/active/read-only-safe refusal with no mutation; lock/read/commit failure never success; initializer dry-run/apply/idempotence/refusals; route ownership + H1/H2-dormant source checks); existing game-stats write-path tests seed the control row via a shared `writerControlSeed.ts` helper. Full `npm test` 1841/1841; `tsc`, `lint:all`, `git diff --check` clean.
- Notes: **Operational dependency (not concealed):** the writer-control row MUST be initialized before the fenced writer deploys — otherwise all legacy game-stat writes (cron + manual) refuse. Rollout sequence + revised lineage-free C/D/E definitions in `docs/ai/game-stats-writer-fence.md`. No live provider/database/cron/route contacted; no lifecycle activated; H1/H2 remain dormant.

### PLATFORM-086H3B-VALUE-AND-SCOPE-AUDIT-v1 / PLATFORM-086H3B-SPLIT-EXTRACTION-PLAN-v1

- Status: **Read-only architectural audits (no code, no branch, no PR, no `/verify`).** Independent of, and corroborated by, a parallel Codex audit.
- Purpose: Determine whether the PLATFORM-086H3B revision-status authority branch (`platform/086h3b-revision-status-authority` @ `30705b9`) should be merged, simplified, split, or parked; then define the smallest replacement prerequisite from `main`.
- Result: Concluded B must NOT be merged. Game stats are reconstructible provider projections (no irreplaceable product data, no manual-edit path, self-healing weekly cron); no product feature reads revision/lineage/commit-stamp; none leaves the DB; and after a point-in-time restore nothing outside the same `app_state` table remembers a revision — so permanent lineage + revision-reuse prevention defend a scenario that cannot occur at this (hobby-scale, commissioner-operated) stage. Recommendation: freeze B as a read-only reference and land ONE small fenced-legacy-writer prerequisite (serialize + revalidate a durable control record), with lineage/revision/repair removed from C/D/E. Implemented as PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE-v1 (above); design in `docs/ai/game-stats-writer-fence.md`.

### PLATFORM-086H3A-APP-STATE-MULTI-KEY-TRANSACTION-v1

- Status: **✅ complete, MERGED to `main` via PR #398 (merge commit `2793a6f`, 2026-07-19); Codex reviewed clean and `/verify` passed pre-merge; merged DORMANT — production behavior unchanged (the primitive has no production route caller).** Branch `platform/086h3a-app-state-multi-key-transaction` from `main` @ `c8ebed4`. First prerequisite (A) of the PLATFORM-086H3 decomposition — the single-branch monolith (`platform/086h3-atomic-game-stats-contract-activation`, HEAD `e1a9593`) is frozen as a read-only salvage reference and was NOT cherry-picked; this PR was reconstructed from `main`. Includes the folded PLATFORM-086H3A-LOCK-ORDER-ENFORCEMENT-REMEDIATION-v1, PLATFORM-086H3A-LOCK-IDENTITY-OVERLAP-REMEDIATION-v1, PLATFORM-086H3A-LOCK-FAILURE-POISON-REMEDIATION-v1, PLATFORM-086H3A-DUAL-ERROR-SHAPING-REMEDIATION-v1, and PLATFORM-086H3A-CLEANUP-BEFORE-SHAPING-REMEDIATION-v1 (the lock-order, lock-identity, lock-failure, dual-error, and cleanup-ordering notes below are the historical folded-remediation record — the final reviewed contract and verification outcome are summarized in the closeout paragraph immediately after this Status line).
- Final reviewed scope (verified pre-merge): a generic multi-key app-state transaction capability in `src/lib/server/appStateStore.ts` — `AppStateKeyTxn` gains `readKey`/`writeKey`/`lockKey` over the existing single-key `read`/`write` (all current callers preserved). PostgreSQL runs ONE client and ONE `BEGIN`/`COMMIT` for the whole transaction (every lock/read/write on that client; conservative uncertain-COMMIT containment; uncertain clients destroyed). The file fallback stages all writes and commits them in ONE atomic replacement (all-or-nothing; a failed replacement leaves the prior file intact) — it is in-process development/test support only, and PostgreSQL is the production correctness boundary. Secondary locking is EXPLICIT (`lockKey`); lock identity is an INJECTIVE `(scope, key)` tuple (`JSON.stringify([scope, key])`, identical on both backends; persisted ROW keys unchanged); acquisition is ENFORCED monotonic (fail-fast `AppStateTxnLockOrderError`, reacquisition idempotent), and overlapping `lockKey` requests are SERIALIZED so state advances only after successful acquisition. A failed required-lock acquisition POISONS the transaction (noncommittable even if the promise was un-awaited/caught/discarded); callback, lock, and cleanup failures are all truthfully represented (`AppStateTxnCallbackLockError` — callback value verbatim as `cause`, typed lock failure as `lockFailure`; wrapped in `AppStateTxnCleanupError` on rollback failure), and the combined error is CONSTRUCTED only after complete backend cleanup (rollback + client containment; every file-lock slot release). **Codex review is clean and `/verify` passed.** Verification: full suite `1817/1817`; focused transaction + dormant-boundary suites `91/91`; `tsc`, `lint:all`, and `git diff --check` clean; production `/api/game-stats` HTTP responses were byte-identical to `main` across cache hit, corrupt durable store, stale read, parameter validation, cache miss, and unauthorized-refresh probes — after establishing `.env.local`/build-cache parity between the two servers (an initial comparison used unequal `.env.local` state, a methodology artifact, not a product defect; environments and caches were normalized and the full probe matrix reran clean). No live provider or database was contacted; no game-stats lifecycle was activated (the transaction primitive has no production route caller — only the dormant `durableMerge.ts` imports it). The transaction primitive is DORMANT: `src/lib/server/appStateStore.ts` is the only production file changed vs `main`, and production behavior is unchanged.
- Purpose: Add a generic, durable **multi-key** app-state transaction capability so a later prerequisite can atomically co-commit an evidence row with its revision-ledger row. Storage infrastructure ONLY — it implements and activates no revision policy, refresh status, ingestion, recovery, coverage, projection, routes, or consumers.
- Result: `src/lib/server/appStateStore.ts` — `AppStateKeyTxn` gains `readKey(scope,key)` / `writeKey(scope,key,value)` / `lockKey(scope,key)`, preserving the existing single-key `read`/`write` and every current caller. **PostgreSQL**: one acquired client runs one `BEGIN`/`COMMIT`, every lock/read/write on that same client, transaction-scoped `pg_advisory_xact_lock`s (primary always; `lockKey` for an explicit secondary key, released at COMMIT/ROLLBACK), read-your-writes, full rollback on callback failure, the existing conservative uncertain-COMMIT handling (`writeAttempted` governs durability uncertainty), and uncertain-client destruction — no nested clients or transactions. **File fallback**: the transaction is STAGED — one snapshot loaded at first access, reads staged-first (read-your-writes) with untouched keys from the snapshot, all writes staged, and on a successful callback ONE atomic replacement under the whole-file lock that rereads the live file and overlays only the staged keys (so an unrelated concurrent key write is never clobbered); a callback throw or a failed serialization/replacement leaves every touched key unchanged and surfaces a typed `AppStateTxnFinalizeError` (`writeAttempted: false`) — partial persistence of a multi-key transaction is impossible on either backend. Accessor lifetime is enforced (every method rejects after the callback settles). `lockKey` is explicit — ordinary `readKey`/`writeKey` take no secondary lock; the module documents what is auto-locked, when explicit secondary locking is required, ENFORCED monotonic acquisition ordering (below), transaction-lifetime ownership, and that the file backend provides in-process atomicity only (production correctness requires PostgreSQL). Test-only seams (`__setAppStateFileCommitFailureForTests`, the scoped write/read seams) stay inert in production. Tests: `src/lib/server/__tests__/appStateKeyTransaction.test.ts` exercises the production implementation on BOTH backends — two/three-key atomic commit, primary+secondary read-your-writes, latest-staged-value-wins, callback-throw rollback, secondary-write/finalization-failure rollback, file-replacement-failure snapshot preservation, pre-commit invisibility, unrelated-key preservation, retry-after-failure, expired-accessor rejection, enforced lock ordering (below), single-key compatibility, and conservative PostgreSQL commit-uncertainty. The H1/H2 dormant-boundary guard is untouched and green. `tsc`, `lint:all`, `npm test` clean; `git diff --check` clean.
- Lock-order enforcement (folded PLATFORM-086H3A-LOCK-ORDER-ENFORCEMENT-REMEDIATION-v1): the original entry OVERSTATED ordering as merely documented caller discipline — it was not enforced, so two transactions rooted at opposite keys could deadlock (PostgreSQL) or indefinitely wedge the file-fallback chain. The primitive now ENFORCES monotonic canonical lock acquisition. A single deterministic comparator over the canonical `(scope, key)` identity (`${scope}::${key}`, identical on both backends, timing-independent, generic — no dataset policy) is applied to every `lockKey`: the auto-acquired primary lock is the transaction's first held identity; a request that sorts strictly ABOVE the highest held identity is a legal forward acquisition, a reacquisition of an already-held lock is an idempotent no-op, and anything else is a BACKWARD acquisition rejected FAIL-FAST with a new typed `AppStateTxnLockOrderError` (carrying `attempted`/`highestAcquired`) BEFORE any wait or advisory-lock query — so the rejected transaction never enqueues, never issues a backward `pg_advisory_xact_lock`, and PostgreSQL never depends on server-side deadlock detection for this case. (A caller may catch the rejection, but a `lockKey` is a REQUIRED lock — the enclosing transaction is POISONED and can never commit; see the lock-failure and dual-error notes. The earlier "may catch it and proceed" phrasing is superseded.) Opposite-root race regressions on BOTH backends prove no hang: A holds lock A and waits forward for B, B is rejected on the reverse acquisition before waiting, B releases its primary, and A completes; plus comparator unit cases (forward/backward/idempotent/multi-forward/backward-after-multiple/canonical-order retry) and the prerequisite-B `game-stats partition -> provider-refresh-status` direction accepted with the reverse rejected — all via the generic comparator, with no revision/status implementation introduced. Full suite 1784/1784; `tsc` and `lint:all` clean.
- Lock-identity & overlap (folded PLATFORM-086H3A-LOCK-IDENTITY-OVERLAP-REMEDIATION-v1): two follow-up findings against the enforcement above. (1) The comparator used a delimiter-concatenated identity (`${scope}::${key}`), so distinct tuples could COLLIDE — `('a::b','c')` and `('a','b::c')` produced the same string and would be treated as the same lock / idempotently held. Lock identity is now INJECTIVE — `JSON.stringify([scope, key])` — used identically for held-lock tracking, file lock-chain keys, and the PostgreSQL advisory-lock hash input (primary lock included), with a direct tuple comparator (`scope` then `key`) for the forward/backward decision; distinct tuples always sort and lock distinctly, surviving `/`, quotes, and Unicode. Persisted app-state ROW identity is unchanged (`buildCompositeKey`), so no durable keys migrate. (2) Overlapping `lockKey` calls classified INDEPENDENTLY against shared state, so two not-yet-awaited requests could both read the same highest-held value and acquire out of monotonic order. Every `lockKey` is now SERIALIZED per transaction in invocation order (a promise queue): each classifies and acquires or rejects fully before the next runs, held/highest state advances ONLY after successful acquisition, and finalization drains any queued/in-flight acquisition before committing or releasing locks — so `Promise.all([txn.lockKey(b), txn.lockKey(c)])` behaves exactly as sequential awaits and deadlock prevention no longer relies on callers awaiting sequentially. Regressions on BOTH backends: collision safety for the fused pairs plus delimiter/quote/Unicode tuples; overlapping forward acquisition in invocation order; a later lock unable to acquire while an earlier one is pending; held/highest advancing only on success; overlapping backward requests rejecting before backend lock activity; the overlapping opposite-root scenario proving no deadlock with a clean canonical-order retry; and finalization draining an un-awaited in-flight lock. The prereq-B `game-stats partition -> provider-refresh-status` direction (accepted forward; reverse rejected) is retained via the generic comparator, no prerequisite-B implementation introduced. Full suite 1792/1792; `tsc` and `lint:all` clean.
- Lock-failure poisoning (folded PLATFORM-086H3A-LOCK-FAILURE-POISON-REMEDIATION-v1): finalization drained in-flight `lockKey` requests but a FAILED acquisition that was un-awaited/caught/discarded did not prevent commit — a callback could ignore a rejected required lock and still commit. A `lockKey` is now a REQUIRED lock: the first failed acquisition (ordering rejection OR backend failure) is retained per transaction and POISONS it, so it is noncommittable regardless of whether the caller awaited, caught, or discarded the individual promise. The internal scheduling tail stays non-rejecting (no unhandled-rejection noise) but records the first failure; the returned `lockKey` promise still rejects with the original typed error, and observing that rejection internally does not erase it from finalization. After the callback and lock drain: callback success + lock failure rolls back / discards staged writes and throws the retained lock failure (the callback success value never escapes; PostgreSQL rolls back, the file fallback discards); callback failure + lock failure keeps the callback error PRIMARY and the lock failure as typed, inspectable secondary context (dual-error shaping below — this supersedes the earlier "catch and continue then commit" behavior entirely); callback failure alone and the no-lock-failure commit path are unchanged. Regressions on BOTH backends: un-awaited backward poisons a returning callback (rollback/discard, client released healthy, advisory locks and file-chain slots freed, no success value escapes); an injected backend acquisition failure that is caught and followed by another valid queued acquisition still rejects and persists nothing; callback-plus-lock failure preserves the primary callback error with the typed secondary; and a SUCCESSFUL un-awaited acquisition still drains and commits normally (no false failure). All prior prerequisite-A guarantees remain green; no game-stats behavior changed; no prerequisite-B implementation introduced. Full suite 1799/1799; `tsc` and `lint:all` clean.
- Dual-error shaping (folded PLATFORM-086H3A-DUAL-ERROR-SHAPING-REMEDIATION-v1): the previous callback-plus-lock secondary-context mechanism used `Object.defineProperty` against the arbitrary callback error, which THREW for a frozen/non-extensible error and silently dropped the lock context for a primitive/`null`/`undefined` throw — and it ran BEFORE rollback. Callback-plus-lock failure now produces a TOTAL, nonthrowing typed dual error, `AppStateTxnCallbackLockError` (the callback value verbatim as `cause`, the retained lock failure — original typed lock error + scope + key + kind — as `lockFailure`), for EVERY throw shape (extensible/frozen/non-extensible/typed `Error`, primitive, `null`, `undefined`, or a callback error already carrying an unrelated `lockFailure` property, which is preserved untouched inside `cause`). The callback value is never mutated. When the callback merely PROPAGATED the lock rejection (same object) the original typed lock error is thrown DIRECTLY (unwrapped). Cleanup now strictly precedes shaping: the callback+lock queue settles → the transaction is determined noncommittable → PostgreSQL rolls back / the file fallback discards staged state and releases slots → the final typed error is constructed and thrown (construction is infallible, so shaping can never throw before rollback). When rollback ALSO fails, all three survive: the callback failure (primary) and lock failure (secondary) as the `AppStateTxnCallbackLockError` carried in `AppStateTxnCleanupError.cause`, with the rollback failure in `cleanupCause` and the uncertain client destroyed. Callback-success + lock-failure still rejects with the original retained lock failure, commits nothing, and never lets the success value escape. Regressions on BOTH backends: the full callback-throw-shape matrix (extensible/frozen/non-extensible/primitive/`undefined`/preexisting-`lockFailure`) proving the primary value and typed lock context stay inspectable and nothing commits; identical callback+lock object throws the lock error directly; PostgreSQL rollback precedes shaping for frozen and primitive throws; a failed rollback preserves callback + lock + cleanup together; and the file backend discards staged writes and frees every chain slot across the matrix. Full suite 1813/1813; `tsc` and `lint:all` clean.
- Cleanup-before-shaping (folded PLATFORM-086H3A-CLEANUP-BEFORE-SHAPING-REMEDIATION-v1): a strict finalization-ORDER fix — the dual-error wrapper was already total, but it was CONSTRUCTED before backend cleanup finished (PostgreSQL: before the client was released/destroyed; file: inside the `catch`, before the `finally` released slots and before the primary slot was released). Construction now happens ONLY after cleanup. PostgreSQL order: callback/lock queue settle → detect noncommittable → `ROLLBACK` → release (clean) or destroy (uncertain) the client → construct `AppStateTxnCallbackLockError` → wrap in `AppStateTxnCleanupError` (dual error as `cause`, rollback error as `cleanupCause`) when rollback failed → throw. File order: settle → mark noncommittable → discard staged state → release every secondary slot (in `finally`) → release the primary slot (the `invoke` promise settles) → THEN, via a deferred `DeferredFileDualFailure` descriptor carried out of the lock-owning section, construct the public error only after the primary slot's chain entry is removed → throw. All typed contracts unchanged (callback-success + lock-failure throws the original lock failure; propagated identical lock failure thrown directly; callback values verbatim). A temporal regression on each backend — an inert-by-default `__setBeforeDualErrorConstructForTests` observer fired at the construction instant — proves that at shaping time the PostgreSQL rollback completed, the client was released/destroyed, and no advisory lock remained; and that every file-lock slot (primary AND a genuinely-held secondary) was released with the chain count back to baseline. The stale `AppStateTxnLockOrderError` doc and the superseded "may catch it and proceed" registry phrasing are corrected to the required-lock poisoning contract. Full suite 1817/1817; `tsc` and `lint:all` clean.

### PLATFORM-086H2-DURABLE-GAME-STATS-MERGE-SERVICE-v1

- Status: **Merged via PR #397 (`platform/086h2-durable-game-stats-merge-service`, merge commit `c48e1ca`, 2026-07-18).** Second staged PR of the 086H decomposition. Four implementation commits (`c73b40d`, `3fa5064`, `082664e`, `fb5dfdc`) plus the docs closeout (`206962c`): the foundation and three folded review-remediation rounds (fence-only refresh semantics; single-client transaction scope with typed finalization uncertainty; write-attempt tracking with uncertain-client containment), each independently re-reviewed to a clean verdict. Claude `/verify` passed with byte-identical branch-vs-`main` HTTP behavior and no dormant metadata on the wire; full suite 1758/1758 at closeout.
- Purpose: Provide the **dormant** durable merge authority PLATFORM-086H3 will activate atomically across validated ingestion → durable merge → cache completeness → schedule-relative recovery → analytics projection → truthful availability. No current production caller invokes it.
- Result: New `src/lib/gameStats/durableMerge.ts` — merges validated v2 observation batches into weekly partitions with: stable game identity through `providerGameId` only (sides pair by home/away; a positive stored schoolId contradicting the validated incoming teamId is a typed conflict — no team-string matching); conservative category-level merge (absent games and omitted categories retained; a raw category replaced only by a strictly parse-valid newer value; normalized values that merged raw evidence cannot strictly reconstruct are preserved from the prior row as compatibility only — never establishing strict completeness, analytics eligibility, raw evidence, or `pointsProvided`; points move only on explicit evidence; zero and whitelisted negatives are evidence; row counts/supersets carry no replacement authority); per-game observation fencing on a new optional `GameStats.fetchStartedAt` (strict RFC 3339 with explicit timezone, component-validated, canonicalized to UTC; stale observations rejected wholesale per the per-game snapshot policy; equal fences idempotent-or-conflict, never last-writer-wins; a strictly newer content-identical observation is a durable fence-only `refreshed` write so a reordered older observation can never roll state back past a fresher confirmation); deterministic duplicate handling on BOTH sides (identical incoming count once, divergent conflict order-free; identical existing durable duplicates collapse on accepted update, divergent existing duplicates conflict with every stored row preserved); exact schema-version authority (absent → legacy merge; exactly 2 → v2; anything else → typed unsupported/malformed conflict with the row preserved bit-for-bit). New `withAppStateKeyTransaction` in `appStateStore.ts`: ONE dedicated PostgreSQL client runs BEGIN → `pg_advisory_xact_lock` → the durable read → the conditional write → COMMIT (the lock owner never needs a second connection — no pool-starvation deadlock; same-key waiters queue on the database; the dev/test file fallback serializes in-process and is not the production correctness boundary). Typed outcomes never collapse: `written`/`partially-merged`/`unchanged`/`stale`/`conflict` vs `unavailable` (typed reasons incl. `merge-computation-failed`, with rollback confirmed before the result returns) vs `indeterminate` (COMMIT or ROLLBACK failure after mutation SQL was SUBMITTED — `writeAttempted`, set before the statement, governs uncertainty, never acknowledgement — with `durability: 'unknown'` and partition identity). Uncertain clients are destroyed via `release(error)` and never re-enter the pool; healthy disposal is recorded only after `release()` completes; a post-commit release failure never replaces a confirmed result; initiating, cleanup, and acquisition causes are all retained on the typed errors. Tests (54 new across two suites): the full pure decision table, and a stateful fake-pg harness modeling advisory-lock ownership, staged-write commit visibility, capacity, and idle-pool reuse/destroy — proving real same-key overlap with committed-state reread, capacity-3 starvation prevention, stale-writer rejection after commit, healthy-client reuse, destroyed-client non-reuse, and all failure/cleanup paths deterministically (no sleeps). The recursive dormant-boundary guard covers the merge module in every import form (including `.js`/`.mjs`/`.cjs`-style relative specifiers); production lifecycle files are byte-identical to `main`; the 086H3 activation invariant is documented in the module: every game-stats writer must route through this authority (or the same transaction-scoped lock) before activation.
- Verification: `git diff --check`, `npx tsc --noEmit`, `npm run lint:all` clean; full `npm test` 1758/1758; independent production sweeps for every dormant symbol clean; `/verify` runtime A/B against `main` byte-identical with corrupt-store, malformed-param, auth-gate, and cache-miss probes all matching. No database or provider contacted during implementation.

### PLATFORM-086H1-GAME-STATS-DATA-CONTRACT-IMPLEMENTATION-v1

- Status: **Merged via PR #396 (`platform/086h1-game-stats-data-contract`, merge commit `0f8b562`, 2026-07-17)** as a **dormant contract foundation**. Four commits: the foundation plus three folded review remediations (prototype-safe category lookup; full production disconnection after the adversarial no-ship finding; recursive full-tree dormant-boundary guard); the closure review verdict was clean and runtime A/B verification showed byte-identical production responses vs `main`. First of the staged PRs decomposing the frozen original single-PR implementation `PLATFORM-086H-GAME-STATS-RECOVERY-v1` (branch `platform/086h-game-stats-recovery` @ `13db9ce`, read-only salvage reference — not merged or cherry-picked; superseded/unimplemented as one unit after twelve review-remediation rounds proved the scope unreviewable). PR 2 remains the durable merge service; **PR 3 is the atomic contract-activation and recovery-integration PR** (ingestion, cache coverage, partial-week recovery, durable merge consumption, analytics projection, and truthful availability all flip to the contract together — adversarial review confirmed activating analytics alone would let unchanged ingestion cache rows the strict contract then silently drops); PR 4 (diagnostics) and the legacy-row migration task follow.
- Purpose: Establish the game-stats data contract — strict parsing, typed classification, bounded legacy compatibility, canonical projection, duplicate selection — as a fully tested but **production-disconnected** library, proven against the production durable inventory (PLATFORM-086H1-LEGACY-DURABLE-DATA-INVENTORY-AUDIT-v1: 95 partitions, 2021–2025, 7,335 rows), while every v2 writer stays dormant and all production behavior remains identical to `main`.
- Result: New `src/lib/gameStats/contract.ts` — the single strict parser and policy home (imports game-stats types only): one authoritative category-specification map (26 recognized categories incl. raw-only `kickReturns`/`puntReturns`; `completionAttempts` documented observed-but-unmodeled; six analytics-required categories), full-string canonical integer/fraction/clock grammars from untrusted `unknown` values with prototype-safe own-property category lookup (safe-integer bounds; negatives only for the six inventory-evidenced yardage categories; `made <= attempted` for efficiency fractions but NOT penalties-yards; possession trimmed-then-strict `M:SS`/`MM:SS` ≤ 90 min — trim exists because CFBD emits observed leading-space clocks like `" 9:12"`), structural points evidence (JSON number, non-negative safe integer; strings never coerce). Per-game-row `schemaVersion: 2` **types** (absent → legacy; safe integer > 2 → unsupported; other present values → malformed-v2; neither falls back to legacy; reads never stamp legacy rows). Primary typed classifier `classifyGameStatsRow` (14 states with reason tokens) with derived predicates (`hasProviderAddressableGameId`, `isPersistableIncomingRow`, `isCompleteStatRow`, season-independent `isAnalyticsEligible`), pure season-aware recovery policy `evaluateGameStatsRow` (explicit `seasonRelation`, no ambient clock), typed wire-observation parsing + pure v2 row constructor, canonical analytics projection `toAnalyticsGameStats` (strictly re-parsed raw evidence; `null` for ineligible rows), and deterministic duplicate selection `selectAnalyticsRows` (eligible v2 > eligible legacy; identical projections count once; conflicts excluded and reported; order-free). Bounded legacy compatibility (versionless + valid id/identity + six required raw categories strictly valid both sides + valid stored points + exact stored-vs-rebuilt normalized agreement, mismatch → quarantined `legacy-normalized-mismatch`) is **inventory-proven for exact 2021–2025 owner-analytics parity** (incl. the four leading-space-possession rows), ready for the activation PR. **Nothing in production consumes any of it yet**: no production writer stamps v2 rows; owner aggregation (`ownerStats.ts`), Insights/career loading (`insights/context.ts`, `historySelectors.ts`), cron/manual writers, `coverage.ts` consumers, cache, diagnostics, and durable rows are all byte-identical to `main`; no provider or database was contacted.
- Verification: `git diff --check`, `npx tsc --noEmit`, `npm run lint:all` clean; full `npm test` green. Pure suites: `contract.test.ts` (parser tables incl. `350yards`/`6x-14y`/`30:99`/`12.5`/`15-6`/unsafe-integer/whitespace/null/numeric-value/string-points plus prototype-named categories `toString`/`constructor`/`hasOwnProperty`/`valueOf`/`__proto__`; all 14 classifier states; predicates; recovery-policy matrix; projection; duplicate selection), backed by provenance-marked sanitized fixtures (`__tests__/fixtures.ts`, legacy rows built through the real legacy writer path). Boundary suites: `ownerStats.test.ts` pins production aggregation to unchanged `main` behavior (rows the strict contract would exclude still contribute; duplicates are not deduplicated — deliberate failure signals if the contract is wired in prematurely); `dormant-boundary.test.ts` asserts the cron route, manual game-stats route, `ownerStats.ts`, and `insights/context.ts` reference no dormant contract API and that the legacy writer path cannot produce `schemaVersion`/`pointsProvided` fields.

### PLATFORM-086G2-ODDS-BOUNDARY-USAGE-TRUTHFULNESS-v1

- Status: **Merged via PR #395 (`platform/086g2-odds-boundary-usage-truthfulness`, merge commit `0ee58b4`, 2026-07-16).** Eight commits: the implementation plus seven folded review-remediation commits (below), scoped by two read-only audit prompts. The final pre-merge Codex review of the full branch diff was clean (no actionable correctness issues).
- Purpose: Close deferred PLATFORM-086A findings #4 and #3 at the Odds boundary as one cohesive PR: reject malformed or unexpectedly empty Odds payloads before any durable commit (prior-good retained, truthful scoped failure), classify genuine empty responses contextually instead of committing them as successful empty refreshes, and represent an odds-usage durable-read failure distinctly from a genuinely absent snapshot end to end (store → status feed → panel). No polling, cadence, or automation added.
- Result:
  - **Odds payload boundary** (`src/app/api/odds/route.ts` + new pure `src/lib/odds/emptyOddsClassifier.ts`): a 200 response is no longer valid merely because it coerces to an empty array. Non-array payloads fail with stable code `odds-invalid-payload`; nonempty payloads with zero normalizable events fail as `odds-schema-drift`; both throw (`OddsPayloadError`) BEFORE `setAppState`/process-cache publication, so prior-good durable and process state are untouched, no downstream invalidation fires, and the shared catch records exactly one truthful failure (code + operator message) against the exact odds target scope. A genuinely empty array is classified by `classifyEmptyOddsResponse` against a deliberately NARROW target-scoped "rows expected" contract: (a) prior-good events for the SAME season-scoped target whose commence time is still in the future (kicked-off events legitimately drop out of the feed), or (b) canonical-target-only near-horizon schedule evidence — non-disrupted canonical-schedule games kicking off within 7 days (`ODDS_EXPECTED_KICKOFF_HORIZON_MS`). Far-out games, kicked-off games, disrupted games, and unparseable times never create an expectation, and filtered bookmaker/market targets get no schedule evidence at all (a filtered subset may legitimately be empty — its only evidence is its own prior-good data). Evidence reads are cache-only, resolve independently via `Promise.allSettled` (a failed source is unavailable, never evidence of absence — the G1 remediation lesson applied from the start), and read the schedule through the canonical `loadCachedScheduleItems` partition fallback. Unexpected empty → `odds-empty-unexpected` failure (502) carrying both evidence counts. Valid absence → truthful NO-OP (`recordProviderRefreshNoop`, never a successful empty commit): a populated prior entry (or an unreadable durable entry) is never replaced durably or in-process; only a genuinely cold/empty readable target still writes its empty entry durable-first, preserving the existing cache contract (TTL freshness, honest `snapshotCapturedAt`, no repeat upstream pressure from follow-up reads). Usable nonempty payloads — including partial normalizable coverage — keep the exact existing durable-first commit, success recording, attempt ordering, and canonical/filtered target semantics; the single resolved-attempt guard now covers success AND no-op (`oddsAttemptResolved`).
  - **Odds-usage read state** (`src/lib/server/oddsUsageStore.ts`, `/api/admin/provider-status`, `providerStatusSummary.ts`, `ProviderDataStatusPanel.tsx`): new `readLatestKnownOddsUsageState` returns a discriminated `available | absent | unavailable(error)` result — never throws, never fabricates usage values, and a failed read leaves the process memo unpoisoned so a later read retries durable storage. The provider-status feed no longer collapses a durable-read failure to `null` (the `.catch(() => null)` is gone): it serializes `oddsUsage` (compat) plus `oddsUsageState` and `oddsUsageStateDetail`, and a usage read failure can no longer sink the feed. The panel renders the three states distinctly via the new pure `describeOddsUsageAvailability`: genuine absence keeps the muted "no snapshot yet"; a read failure renders a 'bad'-tone "usage status unavailable — durable read failed (detail)" and never the healthy-looking absence wording. `/api/admin/odds-usage` (legacy panel path) already distinguishes failure (500) from absence (null usage) and is unchanged.
- Verification: `git diff --check`, `npx tsc --noEmit`, `npm run lint:all` clean. New `src/lib/__tests__/emptyOddsClassifier.test.ts` (9 tests: evidence kinds, kicked-off/expired exclusions, 7-day horizon boundary, disrupted/unparseable exclusions, filtered-target null-schedule, combined evidence counts) and `src/app/api/odds/__tests__/payload-boundary.test.ts` (8 tests: non-array failure with no commit, schema-drift failure, unexpected-empty over prior upcoming events with durable+process retention and no last-success advance, near-horizon schedule failure, far-out-schedule no-op, cold no-op preserving the cache contract, expired-prior no-op without rewriting the prior entry, partial nonempty success). Extended `oddsUsageStore.test.ts` (+3: available/absent/read-failure states incl. memo recovery), provider-status `route.test.ts` (+3: state serialization incl. feed-survives-read-failure), `providerStatusSummary.test.ts` (+3: wording/tone distinctions). Adjacent suites green: odds quota-guard/normalization/refresh-status, odds attachment, provider status/diagnostics/cache-state, manualRefresh, selectors, AdminUsagePanel. Mocks and fixtures only — no live Odds API calls; no automatic Odds polling or provider spending introduced.
- Scope guardrails: no Odds cadence/quota-policy change, no 086C polling, no Scores or CFBD-quota changes, no game-stats/settings-feedback work (086H/086I), no diagnostics redesign (086F), no canonical-identity or team-matching change, no provider calls from public read paths, no bookmaker/market product-policy change (the existing canonical/filtered target split is reused as the classification boundary). Durable-first commits, prior-good retention, scoped attempt ordering, cross-scope completion-token rejection, cache-only public reads, manual-refresh authorization, and provider-credit accounting all preserved. Remaining campaign sequence unchanged: PLATFORM-086H → 086I → 086B → 086C.
- Review remediation (PLATFORM-086G2-PRIOR-EVIDENCE-STATE-MODEL-REMEDIATION-v1, folded in pre-merge; scoped by the read-only PLATFORM-086G2-EMPTY-ODDS-STATE-MODEL-AUDIT-v1): resolved the remaining Codex P2 — `unmatched_pair` conflated "identities resolved and the pair is confidently absent" with "identity reconciliation failed" (pair keys degrade to normalized raw strings for labels outside the catalog/alias map, and placeholder slate rows are unreachable by any real pair key), so an unresolved provider spelling or a concealing placeholder slot could set `priorRowsProvablyObsolete` and destructively clear recoverable rows. The classifier's ad-hoc counters were replaced with an explicit typed per-row state model (`classifyPriorRow` → `matched-healthy | matched-obsolete | matched-indeterminate | expired | confidently-absent | identity-unresolved | match-ambiguous | date-indeterminate`) with mechanical verdicts: `matched-healthy` proves odds expected; `matched-obsolete`/`expired`/`confidently-absent` prove obsolescence; every other state is indeterminate (no positive evidence, blocks clearing). `unmatched_pair` maps to `confidently-absent` ONLY when both event labels resolve canonically AND every slate row's participants classify as real resolved teams (`isResolvedTeamLabel` over the whole slate — a placeholder or unresolved row anywhere means an unmatched event might be hiding behind it); otherwise `identity-unresolved`. All prior contracts preserved by construction (ambiguous/date-mismatch/collision indeterminate, expired-commence override, evidence-unavailable fallback, positive-evidence and disruption logic untouched); no matcher API change. +3 classifier tests (unresolved provider spelling retained; placeholder slate row blocks confident absence; one unresolved slate participant suppresses unmatched clearing) and +1 route regression (unresolved-spelling prior entry retained through a no-op); the existing fully-resolved unmatched tests double as the positive controls that confident absence still clears.
- Review remediation (PLATFORM-086G2-IDENTITY-UNCERTAINTY-REMEDIATION-v1, folded in pre-merge): resolved both Codex P2s under one rule — ambiguous or unavailable identity evidence authorizes neither an `odds-empty-unexpected` failure nor destructive clearing. (1) **Ambiguous attachment stays indeterminate** — the classifier now consumes the attachment matcher's diagnostics: only a CONFIDENT absence (`unmatched_pair` — no candidate pair in the slate at all) proves a prior event obsolete, while `ambiguous_pair` (repeated matchup the matcher refused to guess between, e.g. missing commence time), `date_mismatch` (kickoff-tolerance miss, including the single-candidate rescheduled case), and `consumed_or_duplicate` are indeterminate — no positive evidence, and they block the provably-obsolete clear (an EXPIRED cached commence still proves obsolescence regardless of matching outcome, since an already-kicked-off line is legitimately gone from the feed). (2) **Unknown labels never auto-resolve** — the evidence resolver is built from the teams catalog + scoped aliases ONLY, with no `observedNames` seeding (which registered arbitrary labels as resolved identities, blessing placeholder text like "Home Team TBA" as a real team); catalog- and alias-resolved participants still create positive near-horizon evidence, unknown/unfamiliar labels do not. +7 classifier tests (ambiguous repeated matchup retains data; date_mismatch indeterminate; ambiguous-but-expired still obsolete; "Home Team TBA" and one-resolved/one-unknown produce no positive evidence; alias-resolved still does; the authoritative-kickoff obsolete case re-fixtured to a within-tolerance moved-up game) and +1 route regression (ambiguous repeated matchup → 200 no-op with prior entry retained and unrewritten); the route's rescheduled-earlier regression re-fixtured to the within-tolerance case.
- Review remediation (PLATFORM-086G2-UNRESOLVED-MATCHUP-EVIDENCE-REMEDIATION-v1, folded in pre-merge): resolved the Codex P2 — a dated CFP/bowl/championship placeholder (TBD, bracket-slot, or "Winner of …" participants, status scheduled) inside the 7-day horizon counted as positive "odds expected" evidence, so a legitimately empty provider response 502'd repeatedly until the slot resolved. Positive near-horizon expectation now requires BOTH participants to classify as real resolved teams via the canonical placeholder classifier the schedule build itself uses (`buildPlaceholderParticipant(...).kind === 'team'` — handles blank/TBD/bracket/"Winner of …"/unresolved labels through `isLikelyInvalidTeamLabel` + resolver status; no raw string checks, no new placeholder system) and therefore requires the identity resolver, which the evidence gatherer now builds whenever a nonempty slate loads (resolver-load failure → no positive schedule expectation, prior evidence falls back conservatively). Unresolved games stay in the schedule untouched — they simply contribute no positive odds evidence; prior-event reconciliation, disruption exculpation, filtered-target behavior, obsolete-row clearing, and the 7-day horizon are unchanged. +6 classifier tests (both-TBD, one-resolved/one-TBD, blank, bracket + "Winner of …", resolved matchup still 502; resolver default now present with explicit-null fallback coverage) and +1 route regression (dated CFP placeholder slot → 200 no-op).
- Review remediation (PLATFORM-086G2-PRIOR-EVIDENCE-SCHEDULE-RECONCILIATION-v1, folded in pre-merge; scoped by the read-only PLATFORM-086G2-EMPTY-ODDS-SEAM-AUDIT-v1): resolved the Codex P2 family rooted in schedule-blind prior-event evidence. `classifyEmptyOddsResponse` now RECONCILES each cached prior event against the current canonical slate using the SAME identity machinery the attachment layer uses (`createTeamIdentityResolver` + `attachOddsEventsToSchedule` pair-key + kickoff-proximity matching — never raw label equality, no parallel matcher): an event is "still expected" only when it matches a non-disrupted game whose CURRENT authoritative `startDate` is parseable and future (deliberately with no horizon cap, preserving early-line regression protection); matched-disrupted (canceled/postponed/suspended/delayed), matched-started/completed (rescheduled-earlier), and unmatched-against-a-loaded-slate events are exculpated. The schedule is now loaded for EVERY target as exculpatory evidence while positive near-horizon expectation stays canonical-only (`includeScheduleExpectation`); resolver inputs (bundled teams catalog + scoped alias map) load lazily inside the empty branch only when prior events need reconciling. Reconciliation is trusted only when the slate loaded successfully AND is nonempty AND identity inputs loaded — otherwise the original conservative cached-commence rule stands and nothing is ever provably obsolete. NEW retained-data contract: a valid-absence verdict reports `priorRowsProvablyObsolete` (every retained event expired, matched-disrupted/completed, or unmatched vs a loaded slate), and only then may the no-op commit the fresh empty entry over the dead rows — healthy or indeterminate rows, an unreadable durable entry, or unavailable schedule/identity evidence always preserve the prior entry. Classifier tests rewritten (17: fallback conservatism incl. empty-slate and missing-resolver, near-horizon boundaries, filtered no-expectation, disruption/started/unmatched exculpation with obsolete flags, beyond-horizon healthy match, mixed evidence, indeterminate-kickoff blocking, expired-commence obsolescence, repeat-matchup kickoff-proximity disambiguation) + 7 route regressions (canceled exculpation with obsolete-entry clearing; postponed/suspended/delayed variants; authoritative-kickoff-started clearing; unmatched clearing; healthy-match 502 preventing any clearing; filtered-target exculpation without positive expectation; schedule-read failure preserving the conservative 502 with nothing cleared).
- Review remediation (PLATFORM-086G2-INVALID-JSON-REMEDIATION-v1, folded in pre-merge): resolved the remaining Codex P2 — a 200 provider response with an invalid, truncated, or empty JSON body previously threw in `upstreamRes.json()` BEFORE both quota capture and the payload-error boundary, recording an uncoded internal 500 and dropping the consumed-credit headers. The refresh path now captures and durably persists the quota-header snapshot immediately after receiving the response (before any body parsing), and parses the body inside the payload-error boundary: a parse failure classifies as a stable `odds-invalid-payload` 502 — prior-good durable and process data retained, nothing published, no success/no-op recorded, and the failure record carries both the stable code and the just-persisted usage. +2 regressions (truncated-JSON and empty-body 200s → 502 `odds-invalid-payload`, failed attempt with code, last-success unchanged, quota headers persisted, prior-good durable + process entries untouched).
- Review remediation (PLATFORM-086G2-NESTED-SCHEMA-USAGE-REMEDIATION-v1, folded in pre-merge): resolved both remaining Codex P2 findings. (1) **Nested scalar validation** — `isStructurallyValidUpstreamOddsEvent` now validates every nested scalar the normalization/attachment/selection layers treat as a string or number (`bookmakers[].key`/`title` and `markets[].key` and `outcomes[].name` as string-or-absent; `outcomes[].price`/`point` as number-or-absent), so layout-preserving drift such as `bookmakers: [{ key: 5 }]` rejects the WHOLE payload as `odds-schema-drift` before any durable write, process publication, or success record — instead of committing malformed data that later throws in `pickPreferredBook`/market/totals selection and leaves a poisoned cache behind a generic 500. Valid partial coverage still succeeds. (2) **Current usage on retained-data no-ops** — the refresh path records its freshly captured header snapshot (`refreshCapturedUsage`) and the response's `meta.usage` prefers it over the served entry's embedded usage, so a valid-absence no-op that retains a populated prior entry (e.g. all cached events kicked off) reports the CURRENT remaining credits; the retained entry itself is never rewritten just to refresh metadata, and genuine cache-only reads (no provider request) keep using cached/durable usage. +2 regressions (five malformed nested-scalar variants → 502 `odds-schema-drift` with no durable/process commit; retained-data no-op reports current captured usage while the stored prior entry keeps its own historical usage).
- Review remediation (PLATFORM-086G2-CODEX-P2-REMEDIATION-v1, folded in pre-merge): resolved all three Codex P2 findings. (1) **Per-target commit serialization** — new `withOddsTargetLock` in `routeInternals.ts` (same promise-chain mutex shape as the status store's `withScopeLock`, in-process only per the documented 086A cross-instance limitation): the empty-payload branch's evidence read + conditional cold-target write and the nonempty branch's durable commit + process publication now run under the same per-`seasonScopedKey` lock, and the empty branch re-reads BOTH caches inside the lock — so an overlapping empty refresh can never observe "no prior entry", lose the race to a concurrent populated commit, and then clobber both caches with `[]` while status reports the populated success. (2) **Structural row validation before normalization** — new `isStructurallyValidUpstreamOddsEvent` in `routeInternals.ts` checks exactly the shapes `normalizeUpstreamOddsEvent` dereferences (string-or-absent team/commence fields; arrays-of-objects for bookmakers/markets/outcomes); ANY structurally malformed row (`[null]`, `{ bookmakers: {} }`, non-string team fields) rejects the whole payload as a stable `odds-schema-drift` 502 with prior-good retention, never a mid-normalization TypeError surfacing as a generic 500. Semantic gaps (missing team names) still classify via normalization, so partial usable coverage remains a success. (3) **File-fallback reads distinguish corrupt from absent** — `appStateStore.readFileStore` now treats ONLY `ENOENT` as absence; malformed JSON, permission, and other I/O failures PROPAGATE instead of reading as an empty store (which also protected the RMW write path from silently rebuilding the store from `{}` and discarding every other key). Odds usage now genuinely reports `unavailable` for a corrupt store through the real backend; new `__corruptAppStateFileForTests` seam exercises that path (distinct from the throw-injecting read seam). +7 tests (null-row 502, valid-sibling+malformed-row 502 with retention, lock serialization primitive, held-lock concurrent-commit no-clobber regression, appStateStore missing-vs-corrupt pair, odds-usage corrupt-store unavailable). Broad app-state-backed suites re-run green (server + odds/scores/schedule/cron/conferences/provider-status routes).

### PLATFORM-086G1-CFBD-SCORE-QUOTA-TRUTHFULNESS-v1

- Status: **Merged via PR #394 (`platform/086g1-cfbd-score-quota-truthfulness`, merge commit `987dd04`, 2026-07-14).** Two commits: the implementation plus the folded Codex P2 evidence-read remediation (below). The final pre-merge Codex review of the full branch diff was clean (no actionable findings).
- Purpose: Close deferred PLATFORM-086A findings #6 and #7 at the CFBD boundary as one cohesive PR: classify unexpectedly empty CFBD Scores responses contextually (target-scoped) instead of always treating them as valid no-ops, and represent missing/malformed CFBD quota fields as unavailable rather than coercing them into false zero-remaining/exhaustion. Prior-good retention and PLATFORM-086A durable-first/scope semantics preserved.
- Result:
  - **Scores empty classification** (new pure `src/lib/scores/emptyScoresClassifier.ts`; wired in `src/app/api/scores/route.ts`): `refreshScorePartition` no longer maps every empty CFBD array to a no-op. `classifyEmptyScoresResponse` judges the empty payload against target-scoped evidence gathered cache-only (`gatherEmptyScoresEvidence`): populated prior-good durable rows for the SAME cache key, or canonical-schedule games in the target that have started (parseable kickoff ≤ now) and are not disrupted (canceled/postponed/suspended/delayed via the canonical `gameStatus` predicates — disrupted games never independently create an expectation; missing schedule seasonType normalizes to regular, matching `scoreApplicability`). Unexpected empty → partition FAILURE with new stable code `'cfbd-empty-unexpected'` (502; added to `CfbdFallbackReason`): no durable overwrite, no process-cache publication, no standings invalidation, truthful failed attempt recorded against the exact partition/aggregate scope with an operator-facing message carrying both evidence counts. No evidence (future-only target, no expected games, disrupted-only, or a failed best-effort evidence read) → valid absence stays a recorded no-op preserving prior-good data. Nonempty responses (including partial ones — unresolved-game behavior unchanged), non-array/schema-drift classification, aggregate/partition scope recording, and season-type/week/year semantics are untouched; schedule remains the sole source of game identity; evidence reads never call a provider.
  - **CFBD quota honesty** (`src/lib/api/cfbdUsage.ts`; consumers `src/app/api/admin/usage/route.ts`, `src/lib/apiUsage.ts`, `AdminUsagePanel.tsx`, `ProviderDataStatusPanel.tsx`): `resolveCfbdUsage` no longer coerces absent/malformed provider fields (`Number(x ?? 0)` removed) — `CfbdUsage` fields are `number | null`. A missing/nonnumeric/non-finite/negative `remainingCalls` is `null` (never 0-remaining false exhaustion); an unusable `patronLevel` yields NO limit (never a guessed ceiling; unknown INTEGER tiers keep the existing canonical Tier 0 fallback); `used` is derived only when trustworthy (`remaining ≤ limit` — the old fabricated `used = 0` when remaining exceeded the limit is gone); a trustworthy `remainingCalls: 0` still derives genuine exhaustion (`used === limit`); a 200 with a non-object body resolves to all-unavailable (kept distinct from the thrown provider-read-failure path). `/api/admin/usage` passes a null canonical limit for an unusable tier; reconciliation/display authority remains solely with the existing canonical `normalizeProviderQuota` → `formatQuotaSummary` path (no duplicated normalization — unavailable renders as "quota status unavailable", tier-known/usage-unknown as "usage unavailable"); both admin panels render null raw diagnostic fields as "unavailable" / tier "unknown".
- Verification: `git diff --check`, `npx tsc --noEmit`, and `npm run lint:all` clean. New `src/lib/__tests__/emptyScoresClassifier.test.ts` (11 tests: prior-good/started-game evidence, future-only, disrupted statuses across separator styles, disrupted-not-masking-started, week/season-type scoping, missing-seasonType applicability parity, unparseable kickoffs). Expanded `src/lib/__tests__/cfbdUsage.test.ts` (missing/malformed/empty-payload fields, no guessed ceiling, genuine zero-remaining exhaustion, no fabricated used=0, and end-to-end unavailable/limit-known/valid/exhausted serialization composed exactly as `/api/admin/usage`); `src/lib/api/__tests__/cfbdUsage.test.ts` updated for the nullable contract. `src/app/api/scores/__tests__/route.test.ts`: the prior-good empty-refresh test now asserts the truthful 502 `'cfbd-empty-unexpected'` failure with prior-good retention and a failed week-partition attempt; new tests for started-schedule-games failure (no last-success advance), future-only no-op, and canceled/postponed-only no-op. Focused suites green (scores route 34; provider status/diagnostics/cache-state + score cache reader/scope + admin summary/manual-refresh 153; selectors 105). All verification via fixtures/mocks — no external provider APIs called.
- Scope guardrails: no Odds payload/usage changes (PLATFORM-086G2), no automation cadence, no diagnostics redesign (086F), no operator-settings changes, no ESPN fallback, no provider calls from public read paths, no parallel game-identity or schedule-matching system (evidence uses the canonical schedule cache and exact score cache keys only). PLATFORM-086A durable-first ordering, scope-aware status recording, and completion-token semantics untouched. `docs/next-tasks.md` / `docs/roadmap.md` 086G1 rows updated to implemented-in-review; 086G2/H/I and the automation sequencing preserved.
- Review remediation (PLATFORM-086G1-CODEX-P2-EVIDENCE-READ-REMEDIATION-v1, folded in pre-merge): resolved both Codex P2 findings on the empty-score evidence gatherer. (1) **Partition-only schedule layouts count** — schedule evidence reads through the canonical `loadCachedScheduleItems` fallback instead of only the aggregate `${year}-all-all` key, so a schedule stored solely under `${year}-all-regular` / `${year}-all-postseason` still makes an empty payload over a started target an `'cfbd-empty-unexpected'` failure. (2) **Independent evidence resolution** — the prior-score and schedule reads resolve via `Promise.allSettled`: a failed schedule read no longer discards populated prior-good score evidence and a failed prior-score read no longer discards started schedule-game evidence; a failed source is unavailable (contributes no evidence), never evidence of absence, and BOTH reads failing retains the conservative valid-absence no-op. Classifier semantics, quota behavior, refresh-status handling, and prior-good retention unchanged. +5 route regressions (regular/postseason partition-only layouts → 502; schedule-read failure with prior-good evidence → 502 + retention; prior-score-read failure with schedule evidence → 502; both reads failing → conservative 200 no-op).

### DOCS-009-PLATFORM-086-PLANNING-RECONCILIATION-v1

- Purpose: Implement the approved post-PLATFORM-086A planning reset as a narrow documentation-only change: record PLATFORM-086A as merged (PR #391) and the Markdownlint tooling as merged (PR #392); convert the seven confirmed deferred 086A findings into scheduled correctness tasks (PLATFORM-086G1/G2/H/I — initially a combined 086G, split by provider family in review remediation); redefine the remaining campaign boundaries (086B live scores only; 086C Odds only; 086D absorbed/retired; 086E1 weekly schedule refresh; 086E2 rankings refresh; 086F diagnostics redesign last); adopt the binding PR-sizing rule; and correct stale active planning facts (CFBD quota, season-transition cadence).
- Result: `docs/next-tasks.md` — campaign-status rows for the provider campaign; 086A marked merged via PR #391; the trailing seven-findings prose replaced with the 086G1/G2/H/I assignments; the stale 086B–F bullet replaced with the full revised task set, execution order (docs reconciliation → 086G1 → 086G2 → 086H → 086I → 086B → 086C → 086E1 → 086E2 → 086F → product work), the 086B→086G1 technical-dependency note (086H precedes 086B as campaign discipline, not a code dependency), and the binding PR-sizing rule (correctly sized, cohesive PRs — one cohesive objective per PR, cohesion-based splits by provider family/automation job/UI surface, >15 files / >1,500 net lines as stop-and-reassess signals rather than hard limits; PLATFORM-086A's 77-file/~12k-line scope and one-finding-per-PR fragmentation both named as failure modes). `docs/roadmap.md` — new Platform workstream section for PLATFORM-086 with canonical provider limits (CFBD Tier 1 5,000/month; Odds 500 credits, ~450 target / ~50 buffer, 3 credits/request); campaign-table rows; corrected the stale "Wednesday cron" (season-transition runs daily 00:00 UTC) and "1,000/month free tier" claims. `docs/prompt-registry.md` — this entry; 086A marked merged with a planning-reset addendum superseding its old 086B–086E forward references. `docs/completed-work.md` — appended PLATFORM-086A (PR #391) and Markdownlint tooling (PR #392) milestone entries. `CLAUDE.md` — stale "CFBD ~1000/mo" quota guidance corrected to Tier 1 5,000/month. `docs/operations/deployment.md` (permitted sixth file — its env-var table flatly asserted "Quota ~1000/month" for the production CFBD key, directly contradicting the tier-derived canonical limit and uncorrectable via the five planned files) — corrected to the tier-derived model (current key: Tier 1 = 5,000). Future prompt IDs (086G1/G2/H/I, 086B/C/E1/E2/F implementation prompts) are reserved in planning docs only — none are represented as issued/executed.
- Scope guardrails: Docs-only (`docs/next-tasks.md`, `docs/roadmap.md`, `docs/prompt-registry.md`, `docs/completed-work.md`, `CLAUDE.md`, plus the justified `docs/operations/deployment.md` quota-row fix). No application code, tests, cron config, `vercel.json`, or Markdownlint config changes; `src/lib/providerDatasets.ts` untouched (its stale `plannedPolicy` campaign attributions are tracked as follow-up code changes for each provider family's implementation PR). No provider calls, no mutation routes, no durable-state changes. Historical records (old completed-work quota references, the 086A entry's original prompt text) preserved as point-in-time records rather than rewritten.
- Follow-ups: Execute the provider campaign in the recorded order, starting with PLATFORM-086G1. Correct each dataset's `plannedPolicy` string in `src/lib/providerDatasets.ts` within that family's implementation PR.
- Review remediations (folded in pre-merge): (1) DOCS-009-CODEX-P2-ACTIVE-PRIORITY-REMEDIATION-v1 — the revised campaign plan was nested under the completed `### 3. APPSTATESTORE-CACHING` priority behind the INSIGHTS priorities, contradicting the execution order it declares; the campaign is now its own top-level `### 1. PLATFORM-086 — Provider correctness & automation campaign` (content moved, not rewritten; 086A-complete pointer added), later priorities renumbered 2–6, and the priority-number cross-references updated. (2) DOCS-009-CONSOLIDATED-REVIEW-REMEDIATION-v3 — three findings: **086G split by provider family** into PLATFORM-086G1 (CFBD: scores unexpected-empty #6, quota missing-field coercion #7) and PLATFORM-086G2 (Odds: malformed/unexpected-empty payloads #4, odds-usage read-failure vs. absence #3), G1 first, each its own PR, 086B now depends on G1 and 086C on G2 — an unsplit 086G would itself have violated the plan's mandatory-split rule (multiple provider families); **086E1 documented as requiring an operation-aware settings gate** — the weekly schedule refresh is noncritical and must honor the global pause + schedule toggle, but plain `isAutoRefreshAllowed('schedule')` short-circuits to allowed because the `schedule` dataset descriptor is lifecycle-critical for the season-transition cron (only season-transition/rollover keep the exemption; gate design deferred to the E1 prompt); and **stale relocation cross-references fixed** (`docs/roadmap.md` Active priorities #3 → #1; the 086A history bullet's "(see below)" → "see Active priority #1 above"). Findings #1/#5 (086H) and #2 (086I) unchanged — all seven findings still assigned exactly once. (3) DOCS-009-PR-SIZING-AND-REFERENCE-REMEDIATION-v1 — replaced the mechanical "smallest possible PR" framing with a **correctly-sized, cohesive-PR** standard: one cohesive objective with a clear acceptance contract, independently reviewable/verifiable/deployable/revertible; related fixes MAY ship together when they share a provider family or end-to-end behavior, share focused verification, and read as one unit; splits are driven by distinct provider families / automation jobs / substantial UI surfaces / different ship schedules; the 15-file / 1,500-net-line thresholds are stop-and-reassess signals, not hard limits; both oversized cross-cutting PRs AND artificial one-finding-per-PR fragmentation are named failure modes; the G1/G2/H (incl. its small no-op panel correction)/I groupings are affirmed as correctly sized and are not split further. Also swept the remaining unsplit-086G references in current summaries (this entry's Purpose/Result/future-ID list; the completed-work planning summary) to G1/G2/H/I — historical/supersession mentions of the original combined 086G are retained and labeled as such. (4) DOCS-009-E1-ROLLOVER-PREREQUISITE-REMEDIATION-v1 — refined the E1 gating boundary (superseding remediation (2)'s "only season-transition/rollover keep the exemption" parenthetical): E1 comprises two operation classes — general weekly schedule maintenance stays noncritical/pausable, while the **postseason/championship-slate refresh required to establish a trustworthy season-rollover boundary is lifecycle-critical and exempt** from the global pause and schedule toggle, so rollover never depends solely on schedule data operators can prevent from becoming complete, proceeds only from an authoritative championship boundary, and an empty or partial postseason slate never makes the latest known postseason game an authoritative rollover boundary. The operation-aware gate must distinguish these classes; the exact helper/API seam remains deferred to the E1 implementation prompt.

### PLATFORM-086A-REFRESH-OBSERVABILITY-v1

- Status: **Merged via PR #391 (2026-07-14).** Post-merge planning reset (DOCS-009-PLATFORM-086-PLANNING-RECONCILIATION-v1): this entry's original forward references to "086B–086E" cadences and "086D operator UI" reflect the campaign boundaries as they stood at issuance and are **superseded** — 086D is absorbed into this prompt's delivered scope (only the settings error-rendering remnant remains, → PLATFORM-086I); 086C is narrowed to Odds polling only; weekly schedule and rankings refresh are 086E1/086E2; game-stats missing-week recovery is PLATFORM-086H; and the seven deferred review findings are scheduled as PLATFORM-086G1/G2/H/I (086G was split by provider family in review remediation). Current boundaries live in `docs/next-tasks.md`.
- Purpose: Build the operational foundation for PLATFORM-086 provider-refresh automation: a durable per-dataset refresh-status model, truthful attempt/success/failure recording, a unified platform-admin provider-data status panel (freshness, failures, missing-data, quota), operator auto-refresh pause/enable controls, cache-only missing-data diagnostics, and a reusable user-facing freshness primitive. Does NOT add the live-score/odds/schedule/rankings cron cadences (those stay in 086B–086E).
- Result:
  - **Status model** (`src/lib/server/providerRefreshStatus.ts`, scope `provider-refresh-status`, one key per dataset): `beginProviderRefreshAttempt` / `recordProviderRefreshSuccess` / `recordProviderRefreshFailure`. Truthfulness invariants — a failure never advances `lastSuccessAt` (preserves prior-good source/rows), success is recorded only after the durable provider commit, and all record helpers are best-effort (swallow their own store errors, never throw into the provider path so a status write can't poison the data commit).
  - **Settings** (`src/lib/server/providerRefreshSettings.ts`, scope `provider-refresh-settings`): durable `globalPause` + per-dataset `enabled`, defaults preserve current behavior (nothing paused, all enabled). `isAutoRefreshAllowed(dataset)` gates NONCRITICAL auto refresh; lifecycle-critical `schedule` (season-transition cron) is exempt. No editable cron/cadence fields.
  - **Instrumentation**: all six refresh entry points record status — `/api/scores`, `/api/schedule`, `/api/odds`, rankings loader, `/api/conferences`, `/api/game-stats`, plus the season-transition cron (schedule) and the game-stats cron. The game-stats cron additionally honors `isAutoRefreshAllowed('game-stats')` (global pause + dataset toggle); manual `/api/game-stats?bypassCache=1` stays available while paused.
  - **Admin API + panel**: `GET/POST /api/admin/provider-status` (cache-only GET: statuses + settings + diagnostics + durable odds-usage snapshot; POST mutates pause/enable) and `ProviderDataStatusPanel` on `/admin/diagnostics` — per-dataset last attempt/success/age/error/rows/source/partial state, missing-data warnings, manual refresh (all six datasets) with expected provider cost, global pause + per-dataset toggles, and a read-only current-vs-planned automation summary.
  - **Diagnostics** (`src/lib/server/providerDataDiagnostics.ts`): cache-only — completed slates missing scores/game-stats, stale/partial schedule, stale/missing rankings, odds snapshot recency. Games without offered odds are never classified as a failure.
  - **Freshness UI** (`src/lib/freshness.ts` + `src/components/FreshnessLabel.tsx`): pure `formatRelativeTimestamp`/`describeFreshness` + a subtle muted chip; integrated as an "Odds updated …" label in the schedule app's live-status row (driven by the odds snapshot's own `capturedAt`, never a global timestamp).
  - CFBD usage display continues to derive its limit from the provider-reported patron tier (`resolveCfbdUsage`), never a hardcoded 1,000 (canonical Tier 1 = 5,000, corrected by the admin-truthfulness hotfix below) — surfaced with `remaining` as the authoritative figure (the user is on a higher tier).
- Scope preservation: no new provider calls on public/read paths (status GET is cache-only); PLATFORM-084A/084B/085A/085B/085C intact; canonical standings/Insights/archives/RSC gain no provider calls; canonical schedule stays the source of game identity; team identity stays in `teamIdentity.ts`; auth/quota boundaries unchanged. No new cron cadence, no `vercel.json` change, no editable cron strings.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. New tests (37): status truthfulness + best-effort, settings pause/enable + lifecycle exemption, freshness formatting, CFBD-limit-not-1000, cache-only diagnostics, provider-status API GET/POST + auth, game-stats cron pause + manual-still-available. Regressions green across scores/schedule/odds/conferences/season-transition/rankings routes, appStateStore, and standings selectors.
- Scope guardrails: new `src/lib/providerDatasets.ts`, `src/lib/freshness.ts`, `src/lib/server/providerRefreshStatus.ts`, `src/lib/server/providerRefreshSettings.ts`, `src/lib/server/providerDataDiagnostics.ts`, `src/components/FreshnessLabel.tsx`, `src/components/admin/ProviderDataStatusPanel.tsx`, `src/app/api/admin/provider-status/route.ts`; instrumentation edits to the six refresh routes + two crons; `CFBScheduleApp.tsx` (one freshness chip); `/admin/diagnostics` page wiring; docs. Explicitly NOT in scope: PLATFORM-086B live-score cron, 086C odds/schedule/rankings cadence, 086D operator UI beyond this panel, editable cron/quota fields, external alerting, DB migrations.
- Post-review remediation (PLATFORM-086A-CODEX-REMEDIATION-v1, folded in pre-merge): resolved all 7 Codex P2 findings. (1) diagnostics now group ALL games per slate and apply the completion threshold to the slate's max kickoff, so a split Thursday/Saturday week is not judged complete off the Thursday game. (2) manual game-stats refresh sends an explicit `seasonType`, so postseason repair hits the postseason cache key. (3) a `refresh=1` with a missing `ODDS_API_KEY` now records a matching failure (prior-good preserved) instead of a dangling attempt. (4) status helpers distinguish an absent record from a failed durable read — on a read failure they skip the write rather than null prior-good (new `__setAppStateReadFailureForTests` seam). (5) refreshes carry a unique attempt token + per-dataset in-process lock so overlapping attempts resolve deterministically (older late-resolving attempt can't clobber the newer attempt's error); cross-instance ordering documented as a best-effort limitation. (6) the panel treats a fallback response (`meta.fallbackUsed` / `local_snapshot`) as a failed refresh via a shared `interpretRefreshResponse`. (7) auto-refresh toggles are interactive only for datasets a live job consumes (`autoRefreshSettingConsumed`); the settings API rejects toggling planned/exempt datasets. New helper `src/components/admin/manualRefresh.ts`; +33 tests (concurrency permutations, read-failure, split-slate, postseason repair, missing-odds-key, fallback interpretation, honest-controls API).
- Third-review remediation (folded in pre-merge): resolved all 8 findings (1 P1 + 7 P2) of the third Codex review. (P1) `/api/scores` now rejects a **nonempty** CFBD payload that normalizes to **zero** score rows as schema-drift **failure** (parity with schedule 085C), plus a non-array guard — only a genuinely empty array remains a no-op, so stale scores are never silently frozen. (2) the season-transition cron resolves every begun attempt: an all-empty probe → no-op, a durable schedule-commit failure → recorded failure + rethrow. (3) it captures `committedAt`/`commitSeq` right after `setAppState` (before probe work) so probe work can't reorder success metadata. (4) an all-empty `/api/schedule` refresh records a no-op instead of advancing last-success with zero rows. (5) attempt IDs use `crypto.randomUUID()` (cross-process unique; a per-process counter collided across serverless instances). (6) a per-process monotonic **commit-sequence** tie-breaker orders two commits sharing the same-millisecond `committedAt` by true commit order, not record order. (7) `providerRefreshSettings` global-pause + dataset-toggle writes are serialized by an in-process lock (no lost update). (8) the stale-freshness window is per-dataset (`staleAfterMs` on the descriptor), not one 48h threshold for all. +67 tests.
- Seventh-review remediation (PLATFORM-086A-CODEX-SEVENTH-REMEDIATION-v1, folded in pre-merge): resolved all 3 P2 findings of the seventh Codex review — the server must own refresh applicability, client state must not mix years, and each attempt must preserve its most specific failure metadata. (1) the aggregate score-refresh endpoint is now **server-authoritative** for applicable partitions: a new shared `src/lib/server/scoreApplicability.ts` (`deriveApplicableScoreSeasonTypes` extracted from `providerDataDiagnostics.ts` + a cache-only `getApplicableScoreSeasonTypes(year)`) derives applicability from the durable schedule, and `handleAggregateScoreRefresh` uses it whenever the client omits/mis-sends `seasonTypes` — so `GlobalRefreshPanel` (which sent no list) and any client can no longer spend a doomed postseason CFBD request before bowls exist; a nonempty `seasonTypes` remains an explicit targeted repair. Both panels issue the ordinary form (`scoresAggregateRefreshUrl(year)` with no `seasonTypes`); the client-side `scoreSeasonTypes` threading was removed. (2) `ProviderDataStatusPanel.load()` now guards against a year-selection race with a monotonic request seq + `AbortController` + echoed-year validation (pure `isCurrentStatusResponse`), so an older year's response can't overwrite a newer selected year's feed, and superseded/aborted/unmounted loads set no stale error/spinner. (3) `loadSeasonRankings` resolves each attempt exactly once: the schema-drift branch records `rankings-partition-schema-drift` (+ `failedPartitions`) and throws a marked `RecordedRankingsRefreshError` that the outer catch rethrows WITHOUT a second generic `recordProviderRefreshFailure` (which previously erased the code); genuine fetch/network failures still record the generic code. +15 tests (server-derived applicability before/after postseason + no-schedule + explicit/invalid overrides + no doomed postseason call, year-race guard permutations, rankings drift code surviving the outer catch, generic-failure code). No ESPN, no diagnostics/applicability provider calls, no new cron cadence or `vercel.json` change.
- Admin-truthfulness hotfix (PLATFORM-086A-ADMIN-TRUTHFULNESS-HOTFIX-v2, folded in pre-merge): corrected the diagnostics page's operational truthfulness (impossible quota, misleading wording, ambiguous no-history state, year-selection races) without any dashboard redesign. (1) **CFBD Tier 1 = 5,000** — the stale `3,000` in `CFBD_LIMIT_BY_TIER` produced an impossible "0 used / 5,000 remaining / 3,000 limit"; the canonical map now lives once in `src/lib/api/providerQuota.ts` (`cfbdCanonicalLimitForTier`) and `resolveCfbdUsage` consumes it. (2) **Shared quota reconciliation** — new `normalizeProviderQuota` produces a single `NormalizedProviderQuota` (`used + remaining = limit`, single-missing-value derivation, canonical-limit fallback + inconsistent-mark for contradictory provider fields, "unavailable" when nothing is trustworthy); `/api/admin/usage` normalizes server-side and BOTH the Provider Data Status panel and the legacy **API Usage** panel render the same object (raw fields shown only as labeled diagnostic detail), so they can never disagree or show an impossible combination. (3) **Global control wording** — "Global automatic refresh — Active" → **"Global provider pause: Off/On"** (the persisted `globalPause` state), with supporting text that manual refresh + lifecycle transition keep running and most jobs are still planned; no persisted-setting or cron-behavior change. (4) **Refresh-history vs cached-data** — a dataset with no PLATFORM-086A status record is no longer a blanket "Never refreshed": new cache-only `getProviderCacheStates` (`src/lib/server/providerCacheState.ts`, one guarded read per dataset → `available`/`absent`/`unknown`, surfaced as `cacheStates` on the status feed) drives _serving cached data · no refresh history recorded_ / _no cached data or refresh history_ / conservative _no refresh history recorded_ — missing observability is never equated with missing data. (5) **Current-year isolation** — a live `yearRef` + `shouldApplyStatusResponse` (echoed-year AND selected-year) means a response for an abandoned year can't replace/error/re-spinner the current feed; a stale manual/settings callback can't start an old-year load or abort the current one; settings mutations reload the year selected at completion; manual refresh reloads only if its year is still selected; manual action state is keyed by `${year}:${dataset}` (`manualActionKey`) so results/spinners never leak across years. Legacy diagnostics (API Usage, Team Database, Storage Status, Score Attachment) preserved; dashboard redesign deferred to PLATFORM-086F. New `src/lib/api/providerQuota.ts`, `src/lib/server/providerCacheState.ts`; +tests (quota tier/reconciliation/inconsistency/agreement, cache-state availability/absent/unknown, no-history cache-state summaries, year+dataset action keying, current-year response guard). No ESPN, no provider calls on diagnostics/quota-status paths beyond the existing live CFBD `/info` read, no new cron cadence or `vercel.json` change.
- Final-truthfulness remediation (PLATFORM-086A-CODEX-FINAL-TRUTHFULNESS-REMEDIATION-v1, folded in pre-merge): resolved the two P2 findings of the Codex review of `c9cb776` — the panel could render wrong-year/fabricated state, and empty-schedule classification could strand an attempt `in-progress` after a prior-cache read failure. (1) **Valid-feed-only rendering** — `ProviderDataStatusPanel` renders dataset cards, diagnostics, the global-pause control, and the odds quota ONLY from a successful feed whose `feed.year` equals the selected year (new pure `panelFeedRenderState` in `manualRefresh.ts`). The `feed?.datasets ?? PROVIDER_DATASETS.map(placeholderRow)` fallback is gone (no fabricated "no history" rows); a loading request shows "Loading provider status for {year}…", a failed load with no valid feed shows "Provider status unavailable for {year}" (+error), and a year switch hides the prior year's cards immediately instead of showing them under the new year. The CFBD quota stays visible (independent per-mount read). (2) **Schedule prior-cache read guard** — both `src/app/api/schedule/route.ts` and `src/app/api/cron/season-transition/route.ts` wrap the prior durable schedule read used to classify an empty provider response: on a throw they record the open attempt as failed (`schedule-prior-cache-read-failed`, best-effort, prior-good retained, no no-op/success), the route returns its established 502 and the cron rethrows to its established 500 without transitioning off the unverifiable probe — neither leaves a dangling `in-progress` attempt, and recording-then-returning (route) / mirroring the durable-commit-failure rethrow (cron) avoids any duplicate terminal resolution. The read-failure test seam `__setAppStateReadFailureForTests` gained an optional `scope` (parity with the write seam) so a test can fail only `'schedule'` reads while `'provider-refresh-status'` writes still persist. +tests (panelFeedRenderState loading/unavailable/stale-year/ready; schedule + season-transition prior-cache-read-failed resolves failed, prior-good retained, no transition). Preserves all prior hotfix behavior, `classifyEmptyScheduleRefresh`, lifecycle safety, and legacy diagnostics; PLATFORM-086F still deferred. No new cron cadence or `vercel.json` change.
- Final-truthfulness remediation v2 (PLATFORM-086A-CODEX-FINAL-TRUTHFULNESS-REMEDIATION-v2, folded in pre-merge): resolved the three P2 findings of the Codex review of `b7e521e` — false prior-good claims on cold failures, game-stats results leaking across partitions, and empty conference commits recorded as success. (1) **Cache-state-aware failed messaging** — `providerStatusSummary.ts` `describeFailedRefresh(cacheState)` replaces the unconditional "prior-good data still serving": `available` → "prior-good cached data is still serving", `absent` → "no cached data is available" (a cold first failure never claims prior-good), `unknown` → "could not be determined", unsupplied → conservative "availability is unknown"; a historical `lastSuccessAt` never overrides current `cacheState === 'absent'`. The `cacheState` opt lost its `'unknown'` default so undefined is distinguishable. (2) **Game-stats partition identity** — `manualActionKey(year, dataset, { week, seasonType })` extends game-stats to `${year}:game-stats:${week}:${seasonType}` (others unchanged); the panel captures year/week/seasonType at action start and renders with the current partition, so a Week 1 regular result/spinner never shows beside Week 2 or postseason, and year isolation is preserved. (3) **Conferences empty/malformed rejection** — `src/app/api/conferences/route.ts` classifies the raw provider payload before any durable write: a non-array → `conferences-invalid-payload` failure, an empty array or a nonempty payload with zero usable rows (usable = non-empty `name`, `isUsableConferenceRecord`) → `conferences-no-usable-rows` failure — no durable write, prior-good retained, last-success not advanced, and the bundled fallback (`fallbackUsed`/`local_snapshot`) makes the admin interpreter report a failed refresh; ≥1 usable row commits durable-first + records success. The three fallback returns were consolidated into `conferencesFallbackResponse()`, and recording-then-returning inside the try avoids any duplicate terminal resolution by the outer catch. +tests (five failed-messaging cache-state permutations incl. history-does-not-override-absent; game-stats week/season-type/year key isolation + non-game-stats ignores the partition arg; conferences non-array / empty / zero-usable / usable-commit + prior-good retention + no empty cache). No ESPN, no new provider calls, no new cron cadence or `vercel.json` change; PLATFORM-086F still deferred.
- Scoped refresh-status model (PLATFORM-086A-SCOPED-REFRESH-STATUS-MODEL-v1, folded in pre-merge): resolved the adversarial-review finding that a refresh for one year, partition, week, or Odds query variant could appear as the operational status for another selected year or a broader target. Provider-refresh status is now keyed by a **canonical target scope**, not merely by dataset. **New `src/lib/providerRefreshScope.ts`** (client-safe): typed `ProviderRefreshScope` (`global` | `year` | `season-partition` | `week-partition` | `odds-target` | `legacy-unscoped`), scope constructors, one deterministic `providerRefreshScopeKey(dataset, scope)` (season-type normalized, Odds keyed by the existing durable `odds-cache` key, legacy-unscoped → bare dataset key so no migration is needed), plus `describeProviderRefreshScope`/`scopeMatchesKey`. **`providerRefreshStatus.ts`**: records self-describe (`scope`/`scopeKey` persisted; a stored record whose `scopeKey` disagrees with its key is ignored, not shown as truth); `beginProviderRefreshAttempt`/`record*` all take `(dataset, scope, …)`; the in-process RMW lock and attempt-token ordering are per scope key, so a completion for one target can never overwrite another; new `getLegacyProviderRefreshStatus` reads the pre-scoped record for deep diagnostics only. **Writers**: conferences=`global`; schedule=`year`; single-partition scores=`season-partition` while the aggregate refresh records an explicit `year` rollup after resolving every applicable partition; rankings=`year` rollup (one op always covers both partitions); game-stats week (manual+cron)=`week-partition` (a job-level cron missing-key failure records the `year` rollup); odds=`odds-target` (canonical vs filtered). **Admin feed** (`/api/admin/provider-status`): each dataset card reads only its canonical scope for the requested year (`canonicalCardScope`) — a targeted partition/week or filtered odds query never masquerades as the year's whole-target status — and the legacy record is returned separately as `legacyStatus`. The panel shows a scope chip per card and consumes only the canonical status; all prior year-isolation/loading/unavailable/action-keying behavior is preserved. +tests (11 scope-key construction/normalization; storage isolation across year/partition/week/late-completion/legacy/mismatch; admin feed isolation for cross-year, targeted week, filtered odds, global conferences, legacy). The other seven review findings (GameStatsCachePanel no-op wording, pause/toggle mutation-error rendering, odds-usage read-failure absence, odds schema-drift empty commit, game-stats partial-slate cron recovery, scores unexpected-empty no-op, CFBD quota missing-field coercion) remain **pending**; PLATFORM-086F dashboard redesign remains **deferred**. No ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Scoped-status review remediation (PLATFORM-086A-SCOPED-STATUS-REVIEW-REMEDIATION-v1, folded in pre-merge): resolved the four P2 findings of the focused Codex review of the scoped-status migration (`0db46b2`) — a subset operation must never establish success/freshness for a broader canonical target than it attempted. (1) **Targeted schedule scope** — new `scheduleRefreshScope(year, week, seasonType)` in `providerRefreshScope.ts` reserves the `year` rollup for the **full-year** refresh only (`week === null` + all season types); a specific `seasonType` records the `season-partition` and a specific week records the `week-partition`, so a `regular`/`postseason`/single-week schedule repair no longer writes the whole-year status (`src/app/api/schedule/route.ts` captures one `scheduleScope` before begin and threads it through every resolver). (2) **Complete-applicable score aggregate** — new `scoresAggregateScope(year, attempted, applicable)` writes the `year` rollup only when the attempted partitions cover **every applicable** partition; a caller subset that omits an applicable sibling (e.g. `seasonTypes=postseason` while regular is applicable) records its own `season-partition` (`src/app/api/scores/route.ts` derives `applicableSeasonTypes` via `getApplicableScoreSeasonTypes` and threads `aggregateScope` through begin + all four resolvers). (3) **Week-specific score scope** — new `scoresPartitionScope(year, week, seasonType)` records a whole-partition refresh (`week === null`) against the `season-partition` and a week-specific refresh against the `week-partition`, so a Week 3 repair never overwrites the whole regular/postseason partition. (4) **Misrouted-token rejection** — `providerRefreshStatus.ts` replaces the log-only `assertAttemptScope` with `isMisroutedAttempt`: a completion token whose `dataset` or `scopeKey` disagrees with the target being resolved causes the record helper to **skip the write** (log-only, never thrown into the provider path), so a 2025-schedule token can't mutate 2026, a regular token can't touch postseason, and a scores token can't resolve schedule — a valid, matching token still resolves normally. +tests (scope-helper selection for schedule full-year/partition/week and score partition/aggregate-completeness; provider-status token-mismatch rejection across year/partition/dataset/no-op with happy-path intact; scores route week-partition + targeted-subset year-rollup isolation; admin feed targeted-schedule-partition + targeted-postseason-score do not advance the year card). Full suite green (1550). The other seven review findings and PLATFORM-086F dashboard redesign remain **deferred** (unchanged by this pass). No ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Scoped-status review remediation v2 (PLATFORM-086A-SCOPED-STATUS-REVIEW-REMEDIATION-v2, folded in pre-merge): resolved the three P2 findings of the Codex review of `f460be1` — a refresh outcome must belong to the exact canonical target attempted, a combined operation must not be coerced into one child, and the file fallback must not lose a durable record under concurrent writers. (1) **Game-stats cron week scope** — `src/app/api/cron/game-stats/route.ts` resolves its target week (`findLatestCompletedWeek`, cache-only) BEFORE the `CFBD_API_KEY` check and captures ONE `weekPartitionScope` reused by every terminal resolver, so a missing-key failure records against that exact week partition (not `game-stats:year:<year>`) and a later successful run of the same week replaces it; a run with no applicable target returns the established skipped response with no scoped failure and no provider call, and a target-resolution read failure uses the established 500 path without mutating any data scope. (2) **Schedule `week + all` split** — `scheduleRefreshScope` now **throws** for a specific week with `seasonType='all'` (was coercing to the regular week partition); `src/app/api/schedule/route.ts` handles that request via a new `refreshScheduleWeekPartition` per applicable child (regular + postseason), each with its own attempt, durable child-key commit, and week-partition status (own row count/source/errors), so a postseason failure never marks regular failed and a regular success never stores combined rows or collides with a later regular-only refresh; the aggregate HTTP response contract is preserved (200 combined items on success, 502 with committed+failed partitions on any child failure), and the full-year (`week === null`) and single-partition forms are unchanged. (3) **File-fallback write serialization** — `src/lib/server/appStateStore.ts` adds a per-backing-file mutex (`withFileWriteLock`, keyed by the normalized absolute path, mirroring `withScopeLock`) wrapping the whole-file read→modify→temp-write→atomic-rename critical section of `setAppState`/`deleteAppState`, across ALL keys/scopes, so concurrent writers to different keys cannot each read the same snapshot and drop one another's update on rename. The lock applies only to the file fallback (Postgres relies on the DB), never serializes reads, sits strictly below the per-scope status lock, and releases on every outcome (the write-failure test seam now throws inside the critical section to exercise release). +tests (cron missing-key week/postseason scope + no-target no-failure + resolution-failure no-mutation + failure-then-success replacement; schedule week+all both-succeed/regular-success+postseason-fail/valid-empty-postseason-no-op/later-regular-no-collision/explicit-all/both-empty; appStateStore concurrent-different-keys survival, provider-status+unrelated concurrent survival, interleaved writes+delete, failed-write lock release). Full suite green (1564). The seven deferred review findings and PLATFORM-086F remain **deferred** (unchanged); cross-process file locking remains out of scope. No ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Week+all aggregate-cache remediation (PLATFORM-086A-WEEK-ALL-AGGREGATE-CACHE-REMEDIATION-v1, folded in pre-merge): resolved the single P2 of the Codex review of `bee2f04` — the `week + all` split refresh persisted only the regular/postseason child cache keys, but the cache-only read path still loads the aggregate `<year>-<week>-all` key, so a subsequent anonymous read returned 503 / a stale entry and an admin cache miss re-fetched despite a successful refresh. Fix (`src/app/api/schedule/route.ts`): after all applicable children resolve **without failure**, the combined child rows (the same canonical rows already committed to the child caches) are persisted durable-first under the aggregate `cacheKey`, then mirrored to the process cache — restoring the read contract while keeping provider-refresh status strictly child-scoped (the aggregate entry has NO status of its own; no `all`-week/year/season rollup is introduced). The aggregate write happens ONLY when ≥1 child committed rows: a both-no-op week writes no aggregate entry (preserving the no-op/prior-good semantics), and the partial-failure branch returns before it so a partial result can never replace prior-good aggregate data. A failed aggregate write after successful child commits does NOT roll back the child caches or rewrite their (succeeded) statuses and does not synthesize a child provider failure — it returns `schedule-week-all-aggregate-cache-commit-failed` (500), and the atomic file write leaves the prior-good aggregate entry intact. The write-failure test seam gained an optional per-**key** filter (`__setAppStateWriteFailureForTests(error, scope, key)`) so a test can fail only the aggregate key while child-key commits still persist. +tests (aggregate entry carries both partitions + cache-only read serves it with no provider call; stale aggregate replaced; partial failure retains prior aggregate; valid-empty sibling → aggregate from the applicable child; both-empty → no aggregate entry; aggregate-commit failure keeps child successes + retains prior aggregate + reports the code). Full suite green (1566). The seven deferred review findings, the two separate Markdownlint tooling findings, and PLATFORM-086F all remain **deferred/out of scope**; no aggregate status scope, no new schedule scope type, no ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Week+all read-composition remediation (PLATFORM-086A-WEEK-ALL-READ-COMPOSITION-REMEDIATION-v1, folded in pre-merge): resolved the two P2 regressions the materialized `<year>-<week>-all` aggregate write (WEEK-ALL-AGGREGATE-CACHE-REMEDIATION-v1) introduced, by **replacing the second authoritative derived copy with read-time composition** — the invariant is "week + all read → compose from exact child partitions → use the legacy aggregate only as compatibility fallback → never maintain a second authoritative derived copy." The v3 write could (a) **drop prior-good rows**: with a pre-split aggregate covering both partitions but no child keys, one nonempty child plus one provider `[]` (classified as a no-op only against the missing child key) rewrote the aggregate with just the nonempty child's rows; and (b) **go stale**: a later targeted `?week=W&seasonType=regular` repair updated only the regular child, leaving the materialized aggregate (and its process-cache copy) serving pre-repair rows past TTL. Fix (`src/app/api/schedule/route.ts`): the materialized aggregate write (durable + process) and the `schedule-week-all-aggregate-cache-commit-failed` path are **removed**; the cache-only `week + all` read is now COMPOSED at read time by `readComposedWeekAllEntry` — per partition the precedence is **exact child cache `<year>-<week>-<seasonType>` (process cache, then durable) → matching partition rows of the legacy `<year>-<week>-all` aggregate (partitioned by canonical `item.seasonType`, durable-only, never promoted/mutated/deleted) → absent**, with the composed view stale iff its OLDEST contributing partition is stale, a full miss (no child, no legacy) returning 503 to non-admins / triggering an admin refresh, and single-partition coverage served truthfully. So a targeted child repair is reflected immediately and no derived copy can drift. Consistent with the composition, `refreshScheduleWeekPartition`'s empty-response classifier now consults the matching legacy-aggregate partition rows as prior-good: a provider `[]` for a partition whose child key is absent but which the legacy aggregate still covers is a rejected **unexpected empty replacement** (recorded child failure), never a silent no-op. The per-**key** write-failure test seam added in v3 had no remaining use (the aggregate-commit test was its only caller), so `__setAppStateWriteFailureForTests` was reverted to its scope-level signature (`(error, scope?)`); child-scoped status is preserved exactly (no aggregate/`all`/year/season status rollup) and the file-fallback serialization is unchanged. +tests (rewrote the week+all block for composition: legacy-only fallback read; child-precedence-over-legacy; `[]` over legacy-covered partition → failure + legacy retained; targeted-repair reflected by composed read; incomplete single-partition coverage; full-miss non-admin 503; stale composed view rebuildRequired; fresh+stale partitions → stale composed view; both-succeed writes no aggregate entry). Full suite green (1572). The seven deferred review findings, the two Markdownlint tooling findings, and PLATFORM-086F all remain **deferred/out of scope**; no new schedule scope type, no ESPN, no new provider calls, no new cron cadence or `vercel.json` change.
- Week+all composition-freshness remediation (PLATFORM-086A-WEEK-ALL-COMPOSITION-FRESHNESS-REMEDIATION-v1, folded in pre-merge): resolved the two P2 cache-freshness defects the read-composition implementation (`53f5cc3`) introduced. (1) **Expired process child masked newer durable data** — `readComposedWeekAllEntry` used any present `SCHEDULE_ROUTE_CACHE` child without consulting durable storage, so once a warm instance's process child passed TTL it kept composing the stale rows (and returning `rebuildRequired` to non-admins) even after another instance / a targeted repair committed a newer durable child, unlike the single-key path which re-reads durable after a process miss/expiry. Fix: a new shared `resolveChildCache(childKey, now)` mirrors the single-key contract — a FRESH process entry is a fast-path hit (no durable read), an EXPIRED or absent one re-reads durable (refreshing the process mirror and using the durable timestamp), and an expired entry with no durable row is absence (not a fresh hit). (2) **Empty legacy partition poisoned freshness** — a pre-split aggregate holding only regular rows (normal before postseason) still produced a postseason legacy resolution with `items: []` at the old legacy timestamp, dragging the composed `min(at)` stale even when the real coverage (a fresh regular child) was fresh — so non-admins saw false `rebuildRequired` and admins refetched. Fix: an empty legacy partition extraction (`legacyPartitionRows(...).length === 0`) adds no resolution — no rows, no timestamp, no source. Composed freshness now derives only from partitions that contribute actual rows. No materialized aggregate or aggregate status is reintroduced; child-scoped status, per-scope attempt ordering, and file-fallback serialization are unchanged. +7 tests (expired process child reloads newer durable regular/postseason; fresh process child served with zero durable reads via the read-failure seam; expired-process-no-durable → non-admin 503 not a stale hit; empty legacy postseason/regular does not stale a fresh sibling child; regular-only legacy composes at its own timestamp). Full suite green (1579). The seven deferred review findings, the two Markdownlint tooling findings, and PLATFORM-086F all remain **deferred/out of scope**; no new provider calls, cron cadence, or `vercel.json` change.
- Sixth-review remediation (PLATFORM-086A-CODEX-SIXTH-REMEDIATION-v1, folded in pre-merge): resolved all 5 P2 findings of the sixth Codex review — a healthy partition, valid no-op, or stale fallback must never conceal failure or schema drift in another partition. (1) rankings partitions are validated **independently before combining** (`classifyRankingsPartition` in `src/lib/server/rankings.ts`): a nonempty partition that normalizes to zero usable weeks is schema drift (`rankings-partition-schema-drift`) that rejects the whole aggregate and retains prior-good, so a usable partition can no longer mask a drifted one and drift is never a no-op (raw-empty still classifies as pre-poll no-op or empty-over-prior-good rejection). (2) the season-transition cron shares the schedule route's **one** empty-response classifier (`classifyEmptyScheduleRefresh` in `scheduleSeasonFetch.ts`): an empty probe over a populated prior-good schedule is a rejected failure (`schedule-empty-replacement-rejected`, prior-good retained, and the league does not flip off the empty probe) instead of a silent no-op. (3) status classification is **separator-agnostic** — `gameStatus.ts` normalizes provider/cache enum labels to space-delimited tokens before matching (`normalizeStatusTokens`), so `STATUS_CANCELED`/`STATUS_POSTPONED` are correctly terminal/disrupted (a bare `\b` boundary silently failed on `_`), keeping the score-terminal and game-stats-applicability logic honest. (4) the manual score refresh is **one aggregate action**: the admin panels issue a single `refresh=1&aggregate=1` request that fans out over the applicable partitions under ONE `scores` attempt (`handleAggregateScoreRefresh`), resolving exactly once from the combined outcomes (all-succeed → success, any-fail → failure with `failedPartitions` + `partialFailure`, all-no-op → no-op) so a partition's no-op/success can never erase another's failure; a direct single-partition `refresh=1` still records its own attempt (shared `refreshScorePartition` core). (5) the shared manual-refresh interpreter treats a **stale** prior-good fallback (`meta.stale`/`meta.rebuildRequired`, e.g. rankings after rejecting an empty/drifted replacement) as a failed refresh, alongside `meta.fallbackUsed`/`local_snapshot`. +16 tests (independent rankings drift permutations, shared schedule empty classifier, underscore/hyphen/spaced enum classification, aggregate score-refresh outcome permutations, stale rankings fallback). No ESPN, no diagnostics provider calls, no new cron cadence, no `vercel.json` change.
- Fifth-review remediation (PLATFORM-086A-CODEX-FIFTH-REMEDIATION-v1, folded in pre-merge): resolved all 6 P2 findings of the fifth Codex review — coverage/freshness must reflect applicable canonical expectations and usable data. (1) a shared `expectsGameStats` helper (`src/lib/gameStats/coverage.ts`) defines stat-producing games (disrupted = canceled/postponed/suspended/delayed excluded via `gameStatus.ts`), used by BOTH the cron slate selection and the diagnostics so a disrupted-only slate is never selected (no wasted CFBD quota) nor flagged missing. (2) the game-stats cron `findLatestCompletedWeek` skips disrupted-only slates and picks the latest _eligible_ slate. (3) odds diagnostics read only the CANONICAL/DEFAULT season-scoped cache entry (`defaultOddsCacheKey`, hoisted with the default filter sets + `createOddsCacheKey` into `routeInternals.ts`) — never the newest across filtered markets/bookmakers keys — so a filtered refresh can't make the served snapshot look fresh; absence → unknown. (4) `isUsableGameStatsRow` now requires nonempty (trimmed) `home.school`/`away.school` — a blank-identity row (CFBD omitted/renamed the team field) is not coverage and doesn't stop cron repair. (5) both the cron and manual `/api/game-stats` route share `classifyGameStatsPayload`: a genuinely empty CFBD array → `no-op` (no `games: []` write, no last-success advance), a nonempty payload with zero usable rows → failure (`game-stats-no-usable-rows`, prior-good retained), ≥1 usable row → commit. (6) rankings diagnostics require ≥1 usable week in `response.weeks` (empty record ≠ coverage), and `loadSeasonRankings` classifies an empty refresh before persistence (pre-poll empty → no-op without persisting; empty over prior-good → failure `rankings-empty-replacement-rejected` retaining prior rankings). +20 tests (disrupted-slate cron skip + diagnostics suppression, blank-identity usability, payload classification, canonical vs filtered odds freshness, rankings empty coverage/no-op/reject). No ESPN, no diagnostics provider calls, no deferred cadence added.
- Fourth-review remediation (PLATFORM-086A-CODEX-FOURTH-REMEDIATION-v1, folded in pre-merge): resolved all 5 P2 findings of the fourth Codex review — observability must describe the data actually committed/served. (1) an **all-empty schedule** refresh is classified BEFORE any durable/process-cache write: an empty result over an already-populated schedule is **rejected** as an unexpected replacement (`502`, prior-good retained, recorded failed, `code: 'schedule-empty-replacement-rejected'`), while a genuinely inapplicable/unpublished empty resolves as a no-op — never committed-empty-then-labelled-a-no-op. (2) completed-slate **score** coverage requires a canonical **terminal** classification (new `isCanceledStatusLabel` in `gameStatus.ts`: final or canceled — an in-progress numeric row no longer counts, and postponed/suspended/delayed/unknown stay unresolved). (3) **game-stats** coverage is content-based via shared `src/lib/gameStats/coverage.ts` (`hasUsableGameStats`/`usableGameStatsGameIds`): a `games: []` or all-dropped record is not coverage, partial coverage surfaces as an info note, and the game-stats cron re-fetches such a week instead of treating the key as cached. (4) odds staleness derives from the season-scoped `odds-cache` `lastFetch` (via `getAppStateEntries('odds-cache', '${year}:')`), decoupled from the global quota-observation timestamp; quota usage stays a separate panel display. (5) the served-odds `FreshnessLabel` mounts in the normal clean state — extracted pure `shouldRenderLiveStatusSection` predicate now includes `oddsSnapshotAt`. +22 tests (schedule empty-replacement/inapplicable-no-op, terminal/canceled/unresolved score coverage, game-stats content/partial/cron-retry, season-scoped vs quota odds freshness, clean-state label predicate). No ESPN fallback or deferred cron cadence added.
- Second-review remediation (PLATFORM-086A-CODEX-REREVIEW-REMEDIATION-v1, folded in pre-merge): resolved all 7 findings of the second Codex review of the remediated commit, plus a product decision to remove ESPN as an automatic score fallback. **ESPN removal:** CFBD is now the sole normal production score provider — `/api/scores` no longer fetches ESPN or writes ESPN-sourced durable rows; a valid empty CFBD partition is a **no-op / valid absence** (200, prior-good preserved), and a CFBD failure preserves prior-good and reports a failure (dead `toScorePackFromEspn` + `Espn*` types deleted; the `source` union keeps `'espn'` only to read legacy cache entries). Findings: (1) manual score refresh fans out only over applicable partitions the feed derives cache-only from the schedule (`scoreSeasonTypes`) — skips a doomed postseason request pre-bowls — and the route's valid-empty→no-op means the action no longer reports failure. (2) the user-facing Odds freshness label now uses the SERVED season's odds cache-entry timestamp (`meta.snapshotCapturedAt`, threaded through `useLiveRefresh`), not the global quota snapshot or admin usage poll. (3) success ordering uses an explicit `committedAt` (durable commit time) so an older commit recording status late can't overwrite a newer commit. (4) the admin status feed reads durable odds usage once per request (`forceRefresh`) and shares it with the odds diagnostic, so a cross-instance refresh isn't masked by the process memo. (5) conferences, rankings, and both game-stats entry points now begin the attempt before credential validation and record a missing-key failure (parity with odds). (6) a schedule durable-commit failure resolves the open attempt as failed instead of dangling. (7) the panel summary reads an explicit `latestAttemptOutcome` (`in-progress`/`succeeded`/`partial`/`failed`/`no-op`) — extracted to pure `providerStatusSummary.ts` — so an in-flight/interrupted/no-op attempt is never mislabeled from historical fields; new `recordProviderRefreshNoop` + scope-aware `__setAppStateWriteFailureForTests`. +40 tests (commit-time ordering, no-op semantics, outcome state transitions, panel summary, applicable partitions, durable odds read, missing-key parity across routes/cron, schedule commit failure, ESPN-removal/valid-empty). Distributed limitation unchanged: cross-instance status writes remain best-effort (no store CAS), but explicit commit timestamps + attempt IDs remove the within-process ordering and unresolved-attempt hazards.

### PLATFORM-085C-SCHEDULE-ROUTE-SCHEMA-DRIFT-SAFETY-v1

- Purpose: Close the narrow edge PLATFORM-085B intentionally left open — the authorized `/api/schedule` refresh could treat a successful provider fetch whose **nonempty** payload normalizes/builds to **zero** schedule rows as a successful empty partition, committing (or overwriting good state with) an empty/incomplete schedule. Apply the 085B nonempty→zero-is-uncertainty rule to the schedule route.
- Root cause: `fetchSeasonType` (`src/app/api/schedule/route.ts`) mapped the upstream `CfbdScheduleGame[]` to `ScheduleItem[]` and returned `{ items }` even when a **nonempty** upstream dropped every row (missing team/week, shape change) — a `fulfilled` result with zero items. The GET handler's completeness gate (`hasRequiredSeasonTypeFailure`) only reacted to a **rejected** `fetchSeasonType`, so a schema-drifted partition passed as a "successful empty" one and (for `all`) could commit the other partition as a complete `partialFailure:false` schedule, or (for a single/week request) commit an empty schedule.
- Result: `fetchSeasonType` now **throws** on (a) a non-array upstream payload and (b) a nonempty upstream (`upstream.length > 0`) that maps to zero rows (`items.length === 0`) — schema drift → uncertainty. A thrown partition lands in `failedSeasonTypes`, and the existing gate returns `502` (with `failedSeasonTypes` for an `all` request, or the drift message for a single/week request) BEFORE the PLATFORM-085A durable-first commit block — so the durable `${cacheKey}`, `SCHEDULE_ROUTE_CACHE`, and standings invalidation are all left untouched and prior-good durable schedule is retained. A legitimately **empty** upstream array (`upstream.length === 0` — postseason before bowls, a future week) is unchanged: it returns `[]` and commits normally as valid absence. No change to the admin schedule route's completeness gate, durable-first ordering, or the season-transition cron (which already had its own equivalent classification from 085B).
- Scope preservation: no provider calls added; public `/api/scores`/`/api/odds` stay cache-only; canonical standings/Insights/archives/RSC gain no provider calls; PLATFORM-084A/084B/085A/085B intact; canonical schedule stays the source of game identity (no new identity/matching); auth/quota unchanged.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. Schedule route test extended to 10 (existing 7 + new: schema-drift single-regular refresh → 502 + prior-good durable retained + zero standings tags via `workAsyncStorage` capture; schema-drift within `all` → 502 `partial upstream error` with `failedSeasonTypes:['regular']` + no commit; empty-postseason `all` refresh → 200 commit with `partialFailure:false`). 111 tests green across schedule/scores/cron-season-transition routes, `scheduleSeasonFetch`, scoreCacheReader, selectors-leagueStandings, seasonRollover, seasonArchive.
- Scope guardrails: `src/app/api/schedule/route.ts` + its test, plus docs (`AGENTS.md` Core rule #1, `storage-and-caching.md`, `game-data-flow.md`, `operations/deployment.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-086 refresh cadence, transition state-machine redesign, a global provider-schema-validation framework, new cron jobs.

### PLATFORM-085B-SEASON-TRANSITION-SCHEDULE-SAFETY-v1

- Purpose: Make season-transition schedule refreshes safe against partial provider results — do not durably commit partial/uncertain schedule data as a complete transition refresh, and retain prior-good durable schedule state when completeness is uncertain. Fixes ARCH-AUDIT-002's high-severity finding that transition/schedule refresh paths could treat partial provider success as complete fresh schedule state. Companion to PLATFORM-085A (which fixed memory-before-durable ordering); the broader transition state-machine / cron cadence (PLATFORM-086) stays deferred.
- Root cause: the season-transition cron (`src/app/api/cron/season-transition/route.ts`) reimplemented schedule fetching WITHOUT the completeness gate the admin schedule route already has (`hasRequiredSeasonTypeFailure`). Its `fetchCfbdSchedule` looped regular+postseason, swallowed a per-partition fetch failure ("continue with partial data"), and the handler wrote the survivors under `${year}-all-all` with `partialFailure: false` — i.e. a postseason fetch failure committed regular-only rows as a COMPLETE schedule, which canonical standings / Insights / rollover then read as authoritative.
- Result: `fetchCfbdSchedule` now returns `{ items, failedSeasonTypes }`, classifying each requested partition: a fetch that **throws**, returns a **non-array**, or normalizes a **nonempty** payload to **zero** rows (schema drift) is recorded as failed/uncertain; a successful fetch returning **zero** rows (e.g. postseason before bowls) is valid absence. The handler gates the durable schedule + probe write on `!hasRequiredSeasonTypeFailure('all', failedSeasonTypes)` — on any failure it retains prior-good durable schedule/probe, sets `partialFailure`/`failedSeasonTypes` on the year result, and does NOT cache/probe/transition from partial data (the next cron run retries). A complete-but-empty combined result writes nothing (never overwrites a good schedule with empty). The lifecycle status flip continues to run off the validated (current or prior-good) probe, so it only acts on complete schedule data; standings invalidation still fires only on the durable status flip (PLATFORM-071 behavior preserved). Also read `CFBD_API_KEY` at call time instead of a module-load const (removes an import-time capture fragility, aligns with the scores/schedule routes, enables deterministic tests).
- Scope preservation: no provider calls added; public `/api/scores` and `/api/odds` stay cache-only without `refresh=1`; canonical standings / Insights / archives / RSC gain no provider calls; PLATFORM-084A, 084B, 085A behavior intact; canonical schedule stays the source of game identity (no new identity/matching). The admin schedule route already gates `all` requests on any partition failure (502, no commit), so only the cron reimplementation needed fixing.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. Cron route test extended to 7 (existing 3 + new: partial postseason failure → no commit/probe/transition/invalidation; prior-good schedule retained on partial fetch; nonempty→zero-rows schema drift treated as uncertainty; complete fetch commits durable schedule + probe). 117 tests green across cron season-transition, schedule/scores routes, durable-odds + odds-usage + rankings stores, scoreCacheReader, selectors-leagueStandings, seasonRollover, seasonArchive.
- Scope guardrails: `src/app/api/cron/season-transition/route.ts` + its test, plus docs (`AGENTS.md` Core rule #1, `storage-and-caching.md`, `game-data-flow.md`, `operations/deployment.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-086 refresh cadence / cron ownership, transition state-machine redesign, a global provider-schema-validation framework, new cron jobs, the admin schedule route's own nonempty→zero-mapped edge (it flags `partialFailure` truthfully and gates `all` on fetch failures — left as-is).

### PLATFORM-085A-PROVIDER-CACHE-COMMIT-ORDER-v1

- Purpose: Make provider cache writes durable-first so process memory never publishes "fresh" provider data before durable storage succeeds. Fixes ARCH-AUDIT-002's high-severity finding that a failed durable write could still appear fresh on one server instance. Scope limited to commit ordering; PLATFORM-085B (season-transition/partial-result safety) explicitly deferred.
- Result: Audited every provider refresh write path that maintains a process-local cache alongside durable app-state and reordered each to persist durably BEFORE publishing to memory and BEFORE invalidating standings. Sites fixed: scores route `SCORES_CACHE` (CFBD + ESPN branches), schedule route `SCHEDULE_ROUTE_CACHE`, odds route raw `oddsCache.entries`, conferences route `ConferencesRouteCache`, rankings cache `src/lib/server/rankings.ts` `CACHE` (found in Codex review — the initial audit missed it), durable canonical-odds store `setDurableOddsStore` + `updateDurableOddsStore` (`memoryStore`), and odds-usage memo `setLatestKnownOddsUsage`. Because the durable `await setAppState(...)` now lexically precedes the memory assignment, a throwing write short-circuits before the process cache is touched, and standings invalidation (already sequenced after the awaited write) only fires on a committed change. Read paths that hydrate the process cache from a durable read (cache-warming on a hit) were left as-is — that data is already durable.
- Quota/behavior preservation: no provider calls added or removed; public `/api/scores` and `/api/odds` remain cache-only without authorized `refresh=1`; PLATFORM-084A failure-vs-absence and PLATFORM-084B score reconciliation unchanged. Note: in the scores route the CFBD branch's existing try/catch still treats a durable-write failure as a provider failure and falls through to the ESPN branch (which also cannot persist and returns an error) — no fresh data is published either way; leaving that try/catch shape is within the "commit ordering only" scope (see Risks).
- Testing seam: added a narrow test-only `__setAppStateWriteFailureForTests(error)` to `appStateStore` (makes `setAppState` throw while reads still succeed; auto-cleared by `__resetAppStateForTests`) so durable-write-failure ordering is directly testable. New tests: durable-odds store (update + set: a write failure does not advance `memoryStore`; durable also unchanged), odds-usage store (write failure does not advance the memo), a scores-route integration test (a refresh whose durable write fails returns non-200 and a subsequent public read serves empty — process cache never poisoned), and a rankings integration test (a refresh whose durable write fails leaves `CACHE` unpopulated so a follow-up read demands an admin refresh instead of a poisoned hit; the success case still publishes to `CACHE`).
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. 138 tests green across scores/schedule/odds/conferences routes, durable-odds + odds-usage stores, odds durability, scores-scope, scoreCacheReader, selectors-leagueStandings, seasonArchive.
- Scope guardrails: `src/app/api/scores/route.ts`, `src/app/api/schedule/route.ts`, `src/app/api/odds/route.ts`, `src/app/api/conferences/route.ts`, `src/lib/server/durableOddsStore.ts`, `src/lib/server/oddsUsageStore.ts`, `src/lib/server/appStateStore.ts` (test seam), new/updated tests, plus docs (`AGENTS.md` Core rule #1, `storage-and-caching.md`, `game-data-flow.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-085B season-transition/partial-result safety, PLATFORM-086 refresh cadence, provider quota boundaries, canonical identity construction, new cron jobs.

### PLATFORM-084B-CANONICAL-SCORE-CACHE-RECONCILIATION-v1

- Purpose: Make canonical standings, rollover/archive, and public `/api/scores` use the SAME cache-only score reconciliation, so a week-specific score cache refresh (visible on `/api/scores`) is no longer invisible to canonical standings, Insights, and season archives (they previously read only the `${year}-all-*` score keys). Resolves ARCH-AUDIT-002's deferred score-cache mismatch finding.
- Result: Extracted the public season-wide reconciliation (`aggregateSeasonScoresResponse`) into a shared cache-only reader `loadReconciledSeasonScores` (`src/lib/server/scoreCacheReader.ts`). It reads every `scores` entry for `(year, seasonType)` — season-wide `${year}-all-${seasonType}` + per-week `${year}-<week>-${seasonType}` — in one bounded prefix read and dedupes rows by canonical game identity (home/away pair resolved via `teamIdentity.ts` + UTC date), newest cache entry winning per game (an empty newer entry contributes no rows, so it cannot erase a populated one). Three consumers now share it: (1) public `/api/scores` season read (route refactored to delegate; behavior byte-identical — same bundled-catalog + league-agnostic alias source, same freshness/empty semantics); (2) canonical standings `loadNormalizedScoreRows` (now takes the caller's already-loaded `teams`/`aliasMap`); (3) `buildSeasonArchive` (season rollover / admin backfill / admin rollover / cron season-rollover all funnel through it, so no per-route wiring). No new game-identity construction, no raw-label matching, no ownership/attachment/schedule changes; scores still attach to canonical schedule games.
- Quota + failure semantics: the reader is cache-only — no CFBD/ESPN call and no write; provider fetch remains solely on the authorized `refresh=1` branch of `/api/scores` (PLATFORM-075 intact). It honors PLATFORM-084A: `getAppStateEntries` returns `[]` only for a genuine miss and throws on a real store error, and the reader does not catch it, so a canonical consumer rejects on a store failure rather than caching an empty/default result; genuine absence (no scores before kickoff) returns no rows.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. New `src/lib/__tests__/scoreCacheReader.test.ts` (7: reconcile all+week, week-only inclusion, dedup-no-double-count newest-wins, empty-newer cannot erase, seasonType filtering, genuine-absence, store-failure propagation); new canonical-standings integration test (a score present only in a per-week key credits the owner) and a parallel rollover-archive test; existing `scores/route`, `scores-scope`, `selectors-leagueStandings`, `seasonRollover-aliases`, `loadInsights`, `seasonArchive` suites green (99 across the affected set).
- Scope guardrails: `src/lib/server/scoreCacheReader.ts` (new), `src/app/api/scores/route.ts` (delegate + drop duplicated helpers), `src/lib/selectors/leagueStandings.ts` (`loadNormalizedScoreRows`), `src/lib/seasonRollover.ts`, new/updated tests, plus docs (`AGENTS.md` Core rule #1, `standings.md`, `game-data-flow.md`, `storage-and-caching.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-085A provider commit-order, PLATFORM-085B season-transition safety, PLATFORM-086 refresh cadence, odds, schedule cache redesign. Known follow-up (documented, low risk): the draft page's prior-year score read still reads only `-all-*` keys — prior/completed years are effectively-immutable so the week-key mismatch does not arise there.

### PLATFORM-084A-CANONICAL-CACHE-FAILURE-SEMANTICS-v1

- Purpose: Stop the canonical standings selector from caching _uncertainty_ as valid output. Because the standings `unstable_cache` is tag-only (`revalidate: false`), a snapshot built from a failed store read would persist until a mutation happened to bust its tag — so critical store/read/build failures must reject (never persisted by `unstable_cache`) instead of degrading into a cacheable empty/default snapshot. Extends the PLATFORM-082A "failures are never cached" rule from archive/insights reads to the standings compute path. Explicitly excludes score-cache reconciliation (PLATFORM-084B).
- Result: Audited every app-state read in the `getCanonicalStandings` → `computeCanonicalStandings` → `resolve{Offseason,Season,Preseason}` → `liveDeriveStandings` path and classified each as absence-cacheable vs failure-must-reject. Most readers were already correct (`getLeague`, `listSeasonArchives`/`getSeasonArchive` (082A), owners-CSV read, `loadCachedScheduleItems`, `getScopedAliasMap`, `loadManualOverrides`, `loadNormalizedScoreRows`, `getScheduleProbeState`, and the cache wrapper, which only catches the `incrementalCache missing` non-RSC invariant). Two swallow-catches were removed: (1) `getPreseasonOwners` (`src/lib/preseasonOwnerStore.ts`) no longer wraps its read in `try/catch → null`, so a store failure propagates instead of masquerading as "no preseason owners" (genuine miss still returns `null`); (2) `liveDeriveStandings` (`src/lib/selectors/leagueStandings.ts`) no longer catches a `getTeamDatabaseItems()` failure into an empty catalog (the `.catch(() => [])` is gone — genuine absence is already handled inside `getTeamDatabaseItems` via the bundled `teams.json` fallback) nor a `buildScheduleFromApi` failure into a roster-only 0-0 snapshot. The legitimate absence path is preserved: an **empty cached schedule** (not fetched yet) still yields a roster-only snapshot; only a build failure over a **non-empty** schedule now rejects.
- Invariant added: AGENTS.md Standings Ownership Invariant #8 ("Cache valid absence, never cache uncertainty"). Provider quota behavior (cache-first, no self-fetch) and the schedule→canonical→standings architecture direction are unchanged; this is a failure-semantics hardening, not a data-flow or attribution change.
- Verification: `git diff --check` clean; `npx tsc --noEmit` clean; `npm run lint:all` clean. New `src/lib/__tests__/preseasonOwnerStore.test.ts` (5 tests — valid-absence `null`, round-trip, year-scoping, store-read-failure propagation, post-recovery success) and 2 new tests in `selectors-leagueStandings.test.ts` (store-read failure rejects instead of returning an empty snapshot; recovered store computes real standings) all pass; `loadInsights`, `postseason-boundaries`, `postseasonAttachmentEdges`, and the full `selectors-leagueStandings` regression green.
- Scope guardrails: `src/lib/preseasonOwnerStore.ts`, `src/lib/selectors/leagueStandings.ts` (removed swallow-catches only — no cache-key/tag/invalidation change), new + extended tests, plus docs (`AGENTS.md` invariant #8, `standings.md`, `storage-and-caching.md`, `next-tasks.md`, this entry). Explicitly NOT in scope: PLATFORM-084B score-cache reconciliation; no attribution/identity/ownership/lifecycle changes.

### PLATFORM-083-OWNERS-CSV-OPERATOR-GUARD-v1

- Purpose: Add an active-season owner-roster overwrite guard so a CSV import or inline roster-editor save cannot silently clobber a confirmed current-season roster. Resolves the "CSV current-season guard vs sanctioned admin override" deferral surfaced by the PLAN-002 audit.
- Result: `PUT /api/owners` (`src/app/api/owners/route.ts`) now guards league-scoped writes: for the league's active season (`year >= league.year`; past years are historical backfill), a write that would replace an already-populated roster (`parseOwnersCsv(existing).length > 0`) returns `409 { error: 'owner_roster_overwrite_requires_override', message }` unless `?override=1` is passed. Historical/backfill writes and initial roster creation (no existing populated roster) are unguarded. Team-name validation and post-write `invalidateStandings` are preserved (the latter wrapped to tolerate only the out-of-request-context `revalidateTag` Invariant so league-scoped writes are testable). Shared error code exported from a new leaf module `src/lib/ownerRosterGuard.ts`. Both admin write surfaces — `RosterUploadPanel` (CSV) and `RosterEditorPanel` (inline editor), which share the endpoint — detect the 409 and re-send with `override=1` after an explicit inline confirmation; cancel does not write. CSV panel + admin roster page relabeled "Historical / repair roster CSV import" with copy directing current-season ownership to the draft/manual flow.
- Auth posture unchanged: route stays platform-admin-only (`requireAdminRequest`); no league-admin/commissioner role introduced; `ADMIN_API_TOKEN` fallback untouched; league-password users still cannot write. This is a data-safety guard, not an authorization change.
- Concurrency: the populated-check is re-run immediately before each write (after the CSV path's async team-name validation), closing the window where a concurrent draft-confirm / manual write could populate an initially-empty scope between check and write. This narrows but does not distributed-lock the last-write-wins app-state store — matching every other owner-scope writer (draft confirm, pick edit), which are also unlocked. A store-level compare-and-set was intentionally left out of scope (DB-layer change); best-effort accidental-overwrite protection for a single-operator admin surface is the goal. Both UI confirm flows rebuild the roster/resolutions from current state at confirm (no stale captured edits); the CSV panel additionally pins the league+year that produced the 409 so a changed selector can't redirect the override to a different scope.
- Verification: `git diff --check` clean; `npm run lint:all` clean; `npx tsc --noEmit` clean. `src/app/api/owners/route.test.ts` extended (8 tests: initial-creation allowed, active-season overwrite rejected 409 + roster unchanged, override=1 succeeds, historical write allowed, active-season clear rejected, admin auth still required) — all pass; draft post-confirm-edit + `selectors-leagueStandings` regression green. UI override flow covered by logic/manual review (no component test harness in repo).
- Scope guardrails: `src/app/api/owners/route.ts`, `src/lib/ownerRosterGuard.ts` (new), `src/components/admin/RosterUploadPanel.tsx`, `src/components/admin/RosterEditorPanel.tsx`, `src/app/admin/[slug]/roster/page.tsx`, route test, plus docs (`AGENTS.md` #12, `identity-and-ownership.md`, `next-tasks.md`, this entry). No ownership-attribution/team-identity/draft-flow changes; no new auth role; no separate CSV endpoint.

### PLATFORM-082B-INSIGHTS-CACHE-ENTRYPOINTS-v1

- Purpose: Second/final split of `APPSTATESTORE-CACHING` — cache Insights output so it is not rebuilt on every page visit when inputs are unchanged, and review Insights entry-point cache behavior. Completes the campaign after PLATFORM-082A (archive reads).
- Result: Split the engine (`src/lib/insights/engine.ts`) into `generateRawInsights` (pure, deterministic in `context`) and `applySuppression` (stateful — reads+writes the suppression store; output depends on run count); `runInsightsEngine` now composes them with identical behavior. `loadInsightsForLeague` (`src/lib/insights/loadInsights.ts`) caches the expensive half (input load + `buildInsightContext` + `generateRawInsights`) via `React.cache` over `unstable_cache`, and applies suppression **per request** against the cached raw set — so the "fire once, then fade" behavior is byte-for-byte unchanged while the per-visit recompute is eliminated. `bypassSuppression` (admin/diagnostic) is computed directly (different generator set, no records) and not cached. Cache key `['insights', slug, resolvedYear, seeds:<SEED_ALIASES_HASH>]`. Freshness is tag-first + TTL backstop: the entry carries the canonical standings tags (new exported `standingsSlugTag`/`standingsYearTag` from `leagueStandings.ts`, refactored in place as the single source of truth) so every `invalidateStandings`/`invalidateAllLeaguesStandings` refreshes Insights immediately with zero new call-site wiring; `revalidate: 300` bounds staleness for the cross-league/infrequent inputs that do not flow through standings invalidation (season rankings — lazily cached during read, cannot safely `revalidateTag`; weekly game stats; wall-clock lifecycle/recency drift).
- Failure safety (PLATFORM-082A rule): the critical store reads inside the compute (owners CSV, canonical standings, archives) are not swallow-caught, so a transient failure rejects out of the cached callback and is never persisted as a bogus empty; `loadInsightsForLeague` then returns a graceful `emptyResponse` that is NOT cached. Optional inputs (schedule/team catalog/aliases/overrides/rankings) still degrade to defaults.
- Entry-point review: `/api/insights/[slug]` and `/league/[slug]/insights` remain `force-dynamic` — both do per-request auth (league password gate / admin session) and per-request suppression, so they must render dynamically; `force-dynamic` governs full-route/static caching only and does not disable `unstable_cache`, so the server-side compute is still cached. Neither self-fetches (PLATFORM-077), so no provider quota (PLATFORM-075). No entry-point code change was needed.
- Verification: `git diff --check` clean; `npm run lint:all` clean; `npx tsc --noEmit` clean. New `src/lib/__tests__/insights-cache.test.ts` (7 tests — cache key/tag isolation across slug+year, standings-tag piggyback, and the `generateRawInsights`/`applySuppression` split incl. fire-once-then-fade + per-league/season scoping) passes; existing insights + standings + archive + overview regression (`loadInsights`, `insights-lifecycle-awareness`, `insights-suppression`, `insights-context-aliases`, `selectors-leagueStandings`, `seasonArchive`, `overview`, `overview-canonical-contract` — 131 total) all green.
- Scope guardrails: `src/lib/insights/loadInsights.ts`, `src/lib/insights/engine.ts`, `src/lib/selectors/leagueStandings.ts` (additive tag-helper exports + in-place refactor to identical strings), new test, plus docs (`storage-and-caching.md`, `next-tasks.md`, this entry). No provider/standings-redesign/ownership/CSV/lifecycle-UI changes; suppression semantics preserved.
- Campaign status: **APPSTATESTORE-CACHING is now complete** (082A archive reads + 082B Insights output).

### PLATFORM-082A-ARCHIVE-READ-CACHE-v1

- Purpose: First split of `APPSTATESTORE-CACHING` — add a safe cross-request cache to season archive reads to cut repeated Postgres reads (and egress) on the hot history/insights paths before the August draft. Archive reads only; Insights output caching deferred to PLATFORM-082B.
- Result: Wrapped `getSeasonArchive(slug, year)` and `listSeasonArchives(slug)` (`src/lib/seasonArchive.ts`) in `React.cache` (per-request dedup) over `unstable_cache` (cross-request, tag-only, `revalidate: false`), mirroring the canonical-standings pattern. Cache keys are `['season-archive', slug, year]` and `['season-archive-years', slug]`; a per-year read carries tags `archive:${slug}` + `archive:${slug}:${year}`, the year list carries `archive:${slug}`. Archives are effectively-immutable persisted snapshots whose read output depends only on `(slug, year)` (alias/roster/owner-label state is baked in at write time), so those are the only key parts. Centralized invalidation in `saveSeasonArchive` via new `invalidateSeasonArchive(slug, year)` — busting the slug tag refreshes both the year list and every per-year entry, so all three writers (admin backfill, admin rollover, cron season-rollover) invalidate with no per-call-site wiring and a stale archive can never poison a recomputed standings snapshot. Both readers fall back to a direct store read on the `node:test` `incrementalCache missing` invariant; `saveSeasonArchive` swallows the out-of-context `revalidateTag` throw. No provider calls, no canonical/identity/ownership/standings invariant changes.
- Read-failure safety (Codex P1 remediation): the cache callbacks return `null`/`[]` ONLY for a genuine miss and let a real store/database error reject out of the callback, so `unstable_cache` never persists a bogus `null`/`[]` under `revalidate: false` — otherwise history would stay missing until the next write and a backfill could read a cached `null` as "no existing archive" and overwrite one without confirmation. The `incrementalCache missing` node:test fallback path also throws on real failure.
- Invalidation-failure safety (Codex P1 remediation): `saveSeasonArchive` no longer blanket-catches — it swallows ONLY the out-of-request-context `revalidateTag` Invariant (`static generation store missing` / NEXT code `E263`, i.e. scripts/tests) via `isMissingRequestStore`; a genuine invalidation failure inside a request propagates so the TTL-less cache can't serve stale history while the write falsely reports success. A separate reviewer claim that single-arg `revalidateTag` serves stale data under SWR was checked against installed Next 15.5.20 (`incremental-cache/index.js:309`, "if a tag was revalidated we don't return stale data" → hard miss) and confirmed a false positive: on-demand tag revalidation is a hard miss for `unstable_cache`, not SWR, so the standings recompute reads the fresh archive.
- Verification: `git diff --check` clean; `npm run lint:all` clean; `npx tsc --noEmit` clean. New `src/lib/__tests__/seasonArchive.test.ts` (18 tests — key/tag isolation across slug+year, read/write round-trip shape, cross-league/cross-year isolation, sorted year list, genuine empty list, read-failure propagation + post-recovery success for both readers, and `isMissingRequestStore` discrimination + out-of-context write tolerance) passes; standings + insights + rollover/history consumer tests (`selectors-leagueStandings`, `loadInsights`, `insights-context-aliases`, `seasonRollover-aliases`, `selectors-historySelectors`, `leagueRecords`, `historyOverview` — 168 total) all green.
- Scope guardrails: `src/lib/seasonArchive.ts` + its new test, plus docs (`docs/architecture/storage-and-caching.md`, `docs/next-tasks.md`, this entry). No changes to save-path routes (invalidation is centralized in `saveSeasonArchive`). Insights output caching / `loadInsightsForLeague` / `no-store`/`force-dynamic` review remain deferred to PLATFORM-082B; broader `APPSTATESTORE-CACHING` is NOT fully complete.
- Follow-ups: PLATFORM-082B — insights output cache + entry-point `no-store`/`force-dynamic` review.

### DOCS-008-FINAL-DOCS-CONSISTENCY-CLEANUP-v1 (PR #382)

- Purpose: Resolve the five small documentation-consistency findings from the broad post-closeout Codex review (after PRs #375–#381). Narrow docs-only cleanup; does not reopen the consolidation sequence.
- Result: (1) **Prompt-ID hygiene** — relabeled every `**Prompt ID to assign:**` bullet in `docs/next-tasks.md` (7) and `docs/roadmap.md` (7) to `**Backlog slug (provisional):**`, and added a note in each doc that backlog slugs are provisional planning labels, not formal prompt IDs — the formal `PROMPT_ID` (`<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` per `AGENTS.md`) is assigned only at task activation (with `<###>` checked against this registry then). No final prompt IDs invented; the noncompliant strings (e.g. `APPSTATESTORE-CACHING-v1`, `SERVER-FETCH-ARCHITECTURE-v1`) are no longer presented as prompt IDs. (2) **Deployment runbook access checklist** — rewrote §7D "Non-admin member validation" to distinguish public/no-password leagues (page loads anonymously) from passworded leagues (password gate appears → unlock loads the page, grants no admin/provider-refresh authority), and kept `/admin` as Clerk-gated; replaced the "commissioner account" framing throughout the runbook with "platform admin/operator" (the account created sets `role: platform_admin`, and commissioner-scoped auth is not yet enforced). (3) **Docs index traceability** — added DOCS-007 to the "sequence is now complete (…→ 006 → 007)" sentence in `docs/README.md` (the scope note already listed it). (4) **Architecture sketch ordering** — `docs/CFB_APP_ARCHITECTURE.md` now shows `schedule normalization + identity resolution → canonical AppGame model → …` so identity resolution is no longer implied to follow canonical construction. (5) **Markdown formatting** — deliberately did **not** run a Prettier sweep: `roadmap.md` (~125 lines) and `README.md` (~51 lines) would produce broad table-reflow churn, and `next-tasks.md`'s two Prettier warnings are pre-existing table-cell alignment unrelated to this change; new content is Prettier-clean. Markdown formatting remains outside enforced repo lint. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (`docs/next-tasks.md`, `docs/roadmap.md`, `docs/deployment-runbook.md`, `docs/README.md`, `docs/CFB_APP_ARCHITECTURE.md`, and this entry). No runtime/test/config/script/CSS/component/database-tooling changes. No Markdown-formatting enforcement added. No architecture/operations rewrite, no archive moves, no broad restructuring. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING — the last still appears only as a provisional backlog slug).
- Follow-ups: Markdown Prettier formatting remains non-enforced by repo lint; a deliberate, separately-scoped formatting pass could adopt it later. Otherwise none.

### DOCS-007-ROOT-DOCS-ARCHIVE-HYGIENE-v1 (PR #381)

- Purpose: Narrow post-DOCS-006 hygiene pass — audit the three remaining legacy-looking `docs/` root files and either archive them or justify keeping them, so root `docs/` reads cleanly. Docs-only; not a new archive campaign.
- Result: Audited all three. **Kept `docs/CFB_APP_ARCHITECTURE.md` in place** — it is genuinely `Status: Current (reference)` and actively cited by `CLAUDE.md` and `docs/architecture/overview.md` as a current quick-sketch companion, so archiving would mislabel it; it only _looked_ legacy because it was a bare ASCII diagram, so added a proper H1 + lifecycle metadata header (and a "reference, not authority; see `architecture/overview.md`" note) to de-legacy it. **`git mv` `docs/cfb-engineering-operating-instructions.md` → `docs/archive/governance/cfb-engineering-operating-instructions.md`** (already Historical/superseded; kept its existing banner, fixed the internal `README.md` relative link, added an archive-index pointer). **`git mv` `docs/completed-work-archive.md` → `docs/archive/history/completed-work-archive.md`** (Phases 1–3 archive; added an "Archived — historical reference only" banner). Updated all live references to the two new paths: `AGENTS.md` + `CLAUDE.md` (Supersedes metadata; the CLAUDE map-table row and interaction-prefs origin note), `docs/architecture/overview.md`, `docs/roadmap.md` (§Architecture rules — repointed "canonical architecture principles" to `AGENTS.md`, preserving the archived doc as the historical formulation), `docs/README.md` (source-of-truth map: dropped the two now-archived individual rows, expanded the `docs/archive/` row to enumerate `governance/` + `history/`), and `docs/archive/README.md` (added the two new categories; moved those two docs out of "kept elsewhere" into the archive contents). `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (the two `git mv`s + banner/link/label edits in the files above + this entry). Used `git mv` — no deletions, history preserved. `docs/campaigns/**` untouched. Historical prompt-ledger scope lines that reference the old root paths (e.g. `Scope: … docs/completed-work-archive.md`, `… docs/cfb-engineering-operating-instructions.md`) left unmodified as point-in-time records. No runtime/test/config/script/CSS/component/database-tooling changes. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING).
- Follow-ups: None. Root `docs/` now contains only current/current-ledger docs plus `CFB_APP_ARCHITECTURE.md` (Current reference); all historical/superseded standalone material lives under `docs/archive/**`.

### DOCS-006-ARCHIVE-PATH-DECISION-v1 (PR #380)

- Purpose: Resolve the final deferred documentation-closeout item — the `archive/` path decision — so standalone historical audit/design/prompt artifacts are preserved without reading as current implementation authority. Docs-only closeout; completes the DOCS-002 consolidation sequence.
- Result: **Decision: standardize `docs/archive/` for standalone historical artifacts, leave `docs/campaigns/**`in place** as an intentionally-retained campaign-retrospective area.`git mv`'d ten standalone artifacts under `docs/archive/{audits,designs,prompts}/`with kebab-case filenames: audits —`game-stats-audit`, `overview-feature-audit`, `p2c-foundation-hardening-audit-v2`, `p2c-standings-history-architecture-audit-v1`(the now-empty`docs/audits/`folded into`docs/archive/audits/`); designs — `history-redesign-spec`, `phase-3-multi-league-design`, `phase-4-historical-analytics-design`, `phase-5-draft-tool-design`, `phase-6-admin-auth-design`; prompts — `phase-2-revision-prompt`. Each moved file got a top-of-file "Archived — historical reference only (as of 2026-07-09)" banner pointing at the archive index. Created `docs/archive/README.md`(archive policy, what belongs where, the current-authority map, how to read historical records). Updated live references to the new paths:`docs/README.md`source-of-truth map (replaced the old phase/spec/audit row with a`docs/archive/`row + explicit campaigns disposition),`docs/architecture/overview.md`historical-docs paragraph,`docs/completed-work.md`phase-6 link, and the intra-archive`history-redesign-spec`link inside the moved phase-2 prompt.`docs/prompt-registry.md`— this entry; historical ledger scope lines (e.g. old`Scope: docs/game-stats-audit.md`) left unmodified as point-in-time records. `docs/next-tasks.md` — DOCS ledger line updated; closeout marked complete.
- Scope guardrails: Docs-only (moves under `docs/archive/**`, `docs/archive/README.md`, and link/label edits in the docs listed above). Used `git mv` — no history lost, no deletions. `docs/campaigns/**` untouched (retained, not archived) and not rewritten. `docs/cfb-engineering-operating-instructions.md` and `docs/completed-work-archive.md` left in place (already clearly labeled Historical/superseded / Archived). No runtime/test/config/script/CSS/component/database-tooling changes. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING).
- Follow-ups: None — this closes the documentation-consolidation sequence (DOCS-002A → 002B → 002C → 004 → 005 → 006). No deferred documentation-maintenance items remain in `docs/README.md` → "Planned documentation work".

### DOCS-005-LIFECYCLE-METADATA-ROLLOUT-v1 (PR #379)

- Purpose: Complete the deferred lifecycle-metadata rollout — add the standard per-doc metadata block (first adopted by the DOCS-002C architecture/operations docs) to the active/canonical governance and reference docs so readers can distinguish current guidance from historical records. Docs-only closeout.
- Result: Added a `Status / Last verified (2026-07-09) / Owner / Canonical for / Supersedes` block immediately under the H1 of ten docs: `AGENTS.md` (Current; canonical for binding engineering/architecture/implementation/review/documentation-timing rules; supersedes the historical `cfb-engineering-operating-instructions.md` jointly with CLAUDE.md), `CLAUDE.md` (Current; Claude workflow + prompt-handoff, explicitly does not supersede AGENTS.md), `DESIGN.md` (Current; durable UI/design principles), `docs/README.md` (Current; source-of-truth map + lifecycle definitions), `docs/next-tasks.md` (Current; active queue + unresolved decisions/deferrals), `docs/roadmap.md` (Current; high-level roadmap + philosophy only), `docs/prompt-registry.md` (`Status: Current ledger`; historical implementation record, not a backlog), `docs/deployment-runbook.md` (Current; detailed operator companion to `docs/operations/deployment.md`), `docs/vision.md` (Current; product vision + production data policy), and `docs/completed-work.md` (`Status: Historical (append-only ledger)`). `docs/README.md` — marked the lifecycle-metadata rollout ✅ Done, updated the scope note, and broke the `archive/` path decision out as the one clearly-labeled remaining deferred follow-up. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (the ten docs above + this ledger entry). No file moves; no `archive/` path decision. Historical campaign/phase/spec/audit records intentionally left unlabeled (they stay Historical). No architecture/runtime claims changed — metadata blocks only, existing headings/links preserved. No content rewrites. No runtime/test/config/script/CSS/component/database-tooling changes. No product/architecture deferral resolved (CSV current-season guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING). `docs/next-tasks.md` metadata added but its queue content untouched.
- Follow-ups: `archive/` path decision remains the sole deferred documentation follow-up (tracked in `docs/README.md` → "Planned documentation work").

### DOCS-004-DESIGN-CONTRADICTION-CLEANUP-v1 (PR #378)

- Purpose: Resolve the two known `DESIGN.md` self-contradictions deferred through DOCS-002A/C so the canonical UI/design doc is internally consistent — docs-only, no runtime UI change.
- Result: Verified current intended behavior from implementation (two read-only code sweeps) before editing. (1) **Standings rank numbers** — code shows the full Standings page owner-colors the rank digit (`StandingsPanel.tsx` inline `style={{ color: ownerColorFn(row.owner) }}`), while the Overview condensed snapshot, both podiums, and the History standings tables use muted `text-gray-*`/`text-zinc-*`; rewrote the "Color encoding" bullet (was the false absolute "Rank numbers in all standings tables are plain muted text — never colored") to state the real single rule and cross-reference the Tables section (which was already correct). (2) **Game-card borders** — code shows individual game cards are bordered discrete objects (`GameWeekPanel.tsx` `border border-gray-300 … dark:border-zinc-800` over a surface tint, with team-color accent bars), so corrected the stale "Game cards use a dark surface tint — no border, defined by background only" bullet to agree with the already-correct Containerization rule ("Individual game cards retain borders"). `docs/README.md` — marked the design-contradiction cleanup ✅ Done, updated the DESIGN.md status row + scope note. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (`DESIGN.md` + `docs/README.md` + `docs/next-tasks.md` + this ledger entry). No runtime/CSS/Tailwind/component/test/config/script changes — the docs were brought into line with existing behavior, not the reverse. No new design direction invented; both resolutions match verified implementation. `docs/next-tasks.md` edit was limited to its DOCS ledger line (marking DOCS-004 done and dropping design-contradiction cleanup from the remaining-follow-ups list). Remaining doc follow-ups (lifecycle-metadata rollout, `archive/` path decision) preserved as deferred.
- Follow-ups: None specific to DESIGN.md. Doc-lifecycle-metadata rollout and the `archive/` path decision remain deferred in `docs/README.md` → "Planned documentation work".

### DOCS-002C-ARCHITECTURE-OPERATIONS-DOCS-v1 (PR #377)

- Purpose: Third DOCS-002 slice — create a dedicated current-architecture and operations documentation layer so the durable runtime architecture and operator references have canonical homes (previously architecture lived only in `AGENTS.md` + the `CFB_APP_ARCHITECTURE.md` sketch, and operations only in `deployment-runbook.md`). Docs-only; describes present behavior and points back to `AGENTS.md` for binding invariants — does not restate or override them.
- Result: Added six architecture docs under `docs/architecture/` — `overview.md` (high-level structure, canonical data-flow `schedule → canonical games → scores/odds/ownership attach`, source-of-truth hierarchy, doc index), `game-data-flow.md` (schedule as source of truth, canonical `AppGame` construction, postseason canonical-week formula, score/odds attachment precedence, PLATFORM-075 public cache-reader + authorized-refresh policy, provider quotas), `identity-and-ownership.md` (`teamIdentity.ts` sole canonicalization boundary + 3-step resolution, alias precedence `stored global > year > seed`, `gameOwnership.ts` candidate order, PLATFORM-040/PLATFORM-039 deferrals, required CSV-role wording verbatim), `standings.md` (`getCanonicalStandings` authority, LiveDelta separate/never-merged, NoClaim at source, lifecycle/preseason states, cache tags + PLATFORM-070/071 invalidation wirings, PLATFORM-080 finalized-game refresh), `auth-and-privacy.md` (three independent mechanisms: Clerk / `ADMIN_API_TOKEN` / `LEAGUE_AUTH_SECRET`; middleware page gating vs `requireAdminAuth` API gating; `/api/debug/*` route-gated; `CRON_SECRET`; league password grants no role/no fetch authority), `storage-and-caching.md` (app-state store, alias/app-state storage, provider caches, standings cache keys/tags, PLATFORM-081 legacy-alias cleanup complete + zero remaining, future broad DB cleanup out of scope). Added two operations docs under `docs/operations/` — `deployment.md` (high-level env-var/auth-secret/cron overview, deploy-time checks, rollback/backup pointers; companions the still-current `deployment-runbook.md`) and `diagnostics.md` (diagnostic-surface auth, upstream-first debugging order `API response → normalization → canonical game model → attachment → UI`, per-layer inspection, guardrails). Each new doc carries the lifecycle metadata header (Status/Last verified/Owner/Canonical for/Supersedes). Linked all eight from `docs/README.md`'s source-of-truth map and marked the DOCS-002C planned-work item ✅ Done. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only (new files under `docs/architecture/` + `docs/operations/`, plus `docs/README.md` link/status edits and this ledger entry). No runtime/test/config/script/database-tooling changes. No file moves — the `archive/` path decision for `docs/campaigns/**` and phase/spec records stays open. Did not resolve any deferred product/architecture decision (CSV current-season guard, owner-identity mapping across seasons, PLATFORM-040 normalized ownership-key index, `conferenceRecords` canonical build, PLATFORM-039 archive raw-label parity, STANDINGS-PAGE-LIFECYCLE-LABELING). CSV documented per the required wording — not overstated as history-only. No secret values exposed. `deployment-runbook.md` kept Current (not superseded).
- Follow-ups: Deferred **design-contradiction cleanup** and deferred **doc lifecycle metadata rollout** onto pre-existing active docs — both still tracked in `docs/README.md` → "Planned documentation work"; plus the still-open `archive/` path decision for campaigns/phase records.

### DOCS-002B-PLANNING-HISTORY-CLEANUP-v1

- Purpose: Second DOCS-002 slice — planning/history docs cleanup so the current queue, roadmap, ledger, and completed-work stop competing: remove stale "planned/pending/open" wording for shipped work, resolve the roadmap contradiction, collapse the verbose completed audit sequence, keep unresolved decisions visible. Docs-only.
- Result: `docs/next-tasks.md` — collapsed the completed "Audit-driven correctness + docs sequence" (Section 0, the full PLATFORM-069→081b + DOCS-001A/B + DOCS-003 detail) into a one-line-per-item ledger pointer (per-item history → `prompt-registry.md`; shipped context → `completed-work.md`/campaigns); dropped the stale "open correctness risks today" framing; added an explicit `#### Unresolved decisions & known deferrals` subsection (kept under the same Section 0 heading so the `AGENTS.md` single-source pointer stays valid); removed the two shipped items (STANDINGS-PRESEASON-STATE, INSIGHTS-LIFECYCLE-AWARENESS) that were lingering in the "Planned backlog" sections. `docs/roadmap.md` — fixed the completed-work summary table's "Standings Page — Preseason State: 🔄 Planned" to ✅ Complete (it contradicted the section already marked ✅ shipped). `docs/README.md` — marked the DOCS-002B planned-work item done. `docs/prompt-registry.md` — this entry.
- Scope guardrails: Docs-only. No architecture/operations docs (DOCS-002C stays deferred). No `AGENTS.md`/`DESIGN.md` edits; the only governance-doc change was a one-line `CLAUDE.md` pointer relabel during PR-review remediation ("Current unresolved correctness work" → "Unresolved decisions and deferrals" → the new subsection, since the audit correctness sequence has shipped) — the `AGENTS.md` single-source pointer stayed accurate via the preserved next-tasks structure. Also backfilled concise **DOCS-001A**/**DOCS-001B** ledger entries so the collapsed next-tasks pointer resolves to a real registry home. No file moves; `completed-work.md`/campaign retrospectives left as historical record. No runtime/test/config/script changes. All unresolved product/architecture decisions preserved (CSV guard, owner-identity mapping, PLATFORM-040, `conferenceRecords` build, PLATFORM-039 archive parity, STANDINGS-PAGE-LIFECYCLE-LABELING).
- Follow-ups: **DOCS-002C** (architecture/operations docs + `archive/` decision), deferred **design-contradiction cleanup**, and deferred **doc lifecycle metadata rollout** — all tracked in `docs/README.md` → "Planned documentation work".

### DOCS-002A-GOVERNANCE-AND-DOCUMENTATION-INDEX-v1

- Purpose: First, narrowed slice of the DOCS-002 structural docs consolidation — establish a documentation index / source-of-truth map and tighten the root governance docs, without the larger planning/history/architecture restructure. Deliberately scoped small and reviewable (PR-1).
- Result: Docs-only. Created `docs/README.md` as the documentation map — a source-of-truth table (which doc owns what), doc lifecycle status definitions (Current / Historical / Superseded / Archived, plus the ledger special case), an authority-boundaries section (AGENTS = binding architecture; DESIGN = UI; CLAUDE = Claude workflow; docs/README = map; next-tasks/prompt-registry/roadmap noted as current-for-now, scoped for later reduction), and a "Planned documentation work" section recording the deferred DOCS-002B/002C passes. Anchored each governance doc's "Doc authority" header to `docs/README.md` (`AGENTS.md`, `DESIGN.md`, `CLAUDE.md`) and added `docs/README.md` to CLAUDE.md's canonical doc-pointers table. Relabeled AGENTS.md's unresolved-work pointer from "correctness work" to "decisions and deferrals" (accurate now the audit sequence has shipped) while keeping its no-restate-statuses principle.
- Scope guardrails: No changes to `docs/next-tasks.md`, `docs/roadmap.md`, `docs/completed-work.md`, campaign docs, or the root `README.md` (an earlier broad pass over next-tasks/roadmap/root-README was reverted to keep this PR narrow — that reduction is DOCS-002B). No file moves. No runtime/test/config/script changes.
- PR-review remediation (DOCS-002A-PR-REVIEW-REMEDIATION-v1): addressed five Codex target-PR findings on PR #375, still docs-only: (1) marked `docs/cfb-engineering-operating-instructions.md` **Historical/superseded** (README row + a status note atop the file) since it carries old phase-style prompt-ID guidance — current authority is `AGENTS.md` (binding) + `CLAUDE.md` (workflow) + `prompt-registry.md` (ledger); re-anchored CLAUDE.md's header/interaction citations to AGENTS.md/this-file. (2) Renamed the registry `## Active Prompts` heading to **"Prompt ledger (most recent first)"** so it reads as a historical ledger, not a backlog. (3) Fixed CLAUDE.md's prompt-registration timing to match `AGENTS.md` → "Documentation closeout timing" (finalized pre-merge after review/remediation, not merely "after execution"). (4) `DESIGN.md` no longer presented as fully reconciled — two known contradictions (standings rank owner-colored vs muted; game cards border vs none) tracked as a deferred design-cleanup follow-up. (5) Per-doc lifecycle metadata block explicitly deferred with its template recorded.
- Follow-ups: **DOCS-002B** — planning/history cleanup (reduce `next-tasks.md` to a concise queue + unresolved-decisions; reconcile the `roadmap.md` completed-work table's stale "Standings Page — Preseason State: Planned" vs the shipped section; trim `prompt-registry.md` to read strictly as a ledger; consolidate `roadmap.md` vs `next-tasks` status duplication). **DOCS-002C** — architecture/operations docs extraction + decide on an explicit `archive/` path for campaigns/phase records. Plus deferred **design-contradiction cleanup** and **doc lifecycle metadata rollout**. All recorded in `docs/README.md` → "Planned documentation work".

### DOCS-001B-GOVERNANCE-CORRECTNESS-DOCS-CLEANUP-v1

- Purpose: Governance-correctness docs cleanup + three-doc (`AGENTS.md`/`CLAUDE.md`/`DESIGN.md`) deconfliction, ahead of the PLATFORM-069+ audit sequence. Docs-only.
- Result: ✅ Done (PR #357). Removed stale hang/`TeamsDebugPanel` warnings; corrected the role model; documented the `gameOwnership.ts` current-season attribution invariant; established the docs-closeout timing rule; honest CSV wording; reconciled `next-tasks.md`; added the "Doc authority (source of truth)" headers to the three governance docs.
- Notes: Backfilled retroactively during DOCS-002B (the collapsed `next-tasks.md` Section 0 points here for per-item history). No runtime/test/config/script changes.

### DOCS-001A-DEPLOYMENT-RUNBOOK-SECRETS-PRIVACY-v1

- Purpose: Deployment-runbook secrets + privacy wording fix. Docs-only.
- Result: ✅ Done (PR #356). Corrected the `docs/deployment-runbook.md` secrets/privacy guidance.
- Notes: Backfilled retroactively during DOCS-002B (the collapsed `next-tasks.md` Section 0 points here for per-item history). No runtime/test/config/script changes.

### PLATFORM-081b-CLEANUP-DRYRUN-READONLY-v1

- Purpose: Tooling hotfix (no runtime alias change). An operator dry-run of `npm run cleanup:legacy-aliases` failed BEFORE reporting: every durable read goes through `ensureDatabase()`, which unconditionally ran `create table if not exists app_state` — DDL a read-only production connection rejects with SQLSTATE 25006 (`cannot execute CREATE TABLE in a read-only transaction`). No data was deleted, but the dry run couldn't inspect anything. Fix: dry-run must inspect existing keys without DDL/writes; `--apply` still requires a writable postgres connection.
- Scope: `src/lib/server/appStateStore.ts` — factored the table DDL into `APP_STATE_TABLE_DDL`; `ensureDatabase()` now catches 25006 and, when the table already exists, proceeds (READ callers succeed on a read-only connection); new exported `assertAppStateWritable()` runs the DDL STRICTLY (no tolerance) as a write-capability probe; exported `isReadOnlyTransactionError()` (exact-code detector). `scripts/cleanup-legacy-league-aliases.ts` — `--apply` calls `assertAppStateWritable()` up front and refuses on a read-only connection before any report/delete; dry-run skips it. New `src/lib/server/__tests__/appStateStore.test.ts`.
- Safety: Read-only tolerance is narrow — triggers ONLY on exact SQLSTATE 25006 AND only when the table already exists (a genuinely missing table still throws). Writers are unaffected (they fail on their own INSERT/DELETE), so nothing writes through the degraded path. PLATFORM-081 deletion safety rules are unchanged; `--apply` still requires `mode === 'postgres'` AND now a proven-writable connection. Runtime alias behavior untouched.
- Notes: Codex clean, no findings (first pass). Verification: `git diff --check`/`tsc`/`lint:all` clean; targeted tests 11/11 (9 legacy alias cleanup + 2 new appStateStore). Branch `platform/platform-081b-cleanup-dryrun-readonly`, PR #373.
- Follow-ups: Operator can now dry-run against a read-only connection, then `--apply` against a writable primary. Unblocked the PLATFORM-081 production `--apply` operator step, which has since been run — 3 legacy keys (`aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025`) deleted, zero remaining on confirmation dry-run.

### DOCS-003-STANDINGS-PRESEASON-STATE-CONTRADICTION-VERIFICATION-v1

- Purpose: Resolve the tracked `STANDINGS-PRESEASON-STATE` table-vs-prose contradiction by verifying from source whether the preseason cold-cache blank-standings behavior shipped or a correctness gap remains. Verification/docs task — no runtime change unless a trivial docs/test naming mismatch.
- Result: **Docs-stale.** The fix shipped in the Season Launch Hardening campaign (Phase 2, commits `88af434` + `43516b0`) and is verified present + tested. `src/lib/selectors/leagueStandings.ts` defines the `CanonicalStandingsSource` value `'preseason-awaiting-kickoff'` + `inferredSeasonStart` field; the season/preseason empty paths call `getScheduleProbeState(year)` and return `preseasonAwaitingKickoffSnapshot(...)` (no `Date.now()` in the cached selector). `StandingsPanel.tsx` and `CFBScheduleApp.tsx` do the render-time kickoff check and show explicit copy ("Season starts {date}" / "Pre-season" → "Standings will appear once games are played."; post-kickoff/empty → "Standings unavailable. Contact your commissioner."). No path renders silently blank. Covered by `selectors-leagueStandings.test.ts` (future/past/no-probe kickoff + preseason cases). No `seasonStartDate` config field was needed (start inferred from the schedule probe).
- Scope: Docs only. `docs/next-tasks.md` — resolved the tracked contradiction item and corrected the stale INSIGHTS-017 backlog line (status table at line 39 was already correct). `docs/roadmap.md` — retitled the "(planned)" section "(✅ shipped)" and removed the stale "silently blank"/"Prompt ID to assign" wording. This registry entry. No `src`/test edits, so no runtime invariants touched (canonical standings source-of-truth, PLATFORM-070/071 invalidation, PLATFORM-075 quota all intact).
- Verification: `git diff --check` clean. Post-edit grep confirms no remaining doc claims the standings page renders "silently blank" as an open issue. `tsc`/`lint:all` not run (docs-only, no runtime/test files changed). Branch `docs/standings-preseason-state-verification`.
- Follow-ups: None identified. Next queued: deferred product decisions (CSV current-season guard, owner-identity mapping, whether to schedule PLATFORM-040); `STANDINGS-PAGE-LIFECYCLE-LABELING` remains a separate planned polish item (broader lifecycle-label audit, distinct from this preseason-state fix).

### PLATFORM-081-SEED-KEY-CLEANUP-LEGACY-LEAGUE-SCOPED-ALIASES-v1

- Purpose: Clean up redundant legacy `aliases:${slug}:${year}` seed-copy app-state keys left behind after the PLATFORM-067 alias migration made runtime resolution ignore league-scoped keys. Touches production data → verify code paths, prefer dry-run/reporting, delete only keys proven redundant, preserve alias precedence (stored global → year → SEED), never reintroduce league-scoped runtime aliases.
- Deletion status: **Delivered as a manual operator step — NOT automated** (this session cannot touch production data); tooling is dry-run by default with `--apply` gated. **The operator step has since been run:** 3 legacy keys (`aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025`) deleted from prod, confirmation dry-run found zero remaining.
- Scope: New `src/lib/server/legacyAliasCleanup.ts` — `parseAliasScope` (classifies a scope as global/year/league/other; league = 3-part `aliases:${slug}:${year}` with a 4-digit year and slug≠`global`), `classifyLeagueScopedAliasMap(map, storedGlobal)` (per-entry: seed-copy vs promoted-repair vs un-promoted-repair), `reportLegacyLeagueScopedAliases()` (read-only discovery), `cleanupLegacyLeagueScopedAliases({apply})` (dry-run default). New `scripts/cleanup-legacy-league-aliases.ts` + `npm run cleanup:legacy-aliases`. New `src/lib/server/appStateStore.ts` `listAppStateScopes(scopePrefix?)` (Postgres `select distinct scope` / file-store scan) so cleanup can discover scopes for leagues that may no longer be registered. Tests in `src/lib/server/__tests__/legacyAliasCleanup.test.ts`.
- Safety model: Runtime never reads `aliases:${slug}:${year}` (PLATFORM-067 — `getScopedAliasMap` ignores the slug; verified across draft/win-totals/debug/insights/standings/schedule/scores). A league key is deletable only when EVERY entry is either (a) a copied seed default (`isCopiedSeedDefault`) or (b) a manual repair whose EXACT target is already live in the stored global map. Promotion is judged **per entry against the real `aliases:global` map, NOT the `migration-done` sentinel** — the promotion migration only scans registered slugs in a bounded year window, so an unregistered/out-of-window scope can hold an un-promoted repair even with the sentinel set. Value (not just key) must match, because `aliases:global` can hold a demoted copied seed default at the same key (`uh → houston`) while the league scope repairs it elsewhere (`uh → Hawaii`); the migration would overwrite the demoted copy with the repair, so a bare key-existence check would delete the only copy. Refuses global/year/non-alias scopes structurally + defense-in-depth re-check before each delete. CLI loads `.env.local`/`.env` and refuses to run unless `getAppStateStorageStatus().mode === 'postgres'` (never mutates the file fallback). Legacy migration scan **kept** (a per-datastore sentinel can't be proven set across all deployments; cheap no-op once done).
- Notes: Three Codex rounds. Round-1 two P2s: (1) `safeToDelete` trusted the sentinel → fixed to per-entry promotion check; (2) script accessed app-state before loading env → silent file fallback → fixed with dotenv + postgres storage gate. Round-2 one P1: promotion counted key-existence, so a repair over a demoted seed copy was a false positive → fixed to require the stored global VALUE to equal the repair's target. Round-3 clean. Tests (9): runtime ignores league keys; report identifies legacy keys without mutating; cleanup preserves global/year/unrelated scopes; dry-run deletes nothing + `--apply` removes pure seed-copy but skips un-promoted repairs; promoted-via-global deletable; demoted-seed-copy repair skipped; un-promoted repair skipped despite sentinel. Verification: `tsc`/`lint:all` clean; targeted suite 9/9. Branch `platform/platform-081-seed-key-cleanup`, commits `b49714a`…`c739bd3`.
- Follow-ups: Production `--apply` run ✅ done — operator ran the cleanup against prod and safely deleted 3 legacy keys (`aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025`); confirmation dry-run found zero remaining legacy league-scoped alias keys. **Dry-run hotfix → PLATFORM-081b** (the dry run hit a read-only-connection DDL failure in production; fixed so it inspects without writes). Next queued: deferred product decisions (CSV current-season guard, owner-identity mapping, whether to schedule PLATFORM-040).

### PLATFORM-080-IN-SESSION-FINALIZED-GAME-RSC-REFRESH-v1

- Purpose: Fix the pre-existing in-session standings staleness surfaced in the PLATFORM-079a review — when a live score poll observes a game finalize, `scoresByKey` updates but the RSC `canonicalStandings` prop stays fixed and `liveDelta` excludes final games, so records/ranks don't update until navigation. Trigger a narrowly-scoped RSC refresh only on a real finalization transition; do NOT revive client standings derivation.
- Scope: `src/components/hooks/useLiveRefresh.ts` — new pure, exported `detectScoreFinalizations({nextScores, scopeGameKeys, observedKeys, finalKeys})` that returns true only on a real non-final→final transition (classifies via canonical `classifyScorePackStatus`); new optional `onGamesFinalized` param + two memory refs (`observedScoreKeysRef`/`finalizedScoreKeysRef`) + a per-poll detection call after `setScoresByKey`. `src/components/CFBScheduleApp.tsx` — `handleGamesFinalized` (`router.refresh()`) wired to `onGamesFinalized`. `src/components/hooks/__tests__/useLiveRefresh.test.ts` — 5 regression cases.
- Notes: **Why `router.refresh()` suffices** — `getCanonicalStandings` is `unstable_cache`-wrapped (cached until `revalidateTag`), but the `/api/scores` write path already calls `invalidateStandingsForYear` when it writes a final, so the tag is busted and `router.refresh()`'s recompute picks up the new final. Recompute reads only the cache-only score/schedule caches → no client `deriveStandings` reintroduced and no upstream provider fetch (PLATFORM-075 intact); manual authorized refresh + postseason-override refresh unchanged. **Transition semantics:** `observedKeys` is seeded from the watched SCOPE (`scoreScopeForRequest` keys), not the score payload — so a scheduled game with no attached score row (cold/stale public cache or failed attach) is still tracked and its later finalization fires; seeding happens AFTER the final-check so initial already-final / enter-scope-already-final games never self-trigger, and `finalKeys` suppresses repeat finals. Two Codex rounds: round-1 P2 (detector missed watched-but-scoreless scheduled games because observed was seeded from the score payload) fixed by seeding from scope + a dedicated regression test; round-2 clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; finalization tests 5/5, component+hooks sweep green; `git grep deriveStandings src/components src/app` shows only comments + the distinct `deriveStandingsInsights`/`deriveStandingsMovementByOwner` selectors. Branch `platform/platform-080-in-session-finalized-game-rsc-refresh`, commits `595c024`…`ba15e6b`.
- Follow-ups: None new. Seed-key cleanup remains the next queued item.

### PLATFORM-079b-ADMINDEBUGSURFACE-USELIVEREFRESH-DEAD-PLUMBING-CLEANUP-v1

- Purpose: Remove the PLATFORM-078-deferred `AdminDebugSurface` + `surface==='admin'` path and the now-dead state/handler/hook-prop chain it was the sole consumer of. (079b of a split PLATFORM-079; resolves the PLATFORM-078 AdminDebugSurface deferral.)
- Scope: Deleted `src/components/AdminDebugSurface.tsx`. `src/components/CFBScheduleApp.tsx` — removed its import/render + the `surface` prop (type + default) + every `isAdminSurface` branch (collapsed to the league path) + dead `leagueHref`; removed the 7 useState only AdminDebugSurface read (schedule meta, odds cache state, odds/schedule refresh timestamps, `diag`, owners-cache flags) and their setter calls in the reset fn + `loadScheduleFromApi`; removed the `clearCachedOwners`/`onOwnersFile` handlers + orphaned `clearOwnersDerivedState` + now-dead imports (`DiagEntry`/`ScheduleFetchMeta`/`LEGACY_STORAGE_KEYS`/`saveServerOwnersCsv`); stopped capturing the unused `refreshLiveData` return. `src/components/hooks/useLiveRefresh.ts` — dropped admin-only params `setDiag`/`setOddsCacheState`/`setLastOddsRefreshAt` (interface + destructure + internal calls + deps) and orphaned `scoreDiag`/`cacheState` locals. `src/components/hooks/useScheduleBootstrap.ts` — dropped `setHasCachedOwners`/`setOwnersLoadedFromCache` params + pass-through calls + deps. `src/components/__tests__/CFBScheduleApp.test.tsx` — removed the admin-surface-only test.
- Notes: `AdminDebugSurface` was reachable only through `CFBScheduleApp`'s `surface==='admin'` branch, which no production route mounts (only a test did). `refreshLiveData` and the `manual` authorized-refresh machinery are RETAINED — `refreshLiveData` powers internal auto-refresh (useEffect), and `manual` still authorizes upstream scores/odds refresh (PLATFORM-075 semantics unchanged); it simply has no live caller now. No change to debug/API auth (PLATFORM-074), provider quota policy (PLATFORM-075), or the 079a canonical sourcing (no client `deriveStandings` reintroduced). The 26 league-surface `CFBScheduleApp` tests already exercise the live paths without the admin plumbing. Net −303 lines. Verification: `tsc`/`lint:all`/`git diff --check` clean; component+hooks+bootstrap sweep 266/266; Codex clean first pass. Branch `platform/platform-079b-admindebugsurface-removal`, commit `6417580`.
- Follow-ups: Preserved-as-unresolved — the 079a in-session finalized-game RSC-refresh follow-up (pre-existing; own scoped task). None new.

### PLATFORM-079a-CFBSCHEDULEAPP-CANONICAL-STANDINGS-v1

- Purpose: Retire the client-side `deriveStandings` path in `CFBScheduleApp` (outside `src/lib/selectors/`) and source Members owner options/selection + owner colors + standings-fed surfaces from the canonical selector output, eliminating a parallel client derivation that could drift from canonical. (079a of a split PLATFORM-079; 079b = AdminDebugSurface removal.)
- Scope: `src/components/CFBScheduleApp.tsx` — removed the `standingsSnapshot`/`standingsCoverage`/`standingsHistory` memos (and the now-orphan `hasScoreLoadError`) plus the `deriveStandings`/`deriveStandingsCoverage`/`deriveStandingsHistory` imports; introduced `canonicalRows`/`canonicalHistory`/`canonicalCoverage`/`canonicalOwnerColorOrder` locals off the `canonicalStandings` prop and wired every consumer to them: `deriveOwnerViewSnapshot` (owner options + header), `buildOwnerColorMap` (colors, canonical order only — dropped the in-session roster supplement), `deriveOwnerMatchupMatrix`, `selectSeasonContext`, `resolveOverviewCanonicalInputs`, and the Overview/Standings panel `rows`/`coverage`/`standingsHistory` props. `src/components/__tests__/CFBScheduleApp.test.tsx` — added a `canonicalStandings` fixture helper, a regression test (client roster carries only "Zed", canonical only "Alice" → picker offers Alice never Zed), and supplied canonical to the 5 renders that relied on the removed client fallback. No changes to OwnerPanel/ownerView/panels/selectors — they already prefer canonical and now simply receive canonical-sourced inputs.
- Notes: Verified (via subagent map) canonical is guaranteed present at all 4 league routes (`getCanonicalStandings` never returns null/undefined; pages pass it unconditionally) and that every records-bearing surface already resolved `canonicalStandings?.rows ?? clientRows` → canonical won in production. So 079a removed a client value production already discarded — behavior-preserving; live in-session standings updates continue via the client `liveDelta` overlay over canonical. Split from the AdminDebugSurface work to keep each patch focused/reviewable (user decision). Verification: `tsc`/`lint:all`/`git diff --check` clean; affected component+selector sweep 271/271. Branch `platform/platform-079-cfb-schedule-app-canonical-standings`, commit `4c267b6`.
- Follow-ups: (1) **079b** — the PLATFORM-078-deferred `AdminDebugSurface` + `surface==='admin'` removal + `useLiveRefresh` dead-plumbing cleanup (separate branch/PR). (2) **Pre-existing (deferred, ID TBD)** — in-session standings staleness: a live score poll that finalizes a game updates `scoresByKey` but not the RSC `canonicalStandings` prop, and `liveDelta` excludes final games, so the new final isn't reflected until navigation/refresh. Predates 079a (all records surfaces already preferred the equally-stale canonical rows). Codex flagged it P2 on 079a; verified pre-existing, user deferred. Fix = `router.refresh()` on an actual scheduled→final transition after a score poll (mirrors the postseason-override path); touches the PLATFORM-075 refresh path, so own task.

### PLATFORM-078-DEAD-CODE-SWEEP-ALIASES-TEAMNAMES-ADMINDEBUGSURFACE-v1

- Purpose: Conservative P3 dead-code sweep — remove only code proven unreferenced/unreachable by static search; do not trust the candidate list blindly.
- Scope: Deleted `src/lib/aliases.ts` (whole module) and trimmed `src/lib/teamNames.ts` to `AliasMap` + `SEED_ALIASES` (removed `applyAliases`/`normWithAliases`/`variants` + the `normalizeTeamName`/`stripDiacritics` re-export + the now-unused `./teamNormalization` import). No runtime/live-path changes.
- Static-search evidence: `src/lib/aliases.ts` — `git grep "from '.../lib/aliases'"` → 0 importers; all 11 exports (`AliasEntry`/`AliasFile`/`AliasMap`/`OverrideMap`, `normalizeLabel`, `buildAliasMap`, `loadOverrides`, `saveOverrides`, `resolveCanonical`, `loadAliasMap`, `setAliasMapCache`) unimported; only surviving mentions are comments in `draft/board/boardData.ts`. `teamNames.ts` helpers — `git grep "applyAliases|normWithAliases|variants("` → 0 external callers (used only by each other); every `teamNames` importer (`draftSchedule`, `CFBScheduleApp`, `useLiveRefresh`, `useScheduleBootstrap`, `loadInsights`, `rankings.test`) uses only `AliasMap` or `SEED_ALIASES`.
- NOT deleted (documented per the "if still referenced/reachable, do not delete" guardrail): `AdminDebugSurface` + `surface==='admin'`. Static search contradicted the "unreachable branch" framing — it is imported/rendered by `CFBScheduleApp` and reachable via the component's own `surface` prop (test-mounted in `CFBScheduleApp.test.tsx`; no production _route_ mounts it), and is the sole consumer of a web of otherwise-write-only `CFBScheduleApp` state (schedule meta, odds cache state, refresh timestamps, `diag`, owners-cache flags) + `clearCachedOwners`/`onOwnersFile` handlers + manual `refreshLiveData`, several passed into the shared `useLiveRefresh` hook. A trial full removal measured a 10-orphaned-binding blast radius requiring edits to `useLiveRefresh`'s signature + multiple live refresh handlers — architecture cleanup + live-path change beyond a focused sweep. Deferred to PLATFORM-079 (already touches `CFBScheduleApp`) or a dedicated 078b.
- Verification: `tsc`/`lint:all`/`git diff --check` clean; targeted tests (`CFBScheduleApp.test.tsx` + `rankings.test.ts` + `conferenceSubdivision.test.ts`) 49/49; final grep for removed symbols → none. Codex clean first pass. Branch `platform/platform-078-dead-code-sweep`, commit `339d030`.

### PLATFORM-077-INSIGHTS-CANONICAL-GAMES-IN-PROCESS-v1

- Purpose: Stop Insights from HTTP self-fetching its own app routes and privately rebuilding schedule/game state; consume the same canonical in-process game/lifecycle inputs production standings use.
- Scope: `src/lib/insights/loadInsights.ts` (drop `next/headers`/`deriveOrigin`/`fetchJson` and the `/api/schedule` + `/api/teams` self-fetches; read schedule items, team catalog, effective aliases, and postseason overrides in-process, then build games via `buildScheduleFromApi` now passing `manualOverrides`), new `src/lib/server/canonicalScheduleCache.ts` (`loadCachedScheduleItems(year)` = cache-only durable `schedule` app-state read, quota-safe; `loadPostseasonOverrides(slug, year)`), `src/lib/selectors/leagueStandings.ts` (its private `loadScheduleItems`/`loadManualOverrides` delegate to the shared module — one implementation, no behavior change). Test: `loadInsights.test.ts` asserts zero HTTP fetches while a non-offseason lifecycle is driven from the seeded in-process schedule cache.
- Notes: The self-fetch was server-calling-its-own-routes-over-HTTP — bypassing the in-process pipeline and (subtly) omitting `manualOverrides`, so Insights' `games` could diverge from the standings the same function already consumes via `getCanonicalStandings`. Fix aligns Insights' game build exactly with `liveDeriveStandings` (identical inputs → identical `AppGame[]`). Considered exposing `games` off `getCanonicalStandings` instead, but it is `unstable_cache`-wrapped, so adding the full games array would bloat every standings snapshot across all consumers — rebuilding in-process from shared readers is leaner and changes no cache contract. The schedule read is deliberately cache-only: Insights never triggers an upstream provider fetch, and the prior anonymous self-fetch already only ever got cache/stale/503 (never upstream), so behavior is preserved and made explicit. Codex clean first pass. Verification: `tsc`/`lint:all`/`git diff --check` clean; loadInsights 5/5; affected insights/standings/selectors/schedule sweep 157/157. Branch `platform/platform-077-insights-canonical-games-in-process`, commit `4d6dad7`.
- Follow-ups: pre-existing parity question (out of scope) — `liveDeriveStandings` builds games without `conferenceRecords` (Insights now matches); whether canonical standings should pass them is PLATFORM-070-adjacent. Deferred ownership-attribution parity (PLATFORM-039) remains untouched.

### PLATFORM-076-DEBUG-ROUTE-CANONICAL-PARITY-v1

- Purpose: Make `/api/debug/*` diagnostics trustworthy by resolving identity/schedule/attachment against the SAME canonical pipeline production uses, instead of a weaker parallel one. Concretely (the V9 audit items): effective aliases (`?scope=effective`), `providerWeek` in the postseason debug index, and `manualOverrides`/`observedNames` surfaced in the identity diagnostics.
- Scope: `src/app/api/debug/_lib/loadDebugSeasonContext.ts` (fetch aliases at `?scope=effective` = stored global > year > SEED, matching `getScopedAliasMap('', year)`; forward the caller's admin credentials on all four context sub-requests so a cold admin-gated `/api/conferences` can't 503-degrade to `[]`; now takes `req`), `src/app/api/debug/scores/route.ts` (use the shared loader → gains `conferenceRecords` + effective aliases; was inlining fetches that omitted conferences and reset the conference index → wrong eligible-game set; adds `canonicalGamesTotal`/`gamesTruncated`), `src/app/api/debug/postseason-score-attachment/route.ts` (`providerWeek` in the `buildScheduleIndex` input + output; `closestCandidate` compares canonical identity keys via `resolveTeamIdentityKey` instead of raw-label `!==`, and matches week against canonical+provider; `extractRows` defaults null provider `seasonType` to the fetched type), `src/app/api/debug/resolve-team/route.ts` + `schedule-eligibility/route.ts` (effective scope; surface `aliasScope`/`observedNames`; `resolve-team` reports the matched `manualAliasOverride`). New tests: `debug/scores/__tests__`, `debug/resolve-team/__tests__`, extended `postseason-score-attachment` suite.
- Notes: Root cause was uniform — debug routes fetched `/api/aliases?year=` (the year-only stored editor view) rather than the effective resolver map, so every identity/eligibility verdict resolved against a strictly weaker alias set than production. Audited all 14 debug routes via four parallel read-only analyses; `debug/schedule`, `debug/scores-attachment`, `conference-diagnostics`, and both insights routes were already canonical. **Deliberately deferred (recorded in next-tasks, preserved as unresolved):** archive-audit/archive-integrity ownership attribution re-derives game→owner with resolver-keyed matching vs production's raw-label `getGameOwners`/`deriveFinalOwnedParticipations` — entangled with the PLATFORM-039 historical raw-label deferral (fixing it aligns the audit to production's _deferred_ behavior and reduces its precision), so it belongs to a separate ownership-parity follow-up; `game-stats-diagnostic` `resolveOwner` key-space mismatch (bespoke, no canonical counterpart); `schedule-eligibility` inline per-row eligibility vs `resolveRegularSeasonRow` (verdicts agree today, drift risk only); `insights-career-diagnostic` skips `computeRosterFallback`. Two Codex rounds converged (round 1 P2: shared loader wasn't forwarding admin auth → cold `/api/conferences` 503 silently degraded conference classification; round 2 clean). Verification: `tsc`/`lint:all`/`git diff --check` clean; debug suites 6/6; related identity/schedule/attachment/aliases suites 144/144. Branch `platform/platform-076-debug-route-canonical-parity`, commits `dadf006`…`4711078`.
- Follow-ups: the deferred ownership-attribution parity (archive + game-stats) is a coherent next task; `schedule-eligibility` orchestrator refactor and the `computeRosterFallback`/`conference-diagnostics` cold-instance notes are lower priority.

### PLATFORM-075-PROVIDER-QUOTA-HARDENING-PUBLIC-STALE-READS-v1

- Purpose: Protect the CFBD/Odds monthly quotas from public traffic by making the public `/api/odds` and `/api/scores` surfaces pure cache readers — anonymous requests never trigger a cold-cache upstream fetch — while keeping authorized refresh, admin diagnostics, and best-effort public freshness intact. Also: put `season` in the in-memory odds cache key and remove the dead `dayKey`.
- Scope: `src/app/api/odds/route.ts` (season-scoped in-memory key; anonymous path serves fresh hit / stale fallback / empty and never fetches — only `refresh=1` gated by `requireAdminAuth` fetches; filtered/non-canonical reads build from their own events with `seedDurableStore=false` so the full durable snapshot never leaks; `dayKey` removed), `src/app/api/odds/routeInternals.ts` (drop `dayKey` from the cache type/initializer/reset), `src/app/api/scores/route.ts` (anonymous cache-only; season-wide read aggregates the season snapshot + per-week caches in one `getAppStateEntries('scores', '${year}-')` read, deduped by canonical game identity via `teamIdentity`, newest-entry-wins; controlled empty 200 so the loader never fans out), `src/lib/server/appStateStore.ts` (`getAppStateEntries<T>(scope, keyPrefix?)`), `src/lib/scores/types.ts` (`ScoresMeta.cache` gains `'stale'`; `CfbdFallbackReason` gains `'upstream-suppressed'`; ESPN event/competition `date`), `src/lib/scores/normalizers.ts` (`toScorePackFromEspn` carries the ESPN kickoff date), `src/lib/scores.ts` + `src/components/hooks/useLiveRefresh.ts` + `src/components/admin/GlobalRefreshPanel.tsx` (thread `refresh=1` + admin auth headers on the admin/manual refresh paths only), `src/app/api/debug/{scores,scores-attachment,postseason-score-attachment}/route.ts` + `_lib/loadDebugSeasonContext.ts` (`forwardAdminAuthHeaders`; diagnostics fetch with `refresh=1` + forwarded admin auth). Tests across the odds/scores routes, scope, normalizers, and `useLiveRefresh`.
- Notes: Product call resolved as interpretation A — public is a pure cache reader; all upstream fetches require an authorized `refresh=1` (platform admin / server cron / `ADMIN_API_TOKEN` via `requireAdminAuth`); the league-password gate grants no fetch authority; public freshness is best-effort and quota protection wins. The hard part was the season-wide scores reconciliation: eight Codex rounds evolved it from a 200-empty (hid warm week caches) → 503 (client fan-out) → server-side week-level merge (double-counted postseason provider/canonical week aliases; an empty newer week entry erased season rows) → final **row-level dedup by canonical `teamIdentity` (pair + UTC date)**, which required populating the ESPN kickoff date so cross-provider rows key identically. Odds filtering had a parallel arc: cold filtered reads leaked the durable snapshot (round 5) then warm filtered hits still did (round 7) → `seedDurableStore` gate so only canonical queries read the durable store. Final round clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; affected sweep 177/177. Follow-up risk recorded below. Branch `platform/platform-075-provider-quota-hardening`, commits `6c5827d`…`3e5d139`.
- Follow-ups: public reads no longer warm the cache, so season-persistent odds/scores freshness now depends on the authorized `refresh=1` paths (admin action + any server cron) — confirm a cron or scheduled refresh keeps caches warm in production. `getAppStateEntries` is year-prefixed but still a scan; fine at current key counts.

### PLATFORM-074-DEBUG-ROUTES-PLATFORM-ADMIN-MIDDLEWARE-GATE-v1

- Purpose: Gate the `/debug/*` browser page family behind platform-admin authorization (the `/debug/teams` page had no server-side gate) and consolidate the platform-admin definition into one shared predicate.
- Scope: `src/lib/auth/platformAdmin.ts` (new — `isPlatformAdminClaims(sessionClaims)` = app role at `publicMetadata.role`; `requiresPlatformAdminPage(pathname)` = `/admin` + `/debug` families, prefix-or-segment match, `/api/*` excluded), `src/middleware.ts` (gate `/admin/*` + `/debug/*` via the shared helpers; removed the inline `publicMetadata.role` check; fail-closed redirects), `src/lib/server/adminAuth.ts` (`isPlatformAdminSession` delegates its role decision to `isPlatformAdminClaims`). New test: `src/lib/auth/__tests__/platformAdmin.test.ts`.
- Notes: `/api/debug/*` is intentionally NOT middleware-gated — all 12 routes already call `requireAdminAuth` at the route boundary (PLATFORM-020), which uniquely supports the `ADMIN_API_TOKEN` fallback middleware can't express. The four concerns stay distinct: Clerk auth, Clerk admin role, league password (`LEAGUE_AUTH_SECRET`), admin API token. Satisfies AGENTS.md Auth invariant #6 (no inline `publicMetadata.role` checks outside the shared helper — verified zero remain). Middleware wiring is a thin layer over the two pure functions (not executed under `node:test`; its logic is fully unit-covered). Codex review clean first pass. Verification: `tsc`/`lint:all`/`git diff --check` clean; new suite 6/6; existing `admin-debug-auth` 13/13; auth sweep 35/35. PR #364.

### PLATFORM-073-POSTSEASON-ATTACHMENT-EDGE-CASES-v1

- Purpose: Fix three postseason edge cases in the canonical score/schedule attachment layer without introducing cross-phase mismatches or missing provider-id matches.
- Scope: `src/lib/scoreAttachment.ts` (index by `providerGameId` independent of team hydration; null-`seasonType` rows scored per phase with cross-phase-rematch refusal that defers to a kickoff-date tiebreak; per-side provider-id side-attribution guard; `attachScoresToSchedule` stores in schedule orientation via `match.orientation`), `src/lib/schedule.ts` (explicit `hasRegularSeasonContext` guard on the postseason week remap). New tests: `lib/__tests__/postseasonAttachmentEdges.test.ts`.
- Notes: Odds attachment uses a separate pair-keyed index (`gameAttachment.ts`, no provider-id path), so defect 1 is scoped to the score path. Seven Codex rounds converged: the provider-id path had to become resolution-independent (for placeholder hydration) yet side-safe (accept only when every KNOWN schedule side is confirmed in the row's corresponding position), and the review surfaced a pre-existing reversed-orientation standings-corruption bug — `attachScoresToSchedule` had ignored `match.orientation` and stored positionally — now fixed by storing home/away in schedule orientation (covers provider-id, `reversed_pair_week`, and `pair_date`). Final round clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; new suite 12/12; full attachment / schedule / standings / seasonRollover / selectors suites 216/216. PR #363.

### PLATFORM-072-POST-CONFIRM-DRAFT-EDIT-OWNERSHIP-DRIFT-v1

- Purpose: Fix ownership drift when a draft pick is edited after confirmation. Confirmation copies picks into a separate persisted store (`owners:${slug}:${year}` / `'csv'`) that `parseOwnersCsv` → `gameOwnership` → standings consume; `PUT /pick/[n]` permits editing while `phase === 'complete'` but only updated draft state, so the confirmed CSV (and warm standings snapshot) kept crediting the old team→owner.
- Scope: `src/lib/draft.ts` (extracted the shared owners-CSV serialization: `buildConfirmedOwnersCsv` now returns `{ csv, rowCount }` with a structural count; new `patchConfirmedOwnersCsv` applies a single edit; shared `serializeOwnerRows` + `parseOwnersCsv` round-trip), `src/app/api/draft/[slug]/[year]/confirm/route.ts` (use the shared builder; validate the structural `rowCount` instead of splitting on `\n`), `src/app/api/draft/[slug]/[year]/pick/[n]/route.ts` (post-confirm edit patches the persisted CSV + `invalidateStandings(slug, year)`; passes its canonical resolver in). New tests: `draft/[slug]/[year]/__tests__/post-confirm-edit.test.ts` (route-level) + unit tests in `lib/__tests__/draft.test.ts`.
- Notes: Only `phase === 'complete'` resyncs; pre-confirm phases (incl. a draft reopened via confirm `DELETE`, which intentionally holds the last confirmed CSV until re-confirm) are unchanged. The patch MOVES the pick's claim (old-team→new-team) rather than rebuilding from picks, so it preserves unrelated `/api/owners` admin repairs. Five Codex rounds converged: split-newline row count → structural `rowCount`; full rebuild clobbering overrides → targeted patch; stale draft owner name after a correction → derive owner from the persisted `oldTeam` row; `NoClaim` prior row → fallback to draft owner; raw alias match → resolve rows through `teamIdentity` (route passes the resolver). Final round clean. Verification: `tsc`/`lint:all`/`git diff --check` clean; post-confirm suite (6) + draft unit tests + related suites (153) green. PR #362.

### PLATFORM-071-CRON-PRESEASON-STANDINGS-INVALIDATION-SWEEP-v1

- Purpose: Close the remaining documented `invalidateStandings` gaps for season-lifecycle and preseason ownership flows — mutations that change a league's standings surface but left the cached canonical snapshot stale (hard-refresh workaround).
- Scope: `src/app/admin/[slug]/actions.ts` (`confirmPreseasonOwners` → `invalidateStandings(slug, year)` before redirect; `beginPreseason` → `invalidateStandings(slug)`), `src/app/api/cron/season-rollover/route.ts` (per successfully rolled-over league, inside the loop), `src/app/api/cron/season-transition/route.ts` (per transitioned league, bound to the successful `updateLeagueStatus` flip — before the separate `updateLeague` year-sync so a failing year-sync can't strand a stale snapshot), `src/lib/selectors/leagueStandings.ts` (docstring: paths moved from "Known gaps" to "Wired into"; stale global-alias enumeration note corrected to the PLATFORM-070 shared-tag model). New tests: `admin/[slug]/__tests__/actions.test.ts`, `api/cron/season-rollover/__tests__/route.test.ts`, `api/cron/season-transition/__tests__/route.test.ts`.
- Notes: All four flows are league-scoped → per-league `invalidateStandings` (umbrella tag covers all cached years); no global tag, no registry enumeration. Failure/unauthorized/no-op/skip paths do not invalidate. Deliberately not wired (recorded in the docstring): `completeSetup` (setupComplete flag; no standings-content change) and the `slug='test'` dev-tooling actions. Three Codex rounds: runtime design accepted clean; fixed a transition invalidation-ordering edge case (P2 — invalidate on the status flip, not after the year-sync) and season-transition test determinism vs an inherited `CFBD_API_KEY` (P2 — stub upstream fetch). Verification: new suites (actions 3/3, rollover 4/4, transition 3/3) + related 141/141 + broader sweep 35/35; `git diff --check`/`tsc`/`lint:all` clean. Commit `957956d`; PR #361.

### PLATFORM-070-TEAM-DB-WRITES-STANDINGS-INVALIDATION-v1

- Purpose: Close the team-database write → canonical standings invalidation gap. `POST /api/admin/team-database` resynced the catalog (via `setTeamDatabaseFile`) but never invalidated standings, so warm `unstable_cache` snapshots kept resolving against the pre-sync catalog (team identity/canonical IDs/derived alts/FBS-FCS classification consumed by `computeCanonicalStandings` via `getTeamDatabaseItems()`).
- Scope: `src/lib/selectors/leagueStandings.ts` (add `ALL_STANDINGS_TAG` to every snapshot's tags; `invalidateAllLeaguesStandings()` busts that one shared tag — synchronous, no registry enumeration), `src/app/api/admin/team-database/route.ts` (invalidate after the write), `src/app/api/aliases/route.ts` (route the two global-scope invalidations through the shared helper), `src/lib/server/teamDatabaseStore.ts` (replace the process-lifetime `memoryStore` singleton with per-request `React.cache` so catalog reads are cross-instance fresh). New tests: `admin/team-database/__tests__/route.test.ts`, `lib/server/__tests__/teamDatabaseStore.test.ts`; updated `aliases/__tests__/route.test.ts` to the shared tag.
- Notes: Year/league-scoped mutations still use `invalidateStandings(slug, year)` unchanged. Design converged across three Codex rounds — P2 (registry-read ordering) → P1 (cross-instance catalog staleness defeated tag invalidation) → P2 (pre-write snapshot registry race) — landing on a single shared tag (race-free, no post-commit `getLeagues()` to fail) plus per-request catalog reads. Alias precedence unchanged (`stored global → year → SEED_ALIASES`); no league-scoped runtime aliases; no second resolver. Deferred (unchanged): `confirmPreseasonOwners` action + cron season transitions → PLATFORM-071. Verification: affected/related suites green (192/192 combined), `git diff --check`/`tsc`/`lint:all` clean; final Codex review clean ("The patch correctly invalidates canonical standings after global catalog or alias mutations and removes the stale process-level team catalog cache. No actionable regressions were identified."). Commit `ead1120`; PR #360.

### PLATFORM-069-DRAFT-WIN-TOTALS-CANONICAL-ALIAS-SOURCE-v1

- Purpose: Fix the remaining draft/win-totals alias-source bypass after PLATFORM-067 — resolve team names through the shared canonical scoped alias source instead of a locally built year+seed map that ignored stored global aliases.
- Scope: `src/app/api/draft/[slug]/[year]/pick/route.ts`, `pick/[n]/route.ts`, and `src/app/api/admin/win-totals/route.ts` — each replaced its `{ ...SEED_ALIASES, ...aliases:${year} }` construction with `getScopedAliasMap('', year)` (precedence **stored global → year → SEED_ALIASES**). Matching still flows through `createTeamIdentityResolver`; no second resolver, no local precedence. Tests: `pick-eligibility.test.ts` (stored-global regressions for POST /pick + PUT /pick/[n] + no-alias control) and new `win-totals-alias-source.test.ts` (stored-global honored/persisted-canonical, control unresolved, seed + year-scoped fallbacks preserved).
- Notes: `confirm/route.ts` inspected — writes already-canonical eligible team names, resolves no raw labels, so unchanged. No league-scoped runtime aliases reintroduced; no unrelated runtime behavior changed. Post-confirm draft-edit ownership drift remains **PLATFORM-072** (out of scope). Verification: new suites 12/12; related draft/teamIdentity/alias/odds suites 162/162; `git diff --check`, `tsc --noEmit`, `lint:all` clean. Independent Codex review clean ("The changed routes consistently use the canonical scoped alias source while preserving existing resolution and eligibility behavior. No actionable regressions were identified."). Commit `996a0f4`; PR #359.

### PLATFORM-067-REMOVE-LEAGUE-ALIAS-LAYER-v1

- Purpose: Remove league-scoped aliases from canonical alias resolution — team aliases are not league-specific (settled product decision). Final runtime precedence: **stored global → year → SEED_ALIASES**. Unblocked by the PLATFORM-066 production data check.
- Scope: `src/lib/server/globalAliasStore.ts` (`getScopedAliasMap` drops the `aliases:${slug}:${year}` layer; precedence docs). Precedence-comment sweep across draft (`draftSchedule.ts`, `board/boardData.ts`, `draft/page.tsx`), `bootstrap.ts`, `selectors/leagueStandings.ts`, `owners`/`owners/validate` routes, `debug/{archive-audit,game-stats-diagnostic}` routes, `aliasesApi.ts`, `storageKeys.ts`, `CFBScheduleApp.tsx`. Tests rewritten to assert league-scope is ignored / global>year across store, aliases route, canonical standings, draft, board, season rollover, insights, owner validation.
- Notes: `getScopedAliasMap(_leagueSlug, year)` keeps the slug arg for API/call-site compatibility but it no longer affects resolution. **PLATFORM-066 production data check** found NO unique league-scoped repairs — all prod `aliases:${slug}:${year}` entries (`test:2025`, `test:2026`, `tsc:2025`) were copied current-seed defaults already represented in `aliases:global` + `SEED_ALIASES`, so **no migration was required** (prod migration sentinel already set). The legacy migration scan (`migrateYearScopedAliasesToGlobal`, incl. its league-scope arm) is **retained as a safety net** for historical app-state; its tests are unchanged. Redundant production league-scoped seed-copy keys were **NOT** deleted. Preserved: `getGlobalAliases`, `getStoredGlobalAliases`, `mergeAliasLayers`, `hashSeedAliases`, `SEED_ALIASES`, `SEED_ALIASES_HASH` cache identity, copied-seed-default demotion, year-alias behavior, `/api/aliases` writes, client bootstrap fetch/retry/cache, canonical standings logic beyond alias source, schedule/liveDelta identity, score attachment, ownership. No production app-state mutated. Codex review clean ("The runtime alias resolver consistently removes the league-scoped layer while preserving global, year, and seed precedence. Updated consumers and tests align with the intended PLATFORM-067 behavior."). Full `npm test` 1151 pass / 0 fail; tsc/lint:all/build green. Commit `b82f8ac`; PR #355.
- Follow-up: optional league-scoped seed-key cleanup — delete redundant production `aliases:${slug}:${year}` seed-copy keys and consider retiring the legacy league-scope migration scan after another safety check. (ID note: this was informally earmarked "PLATFORM-068", but that ID was subsequently assigned to the app-wide audit — `PLATFORM-068-FABLE-APP-WIDE-AUDIT`. Track this seed-key cleanup within the post-`PLATFORM-069` cleanup batch in `docs/next-tasks.md`, not as PLATFORM-068.)

### PLATFORM-066-LEAGUE-ALIAS-DATA-CHECK-v1

- Purpose: Read-only production data check gating PLATFORM-067 — confirm whether any stored `aliases:${slug}:${year}` keys exist and whether they are already represented in `aliases:global`. No code or app-state changes.
- Scope: read-only `SELECT` against production `app_state` (Neon); no writes, no promotion, no deletes, no app routes called.
- Notes: Migration sentinel `aliases:global::migration-done` is SET in prod. Only 3 league scopes exist — `aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025` (test/dev leagues) — and every entry is a copied current-`SEED_ALIASES` default already present in `aliases:global` (62 entries) with identical targets. Zero entries need promotion; zero conflicts; no real production league has a unique league-scoped repair. **Classification: safe to remove the league layer with no data migration** → executed as PLATFORM-067.

### PLATFORM-065-CLEANUP-ORPHANED-STAGING-UTILS-v1

- Purpose: Dead-code cleanup of the alias-**staging** helpers left orphaned after PLATFORM-064 removed the hidden league-scoped alias editor and its write path. No behavior change.
- Scope: deleted `src/lib/aliasStaging.ts` (`stageAliasFromMiss`); removed `hasStagedAliasChanges` + `getAdminAlertCount` from `src/lib/adminDiagnostics.ts` (+ its now-unused `AliasStaging` import); pruned the two tests that exclusively exercised `getAdminAlertCount` (`CFBScheduleApp.test.tsx`, `IssuesPanel.test.tsx`) + their orphaned `DiagEntry` import.
- Notes: Reachability confirmed all three helpers had **zero reachable production callers** post-064 (`aliasStaging.ts` no importers; `hasStagedAliasChanges` no refs; `getAdminAlertCount` test-only). Kept `splitIssueDiagnostics` — still live in `IssuesPanel.tsx`. **`storageKeys.aliasMap` (`cfb_name_map:*`) deliberately preserved**: `bootstrap.ts` still reads it as the read-only legacy degraded fallback (then clears it after a durable effective-cache write), so it is NOT dead — untouched here. No change to `getScopedAliasMap`, `mergeAliasLayers`, `/api/aliases`, `/admin/aliases`, `/admin/diagnostics`, bootstrap fallback precedence, or schedule/liveDelta identity. Reported-but-not-removed: the `AliasStaging` type (`diagnostics.ts:64`) + its `cfbScheduleTypes.ts` re-export are now consumer-less, left in place to keep the PR scoped to the named candidates (candidate future cleanup). Codex review clean ("The removed utilities have no remaining references, and the relevant scoped tests and TypeScript check pass"). Focused suites (bootstrap/aliases/aliasLayers/globalAliasStore/CFBScheduleApp/teamIdentity/gameOwnership/scoreAttachment) 1151 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang). Commit `0a2c9bb`; PR #354.
- Follow-up (remaining from the PLATFORM-061 audit): data-gated league alias layer removal — **done in PLATFORM-067** (prod data check PLATFORM-066 → league layer removed from `getScopedAliasMap`).

### PLATFORM-064-REMOVE-HIDDEN-LEAGUE-ALIAS-EDITOR-v1

- Purpose: Remove the unreachable in-app league-scoped alias editor + its write path (surfaced by the PLATFORM-061 audit; safe now per PLATFORM-062/063 follow-ups). No reachable behavior change.
- Scope: `CFBScheduleApp.tsx` (editor state/handlers), `AdminDebugSurface.tsx`, `IssuesPanel.tsx`, `aliasesApi.ts` (`saveServerAliases`/`loadServerAliases`), `bootstrap.ts` + `useScheduleBootstrap.ts` (stored-editor map load), `src/app/api/aliases/route.ts` (`?league=` GET/PUT branch); rewrote `bootstrap`/`aliases-route`/`IssuesPanel` tests. Kept `AliasEditorPanel` (`/admin/aliases` global editor) and `ScoreAttachmentDebugPanel` (`/admin/diagnostics`).
- Notes: The league editor rendered only under `CFBScheduleApp surface==='admin'`, which no route mounts (only a test), so its `PUT /api/aliases?league=` write path had no reachable caller. The league RESOLUTION layer in `getScopedAliasMap` is untouched (separate data-gated follow-up); it stays the ONLY client path to league-scoped repairs (via `GET ?scope=effective`). Client identity now flows solely through the effective resolver map. Nothing writes the legacy stored alias cache (`cfb_name_map:*`) anymore; legacy + effective caches are retained only as resolver fallback INPUTS during a degraded (offline) bootstrap. Editor commit `13f3070`; PR #353.
- Notes (Codex remediation — four sequential P2s, converged clean on the 5th review): (1) `172a56b` — removing the editor dropped the legacy stored cache from the effective-alias outage fallback; restored it as a READ-ONLY fallback layer so an upgraded pre-064 client with league repairs only in `cfb_name_map:*` (e.g. a mid-bootstrap quota failure dropped the effective cache) isn't rebuilt from seeds alone during an outage. (2) `bcb06fb` — the effective fetch is the sole client path surfacing league repairs, so a transient failure on a cold cache diverged identity; wrapped `loadEffectiveAliases` in a bounded retry (3 attempts, 150/300 ms backoff) that re-fetches the full resolver map (chosen over the reviewer's independent stored fetch, which on this branch can only return the deprecated year scope, not league repairs). (3) `8023cdf` — a removed `PUT /api/aliases?league=` was silently reinterpreted as a year-scoped write that mutates every league; now rejected with `410 Gone` (points to `?scope=global` or the year-scoped write). (4) `6073a1f` — the `172a56b` layer sat ABOVE the effective cache, letting a stale legacy copy override a freshly-fetched resolver map on a later outage; reordered to `[effectiveCache, legacyStored, seeds]` (effective wins collisions; legacy fills gaps / is sole source when no effective cache exists) AND clear the legacy `cfb_name_map:*` keys after a durable effective-cache write (skipped if the write throws, so it survives as fallback when it's the only copy). Tests: bootstrap suite (13) covers cold-cache legacy recovery, effective-over-legacy precedence, clear-on-success, and retry recovery; aliases-route test asserts `?league=` PUT → 410 + no write + no invalidation. Focused bootstrap/alias suites (13 + 57) + tsc/lint:all/build green each round. Full `npm test` not run (documented Overview hang). Final Codex review: clean ("No actionable regressions were identified").
- Notes (live verification, `/verify`): drove the route over HTTP against `next dev`. `PUT /api/aliases?league=foo&year=2025` (admin token) → `410` with the removal message and NO write landed (year map still `{}`); no-token → `401` (auth precedes the guard); whitespace `?league=%20` → `410`; control `PUT ?year=` (no league) → `200` write intact; `GET ?scope=effective&league=` → `200` resolver map intact; SSR `/` → `200` (CFBScheduleApp renders post-removal) and `/admin/aliases` + `/admin/diagnostics` → `307 → /login` (kept routes still mounted, not 500). The client `bootstrap.ts` change (retry / `[effective, legacy, seeds]` fallback / clear-legacy) is browser-only (no server surface) — not driven live; covered by the bootstrap unit suite.
- Follow-ups (remaining from the PLATFORM-061 audit): (1) orphaned staging-utility cleanup — **done in PLATFORM-065** (`aliasStaging.ts` / `hasStagedAliasChanges` / `getAdminAlertCount` deleted as dead; `storageKeys.aliasMap` kept as the read-only fallback); (2) data-gated league alias layer removal — **done in PLATFORM-066 (prod data check) + PLATFORM-067 (layer removed)**.

### PLATFORM-063-REMOVE-DEAD-TRENDS-PAGEDATA-v1

- Purpose: Delete the dead `trendsPageData` module + its test (dead-code cleanup surfaced by PLATFORM-062). No live behavior change.
- Scope: deleted `src/lib/trendsPageData.ts` and `src/lib/__tests__/trendsPageData.test.ts`.
- Notes: `trendsPageData.ts` (`loadCanonicalTrendsPageData` / `TrendsPageData`) was imported only by its own test — no production importers, no barrel re-exports. The live trends page (`src/app/league/[slug]/trends/page.tsx`) redirects to `standings?view=trends`, which renders through the canonical standings/client-bootstrap path; that redirect is untouched. Post-delete: zero dangling references, tsc/lint:all/build green, focused standings/aliases/odds/selectors/globalAliasStore suites (115 tests) green. Codex review clean ("deleted module was referenced only by its deleted test; the live trends route uses the canonical standings flow"). Full `npm test` not run (documented Overview hang).
- Follow-ups (remaining from the PLATFORM-061 audit): (1) hidden league alias editor removal (safe now — unreachable UI); (2) data-gated league alias layer removal (needs prod data check + product decision).

### PLATFORM-062-CANONICAL-ALIAS-ODDS-TRENDS-v1

- Purpose: Align the remaining odds/trends alias consumers with canonical effective resolution. Focused correctness PR — does NOT remove league-scoped aliases or the hidden editor.
- Scope: `src/app/api/odds/route.ts` (+ `route.test.ts`). Trends was found to be **dead code** (see below) — not modified.
- Notes: `odds/route.ts` `readAliasesForSeason` read only `aliases:${season}` (year scope) + hand-merged `SEED_ALIASES`, **missing stored global aliases**, so odds identity could diverge from canonical schedule/standings. Odds requests carry **no league context** (`/api/odds` query is season+markets; client fetches `?year=` only), so odds now resolves via `getScopedAliasMap('', season)` → stored global > year > SEED_ALIASES (league+year layer N/A). Removed the obsolete `readAliasesForSeason` helper + unused `SEED_ALIASES` import; no raw merge remains. Codex review clean ("odds route now uses the canonical effective alias map with the intended precedence … No regressions"). Tests: end-to-end GET proving an odds-provider label resolves to its canonical game ONLY via a stored global alias (impossible under the old year-only read), plus focused `getScopedAliasMap('', season)` source tests (year-only, SEED_ALIASES fallback, global-over-year precedence). Focused suites (218 tests) + tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- **Trends finding:** `src/lib/trendsPageData.ts` (`loadCanonicalTrendsPageData`) is **DEAD CODE** — imported only by its own test; the trends page (`src/app/league/[slug]/trends/page.tsx`) redirects to `standings?view=trends`, which renders via the canonical client bootstrap (`effectiveAliasMap`) + standings selectors. No live trends divergence exists, so it was NOT "fixed." Scheduled for deletion under **PLATFORM-063-REMOVE-DEAD-TRENDS-PAGEDATA-v1** (delete `trendsPageData.ts` + its test after confirming no imports).
- Follow-ups (separate, from the PLATFORM-061 audit): (1) PLATFORM-063 delete dead `trendsPageData`; (2) hidden league alias editor removal (safe now); (3) data-gated league-scope layer removal (needs prod data check + product decision).

### PLATFORM-060-CANONICAL-ALIAS-REMAINING-CONSUMERS-v1

- Purpose: Fix the two remaining raw alias-consumer divergences found after the alias-model sequence (055→057→059→058). Focused correctness PR — does NOT remove league-scoped aliases.
- Scope: `src/app/league/[slug]/draft/page.tsx`, new `src/app/league/[slug]/draft/draftSchedule.ts` (+ test), `src/app/api/debug/{archive-audit,archive-integrity,game-stats-diagnostic}/route.ts`.
- Notes: `draft/page.tsx` had hand-merged `{ ...SEED_ALIASES, ...aliases:${year}, ...aliases:${slug}:${year} }` for both current- and prior-year schedules — it **missed stored `aliases:global`** and used **inverted precedence** (league > year, no stored-global tier), so draft-board identity could mis/unresolve a global- or seed-resolved team vs canonical/live. Both blocks now resolve via a small testable helper `resolveDraftScheduleGames()` → `getScopedAliasMap(slug, year)` (stored global > league+year > year > SEED_ALIASES); the helper returns the map so the prior-year score-attachment resolver reuses it. The three debug routes each hand-rolled the same `[league, year, global]` accumulator merge (also inverted, no seeds) and now call `getScopedAliasMap`; dead `loadAliasMap` helpers + unused imports removed. No alias storage/schema, `/api/aliases`, client bootstrap, or canonical-standings changes; **league scope still read as a layer** (removal deferred). Codex review clean ("routes alias resolution through the canonical scoped alias map without introducing functional regressions"). New `draftSchedule.test.ts` proves global-only, year-only, and SEED_ALIASES fallbacks + precedence (global > league+year > year); focused suites (210 tests) + tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- Follow-up: the **league-scoped alias removal / hidden in-app editor decision** remains a separate product-gated item (see PLATFORM-058 note) — intentionally out of scope here.

### PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP-v1

- Purpose: Final alias-model item — make the client resolve schedule/liveDelta identity via the effective scoped alias map (stored global > league+year > year > SEED_ALIASES) instead of the stored league map, so the matchup/ownership UI and liveDelta agree with server canonical for global/year/seed-resolved aliases. **Completes the alias-model sequence 055 → 057 → 059 → 058.**
- Scope: `src/app/api/aliases/route.ts` (`?scope=effective` GET), `src/lib/aliasesApi.ts` (`loadEffectiveAliases`), `src/lib/bootstrap.ts` + `src/components/hooks/useScheduleBootstrap.ts` + `src/components/CFBScheduleApp.tsx` (stored-for-editor vs effective-for-resolver split), `src/lib/aliasLayers.ts` (shared pure `mergeAliasLayers` + `hashSeedAliases`), `src/lib/effectiveAliasCache.ts` (seed-versioned client cache), `src/lib/storageKeys.ts`. Tests: aliases-route effective GET, `aliasLayers`, expanded `bootstrap` (stored/effective split, partial-fetch, reconciliation, seed-version invalidation).
- Notes: **Stored vs effective are deliberately distinct.** `GET /api/aliases?scope=effective` is the read-only resolver view (`getScopedAliasMap`); the default `?league=` GET stays the editable STORED view, so the in-app alias editor never round-trips global/seed defaults into a scope. `getGlobalAliases`/`getScopedAliasMap` refactored onto the shared `mergeAliasLayers` (identity precedence + spelling preservation), also used by the client offline fallback so stored-over-seed precedence matches the server. Client bootstrap loads BOTH maps (stored→editor, effective→resolver via `buildScheduleFromApi`/`useLiveRefresh`), removed the client seed-if-empty write. Effective cache is seed-hash-versioned (`hashSeedAliases`, moved into the client-safe `aliasLayers`); the degraded fallback reconciles fresh-stored + version-matched-cache + current-seeds rather than trusting a flattened cache. Post-save flow: rebuild games with the fresh map first and publish state/cache only after a successful rebuild; `router.refresh()` runs in `finally` so canonical refreshes even if the client rebuild fails. Hardened across 6 Codex remediation rounds (all in the offline/save failure paths). Focused suites green; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- **Manual browser verification note:** The league-scoped alias editor/save-flow is NOT reachable through exposed production UI — it is gated behind `surface === 'admin'` (`CFBScheduleApp.tsx:1341/1779`, `AdminDebugSurface`/`AliasEditorPanel`), and no production route mounts `CFBScheduleApp` with that surface (every mount is a league page with the default `surface='league'`; `surface="admin"` appears only in `CFBScheduleApp.test.tsx`). So the post-save React wiring is covered by type/build/component-level coverage and code review, not manual browser verification. The exposed runtime surface that WAS verified live (/verify): `GET /api/aliases?scope=effective` returns the effective resolver map with `global > seed` precedence and year-fill; the default league alias GET stays stored-only (no seed leakage); normal league pages consume the effective map for schedule/liveDelta identity via `useScheduleBootstrap`.
- Follow-up: none required for the alias model. Product note: the in-app league-scoped alias editor is currently unreachable (admins manage aliases via `/admin/aliases`, global scope); consider wiring it up or removing the dead editor UI.

### PLATFORM-059-CANONICAL-ALIAS-SERVER-CONSUMERS-v1

- Purpose: Align the last server-side alias consumer with the effective scoped alias map after PLATFORM-055/057, so rollover/backfill archives can't diverge from live canonical.
- Scope: `src/lib/seasonRollover.ts` (`buildSeasonArchive`). Tests: new `src/lib/__tests__/seasonRollover-aliases.test.ts`.
- Notes: **`buildSeasonArchive` now consumes `getScopedAliasMap(slug, year)`** (stored global > league+year > year > `SEED_ALIASES`) instead of loading only `aliases:${slug}:${year}` for game identity — the same effective resolution live canonical standings use, feeding both `buildScheduleFromApi` and the score-attachment resolver. Removed the private league-only alias load; archive persistence format and display labels unchanged. `loadInsightsForLeague`'s games builder was already migrated in PLATFORM-057 — verified, not changed. Tests prove the archive resolves games via global-only / year-only / `SEED_ALIASES` fallbacks, a league+year repair beating the seed, and archive standings agreeing with live canonical for the same fixture. Codex review clean (no findings). Focused suites 186 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- Follow-up (final alias-model item): **PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP** — now fully unblocked; change the client GET/bootstrap to consume the effective map.

### PLATFORM-057-SEED-ALIASES-TO-GLOBAL-v1

- Purpose: Make the static `SEED_ALIASES` bundle globally available to all server alias consumers so PLATFORM-058 can safely change client alias bootstrap. Prerequisite for 058.
- Scope: `src/lib/server/globalAliasStore.ts` (effective-map model + reconciliation), `src/lib/selectors/leagueStandings.ts` (cache-key seed versioning), `src/app/api/aliases/route.ts` (stored-only global GET), `src/app/api/owners/route.ts` + `src/app/api/owners/validate/route.ts` + `src/lib/insights/loadInsights.ts` (league-aware consumers → `getScopedAliasMap`). Tests: `globalAliasStore.test.ts` (expanded), new `owners/validate/__tests__/route.test.ts`, updated aliases-route + standings tests.
- Notes: **Approach (user-approved): seeds are merged IN-MEMORY, not persisted.** After weighing a persist+versioned-sentinel design, chose to expose `SEED_ALIASES` as a code-defined lowest-precedence layer, which dissolved the write/invalidation/versioning problems at the root. Final model:
  - Effective precedence **stored global > league+year > year > SEED_ALIASES** (seeds are defaults; any persisted manual repair beats them). Cross-layer conflicts dedup by resolver identity (`normalizeTeamName`); every distinct lookup spelling is preserved and a shadowed lower-layer spelling is remapped to the higher winner (so exact-key `validateRosterCSV` still resolves it).
  - Helpers: `getStoredGlobalAliases()` (persisted-only, admin GET), `getGlobalAliases()` (effective, global-only consumers), `getScopedAliasMap(slug, year)` (league-aware effective). All league-aware consumers use `getScopedAliasMap` — a seed can never override a scoped repair.
  - Canonical standings cache is versioned by `SEED_ALIASES_HASH` (folded into the `unstable_cache` key) so a seed change busts warm snapshots with no runtime write.
  - Persisted bootstrap copies (`bootstrapAliasesAndCaches` writes the seed bundle into empty scopes) are demoted in-memory via `KNOWN_SEED_DEFAULTS` (current + `RETIRED_SEED_DEFAULTS` for superseded targets) so they can't permanently shadow a corrected seed; a same-key different-target entry stays a manual repair. Documented residual: a manual repair identical to a seed default is indistinguishable and treated as a copy.
  - One-time legacy promotion (`migrateYearScopedAliasesToGlobal`) skips copied seed defaults, remaps normalized-identity collisions to the stored-global winner, and treats a copied default at an exact key as absent so a same-key repair still promotes.
  - Process-local write lock (re-read inside lock) serializes the remaining global writers; no read-path writes; admin global GET stays stored-only; `/api/aliases` league GET unchanged.
- Review: hardened across **9 Codex rounds** (in-memory pivot, then precedence/spelling/promotion/reconciliation edge cases + a NUL-separator encoding fix). Focused suites green each round; `tsc`/`lint:all`/`build` green. Full `npm test` not run (documented Overview hang).
- Follow-ups (sequencing preserved): **PLATFORM-059-CANONICAL-ALIAS-SERVER-CONSUMERS** — `seasonRollover.ts:buildSeasonArchive` still loads only `aliases:${slug}:${year}`; the `loadInsightsForLeague` games builder was already swapped to `getScopedAliasMap` here, so 059 primarily covers the archive builder. Then **PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP** — deferred until now-complete (static seeds live in the effective model); change the client GET/bootstrap to consume the effective map.

### PLATFORM-055-CODEX-FINDINGS-REMEDIATION-2-v1

- Purpose: Address Codex re-review of PLATFORM-055 — align every active alias consumer with canonical's effective (global-first) alias semantics. Two findings: (P1) client schedule bootstrap still loads league-scoped aliases only; (P2) Insights context used a private league-first merge.
- Scope: `src/lib/insights/context.ts` (P2, shipped); P1 flagged as a scope boundary (not shipped). Tests: new `src/lib/__tests__/insights-context-aliases.test.ts`.
- Notes: **P2 shipped** — `insights/context.ts` `loadOwnerSeasonStats` now resolves via `getScopedAliasMap` instead of the private `[league, year, global]` accumulator-wins merge (which was league-first and lacked the normalized dedup). Same resolver wiring as canonical; removed dead `loadAliasMap` + now-unused `getAppState`/`AliasMap` imports. New test proves a conflicting global-vs-league alias credits the global target (Alice) not the league target (Bob) through the real `aggregateOwnerSeasonStats` path. Focused suites 183 pass / 0 fail; tsc/lint:all/build green. **P1 NOT shipped — reported as a boundary:** naively changing `/api/aliases` GET (league branch) to return the effective map breaks the `SEED_ALIASES` seeding coupling. `bootstrap.ts:114-120` seeds the ~20-entry static `SEED_ALIASES` bundle (e.g. `ole miss`→`mississippi`) into `aliases:${slug}:${year}` **only when the league GET returns empty**; both the client map AND server canonical (`getScopedAliasMap` reads that scope) depend on it. If GET returns the merged map, a non-empty global store makes a never-seeded league look non-empty → seeding skipped → both client and canonical lose the static aliases. Correct fix requires migrating `SEED_ALIASES` into the global store (broad alias-model migration — explicitly out of PLATFORM-055 scope) or broadening GET to seed server-side (prohibited "mutation on GET"). Recommended follow-up: **PLATFORM-057-SEED-ALIASES-TO-GLOBAL** then the client GET effective-map change.

### PLATFORM-055-CODEX-FINDINGS-REMEDIATION-v1

- Purpose: Fix the two Codex review findings on PLATFORM-055 before merge (in-scope corrections, not follow-ups): (P1) alias precedence could be violated after key normalization; (P2) not every newly consumed alias writer invalidated canonical standings.
- Scope: `src/lib/server/globalAliasStore.ts` (dedupe the effective map by resolver identity), `src/app/api/aliases/route.ts` (year-only PUT + global GET migration invalidation); tests in `globalAliasStore.test.ts`, `aliases/route.test.ts`, `selectors-leagueStandings.test.ts`.
- Notes: **P1** — `getScopedAliasMap` now collapses entries by `normalizeTeamName` identity (the key `buildCanonicalRegistry` collides on — coarser than `normalizeAliasLookup`; the resolver registry is first-wins), precedence-ordered global > league+year > year. Two textually distinct keys that normalize to one identity (e.g. `gulf coast tech` vs `gulfcoasttech`) no longer let the lower-precedence scope win by insertion order; the higher-precedence key survives and the dup is dropped. Exact-key conflicts are a subset (unchanged). Benefits the draft board consumer too (its exact-key precedence test stays green). **P2** — year-only PUT (`aliases:${year}`, used by TeamsDebugPanel) now enumerates the registry and invalidates each league for that year; the global GET lazy migration invalidates every registered league only when it actually moved entries (`migrated > 0`, sentinel-guarded → fires at most once). Global PUT + league-scoped PUT invalidation unchanged. No change to ownership/`teamIdentity.ts`/persistence/UI/liveDelta; archived snapshots untouched; client GET response shape unchanged. Focused suites 156 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).

### PLATFORM-055-CANONICAL-GLOBAL-ALIAS-MERGE-v1

- Purpose: Make canonical standings consume the effective (scoped) alias map instead of the league-only scope, and invalidate affected canonical standings caches when global aliases change — fixing a canonical identity correctness bug (global-only aliases never reached live derivation, so canonical roster owners were mis-credited) and the paired stale-cache gap.
- Scope: `src/lib/selectors/leagueStandings.ts` (swap private `loadAliasMap` → `getScopedAliasMap`; delete dead loader; update invalidation docs); `src/app/api/aliases/route.ts` (global PUT enumerates the registry and calls `invalidateStandings(slug)` per league). Tests: new `src/lib/server/__tests__/globalAliasStore.test.ts`, new `src/app/api/aliases/__tests__/route.test.ts`, and alias-scope integration cases added to `selectors-leagueStandings.test.ts`.
- Notes: Precedence preserved (global > league+year > year) via the existing `getScopedAliasMap`; no new merge helper, all matching still through `teamIdentity.ts`. Global alias writes invalidate the per-league umbrella tag only (no year), since a global alias can affect any cached year. Route invalidation is observed in tests via the established `work-async-storage` `pendingRevalidatedTags` shim (frozen `next/cache` export cannot be spied; `unstable_cache` is bypassed under `node:test`). Integration tests credit an owner via a global-only alias (1–0) with a negative control (no alias → 0–0), plus global-over-league conflict, league-only fallback, and no-alias catalog paths. Ownership/`gameOwnership.ts`/`teamIdentity.ts`/persistence untouched; archived snapshots untouched. Focused suites (teamIdentity, gameOwnership, scoreAttachment, selectors-leagueStandings, globalAliasStore, aliases, boardData, insights) 167 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run — CLAUDE.md documents it hangs on Overview tests with no usable signal; `lint:all` is the pre-merge gate. Resolves the PLATFORM-053 candidate (2).

### PLATFORM-053-INSIGHTS-CANONICAL-STANDINGS-INPUTS-v1

- Purpose: Make `loadInsightsForLeague` consume canonical standings rows/history from `getCanonicalStandings` instead of independently re-deriving standings (`deriveStandings`/`deriveStandingsHistory`) from schedule/scores/CSV/aliases — fixing a P1 where Insights could disagree with the canonical archive/offseason lifecycle, empty snapshots, and coverage/cache state.
- Scope: `src/lib/insights/loadInsights.ts` (standings rows/history from canonical; removed the local derivation + the score fetch that only fed it). Tests: new `loadInsights.test.ts`.
- Notes: Standings rows/history now come from `getCanonicalStandings({ slug, year, currentDate })` (`canonical.rows` → currentStandings; `canonical.standingsHistory` → weeklyStandings + `selectSeasonContext`); authoritative even when empty/null, no local fallback. `games`/roster/rankings/lifecycle/suppression preserved. Codex flagged 3 items — all confirmed as **consequences of aligning Insights to canonical** and **shipped as-is** (canonical is the source of truth for all surfaces; re-adding local paths would reintroduce the divergence): (1) canonical reads scores from the persisted cache only (no self-warm) — same as Standings/Overview; cold-cache freshness is a canonical/scores-layer concern → follow-up **PLATFORM-054-CANONICAL-SCORE-CACHE-WARMING** (candidate). (2) canonical resolves **league-only** aliases (no global merge) — pre-existing, shared by all canonical surfaces → the already-deferred alias-scope consolidation → **PLATFORM-055-CANONICAL-GLOBAL-ALIAS-MERGE** (candidate). (3) Insights active owners still come from the CSV roster via `buildInsightContext`/`computeRosterFallback` — **pre-existing, untouched by this PR** (prompt required preserving roster) → **PLATFORM-056-INSIGHTS-CANONICAL-OWNER-SOURCING** (candidate). No canonical generation change, no route-loader change, no `router.refresh`, no UI change. `npm test` 1073 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-051-OVERVIEW-LIVEDELTA-OVERLAY-v1

- Purpose: Add the Standings/Members-compatible pending W–L `liveDelta` badge to Overview Top-N standings rows (Overview previously received `liveDelta` but `void`ed it). Preceded by the read-only **PLATFORM-050-OVERVIEW-LIVEDELTA-OVERLAY-AUDIT-v1**.
- Scope: `src/components/OverviewPanel.tsx` (consume `liveDelta`; thread into `CondensedStandingsTable`; badge beside record). Tests: `OverviewPanel.test.tsx`.
- Notes: Presentation-only badge on Top-N rows via the shared `selectFreshOwnerPendingDelta` — visible `+1–0`, title/aria `Live this week: 1–0`, `data-overview-live-pending`; gated by the rendered `row.owner`. Never mutates/projects rank/record/win%/differential and never re-sorts; canonical rows/history/coverage resolution (PLATFORM-047/048) untouched. Stale/missing/tied/NoClaim/absent deltas render nothing. The existing `{n} live` pill (a distinct signal) is unchanged; podium/hero cards get no badge this phase; no `router.refresh`. Codex review: clean, no findings. Deferred: **PLATFORM-052** (podium/hero live badge, candidate), `liveCountByOwner` staleness alignment (candidate), **PLATFORM-045** route-loader dedup. `npm test` 1069 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-049-STANDINGS-COVERAGE-CANONICAL-CONTRACT-v1

- Purpose: Make Standings rows, history, and coverage all come from the same canonical snapshot when supplied (Standings already preferred canonical rows/history but still rendered raw local `standingsCoverage`, which could pair canonical archive rows with a stale client warning).
- Scope: new pure `src/lib/selectors/standingsCanonicalInputs.ts` (`resolveStandingsCanonicalInputs` + `STANDINGS_COVERAGE_UNAVAILABLE`), `src/components/StandingsPanel.tsx` (resolve rows/history/coverage together; warning uses resolved coverage). Tests: `standingsCanonicalInputs.test.ts`, `StandingsPanel.test.tsx`.
- Notes: Standings coverage now canonical-preferred; local coverage only when NO canonical snapshot is supplied; missing/null canonical coverage → conservative `{ state: 'error', message: 'Standings coverage is unavailable.' }` (never local; `CanonicalStandings.coverage` stays required — defensive runtime handling). Deliberately **not** reusing `resolveOverviewCanonicalInputs` (surfaces stay decoupled; new module imports only types so no server/appState code enters the client bundle). Coverage affects only the top warning paragraph/error styling — never row selection, sorting, movement/history, NoClaim, or liveDelta badges; canonical rows never mutated. No `CFBScheduleApp` wiring change (already supplies canonical + local coverage). Codex review: clean, no findings. Deferred: **PLATFORM-045** (route-loader dedup); candidate Overview liveDelta overlay. `npm test` 1060 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-046-MEMBER-HEADER-LIVE-OVERLAY-v1

- Purpose: Add a Standings-compatible `liveDelta` pending W–L badge to the Members owner header without changing the canonical header baseline (the follow-up deferred from PLATFORM-044).
- Scope: `src/lib/selectors/liveDelta.ts` (new pure `selectFreshOwnerPendingDelta`), `src/components/StandingsPanel.tsx` (use the helper — behavior-neutral), `src/components/OwnerPanel.tsx` (optional `liveDelta` prop + badge beside Record), `src/components/CFBScheduleApp.tsx` (pass `liveDelta`). Tests: `selectors-liveDelta`, `OwnerPanel`, `StandingsPanel`, `CFBScheduleApp`.
- Notes: `selectFreshOwnerPendingDelta(liveDelta, owner)` centralizes stale suppression, owner lookup, NoClaim exclusion, and the nonzero-decision check (returns the fresh pending delta or null); Standings now uses it (markup/copy unchanged) and Members reuses it. The Members badge renders beside the header Record (`+1–0`, title `Live this week: 1–0`), gated by `snapshot.header?.owner` — a null header is never resurrected by liveDelta; canonical rank/record/win%/differential are untouched; no projected standings; no `router.refresh`. Fresh nonzero → badge; stale/missing/zero-decision → none; NoClaim never annotated. Codex review: clean, no findings. Deferred follow-ups: **PLATFORM-045** (route-loader dedup), and candidates — Overview liveDelta overlay, Standings-surface canonical coverage. `npm test` 1050 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-048-OVERVIEW-COVERAGE-CANONICAL-CONTRACT-v1

- Purpose: Make Overview coverage canonical-preferred whenever a canonical standings snapshot is supplied (closing the remaining gap PLATFORM-047 characterized: rows/history were canonical but coverage stayed local).
- Scope: `src/lib/selectors/overview.ts` (`resolveOverviewCanonicalInputs` now resolves coverage + exports `CANONICAL_COVERAGE_UNAVAILABLE`), `src/components/OverviewPanel.tsx` (resolved coverage → selector + visible warning), `src/components/CFBScheduleApp.tsx` (resolve once, feed `deriveOverviewSnapshot`). Tests: `overview-canonical-contract.test.ts`, `selectors-leagueStandings.test.ts`.
- Notes: Overview coverage now comes from canonical when a snapshot is supplied; client-derived coverage is used only when NO snapshot is supplied. A supplied snapshot with missing/null coverage returns the conservative `{ state: 'error', message: 'Standings coverage is unavailable.' }` (never local) — `CanonicalStandings.coverage` stays required at the type level (defensive runtime handling only). `CFBScheduleApp` resolves rows/history/coverage once and feeds resolved coverage to `deriveOverviewSnapshot` (no canonical input of its own); `OverviewPanel` resolves identically for its selector and the visible coverage warning, so all consumers share the same resolved coverage. rows/history semantics + NoClaim exclusion from PLATFORM-047 preserved; liveDelta still not merged; no Overview UI rewrite; no canonical generation change (builders already populate coverage — now pinned). Codex review: clean, no findings. Deferred follow-ups unchanged: **PLATFORM-046** (Members header liveDelta overlay), **PLATFORM-045** (route-loader dedup), Overview liveDelta overlay, and (candidate) Standings-surface canonical coverage. `npm test` 1035 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-047-OVERVIEW-CANONICAL-CONTRACT-CHARACTERIZATION-v1

- Purpose: Test-first characterization of the Overview canonical-vs-local source boundary before any behavioral migration. No behavior change.
- Scope: `src/lib/selectors/overview.ts` (new pure `resolveOverviewCanonicalInputs` extracted verbatim from the inline OverviewPanel resolution), `src/components/OverviewPanel.tsx` (call the helper — byte-identical behavior). Tests: new `overview-canonical-contract.test.ts`.
- Notes: Pinned Overview contract — **rows**: canonical when a snapshot is supplied (empty stays empty; omitting an owner does not resurrect local), local only when no snapshot; **history**: canonical when supplied (null stays null), local only when no snapshot; **coverage**: always client/schedule-derived — canonical coverage is NOT consumed by the resolution (returns only rows/history); **liveDelta**: not an input, not merged into Overview rows this phase; **NoClaim**: excluded from canonical rows (held in `noClaimRow`). Behavior-neutral extraction (existing OverviewPanel tests unchanged/green). Characterization surfaced the real remaining gap: **coverage is still client-derived while canonical is authoritative** → next implementation prompt **PLATFORM-048-OVERVIEW-COVERAGE-CANONICAL-CONTRACT-v1** (consciously decide/flip coverage to canonical with tests). No Overview rewrite, no UI/coverage/liveDelta/Insights/matchup/ownership/CSV changes. Codex review: clean, no findings. `npm test` 1032 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-044-CANONICAL-MEMBER-RECORDS-v1

- Purpose: Make the Members view owner header (rank/record/win%/point differential) use canonical standings rows instead of locally derived standings, so Members agrees with the Standings surface.
- Scope: `src/lib/ownerView.ts` (`deriveOwnerViewSnapshot` takes optional `canonicalStandingsRows`; header sourced from it), `src/components/CFBScheduleApp.tsx` (pass `canonicalStandings?.rows`). Tests: `ownerView.test.ts`.
- Notes: Members owner header now prefers canonical standings. **Canonical is authoritative when supplied** (per review decision): when a canonical snapshot is passed — even empty or omitting the owner — the header is the canonical row or `null`, never the local row, so Members never resurrects an owner/standings canonical excludes. Local rows are used for the header only when NO canonical snapshot is supplied (`undefined`, e.g. Trends/History routes). Owner options, selection, roster rows, and weekly game details remain schedule/client-derived (PLATFORM-039 ownership resolution intact); NoClaim stays excluded. Codex P1 (do not fall back to local when canonical omits/empties an owner) was **adopted**, overriding the initial prompt's "empty → local" fallback wording. A second Codex P1 (canonical header not refreshed after client score hydration → stale/cold records) was **reviewed and deferred**: the residual staleness is a pre-existing, app-wide property of the static canonical prop that Standings' base record shares (canonical refreshes only on mutations via `router.refresh`, never on score hydration; live in-progress state is the separate `liveDelta` overlay). Members' canonical _base_ record now agrees with Standings' base record (the goal). Codex's suggested `router.refresh`-after-hydration fix was **declined** as the wrong mechanism (contradicts the liveDelta-overlay redesign, app-wide, refetch-churn risk). Applying the `liveDelta` pending overlay to the Members owner header (to match Standings during live play) is a UI-additive follow-up → **PLATFORM-046-MEMBER-HEADER-LIVE-OVERLAY-v1**. No changes to canonical standings generation, schedule canonicalization, attachment, season resolution (PLATFORM-042), schedule-route inputs (PLATFORM-043), FBS/FCS (PLATFORM-036), CSV/bootstrap, Overview/Insights/matchup consumption, or UI. Next reviewed item: Overview canonical contract characterization. `npm test` 1023 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-043-SCHEDULE-ROUTE-CANONICAL-INPUTS-v1

- Purpose: Make `/league/[slug]/schedule` provide the same canonical standings, league status, and archive context as the root league route, so entering directly through Schedule is a route-specific entry into the same canonical app state (WeekViewTabs can switch locally to Standings/Overview/Matchups/Members) rather than a lighter fallback-only entry.
- Scope: `src/app/league/[slug]/schedule/page.tsx` (load `getCanonicalStandings` + `listSeasonArchives` + derive `leagueStatus`/`mostRecentArchivedYear`, mirroring the root route). Test: new `src/app/league/[slug]/schedule/__tests__/page.test.tsx`.
- Notes: `/league/[slug]/schedule` now receives the same canonical standings/status/archive inputs as the root league route. Component fallbacks remain intentionally in place (empty/unavailable leagues still receive a canonical snapshot the fallback branches handle). Narrow change: no `WeekViewTabs`/UI behavior change, no `CFBScheduleApp` rewrite, no changes to canonical standings generation, schedule canonicalization, attachment, season resolution (PLATFORM-042), ownership (PLATFORM-039), FBS/FCS (PLATFORM-036), or CSV/bootstrap. Codex review: clean, no findings. The root/standings/schedule routes now share the same canonical-loader block — an optional dedup (`PLATFORM-045-LEAGUE-ROUTE-CANONICAL-LOADER-DEDUP-v1`) is deferred. Next reviewed item: Members canonical records. `npm test` 1016 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-042-LEAGUE-SEASON-RESOLUTION-v1

- Purpose: Make `CFBScheduleApp` schedule/scores/aliases/rankings/insights/storage use the league-resolved season instead of falling back to global `DEFAULT_SEASON` for active-season and offseason leagues.
- Scope: new pure `src/lib/leagueSeason.ts` (`resolveLeagueSeason`); `src/components/CFBScheduleApp.tsx` (seed `selectedSeason` via the resolver; collapse the duplicate `draftLookupYear`). Tests: new `leagueSeason.test.ts` + a `CFBScheduleApp` active-season regression.
- Notes: Client schedule/scores/aliases/rankings/insights/storage now use the league-resolved season. `resolveLeagueSeason` precedence: `leagueStatus.year` (preseason/season) → `leagueYear` → `defaultSeason`; active-season and offseason leagues no longer silently use `DEFAULT_SEASON` when league-specific year info exists. `selectedSeason` is the single feed for all season-sensitive client ops, so the one-line initializer change fixes them all; `draftLookupYear` now reuses `selectedSeason` (provably identical across states). No explicit per-instance year override exists (env `NEXT_PUBLIC_SEASON` is baked into `DEFAULT_SEASON`). No changes to canonical standings, schedule canonicalization, attachment, ownership (PLATFORM-039), FBS/FCS (PLATFORM-036), CSV/bootstrap, auth, or UI. Codex review: clean, no findings. Schedule route canonical inputs remain next as **PLATFORM-043-SCHEDULE-ROUTE-CANONICAL-INPUTS-v1**. `npm test` 1013 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-039-CANONICAL-GAME-OWNERSHIP-LOOKUP-v1

- Purpose: Make current-season ownership resolution use centralized, resolver-free game-identity candidates instead of raw provider-name equality (`rosterByTeam.get(game.csvHome/csvAway)`, `game.csvAway === teamName`), so stored/canonical assignments still match when provider labels differ (e.g. "Wash St" vs "Washington State").
- Scope: new `src/lib/gameOwnership.ts` (`sideIdentityCandidates`, `getOwnerForGameSide`, `getGameOwners`, `getGameSideForTeam`); adopted in `gameTags.ts` (behavior-neutral extraction), `standings.ts`, `selectors/liveDelta.ts`, `matchups.ts`, `selectors/gameWeek.ts`, `ownerView.ts`, and `OverviewPanel.tsx` (`liveCountByOwner`). Tests: new `gameOwnership.test.ts` + `ownerView.test.ts`; mismatch regressions in standings/liveDelta/matchups/gameWeek.
- Notes: Current-season ownership lookup now uses centralized resolver-free game ownership candidates (participant teamId → canonical/display/raw → `canHome/away` → `csvHome/away` legacy fallback; exact-match). This does **not** preserve or expand CSV-upload architecture. Provider-facing display labels (`csvHome/csvAway`) preserved. Codex P2 addressed: `OverviewPanel.liveCountByOwner` also routed through the shared helper. Codex P1 (roster labels that are themselves non-canonical aliases, e.g. stored `"wash st"`, still miss under exact-match) is a **pre-existing** limitation and an **intentional deferral** — resolving it needs normalized ownership keys or resolver/roster canonicalization, both explicitly out of scope here → **PLATFORM-040-OWNERSHIP-KEY-NORMALIZATION-v1**. Normalized ownership-key indexes, historical/archive ownership cleanup (`insights/*`, `historySelectors`, `leagueRecords`), historical CSV-upload / league-history behavior, alias-scope precedence consolidation, and canonical standings/overview/matchup migration all remain deferred. `npm test` 1005 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-036-FBS-FCS-MATCHUP-SELECTOR-CLASSIFICATION-v1

- Purpose: Fix matchup selector/display so FCS opponents are identified through canonical conference subdivision policy instead of local `/\bfcs\b/i` conference-name regexes that only fired when a label literally contained "FCS" (missing Big Sky, MVFC, Patriot, SWAC, CAA, Ivy, SoCon, Southland, …).
- Scope: `src/lib/conferenceSubdivision.ts` (new pure `isPolicyFcsConference`), `src/lib/matchups.ts` / `src/lib/selectors/matchups.ts` / `src/lib/selectors/gameWeek.ts` (drop local regex helpers, use the shared helper in `deriveWeekMatchupSections` / `deriveOpponentDescriptor` / `deriveGameWeekPanelViewModel`). Tests: `conferenceSubdivision.test.ts`, `selectors-matchups.test.ts`, `selectors-gameWeek.test.ts`, `MatchupsWeekPanel.test.tsx` (synthetic `"FCS"` fixtures → real `"MVFC"`).
- Notes: Matchup selector/display FCS classification now uses shared conference subdivision policy (`isPolicyFcsConference`, backed by `resolvePresentDayConferencePolicy`) instead of local regexes; the helper is pure and does not consult the mutable CFBD conference index. Real FCS opponents render `FCS` (not `NoClaim (FBS)`), FCS participants cannot create owner matchups, unowned FBS opponents still render `NoClaim (FBS)`, and unknown/empty/OTHER stay non-FCS (only recognized FCS policy conferences flip). FBS×FCS inclusion and FCS×FCS exclusion remain upstream in schedule eligibility (unchanged). Direct `rosterByTeam.get(game.csvHome/csvAway)` ownership lookup intentionally left untouched — canonical ownership/alias cleanup remains deferred to **PLATFORM-039-CANONICAL-GAME-OWNERSHIP-LOOKUP-v1** (next likely task). Codex P2 addressed: MVFC's policy aliases lacked CFBD's `Missouri Valley` provider spelling (the form repo fixtures use), so those games still misclassified — added `missourivalley` to the static policy with a regression. `npm test` 992 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-035-DRAFT-BOARD-CANONICAL-ALIAS-LOADING-v1

- Purpose: Fix the server-rendered spectator draft board so schedule-derived draft insights populate, by replacing the browser-era alias loader (`src/lib/aliases.ts` `loadAliasMap`, which reads `localStorage` / fetches a relative `/data/team-aliases.json` and fails silently on the server) with a server-safe scoped alias source.
- Scope: `src/lib/server/globalAliasStore.ts` (new exported `getScopedAliasMap(slug, year)`), `src/app/league/[slug]/draft/board/boardData.ts` (new `loadSpectatorBoardSchedule` extraction), `src/app/league/[slug]/draft/board/page.tsx` (route through the helper; drop the `aliases.ts` import), `src/app/league/[slug]/draft/board/__tests__/boardData.test.ts` (new regression).
- Notes: Spectator draft board alias loading now uses server-safe appState sources. `getScopedAliasMap` walks `aliases:global` + deprecated `aliases:{slug}:{year}` / `aliases:{year}` scopes with precedence **global > league+year > year** (global is the canonical store; legacy scopes are deprecated and migration preserves global entries — matches the owners upload merge). Codex P2 addressed: initial draft copied the legacy insights-path ordering (global lowest) which let a stale scoped mapping override the corrected global one; fixed to global-highest with a dedicated precedence regression. Broader alias scope/cache **precedence consolidation remains deferred** (the four duplicate scope-walk loaders in `insights/context.ts`, `leagueStandings.ts`, and the two `archive-*` debug routes are untouched, as is global precedence policy elsewhere). `src/lib/aliases.ts` is now unused but left in place — dead-helper retirement is a separate deferred item. No changes to draft eligibility/lifecycle, odds, scores, schedule canonicalization, standings, or appState infra. Next likely task: **PLATFORM-036-FBS-FCS-MATCHUP-SELECTOR-CLASSIFICATION-v1**. `npm test` 986 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1

- Purpose: Make production odds attachment event-centric and date-aware so upstream odds events attach to the correct canonical schedule game via team identity + commence time, with no same-pair fan-out and no arbitrary duplicate first-win. Implements the behavior the PLATFORM-030 `test.skip` contracts described.
- Scope: `src/lib/oddsAttachment.ts` (rewrite), `src/lib/gameAttachment.ts` (`ScheduleAttachmentGame.date`), `src/app/api/odds/routeInternals.ts` (moved + extended `normalizeUpstreamOddsEvent`/`NormalizedOddsEvent`/`UpstreamOddsEvent`, `SharedOddsCacheEntry.data` now `NormalizedOddsEvent[]`), `src/app/api/odds/route.ts` (carry `commenceTime` through prepared events), `src/lib/odds.ts` (legacy `buildOddsByGame` carries `commenceTime`). Tests: `oddsAttachment.test.ts` (un-skip 3 contracts + diagnostics), new `odds/__tests__/odds-normalization.test.ts`.
- Notes: Commit `(this PR)`. Algorithm: iterate events → resolve pair via `teamIdentity` `buildPairKey` → candidate canonical games from `buildSchedulePairIndex` → if `commenceTime` present and any candidate dated, narrow to ±24h window → attach only when exactly one candidate remains; skip on zero/multiple. One-to-one safety via a consumed-game set (a claimed game is never overwritten). Lightweight diagnostics sink (optional `diagnostics` param) with reason codes `unmatched_pair` / `ambiguous_pair` / `date_mismatch` / `consumed_or_duplicate`; no admin UI added. `normalizeUpstreamOddsEvent` had to move out of `route.ts` into `routeInternals.ts` because Next.js forbids non-handler exports from a route module. Behavior change: an undated event whose pair has multiple canonical games no longer fans out — it is skipped as ambiguous (single-candidate undated events still attach). PLATFORM-020 odds quota/cache guards untouched; score attachment, schedule canonicalization, teamIdentity unchanged. tsc/lint:all/build green; `npm test` 981 (981 pass, 0 skip, +6 vs 975; the 3 PLATFORM-030 contracts now run green).

### PLATFORM-030-ATTACHMENT-REGRESSION-TESTS-v1

- Purpose: Add regression coverage for schedule-based score/odds attachment and schedule eligibility BEFORE changing odds matching behavior (PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1). Score attachment is strong; odds attachment is still pair-only and can misattach same-pair games (rematches, bowls, CFP repeats, duplicate provider events).
- Scope: Test-only. `src/lib/__tests__/{oddsAttachment,scoreAttachment,schedule-eligibility}.test.ts`. No production changes; no testability exports needed.
- Notes: Commit `(this PR)`. Odds: passing tests document current schedule-canonical safety (unmatched events create no entries; only canonical games attach) AND current UNSAFE pair-only behavior (one event fans out to both same-pair games; duplicate provider events first-win). Intended invariants that fail today are `test.skip` with explicit "requires PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1 (event-centric/date-aware odds attachment)" comments — `OddsAttachmentEventBase` has no commence_time, so date disambiguation is unattainable until PLATFORM-031 extends the event shape. Score: resolved-but-unscheduled rows cannot create scores (`no_scheduled_match`); postseason providerWeek reset attaches to canonical postseason week; neutral-site reversed orientation attaches via identity-aware pair matching; regular vs postseason meetings of the same teams stay on distinct games. Eligibility: unit coverage of `getRegularSeasonEligibilityDecision`/`isOfficePoolEligibleTeamMatchup`/`classifyTeamSubdivision`/`isFbsTeam` — FBS×FBS and FBS×FCS included, FCS×FCS excluded, unknown/FBS fallback documented, classification driven by metadata/conference not team-name strings ("Georgia Southern" stays FBS). tsc/lint:all/build green; `npm test` 975 total — 972 pass, 3 skip (PLATFORM-031), 0 fail (+19 vs 956). Lineage: originally drafted as PLATFORM-001A, briefly relabeled ODDS-001/002; renamed to the required `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` form using the approved `PLATFORM` campaign prefix.

### PLATFORM-020-ADMIN-DEBUG-API-GATES-v1

- Purpose: Require admin authorization on `/api/admin/*` and `/api/debug/*` GET routes that expose diagnostics / storage / API-usage state or can trigger quota-bearing internal fetches. Middleware protected `/admin` pages but several API routes had no `requireAdminAuth(req)`.
- Scope: 11 routes gated (auth as first statement, before any fetch/work): `admin/{usage,storage,odds-usage}`, `admin/win-totals` GET, and 7 debug routes (`conference-diagnostics`, `resolve-team`, `schedule`, `schedule-eligibility`, `scores`, `scores-attachment`, `postseason-score-attachment`). Admin-only client callers updated to send the admin token (`lib/apiUsage.ts` both fns, `AdminStorageStatusPanel`, `lib/scoreAttachmentDebug.ts`). `CFBScheduleApp` odds-usage fetch gated behind `isAdmin`. New tests `src/app/api/__tests__/admin-debug-auth.test.ts`.
- Notes: Commit `(this PR)`. `admin/usage` makes a live CFBD call (`fetchCfbdUsage`) — the primary quota-exposure fix. `admin/odds-usage` was being fetched by the public app for ALL visitors (leaking the owner's API-usage numbers) though it only reads a stored snapshot; per owner direction it is now admin-only and the public app no longer calls it (the odds-refresh quota guard defaults to "allow" when the value is absent — same as the pre-load state, and non-admin odds calls are cache-served, so no functional change for regular users). Routes already correctly gated were left unchanged; their gate ordering was verified. Tests prove: every gated route returns 401 unauthenticated; an unauthenticated `schedule-eligibility` call fires zero internal fetches (global-fetch spy); authorized requests still return 200. tsc/lint:all/build green; `npm test` 945/945, 0 fail, 0 cancelled (+13).

### DRAFT-010-CONFIRM-ELIGIBILITY-v1

- Purpose: Fix draft confirmation so it uses the same eligible-team definition as draft setup and works with the current `src/data/teams.json` shape. Confirmation counted expected teams via `t.classification === 'fbs'`, but no `teams.json` item carries `classification`, so a complete, valid draft was rejected as "0 of 0 picks."
- Scope: `src/lib/draft.ts` (new shared helper), `src/app/api/draft/[slug]/[year]/{confirm,route,pick/route,pick/[n]/route}.ts`, new tests `src/lib/__tests__/draft.test.ts` + `src/app/api/draft/[slug]/[year]/__tests__/confirm-eligibility.test.ts` (+ `_setup/` revalidate-context harness). No draft UX, pick-ordering, dependency, or odds/schedule/standings/appState-infra changes.
- Notes: Commit `(this PR)`. Added one source of truth in `draft.ts` — `getDraftEligibleTeams`/`isDraftEligibleTeam`/`NON_DRAFTABLE_SCHOOLS` defining eligibility as "exclude the `NoClaim` placeholder" (not a `classification` field). `confirm/route.ts` now derives `totalExpectedPicks`, recognized-team validation, and the undrafted-NoClaim remainder from the helper; `route.ts` (setup/update/auto-pick) and both pick routes route their eligibility checks through it too. Tests: helper-level (NoClaim excluded; current catalog yields non-zero eligible == all items, with explicit no-`classification`-key invariant) and route-level (complete draft confirms 200 — fails 422 pre-fix; 3-owner remainder writes correct NoClaim row count). Test-only `_setup/{installAsyncLocalStorage,revalidateContext}.ts` supplies a minimal Next `workAsyncStorage` store so `invalidateStandings`→`revalidateTag` runs under the bare `node:test` runner. tsc/lint:all/build green; `npm test` 916/916, 0 fail, 0 cancelled (911 baseline + 5).

### PLATFORM-003-TEST-APPSTATE-ISOLATION-v1

- Purpose: Remove the cross-process shared-appState flakes so the full Node test suite is deterministic (0 failures, 0 cancelled across repeated runs).
- Scope: `src/lib/server/appStateStore.ts` (test-only-gated path branch) + `package.json` test script. No production behavior change.
- Notes: Commit `(this PR)`. Root cause: the file fallback wrote to a single shared `data/app-state.json`, but `node:test` runs each test file in its own process — parallel appState-backed files (conferences, route-timer, schedule, scores, selectors-leagueStandings) raced on that one file, so the failing set varied per run. Fix: `appStateFilePath()` returns a pid-keyed temp path (`os.tmpdir()/cfb-app-app-state-test-<pid>.json`) when `APP_STATE_TEST_ISOLATION=1`, which the `test` script now sets; each test-file process gets its own store while intra-file `beforeEach` reset behavior is preserved. The flag is never set in dev/production, so the shared `data/app-state.json` path is unchanged there. No store logic bug found — purely a test-process isolation gap. Verified stable: 5 consecutive full `npm test` runs all 911/911, 0 fail, 0 cancelled; tsc/lint:all/build green. Completes the TEST-SUITE-BASELINE-CLEANUP arc.

### PLATFORM-004-TEST-TSC-FIXTURE-CLEANUP-v1

- Purpose: Restore a clean `npx tsc --noEmit`. PR #325's markup cleanup added `CanonicalStandings` test fixtures missing the `inferredSeasonStart` field, leaving 4 pre-existing TS2741 errors on main.
- Scope: Test fixtures only — `MatchupMatrixView.test.tsx`, `MatchupsWeekPanel.test.tsx`, `OwnerPanel.test.tsx`, `StandingsPanel.test.tsx`. No production changes.
- Notes: Commit `49132e5`. Added `inferredSeasonStart: null` to each fixture — `null` matches every source factory default in `leagueStandings.ts`, and these are render tests that don't exercise the `now > inferredSeasonStart` timing logic. `tsc --noEmit` 0 errors (was 4); `npm test` 910/911 (sole failure is the shared-appState flake → `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`, passes in isolation); lint:all + build green.

### PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1

- Purpose: Eliminate the 12 `CFBScheduleApp.test.tsx` failures caused by missing Next.js App Router and Clerk context (plus a JSX-runtime mismatch) under `renderToStaticMarkup`.
- Scope: Test/harness only — `src/components/__tests__/CFBScheduleApp.test.tsx`, new `src/components/__tests__/_setup/renderWithAppContext.tsx`, new `tsconfig.test.json`, and the `test` script in `package.json`. No production changes.
- Notes: Commit `(this PR)`. Three test-environment layers, none a product bug: (1) `useRouter()` threw "invariant expected app router to be mounted" — no App Router context; (2) `AppHeaderActions` calls `useClerk()`/`useUser()` — no Clerk context; (3) `AppHeaderActions` relies on the automatic JSX runtime (like production via Next SWC) but doesn't import React, while the tsx test loader used the classic runtime (`tsconfig.json` `jsx: "preserve"`), throwing "React is not defined". Fixes: `renderWithAppContext()` wraps elements in `AppRouterContext` + Clerk `ClerkInstanceContext`/`InitialStateProvider` stubs (loaded, signed-out); `tsconfig.test.json` (extends base, `jsx: "react-jsx"`) wired via `TSX_TSCONFIG_PATH` so the test transform matches production's automatic runtime (base tsconfig + Next build untouched); 9 stale markup assertions retargeted to current markup (Open Data Management, API Usage disclosure, Full standings, Team filter, `data-owner-pair-cell` matrix, Overview/Standings/Matchups/Members tabs). CFBScheduleApp 25/25; full suite 907/911, 0 cancelled (was 893/911, 18 fail). Remaining 4 are the cross-process shared-appState flakes (route-timer, selectors-leagueStandings, conferences/route — pass in isolation, victim set varies per run) → `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`.

### PLATFORM-001-TEST-BASELINE-CLEANUP-v1

- Purpose: Clean up the stale Node test baseline surfaced once `npm test` could terminate. Eliminate both cancelled (timed-out) test files, update stale component markup assertions, and fix architecture-adjacent lib tests whose expectations predated the postseason week-remapping guardrail.
- Scope: Test files only — `OverviewPanel.test.tsx`, `TrendsDetailSurface.test.tsx`, `MatchupsWeekPanel.test.tsx`, `MatchupMatrixView.test.tsx`, `StandingsPanel.test.tsx`, `RankingsPageContent.test.tsx`, `WeekViewTabs.test.tsx`, `GameWeekPanel.test.tsx`, `schedule-eligibility.test.ts`, `teamIdentity.test.ts`. No production changes.
- Notes: Commit `711a032`. The two cancellations were emergent: ~26 (OverviewPanel) / ~13 (TrendsDetailSurface) stale `assert.match` failures each carried the full ~14KB rendered HTML, and the accumulation choked the runner into a file-level timeout (TrendsDetailSurface's `selected focus mode` case also hit an async-teardown spin). Rewritten to query current markup (aria-label legend, tab-gated charts, podium/insight cards, `data-owner-card`/`data-owner-pair-cell`/`data-standings-column`) with semantic assertions over giant HTML regexes. teamIdentity/schedule-eligibility asserted raw provider weeks; production correctly remaps postseason weeks (`canonicalWeek = maxRegularSeasonWeek + providerWeek`) — confirmed stale tests, not product bugs. Full suite after: 0 cancelled, ~895/911 pass (was 818/854, 34 fail + 2 cancelled). Remaining failures are out of scope: CFBScheduleApp (12, needs useRouter/Clerk test context → `PLATFORM-002-TEST-ROUTER-CLERK-CONTEXT-v1`) and cross-process shared-appState flakes in route-timer / selectors-leagueStandings (both pass in isolation → `PLATFORM-003-TEST-APPSTATE-ISOLATION-v1`). **ID note:** the `PLATFORM-001` number predates this and is also used by `PLATFORM-001-ROLLOVER-UI-v1` (distinct short-name); future PLATFORM prompts should continue from `PLATFORM-002`.

### TEST-SUITE-HANG-BASELINE-FIX

- Purpose: Diagnose and fix the pre-existing `npm test` hang on `main` — the suite ran forever with no signal.
- Scope: `package.json` test script only. No production or test-file changes.
- Notes: Commit `dcdadd4` (PR #324). Root cause: `node:test` has no default per-test timeout, so a single runaway test blocks the whole suite indefinitely. Two stale-expectation files contained runaways — TrendsDetailSurface (async-recursion microtask loop; CPU-bound, confirmed via `sample`) and OverviewPanel (synchronous loop emergent across its sequence). Fix: add `--test-timeout=30000` so any runaway is bounded and the suite always terminates with usable results. Prerequisite to `PLATFORM-001-TEST-BASELINE-CLEANUP-v1`, which eliminates the runaways themselves.

### HISTORY-RECORDS-PHASE-2-CAMPAIGN-CLOSEOUT

- Purpose: Documentation closeout for the HISTORY-RECORDS Phase 2 campaign. Logs the rich-template entry in `docs/completed-work.md`, registers all formal Phase 2 PROMPT_IDs in `docs/prompt-registry.md`. No code changes.
- Scope: `docs/completed-work.md`, `docs/prompt-registry.md`. No source code changes.
- Notes: Documentation only. Captures architectural improvements (multi-line row pattern in DESIGN.md, container-query column degradation, scoped-suite + visual-reference conventions in AGENTS.md) and Phase 3 follow-ups (`RECORDS-SCORING-v1`, `SPARSE-DATA-LAYOUT-v1`, `HISTORY-DYNAMIC-TILING-v1`, `INSIGHT-ROUTING-PHASE-3-RETARGET-v1`). Test count grew 87 → 128 across the campaign.

### P7-HISTORY-RECORDS-PHASE-2-STANDINGS-TREND-COLUMN-v1

- Purpose: Add a "Recent Finish" trend chip column to the All-Time Standings table — last 5 seasons of finishes rendered as gold/silver/bronze podium-tier outlines plus default/bottom tiers. Container queries drop oldest-year cells first as the @container narrows.
- Scope: `src/components/history/overview/AllTimeStandingsSummary.tsx`, `src/lib/selectors/historyOverview.ts` (`selectStandingsWithRecentFinishes` + `RecentFinish` types), `src/app/league/[slug]/history/page.tsx`, `mockups/standings-trend.html`, tests.
- Notes: Commit `a4896ba`. Two-row thead when the trend window is non-empty. `TREND_HIDE_BY_POSITION_FROM_NEWEST` static array maps position to `@max-[560/640/720/800/880px]:hidden` (Tailwind JIT requires literal class strings; cannot be built dynamically). Group header hides at 560px matching the last cell. NoClaim filtered per archive before rank derivation. `FinishChip` renders em-dash for `rank === null` (dense-with-nulls array).

### P7-HISTORY-RECORDS-PHASE-2-LAYOUT-REMEDIATION-v1

- Purpose: Resolve standings-table truncation and page-width imbalance found by the layout diagnostic. Drop fixed colgroup widths and `text-ellipsis overflow-hidden whitespace-nowrap` rules; switch to `table-auto` + content-sized cells; remove `w-full` so the table sizes to its content; widen numeric-cell padding to `pl-5` for column separation; reintroduce `mx-auto max-w-7xl` page wrapper after the uncapped exploration scattered desktop content; balance row 3 column heights by dropping marquee record count 5 → 4 and compressing Records to 2-line block treatment.
- Scope: `src/components/history/overview/AllTimeStandingsSummary.tsx`, `src/components/history/overview/RecordsColumn.tsx`, `src/lib/selectors/historyOverview.ts` (`MARQUEE_RECORD_COUNT`), `src/app/league/[slug]/history/page.tsx`, tests.
- Notes: Commits `dc37763`, `904a8f8`, `704c4fa`, `fe99ec3`, `3e1a977`, `93e63fd`. Iterative — multiple visual-review cycles within the prompt's scope. Final standings markup: `<table className="border-collapse">` (no `w-full`, no `table-fixed`); `NUM_CELL = 'pb-2 tabular-nums pl-5 text-right'`. Records column: line 1 = `EYEBROW · Title` (eyebrow keeps category color); line 2 = holders · value.

### P7-HISTORY-RECORDS-PHASE-2-LAYOUT-DIAGNOSTIC-v1

- Purpose: Read-only diagnostic — measure actual rendered widths of standings columns, row 2 / row 3 grids, and inner container widths at the 1280px viewport to inform the layout remediation prompt.
- Scope: Read-only. No code changes.
- Notes: Established that the standings @container width is ~896px at the 1280px viewport with the `1fr / 280px` row 2 grid — earlier trend-column thresholds had been calibrated against viewport width by mistake and needed to be redrawn against actual container widths. Output informed `P7-HISTORY-RECORDS-PHASE-2-LAYOUT-REMEDIATION-v1` and `P7-HISTORY-RECORDS-PHASE-2-STANDINGS-TREND-COLUMN-v1`.

### P7-HISTORY-RECORDS-PHASE-2-VISUAL-REFINEMENT-v1

- Purpose: Tighten typography, color, and spacing in the new Overview block treatments — drop the amber color on "(won title)" annotations (line 2 inherits the dim treatment), drop the `font-medium text-gray-700` override on Championships editorial tags, add `tabular-nums` to Championships line 2.
- Scope: `src/components/history/overview/MoversSection.tsx`, `src/components/history/overview/ChampionshipsSection.tsx`.
- Notes: Commit `147b2f5`. Multi-line row pattern semantics: line-2 metadata inherits the dim color via shared className — section-specific overrides were removed so the pattern reads consistently across rows.

### P7-HISTORY-RECORDS-PHASE-2-CLEANUP-NITS-v1

- Purpose: Drop the "X still chasing" clause from the Championships summary header (low-signal counter) and simplify `computeChampionshipSummary` by removing `stillChasingCount`.
- Scope: `src/components/history/overview/ChampionshipsSection.tsx`, `src/lib/selectors/historyOverview.ts`, tests.
- Notes: Commit `60df930`. The counter was redundant with the "championless owners" context already implicit in the All-Time Standings table.

### P7-HISTORY-RECORDS-PHASE-2-VISUAL-REMEDIATION-AND-CLOSEOUT-v1

- Purpose: Visual-review pass after `PATH-B-AND-RESPONSIVE-v1` — adjust typography, spacing, and chip-tier colors to match the Path C mockup. Gold = yellow-500/yellow-600 light + amber-300 dark, font-semibold; silver = slate-500/slate-600 + slate-300/slate-200 dark; bronze = orange-900 light + arbitrary `#d4915c` dark; default = `black/10` border + dim text; bottom = transparent border + faint text. Writes the mid-campaign closeout summary.
- Scope: `src/components/history/overview/*.tsx`, `mockups/history-redesign-pathC.html`.
- Notes: Commit `49a6de2`. Reference mockup committed at `mockups/history-redesign-pathC.html` per the visual-reference convention later codified in AGENTS.md.

### P7-HISTORY-RECORDS-PHASE-2-PATH-B-AND-RESPONSIVE-v1

- Purpose: Implement the Path B Overview redesign — five-section composition (Championships, 2-row dashboard, Movers, Season archive). Build all overview components with multi-line row block treatment and container-query degradation.
- Scope: `src/components/history/overview/{AllTimeStandingsSummary,ChampionshipsSection,MoversSection,RecentPodiumsColumn,RecordsColumn,SeasonArchiveStrip,TitleStreaksTable,TopRivalriesList}.tsx` (new), `src/lib/selectors/historyOverview.ts` (12+ helpers including `selectChampionshipsWithContext`, `selectDroughtsWithContext`, `selectMoversWithContext`, `selectStreaksOrDroughts`, `selectMarqueeRecords`, `selectRecentPodiums`, `selectSeasonArchiveStrip`, `groupChampionsByOwner`, `computeChampionshipSummary`), `src/lib/selectors/historySelectors.ts` (`AllTimeStandingRow.totalPoints`, `StandingsRow.pointsFor`, `selectAllTimeHeadToHead.latestMeeting`), `src/app/league/[slug]/history/page.tsx`, tests.
- Notes: Commit `f4e093d`. Multi-line row pattern: line 1 = primary identifier + right-anchored value (14–15px, weight 500); line 2 = secondary metadata (12px, weight 400, dim color, 2px inter-line margin). Page wraps in `mx-auto max-w-7xl`; row 2 grid `lg:grid-cols-[1fr_280px]`; row 3 grid `lg:grid-cols-[1fr_1fr_280px]`. Selector composition pattern: `selectXWithContext` enrichment over base types.

### DESIGN-MD-MULTILINE-AND-DEGRADATION-v1

- Purpose: Document the multi-line row pattern, list row width discipline, and responsive column degradation as reusable design primitives in `DESIGN.md`. Reconcile the section-divider rule and the dense-table column-header rule. Align the Section Headers CTA arrow glyph with the implementation.
- Scope: `DESIGN.md`.
- Notes: Commits `083cca0`, `23a4ec6`. Pattern available for future tables under sidebar-narrow allocations. Tailwind JIT constraint documented: container-query syntax (`@container` + `@max-[Xpx]:hidden`) requires literal class strings — cannot be built dynamically.

### P7-HISTORY-RECORDS-PHASE-2-OVERVIEW-REVISION-FOLLOWUP-v1

- Purpose: Follow-up to `OVERVIEW-REVISION-v1` — exclude former owners from Title Droughts so the section doesn't list owners no longer in the league. Filter on `activeOwners` set passed from server.
- Scope: `src/lib/selectors/historyOverview.ts`, `src/app/league/[slug]/history/page.tsx`.
- Notes: Commits `b15b779`, `945b302`. `activeOwners` derives from `owners:{slug}:{year}` CSV. Codex-review remediation (`c0a2ca0`) later added an archive-union fallback for empty-CSV states (pre-upload, post-reset, storage-miss).

### P7-HISTORY-RECORDS-PHASE-2-OVERVIEW-REVISION-v1

- Purpose: First Overview redesign cut — replace the single-stat hero with whole-league-arc storytelling. Subtab routing infrastructure (`HistorySubNav`, `RecordBadge`) + Stats/Rivalries/Archive Phase 3 placeholder routes; Overview five-section scaffold; `resolveHistoryHref` extended with rivalry types.
- Scope: `src/components/history/{HistorySubNav,RecordBadge}.tsx` (new), `src/app/league/[slug]/history/page.tsx`, `src/app/league/[slug]/history/{stats,rivalries,archive}/page.tsx` (new), `src/components/OverviewPanel.tsx` (`resolveHistoryHref`), tests.
- Notes: Commits `164b79f`, `8534f15`, `f5f73aa`, `bcb64df`. Pre-revision Overview rendered as a single-stat hero with no drill-down. Subtab routes initially scaffolded as Phase 3 placeholders; `resolveHistoryHref` rivalry/drought/dynasty targets reverted to Overview anchors during codex-review fixes because the placeholders weren't user-ready (`INSIGHT-ROUTING-PHASE-3-RETARGET-v1` filed for re-pointing once Phase 3 ships content).

### SEASON-LAUNCH-HARDENING-CAMPAIGN-CLOSEOUT

- Purpose: Documentation closeout for the Season Launch Hardening campaign (Phases 1–3, all merged). Updates completed-work, AGENTS.md, prompt-registry, next-tasks. Creates campaign retrospective at `docs/campaigns/season-launch-hardening.md`. No code changes.
- Scope: `docs/completed-work.md`, `AGENTS.md`, `docs/prompt-registry.md`, `docs/next-tasks.md`, `docs/campaigns/season-launch-hardening.md` (new). No source code changes.
- Notes: Documentation only. Captures new architectural invariants: canAccessDraftBoard auth pattern, phase-aware polling cadence, time-dependent classification out of cached selectors, insights engine suppression layering + bypassSuppression semantics + usingArchivedRoster framing.

### SEASON-LAUNCH-HARDENING-PHASE-3-CODEX-REMEDIATION

- Purpose: Fix `shouldSuppressGenerator` to honor `bypassSuppression` — the new engine filter was unconditional, blocking admin diagnostic runs that expected unfiltered output.
- Scope: `src/lib/insights/engine.ts`, `src/lib/__tests__/insights-lifecycle-awareness.test.ts`.
- Notes: Commit `6358c2c`. Changed `.filter((g) => !shouldSuppressGenerator(g, context))` to `.filter((g) => bypassSuppression || !shouldSuppressGenerator(g, context))`. Bypass test added with save/restore of global generator registry.

### SEASON-LAUNCH-HARDENING-PHASE-3-INSIGHTS-LIFECYCLE-AWARENESS

- Purpose: Make the insights engine aware of preseason/archived-roster context — suppress, reframe, or add zero-game guards across all 11 generator surfaces. Add 22 new lifecycle-awareness tests.
- Scope: `src/lib/insights/engine.ts`, `src/lib/insights/framing.ts` (new), `src/lib/insights/generators/career.ts`, `src/lib/insights/generators/stats.ts`, `src/lib/insights/generators/existing.ts`, `src/lib/selectors/insights.ts`, `src/lib/__tests__/insights-lifecycle-awareness.test.ts` (new).
- Notes: Commit `385a071`. Engine: `shouldSuppressGenerator` cross-cutting filter (`career:rookie_benchmark` suppressed when `usingArchivedRoster`). Framing: `applyLastSeasonFraming` (7 surfaces, "Last season's" prefix), `applyReturningOwnerFraming` (4 surfaces, "Returning owner" narrative). `rookieBenchmarkGenerator` early-returns when `usingArchivedRoster`. Zero-game guards on `deriveLeagueInsights`, `deriveTightRaceInsight`, `deriveTightClusterInsight`. 22 tests covering framing helpers, per-generator on/off, lifecycle assertions, engine bypass.

### SEASON-LAUNCH-HARDENING-PHASE-2-CODEX-REMEDIATION

- Purpose: Move the kickoff-past `Date.now()` check out of the `unstable_cache`-wrapped selector and into consumers — the selector must return a time-invariant fact, not a time-dependent classification.
- Scope: `src/lib/selectors/leagueStandings.ts`, `src/components/StandingsPanel.tsx`, `src/components/CFBScheduleApp.tsx`, `src/lib/__tests__/selectors-leagueStandings.test.ts`.
- Notes: Commit `43516b0`. Selector always returns `preseason-awaiting-kickoff` when probe data exists; never embeds `Date.now()`. StandingsPanel and CFBScheduleApp evaluate `new Date(inferredSeasonStart).getTime() > Date.now()` at render time. Test `p2-season-kickoff-past` updated to assert `source: 'preseason-awaiting-kickoff'` (selector returns the fact; consumer decides what it means).

### SEASON-LAUNCH-HARDENING-PHASE-2-STANDINGS-PRESEASON-STATE

- Purpose: Build the `preseason-awaiting-kickoff` canonical standings source — selector consults `getScheduleProbeState` for a kickoff date, StandingsPanel renders a date-aware placeholder, CFBScheduleApp.isPreseason broadened to cover the awaiting-kickoff case.
- Scope: `src/lib/selectors/leagueStandings.ts`, `src/components/StandingsPanel.tsx`, `src/components/CFBScheduleApp.tsx`, `src/lib/__tests__/selectors-leagueStandings.test.ts`.
- Notes: Commit `88af434`. `CanonicalStandingsSource` extended with `'preseason-awaiting-kickoff'`. `inferredSeasonStart: string | null` added to `CanonicalStandings`. `resolveSeason` and `resolvePreseason` empty paths call `getScheduleProbeState(year).firstGameDate`. 5 new Phase 2 tests. No `Date.now()` in selector (time check moved to consumers in Phase 2 Codex remediation).

### SEASON-LAUNCH-HARDENING-PHASE-1-CODEX-REMEDIATION

- Purpose: Fix two Codex findings from Phase 1: (1) `/draft/summary` blocked spectators with an unintended redirect; (2) draft polling stopped on complete rather than slowing, missing re-open events.
- Scope: `src/app/league/[slug]/draft/summary/page.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`.
- Notes: Commit `d24a2f3`. Summary page: removed `if (!isAdmin) redirect(...)` — kept `isAdmin` computation for prop-passing only. Polling: changed complete-phase early `return` (interval cleared) to 30s interval so clients keep polling and detect re-open events.

### SEASON-LAUNCH-HARDENING-PHASE-1-DRAFT-AUTH-AND-POLLING

- Purpose: (A) Gate draft admin pages server-side via `canAccessDraftBoard`; remove inline `clerkRole` checks from three client components. (B) Add phase-aware polling to draft board clients.
- Scope: `src/lib/server/canAccessDraftBoard.ts` (new), `src/app/league/[slug]/draft/page.tsx`, `src/app/league/[slug]/draft/setup/page.tsx`, `src/app/league/[slug]/draft/summary/page.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/DraftSetupShell.tsx`, `src/components/draft/DraftSummaryClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`.
- Notes: Commit `5968604`. `canAccessDraftBoard` wraps `isPlatformAdminSession()`; Phase 7 stub (`void slug`). Draft/setup pages redirect non-admins to `/draft/board`. `isAdmin` passed as server-derived prop; `useUser()`/`clerkRole`/`isTokenAdmin` removed from all three client components. Polling IIFE: 1.5s (live+running), 30s (complete), 5s default.

### SEASON-LAUNCH-HARDENING-DISCOVERY

- Purpose: Read-only pre-launch audit covering four known or suspected blockers: draft auth leakage, draft polling excess, standings preseason blank state, insights lifecycle blindness.
- Scope: Read-only. `src/app/league/[slug]/draft/`, `src/components/draft/`, `src/lib/selectors/leagueStandings.ts`, `src/lib/insights/`.
- Notes: No code changes. Output: written audit report with severity ratings, root-cause analysis, and remediation plan for each item. Commit chain for implementation: `5968604`, `d24a2f3`, `88af434`, `43516b0`, `385a071`, `6358c2c`.

### STANDINGS-OWNERSHIP-CAMPAIGN-CLOSEOUT

- Purpose: Documentation closeout for the Standings Ownership Model Redesign campaign (Phases 0-5, all merged). Updates completed-work, AGENTS.md, prompt registry, roadmap, and next-tasks. Creates campaign retrospective at `docs/campaigns/standings-ownership.md`. No code changes.
- Scope: `docs/completed-work.md`, `AGENTS.md`, `docs/prompt-registry.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/campaigns/standings-ownership.md` (new). No source code changes.
- Notes: Documentation only. Captures architectural invariants (standings data ownership, mutation invalidation, cache wrapping, NoClaim filtering, lifecycle parameterization) and deferred backlog items (INSIGHTS-LIFECYCLE-AWARENESS, POSTSEASON-START-WEEK-SCHEDULE-DERIVED, INVALIDATE-STANDINGS-PER-LEAGUE, HEADER-ARCHITECTURE-UNIFICATION).

### STANDINGS-OWNERSHIP-PHASE-5-LIFECYCLE-v1

- Purpose: Phase 5 lifecycle hardening — parameterize `currentDate` in `deriveLifecycleState`, add `usingArchivedRoster` flag to `InsightContext`, document `POSTSEASON_START_WEEK` constant with Option B rationale.
- Scope: `src/lib/lifecycle.ts` (or equivalent), `src/lib/insights/types.ts`, `src/lib/insights/context.ts`, relevant request handlers. No UI changes.
- Notes: Shipped. `currentDate` captured once at request-handler entry, passed through all derivation layers. `usingArchivedRoster: boolean` added to `InsightContext` for `fresh_offseason` fallback gating. `POSTSEASON_START_WEEK = 16` documented with rationale comment; schedule-derived derivation deferred (Option B).

### STANDINGS-OWNERSHIP-PHASE-4-HISTORY-v1

- Purpose: Phase 4 History live-rebuild migration — replace `buildSeasonArchive(slug, activeYear)` with `getCanonicalStandings({ slug, year: activeYear })` on the History page.
- Scope: `src/app/league/[slug]/history/page.tsx` (or equivalent history route).
- Notes: Shipped. History page now uses canonical standings rather than rebuilding an archive in-place. Eliminates a parallel derivation path.

### STANDINGS-OWNERSHIP-PHASE-3-MEMBERS-MATCHUPS-v1

- Purpose: Phase 3 Members + Matchups route migrations. Migrate `OwnerPanel`, `MatchupsWeekPanel`, `MatchupMatrixView` to consume canonical standings. Add pulsing LIVE pill dot as second liveDelta UI integration. Add `router.refresh()` to 5 admin forms.
- Scope: `src/app/league/[slug]/members/page.tsx` (or equivalent), `src/app/league/[slug]/matchups/page.tsx` (or equivalent), `src/components/OwnerPanel.tsx`, `src/components/MatchupsWeekPanel.tsx`, `src/components/MatchupMatrixView.tsx`, 5 admin form components.
- Notes: Shipped. LIVE pill pulsing dot wired to `liveDelta`. Admin forms: alias editor, postseason override, season rollover, backfill, roster editor — all call `router.refresh()` after success.

### STANDINGS-OWNERSHIP-PHASE-2-STANDINGS-ROUTE-v1

- Purpose: Phase 2 Standings route + StandingsPanel migration. Server route loads canonical. `StandingsPanel` consumes canonical rows, history, colorOrder. First liveDelta UI: W-L pending badges. NoClaim filtering moved to source.
- Scope: `src/app/league/[slug]/standings/page.tsx`, `src/components/StandingsPanel.tsx`, `src/lib/standings.ts` (or `src/lib/selectors/leagueStandings.ts`).
- Notes: Shipped (PR #294 area). `deriveStandings` returns `{ rows, noClaimRow, ... }` with rows excluding NoClaim. `splitOutNoClaim` helper added. W-L pending badges appear next to owner names when a live game is in progress.

### STANDINGS-OWNERSHIP-PHASE-1-OVERVIEW-v1

- Purpose: Phase 1 Overview takeover collapse — remove merge-at-render-time logic from `CFBScheduleApp`'s Overview path. Introduce `liveDelta` interface + `selectLiveDelta` selector + `useLiveDelta` hook.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/lib/selectors/liveDelta.ts` (new), `src/hooks/useLiveDelta.ts` (new), `src/lib/selectors/types.ts`.
- Notes: Shipped. `LiveGameDelta`, `LivePendingOwnerDelta`, `LiveDelta` types defined. Canonical (server) owns rows/history/colorOrder; `liveDelta` (client) owns in-progress overlays. These travel as separate props to all consumers.

### STANDINGS-OWNERSHIP-PHASE-0-INVALIDATION-v1

- Purpose: Phase 0 invalidation infrastructure — wrap `getCanonicalStandings` with `unstable_cache` + `React.cache`, add `invalidateStandings` helper, wire into all mutation routes.
- Scope: `src/lib/selectors/leagueStandings.ts` (or equivalent), `src/lib/invalidateStandings.ts` (new or inline), all mutation routes under `src/app/api/`, `src/components/RosterUploadPanel.tsx`.
- Notes: Shipped. Tag granularity: `standings:{slug}` and `standings:{slug}:{year}`. Closure pattern bakes `slug+year` into `unstable_cache` key array. `RosterUploadPanel` calls `router.refresh()` after upload.

### STANDINGS-OWNERSHIP-MODEL-DISCOVERY-v1

- Purpose: Read-only scoping investigation — diagnose root cause of NoClaim-at-#1 and Overview inconsistency, evaluate merge-at-render-time vs canonical-server approaches, produce the 6-phase redesign plan.
- Scope: Read-only. Analyzed `CFBScheduleApp.tsx`, `StandingsPanel.tsx`, `OverviewPanel.tsx`, selectors, API routes. No code changes.
- Notes: Concluded that 8 remediation rounds on the Overview migration PR all addressed merge-at-render-time edge cases. Proposed architecture: server canonical for settled data, client `liveDelta` for live overlays, distinct props at consumer sites.

### STANDINGS-CANONICAL-SELECTOR-OVERVIEW-v1

- Purpose: Prompt 2 of original canonical selector campaign — migrate Overview path to consume canonical standings from server.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/components/OverviewPanel.tsx`, related selectors.
- Notes: Shipped (PR #294). Multiple remediation rounds exposed that merge-at-render-time was architecturally brittle; informed the subsequent STANDINGS-OWNERSHIP-MODEL-DISCOVERY replanning.

### STANDINGS-CANONICAL-SELECTOR-CORE-v1

- Purpose: Prompt 1 of original canonical selector campaign — build `getCanonicalStandings` as a server-callable selector returning stable standings rows, owner color order, and Games Back values.
- Scope: `src/lib/selectors/leagueStandings.ts` (new), related type definitions.
- Notes: Shipped (PR #291). Established the `CanonicalStandings` type and the `getCanonicalStandings` function. Foundation for all subsequent migration phases.

### STANDINGS-CANONICAL-SELECTOR-DISCOVERY-v1

- Purpose: Read-only investigation — map all current standings derivation paths, identify inconsistencies, scope the canonical selector work. Originally proposed a 4-prompt campaign (CORE, OVERVIEW, FANOUT, SERVER-INSIGHTS).
- Scope: Read-only. No code changes, no commits.
- Notes: Identified the merge-at-render-time pattern as the root cause of Overview surface disagreements. Proposed canonical selector as the fix; later expanded to full 6-phase redesign after Phase 2 remediation experience.

### DOCS-CLOSEOUT-006

- Purpose: Documentation closeout for the INSIGHTS-017 campaign. Logs all shipped prompts + STANDINGS-SUBHEADER-FIX, updates roadmap and next-tasks with completion status, registers every prompt in the registry, and adds eight new backlog items surfaced during this campaign.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-017-PANEL-UI, INSIGHTS-017-POLISH-DISCOVERY, INSIGHTS-017-POLISH-DISCOVERY-FOLLOWUP, INSIGHTS-017-PANEL-POLISH, INSIGHTS-017-POLISH-FOLLOWUP-DISCOVERY, INSIGHTS-017-PANEL-POLISH-FOLLOWUP, STANDINGS-SUBHEADER-DIAGNOSTIC, STANDINGS-SUBHEADER-FIX. Also logs Neon Postgres Free → Launch tier upgrade ($19/month) and adds eight new backlog items: INSIGHTS-017-PALETTE, HISTORY-REWORK, STANDINGS-PRESEASON-STATE, ALL-INSIGHTS-PAGE, APPSTATESTORE-CACHING, LINK-STYLING-AUDIT, STANDINGS-PAGE-LIFECYCLE-LABELING, INSIGHTS-RANKER-TUNING.

### STANDINGS-SUBHEADER-FIX

- Purpose: Wire `mostRecentArchivedYear` into the main league page so the offseason "{year} Final Standings" subheader branch fires when users reach the standings view via the WeekViewTabs click (the primary flow), not just via the dedicated `/standings` route.
- Scope: `src/app/league/[slug]/page.tsx` only.
- Notes: Commit `3890bad`. Single-file 9-line change. `listSeasonArchives(slug)` added to the existing `Promise.all`; `mostRecentArchivedYear` computed via `[...archiveYears].sort((a, b) => b - a)[0]` (matching the standings page); passed as prop to `CFBScheduleApp`. No changes to standings page, prop type, or subheader branch — those were already correct.

### STANDINGS-SUBHEADER-DIAGNOSTIC

- Purpose: Read-only investigation into why the offseason "{year} Final Standings" subheader branch added in INSIGHTS-017-PANEL-POLISH-FOLLOWUP was not firing on the standings page. Page rendered plain "Offseason" instead.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Root cause: `WeekViewTabs.tsx` "Standings" button is a `<button>` that toggles local state via `onChange`, not a route `<Link>`. Users reaching the standings view via the in-page tab stay on the `/league/{slug}` route where `mostRecentArchivedYear` had not been plumbed. Informed STANDINGS-SUBHEADER-FIX.

### INSIGHTS-017-PANEL-POLISH-FOLLOWUP

- Purpose: Final polish pass on the Insights Panel campaign. Reroute SEASON season_wrap insights (`champion_margin`, `failed_chase`) from `/standings` to year-scoped history; add offseason-correct "{year} Final Standings" subheader via `leagueStatus` plumbing and archive-based year resolution; tighten light-mode arrow contrast on insight rows.
- Scope: `src/components/OverviewPanel.tsx`, `src/components/StandingsPanel.tsx`, `src/app/league/[slug]/insights/AllInsightsRow.tsx`, `src/app/league/[slug]/standings/page.tsx`, `src/components/CFBScheduleApp.tsx`.
- Notes: Commit `113b27d`. `insightHref` signature extended with optional `panelYear?: number` 4th arg; reroutes only `season_wrap` + (`champion_margin` | `failed_chase`) + valid `panelYear` to `/history/{year}`. `leagueStatus={league?.status}` + `mostRecentArchivedYear` now passed to `CFBScheduleApp` from standings page; new nested ternary branch renders "{year} Final Standings" only when `leagueStatus.state === 'offseason'` AND `weekViewMode === 'standings'` AND a resolved archive year is available. Arrow class changed from `text-gray-400` to `text-gray-500` at all three render sites (OverviewPanel InsightRow, SeasonRecapRow, AllInsightsRow); `dark:text-zinc-500` unchanged. No changes to generators, derive helpers, `Insight` type, or `insightCategories.ts`.

### INSIGHTS-017-POLISH-FOLLOWUP-DISCOVERY

- Purpose: Read-only investigation to answer implementation questions for the INSIGHTS-017-PANEL-POLISH followup — confirms SEASON insight year availability, current `navigationTarget: 'standings'` call sites, arrow color contrast baseline, `leagueStatus` plumbing path, and history year route encoding.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Established that season year is not on the insight payload but is available at the panel layer (`currentYear` on OverviewPanel, `season` on StandingsPanel). Six `navigationTarget: 'standings'` call sites identified — only two (`champion_margin` line 450, `failed_chase` line 486) are `season_wrap`. Arrow color in light mode (`#9ca3af`) measured at ~2.85:1 contrast against white (below WCAG 3:1). Confirmed `listSeasonArchives` as authoritative source for "most recently completed season".

### INSIGHTS-017-PANEL-POLISH

- Purpose: Polish pass on the Insights Panel. Flatten row 1 prominence pending ranker maturity, add HISTORICAL/RIVALRY deep-link arrows via panel-layer resolver, add section anchors to the history page, fix light-mode banner colors.
- Scope: `src/components/OverviewPanel.tsx`, `src/app/league/[slug]/history/page.tsx`, `src/components/CFBScheduleApp.tsx`.
- Notes: Commit `a82ef02`. `insightHref` extended to 3-arg signature with optional `Insight` third param; `resolveHistoryHref()` added — Tier 1 routable (drought → `#dynasty-drought`, dynasty → `#championships`, career/owner generators → `/history/owner/{owner}`, `greatest_season` → `/history/{year}` via `parseYearFromInsightId`, rivalry types → `#rivalries`, `milestone_watch-wins` → owner page); Tier 2 returns `null` for `career_points_leader`, `career_turnover_margin`, `milestone_watch-points` pending HISTORY-REWORK. Three `<section id=>` anchors added to history page with `scroll-mt-4` buffer. All five CFBScheduleApp banner variants converted from hardcoded hex to paired `{light, dark}` palette objects keyed off existing `isDark`.

### INSIGHTS-017-POLISH-DISCOVERY-FOLLOWUP

- Purpose: Resolve five follow-up questions from INSIGHTS-017-POLISH-DISCOVERY — fixed header presence, owner slug URL convention, structural tied-owner insight analysis, destination-fit audit per insight type, DESIGN.md palette rules.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Confirmed no fixed header (scroll-mt-4 sufficient); canonical URL convention is `encodeURIComponent(owner)`; tied-owner insights cap at max 3 owners (`TIE_SUPPRESSION_THRESHOLD = 4`); three insight types flagged as Tier 2 (no viable history surface today); DESIGN.md codifies strict hue-level ban on amber/green/red/blue for category use.

### INSIGHTS-017-POLISH-DISCOVERY

- Purpose: Read-only investigation of row affordances, HISTORICAL/RIVALRY metadata, history page structure, deep-link feasibility, banner component, and category microlabel palette in preparation for INSIGHTS-017-PANEL-POLISH.
- Scope: Read-only diagnostic. No code changes, no commits.
- Notes: Mapped 13 history link sites using `encodeURIComponent(owner)`; identified five CFBScheduleApp banner variants with hardcoded dark-mode-only hex; inventoried 26 insight types by deep-link feasibility (Tier 1 vs Tier 2); enumerated category microlabel palette collisions (HISTORICAL/STANDINGS/SEASON share purple, STATS/LEAGUE/fallback share slate) for future INSIGHTS-017-PALETTE work.

### INSIGHTS-017-PANEL-UI

- Purpose: Initial Insights Panel UI redesign — 5 insights (up from 3), 10px uppercase category microlabels, first-row prominence via larger type, fully tappable rows with `→` affordance, "See all →" link to dedicated insights page.
- Scope: `src/components/OverviewPanel.tsx`, `src/app/league/[slug]/insights/AllInsightsRow.tsx` (new), `src/app/league/[slug]/insights/page.tsx` (new), `DESIGN.md`.
- Notes: Commit `1348605`. `AllInsightsRow` extracted as a `'use client'` component to access `useIsDarkMode()` for category colors (unblocks `light-dark()` CSS issue in server components). `fresh_offseason` featured slot becomes "Season Recap" card pointing to `/history`. `DESIGN.md` updated with Insights Panel + Insight Category Colors sections codifying the token pairs and the semantic-off-limits rule.

### DOCS-CLOSEOUT-005

- Purpose: Update all project documentation to reflect everything completed since DOCS-CLOSEOUT-004 — Copy Variation Architecture campaign and Insights Panel UI direction decisions.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-016, INSIGHTS-016-COPY-VARIATION, INSIGHTS-016-COPY-FIX, INSIGHTS-016-CR-FIXES.

### INSIGHTS-016-CR-FIXES

- Purpose: Fix two code review bugs — league-scoped suppression records and gated suppression reset on rollover.
- Scope: `src/lib/insights/suppression.ts`, `src/app/api/cron/season-rollover/route.ts`.
- Notes: Suppression storage scope changed from global `'insights-suppression'` to `'insights-suppression:{leagueSlug}:{season}'`. `loadSuppressionRecords`, `saveSuppressionRecord`, `clearAllSuppressionRecords` now accept `leagueSlug` + `season`. Engine passes `context.leagueSlug` + `context.currentYear`. Rollover suppression clear moved inside per-league success path (gated on both archive + status update succeeding). Response reports `suppressionClearedFor: string[]`.

### INSIGHTS-016-COPY-FIX

- Purpose: Fix `career_points_leader` `extending_lead`/`narrowing_gap` hook-copy mismatch.
- Scope: `src/lib/insights/generators/career.ts` only.
- Notes: Post-hoc override block that wrote `narrowing_gap`-framed copy ("closest it's ever been") while the hook remained `extending_lead` was removed. "Closest it's ever been" language folded into the `narrowing_gap` template branch, conditioned on `ratio <= POINTS_CLOSE_RATIO`. `extending_lead` now always produces "pulling away" copy. `career_turnover_margin` audited — no override block, consistent copy.

### INSIGHTS-016-COPY-VARIATION

- Purpose: Full implementation of the Copy Variation Architecture — newsHook + statValue on all generators, suppression gate, async engine, per-generator templates.
- Scope: `src/lib/insights/types.ts`, `src/lib/selectors/insights.ts`, `src/lib/insights/suppression.ts` (new), `src/lib/insights/engine.ts`, `src/lib/insights/generators/historical.ts`, `src/lib/insights/generators/rivalry.ts`, `src/lib/insights/generators/career.ts`, `src/lib/insights/generators/stats.ts`, `src/lib/insights/generators/milestones.ts`, `src/lib/insights/generators/existing.ts`, `src/app/api/insights/[slug]/route.ts`, `src/app/api/cron/season-rollover/route.ts`.
- Notes: `newsHook` (11 types) + `statValue: number` required on `Insight`. `suppression.ts` implements per-league/season scope, per-type threshold rules, NEVER_SUPPRESS_TYPES set. Engine async: load → generate → filter suppressed → sort → slice 10 → write. `?bypassSuppression=1` bypasses gate. Season rollover clears suppression records.

### DOCS-CLOSEOUT-004

- Purpose: Update all project documentation to reflect everything completed since DOCS-CLOSEOUT-003 — Insights Engine Generator Batch 2, context extension, bug fixes, and copy variation architecture decisions.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-014, INSIGHTS-015, INSIGHTS-015-BUG-FIXES, and Copy Variation Architecture decisions from Opus 1M Brainstorming Session 2.

### INSIGHTS-015-BUG-FIXES

- Purpose: Fix UTF-8 encoding issue (missing charset header on API response) and trending direction logic (strict monotonicity check).
- Scope: `src/app/api/insights/[slug]/route.ts`, `src/lib/insights/generators/career.ts`.
- Notes: Charset header added to Content-Type response. Trending up/down now requires all season-over-season deltas to be in the same direction (strict monotonicity), not just net direction.

### INSIGHTS-015-GENERATOR-BATCH-2

- Purpose: Build 16 new insight generators across career, stats, and milestones files. Add tone property and InsightWindow type.
- Scope: `src/lib/insights/generators/career.ts` (new), `src/lib/insights/generators/stats.ts` (new), `src/lib/insights/generators/milestones.ts` (new), `src/lib/insights/types.ts`, `src/lib/insights/generators/index.ts`.
- Notes: career.ts: career_points_leader, career_turnover_margin, volatility, never_last, title_chaser, rookie_benchmark, greatest_season, trending_up/down. stats.ts: ball_security, takeaway_king, yards_per_win, clock_crusher, third_down, team_identity. milestones.ts: milestone_watch, perfect_against. Generator-level `tone: 'factual' | 'playful'` added. `InsightWindow` type defined for future parameterization.

### INSIGHTS-014-CONTEXT-EXTENSION

- Purpose: Extend InsightContext with career stats — OwnerCareerStats type, buildOwnerCareerStats(), pointsAgainst on OwnerSeasonStats, and career diagnostic route.
- Scope: `src/lib/insights/types.ts`, `src/lib/insights/context.ts`, `src/lib/gameStats/ownerStats.ts`, `src/app/api/debug/insights-career-diagnostic/route.ts` (new).
- Notes: `OwnerCareerStats` fields: seasons, totalWins, totalLosses, totalPoints, totalPointsAgainst, totalYards, turnovers, turnoverMargin, titles, titleYears, finishHistory, firstSeason, isRookie. Career stats assembled at query time from archive data. `pointsAgainst` on `OwnerSeasonStats` unlocks Luck Score generator.

### DOCS-CLOSEOUT-003

- Purpose: Update all project docs after the Insights Engine generators, Season Rollover, History page polish, and code review fixes.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-010 through INSIGHTS-013B, INSIGHTS-CR-001, PLATFORM-001, POLISH-003.

### INSIGHTS-CR-001-CODE-REVIEW-FIXES-v1

- Purpose: Fix two bugs from code review — missing league-scoped aliases in the insights API, and incorrect "tied" copy for non-tied even rivalries.
- Scope: `src/app/api/insights/[slug]/route.ts`, `src/lib/insights/generators/rivalry.ts`.
- Notes: PR #278. API now uses `getGlobalAliases()` + `aliases:{slug}:{year}` merge server-side (matches `/api/owners` routes). Even rivalry copy branches on `winDiff` — 0 → "tied at", 1 → "X leads Y N-M across K meetings — the closest rivalry in the league".

### INSIGHTS-013B-TIE-LOGIC-v1

- Purpose: Apply universal tie suppression across historical generators — 4+ tied suppress; 2–3 use group copy; 1 keeps existing copy.
- Scope: `src/lib/insights/generators/historical.ts`.
- Notes: PR #278. Applied to drought (incl. never-won), consistency (max top-3), improvement (same positions jumped). Dynasty unchanged (already handled ties). Added `TIE_SUPPRESSION_THRESHOLD = 4` and `formatOwnerList()` helper.

### INSIGHTS-013-GENERATOR-FIXES-v1

- Purpose: Fix dynasty tie handling, drought ranking for never-won owners, and active-owner filtering across all seven insight types.
- Scope: `src/lib/insights/generators/historical.ts`, `src/lib/insights/generators/rivalry.ts`.
- Notes: PR #278. Dynasty emits three copy variants (sole / tied-with-recent / tied-equal-recency). Drought = seasons played when never-won. Active-owner filter via `context.currentRoster` applied to drought, dynasty, improvement, consistency, lopsided_rivalry, even_rivalry, dominance_streak.

### POLISH-003-HISTORY-PAGE-FIXES-v1

- Purpose: Fix all-time standings sort order and add visual distinction for former league owners.
- Scope: `src/lib/selectors/historySelectors.ts`, `src/components/history/AllTimeStandingsTable.tsx`, `src/components/history/AllTimeHeadToHeadPanel.tsx`, `src/app/league/[slug]/history/page.tsx`.
- Notes: PR #278. New sort: Total Wins → Win% → Point Differential. `totalPointDifferential` added to `AllTimeStandingRow`. Active owners derived from `owners:{slug}:{year}` CSV on the server; former owners render muted + "Former" badge in both the all-time standings table and the Top Rivalries panel. `activeOwners: string[]` props (not `Set<string>`) to preserve server/client serialization.

### PLATFORM-001-ROLLOVER-UI-v1

- Purpose: Build a Season Rollover admin panel at `/admin/data/cache` with a two-phase preview/execute flow, plus an automatic rollover cron triggered by national championship game date + 7 days.
- Scope: `src/components/admin/SeasonRolloverPanel.tsx` (new), `src/app/api/admin/rollover/route.ts`, `src/app/api/cron/season-rollover/route.ts` (new), `src/lib/seasonRollover.ts`, `src/app/admin/data/cache/page.tsx`, `vercel.json`.
- Notes: PR #278. Preview response extended with `champion` + `top3` per league for UI display. `findNationalChampionshipGameDate()` prefers `playoffRound === 'national_championship'` with postseason fallback. Cron runs daily, filters non-test leagues in `state: 'season'`, per-league error isolation. TSC successfully rolled over via the new panel.

### INSIGHTS-012-LEAGUE-STATE-DIAGNOSTIC-v1

- Purpose: Diagnose why TSC was still in `state: 'season'` after the 2025 season ended. Read-only.
- Scope: Read-only diagnostic.
- Notes: Identified that existing cron only handles preseason→season; season→offseason required a manual rollover. Informed PLATFORM-001-ROLLOVER-UI.

### INSIGHTS-012-API-ROUTE-v1

- Purpose: Build `GET /api/insights/[slug]` and wire the insights engine into the overview panel.
- Scope: `src/app/api/insights/[slug]/route.ts` (new), `src/components/OverviewPanel.tsx`, `src/lib/selectors/overview.ts`.
- Notes: PR #278. Merge strategy — engine insights first, existing insights fill up to 3. Owners CSV, schedule, scores, rankings, and archives loaded server-side; context built via `buildInsightContext()`.

### INSIGHTS-011-GENERATORS-v1

- Purpose: Add historical (drought, dynasty, improvement, consistency) and rivalry (lopsided, even, dominance streak) generators, both self-registering.
- Scope: `src/lib/insights/generators/historical.ts` (new), `src/lib/insights/generators/rivalry.ts` (new), `src/lib/insights/generators/index.ts`.
- Notes: PR #278. Engine-level try/catch isolates per-generator failures. Active-owner filter derived from current roster.

### INSIGHTS-010-CLEANUP-v1

- Purpose: Canonicalize `aggregateOwnerSeasonStats()` in `ownerStats.ts` and remove the local mirror from `context.ts`.
- Scope: `src/lib/gameStats/ownerStats.ts`, `src/lib/insights/context.ts`.
- Notes: PR #278. Single source of truth for owner season-stat aggregation; no duplicate logic in context builder.

### INSIGHTS-010-CONTEXT-LIFECYCLE-v1

- Purpose: Add `deriveLifecycleState()` and `buildInsightContext()` so generators receive a consistent, self-contained context.
- Scope: `src/lib/insights/context.ts` (new), `src/lib/insights/types.ts`.
- Notes: PR #278. Lifecycle derived from `LeagueStatus` + `SeasonContext` + calendar (7 states). Context assembles standings history, games, game stats, archives, historical rosters, current roster, AP rankings.

### DOCS-CLOSEOUT-002

- Purpose: Update all project documentation to reflect Game Stats Pipeline completion and Insights Engine Foundation work.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Covers INSIGHTS-006 through INSIGHTS-009, POLISH-001/002, ROADMAP-RESTRUCTURE, DOCS-CLOSEOUT-001.

### INSIGHTS-009-GENERATOR-RESTRUCTURE-v1

- Purpose: Restructure `selectors/insights.ts` around a formal generator interface. Resolve the `deriveLeagueInsights` naming conflict. Add `category`, `lifecycle`, `stat` fields to `Insight` type. Port existing functions as registered generators.
- Scope: `src/lib/insights/types.ts` (new), `src/lib/insights/engine.ts` (new), `src/lib/insights/generators/existing.ts` (new), `src/lib/selectors/insights.ts`, `src/lib/gameTags.ts`, `src/lib/selectors/overview.ts`, `src/lib/__tests__/gameTags.test.ts`.
- Notes: PR #276. `deriveLeagueInsights` in `gameTags.ts` renamed to `deriveGameMovementInsights`. Canonical `deriveLeagueInsights` in `selectors/insights.ts` retains its name. All 8 derive functions annotated with category + lifecycle. 43/43 tests pass.

### INSIGHTS-008-DEAD-CODE-CLEANUP-v1

- Purpose: Remove orphaned narrative insight logic from `leagueInsights.ts`, relocate all actively-consumed exports to `gameTags.ts`, clean up associated orphaned tests.
- Scope: `src/lib/gameTags.ts` (new, rename from `leagueInsights.ts`), `src/lib/__tests__/gameTags.test.ts` (renamed), `src/lib/selectors/gameWeek.ts`, `src/lib/selectors/overview.ts`, `src/components/GameWeekPanel.tsx`, `src/components/MatchupsWeekPanel.tsx`.
- Notes: PR #276. Removed `computeWeeklyInsights`, `WeeklyInsights`, `addOwnerCount`, `scoreForSide`, `projectedWinsForOwner` (252 lines). Discovered `overview.ts` was an undiscovered active consumer of `deriveLeagueInsights` — kept and moved, not deleted.

### INSIGHTS-007-EXISTING-AUDIT-v1

- Purpose: Fully map all existing insight logic before building the Insights Engine. Read-only audit.
- Scope: Read-only. All insight-related files: `selectors/insights.ts`, `leagueInsights.ts`, `selectors/overview.ts`, `StandingsPanel.tsx`, `OverviewPanel.tsx`, all test files.
- Notes: Identified two functions named `deriveLeagueInsights` (naming conflict). Found `deriveLeagueInsights` in `leagueInsights.ts` was incorrectly flagged as orphaned — `overview.ts` actively consumes it at line 947.

### INSIGHTS-006-ARCHITECTURE-REVIEW-v1

- Purpose: Read-only review of proposed Insights Engine architecture. Validate design against codebase, identify gaps, naming conflicts, missing types.
- Scope: Read-only audit.
- Notes: Confirmed the two-`Insight`-type naming collision as a blocker requiring resolution before generator work begins. Recommended extending `selectors/insights.ts` rather than replacing it.

### POLISH-002-RUNBOOK-UPDATE-v1

- Purpose: Update `docs/deployment-runbook.md` to reflect current Clerk-based auth model.
- Scope: `docs/deployment-runbook.md` only.
- Notes: PR #276. Removed all `ADMIN_API_TOKEN` references. Added Clerk production instance setup, `platform_admin` role configuration, and Vercel environment variable checklist.

### POLISH-001-QUALITY-BASELINE-v1

- Purpose: Restore passing lint and TypeScript baseline. Fix all existing lint violations and type errors without changing any logic.
- Scope: 86 source files reformatted (Prettier), 1 test fixed (`selectors-overview.test.ts`), zero ESLint violations.
- Notes: PR #276. No logic changes. Type fixes were structural (missing `as const`, narrowing patterns); formatter fixes were style-only.

### ROADMAP-RESTRUCTURE-v1

- Purpose: Replace phase-based naming with campaign-based workstream organization in all project docs.
- Scope: `docs/roadmap.md`, `docs/next-tasks.md`, `docs/completed-work.md`. No code changes.
- Notes: Phase numbering retired. Existing `P{n}` prompt IDs grandfathered. New prompts use `{CAMPAIGN}-{###}` format. Campaign prefixes: INSIGHTS, DRAFT, PLATFORM, POLISH.

### DOCS-CLOSEOUT-001-v1

- Purpose: Update project docs after Game Stats Pipeline completion (P7B-GAME-STATS-PIPELINE-A through INSIGHTS-004).
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Captured pipeline build, backfill, normalization, school name fix, and latest week fix.

### INSIGHTS-004-SCHOOL-NAME-FIX-v1

- Purpose: Fix CFBD school name field — normalizer was reading `school` field but CFBD response uses `team` field name.
- Scope: `src/lib/gameStats/normalizers.ts` only.
- Notes: PR #275. Corrected field reference from `.school` to `.team` in `normalizeGameTeamStats()`.

### INSIGHTS-003-DATA-DIAGNOSTIC-v1

- Purpose: Add temporary diagnostic route for owner game stats to inspect raw cached structure and resolution chain.
- Scope: `src/app/api/debug/game-stats-diagnostic/route.ts` (new). Admin-gated.
- Notes: PR #275. Three build fixes (`INSIGHTS-003-BUILD-FIX`, `-FIX-2`, `-FIX-3`) applied. Debug-FIX applied for raw cache inspection.

### INSIGHTS-002-LATEST-WEEK-FIX-v1

- Purpose: Fix latest week detection — was using week number comparison which could pick the current in-progress week instead of the most recently completed one.
- Scope: `src/app/api/cron/game-stats/route.ts`, `src/lib/gameStats/cache.ts`.
- Notes: PR #274. Use calendar date to determine last completed week — compare against `new Date()` to exclude current week.

### P7B-ROADMAP-INSIGHTS-CONSOLIDATE-v1

- Purpose: Merge Preseason Insights Panel into Insights Engine campaign in roadmap.
- Scope: `docs/roadmap.md` only. No code changes.

### P7B-GAME-STATS-NORMALIZE-v1

- Purpose: Add 6 special teams and defensive return fields to `TeamGameStats` and normalizer.
- Scope: `src/lib/gameStats/types.ts`, `src/lib/gameStats/normalizers.ts`.
- Notes: Fields: `interceptionReturnYards`, `interceptionReturnTDs`, `kickReturnYards`, `kickReturnTDs`, `puntReturnYards`, `puntReturnTDs`.

### P7B-GAME-STATS-BACKFILL-v1

- Purpose: Add "Backfill Full Season" button to game stats admin panel.
- Scope: `src/components/admin/GameStatsCachePanel.tsx`.
- Notes: Iterates all weeks 1–19 sequentially; progress shown inline.

### P7B-GAME-STATS-CACHE-PANEL-v1

- Purpose: Add `GameStatsCachePanel` with "Refresh Game Stats" button to admin cache page.
- Scope: `src/components/admin/GameStatsCachePanel.tsx` (new), `src/app/admin/data/cache/page.tsx`.
- Notes: Shows cache freshness per week. Refresh triggers `/api/game-stats` route.

### P7B-GAME-STATS-PIPELINE-A-v1

- Purpose: Build game stats data pipeline — types, normalizers, cache layer, owner aggregation, API route, cron route.
- Scope: `src/lib/gameStats/types.ts` (new), `src/lib/gameStats/normalizers.ts` (new), `src/lib/gameStats/cache.ts` (new), `src/lib/gameStats/ownerStats.ts` (new), `src/app/api/game-stats/route.ts` (new), `src/app/api/cron/game-stats/route.ts` (new).
- Notes: PR #274. One call per week to CFBD. `aggregateOwnerGameStats()` uses `TeamIdentityResolver`. Cache key `${year}:${week}:${seasonType}`.

### P7B-GAME-STATS-AUDIT-v1

- Purpose: Document CFBD game team stats endpoint shape and integration plan.
- Scope: `docs/game-stats-audit.md` (new). Read-only analysis.
- Notes: Confirmed endpoint `GET /games/teams`, documented all available stat categories, identified owner aggregation strategy.

### P7B-LAUNCH-DOCS-CLOSEOUT

- Purpose: Update completed-work, roadmap, next-tasks, and prompt-registry to reflect all launch preparation work completed since P7B-DRY-RUN-DOCS-CLOSEOUT.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Documents comprehensive audit, UI/UX polish, force-dynamic fix, demo UI polish, Clerk migration, domain setup, and branding update.

### P7B-BRANDING-UPDATE

- Purpose: Rename all user-facing references from "CFB League Dashboard" / "CFB App" to "Turf War"; update URL examples to `turfwar.games`.
- Scope: `src/app/layout.tsx`, `src/app/login/[[...sign-in]]/page.tsx`, `src/components/RootPageClient.tsx`, `src/components/__tests__/CFBScheduleApp.test.tsx`.
- Notes: PR #272. No config, env var, or internal doc references changed. `cfb-app-preview.vercel.app` left unchanged (dev URL).

### P7B-CLERK-MIGRATION-AUDIT

- Purpose: Audit all Clerk configuration, session token claims, publicMetadata role patterns, and auth flows in preparation for production instance migration.
- Scope: Read-only audit. No code changes.
- Notes: Identified session token claim key (`platform_admin` in publicMetadata), all Clerk-dependent routes, and migration steps required.

### P7B-UI-POLISH-DEMO-FIXES

- Purpose: Fix demo-blocking UI issues identified in the comprehensive audit: custom not-found/error pages, light mode fix on cache admin, autoPickMetric dropdown removal.
- Scope: `src/app/not-found.tsx` (new), `src/app/error.tsx` (new), `src/app/admin/data/cache/page.tsx`, `src/components/draft/DraftSettingsPanel.tsx`.
- Notes: Resolves four items from P7B-UI-UX-POLISH-AUDIT top-10 list.

### P7B-FORCE-DYNAMIC-FIX

- Purpose: Add `export const dynamic = 'force-dynamic'` to all pages that read from the database or call server-side APIs at request time, resolving a Vercel build blocker.
- Scope: 11 pages across `src/app/`.
- Notes: Build blocker identified in P7B-COMPREHENSIVE-AUDIT. All affected pages now correctly opt out of static generation.

### P7B-UI-UX-POLISH-AUDIT

- Purpose: Full page-by-page UI/UX audit of the app; rate each surface and identify the top 10 improvements.
- Scope: Read-only audit. No code changes.
- Notes: 10 improvements prioritized; several addressed immediately in P7B-UI-POLISH-DEMO-FIXES.

### P7B-APP-WIDE-AUDIT

- Purpose: Comprehensive 16-section app-wide audit covering architecture, auth, data flows, API usage, build config, and deployment readiness.
- Scope: Read-only audit. No code changes.
- Notes: One build blocker identified (force-dynamic missing on 11 pages), resolved in P7B-FORCE-DYNAMIC-FIX.

### MERGE-CONFLICT-FIX

- Purpose: Resolve merge conflicts in three files after merging origin/main into polish-draft-flow branch.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`, `src/app/admin/[slug]/preseason/page.tsx`.
- Notes: 7 conflict hunks resolved. Kept ours' `autoCompleteDraft` and revalidatePaths; took theirs' `updateLeague` in `completeSetup`, string return from `migrateTestOwnersCsv`, `isSetupComplete` checklist item, two-state button rendering.

### MERGE-CONFLICT-AUDIT

- Purpose: Read-only audit of all conflict markers in three conflicted files before resolution.
- Scope: Read-only audit.
- Notes: Identified 5 compatible conflicts (keep both) and 2 mutually exclusive conflicts (take theirs — more complete implementation).

### P7B-RESET-RACE-FIX

- Purpose: Fix lost-update race in `resetTestLeague()` — `updateLeague` and `updateLeagueStatus` both write the same registry array and must not run in parallel.
- Scope: `src/app/admin/[slug]/actions.ts` only.
- Notes: Sequential awaits for the two registry writes; four `deleteAppState` calls remain parallel (independent keys).

### P7B-COMPLETE-SETUP-HUB-FIX

- Purpose: Admin hub now shows "Setup Complete ✓" green state when `setupComplete === true`.
- Scope: `src/app/admin/[slug]/page.tsx` only.
- Notes: Two distinct preseason cards: in-progress shows "Continue Setup" link; complete shows green badge with "Season will go live automatically" note.

### P7B-COMPLETE-SETUP-REVALIDATE-3

- Purpose: Audit async call chain in `completeSetup()` — confirmed all awaits correct, no missing awaits.
- Scope: Read-only audit of `completeSetup()` and `updateLeagueStatus()` internals.

### P7B-COMPLETE-SETUP-REVALIDATE-2

- Purpose: Add `revalidatePath('/admin/${slug}', 'layout')` to bust full route segment cache after setup complete.
- Scope: `src/app/admin/[slug]/actions.ts`.

### P7B-COMPLETE-SETUP-REVALIDATE

- Purpose: Add `revalidatePath` calls to `completeSetup()` so Next.js cache is busted before redirect.
- Scope: `src/app/admin/[slug]/actions.ts`.

### P7B-SANDBOX-AUTO-COMPLETE-DRAFT

- Purpose: Add "Auto-complete Draft" sandbox button that fills all remaining picks randomly and writes owners CSV.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`.
- Notes: Fisher-Yates shuffle; snake draft order via `getPickOwner` logic; writes `draft:test/{year}` as complete + `owners:test:{year}/csv` with NoClaim rows. Test league only.

### P7B-SANDBOX-RESET-FIX

- Purpose: Fix sandbox reset controls to clear all preseason state for clean dry runs.
- Scope: `src/app/admin/[slug]/actions.ts`.
- Notes: "Set: Pre-Season" clears preseason-owners, owners CSV, draft state for target year. "Reset to 2025 Season" also clears all 2026 state including schedule-probe. "Reset Draft" unchanged (draft + owners CSV only).

### P7B-ROSTER-CHECK-FIX

- Purpose: `hasRoster` falls back to owners CSV so a completed draft satisfies roster requirement.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`.
- Notes: Fetches `owners:${slug}:${year}/csv` in parallel; `hasCsvRoster` = header + ≥2 data lines. Either source satisfies the check.

### P7B-AUDIT-ROSTER-CHECK

- Purpose: Read-only audit of `hasRoster` check — identified that confirm route writes owners CSV but `hasRoster` only reads preseason-owners store (different scope).
- Scope: Read-only audit.

### P7B-AUDIT-COMPLETE-SETUP-GUARD

- Purpose: Verify Complete Setup button is disabled when roster not configured — confirmed `canGoLive` guard is correct.
- Scope: Read-only audit of `src/app/admin/[slug]/preseason/page.tsx`.

### P7B-DRAFT-SETUP-OWNERS-REMOVE

- Purpose: Remove redundant owners add/remove section from `DraftSettingsPanel`.
- Scope: `src/components/draft/DraftSettingsPanel.tsx`.
- Notes: Owners initialized from `draftState.owners` or `priorOwners`; `setOwners` setter removed; handlers `handleAddOwner`/`handleRemoveOwner` removed. Draft order section unchanged.

### P7B-CONTINUE-SETUP-LINK

- Purpose: Add "Continue Setup →" links on draft board complete banner and draft summary page; fix `DraftSummaryClient` to use dual-auth pattern.
- Scope: `src/components/draft/DraftHeaderArea.tsx`, `src/components/draft/DraftSummaryClient.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/app/admin/[slug]/page.tsx`.
- Notes: "Continue Setup →" only shown when admin + league in preseason. `DraftSummaryClient` now uses `useUser()` from Clerk alongside `hasStoredAdminToken()`.

### P7B-AUDIT-COMMISH-URL

- Purpose: Read-only audit of commissioner URL patterns and auth detection across draft components.
- Scope: Read-only audit.

### P7B-DRAFT-START-FIX

- Purpose: Fix "Start Draft" button causing redirect loop — phase not transitioned to `live` before navigation.
- Scope: `src/components/draft/DraftSetupShell.tsx`.
- Notes: `handleStartDraft()` now calls `PUT /api/draft/${slug}/${year}` with `{ phase: 'live' }` before `window.location.href` redirect.

### P7B-OVERVIEW-BANNER-COUNTDOWN

- Purpose: Add adaptive countdown label to draft scheduled banner (days away / tomorrow / today / starting soon).
- Scope: `src/components/CFBScheduleApp.tsx`.

### P7B-OVERVIEW-BANNER-STYLE-FIX

- Purpose: Fix banner using wrong year (2025 vs 2026) and draft fetch not finding draft — both caused by using `league.year` instead of `leagueStatus.year`.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/app/league/[slug]/page.tsx`.
- Notes: `bannerYear` and `draftLookupYear` now derived from `leagueStatus.year` when in preseason/season.

### P7B-OVERVIEW-BANNER-STYLE

- Purpose: Apply left-border accent styling and pulsing live indicator dot to overview lifecycle banners.
- Scope: `src/components/CFBScheduleApp.tsx`.
- Notes: 3px left border via inline styles; dark backgrounds; right-side-only border radius. CSS keyframes `cfb-pulse` and `cfb-pulse-ring` injected via `<style>` tag.

### P7B-OVERVIEW-BANNER

- Purpose: Add state-driven lifecycle banners and header subtitle to league overview page.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/app/league/[slug]/page.tsx`.
- Notes: Banner system driven by `leagueStatus` prop. States: offseason, preseason (no draft/scheduled/in-progress/complete), season.

### P7B-AUDIT-SEASON-STATE

- Purpose: Read-only audit of league lifecycle state implementation — status storage, transition actions, UI rendering, year derivation.
- Scope: Read-only audit.

### P7B-PRESEASON-REGRESSION-FIX-2

- Purpose: Bind "Complete Setup" button to `completeSetup()` (not `goLive()`); restore raw CSV migration in `migrateTestOwnersCsv`.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`, `src/app/admin/[slug]/actions.ts`, `src/lib/league.ts`.
- Notes: `completeSetup()` sets `{ state: 'preseason', setupComplete: true }` — no season transition. `migrateTestOwnersCsv` reads/writes raw CSV without parsing.

### P7B-PRESEASON-REGRESSION-FIX

- Purpose: Rename "Go Live" button label to "Complete Setup"; add "Migrate Owners →" button to TestLeagueControls.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`.

### P7B-PRESEASON-CHECKLIST-FIX

- Purpose: Remove "Season live" item from preseason checklist — it was circular and unsatisfiable via the checklist flow.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`.

### P7B-SEASON-TRANSITION-C

- Purpose: Pre-season overview page with owner rosters and schedule placeholder. Prevent prior season data bleed-through. Update all project documentation.
- Scope: `src/components/CFBScheduleApp.tsx`, `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`.
- Notes: Owner roster cards rendered inline during preseason with no schedule. Fatal bootstrap error suppressed in preseason. `isPreseason` boolean added. No 2025 bleed — `selectedSeason` keyed to `leagueStatus.year`.

### P7B-SEASON-TRANSITION-B-FIX

- Purpose: Fix setupComplete UI state, confirm league.year sync in cron, improve CRON_SECRET error clarity.
- Scope: `src/app/admin/[slug]/preseason/page.tsx`, `src/app/api/cron/season-transition/route.ts`.
- Notes: Checklist item reactive to `setupComplete`. Green badge + cron note replaces button post-setup. `verifyCronSecret` returns discriminated `'ok' | 'not-configured' | 'invalid'` with distinct error messages.

### P7B-SEASON-TRANSITION-B

- Purpose: Rename "Go Live" to "Complete Setup", decouple from state transition, add Vercel cron for automatic season transition.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/preseason/page.tsx`, `src/components/draft/DraftSummaryClient.tsx`, `src/app/api/cron/season-transition/route.ts` (new), `vercel.json` (new), `src/lib/scheduleProbe.ts` (new), `src/app/api/schedule/route.ts`.
- Notes: `completeSetup()` sets `setupComplete: true` on preseason status, no state transition. Cron probes CFBD, caches schedule, transitions leagues day before first game. `ScheduleProbeState` tracks `baseCachedAt` and `firstGameDate`. Manual refresh updates probe state.

### P7B-SEASON-TRANSITION-A

- Purpose: Fix schedule year derivation for preseason state.
- Scope: `src/lib/scores/normalizers.ts`, `src/app/api/schedule/route.ts`, `src/components/admin/GlobalRefreshPanel.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/admin/HistoricalCachePanel.tsx`, `src/app/admin/data/cache/page.tsx`.
- Notes: `seasonYearForToday()` threshold moved from `>= 7` (August) to `>= 6` (July). `GlobalRefreshPanel` accepts `defaultYear` prop. `CFBScheduleApp` uses `leagueStatus.year` for `selectedSeason` during preseason.

### P7B-AUDIT-SCHEDULE-YEAR

- Purpose: Read-only audit of schedule year derivation across the app.
- Scope: `GlobalRefreshPanel.tsx`, `CFBScheduleApp.tsx`, `schedule/route.ts`, `schedule.ts`, `useScheduleBootstrap.ts`, admin pages.
- Notes: Identified that all schedule fetches default to `seasonYearForToday()` (2025 in April 2026) — league state year is ignored. No path reads `leagueStatus.year` for schedule fetching.

### P7B-AUDIT-HISTORY-AND-SEASON-TRANSITION

- Purpose: Read-only audit of History tab, schedule caching, Go Live, first game date detection, cron mechanisms, and season archive connection.
- Scope: Full codebase read-only audit.
- Notes: History tab fully implemented (14 components, 3 routes). Schedule global, not per-league. No cron/scheduled mechanisms exist. First game date derivable from cached `ScheduleItem.startDate`. Archive → History connection already wired. `goLive()` only validates `state !== 'preseason'` — no server-side checklist enforcement.

### P7B-7

- Purpose: Polish the draft flow — remove redundant setup step, add drag-and-drop reordering, auto-pause between rounds, context-aware draft banner, neutral Available Teams background, visual hierarchy improvements.
- Scope: `src/components/draft/DraftSetupShell.tsx`, `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`, `src/components/draft/DraftBoardGrid.tsx`, `src/components/draft/DraftCard.tsx`, `src/components/draft/DraftControls.tsx`, `src/components/CFBScheduleApp.tsx`, doc updates.
- Notes: Setup step 1 (RosterSetupPanel) removed — auto-advance from preseason-owners; DraftSettingsPanel gains inline owner management + drag-and-drop + number entry for manual order; auto-pause at round boundaries with "Start Round X" button; spectator shows "Round X starting soon…"; league overview banner is blue-tinted with scheduled date or round info; DraftCard uses neutral bg-white/bg-zinc-800; section labels bolded with bottom borders; Available Teams panel gets subtle surface tint.

### P7B-6

- Purpose: Draft board UI polish — remove Rosters column, simplify DraftCard to name/conference/dot, update DraftBoardGrid cell colors, add spectator search, clean up landing page.
- Scope: `src/lib/selectors/draftTeamInsights.ts`, `src/components/draft/DraftCard.tsx`, `src/components/draft/DraftBoardGrid.tsx`, `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`, `src/components/RootPageClient.tsx`, `src/app/page.tsx`, doc updates.
- Notes: `teamColor: string | null` added to `DraftTeamInsights`; DraftCard stripped to 3 fields; `teamColorMap` passed to DraftBoardGrid for completed-cell tinting; active cell `bg-blue-600`, on-deck `bg-blue-100`; spectator now has search input; "Draft Setup →" removed from landing card; NoClaim filtered from owner count; status label derives from `league.status`.

### P7B-6-FIX

- Purpose: Follow-up fixes to draft board polish — on-the-clock consistent blue, active/on-deck cell colors.
- Scope: `src/components/draft/DraftBoardGrid.tsx`, `src/components/draft/DraftBoardClient.tsx`.

### P7B-6-FIX-2

- Purpose: Left color bar on Available Teams cards and pick cells.
- Scope: `src/components/draft/DraftCard.tsx`, `src/components/draft/DraftBoardGrid.tsx`.

### P7B-6-FIX-3

- Purpose: Team colors sourced from `getTeamDatabaseItems()`, conference colors as fallback.
- Scope: `src/lib/selectors/draftTeamInsights.ts`.

### P7B-6-FIX-3-HOTFIX

- Purpose: Hotfix for team color lookup casing mismatch.
- Scope: `src/components/draft/DraftBoardGrid.tsx`.

### P7B-6-FIX-4

- Purpose: Available Teams panel narrowed to 210px, search added to spectator view.
- Scope: `src/components/draft/SpectatorBoardClient.tsx`, `src/components/draft/DraftBoardClient.tsx`.

### P7B-6-FIX-5

- Purpose: Landing page cleanup — "Draft Setup →" link removed, NoClaim excluded from owner count.
- Scope: `src/components/RootPageClient.tsx`, `src/app/page.tsx`.

### P7B-6-FIX-5B

- Purpose: Draft status row links to draft when live/paused.
- Scope: `src/components/RootPageClient.tsx`.

### P7B-6-FIX-5C

- Purpose: Spectator banner removed.
- Scope: `src/components/draft/SpectatorBoardClient.tsx`.

### P7B-6-FIX-5D

- Purpose: md breakpoint fix for two-column layout.
- Scope: `src/components/draft/DraftBoardClient.tsx`, `src/components/draft/SpectatorBoardClient.tsx`.

### P7B-5-FIX-6

- Purpose: Fix manual assignment `teamsHref` re-introduced 404 — was set to `/admin/${slug}/assign`, corrected to `/admin/${slug}/preseason`.
- Scope: `src/app/admin/[slug]/preseason/page.tsx` only.
- Notes: Regression introduced in P7B-5 prompt which specified `/assign`; correct target is `/preseason` since manual assignment is coming-soon on that page.

### P7B-5-FIX-5

- Purpose: Bridge Clerk session auth in DraftBoardClient — add `useUser()` check alongside sessionStorage token to prevent premature redirect while Clerk loads.
- Scope: `src/components/draft/DraftBoardClient.tsx`.
- Notes: `isAdmin = isTokenAdmin || (clerkLoaded && clerkRole === 'platform_admin')`; redirect guard checks `if (isTokenAdmin) return; if (!clerkLoaded) return;`.

### P7B-5-FIX-4

- Purpose: Fix spectator board (`/league/[slug]/draft/board/page.tsx`) using `league.year` instead of lifecycle status year.
- Scope: `src/app/league/[slug]/draft/board/page.tsx`.
- Notes: Same `status?.state==='preseason'||status?.state==='season' ? status.year : league.year` pattern applied.

### P7B-5-FIX-3

- Purpose: Fix commissioner draft board (`/league/[slug]/draft/page.tsx`) using `league.year` instead of lifecycle status year — caused infinite redirect loop.
- Scope: `src/app/league/[slug]/draft/page.tsx`.
- Notes: `draft` looked up wrong year → null → redirect to setup → redirect back. Fixed with lifecycle-aware year derivation.

### P7B-5-FIX-2

- Purpose: Add Reset Draft button to TestLeagueControls — deletes all `draft:test/{year}` keys and corresponding `owners:test:{year}/csv` entries.
- Scope: `src/app/admin/[slug]/components/TestLeagueControls.tsx`, `src/app/admin/[slug]/actions.ts`.
- Notes: `resetTestDraft` server action uses `listAppStateKeys(draftScope('test'))` then `deleteAppState` for each; revalidates `/admin/test`.

### P7B-5-FIX

- Purpose: Fix owner confirmation page pre-population — three-step fallback: saved preseason-owners → archive → live owner CSV (fixes test league which has no archives).
- Scope: `src/app/admin/[slug]/preseason/owners/page.tsx`.
- Notes: Step 3 reads `getAppState<string>(\`owners:${slug}:${priorYear}\`, 'csv')` — corrected from prompt spec which had wrong key format.

### P7B-5

- Purpose: Build owner confirmation flow for pre-season setup, wire draft auto-populate from confirmed owner list, fix checklist links, close out P7B-4 in docs.
- Scope: `src/lib/preseasonOwnerStore.ts` (new), `src/app/admin/[slug]/preseason/owners/page.tsx` (new), `src/app/admin/[slug]/preseason/owners/OwnerConfirmationShell.tsx` (new), `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/preseason/page.tsx`, `src/app/league/[slug]/draft/setup/page.tsx`, doc updates.
- Notes: preseason-owners storage key `preseason-owners:{slug}` / `{year}`; confirmation requires ≥2 owners; checklist "Owners confirmed" checks preseason-owners not owners CSV; draft setup prefers confirmed list over archive-derived fallback; teamsHref now fully method-aware (draft/manual/null).

### P7B-4-FIX-5

- Purpose: Three fixes — sync `league.year` in goLive, method-aware `teamsAssigned` check with `manualAssignmentComplete` field, fix manual assignment link to `/preseason` (was 404 `/assign`).
- Scope: `src/lib/league.ts`, `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/preseason/page.tsx`.
- Notes: `goLive` now calls `updateLeague(slug, { year })` after `updateLeagueStatus`. `manualAssignmentComplete?: boolean` added to `League`. `teamsAssigned`: draft→`draftPhase==='complete'`, manual→`manualAssignmentComplete===true`, null→`false`. Coming-soon note added for manual method.

### P7B-4-FIX-4

- Purpose: Remove stale `tool.key === 'draft'` comparison in hub tool card loop that caused TypeScript build error after Draft card removal.
- Scope: `src/app/admin/[slug]/page.tsx` only.
- Notes: Replaced method-conditional href with unconditional `const href = \`/admin/\${slug}/\${tool.key}\``.

### P7B-4-FIX-3

- Purpose: Fix draft setup page using `league.year` instead of lifecycle status year; fix test controls season transition year carry-forward.
- Scope: `src/app/league/[slug]/draft/setup/page.tsx`, `src/app/admin/[slug]/actions.ts`.
- Notes: Draft setup now derives year from `status?.state`; `setTestLeagueStatus('season')` carries preseason year forward.

### P7B-4-FIX-2

- Purpose: Remove Draft card from hub tool cards array.
- Scope: `src/app/admin/[slug]/page.tsx`.
- Notes: Draft accessible only through pre-season flow, not directly from hub.

### P7B-4-FIX

- Purpose: Fix erratic year toggling in test controls (double-increment); add Reset to 2025 Season button.
- Scope: `src/app/admin/[slug]/actions.ts`, `src/app/admin/[slug]/components/TestLeagueControls.tsx`.
- Notes: `setTestLeagueStatus('preseason')` is now idempotent when already in preseason. `resetTestLeague` hard-resets league.year and status to `{season, 2025}`.

### P7B-4

- Purpose: Build pre-season setup flow: wire Begin Pre-Season button, new preseason page, three-item checklist, assignment method selection (draft/manual), Go Live button, hub cleanup.
- Scope: `src/app/admin/[slug]/page.tsx`, `src/app/admin/[slug]/preseason/page.tsx` (new), `src/app/admin/[slug]/components/AssignmentMethodCard.tsx` (new), `src/app/admin/[slug]/actions.ts`.
- Notes: Checklist: Owners confirmed / Teams assigned / Season live. Go Live gated by both. Assignment method persisted to `league.assignmentMethod`. Draft card removed from hub.

### P6-FINAL-CLOSEOUT-v1

- Purpose: Close out all remaining Phase 6 polish and fix work in planning docs and register all prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Final Phase 6 closeout. Phase 7 first tasks documented in next-tasks.md.

### P6-ADMIN-NAV-FIX-v1

- Purpose: Fix two navigation issues on `/admin/[slug]` — remove duplicate back link, add "← Back to league" link.
- Scope: `src/app/admin/[slug]/page.tsx` only.
- Notes: Removed page-level "← Admin" link (layout breadcrumb handles this). Added `← Back to league` → `/league/${slug}` in blue-400 style — gives commissioners a clear return path after navigating from gear icon.

### P6-ADMIN-COMMISSIONER-POLISH-FIX-v1

- Purpose: Fix two bugs — pass explicit year param to schedule/scores refresh calls, and read schedule status from correct combined cache key (`${year}-all-all`).
- Scope: `src/components/admin/GlobalRefreshPanel.tsx`, `src/components/admin/LeagueStatusPanel.tsx` only.
- Notes: Bug 1: `GlobalRefreshPanel` now has a year number input defaulting to `seasonYearForToday()`; all three fetch calls pass `&year=${year}`. Bug 2: `LeagueStatusPanel` checks `${year}-all-all` first (default `seasonType=all`), falls back to `${year}-all-regular`.

### P6-ADMIN-COMMISSIONER-POLISH-REVIEW-v1

- Purpose: Read-only review of P6-ADMIN-COMMISSIONER-POLISH-v1 implementation before merging.
- Scope: Read-only. All changed files in the commissioner polish commit.
- Notes: All checklist items pass. Recommendation: merge.

### P6-ADMIN-COMMISSIONER-POLISH-v1

- Purpose: Commissioner tools polish — per-league status panel, settings page, global refresh panel, aliases-only data panel.
- Scope: `src/components/admin/LeagueDataPanel.tsx`, `src/components/admin/LeagueStatusPanel.tsx` (new), `src/components/admin/GlobalRefreshPanel.tsx` (new), `src/components/admin/LeagueSettingsForm.tsx` (new), `src/app/admin/[slug]/data/page.tsx`, `src/app/admin/[slug]/page.tsx`, `src/app/admin/[slug]/settings/page.tsx` (new), `src/app/admin/data/cache/page.tsx`.
- Notes: Schedule/Scores sections removed from `LeagueDataPanel` (moved to `GlobalRefreshPanel`). `LeagueStatusPanel` reads `appStateStore` directly as server component. Four cards in 2×2 grid at `/admin/[slug]`. PR #233.

### P6-LEAGUE-DATA-PAGE-FIX-v1

- Purpose: Fix alias key normalization and score refresh scope — apply `normalizeAliasLookup()` to alias keys before PUT, refresh both regular and postseason scores.
- Scope: `src/components/admin/LeagueDataPanel.tsx` only.
- Notes: Bug 1: alias keys now run through `normalizeAliasLookup(r.key.trim())` before building PUT payload — matches runtime lookup normalization. Bug 2: scores refresh upgraded from regular-only to `Promise.all` of regular + postseason.

### P6-LEAGUE-DATA-PAGE-v1

- Purpose: Replace CFBScheduleApp embed in `/admin/[slug]/data` with focused `LeagueDataPanel` (schedule, scores, aliases).
- Scope: `src/app/admin/[slug]/data/page.tsx`, `src/components/admin/LeagueDataPanel.tsx` (new).
- Notes: `CFBScheduleApp`, `HistoricalCachePanel`, and `auth()` call removed from page. `LeagueDataPanel` is a focused client component with three sections: Schedule, Scores, Aliases.

### P6-ADMIN-FONT-FIX-v1

- Purpose: Reduce league name font size in commissioner tools card on `/admin/page.tsx`.
- Scope: `src/app/admin/page.tsx` only.
- Notes: Added `text-sm` to league display name span — prevents oversized rendering at implicit `text-base`.

### P6-GEAR-ICON-FIX-v1

- Purpose: Right-justify gear icon in CFBScheduleApp league view header.
- Scope: `src/components/CFBScheduleApp.tsx` only.
- Notes: Restructured header to `flex items-start justify-between` — title/subtitle left, gear icon right.

### P6-ADMIN-SLUG-INDEX-v1

- Purpose: Add `/admin/[slug]` landing page as gear icon destination and commissioner entry point. Move Win Totals to platform admin.
- Scope: `src/app/admin/[slug]/page.tsx` (new), `src/app/admin/[slug]/win-totals/page.tsx` (replaced with redirect), `src/app/admin/page.tsx` (Data Cache card desc update).
- Notes: `/admin/[slug]` renders three commissioner tool cards (Roster, Draft, Data). `/admin/[slug]/win-totals` redirects to `/admin/data/cache`. Data Cache card desc updated to include schedule, scores, and historical data.

### P6-ADMIN-POLISH-CLOSEOUT-v1

- Purpose: Register Phase 6 admin polish prompt IDs and update planning docs.
- Scope: `docs/prompt-registry.md`, `docs/completed-work.md`, `docs/next-tasks.md`. No code changes.
- Notes: Intermediate closeout after initial polish pass; superseded by P6-FINAL-CLOSEOUT-v1 for final documentation.

### P6-ADMIN-POLISH-FIX-REVIEW-v1

- Purpose: Read-only review of P6-ADMIN-POLISH-FIX-v1 implementation. No changes.
- Scope: Read-only. All files modified in admin polish fix.
- Notes: All items pass. Recommendation: merge.

### P6-ADMIN-POLISH-FIX-v1

- Purpose: Remove `useAuth()` from `CFBScheduleApp`, lift auth check to server component parents, add `isAdmin` prop.
- Scope: `src/components/CFBScheduleApp.tsx`, `src/app/league/[slug]/page.tsx`, `src/app/league/[slug]/matchups/page.tsx`, `src/app/league/[slug]/schedule/page.tsx`, `src/app/league/[slug]/standings/page.tsx`.
- Notes: `isAdmin` derived via `auth()` from `@clerk/nextjs/server` in each server component parent; cast pattern for `sessionClaims.publicMetadata.role`. No Clerk hooks in `CFBScheduleApp`.

### P6-ADMIN-POLISH-REVIEW-v1

- Purpose: Read-only review of P6-ADMIN-POLISH-v1 implementation. No changes.
- Scope: Read-only. All files modified in admin polish pass.
- Notes: Found `useAuth()` usage in `CFBScheduleApp` violating auth architecture invariant. Addressed by P6-ADMIN-POLISH-FIX-v1.

### P7A-1-FOUNDED-YEAR-v1

- Purpose: Add foundedYear to league data model, settings form, and History page subtitle.
- Scope: `src/lib/league.ts`, league API routes, `LeagueSettingsForm.tsx`, `LeaguePageShell.tsx`, `history/page.tsx`.
- Notes: Optional field, auto-populated on creation. PRs #252–#253.

### P7A-2-LEAGUE-HUB-STATUS-v1

- Purpose: Surface LeagueStatusPanel and setup checklist on league hub, restore Settings card, add post-creation redirect.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/[slug]/page.tsx`, `src/app/admin/leagues/page.tsx`.
- Notes: PR #255.

### P7A-3-ADMIN-POLISH-v1

- Purpose: Fix admin pages for light mode, link league names, remove redundant status panel from Data page.
- Scope: 8 admin page files + all 10 `src/components/admin/` components.
- Notes: PR #255.

### P7A-4

- Purpose: Promote aliases from league-scoped to platform-scoped storage and UI.
- Scope: New `src/app/admin/aliases/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/[slug]/page.tsx`, `src/app/admin/[slug]/data/page.tsx`.
- Notes: Uses existing `aliases:global` store. PR #256.

### P7A-CLOSEOUT

- Purpose: Update project docs to reflect Phase 7A completion.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.

### P6-ADMIN-POLISH-v1

- Purpose: Admin nav consistency, plain English copy, gear icon in league view header linking to `/admin/[slug]`.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/season/page.tsx`, `src/app/admin/diagnostics/page.tsx`, `src/app/admin/draft/page.tsx`, `src/app/admin/[slug]/layout.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/AdminUsagePanel.tsx`, `src/components/AdminTeamDatabasePanel.tsx`, `src/components/AdminStorageStatusPanel.tsx`, `src/components/ScoreAttachmentDebugPanel.tsx`, `src/components/admin/BackfillPanel.tsx`, `src/components/SpRatingsCachePanel.tsx`, `src/components/admin/HistoricalCachePanel.tsx`.
- Notes: Blue back links, `text-2xl font-semibold` titles, plain English copy on all panels. Gear icon via `useAuth()` — fixed in P6-ADMIN-POLISH-FIX-v1.

### P6E-CLOSEOUT-v1

- Purpose: Close out Phase 6E in planning docs and register all P6E prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6E complete. Phase 6 all subphases P6A–P6E done. Phase 7 queued.

### P6E-ROSTER-EDITOR-FIX-v1

- Purpose: Fix two bugs — year scope mismatch between panels, and naive CSV parser corrupting quoted fields on re-save.
- Scope: `src/app/admin/[slug]/roster/page.tsx`, `src/components/admin/RosterEditorPanel.tsx`.
- Notes: Bug 1: `roster/page.tsx` now uses `league.year` for both panels (removed `seasonYearForToday()` call). Bug 2: `parseCsvRow()` RFC 4180 state-machine parser replaces naive `indexOf(',')` split — handles quoted fields, `""` unescaping, mixed rows. `buildCsv()` escaping verified correct and left unchanged.

### P6E-ROSTER-EDITOR-REVIEW-v1

- Purpose: Read-only review of P6E-ROSTER-EDITOR-v1 implementation against specification. No changes.
- Scope: `src/components/admin/RosterEditorPanel.tsx`, `src/app/admin/[slug]/roster/page.tsx`.
- Notes: All checklist items pass. Recommendation: merge.

### P6E-ROSTER-EDITOR-v1

- Purpose: Implement RosterEditorPanel — direct CRUD interface for team-owner assignments per league.
- Scope: `src/components/admin/RosterEditorPanel.tsx` (new), `src/app/admin/[slug]/roster/page.tsx` (updated).
- Notes: `savedOwners`/`draftOwners` Map split for dirty tracking. RFC 4180 `buildCsv()`. Bulk reassign local-state only. Accessible at `/admin/[slug]/roster` alongside `RosterUploadPanel`.

### P6D-CLOSEOUT-v1

- Purpose: Close out Phase 6D in planning docs and register all P6D prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6D complete. P6E (Roster Editor) set as active focus.

### P6D-ADMIN-RESTRUCTURE-FIX-REVIEW-v1

- Purpose: Read-only review of P6D-ADMIN-RESTRUCTURE-FIX-v1. No changes.
- Scope: `src/app/api/admin/leagues/route.ts`, `src/app/admin/data/page.tsx`. All items pass.
- Notes: Recommendation: merge.

### P6D-ADMIN-RESTRUCTURE-FIX-v1

- Purpose: Fix two bugs from code review — reserve admin route slugs in league creation, and restore `/admin/data` as a real league selector page.
- Scope: `src/app/api/admin/leagues/route.ts`, `src/app/admin/data/page.tsx`.
- Notes: `RESERVED_ADMIN_SLUGS` Set enforces six blocked slugs in `POST /api/admin/leagues`. `/admin/data` now auto-redirects for single league, shows card grid for multiple leagues, links to `/admin/leagues` when empty.

### P6D-ADMIN-RESTRUCTURE-REVIEW-v1

- Purpose: Read-only review of P6D-ADMIN-RESTRUCTURE-v1. No changes.
- Scope: All eight changed admin files. All items pass.
- Notes: One non-blocking observation: `external: true` field on draft tool entry is declared but never read — harmless. Recommendation: merge.

### P6D-ADMIN-RESTRUCTURE-v1

- Purpose: Restructure `/admin` landing into Platform Admin and per-league Commissioner buckets. Create league-scoped admin routes.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/draft/page.tsx`, `src/app/admin/data/page.tsx`, `src/app/admin/data/cache/page.tsx` (new), `src/app/admin/[slug]/layout.tsx` (new), `src/app/admin/[slug]/roster/page.tsx` (new), `src/app/admin/[slug]/win-totals/page.tsx` (new), `src/app/admin/[slug]/data/page.tsx` (new).
- Notes: Named routes take precedence over `[slug]` — no collisions. Commissioner buckets derived from `getLeagues()` at runtime. Phase 7 prerequisite satisfied.

### P6-CLERK-FIXES-CLOSEOUT-v1

- Purpose: Document Clerk session token configuration requirement and register all P6 fix prompt IDs from the P6A/P6B/P6C debugging session.
- Scope: `docs/phase-6-admin-auth-design.md`, `docs/completed-work.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Session 9 added to design doc covering Clerk session token customization requirement. JWT templates confirmed as wrong approach. currentUser() confirmed as unusable in middleware.

### P6C-DEBUG-CLEANUP-v1

- Purpose: Remove debug `console.log` from `page.tsx` added during owner count diagnosis.
- Scope: `src/app/page.tsx` only.
- Notes: Cleanup after P6C-OWNER-COUNT-DEBUG-v2 diagnosis.

### P6C-OWNER-SCOPE-AUDIT-v1

- Purpose: Read-only audit to find the exact appStateStore scope and key where the TSC 2025 owner CSV is stored.
- Scope: `src/app/api/owners/route.ts`, `src/lib/server/appStateStore.ts`. No changes.
- Notes: Confirmed scope is `owners:${slug}:${year}`, key is `csv`. Identified that CSV uploaded without `?league=` goes to wrong scope `owners:${year}`. `ownersScope()` helper exists in route.ts only.

### P6C-OWNER-COUNT-DEBUG-v2

- Purpose: Add temporary debug log to `page.tsx` to surface what appStateStore returns when reading the owner CSV.
- Scope: `src/app/page.tsx` only. Temporary diagnostic.
- Notes: Logged slug, activeYear, scope key, hasRecord, valueLength, valuePreview. Removed in P6C-DEBUG-CLEANUP-v1.

### P6C-OWNER-COUNT-DEBUG-v1

- Purpose: Add temporary debug logging to investigate owner count returning 0 for TSC league.
- Scope: `src/app/page.tsx` only. Temporary diagnostic.
- Notes: Earlier iteration of debug log; superseded by P6C-OWNER-COUNT-DEBUG-v2.

### P6C-OWNER-COUNT-FIX-v3

- Purpose: Fix owner count — use `seasonYearForToday()` instead of `league.year` to match the scope key used when the CSV was uploaded.
- Scope: `src/app/page.tsx` only.
- Notes: `league.year` may differ from the active CFB season year. `seasonYearForToday()` matches the year used during upload via the admin panel.

### P6C-OWNER-COUNT-FIX-v2

- Purpose: Iteration on owner count fix.
- Scope: `src/app/page.tsx` only.
- Notes: Intermediate fix; superseded by P6C-OWNER-COUNT-FIX-v3.

### P6B-ROSTER-UPLOAD-FIX-REVIEW-v1

- Purpose: Read-only review of P6B-ROSTER-UPLOAD-FIX-v2 implementation. No changes.
- Scope: `src/components/admin/RosterUploadPanel.tsx`. All checklist items pass.
- Notes: allResolved requires every needsConfirmation item resolved — correct, intentional. Recommendation: merge.

### P6B-ROSTER-UPLOAD-FIX-v2

- Purpose: Fix two bugs in admin RosterUploadPanel — add validation pipeline and sync year on league change.
- Scope: `src/components/admin/RosterUploadPanel.tsx` only.
- Notes: Bug 1: replaced direct PUT with POST to `/api/owners/validate` then PUT resolved CSV. Bug 2: `handleLeagueChange()` sets year to `league.year ?? seasonYearForToday()`.

### P6B-ROSTER-UPLOAD-FIX-v1

- Purpose: Add dedicated `RosterUploadPanel` to `/admin/data` — league/year scoped, writes to correct appStateStore key.
- Scope: `src/components/admin/RosterUploadPanel.tsx` (new), `src/app/admin/data/page.tsx`.
- Notes: Initial version used direct PUT without validation. Fixed in P6B-ROSTER-UPLOAD-FIX-v2.

### P6B-BACKFILL-FIX-REVIEW-v1

- Purpose: Read-only review of P6B-BACKFILL-FIX-v1 implementation. No changes.
- Scope: `src/components/admin/BackfillPanel.tsx`. All checklist items pass.
- Notes: Recommendation: merge.

### P6B-BACKFILL-FIX-v1

- Purpose: Fix backfill flow — terminal on first write, confirm only when requiresConfirmation returned.
- Scope: `src/components/admin/BackfillPanel.tsx` only.
- Notes: Fixed premature confirm prompt on first-time backfill.

### P6A-CLERK-MIDDLEWARE-DEBUG-v1

- Purpose: Add temporary debug logging to middleware to see sessionClaims contents when hitting /admin.
- Scope: `src/middleware.ts` only. Temporary diagnostic.
- Notes: Logged userId, full sessionClaims, and both role key paths. Confirmed publicMetadata absent without session token customization.

### P6A-CLERK-MIDDLEWARE-FIX-v4

- Purpose: Revert to `auth()`/`sessionClaims` approach — correct for Clerk v7 once session token is customized.
- Scope: `src/middleware.ts`, `src/lib/server/adminAuth.ts`.
- Notes: currentUser() cannot be used in middleware. auth() + sessionClaims.publicMetadata.role is correct once session token includes publicMetadata claim.

### P6A-CLERK-MIDDLEWARE-FIX-v3

- Purpose: Wrap `currentUser()` calls in try/catch for Clerk backend resilience.
- Scope: `src/middleware.ts` only.
- Notes: Intermediate fix during currentUser() exploration; superseded by P6A-CLERK-MIDDLEWARE-FIX-v4 revert.

### P6A-CLERK-MIDDLEWARE-FIX-v2

- Purpose: Switch to `currentUser()` for publicMetadata role check — exploration of alternative approach.
- Scope: `src/middleware.ts`, `src/lib/server/adminAuth.ts`.
- Notes: Ultimately reverted — currentUser() cannot be called in middleware context.

### P6A-CLERK-MIDDLEWARE-FIX-v1

- Purpose: Update middleware and adminAuth to read `public_metadata` instead of `publicMetadata` — matching JWT template claim key.
- Scope: `src/middleware.ts`, `src/lib/server/adminAuth.ts`.
- Notes: Later determined JWT templates are the wrong approach. Superseded by P6A-CLERK-MIDDLEWARE-FIX-v4.

### P6A-CLERK-ROUTE-FIX-v1

- Purpose: Fix login page — add catch-all route `[[...sign-in]]` and required `routing="path"` / `path="/login"` props.
- Scope: `src/app/login/` route structure and `page.tsx`.
- Notes: Multi-step Clerk auth flows require catch-all slug. Static route breaks after step 1.

### P6A-CLERK-REQUIREMENTS-AUDIT-v1

- Purpose: Audit Clerk configuration requirements — identify gaps between implementation and Clerk v7 requirements.
- Scope: Read-only audit. No changes.
- Notes: Identified session token customization requirement and login route catch-all requirement.

### P6C-OWNER-COUNT-FIX-v1

- Purpose: Fix owner count derivation — count distinct owner values from CSV rather than raw row count.
- Scope: `src/app/page.tsx` only.
- Notes: CSV format is `team,owner` (one row per team assignment). Previous `rows.length - 1` returned team count. Fix splits each data line at first comma, collects owner column values into a `Set<string>`, returns `Set.size`. Malformed rows and empty owner fields skipped gracefully.

### P6C-CLOSEOUT-v1

- Purpose: Close out Phase 6C and Phase 6 overall in planning docs, register all P6C prompt IDs, set Phase 7 as next focus.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Phase 6 (P6A–P6C) fully complete. Phase 7 — Commissioner Self-Service is next planned campaign.

### P6C-LANDING-POLISH-REVIEW-v1

- Purpose: Read-only review of P6C-LANDING-POLISH-v1 implementation. No changes.
- Scope: `src/app/page.tsx`, `src/components/RootPageClient.tsx`. All checklist items pass.
- Notes: Redirect audit confirmed clean across all five audited files. All seven E2E auth flows verified correct in code. Recommendation: merge.

### P6C-LANDING-POLISH-v1

- Purpose: Polish public landing page, add live stats to admin dashboard league cards, audit redirects, validate E2E auth flows.
- Scope: `src/app/page.tsx`, `src/components/RootPageClient.tsx`. No other files.
- Notes: Owner count fetched server-side from `appStateStore` CSV per league — fails gracefully to `null`. League cards split into name/meta/View League/Draft Setup links. "Add League" footer link added. Empty state links to `/admin/leagues`. "Commissioner login" label used on public landing. No hardcoded slugs found in any audited file.

### P6B-CLOSEOUT-v1

- Purpose: Close out Phase 6B in planning docs and register all P6B prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6B fully complete. P6C (Root Route and Landing Page Polish) set as active focus.

### P6B-ADMIN-RESTRUCTURE-FIX-v1

- Purpose: Create `HistoricalCachePanel` and update `/admin/data` page to fill the historical cache tools gap identified in review.
- Scope: `src/components/admin/HistoricalCachePanel.tsx` (new), `src/app/admin/data/page.tsx` (make async, add `getLeagues()`, render panel).
- Notes: Fills pre-existing gap — `cache-historical-schedule` and `cache-historical-scores` routes had no UI. Panel has independent loading/error state per button; year input defaults to current year − 1.

### P6B-ADMIN-RESTRUCTURE-REVIEW-v1

- Purpose: Read-only review of P6B-ADMIN-RESTRUCTURE-v1 implementation against specification. No changes.
- Scope: All P6B files — `/admin/page.tsx`, sub-pages, new panel components, `CFBScheduleApp.tsx` modifications. Most items pass; historical cache tools identified as PARTIAL (no UI).
- Notes: Fix tracked as P6B-ADMIN-RESTRUCTURE-FIX-v1. Recommendation: merge with fix applied.

### P6B-ADMIN-RESTRUCTURE-v1

- Purpose: Full admin page restructure — navigation-only `/admin` landing, five sub-pages, new server/client panel components, remove Admin/Debug from league view.
- Scope: `src/app/admin/page.tsx`, `src/app/admin/draft/page.tsx` (new), `src/app/admin/data/page.tsx` (new), `src/app/admin/season/page.tsx` (new), `src/app/admin/diagnostics/page.tsx` (new), `src/components/admin/DraftSequencingPanel.tsx` (new), `src/components/admin/BackfillPanel.tsx` (new), `src/components/admin/ArchiveListPanel.tsx` (new), `src/components/admin/DiagnosticsScorePanel.tsx` (new), `src/components/CFBScheduleApp.tsx`, `src/lib/adminAuth.ts`.
- Notes: `requireAdminAuthHeaders()` fixed to return `{}` instead of throwing when no token — Clerk session cookie handles auth. `DraftSequencingPanel` is server component using `getAppState` directly.

### P6A-CLOSEOUT-v1

- Purpose: Close out Phase 6A in planning docs and register all P6A prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P6A fully complete. PR #216 open. P6B set as active focus.

### P6A-CLERK-AUTH-FIX-v1

- Purpose: Add `.npmrc` with `legacy-peer-deps=true` to resolve Vercel deployment peer dependency conflict between `@clerk/nextjs@7.0.8` and `react@19.1.0`.
- Scope: `.npmrc` (new file, project root only). No other changes.

### P6A-CLERK-AUTH-REVIEW-v1

- Purpose: Read-only review of P6A-CLERK-AUTH-v1 implementation against specification. No changes.
- Scope: `middleware.ts`, `layout.tsx`, `login/page.tsx`, `page.tsx`, `RootPageClient.tsx`, `server/adminAuth.ts`, 25 API route files. All checklist items pass.
- Notes: One non-blocking observation — `requireAdminAuth` returns `Response | null` (drop-in compatible) rather than `{ authorized, method }` struct described in spec. Correct engineering tradeoff. Recommendation: merge.

### P6A-CLERK-AUTH-v1

- Purpose: Install and configure Clerk auth — middleware, login page, root route replacement, `requireAdminAuth()` helper, update all 25 API route call sites.
- Scope: `package.json`, `src/middleware.ts` (new), `src/app/layout.tsx`, `src/app/login/page.tsx` (new), `src/app/page.tsx`, `src/components/RootPageClient.tsx` (new), `src/lib/server/adminAuth.ts`, 25 API route files.
- Notes: `clerkMiddleware()` protects `/admin/*`. `<Show when="signed-in/out">` used throughout. `requireAdminRequest` retained as deprecated async alias — remove in Phase 7. `.npmrc` added in follow-up fix for Vercel peer dep resolution.

### P5D-CLOSEOUT-v1

- Purpose: Close out Phase 5D and Phase 5 overall in planning docs, register all P5D prompt IDs, archive Phases 1–3 entries, and set Phase 6 as active focus.
- Scope: `docs/completed-work.md`, `docs/completed-work-archive.md` (new), `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Phase 5 (P5A–P5D) fully complete. Phases 1–3 entries moved verbatim to archive file. Phase 6 — Admin Cleanup and Auth is next planned campaign.

### P5D-DRAFT-REOPEN-REVIEW-v1

- Purpose: Read-only review of P5D-DRAFT-REOPEN-v1 implementation. No changes.
- Scope: `confirm/route.ts` (DELETE handler), `DraftSummaryClient.tsx` (reopen button). All items pass.
- Notes: One non-blocking observation: `reopenLoading` not reset on success path — harmless because Reopen section unmounts immediately when `setDraft()` flips phase away from `complete`. Recommendation: merge.

### P5D-DRAFT-REOPEN-v1

- Purpose: Add reopen endpoint (DELETE) and Reopen Draft button to allow commissioner to re-open a confirmed draft for corrections.
- Scope: `src/app/api/draft/[slug]/[year]/confirm/route.ts` (new DELETE handler), `src/components/draft/DraftSummaryClient.tsx` (reopen state + handler + UI section). No other files.
- Notes: DELETE validates `phase === 'complete'`, sets phase to `live`, preserves picks and existing owner CSV. Reopen dialogue warns previous rosters remain in effect until re-confirm. Confirm section conditioned on `phase !== 'complete'`; Reopen section conditioned on `phase === 'complete'`.

### P5D-DRAFT-SUMMARY-FIX-REVIEW-v1

- Purpose: Read-only review of P5D-DRAFT-SUMMARY-FIX-v1 implementation. No changes.
- Scope: `confirm/route.ts`. All items pass.
- Notes: One non-blocking edge case noted — zero-owner draft produces `teamsPerOwner: Infinity`, unreachable in practice. Recommendation: merge.

### P5D-DRAFT-SUMMARY-FIX-v1

- Purpose: Fix two bugs — partial-draft confirmation allowed, and CSV fields with embedded double quotes not properly escaped.
- Scope: `src/app/api/draft/[slug]/[year]/confirm/route.ts` only. No other files.
- Notes: Pick count validation replaced phase+non-empty check with runtime FBS count derivation. `csvField()` RFC 4180 helper added — quotes and escapes all edge cases.

### P5D-DRAFT-SUMMARY-REVIEW-v1

- Purpose: Read-only review of P5D-DRAFT-SUMMARY-v1 implementation against specification. No changes.
- Scope: `confirm/route.ts`, `summary/page.tsx`, `DraftSummaryClient.tsx`, `InterestingFactsPanel.tsx`, `draft/page.tsx`. All items pass.
- Notes: One minor deviation — admin redirect goes to `/league/${slug}/draft` (commissioner board) not `/draft/setup`; consistent with P5C pattern, correct behavior. Recommendation: merge.

### P5D-DRAFT-SUMMARY-v1

- Purpose: Implement Phase 5D — confirm endpoint, summary page, DraftSummaryClient, InterestingFactsPanel, draft board Summary link.
- Scope: `src/app/api/draft/[slug]/[year]/confirm/route.ts` (new), `src/app/league/[slug]/draft/summary/page.tsx` (new), `src/components/draft/DraftSummaryClient.tsx` (new), `src/components/draft/InterestingFactsPanel.tsx` (new), `src/app/league/[slug]/draft/page.tsx` (modified).
- Notes: Confirm writes to `owners:${slug}:${year}` scope, `csv` key — matches existing upload route. Facts derived server-side; only `string[]` passed to client. Admin gate is client-side only (sessionStorage not server-readable).

### P5C-CLOSEOUT-AND-P5D-KICKOFF-v1

- Purpose: Close out Phase 5C in planning docs, register all P5C prompt IDs, and open Phase 5D with full task detail.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P5C fully complete. P5D (Draft Summary and Confirmation) is active focus.

### P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v2

- Purpose: Read-only review of P5C-LIVE-DRAFT-BOARD-FIX-v3 implementation. No changes.
- Scope: `route.ts`, `DraftBoardClient.tsx`, `draft/page.tsx`. All four fixes confirmed passing.
- Notes: All items pass. One non-blocking observation: non-200 expire response leaves ref set, but 1s polling recovers state. Recommendation: merge.

### P5C-LIVE-DRAFT-BOARD-FIX-v3

- Purpose: Fix four bugs — expire validation, client-side expiry dispatch, server-safe alias loading, auto-pick metric.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts`, `src/components/draft/DraftBoardClient.tsx`, `src/app/league/[slug]/draft/page.tsx`. No other files.
- Notes: B1 — expire accepted from `paused+expired`; `effectiveBehavior` always forces auto-pick in that state. B2 — client dispatches `timerAction: expire` when countdown reaches zero; `expireDispatchedRef` guards double-dispatch; polling effect moved before early return (hooks ordering fix). B3 — `loadAliasMap()` replaced with `appStateStore` reads of global + league-scoped alias maps merged with SEED_ALIASES. B4 — auto-pick branches on `autoPickMetric`: SP+ desc or preseason rank asc; falls back to alphabetical.

### P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v1

- Purpose: Read-only review of P5C-LIVE-DRAFT-BOARD-FIX-v1 implementation. No changes.
- Scope: All seven FIX-v1 files. All nine findings confirmed passing.
- Notes: One checklist wording discrepancy (F2 said `/draft/setup`, correct target is `/draft/board`). One stale JSDoc noted (fixed in FIX-v2). Recommendation: merge.

### P5C-LIVE-DRAFT-BOARD-FIX-v2

- Purpose: Fix stale JSDoc comment in reset route — said "return to preview phase", now says "return to setup phase".
- Scope: `src/app/api/draft/[slug]/[year]/reset/route.ts` only — one line.
- Notes: Comment-only fix; no runtime impact.

### P5C-LIVE-DRAFT-BOARD-FIX-v1

- Purpose: Fix all nine review findings from P5C-LIVE-DRAFT-BOARD-REVIEW-v1 before merge.
- Scope: 7 files — `reset/route.ts`, `draft/page.tsx`, `DraftBoardClient.tsx`, `PickNavigator.tsx`, `pick/route.ts`, `pick/[n]/route.ts`, `route.ts` (main draft PUT).
- Notes: F1 reset phase, F2 auth redirect, F3 preview redirect, F4 hide drafted teams, F5 post-reset redirect, F6 previous pick display, F7 prior year data, F8 identity resolver, F9 expire guards.

### P5C-LIVE-DRAFT-BOARD-REVIEW-v1

- Purpose: Read-only review of P5C-LIVE-DRAFT-BOARD-v1 implementation against spec. No changes.
- Scope: All P5C new and modified files. Nine findings (F1–F9) reported.
- Notes: Read-only. All findings addressed in P5C-LIVE-DRAFT-BOARD-FIX-v1.

### P5C-LIVE-DRAFT-BOARD-v1

- Purpose: Implement the live draft board — pick endpoints, timer actions, commissioner and spectator views, seven UI components.
- Scope: 4 new API routes (`pick`, `unpick`, `pick/[n]`, `reset`), PUT timer extension, 2 page routes, 7 components, redirect TODO fix in 2 existing components.
- Notes: Branch `claude/improve-thread-speed-v1YFg`. Review findings fixed in P5C-LIVE-DRAFT-BOARD-FIX-v1.

### P5B-CLOSEOUT-v1

- Purpose: Close out Phase 5B in planning docs, register all P5B prompt IDs, and flag the P5C redirect TODO items.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P5B fully complete. P5C (Live Draft Board) is active focus. Redirect TODO: four occurrences in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` point to `/draft/setup` temporarily — must be updated to `/draft` as P5C first task.

### P5B-DRAFT-SETUP-FIX-v4

- Purpose: Fix two bugs — redirects targeting non-existent `/draft` route (pre-P5C) and preview→settings phase not persisted via API.
- Scope: `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/DraftSetupShell.tsx`.
- Notes: PR #211. DraftSettingsPanel redirects changed from `/draft` to `/draft/setup` for live and preview transitions. DraftSetupShell: "Start Draft" and "Go to Draft Board" redirects updated; "Back to Settings" button replaced client-only state flip with API PUT call, preserving server-side phase state.

### P5B-DRAFT-SETUP-FIX-v3

- Purpose: Fix build error — `ownerSet.size` reference remaining after `ownerSet` variable removal.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts` only.
- Notes: PR #211. `ownerSet.size` → `ownerNames.length` on the `setsMatch` line.

### P5B-DRAFT-SETUP-FIX-v2

- Purpose: Remove dead code — unused `ownerSet` variable in draftOrder cross-validation.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts` only.
- Notes: PR #211. One-line removal; validation logic unchanged.

### P5B-DRAFT-SETUP-FIX-REVIEW-v1

- Purpose: Verify all six fixes from P5B-DRAFT-SETUP-FIX-v1 are correctly implemented. Read-only.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts`, `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/RosterSetupPanel.tsx`. No changes.
- Notes: All six fixes verified pass. One dead code observation (unused `ownerSet`) flagged and addressed in FIX-v2/v3.

### P5B-DRAFT-SETUP-FIX-v1

- Purpose: Fix all six findings from P5B-DRAFT-SETUP-REVIEW-v1 — GET 404, POST settings acceptance and validation, POST preview promotion, draftOrder cross-validation, preview redirect, and empty owner list initialization.
- Scope: `src/app/api/draft/[slug]/[year]/route.ts`, `src/components/draft/DraftSettingsPanel.tsx`, `src/components/draft/RosterSetupPanel.tsx`.
- Notes: PR #211. GET returns 404 (not 200+null) when no draft; POST accepts/validates full settings object; POST promotes to 'preview' on future scheduledAt; draftOrder cross-validated against owners set; preview transition redirects to /draft/setup; RosterSetupPanel initialises to [] with empty-state message.

### P5B-DRAFT-SETUP-REVIEW-v1

- Purpose: Review P5B-DRAFT-SETUP-v1 implementation against specification before merging. Read-only.
- Scope: All P5B new files. No changes.
- Notes: Identified six findings: GET 200+null vs 404, POST ignoring settings, POST not promoting to preview, no draftOrder validation, preview redirect staying in-page, empty list `['']` initialisation. All addressed in FIX-v1.

### P5B-DRAFT-SETUP-v1

- Purpose: Implement Phase 5B — draft API route, setup page, roster and settings panels, Draft tab in navigation.
- Scope: `src/lib/draft.ts` (new), `src/app/api/draft/[slug]/[year]/route.ts` (new), `src/app/league/[slug]/draft/setup/page.tsx` (new), `src/components/draft/DraftSetupShell.tsx` (new), `src/components/draft/RosterSetupPanel.tsx` (new), `src/components/draft/DraftSettingsPanel.tsx` (new), `src/components/WeekViewTabs.tsx`.
- Notes: PR #211. DraftState/DraftSettings/DraftPick types in shared lib. Server-side phase transition validation. Prior year archive auto-population. FBS-based round auto-suggest.

### P5A-CLOSEOUT-v1

- Purpose: Close out Phase 5A in planning docs and register all P5A prompt IDs.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: P5A fully complete. P5B (Draft Setup and Settings) is active focus.

### P5A-IDENTITY-FIX-v1

- Purpose: Fix team name resolution in draftTeamInsights selector and win total upload — canonicalize provider names via teams.json alts[] in selector; replace direct string matching with createTeamIdentityResolver in win-totals route.
- Scope: `src/lib/selectors/draftTeamInsights.ts`, `src/app/api/admin/win-totals/route.ts`.
- Notes: PR #210. Selector uses providerToCanonical map from alts[]; win-totals route uses SEED_ALIASES + stored alias map merged, same pattern as odds/route.ts. No new matching logic.

### P5A-DRAFT-DATA-INFRA-REVIEW-v1

- Purpose: Review P5A implementation against spec; fix lastSeasonRecord (always-null deferred field) before merge.
- Scope: Read-only review + targeted fix to `src/lib/selectors/draftTeamInsights.ts`.
- Notes: PR #210. Added priorYearGames + priorYearScoresByKey optional params; computes W-L records following historySelectors.ts pattern. Removed unused percentileThreshold helper.

### P5A-DRAFT-DATA-INFRA-v1

- Purpose: Implement Phase 5A draft data infrastructure — SP+ cache endpoint, win total CSV upload, draftTeamInsights selector, DraftCard component, admin UI triggers.
- Scope: `src/lib/cfbd.ts`, `src/app/api/admin/cache-sp-ratings/route.ts` (new), `src/app/api/admin/win-totals/route.ts` (new), `src/lib/selectors/draftTeamInsights.ts` (new), `src/components/draft/DraftCard.tsx` (new), `src/components/SpRatingsCachePanel.tsx` (new), `src/components/WinTotalsUploadPanel.tsx` (new), `src/app/admin/page.tsx`.
- Notes: PR #210. Pure selector pattern; awaiting-ratings status for pre-season SP+ calls; DraftCard absent-means-absent design.

### P4D-CLOSEOUT-v2

- Purpose: Close any gaps between the organic session closeout and formal spec — rename completed-work entry, add P4-BACKFILL-v1 and remove P4D-HISTORY-POLISH-REVIEW-v1 from PROMPT_IDs, add backfill bullet, add roadmap subphase entry, update next-tasks Phase 5 first task, register P4D-CLOSEOUT-v2.
- Scope: `docs/completed-work.md`, `docs/roadmap.md`, `docs/next-tasks.md`, `docs/prompt-registry.md`. No code changes.
- Notes: Phase 4 fully complete including all polish and backfill work. Phase 5 active focus with design scoping as first step.

### P4D-NOCLAIM-FIX-v1

- Purpose: Fix selectOwnerCareer NoClaim early return — remove it so archived season data is preserved; add explicit NoClaim guard in H2H opponent aggregation loop.
- Scope: `src/lib/selectors/historySelectors.ts` only.
- Notes: PR #207. selectOwnerCareer now returns real data for NoClaim; NoClaim excluded from H2H matrix only. All other NoClaim exclusions unchanged.

### P4D-HISTORY-BANNER-v1

- Purpose: Add "Season in Progress" card to ChampionshipsBanner showing current season leader when active season is not yet archived.
- Scope: `src/components/history/ChampionshipsBanner.tsx` (new props + card), `src/app/league/[slug]/history/page.tsx` (pass props).
- Notes: PR #207. Neutral gray/white border distinct from amber champion card. "Current Leader" label. Derives first non-NoClaim owner from liveStandings. No card when props absent.

### P4D-HISTORY-LAYOUT-v1

- Purpose: Redesign history landing page to asymmetric 60/40 split using lg:grid-cols-5 with col-span-3/col-span-2.
- Scope: `src/app/league/[slug]/history/page.tsx` only.
- Notes: PR #207. ChampionshipsBanner remains full width above grid. Single column on mobile unchanged.

### P4D-HISTORY-POLISH-REVIEW-v1

- Purpose: Read-only review of P4D-HISTORY-POLISH-v1 implementation against specification.
- Scope: Read-only. All files modified by P4D-HISTORY-POLISH-v1.
- Notes: All items passed. One partial finding: ChampionshipsBanner renders full-width above grid rather than in left column per spec — accepted as better UX. Overall recommendation: Merge.

### P4D-HISTORY-POLISH-v1

- Purpose: Fix all-time standings sort order, remove NoClaim from all history views, redesign history landing to two-column layout, add League History nav tab, merge live season data into all-time standings.
- Scope: `src/lib/selectors/historySelectors.ts`, `src/components/history/AllTimeStandingsTable.tsx`, `src/app/league/[slug]/history/page.tsx`, `src/components/WeekViewTabs.tsx`, `src/components/CFBScheduleApp.tsx`.
- Notes: PR #207. winPct added to AllTimeStandingRow; sort: championships → winPct → totalWins. NoClaim excluded from 4 selectors. liveStandings optional param added to selectAllTimeStandings. History Link tab in WeekViewTabs via leagueSlug prop.

### P4-HISTORICAL-SCORES-CACHE-v1

- Purpose: Add POST /api/admin/cache-historical-scores — admin-gated, fetches and caches CFBD scores for a specified past year into the exact keys buildSeasonArchive reads.
- Scope: `src/app/api/admin/cache-historical-scores/route.ts` (new).
- Notes: PR #207. Writes scope=`scores`, keys=`${year}-all-regular` and `${year}-all-postseason`. alreadyCached when both keys exist. force: true to overwrite. Rejects active season year.

### P4-HISTORICAL-SCHEDULE-CACHE-v1

- Purpose: Add POST /api/admin/cache-historical-schedule — admin-gated, fetches and caches CFBD schedule for a specified past year into the exact key buildSeasonArchive reads.
- Scope: `src/app/api/admin/cache-historical-schedule/route.ts` (new).
- Notes: PR #207. Writes scope=`schedule`, key=`${year}-all-all`. alreadyCached check prevents quota waste. force: true to overwrite. Rejects active season year.

### P4D-CLOSEOUT-v1

- Purpose: Close out Phase 4D and Historical Season Backfill in planning docs; register all P4D and backfill prompt IDs; set Phase 5 as next planned campaign.
- Scope: docs only — completed-work.md, roadmap.md, next-tasks.md, prompt-registry.md. No code changes.
- Notes: Phase 4 fully complete. Phase 5 set as active focus.

### P4D-BUGS-v1

- Purpose: Fix two post-merge bugs: double-decoding URIError crash on owner route param, and rivalry lead/trail/tied label always showing ownerA regardless of record.
- Scope: `src/app/league/[slug]/history/owner/[name]/page.tsx` (remove double-decode), `src/components/history/AllTimeHeadToHeadPanel.tsx` (three-way leader label).
- Notes: Double-decode: Next.js App Router already decodes params — `decodeURIComponent` must not be applied again. Label fix: three-way conditional (ownerA leads / ownerB leads / series tied).

### P4D-BACKFILL-REVIEW-v1

- Purpose: Read-only review of P4D-LEAGUE-HISTORY-UI-FIX-v1 and P4-BACKFILL-v1 implementations against their specifications.
- Scope: Read-only. All P4D UI fix files and backfill endpoint.
- Notes: Found critical bug: `slug` declared in Props but not destructured in `AllTimeHeadToHeadPanel` — produced `/league/undefined/...` URLs. Addressed by P4D-LEAGUE-HISTORY-UI-FIX-v2.

### P4-BACKFILL-v1

- Purpose: Create `POST /api/admin/backfill` endpoint — admin-gated, builds and saves `SeasonArchive` for a specified past year, never calls `updateLeague`, two-phase confirmation when existing archive would be overwritten.
- Scope: `src/app/api/admin/backfill/route.ts` (new).
- Notes: Intentionally does NOT call `updateLeague` or advance the active season year. Two-phase: first call returns `requiresConfirmation: true` with diff; second call with `confirmed: true` performs overwrite.

### P4D-LEAGUE-HISTORY-UI-FIX-v2

- Purpose: Fix critical bug — `slug` was declared in `AllTimeHeadToHeadPanel` Props but omitted from component destructuring, producing `/league/undefined/history/owner/.../` URLs.
- Scope: `src/components/history/AllTimeHeadToHeadPanel.tsx` only — destructuring fix.
- Notes: PR #204. One-line fix caught in P4D-BACKFILL-REVIEW-v1.

### P4D-LEAGUE-HISTORY-UI-FIX-v1

- Purpose: Fix 5 review findings: missing career page Links in AllTimeHeadToHeadPanel, DynastyDroughtPanel, MostImprovedPanel; missing Games Back column in SeasonFinishHistory; wrong empty state copy on landing page.
- Scope: `src/components/history/AllTimeHeadToHeadPanel.tsx`, `src/components/history/DynastyDroughtPanel.tsx`, `src/components/history/MostImprovedPanel.tsx`, `src/components/history/SeasonFinishHistory.tsx`, `src/app/league/[slug]/history/page.tsx`.
- Notes: PR #204.

### P4D-LEAGUE-HISTORY-UI-REVIEW-v1

- Purpose: Read-only review of P4D-LEAGUE-HISTORY-UI-v1 implementation against detailed checklist.
- Scope: Read-only. All files created or modified by P4D-LEAGUE-HISTORY-UI-v1.
- Notes: Found 5 items requiring fixes — addressed by P4D-LEAGUE-HISTORY-UI-FIX-v1.

### P4D-LEAGUE-HISTORY-UI-v1

- Purpose: Implement League History landing page, Owner Career page, seven cross-season selectors, and back link update in history/[year]/page.tsx.
- Scope: `src/lib/selectors/historySelectors.ts` (7 new selectors + OwnerSeasonRecord.gamesBack), `src/app/league/[slug]/history/page.tsx` (new), `src/app/league/[slug]/history/owner/[name]/page.tsx` (new), `src/app/league/[slug]/history/[year]/page.tsx` (back link update), `src/components/history/` (9 new components).
- Notes: PR #204. Nine new history components: ChampionshipsBanner, AllTimeStandingsTable, SeasonListPanel, MostImprovedPanel, DynastyDroughtPanel, AllTimeHeadToHeadPanel, CareerSummaryCard, SeasonFinishHistory, AllTimeOwnerHeadToHeadPanel.

### P4D-KICKOFF-v1

- Purpose: Close out roster upload fuzzy matching in planning docs, register all prompt IDs, and set P4D as the active phase.
- Scope: docs only — completed-work.md, roadmap.md, next-tasks.md, prompt-registry.md. No code changes.
- Notes: Fuzzy matching complete. P4D kickoff.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v2

- Purpose: Fix two bugs from review: exhaustive alias migration across all league years via listAppStateKeys(), and persistent upload error display for auto-upload failures.
- Scope: `src/lib/server/globalAliasStore.ts` (migration year range + listAppStateKeys), `src/components/RosterUploadPanel.tsx` (phase-agnostic uploadError with retry button).
- Notes: PR #203.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v1

- Purpose: Wire lazy migrateYearScopedAliasesToGlobal() call in GET /api/aliases?scope=global so migration runs automatically on first global alias read after deploy.
- Scope: `src/app/api/aliases/route.ts` only — added getLeagues() call and migration invocation in the global scope GET branch.
- Notes: PR #203.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-REVIEW-v1

- Purpose: Read-only review of P4-ROSTER-UPLOAD-FUZZY-MATCH-v1 implementation against the prompt specification.
- Scope: Read-only. All files introduced or modified in the fuzzy matching implementation.
- Notes: One failure found: migrateYearScopedAliasesToGlobal() was unreachable (no call site). Addressed by FIX-v1. All other 38 items passed. Recommendation: fix before merge.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-v1

- Purpose: Add FBS-only fuzzy matching validation to the owner roster CSV upload pipeline.
- Scope: `src/lib/rosterUploadValidator.ts` (new), `src/lib/server/globalAliasStore.ts` (new), `src/app/api/owners/validate/route.ts` (new), `src/components/RosterUploadPanel.tsx` (new), `src/app/api/owners/route.ts` (PUT guard), `src/app/api/aliases/route.ts` (?scope=global), `src/app/admin/page.tsx` (RosterUploadPanel).
- Notes: PR #203.

### P4-ROSTER-UPLOAD-FUZZY-MATCH-DOCS-v1

- Purpose: Document the roster upload fuzzy matching design in planning docs and AGENTS.md before implementation.
- Scope: `docs/phase-4-historical-analytics-design.md` (§9 Roster Upload Validation), `AGENTS.md` (rule #10 upload-layer-only constraint). Docs only.
- Notes: PR #202.

### P4C-CLOSEOUT-v1

- Purpose: Update completed-work.md, roadmap.md, next-tasks.md, and prompt-registry.md to reflect P4C complete; register all P4C prompt IDs; set Roster Upload Fuzzy Matching as active next focus.
- Scope: docs only — no code changes.
- Notes: PR #201 closeout. Phase 4C complete.

### P4C-BUGS-v1

- Purpose: Fix three post-implementation bugs: exclude same-owner matchups from getOwnedFinalGames; fix back links pointing to unbuilt P4D route.
- Scope: `src/lib/selectors/historySelectors.ts` (same-owner guard in getOwnedFinalGames), `src/app/league/[slug]/history/[year]/page.tsx` (both back link instances).
- Notes: PR #201. Same-owner guard added to prevent self-blowouts/self-H2H contamination; back links changed to `/league/${slug}/` with TODO comments.

### P4C-LINT-FIX-v1

- Purpose: Investigate and remove unused `ownerB` variable assignment in selectHeadToHead.
- Scope: `src/lib/selectors/historySelectors.ts` only.
- Notes: PR #201. Confirmed not a logic bug — `pairingKey()` independently derives canonical ordering; assignment was dead code.

### P4C-ARCHIVE-DATA-MODEL-FIX-v2

- Purpose: Add `?? []` and `?? {}` null guards at both selector consumption points in historySelectors.ts for backward compatibility with legacy archives.
- Scope: `src/lib/selectors/historySelectors.ts` only — two call sites.
- Notes: PR #201. Prevents `TypeError: undefined is not iterable` when rendering archives written before games/scoresByKey fields were added.

### P4C-ARCHIVE-DATA-MODEL-FIX-REVIEW-v1

- Purpose: Read-only review of P4C-ARCHIVE-DATA-MODEL-FIX-v1 implementation — verify correctness and identify gaps.
- Scope: Read-only. `src/lib/seasonArchive.ts`, `src/lib/seasonRollover.ts`, `src/lib/selectors/historySelectors.ts`.
- Notes: Identified one critical gap — old archives with undefined games/scoresByKey would throw TypeError at runtime. Addressed by P4C-ARCHIVE-DATA-MODEL-FIX-v2.

### P4C-ARCHIVE-DATA-MODEL-FIX-v1

- Purpose: Add `games: AppGame[]` and `scoresByKey: Record<string, ScorePack>` to `SeasonArchive`; update `buildSeasonArchive` to populate both fields; rewrite superlative and H2H selectors to derive from game data.
- Scope: `src/lib/seasonArchive.ts`, `src/lib/seasonRollover.ts`, `src/lib/selectors/historySelectors.ts`.
- Notes: PR #201. Required because `StandingsHistory` stores cumulative per-owner stats only — no individual game pairings available from that model.

### P4C-SEASON-DETAIL-UI-v1

- Purpose: Implement `/league/[slug]/history/[year]/` season detail page with selectors, 6 history components, and server component page.
- Scope: `src/lib/selectors/historySelectors.ts` (new), `src/app/league/[slug]/history/[year]/page.tsx` (new), `src/components/history/` (6 new components: ArchiveBanner, FinalStandingsTable, SeasonArcChart, SuperlativesPanel, HeadToHeadPanel, OwnerRosterCard).
- Notes: PR #201. Initial implementation discovered StandingsHistory gap — follow-on P4C-ARCHIVE-DATA-MODEL-FIX-v1 added games/scoresByKey to SeasonArchive.

### P3-MULTILEG-CLOSEOUT-v1

- Purpose: Audit Phase 3 implementation against design doc, update planning docs to reflect Phase 3 complete, register all Phase 3 prompt IDs.
- Scope: docs only — completed-work.md, roadmap.md, next-tasks.md, prompt-registry.md, phase-3-multi-league-design.md.
- Notes: Phase 3 closeout. No code changes.

### P3-MULTILEG-FALLBACK-CLEANUP-v1

- Purpose: Remove now-redundant `readAliasesScopedOnly` function from aliases route — identical to `readAliases` after fallback removal.
- Scope: `src/app/api/aliases/route.ts` only.
- Notes: PR #196. Follow-on to P3-MULTILEG-FALLBACK-REMOVAL-v1.

### P3-MULTILEG-FALLBACK-REMOVAL-REVIEW-v1

- Purpose: Read-only verification that fallback removal is correct and scope helpers preserve the no-league-param path.
- Scope: Read-only. `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: All items passed. Flagged that `readAliasesScopedOnly` was now redundant — addressed by P3-MULTILEG-FALLBACK-CLEANUP-v1.

### P3-MULTILEG-FALLBACK-REMOVAL-v1

- Purpose: Remove temporary TRANSITION FALLBACK from all three durable data GET handlers after TSC migration confirmed complete.
- Scope: `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts` — GET handlers only.
- Notes: PR #196. No-league-param path unchanged on all three routes.

### P3-MULTILEG-ADMIN-UI-COPY-v1

- Purpose: Replace developer terminology with plain-language commissioner-facing copy on `/admin/leagues/`.
- Scope: `src/app/admin/leagues/page.tsx` only — copy and labels only.
- Notes: PR #195. Slug field relabeled "League URL", annotation updated to "(URL — permanent)", header description rewritten, empty state example year corrected to 2025.

### P3-MULTILEG-ADMIN-UI-FIX-v1

- Purpose: Improve empty state seed reminder to include example values for slug, display name, and year.
- Scope: `src/app/admin/leagues/page.tsx` only.
- Notes: PR #194. Empty state now includes: league URL — work-league, display name — Work League, year — 2025.

### P3-MULTILEG-ADMIN-UI-REVIEW-v1

- Purpose: Pre-merge review of P3-MULTILEG-ADMIN-UI-v1 implementation.
- Scope: Read-only. `src/app/admin/leagues/page.tsx`, `src/components/AdminDebugSurface.tsx`.
- Notes: One partial finding — empty state seed reminder lacked example values. Addressed by P3-MULTILEG-ADMIN-UI-FIX-v1.

### P3-MULTILEG-ADMIN-UI-v1

- Purpose: Create `/admin/leagues/` management page for commissioner to view, create, and edit leagues.
- Scope: `src/app/admin/leagues/page.tsx` (new), `src/components/AdminDebugSurface.tsx` (League Management link).
- Notes: PR #194. Reuses `AdminAuthPanel`, `requireAdminAuthHeaders`. Inline edit, create form with client-side slug validation.

### P3-MULTILEG-WRITE-SCOPE-REVIEW-v1

- Purpose: Read-only verification that write-scope fix correctly passes `leagueSlug` through all save functions.
- Scope: Read-only. API client functions and CFBScheduleApp save call sites.
- Notes: All items passed. Recommend merge.

### P3-MULTILEG-WRITE-SCOPE-FIX-v1

- Purpose: Fix write-path bug — save functions were not passing `leagueSlug` to API calls despite reads being league-scoped.
- Scope: `src/lib/aliasesApi.ts`, `src/lib/ownersApi.ts`, `src/lib/postseasonOverridesApi.ts`, `src/components/CFBScheduleApp.tsx`.
- Notes: PR #193. Establishes full read/write symmetry for all three durable data paths.

### P3-MULTILEG-ROUTING-FIX-REVIEW-v1

- Purpose: Read-only verification of routing fix — bootstrap chain threading and matchup href.
- Scope: Read-only. `src/components/CFBScheduleApp.tsx`, bootstrap chain files, `src/components/OverviewPanel.tsx`.
- Notes: All items passed. Recommend merge.

### P3-MULTILEG-ROUTING-FIX-v1

- Purpose: Thread `leagueSlug` through full bootstrap chain; restore `?view=matchups` on matchup insight links.
- Scope: `src/lib/bootstrap.ts`, `src/components/hooks/useScheduleBootstrap.ts`, `src/components/OverviewPanel.tsx`.
- Notes: PR #193. Bootstrap chain now complete: CFBScheduleApp → useScheduleBootstrap → bootstrapAliasesAndCaches → all three load functions.

### P3-MULTILEG-ROUTING-REVIEW-v1

- Purpose: Pre-merge review of P3-MULTILEG-ROUTING-v1 routing implementation.
- Scope: Read-only. All new league route files, root redirects, navigation components.
- Notes: Two findings: bootstrap chain not threaded end-to-end; matchup insight href missing `?view=matchups`. Both addressed by P3-MULTILEG-ROUTING-FIX-v1.

### P3-MULTILEG-ROUTING-v1

- Purpose: Implement `/league/[slug]/` route hierarchy; convert root routes to registry-based redirects; update navigation components.
- Scope: `src/app/league/[slug]/` (new pages), `src/app/page.tsx`, `src/app/standings/page.tsx`, `src/app/rankings/page.tsx`, `src/app/trends/page.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/OverviewPanel.tsx`, `src/components/RankingsPageContent.tsx`.
- Notes: PR #193. Root routes read registry at request time; redirect to first league's slug or render empty state if no leagues.

### P3-MULTILEG-FOUNDATION-FIX-v2

- Purpose: Fix malformed slug silent coercion bug and alias incremental merge inheritance bug.
- Scope: `src/app/api/aliases/route.ts` (readAliasesScopedOnly), `src/app/api/owners/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192. Added slug format validation to PUT routes. Introduced `readAliasesScopedOnly` to prevent new leagues inheriting legacy alias map on first incremental write.

### P3-MULTILEG-FOUNDATION-FIX-VERIFY-v1

- Purpose: Read-only verification that registry check is only in PUT (not GET) after FIX-v1 changes.
- Scope: Read-only. `src/app/api/admin/leagues/route.ts` only.
- Notes: Confirmed GET is public, PUT has registry validation. Verified correct.

### P3-MULTILEG-FOUNDATION-FIX-v1

- Purpose: Fix three pre-merge review findings — duplicate guard into `addLeague()`, GET leagues public, PUT registry validation.
- Scope: `src/lib/leagueRegistry.ts`, `src/app/api/admin/leagues/route.ts`, `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192.

### P3-MULTILEG-FOUNDATION-REVIEW-v1

- Purpose: Read-only pre-merge review of P3-MULTILEG-FOUNDATION-v1 storage layer implementation.
- Scope: Read-only. All files created or modified in foundation PR.
- Notes: Three findings addressed by P3-MULTILEG-FOUNDATION-FIX-v1.

### P3-MULTILEG-FOUNDATION-v1

- Purpose: Implement Phase 3 storage layer — `League` type, `leagueRegistry.ts`, admin API routes, updated durable-data routes with `?league=` support and TRANSITION FALLBACK.
- Scope: `src/lib/league.ts` (new), `src/lib/leagueRegistry.ts` (new), `src/app/api/admin/leagues/route.ts` (new), `src/app/api/admin/leagues/[slug]/route.ts` (new), `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192.

### P2-FOUNDATION-AUDIT-v1

- Purpose: Read-only codebase audit — reconcile actual implementation state against all planning documents and produce a structured markdown discrepancy report.
- Scope: Read-only. All planning docs + key source files. No code or document changes.
- Notes: Produced discrepancy report covering data pipeline, owner model, historical data, selector architecture, admin/persistence, and feature completeness. Findings used to drive post-audit doc updates.

### P2-OVR-TRENDS-LABELS-v1

- Purpose: Color-code delta panel owner names to match trend line colors; restore endpoint annotations (owner name + GB) on trend chart.
- Scope: `src/components/MiniTrendsGrid.tsx` (export CONTENDER_COLORS, restore annotation lane), `src/components/OverviewPanel.tsx` (PositionDeltaPanel seriesColors prop).
- Notes: Added to PR #188 branch. Merged as part of PR #188.

### P2-OVR-TRENDS-POLISH-v1

- Purpose: Fix chart label dead space; add meaningful postseason week labels (CCG, Bowl, CFP) instead of raw W17/W18 on x-axis.
- Scope: `src/components/MiniTrendsGrid.tsx` (label lane removal), `src/lib/weekLabel.ts` (new file), `src/components/OverviewPanel.tsx` (weekLabelFn via buildWeekLabelMap).
- Notes: Added to PR #188 branch. Merged as part of PR #188.

### P2-OVR-TRENDS-POSTSEASON-v1

- Purpose: Fix postseason week truncation in trend charts; replace W/L dots panel with week-over-week standings position change deltas.
- Scope: `src/lib/schedule.ts` (postseasonCanonicalWeek), `src/lib/selectors/trends.ts` (selectPositionDeltas), `src/components/OverviewPanel.tsx` (PositionDeltaPanel replaces RecentFormPanel).
- Notes: PR #188. Covers the three-commit sequence merged on phase-3b-visual-sweep.

### P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1

- Purpose: Fix standings sort to wins-first (primary) per league rules; add regression tests; realign docs to match.
- Scope: `src/lib/standings.ts` (sort comparator), `src/lib/__tests__/standings.test.ts` (three new regression tests), docs updates.
- Notes: PR #184. Corrected sort from winPct-first to wins-first with winPct/PD/PF tiebreakers.

### DOCS-CLAUDE-MD-BOOTSTRAP-v1

- Purpose: Create CLAUDE.md as a Claude Code-specific companion to AGENTS.md, establishing Claude's role, interaction preferences, and architectural guardrails without duplicating shared project operating content.
- Scope: `CLAUDE.md` (new file), `docs/prompt-registry.md` update only.
- Notes: Follow-on to DOCS-PHASE-RECONCILIATION-v1.

### P2D-TRENDS-FORM-DOTS-v1

- Purpose: Recent form dots panel — last-5-game W/L indicators using actual game scores, displayed alongside the title chase chart on the Overview Trends card.
- Scope: `src/components/OverviewPanel.tsx` (RecentFormPanel), `src/lib/selectors/trends.ts` (selectRecentOutcomes).
- Notes: Retroactively registered. Covers PR #183 on phase-3b-visual-sweep. Renamed from P3B-TRENDS-FORM-DOTS-v1 per DOCS-PHASE-RECONCILIATION-v1.

### DOCS-PHASE-RECONCILIATION-v1

- Purpose: Reconcile phase numbering across all project docs (3A/3B → 2C/2D), incorporate doc revisions, close duplication gaps.
- Scope: docs only — AGENTS.md, docs/roadmap.md, docs/next-tasks.md, docs/completed-work.md, docs/prompt-registry.md, docs/cfb-engineering-operating-instructions.md, docs/vision.md.
- Notes: Active. Single-commit docs reconciliation pass.

---

## Retroactively Registered Prompts

### P2D-TRENDS-TITLE-CHASE-v1

- Purpose: MiniTrendsGrid — compact SVG title chase chart (top-5 contenders, Games Back) for Overview Trends card. Iterated through viewBox fix, inline labels, bump chart, and final title chase framing.
- Scope: `src/components/MiniTrendsGrid.tsx`, `src/components/OverviewPanel.tsx`, `src/lib/selectors/trends.ts`.
- Notes: Retroactively registered. Covers PRs #178–#182. Renamed from P3B-TRENDS-TITLE-CHASE-v1 per DOCS-PHASE-RECONCILIATION-v1.

### P2C-OVERVIEW-REDESIGN-v1

- Purpose: Phase 2C visual redesign — champion podium hero, Rankings tab, app-wide palette and layout sweep, and Trends section restructure (removed TrendsDetailSurface from Overview).
- Scope: `src/components/OverviewPanel.tsx`, `src/components/MiniTrendsGrid.tsx` (initial), `src/app/trends/`.
- Notes: Retroactively registered. Covers PRs #173–#177. Renamed from P3A-OVERVIEW-REDESIGN-v1 per DOCS-PHASE-RECONCILIATION-v1.

### P2B-OVERVIEW-UX-CAMPAIGN-v1

- Purpose: Phase 2B league UX/engagement campaign — Overview hierarchy fix, signal-first copy pass, member feedback entry point, information density pass, app flow improvements, and visual design language.
- Scope: `src/components/OverviewPanel.tsx`, `src/components/StandingsPanel.tsx`, copy/label edits throughout.
- Notes: Retroactively registered. Covers PRs #167–#172 on branches phase-2b-\*.

### P2B-OVERVIEW-FEATURE-AUDIT-v1

- Purpose: Audit current Overview page modules for overlap vs. unique value before UI redesign. Planning output only — no implementation.
- Scope: OverviewPanel analysis only. No code changes.
- Notes: Planning doc only. Informed P2B-OVERVIEW-UX-CAMPAIGN-v1 implementation.

### DOCS-PROMPT-GOVERNANCE-BOOTSTRAP-v4

- Purpose: Move engineering operating instructions into the repo and establish PROMPT_ID-based traceability.
- Scope: docs only.
- Notes: Initial bootstrap for in-repo prompt governance, summary identification, instruction block identification, and commit traceability.

### DOCS-CODEX-SELF-CHECK-v1

- Purpose: Require Codex to self-check PROMPT_ID compliance before returning summaries or creating commits.
- Scope: docs only.
- Notes: Follow-up governance hardening after initial in-repo bootstrap.

### DOCS-POST-MERGE-GOVERNANCE-FIXES-v1

- Purpose: Resolve optional instruction-block validation and improve commit traceability without degrading readable git history.
- Scope: docs only.
- Notes: Post-merge cleanup for governance consistency and maintainability.

### DOCS-PROMPT-RESPONSE-REQUIREMENT-v1

- Purpose: Update prompt governance to require explicit final response requirements in every Codex prompt.
- Scope: docs only.
- Notes: Ensures response-format expectations are restated at execution time, including Section 2 and Section 3.8 applicability.

### P7B-7-FIX

- Purpose: Remove unused `draftBannerDismissed` and `dismissDraftBanner` state.
- Scope: `DraftBoardClient.tsx`.
- Notes: Commit `daa477b`.

### P7B-7-FIX-2

- Purpose: Fix React hook violation — move `autoPauseRef` and `maybeAutoPauseForRound` before early return.
- Scope: `DraftBoardClient.tsx`.
- Notes: Commit `c1a0460`.

### P7B-7-FIX-3

- Purpose: Redesign draft header with three-card layout and circular countdown clock.
- Scope: `DraftHeaderArea.tsx` (new), `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`.
- Notes: Commit `21fcfb8`.

### P7B-7-FIX-5

- Purpose: Fix horizontal overflow on draft board pages.
- Scope: Draft board page wrappers.
- Notes: Commit `fcba082`.

### P7B-7-FIX-5B

- Purpose: Contain board table overflow without clipping sidebar.
- Scope: Draft board layout.
- Notes: Commit `1f33fe0`.

### P7B-7-FIX-7

- Purpose: Remove `max-w-screen-xl` and restore `mx-auto` on draft board page containers.
- Scope: Draft board pages.
- Notes: Commits `3d62546`, `3f72c9c`.

### P7B-7-FIX-8

- Purpose: Plain text badges, flanking card hierarchy, transposed draft board.
- Scope: `DraftHeaderArea.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commits `2ebc6c3`, `8c529f5`.

### P7B-7-FIX-9

- Purpose: Abbreviated team names in draft board, 90px columns.
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `f5223b1`.

### P7B-7-FIX-10

- Purpose: Narrow owner column, short names in sidebar, conference search, sticky sidebar.
- Scope: `DraftBoardClient.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commit `d28aa08`.

### P7B-7-FIX-11

- Purpose: Team name resolution chain, header width constraint, sidebar names.
- Scope: `DraftBoardClient.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commit `2342e56`.

### P7B-7-FIX-12

- Purpose: Revert to horizontal table orientation (owners as columns, rounds as rows).
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `4fc41c2`.

### P7B-7-FIX-13

- Purpose: Replace sidebar with horizontal bottom team strip.
- Scope: `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`.
- Notes: Commit `d5784bc`.

### P7B-7-FIX-14

- Purpose: Fixed-frame layout — no vertical page scroll, `calc(100dvh - 10rem)`.
- Scope: `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`.
- Notes: Commit `47099d8`.

### P7B-7-FIX-15

- Purpose: Random auto-pick selection from available teams, updated search placeholder.
- Scope: `route.ts` (draft API), `DraftBoardClient.tsx`.
- Notes: Commit `299d064`.

### P7B-7-FIX-16

- Purpose: Timer expiry always pauses and prompts commissioner.
- Scope: `route.ts` (draft API).
- Notes: Commit `669e229`. Hotfix `edf8c41`.

### P7B-7-FIX-17

- Purpose: Carousel-based pick header with five cards and crossfade.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `59850c0`.

### P7B-7-FIX-18

- Purpose: Redesign carousel to compact landscape strip with round boundary labels.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `df5cd3c`. Flex-ratio card sizing, CSS grid crossfade, round boundary sidebars.

### P7B-7-FIX-19

- Purpose: Cap carousel strip at 900px max-width, centered.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `938cd9d`.

### P7B-7-FIX-20

- Purpose: Add 1400px max-width to draft page, remove duplicate gear icon.
- Scope: Draft board `page.tsx`.
- Notes: Commit `f24159d`.

### P7B-7-FIX-21

- Purpose: Widen page max-width to 1920px.
- Scope: Draft board `page.tsx`.
- Notes: Commit `d120557`.

### P7B-7-FIX-22

- Purpose: Remove max-width, add 24px horizontal padding.
- Scope: Draft board `page.tsx`.
- Notes: Commit `e94b543`.

### P7B-7-FIX-23

- Purpose: Fix page centering with explicit margin auto and max-width.
- Scope: Draft board `page.tsx`.
- Notes: Commit `3102d41`.

### P7B-7-FIX-25-AUDIT

- Purpose: Print exact JSX structure of draft page component for centering diagnosis.
- Scope: Read-only audit. No commits.

### P7B-7-FIX-25-AUDIT-2

- Purpose: Identify parent layouts causing left-alignment.
- Scope: Read-only audit. No commits.

### P7B-7-FIX-25

- Purpose: Center draft content at 1400px max-width with inner wrapper div.
- Scope: Draft board `page.tsx`.
- Notes: Commit `9dfa4fa`.

### P7B-7-FIX-26

- Purpose: Add `width: 100%` to draft board container, table wrapper, and table.
- Scope: `DraftBoardClient.tsx`, `DraftBoardGrid.tsx`.
- Notes: Commit `584858a`.

### P7B-7-FIX-27

- Purpose: Fix timer expiry behavior (honor `timerExpiryBehavior` setting) and setup auto-advance error recovery.
- Scope: `DraftHeaderArea.tsx`, `DraftSetupShell.tsx`.
- Notes: Commit `9606d2b`. Auto-fire auto-pick effect; `autoAdvancedRef` guard prevents permanent loading state.

### P7B-7-FIX-28

- Purpose: Mobile-responsive carousel — 3 cards on mobile, reduced padding/fonts.
- Scope: `DraftHeaderArea.tsx`.
- Notes: Commit `fbf8f0e`.

### P7B-7-FIX-29

- Purpose: Reduce horizontal padding to 8px on mobile, 24px on desktop.
- Scope: Draft board `page.tsx`.
- Notes: Commit `0995fa6`. Tailwind `px-2 md:px-6` (server component, no hooks).

### P7B-7-FIX-30

- Purpose: Increase draft board cell font to 12px on desktop, 11px on mobile.
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `ea394f0`.

### P7B-7-FIX-31

- Purpose: Reduce owner column width from 100px to 86px for 14-column fit.
- Scope: `DraftBoardGrid.tsx`.
- Notes: Commit `66a9bc2`.

### P7B-7-FIX-32

- Purpose: Allow team selection during round-boundary pause — implicitly starts next round.
- Scope: `DraftBoardClient.tsx`.
- Notes: Commit `f7e2d1d`. Sequential PUT (resume) + POST (pick) when paused at round boundary.

### P7B-7-FIX-33

- Purpose: Hard-cap total rounds at `floor(fbsTeamCount / ownerCount)`.
- Scope: `DraftSettingsPanel.tsx`, `route.ts` (draft API).
- Notes: Commit `be4548d`. UI max, on-save clamp, and API validation in both POST and PUT.

### P7B-7-FIX-34

- Purpose: Draft summary page — public access, conference column, complete banners.
- Scope: `DraftSummaryClient.tsx`, summary `page.tsx`, `DraftHeaderArea.tsx`, `DraftBoardClient.tsx`, `SpectatorBoardClient.tsx`, `CFBScheduleApp.tsx`.
- Notes: Commit `edd7d4e`. Removed admin redirect; added conferenceMap; alphabetical owners; "View Draft Summary →" on complete banner; league overview draft-complete banner with Week 1 auto-hide.

### P7B-7-FIX-35

- Purpose: Use short display names on draft summary page (e.g. "FIU" instead of "Florida International").
- Scope: Summary `page.tsx`, `DraftSummaryClient.tsx`.
- Notes: Commit `b94c6f9`. `displayNameMap` built from `getTeamDatabaseItems()` with same resolution as `draftTeamInsights.ts`.

### P7B-7-AUDIT-ROUND-COUNT

- Purpose: Audit where total round count is defined, stored, and whether it's hardcoded or dynamic.
- Scope: Read-only audit. No commits.
- Notes: Found `totalRounds` is user-configurable (1–50), stored in draft state, with `ceil(fbsTeamCount/ownerCount)` suggestion. No hardcoded value of 10 found.

---

## Superseded Prompts

### P3A-OVERVIEW-REDESIGN-v1

- Superseded by: P2C-OVERVIEW-REDESIGN-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

### P3B-TRENDS-TITLE-CHASE-v1

- Superseded by: P2D-TRENDS-TITLE-CHASE-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

### P3B-TRENDS-FORM-DOTS-v1

- Superseded by: P2D-TRENDS-FORM-DOTS-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

---

## Ledger entry template (example only)

Illustrative shape for a ledger entry — **not** current prompt-governance authority. The binding ID format and header rules live in `AGENTS.md` / `CLAUDE.md`; entries follow the current `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` format (campaign prefixes: `INSIGHTS`, `DRAFT`, `PLATFORM`, `POLISH`, `DOCS`).

### `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>`

- Purpose: [one sentence]
- Scope: [files or modules affected]
- Notes: [optional — branch, PR refs, follow-up items, superseded IDs]
