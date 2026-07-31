# Next Tasks (Active Queue)

Status: Current
Last verified: 2026-07-30
Owner: Project documentation
Canonical for: current execution order, planned/parked work, blockers, and the one canonical list of
unresolved decisions and known deferrals
Supersedes: (none)

## Purpose / How to use this document

- This file is the **active execution queue** for current campaigns, and the ONLY document that may
  designate an item `NEXT` or `CURRENT`. Roadmap, registry, and completed-work entries may link here,
  but their status text is point-in-time history, never current planning authority.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`; per-prompt execution records live in
  `docs/prompt-registry.md`. Do not accumulate shipped-implementation narrative here.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.
- Reference implementation prompts by explicit `PROMPT_ID` and follow the header convention documented
  in `docs/prompt-registry.md`.
- **Backlog slugs are provisional planning labels, not formal prompt IDs.** A
  `Backlog slug (provisional)` is just a working name for a not-yet-activated task. The formal
  `PROMPT_ID` — `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` per `AGENTS.md` (prompt governance) — is
  assigned only when the task is activated, and its `<###>` sequence is checked against
  `docs/prompt-registry.md` at that point.
- `Last verified` here means the **current-authority content** of this file (execution order, statuses,
  deferrals) was audited for present-state accuracy on that date.

## Current execution order

1. **NEXT — PLATFORM-086F2: admin control-plane information-architecture redesign (F2A–F2J)** (see
   Active priority 1 below). The last provider-campaign implementation item; everything before it in
   the campaign is merged and, where applicable, active in production.
2. Then: return to product-facing work — homepage/landing page (not yet scoped — no backlog slug),
   INSIGHTS-018 (NEW tag + signatures),
   INSIGHTS-019 (diagnostic endpoint), INSIGHTS-020 (record-change insights), History Records
   continuation, Slow Draft Mode; commissioner onboarding / multi-tenant signup later.
3. Nonblocking operational observation (not implementation work): the passive **PLATFORM-086E1C2 §8i**
   schedule-presentation observation checkpoint (`docs/deployment-runbook.md` §8i) records its first
   qualifying automatic presentation refresh from production evidence when it occurs.

The provider campaign's completed execution record (086A → G1 → G2 → H → I → F1 → B → C → E1 → E2,
with activations §8e–§8j) lives in `docs/prompt-registry.md` and `docs/completed-work.md`; the
activation evidence lives in `docs/deployment-runbook.md`.

## Campaign status

All foundational phases are complete. Work is now organized into named workstream campaigns.

| Workstream          | Campaign                                                                                | Status                |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| Data & Intelligence | Game Stats Pipeline                                                                     | ✅ Complete           |
| Data & Intelligence | Insights Engine Foundation                                                              | ✅ Complete           |
| Data & Intelligence | Insights Engine — Generators and Wiring                                                 | ✅ Complete           |
| Data & Intelligence | Insights Engine — Context Extension                                                     | ✅ Complete           |
| Data & Intelligence | Insights Engine — Generator Batch 2                                                     | ✅ Complete           |
| Data & Intelligence | Copy Variation Architecture                                                             | ✅ Complete           |
| Data & Intelligence | Insights Panel UI Redesign + Polish                                                     | ✅ Complete           |
| Platform            | Season Launch Hardening (Draft Auth + Polling, Standings Preseason, Insights Lifecycle) | ✅ Complete           |
| Platform            | Standings Ownership Model Redesign (Phases 0–5)                                         | ✅ Complete           |
| Data & Intelligence | Insights Engine — Weekly In-Season Pulses (INSIGHTS-018)                                | Planned               |
| Data & Intelligence | Insights Diagnostic Endpoint (INSIGHTS-019)                                             | Planned               |
| Data & Intelligence | Insights Panel — Microlabel Palette (INSIGHTS-017-PALETTE)                              | Planned               |
| Data & Intelligence | Insights Ranker — Priority Tuning (INSIGHTS-RANKER-TUNING)                              | Planned               |
| Data & Intelligence | Insights — All Insights Page (ALL-INSIGHTS-PAGE)                                        | ✅ Complete           |
| Data & Intelligence | Pairing Cards                                                                           | Planned               |
| Data & Intelligence | Luck Score + Bounce-Back Generators                                                     | Planned               |
| Platform            | Season Rollover UI and Cron                                                             | ✅ Complete           |
| Platform            | AppStateStore Caching — Egress Optimization (APPSTATESTORE-CACHING)                     | ✅ Complete (082A+082B) |
| Platform            | Server Fetch Architecture (SERVER-FETCH-ARCHITECTURE)                                   | Parked (audit done; fixes unscheduled) |
| Polish              | History Page Polish                                                                     | ✅ Complete           |
| Polish              | History Rework Foundation (HISTORY-REWORK-FOUNDATION)                                   | ✅ Complete           |
| Polish              | History Records (HISTORY-RECORDS)                                                       | In progress           |
| Polish              | Standings Page — Preseason State (STANDINGS-PRESEASON-STATE)                            | ✅ Complete           |
| Polish              | Standings Page — Lifecycle Labeling Sweep (STANDINGS-PAGE-LIFECYCLE-LABELING)           | Planned               |
| Polish              | Link Styling Audit (LINK-STYLING-AUDIT)                                                 | Planned               |
| Draft               | Slow Draft Mode                                                                         | Planned               |
| Draft               | Draft Difficulty Settings                                                               | Planned               |
| Platform            | Multi-tenant Commissioner Sign-up                                                       | Planned               |
| Platform            | Server Action Auth Hardening                                                            | Planned               |
| Platform            | Provider Refresh Observability (PLATFORM-086A)                                          | ✅ Complete (PR #391) |
| Platform            | Provider Automation & Correctness (PLATFORM-086B–I)                                     | ✅ Complete except 086F2 (NEXT) |
| Polish              | Design Audit (remaining pages)                                                          | Planned               |
| Polish              | Copy / UX Writing Audit                                                                 | Planned               |
| Polish              | Back Button Audit                                                                       | Planned               |
| Polish              | Aliases Platform Migration                                                              | ✅ Complete           |
| Polish              | History Page — Filter Former Owners                                                     | Planned               |
| Polish              | Test Suite Baseline Cleanup (TEST-SUITE-BASELINE-CLEANUP)                               | ✅ Complete           |

## Active priorities

### 1. PLATFORM-086F2 — admin control-plane information-architecture redesign — NEXT

Activated from backlog slug `PLATFORM-086F-ADMIN-DIAGNOSTICS-DASHBOARD-v1`. The read-only audit is
complete and accepted; the canonical inventory, target information architecture, locked decisions,
scheduler-receipt contract, and the slice-by-slice migration map live in
[`docs/architecture/admin-control-plane.md`](architecture/admin-control-plane.md)
(`PLATFORM-086F2A-ADMIN-CONTROL-PLANE-IA-v1`). The original "diagnostics dashboard" goals (compact
system-health summary, severity-ordered actionable issues, a scheduler heartbeat kept distinct from
provider-refresh status, and the H3E scheduler-skip observability gap) are all carried forward by
that plan.

Execution order within F2 (each slice is one independently deployable PR):

1. **F2A — inventory + IA doc** (docs-only) — ✅ merged (PR #430).
2. **F2B — lifecycle authority safety** (manual rollover converged onto the strict automatic
   eligibility gate, per-lifecycle-year rollover, no render-time status seeding, single league-year
   authority; binding rules in `AGENTS.md` → Lifecycle Authority Invariants) — ✅ merged
   (PR #431).
3. **F2C — maintenance action model and page foundation** (Data Maintenance & Recovery rename,
   shared per-action cost/scope disclosure contract, rollover off the maintenance page,
   historical-score repair provider-status instrumentation) — ✅ merged (PR #432).
4. **F2D — operational mutation relocation** — split at its audit into two independently
   reviewable slices:
   - **F2D1 — provider maintenance relocation** (System Health keeps gates + observation;
     Odds/Rankings refreshes, Conferences, and the Team Database sync live on Data Maintenance &
     Recovery with disclosures; drifted co-located team-database test removed) — ✅ merged
     (PR #433).
   - **F2D2 — score-attachment recovery relocation** (the mutating score tool becomes an
     explicitly confirmed emergency-class Data Maintenance action; Diagnostics keeps only
     observation + safety controls) — ✅ merged (PR #434).
5. **F2E1 — external scheduler receipts** (shared receipt authority
   `src/lib/server/schedulerExecutionStatus.ts` + latest-only durable
   `scheduler-execution-status/<job>` receipts written after successful cron auth on all five
   QStash routes; responses, provider behavior, cadence, runtime-event schemas, QStash contracts,
   and `vercel.json` unchanged; no reader/UI) — ✅ **merged (PR #435, `4404ad3`, 2026-07-31)**.
6. **F2E2A — lifecycle scheduler receipts + events** (extend the receipt authority to
   season-transition and season-rollover with `source: 'vercel-cron'`, and add their
   previously-missing secret-safe runtime execution-log events; responses, lifecycle decisions,
   provider behavior, cadence, and `vercel.json` unchanged; no reader/UI) — ✅ **implemented, PR
   open (not merged)**.
7. **F2E2B — lifecycle scheduler reader + classifier** — **the next slice**: add the cache-only
   admin reader over all seven `scheduler-execution-status/<job>` receipts and the cadence-aware
   delivery-health classification.
8. Then, in order: F2F system-health read model → F2G System Health UI → F2H Season Management
   consolidation → F2I Platform Configuration/Team Identity → F2J commissioner boundaries +
   navigation closeout.

The legacy diagnostics tools remain available and unmoved until the corresponding slice ships.

**Binding PR-sizing rule (applies to 086F2 and all future campaign work):** the goal is correctly
sized, cohesive PRs — one cohesive objective with a clear acceptance contract, independently
reviewable, verifiable, deployable, and revertible. Stop-and-reassess signals (not hard limits):
more than 15 changed files or more than 1,500 net changed lines (excluding lockfiles/generated
data) → stop, explain what expanded, then split or obtain explicit approval. Related fixes MAY stay
together when they share one provider family or end-to-end behavior; split work that crosses
distinct provider families, separate automation jobs, substantial independent UI surfaces, or
components shipping on different schedules — a planning split is mandatory before implementation
in those cases, and artificial one-finding-per-PR fragmentation is the opposite failure mode. Never
bundle live scores with Odds; never fold diagnostics information-architecture work into correctness
or automation PRs; no opportunistic architecture cleanup outside the acceptance contract;
documentation is updated near the end of implementation; unrelated review findings become
separately tracked follow-ups. Named failure case: PLATFORM-086A (77 files / ~12k lines).

### Provider campaign (PLATFORM-086) — completed record

The provider correctness & automation campaign is **complete except 086F2**. Live-score polling
(3-minute), Odds polling (hourly), weekly schedule maintenance, and publication-aware rankings
automation are all **active in production**; game-stats polling (15-minute) has been active since
H3E; automatic schedule-presentation enrichment is wired into the active schedulers (its first
qualifying automatic refresh is the pending, passive §8i observation). Every slice's full execution record (scope, review
rounds, verification, PRs, merge commits) lives in `docs/prompt-registry.md`; outcome milestones in
`docs/completed-work.md`; operator activation evidence in `docs/deployment-runbook.md` §8e (game
stats), §8f (live scores), §8g (Odds), §8h (weekly schedule), §8i (presentation observation —
pending, passive), §8j (rankings). Provider descriptor policy strings were corrected in each
family's implementation PR; conferences remain manual by design (no automation task exists).
PLATFORM-086D was absorbed into 086A and retired — do not reuse that ID.

### 2. INSIGHTS-018 — NEW tag + signature system

Per-league global (not per-user) NEW-tag system for the insights panel. 48-hour active-season
window, 7-day offseason window. Signature-based detection so that hook/owner/statValue changes
register as a fresh insight while semantically identical re-renders do not.

- **Backlog slug (provisional):** `INSIGHTS-018-NEW-TAG-v1`

### 3. INSIGHTS-019 — Diagnostic endpoint

Admin-gated `GET /api/debug/insights/[leagueSlug]` that returns: generator pool size, rendered set,
suppressed set, per-insight signatures, and last-change timestamps. Enables at-a-glance verification
of NEW tag behavior and suppression correctness without reading logs.

- **Backlog slug (provisional):** `INSIGHTS-019-DIAGNOSTIC-v1`

### 4. INSIGHTS-020 — Record-change insights

Surface recently changed records as insights. Wires up the dormant `RecordEntry.recentChange` field
(declared in Phase 1, never populated). Pairs with INSIGHTS-018 (NEW tag) and INSIGHTS-019
(diagnostic endpoint) as part of the insights freshness campaign.

**Scope:**

- Snapshot store for prior `selectAllRecords` output (likely `appStateStore`)
- Diff trigger and cadence (per-week post-scoring, on-demand, or cron — design decision)
- TTL / "recent" window semantics
- New insight generator: `src/lib/insights/generators/recordChange.ts`
- Suppression rule integration with existing insight category logic
- NEW tag interaction: record changes are inherently "new since last visit" — should inherit
  INSIGHTS-018 wiring

**Dependencies:** INSIGHTS-018 (NEW tag) preferred to ship first so record-change insights inherit
the freshness wiring. Estimated: 2–3 PROMPT_IDs end-to-end.

- **Backlog slug (provisional):** `INSIGHTS-020-RECORD-CHANGE-v1`

### 5. DRAFT — Slow Draft Mode

Enable async drafts with configurable per-pick windows. Requires email notification infrastructure
(new). See `docs/roadmap.md` for full scope.

### 6. PLATFORM — Server Action Auth Hardening

Enforce commissioner role on all mutating server actions. Remove `ADMIN_API_TOKEN` fallback from
public routes.

## Unresolved decisions & known deferrals

Explicitly deferred, not scheduled — this is their single canonical home (per `AGENTS.md`). Other
documents may link here but must not maintain duplicate descriptions. Do not mark any complete
unless verified in merged work.

- ~~**CSV current-season guard** vs sanctioned admin override.~~ **Resolved — PLATFORM-083** (audited in PLAN-002). `PUT /api/owners` now guards active-season overwrites: replacing an already-populated active-season roster requires an explicit `?override=1` repair confirmation (surfaced in both the CSV import panel and inline roster editor); historical/backfill and initial-creation writes are unguarded. Route stays platform-admin-only; no new league-admin role. See `docs/architecture/identity-and-ownership.md`.
- **Owner-identity mapping across seasons** (renamed/returning owners; owner display names are raw strings today).
- Whether to schedule **PLATFORM-040** (ownership-key normalization).
- **`conferenceRecords` canonical build** — whether the canonical standings build should pass `conferenceRecords` (PLATFORM-070-adjacent).
- **Historical/archive ownership parity** tied to **PLATFORM-039** — archive/insights surfaces still raw-label match; see the `AGENTS.md` deferral list.
- **`STANDINGS-PAGE-LIFECYCLE-LABELING`** — broader offseason/`{year} Season` label audit beyond the standings page (see the Polish backlog below).
- ~~**Numeric participant-validation prerequisite (PLATFORM-086H3C1).**~~ **Resolved — PLATFORM-086H3C5, MERGED via PR #407 (2026-07-24, dormant).** Schedule persistence now captures CFBD numeric `homeId`/`awayId` through the shared mapper (additive, nullable; old durable rows stay readable and are never rewritten), and the dormant evidence authority validates stored `schoolId`s against them by exact oriented comparison — producing the fail-closed `identity-mismatch` and `participant-validation-unavailable` states that C1 deferred. Full record: `docs/prompt-registry.md` → `PLATFORM-086H3C5-DORMANT-NUMERIC-PARTICIPANT-VALIDATION-v1`. **Operational prerequisite for H3E activation — ✅ DONE (2026-07-26):** the forced full-year schedule refreshes for every H3E target season have been performed (§8d), so canonical games carry the numeric ids; the previously-fail-closed `participant-validation-unavailable` caches are refreshed (see the registry entry's rollout notes and `docs/ai/game-stats-writer-fence.md`). The C1 handoff's "Participant validation (DEFERRED)" section remains the point-in-time record of the original deferral.
- **Accepted — game `401506450` (2022 week 14 Akron @ Buffalo) is an upstream CFBD data-quality limitation; its canonical analytics exclusion is intentional (decided 2026-07-24).** The stored row (`app_state` scope `game-stats`, key `2022:14:regular`; sole occurrence across all 2022 partitions; legacy shape, provider-written) is a **genuine provider capture that is analytics-incomplete at the source**: each side carries only six defensive raw categories (sacks, tackles, qbHurries, defensiveTDs, tacklesForLoss, passesDeflected) while all six required analytics categories (netPassingYards, possessionTime, rushingYards, thirdDownEff, totalYards, turnovers) are missing on both sides — classifying it `legacy-malformed` → historical `manual-only` under the evidence authority. A live diagnostic read of the exact refresh endpoint (`/games/teams?year=2022&week=14&seasonType=regular`, 2026-07-24) returned the identical defense-only partial payload, so **automated CFBD backfill cannot repair it** — a refresh reproduces the same defective evidence. Decision: **do NOT build a manual stat-entry or migration path for this one historical game**; the canonical projection's exclusion stands, and this remains the sole expected H3E parity residual (the legacy points-only baseline counts the 23–22 game; the final-and-complete canonical projection excludes it).
- **Terminology debt — rename the `manual-only` / `stats-manual-only` state names.** The names wrongly imply manually entered data exists; no manual-entry feature exists and no such row was hand-authored. The state actually denotes the `manual-migration-only` recovery disposition — historical defective evidence no automated path can repair (`src/lib/gameStats/evidenceAuthority.ts` / `contract.ts`). Rename the evidence state (and any audit exclusion label derived from it) to a name that says "unrepairable historical evidence" when these modules are next touched; naming-only, no behavior change.
- **Cross-authority indeterminate-commit vocabulary (deferred at PLATFORM-086E2A review, 2026-07-30).** The app-state transaction layer can distinguish a commit whose acknowledgment was lost (`AppStateTxnFinalizeError` `writeAttempted`/`writeAcknowledged` — the write may have durably applied) from a plainly failed one, but BOTH the schedule (E1A) and rankings (E2A) refresh authorities report every transaction fault as `durable-commit-failed` under their closed reason vocabularies. Safe today (memo unpublished, no fabricated success, the next refresh reconciles via observation ordering — the caveat is documented in both result contracts), but the reported "prior-good retained" can be false in the lost-acknowledgment case. If addressed, add a distinct indeterminate outcome to E1A and E2A **uniformly** — never one authority alone. Raised as a P1 by an external E2A review; dispositioned not-taken there because the E2A prompt's closed vocabulary and the merged E1A sibling pin the current semantics. Not scheduled.
- **Synthetic-final-poll partial-postseason replacement window (deferred at PLATFORM-086E2A review, 2026-07-30).** The rankings completeness gate compares the canonical POST-remap representation, in which all postseason weeks collapse to one synthetic final poll (week 999). If a prior entry was built from CFBD postseason weeks 1+2 and a later refresh returns only week 1 with the SAME populated poll sources, the remap re-mints the synthetic final from the earlier poll and neither the week-key nor the source-population check fires — the final poll is silently replaced by the earlier-era poll as `written-clean`. The realistic variant (source sets differing across those weeks) IS caught; detecting the residual window would require persisting pre-remap postseason week identity (a stored-model change). Claude cycle-1 P3; not scheduled.
- **Per-game live-overlay freshness granularity (deferred at PLATFORM-086B2B, owner decision 2026-07-28).** The scores freshness signals are per-partition/global, not per-game: `snapshotAt` (the "Scores updated …" label) is the oldest contributing partition's `meta.generatedAt`, and `isStale` (live-overlay dimming) is a single successful-observation flag for the whole overlay. In a provider-gap scenario — a game that drops out of the scoreboard while still live, so the cron preserves its stale row while other games in the partition keep updating — a fresh sibling can ride over that stale game (the partition's newest-row timestamp), and the global `isStale` cannot dim just that game. This is strictly better than pre-086B2B (which reported every game fresh on any client poll) and does not affect standings/records (server canonical). The true fix is per-game freshness: thread per-game effective timestamps (`itemUpdatedAtById`) to the client and make `selectLiveDelta` compute per-game staleness. Documented in `src/lib/scores.ts` (`noteSnapshot`). Not scheduled.
- **Accepted — synthetic-only empty-usable catalog (PLATFORM-086H3C1), not production-reachable.** A nonempty-but-registry-unusable team catalog (e.g. `[{ school: '' }]`) can bypass `buildCanonicalGameStatsSlate`'s `teams.length === 0` catalog-authority guard **only via a direct synthetic call**: production `getTeamDatabaseItems()` sanitizes every entry through `toTeamCatalogItem` (drops empty-`school` items), so an unusable catalog collapses to `[]` and is already caught as `catalog-load-failed`. Accepted as test-only robustness — the pure builder stays exported for unit tests (not privatized); if ever hardened, tighten the precondition to require ≥1 registry-usable entry.
- **Cron `maxDuration`/latency-envelope hardening (deferred P3 from the PLATFORM-086E1C2 review, 2026-07-30).** The weekly schedule-refresh and season-transition cron routes declare no explicit `maxDuration` (nothing in the routes or `vercel.json`), so their latency envelope is the platform default; in a sustained provider-brownout worst case the E1C2 presentation wiring roughly doubles a pre-existing E1A exposure (the qualifying-year presentation calls run after the canonical work in the same invocation). Self-healing (leases/backoff/TTLs recover on a later delivery) and speculative — no observed incident. Harden when either cron route is next touched. Full record: `docs/prompt-registry.md` → `PLATFORM-086E1C2-SCHEDULE-PRESENTATION-AUTOMATION-WIRING-v1`. Not scheduled.
- **Candidate follow-ups recorded in historical entries (pointers only — descriptions live in their
  records):** PLATFORM-045 (league-route canonical-loader dedup), PLATFORM-052 (podium/hero live
  badge; `liveCountByOwner` staleness alignment), PLATFORM-054/055/056 (canonical-layer candidates:
  score cache warming, global alias merge, insights canonical owner sourcing), canonical ownership
  IDs for current-season draft ownership, 086H4 (broader game-stats presentation/copy audit), the
  game-stats legacy-row migration, the co-located `route.test.ts` relocation (four remaining
  files — one admin (`odds-usage`), three non-admin; see
  `docs/architecture/admin-control-plane.md` → operational clarity findings), and the
  `manualRefresh.ts` dead-surface trim (the scores/schedule/game-stats URL branches and
  `manualActionKey`/`isSelectedYear`/`combineOutcomes` have no live caller since F2D1 — the
  module doc marks them). See `docs/prompt-registry.md` and `docs/completed-work.md`.

_Resolved during the audit sequence (no longer open): `AdminDebugSurface` → deleted in
PLATFORM-079b; public odds/scores fetch policy → PLATFORM-075 pure-cache-reader model._

## Provisional backlog — server-fetch architecture (audit complete; fixes unscheduled)

The SERVER-FETCH-ARCHITECTURE read-only audit superseded the earlier generic "routes fetch their own
API endpoints" framing (the original Insights example was fixed by `ALL-INSIGHTS-SCHEME-FIX` and the
Insights loader now builds context in-process). Verified remaining findings — provisional backlog
items, no formal prompt IDs assigned:

- **Manual authorized Odds refresh context loads via internal HTTP.** The manual `/api/odds?refresh=1`
  path still obtains canonical schedule and conference context by fetching `/api/schedule` and
  `/api/conferences` over internal HTTP (`src/app/api/odds/route.ts`), instead of the direct
  server-side context authority (`canonicalOddsContext`) the automatic Odds refresh uses.
- **Admin debug context loaders use internal HTTP and can mask failures.** Several admin debug
  context loaders (`src/app/api/debug/_lib/loadDebugSeasonContext.ts`, consumed by the schedule /
  scores-attachment / postseason-score-attachment debug routes) fetch internal endpoints and may
  collapse non-2xx responses into misleading empty collections (`.catch(() => ({ items: [] }))`
  around body parsing).
- **Score diagnostics' intentional self-call — deferred.** `src/app/api/debug/scores/route.ts`
  deliberately self-calls the scores refresh (forwarding the admin's credentials) so a cold cache
  does not report misleading zeros; removing it safely requires extracting a shared score-refresh
  authority first (the pattern the odds/schedule/rankings families now have).

## Planned backlog (from INSIGHTS-017 campaign)

Items surfaced during the Insights Panel Redesign + Polish campaign and queued for future implementation:

- **INSIGHTS-017-PALETTE** — Category microlabel palette rationalization. Resolves HISTORICAL/STANDINGS/SEASON shared-purple and STATS/LEAGUE/fallback shared-slate token collisions. Includes micro-discovery on why SEASON labels render when no generator appears to set that category. Constrained by `DESIGN.md`'s strict ban on amber/green/red/blue hues for category use.
- **LINK-STYLING-AUDIT** — App-wide standardization of "view more" / "full view" / "see all" cross-links. Current split: blue `↗` on history/Overview column headers vs. muted `→` on Insights "See all". Convention chosen: muted text + horizontal arrow. Removes redundant blue accent on already-interactive links, aligns with `DESIGN.md`'s single-purpose use of blue for interactivity.
- **STANDINGS-PAGE-LIFECYCLE-LABELING** — Broader "Offseason" vs "{year} Season" label inconsistency audit across surfaces beyond the standings page. STANDINGS-SUBHEADER-FIX addressed the standings page itself; other surfaces may still show stale or contradictory year/lifecycle labels during offseason.
- **INSIGHTS-RANKER-TUNING** — Audit base priority weights across all 26 generators. Add sample-depth awareness (e.g. "perfect record at 6 games" should not rank as high as "perfect record at 20 games"). Foundation for eventually restoring row-1 prominence once the ranker earns it. Revisit when priority decay ships.

## Planned backlog (from Standings Ownership Redesign campaign)

Items surfaced during the Standings Ownership Model Redesign campaign and queued for future implementation:

- **POSTSEASON-START-WEEK-SCHEDULE-DERIVED** — `POSTSEASON_START_WEEK` is currently a hardcoded constant (`= 16`) with a rationale comment (Option B). Option A (derive from schedule data — the week of the earliest `seasonType === 'postseason'` game) is the correct long-term solution. Deferred because the constant works for current seasons; revisit before any season with an unusual CFP bracket structure.
- **INVALIDATE-STANDINGS-PER-LEAGUE** — `invalidateStandings` enumerates all leagues when called for global/year-scope mutations (e.g., global or year alias writes that apply across leagues). Documented limitation in the `invalidateStandings` JSDoc. Note: the original "per-league alias scope would allow targeted invalidation" premise is now moot — **PLATFORM-067 removed league-scoped aliases from runtime resolution** (team aliases are not league-specific). Alias writes are inherently global/year, so the fan-out is correct by construction; any future targeting must be justified on different grounds (e.g., which leagues actually reference a changed alias), not per-league alias scope.
- **HEADER-ARCHITECTURE-UNIFICATION** — `LeaguePageShell` and `CFBScheduleApp` render independent header regions; they should share a single `LeagueHeader` component. Flagged during LEAGUE-HEADER-USER-MENU work but out of scope for this campaign. Separate Polish prompt when header structure stabilizes.

## Planned backlog (from HISTORY-RECORDS campaign)

Items surfaced during the HISTORY-RECORDS Phase 2 Overview revision and queued for Phase 3:

- **RECORDS-SCORING** — Auto-score the records surfaced in the History Overview Records column. Today, `selectMarqueeRecords` (in `src/lib/selectors/historyOverview.ts`) picks 5 records via an implicit rule (one from each of `career` / `season` / `rivalry` / `event`, then one extra by category-priority order). The rule is editorial-by-default and undiscoverable; as new records get added to `selectAllRecords()` the marquee will drift away from "the most narratively interesting records the league has." Replace the implicit rule with an auto-computed score on each `RecordEntry`, mirroring the Insights ranker pattern. Score weights to consider: recency of when the record was set or last changed hands, magnitude of the leader's gap-to-second, volatility (how often the record changes hands across archived seasons), whether the holder changed in the most recent season. Implementation hint: extend `RecordEntry` with a computed `score` (or equivalent) field populated inside `selectAllRecords`; reduce `selectMarqueeRecords` to a sort-by-score-desc + slice. The Records column then renders the top N with no manual curation. Trigger to prioritize: HISTORY-RECORDS Phase 3, alongside the Stats / Rivalries / Archive subtab content wiring.
  - **Backlog slug (provisional):** `RECORDS-SCORING-v1`

- **SPARSE-DATA-LAYOUT** — The History Overview dashboard restructure (P7-HISTORY-RECORDS-PHASE-2-VISUAL-REFINEMENT-v1) achieves visual balance under the assumption that each section fills its column. In current TSC data (6 seasons), some sections render with fewer rows than their peers — Title droughts shows 4 rows vs Top rivalries' 5; Recent podiums shows only the 3 most recent seasons regardless of league age. The page accommodates this via whitespace, but at very sparse data states (a brand-new league with 1–2 seasons, for example) the imbalance becomes more visible. Goal: evaluate whether sections should respond to their own data density — narrowing column width when sparse, or stacking with peer sections in a different layout — vs accepting the imbalance as the cost of designing for the eventual fully-populated state. Implementation hint: this is primarily a layout discipline decision rather than a selector change; the data shape already reflects density via row counts. Possible directions: per-section `lg:col-span-*` adjustments based on row count, a row-count-aware grid utility, or an explicit "compact" rendering mode for sections at certain thresholds. Trigger to prioritize: when a new league is created and onboarded with very few seasons of data, or when the existing layout proves uncomfortable at any point in the league's growth arc.
  - **Backlog slug (provisional):** `SPARSE-DATA-LAYOUT-v1`

- **INSIGHT-ROUTING-PHASE-3-RETARGET** — Re-point insight deep links from Overview anchors to the Stats and Rivalries subtabs once Phase 3 ships their content. `resolveHistoryHref` (in `src/components/OverviewPanel.tsx`) currently routes drought → `/history#dynasty-drought`, dynasty → `/history#championships`, and rivalry types (`perfect_against`, `lopsided_rivalry`, `even_rivalry`, `dominance_streak`) → `/history#rivalries`. These were reverted from the Phase 2 subtab routes (`/history/stats`, `/history/rivalries`) because those subtabs render "Coming in Phase 3" placeholders today and create dead-end navigation. Trigger to prioritize: alongside Phase 3's Stats/Rivalries subtab content wiring; update both the routing and the matching `insightHref-history-routing.test.tsx` assertions.
  - **Backlog slug (provisional):** `INSIGHT-ROUTING-PHASE-3-RETARGET-v1`

- **HISTORY-DYNAMIC-TILING** — The History Overview currently uses a stacked dashboard layout with vertical scroll. During Phase 2, repeated visual iteration surfaced that History's content is structurally sparser than main Overview's, leading to whitespace problems that were ultimately addressed with an `mx-auto max-w-7xl` cap (commit `3e1a977`). An alternative design direction was explored conversationally but deferred: dynamic tiling, where sections rearrange into a packed grid that fills available 2D space rather than stacking vertically. Goal: explore whether History (and possibly other sparse-content pages) should use a dashboard tiling layout instead of vertical stacking. Sections become tiles that pack into available width, eliminating vertical whitespace by using horizontal space efficiently. Reference Pinterest / Trello / Notion as precedent patterns. Implementation hint: evaluate CSS Grid `auto-flow: dense` vs JS-based packing libraries (e.g. Muuri, react-grid-layout) vs hand-tuned per-breakpoint grid placements. Each has tradeoffs around predictability, complexity, and dependency cost. Why it was deferred: committing to tiling would mean re-thinking the page's section composition, visual hierarchy, and breakpoint behavior from scratch. Phase 2 was already a long iteration cycle and shipping a polished stacked-with-cap layout was the higher-priority action; revisit when the campaign has space for fresh design exploration. Trigger to prioritize: if living with the stacked-and-capped History page reveals that its layout still feels structurally wrong, OR when other sparse-content pages (e.g., a future Stats subtab) face the same whitespace problems and a unified solution becomes valuable.
  - **Backlog slug (provisional):** `HISTORY-DYNAMIC-TILING-v1`

## Completed campaigns and shipped platform work

Shipped work is recorded in `docs/completed-work.md` (outcome milestones) and
`docs/prompt-registry.md` (per-prompt execution records) — including the foundational campaigns
(Architecture Stabilization through Season Lifecycle and Launch Prep), the Insights Engine arc, the
Standings Ownership Model Redesign, the PLATFORM-068 audit-driven correctness + docs sequence
(PLATFORM-069→081b, DOCS-001→008, DOCS-010), the canonical-contract sequence (PLATFORM-031→053),
the AppStateStore caching campaign (PLATFORM-082A archive read cache + PLATFORM-082B insights
output cache — ✅ complete), the cache-correctness follow-ups (PLATFORM-084A/084B/085A/085B/085C),
the test-suite baseline cleanup arc, and the full PLATFORM-086 provider campaign (see the completed
record under Active priorities above).

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres
  setup and first hosted preview validation.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- Revisit TypeScript import/test-runner cleanup separately from active campaign work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking
  technical debt unless explicitly scheduled.
