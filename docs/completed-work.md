# Completed Work Log

Status: Historical, consolidated by outcome
Source checkpoint: 2026-09-06
Consolidated: 2026-09-11
Owner: Project documentation
Canonical for: shipped milestone history; not current implementation, deployment, or planning authority

## Purpose and maintenance

This ledger consolidates 168 original milestone headings and four embedded implementation records into 31 outcome records. Duplicate umbrella/slice accounts are merged, and later explicit decisions are summarized alongside their historical predecessors. Ordering is by topic, not by merge date. Every source record is mapped in the per-source evidence index.

- Preserve what shipped, why it mattered, material delivery limits, and references that recover the detail. Historical activation is not evidence a scheduler remains enabled today.
- `docs/next-tasks.md` owns current sequencing and deferrals; `docs/prompt-registry.md` and PRs own execution/review detail. Current architecture, `AGENTS.md`, `DESIGN.md`, and runbooks retain their own authority.
- Future single-milestone entries should normally be 60–100 words. Extend an existing campaign record when appropriate; consolidate after campaign closure instead of preserving a second umbrella narrative.
- Do not append test totals, review-round transcripts, full prompt lists, temporary NEXT pointers, or repeated file inventories. Preserve a meaningful exception or incomplete-delivery boundary when its omission would mislead.
- Do not remove a unique architectural decision solely because a newer outcome summary exists. Retain its rationale here or confirm it is preserved in the owning document before replacing it with a pointer.

This is an editorial reconciliation of the supplied ledger, not a repository or production audit. Source-linked PRs and documentation paths are retained for traceability but were not independently checked. Outcome narratives summarize evolution; the historical checkpoints below retain earlier pending/dormant and later active/retired states separately. A later state does not make the earlier statement false at the time. Absent explicit evidence, completion is not inferred. Detailed source history remains in the earlier revision.

## Consolidated outcomes

### 01. Shared scoreboards and game-section presentation

Merged evolution through 2026-09-06. `CompactGameScoreboard` replaced separate Overview Live, Featured, Recent-finals, and Schedule/Postseason presentations. Fixed away-to-home order, right-aligned scores, and position-independent winner/leader emphasis replaced inconsistent summaries. Featured retained its selection contract and an optional context slot for future explanation. Schedule now keeps the scoreboard visible; only venue, odds, conference, and postseason-admin details sit behind an accessible More/Less disclosure.

- The common contract supports mutually exclusive rank/FCS prefixes, neutral-site metadata, state-gated broadcast, and optional tier-2 content that reserves no empty space. Shared status treatment uses emerald live, neutral final, sky scheduled, and accessible unknown; Matchups retains its separate neutral live pulse where green already denotes a final win.
- Scheduled rows show kickoff, live rows show the game clock, and awaiting/final rows show neither. Broadcast appears on scheduled/live/awaiting rows. Schedule remains kickoff-sorted within date groups; bronze eyebrow pills replace retired card-emphasis chrome.
- Non-Featured owned games progress through mutually exclusive Watchlist → Live → Recent finals. Unusable post-kickoff scores remain `Awaiting score` for the shared eight-hour abandonment window; usable finals promote immediately. Recent finals is complete independently of the curated recap and expires at Thursday 06:00 ET.
- Slice 5b added caller-supplied `isCardOwnerTeam` tinting with seamless adjacent marked rows. **No caller was wired by that slice**, so it introduced capability without changing existing renders. The tint remains `dark:`-gated.
- **Schedule and Postseason do not render team records.** The attempted timestamp-only finalization gate was removed because it discarded game identity and blanked the whole projection; Item 139 owned shared completed-game reconciliation at closeout. Overview's prior records feed was unchanged. The earlier finals-record join blocker was GitHub issue #548; it is an issue reference, not a PR.
- Provider classification is absent from 2018–2024, so the FCS prefix is intentionally unavailable there. Contrast corrections raised small text to zinc-400; loss of one color-hierarchy step was accepted. The owner declined disrupted/placeholder presentation changes after finding no disrupted provider statuses in the measured 2024–2026 schedule population; that decision is not proof such statuses can never occur.

Supersedes the original one-line Schedule collapse, orphaned `GameScoreboard`, and earlier Overview-only status treatments. Later ordering decisions are consolidated separately below.

PR references: #241, #531, #535, #537, #541, #549, #570, #572, #575.

### 02. Overview ordering and removal of competing presentation state

Merged through 2026-09-04. Overview game sections now appear Featured → Live → Recent finals → Upcoming watchlist. Kickoff orders Live ascending and Recent finals/Featured descending; the watchlist retains its curation score above kickoff. Owner-count tie-breaks were removed, including the upstream selector that determines which Featured games survive the cap. Featured finals no longer carry a kickoff date/time.

`OverviewContext` shrank from seven fields to the sole consumed `{ scopeDetail }`. Unread `sectionOrder` and descriptive copy had contradicted the actual JSX; deleting them removed a second, drifting model of presentation. The recorded section-order decisions live in the Item 87 campaign documents.

Earlier Overview work established section dividers instead of redundant outer cards, equal podium cards with champion-only accent, an AP/CFP poll snapshot, compact standings/insights composition, and a games-back race with its companion table as legend. Champion margin is described in games back, with Win% used as a tiebreaker. Later ordering and shared-scoreboard rules supersede the earlier layouts and owner-priority sorting; the owner-color implementation is recorded under theme/navigation.

PR references: #562, #563, #564.

Documentation: `docs/campaigns/item-87-followon-section-ordering-resolutions.md`, `docs/campaigns/item-87-followon-section-ordering.md`.

### 03. NoClaim presentation and distinct-game counting

Merged 2026-09-03–05. Schedule, Postseason, and Matchups stopped presenting `NoClaim` as a league member. Matchups has no sentinel owner card, opponent badge, or count-only excluded-games section; expanded Schedule names use provider casing for non-catalog participants while preserving catalog labels. Durable roster/ownership data was not rewritten.

Item 135 changed the disclosure to count **distinct games**, make collapse actually hide rows, and render a self-owned game once. Rekeying by opponent identity would not have fixed the shipped defect: confirmed drafts write a truthy `NoClaim` owner for undrafted teams, so fixtures that omit those roster entries misrepresent production. Unowned opponents previously collapsed onto sentinels, and a two-owned-team game produced mirrored rows.

**Boundary:** slate aggregates still double-counted self games at closeout (Item 136), although list rows were deduplicated and the W–L record was correct. Both `matchups.ts` and `ownerView.ts` consume those aggregates; this was not a completed aggregate fix.

PR references: #560, #571.

### 04. Browser polling, freshness, and member live signals

Merged through 2026-09-05. Visible current-season tabs poll the full eligible live-score partition set every 90 seconds while an eligible game is within kickoff −15 minutes to +8 hours without a usable final, then every 180 seconds. A usable final requires final status and both numeric scores; incomplete evidence stays fast until the ceiling. The separate three-minute provider cron remains the writer. Item 128 first removed the redundant team-catalog read from every browser poll; the estimated display-staleness improvement was about 45 seconds, not a measured provider-speed increase.

The confidence layer says preparing only near kickoff, waiting only for an eligible missing score, and tracking only when a recent exact-partition observation attaches an in-progress score in the same read. Known disruptions suppress unsupported claims, and the accessible status region remains mounted while idle.

Overview standings retains a green provisional W–L badge during ties or stale reads, using `+0–0` for tied/unavailable numeric live scores and last-known evidence for copy. Current game state controls visibility. The existing fresh-only accessor for Standings/Members remains distinct. Per-game freshness was not delivered: durable snapshot time, clean client observation time, and the seven-minute stale-overlay policy must not be treated as interchangeable.

PR references: #495, #539, #567.

### 05. Team-records cache, refresh authority, and historical backfill

Merged 2026-08-31. One year-wide CFBD records cache keyed by numeric `teamId` and an arbitrary-year refresh authority replaced any need for consumer-specific fetching. Prior-good data survives empty, invalid, failed, or stale observations. The live-scores cron can invoke records refresh after a newly committed final, at most once per run behind a durable six-hour provider-call floor; an authenticated hourly QStash job adds an independent twelve-hour ceiling.

The reader withholds rows whose W–L–T outcomes do not equal games, while preserving a distinct uncreditable-team signal. The subsequent fourteen-hour health threshold counts such rows as present and supersedes the initial eight-day diagnostic. This threshold assumed the hourly job remained unpaused; lifecycle-aware pausing was not part of the delivered cache contract. Score commits invalidate standings before awaiting the optional records request.

A deliberate production one-off populated 2018 and 2021–2026 with seven CFBD calls: respectively 687, 670, 672, 672, 679, 681, and 684 rows, all reported `written-clean` and verified read-only. This was an executed backfill, not a new repair button. Historical completed seasons were treated as immutable for that operation. Initial cache delivery had no consumer; subsequent consumer limitations, especially Schedule's absent records, are recorded under shared scoreboards.

PR references: #543, #546.

### 06. Canonical standings, finality, and warm-on-write

The standings campaign replaced competing render-time merges with one settled server authority, `getCanonicalStandings`, and a separate client `liveDelta` overlay. Overview, Standings, Members, Matchups, and active-history reads adopted it. `NoClaim` is separated at derivation; settled rows, chart history, and color ordering agree across consumers. Per-request deduplication wraps cross-request caching, with slug/year identity and mutation-driven invalidation. Request handlers capture time for derivations rather than freezing `Date.now()` decisions inside cached selectors.

Later week-resolution/coverage work requires real game conclusions and numeric points for score-bearing results before declaring standings resolved; all real games must resolve before season finality. Member copy says “Waiting on complete results” without guessing the cause. Bulky per-game pending payloads are stripped only after explicit season context has been derived from the complete canonical snapshot. Rankings source matching was narrowed to exact FBS poll names so lower-division Coaches polls cannot contaminate it.

PLATFORM-119 made score writes synchronously invalidate and repopulate registered league/year standings keys after the durable commit, with non-fatal warming failures. A process-wide queue is entered before the year transaction so concurrent warmers cannot occupy all three pool clients while nested reads need another; year locks retain cross-instance ordering. The proposed response filter was withdrawn on a canonical-week correctness finding, not shipped. Later score/record reconciliation remains separate from cache warming.

PR references: #547.

Documentation: `docs/campaigns/standings-ownership.md`, `docs/architecture/week-resolution.md`.

### 07. Trend drawability and truthful preseason origin

POLISH-013/014 were promoted 2026-08-25. Overview trends share one drawability authority and explain sparse data instead of rendering empty axes or discarding useful week-one context. Games-back charts may show a separate Preseason origin only when no game concluded before the first plotted week. It is not canonical week zero and is absent from midseason windows and incompatible legacy/played history. Extending this treatment to archived season-arc axes was not part of delivery.

PR references: #510, #511.

### 08. History, career records, and retirement of the backfill surface

P4C/P4D established season detail, league history, and owner-career pages over pure archive selectors. `SeasonArchive` gained `games` and `scoresByKey` because cumulative standings cannot reconstruct individual pairings; legacy archives without them degrade to unavailable game-derived panels. Historical caches enabled the executed 2021–2024 import without advancing league lifecycle. Later analytics provenance and repairs are recorded under the game-stats rebuild.

- History exposes championships, final standings, season arcs, rosters, superlatives, rivalries, droughts, improvement, career totals, and per-season head-to-head detail. H2H excludes same-owner games and `NoClaim`, stores a stable owner-pair orientation, and displays the actual leader first. The original standings-based upset proxy uses the previous week and excludes Week 1; it is distinct from the later odds-upset policy.
- All-time ordering evolved from championships-first to **Total Wins → Win% → Point Differential**. Live-season contributions do not award a championship or increment completed seasons; active history later adopted canonical standings rather than independently rebuilding an archive.
- HISTORY-RECORDS Phase 2 added the league-arc overview, contextual championships/rivalries/movement, recent podiums and finish trends, marquee records, responsive dense-table degradation, and History deep-link infrastructure. Placeholder subtabs were infrastructure, not evidence their full content shipped. Mobile records later gained stacked podiums, 44px controls, and Active-only membership from the confirmed roster with a latest-archive fallback.
- Owner career identity remains name-based across seasons: a name change creates a separate career entry. Route parameters are already decoded; double-decoding broke names containing `%`. Missing current rosters can fall back to archive membership where specified; historical champions must not disappear merely because they departed.

**Backfill supersession:** the standalone “Historical Season Backfill Endpoint” duplicated the P4D account. The original route could write on a purported preview when no archive existed and could accept the active season. F2H2A retired `POST /api/admin/backfill` and its panel on 2026-08-07 rather than hardening a one-time import into a permanent feature. `buildSeasonArchive` and `saveSeasonArchive` remain maintained for rollover and deliberate one-off repairs. Older references to a supported preview/confirm backfill UI are historical only.

PR references: #201, #204, #207, #278, #312, #313, #456, #497.

Documentation: `docs/campaigns/history-records-phase-2.md`.

### 09. Insights engine, context, membership, and copy policy

The Insights campaign extended the existing selectors with registered generators, centralized context, lifecycle gating, per-generator failure isolation, priority selection, and an API backed by direct server-side cache/store reads. Owner aggregation stays in the shared game-stats authority; generators do not fetch providers or parse rosters themselves. Career context is assembled from season archives at query time, including points against, titles, finish history, and rookie status, without storing parallel career totals.

Historical, rivalry, career, statistical, and milestone families were delivered, including ball security, takeaways, possession, third-down performance, team identity, career leaders, volatility, title chasers, trends, and milestone/perfect-against facts. Trending requires strict monotonicity, not just a favorable net change. Defined-but-unconsumed `InsightWindow` and the brainstorming proposal for cache-time AI pairing copy were not completed features; the two brainstorming entries are absorbed here as planning provenance, not a delivered-feature inventory.

Copy variation uses pure context-derived hooks and a primary numeric value, with deterministic templates rather than random wording. Suppression is league/season-scoped; an owner/hook change can constitute a new fact. Rollover clears suppression only after archive and lifecycle success. Later INSIGHTS-029 work stopped suppression from draining unchanged standing facts, superseding the initial once-fired treatment where applicable.

Membership and team ownership became separate inputs. Subsequent work added safe preseason career facts, the correct league-record population, self-play and roster/schedule narratives, membership-change events, a year-framed completed-season recap, and diagnostics of generated → served → Overview output. Early “current roster only” rules therefore do not describe every later historical consumer.

INSIGHTS-022 widened rookie-benchmark eligibility into ordinary offseason and removed “Returning owner” copy: an archived roster proves past participation, not future commitment. It did **not** remove the engine's archived-roster suppression rule; that attempted widening was reverted. Neutral historical copy is valid without a fabricated prefix, and the policy change versions the insights cache. Identifying genuinely returning owners requires finalized upcoming membership and was not delivered by that slice.

PR references: #276, #278, #464.

### 10. Insights presentation and truthful destinations

The design-only five-insight panel checkpoint is absorbed into its implementation. Overview gained five uniform insight rows, category labels, full-row links where a real destination exists, and a dedicated Insights page. First-row visual prominence was removed pending ranker maturity. Historical/rivalry insights resolve through a panel-layer router; generators and payloads are not mutated merely to choose a link.

Season-wrap links target the completed season's history, using the latest archive year rather than inferring it from the league's active year. Both direct Standings navigation and in-place tabs received that context. Types lacking a page that displays the cited statistic intentionally receive no arrow. The dedicated page also gained offseason roster fallback and correct local-development protocol handling. Later membership/copy changes and dark-only policy supersede its original returning-owner framing and light-mode palette behavior.

### 11. Weekly recap — skeleton through final rendering

INSIGHTS-026a–f merged 2026-08-28–29; these entries did not independently verify production promotion. Their initially unwired fact families were connected by 026f, so they are one delivered request-time Look Back.

- A pure selector and cache-only loader target the immediately preceding eligible canonical week of the exact active season, keeping absent, unavailable, unresolved, abandoned, and missing-result states distinct.
- Full Insights and the collapsed Overview tile share a coherent payload, approved header, and owner W–L/PF/PA grid. The tile refreshes at the schedule-independent 06:00 ET boundary and survives schedule bootstrap failure; standing insights survive recap failure.
- Enrichment includes explicit-week movement, distinct-owner matchups, high scores, closest games/blowouts, accolades, six active-season-safe record families, and odds upsets. Canonical ownership/finality governs live evidence, self-owned games deduplicate, placeholder owners do not create facts, and newest tied occurrences retain change context. Partial active seasons do not enter completed-career accumulation.
- Odds facts read the season-scoped durable store without a provider/HTTP call. One shared six-point pregame-spread policy serves badges and recap; asymmetric lines use the favorite's own spread.
- The full page renders all completed families; Overview discloses dense sections progressively and shows at most three prioritized highlights. Archive/odds uncertainty suppresses only that enrichment family. Shared canonical scoreboards replace a dead predecessor pulse model.

The durable event-source artifact and Thursday Forward Look were **not delivered** by this campaign. The favorite-pairing producer defect was fixed later under PLATFORM-123, recorded with Odds.

PR references: #519, #521, #523, #525, #527, #529.

### 12. Draft system — setup, live event, publication, and neutral selection

P5A–D's umbrella, live-board details, and duplicate initial account are consolidated here with later timer/UI changes and the explicit retirement of draft assistance.

- Durable draft state lives at `draft:<slug>/<year>`. Server-validated transitions govern setup, settings, preview, live, pause, and completion. Setup supports owner ordering, scheduled start, timer/expiry behavior, and bounded rounds derived from the FBS pool and owner count; the later floor-based cap supersedes the initial ceiling suggestion.
- Pick, undo, edit, reset, and expiry operations use canonical team resolution; snake ownership is derived, duplicate picks refused, drafted teams removed from availability, and reset returns to setup. Confirmation hands off RFC 4180 `team,owner` CSV at `owners:<slug>:<year>/csv`, with equal per-owner counts and `NoClaim` for the eligible remainder. Downstream league features consume ownership, not draft state. Reopen preserves the prior published roster until reconfirmation.
- Timers are server-authoritative and persisted exactly as returned. DRAFT-001 protected existing correct main behavior against a stale-branch regression; it did not fix a production persistence defect. DRAFT-002 moved round-boundary pause into both manual and automatic pick paths, replacing the client second request. DRAFT-003 starts a display-only optimistic countdown for eligible mid-round picks; it never enters the request or decides expiry. The earlier implicit-next-round behavior is not the final timer contract.
- Commissioner and spectator boards share the header, team identity/color cues, available-team search, and responsive snake grid/carousel. The public summary retains admin-gated editing/confirm/reopen controls; archive-derived facts stay server-side. Later auth work gates protected server rendering before serialization. Phase-aware polling retains slow completed-draft reads to detect reopen rather than stopping entirely.
- **SP+ ratings, betting win totals, recommendation tiers, their routes/panels, and `autoPickMetric` were retired by F2G1.** Neutral alphabetical ordering with a stable canonical-id tie-break is shared by commissioner and spectator. Identity, conference, schedule shape, prior-season record, preseason AP rank, and ranked-opponent counts remain factual context; missing values omit their UI. Auto-pick remains random. Game-card Odds was not retired.

Later publication/readiness and serialized concurrent-mutation guarantees are consolidated under season setup; “last pick complete” must not be treated as “roster published.”

PR references: #210, #211, #213, #214, #319, #320, #321, #440.

Documentation: `docs/architecture/admin-control-plane.md`.

### 13. Season setup, owner confirmation, and draft readiness

The P7A/P7B setup iterations converge on a repeatable preseason flow: confirm owners, choose draft/manual assignment, assign teams, publish, and complete setup. Saved preseason owners are preferred, with archive/live-roster fallbacks for prepopulation; confirming owners is a distinct fact from raw CSV presence. Draft pages resolve lifecycle year consistently, and new leagues enter reachable preseason setup. Setup messaging describes observed roster/draft facts rather than inferring readiness from lifecycle alone.

“Go Live” was decoupled from immediate season transition and became setup completion, stored on the preseason status. Daily automation owns the real season transition; sandbox controls support repeatable dry runs. PLATFORM-091–096/099/100/102 later made publication durable and distinct from the final pick, improved editing/reopen/reset navigation, treated `NoClaim` as unowned for sorting, and serialized existing-draft mutations so concurrent expiry, pick, undo, reset, and reopen cannot erase each other's work.

The duplicated Founded Year records introduced `Est. <year>` and removed hardcoded history subtitles; later F2J **froze founding year after creation**, with narrowly verified recovery support, as recorded under registry management. Likewise the early editable league-year and direct Go Live descriptions are superseded by guarded lifecycle authorities. Team aliases were promoted from year/league administration to a global Team Identity surface; they are not season-setup data.

PR references: #270.

### 14. Clerk integration and independent authorization boundaries

Phase 6 installed Clerk and server role checks, replaced the hardcoded single-league entry route, and introduced public versus admin experiences. Session role metadata requires an explicitly customized session-token claim; a third-party JWT template is not a substitute. Login uses catch-all routing for multi-step sign-in. The migration defined several role names but enforced platform admin; their presence did not implement commissioner write authority. Historical token-sunset intentions are not proof the fallback was removed.

Season-launch hardening moved protected draft access checks before server serialization, removing the leak that client redirects could only hide. It retained public spectator/summary access and phase-aware polling (live/running fast, completed slow enough to observe reopen). Preseason standings gained truthful awaiting-kickoff context; zero-game insight output was suppressed and cached selectors returned stable facts for render-time time evaluation.

F2H1SA/SB closed two independent live security gaps. Explicit `/admin/:path*` and `/debug/:path*` matcher entries ensure dotted dynamic paths such as `/admin/audit.css` cannot bypass middleware as supposed static assets. Every exported app-owned admin Server Action then gained `requireAdminAction` as its first executable application operation: routing is defense in depth, not action authorization.

The shared decision distinguishes authorized, missing Clerk secret, non-admin, and unavailable auth; the action guard uses the session-only form, preserving existing request-bearing API behavior separately. Refusals throw stable errors and allowlisted events without secrets. Framework deserialization and Clerk's own reads occur before/within that boundary, so “zero reads of any kind” is not claimed. Middleware remains an independent boundary. Owner-facing refusal handling, broader asset-matching policy, and dependency-owned actions were not all resolved by these slices.

PR references: #216, #217, #221, #222, #223, #224, #225, #226, #227, #302, #303, #304, #446, #447.

Documentation: `docs/archive/designs/phase-6-admin-auth-design.md`, `docs/campaigns/season-launch-hardening.md`.

### 15. Admin information architecture and maintenance operations

Phase 6's repeated page restructures and F2's umbrella/slice records describe one evolution from accumulated tools to explicit operator responsibilities. F2 closed on 2026-08-08.

- `/admin/diagnostics` became **System Health**: observation plus global pause/dataset safety controls. Manual provider refreshes, partition inputs, team sync, and the score-attachment trace moved to **Data Maintenance & Recovery** at `/admin/data/cache`.
- One presentation-only maintenance-action contract discloses provider, nominal cost, live target, durable mutations, automation owner, and routine/recovery/emergency class. It does not become another execution authority. The emergency attachment trace captures one target for disclosure, confirmation, request, and result; it warns that a trace alone does not prove upstream success.
- Feedback is attempt-scoped, including across year changes; invalid scope never silently broadens a request. Historical-score repair gained truthful year-rollup refresh status, schema/empty checks, no empty commits, and partial-write versus no-op reporting.
- League administration uses registry-derived links and separate settings/roster destinations, with reserved static slugs and consistent navigation. Public league views no longer contain the legacy Admin/Debug panel. An admin-only gear is server-derived rather than a client role authority.

Earlier inventories of `/admin/season`, rollover/backfill panels, SP+/win totals, and per-league alias tools are superseded by their later retirements or relocations. F2's manual cross-browser/keyboard/screen-reader pass was explicitly moved to separate pre-public-launch work; campaign closure does not assert that pass occurred. Governing principle: a backend subsystem earns an admin surface only when a person has something useful to inspect, decide, diagnose, or operate.

PR references: #228, #230, #231, #232, #233, #234, #430, #432, #433, #434, #463.

Documentation: `docs/architecture/admin-control-plane.md`.

### 16. League registry, slug recovery, and founding-year integrity

F2I/J merged 2026-08-08. `/admin/leagues` owns create/list/delete; configuration lives at `/admin/<slug>/settings`. Delete requires the actual slug at the route boundary, preventing a repeated generic confirmation from authorizing the wrong row. Registry deletion does not erase surviving league-scoped data; full privacy erasure was explicitly outside this work.

Creation at a slug with residual data refuses by default but supports explicit `adoptExistingData: true` for legitimate recovery. Exact scopes and colon-delimited families prevent a slug such as `tsc` from matching `tsc-old`. The residue scan runs unconditionally, and adoption on a clean slug is rejected; a flag cannot establish its own eligibility.

`foundedYear` means founding calendar year, not first competition season. It is immutable through `updateLeague` after creation, with a recovery-only value when adopting verified old data. This supersedes P7A's editable field while preserving restoration of an accidentally deleted league. “Aliases” became “Team Identity”; the season-scoped debug editor was intentionally untouched.

The audit established that league passwords gate reads and league writes still require platform admin—no distinct commissioner authorization model was delivered. Admin labels gained control associations, and the settings/password flow gained coverage. JSDOM import-order repair was established in `src/test/domEnvironment.ts`; migrating all older suites was not completed.

PR references: #462, #463.

### 17. Guarded lifecycle, rollover authority, and surface retirement

Early manual rollover and Go Live paths were progressively replaced by guarded transactional lifecycle operations. Accepted preseason/season changes synchronize the compatibility `league.year`; offseason retains the outgoing season year. Generic configuration cannot mutate lifecycle year, and rendering performs no durable repair. Guarded writes re-read state and exact year under the registry transaction so stale snapshots, concurrent deliveries, deletion, and changed target years cannot silently overwrite each other.

Automatic rollover groups production leagues by year, requires a structured CFBD national championship plus a canonically attached complete final and the seven-day buffer, then performs archive-first execution with guarded season→offseason transition. The old latest-postseason-game fallback was removed. The daily cron is the sole rollover executor and does not honor ordinary provider-pause controls.

The manual path first shared the strict gate, then lost execution (F2H3A), then its preview, `/api/admin/rollover`, `manualRollover.ts`, `diffSeasonArchives`, and `/admin/season` were retired entirely (F2H4, 2026-08-07). Advancing an already-eligible daily rollover by less than 24 hours was not a distinct recovery capability; a preview of an automatic write with no supported prevention action was not useful enough to retain. League History already navigates archives. Builders, save/list authorities, and guarded rollover remain live.

Execution reporting preserves committed work even if later invalidation fails. Demo-only exclusions have truthful no-automatic-target reasons. Suppression clearing follows confirmed archive and status success and is no longer accidentally skipped solely because cache invalidation failed. Benign idempotence, healed year projection, removed league, and stale target are distinct dispositions. The transition route gained a 300-second envelope under the documented deployment configuration.

PLATFORM-111 aligned transition and member start placeholders to the earliest UTC date with a catalog-resolved participant, using durable catalog/global aliases and falling back to the earliest parseable date. The all-division schedule stays intact; exact kickoff time does not define lifecycle date. A post-commit probe failure reports partial work.

**Limits at closeout:** commit-to-invalidation interruption remains possible; mixed-year rollover reasons can collapse to `year-results` on receipts while individual reasons remain in runtime events. Removing the preview did not implement per-year dashboard explanations or missing-status production recovery.

PR references: #278, #431, #441, #442, #443, #457, #458, #461, #514.

### 18. Manual-only demo lifecycle and shared-data isolation

F2H1T1–T5 plus H3B1 made `TEST_LEAGUE_SLUG` manual-only. Slugless set/reset authorities validate and derive state inside the registry transaction; unsupported states and unusable years refuse without mutation. Reset can recover corrupt demo status. The arbitrary-slug lifecycle setter was retired. Post-commit cleanup no longer deletes year-shared `schedule-probe` data, preventing sandbox resets from disarming production automation.

Season transition, weekly schedule maintenance, rankings targeting, and System Health operational-year selection exclude the demo before grouping or precedence resolution. Filtering entire resolved years would wrongly remove a production league sharing the year. Weekly ownership can affect actual provider policy; the equivalent rankings lifecycle label was only reporting metadata and is not described as the same operational defect. Existing year/global provider evidence, latches, probes, and publication windows remain intact.

No-automatic-target reasons distinguish excluded demo candidates from genuine absence. Demo-only years do not generate provider work through these jobs; no league-scoped duties were invented for provider-only jobs. The demo season transition does invalidate standings, because the previous cron had owned that responsibility and the year cache key does not change across the state flip.

Lifecycle presentation distinguishes stored state, inferred display, and the authority that advances it. Missing stored status does not imply either automatic or manual control. Typed persistent demo feedback superseded raw exception messages that production Server Actions redact; repeated preseason/reset operations must disclose cleanup rather than claim no change.

The exclusions were not a universal demo-data refresh facility. Some demo rankings years remain outside manual upkeep bounds, and the source retained further cache-invalidation and shared/default-year follow-ups. The final manual-control clear/replace message flow itself lacked automated integration coverage at closeout.

PR references: #445, #448, #449, #450, #451, #459.

Documentation: `docs/operations/diagnostics.md`.

### 19. Registry integrity and honest target refusals

F2H1R1–R4 completed container-truth handling across transition, weekly schedule, rankings, and rollover. `readLeagueRegistry` distinguishes present valid arrays, missing state, malformed containers (including stored null), and actual store failures. Existing general `getLeagues` behavior remains compatible. Malformed state is no longer reported as an empty league registry.

Production year validation follows demo exclusion and precedes provider claims, probe/cache work, and archive/lifecycle mutation. Rollover also validates requested and stored years independently under the write lock **before comparing equality**; otherwise corruption would be mislabeled as a stale target. Refusal counts are published during iteration so a later throw cannot erase already-observed invalid records. `invalidLifecycleTargets` survives response, event, and receipt; legacy missing fields normalize to zero while invalid present values reject.

Controlled QStash outcomes use HTTP 200 so application refusals are not confused with delivery failures; Vercel-native lifecycle routes retain their own failure-status contract. An unusable target remains actionable even when valid targets merely skip, while valid-year reasons remain preserved. R3's explicit acceptance of this standing warning supersedes R2's earlier objection to the aggregate. `partial` is not a universal proof that a write occurred; the result table has broader mixed-outcome semantics.

**Boundaries:** validation is structural, not a plausible-season window; individually malformed records inside a valid container remain a separate gap. Operational-year clamping is not a repair. Missing-status recovery was deliberately ordered after consumer hardening because adding status arms provider and archive automation; these slices did not deliver that recovery. Cross-job summary duplication and lifecycle HTTP-status asymmetries were recorded for coordinated follow-up.

PR references: #452, #453, #454, #455.

### 20. Provider controls, scheduler receipts, and System Health

F1/F2 merged through August; later game-gap diagnostics extended the same model. Provider toggle failures now render beside their controls with accessible associations; settings remain authoritative, with no optimistic success. Runtime events include skips, auth failures, and failures through a single best-effort emission path, using allowlisted primitives rather than credentials, payloads, or exception text.

All seven then-scheduled jobs gained latest-only durable receipts: five QStash jobs plus two Vercel lifecycle crons. Application invocation ids are created only after successful auth; unauthorized requests never advance a receipt. Writes run best-effort after the response with monotonic `(startedAt, invocationId)` ordering. Readers validate and rebuild allowlisted fields. This delivered durable receipt identity, **not proof that every runtime event already carried the same invocation id**.

Delivery classification compares receipt start to the prior due UTC slot plus grace, including uneven rankings slots and the Vercel daily window. A timely failure or skip is still an on-time delivery. Missing/late evidence does not identify the cause. System Health keeps delivery, execution, provider data freshness, automation gates, quota, and storage separate; its seven-job and six-dataset populations are not one-to-one.

The server-rendered operational-year dashboard uses bounded loaders, prioritized issues, persistent forensic rows, and truthful nullable repair destinations. Freshness comes from cache/evidence, never last provider success. Storage display describes configuration, not database liveness. Gates alone do not erase delivery warnings or degrade overall health. The UI introduces no browser provider polling. Historical quota thresholds reflect the then-active policies; this ledger does not set subscriptions or budgets.

- Game-stats absence is neutral `None expected` only when canonical applicability says no evidence is owed. Actual expected missing data warns; green requires positive evidence. Applicability, not coverage-denominator heuristics, answers this question.
- `lifecycle-data-unusable` is a global warning based on refusal counts independently of run result, with `repair: null`. Counts from different jobs/runs cannot be summed into a unique league count; the issue names reporting jobs. It affects Overall without contaminating Provider data, so green section tiles beneath a yellow Overall can be correct.
- PLATFORM-112 checks each addressable expected completed game against its own attached terminal score; one final cannot hide a missing sibling. Canceled games can resolve scorelessly, and shared disruption/placeholder policy remains authoritative. Output retains full counts plus at most six sanitized identities.
- PLATFORM-113 separately exposes unresolved games admitted by the eight-hour all-pending allowance, including aggregate and child cache layouts; it does not replace completed-slate coverage checks.

Receipt data is latest-only, not execution history. Mixed-year reason detail and production lifecycle repair remain limitations; no ineffective repair button was added to conceal them.

PR references: #413, #414, #435, #436, #437, #438, #439, #460, #470, #516, #518.

### 21. Provider refresh outcomes, empty payloads, and quota truth

PLATFORM-086A/G1/G2 established typed per-target durable refresh status, attempt ordering, completion-token rejection, operator settings, durable-first success, and context-aware empty/schema handling. CFBD became the normal production score source; automatic ESPN fallback was removed. The original Provider Data Status panel later gave way to System Health and Maintenance rather than remaining a second admin model.

CFBD empty scores are failures when exact-target prior-good rows or started non-disrupted canonical games establish an expectation; genuine future/absent/canceled-only targets remain no-ops. Independent cache evidence sources resolve independently, including child-only layouts. Unexpected empties preserve prior-good state and do not advance success.

Odds validates the body and nested structures before commit while capturing quota headers independently. Empty interpretation uses canonical identity certainty: only provably obsolete rows may be cleared; ambiguity/unavailable identity authorizes neither destructive replacement nor a fabricated failure. Postseason placeholders can intentionally retain prior lines. Later early-line handling extends this policy under Odds automation.

Missing/malformed quota fields mean unavailable, not exhausted or a guessed tier; trustworthy zero remains zero. Odds usage distinguishes available, absent, and unavailable. File fallback tolerates only genuinely missing files, not corruption. Original monthly tier references are historical configuration, not an ongoing cost guarantee.

PR references: #391, #394, #395.

### 22. Game-stats rebuild, evidence provenance, and production activation

The initial `/games/teams` pipeline cached per-game statistics by year/provider-week/season-type and aggregated owner totals at query time through centralized identity; 2021–2025 were backfilled. Its weekly cron and legacy ingestion were superseded by the staged H1/H2/H3 rebuild. Dormant milestones were preparation, **not separate current implementations**.

- **Contract and merge:** one category authority (26 recognized, six analytics-required), strict parsing, structural points evidence, schema-aware row interpretation, deterministic duplicates, and bounded legacy compatibility. Per-game RFC 3339 observation fences reject older evidence, preserve missing games/categories and prior valid values, and allow newer identical observations to advance freshness. Compatibility-only values do not establish strict analytics completeness. `completionAttempts` remained observed but unmodeled.
- **Transaction truth:** one dedicated database client owns lock/read/write/commit; partition→control lock order prevents deadlock. Confirmed writes, unchanged/stale/conflict outcomes, known-unchanged failures, and indeterminate durability are distinct. A lost commit acknowledgment after submitted mutation is not proof of rollback; reread before deciding recovery, and do not return an uncertain client as healthy.
- **Rollout fence:** reconstructible provider projections did not justify the proposed permanent revision/restore ledger; that design was rejected. Strict writer control uses `legacy ⇄ armed → active ⇄ read-only-safe`; absent/malformed control is never implicitly legacy. The legacy writer is permitted only in legacy, the replacement only in active, with control rechecked under the same transaction. Initialization is create-if-absent, not repair. No return to legacy is allowed after activation.
- **Evidence:** canonical schedule builds own expectations and attachment keys. Unique provider game id plus partition associates rows; later C5 additionally verifies numeric, side-for-side provider participant ids. Names, aliases, and neutral-site flags do not substitute for that verification. Schema blockers precede ranking; only verified candidates can satisfy/publicize evidence. Missing or mismatched ids fail closed, never displacing a verified sibling.
- **Analytics provenance:** finality is an analytics rule, not a persistence rule. Canonical final scores must join by `AppGame.key`, and stats must be complete and verified. C4 removed the mistaken coupling to the six-hour missing-data threshold: sub-six-hour final+complete games can publish immediately. In-progress evidence remains stored for future uses. Archives carry a strictly validated `gameStatSlate` from the exact build that produced their games and pair it only with their own score map; absent and malformed snapshots are distinct.
- **Ingestion and polling:** one adapter connects an already-fetched response to the contract and durable merge; one interpreter governs route/cron outcomes. Scheduled polling selects at most one earliest unresolved partition for addressable stat-producing games aged [3h, 24h), excluding satisfied evidence. It is not score-gated. The delivered reserve policy requires trusted remaining usage of at least 1,002; manual below-reserve requests need a separate explicit override. Bounded recovery leases/backoff were not secretly included in the rollout-safety slice.

**Executed correction and activation:** schedule identity/participant repairs, full 2021–2025 refreshes, collision/parity audits, and five archive rebuilds were completed before activation. The genuine 2024 Texas–Georgia game and paired snapshots were verified. CFBD game `401506450` (2022 Akron–Buffalo) remained the accepted analytics-incomplete residual. Source evidence records writer transition to active on 2026-07-26 at `a161e33`, a successful controlled 2025 week-16 refresh, QStash `turfwar-game-stats-15m` with retries zero, gated auth proof, and subsequent gates-open no-target deliveries without quota spend. Both final closeout items were completed, including restoration of automatic production-domain assignment.

The QStash move replaced the subdaily Vercel cron rather than changing the route contract. The original source's remaining “activation pending” text is superseded by its explicit completed closeout. This historical activation does not certify present scheduler settings or reconcile provider corrections after a game becomes satisfied.

PR references: #274, #275, #396, #397, #399, #400, #401, #402, #403, #404, #407, #408, #409, #410, #412.

Documentation: `docs/ai/game-stats-writer-fence.md`, `docs/ai/platform-086h3-contract.md`, `docs/ai/platform-086h3c1-implementation-handoff.md`.

Supporting lineage: the original preamble also names H3A (PR #398); the writer-fence architecture and detailed activation procedure remain in `docs/ai/game-stats-writer-fence.md` and `docs/deployment-runbook.md`.

### 23. Schedule identity, classification, and removal of parallel models

These fixes address separate defects in the same canonical path; they are consolidated without treating alias resolution, provider classification, and game identity as interchangeable.

- Unsafe two-token-prefix aliases caused University of San Diego stats to be credited to San Diego State. Both generators were narrowed; curated overrides remove `sandiego`, preserve legitimate shorthand, and add `sdsu`. Overrides sanitize stale durable catalogs at read time without rewriting them, and their hash versions standings/insights cache identity. Central `teamIdentity.ts` was not replaced.
- Explicit non-FBS classifications suppress inferred CFP and conference-championship slots. Token-boundary conference matching prevents the `sec` in “Second Round” from becoming the SEC. Canonical collection is deterministic across input order: distinct numeric provider ids never merge, ids survive fragment merges, and ambiguous fragments fail closed. This prevents hybrid games with one record's participants and another's id.
- PLATFORM-114 uses CFBD's per-row division labels for eligibility instead of reconstructing division from conference/name matches. Missing-label fallback remains, narrowed so an unresolved/ambiguous conference cannot invent a below-FBS classification. That fix required an authorized full-season refresh to change old durable rows; merge alone was not a data migration.
- PLATFORM-120 filters only regular-season rows with both normalized classifications known non-FBS out of hot live-score/game-stats builds. FBS–FCS, uncertain classifications, and every postseason row remain; full durable schedule/API data and raw evidence for metadata/duplicate rejection remain available. Provider week 1 can no longer become canonical week 0; this did not replace the broader scalar canonical-week model.
- The unused hardcoded postseason template was deleted rather than revived. Its fixed championship/bowl weeks were already wrong for 2026 and it omitted CFP first-round slots. Provider-driven classification remains the maintained model. Its slot-number convention was recorded for later CFP collision work, not implemented merely by deleting the file.

The early corrupted 2024 archive was subsequently repaired during H3E preactivation; it is not left as an outstanding migration here. General vanished/replacement-id repair and CFP event-key follow-ups were outside these delivered fixes.

PR references: #405, #406, #411, #524, #551, #565.

### 24. Full-season schedule authority, weekly ownership, and enrichment

E1A converged full-season writers on one year authority: prior durable read, token-safe lease, regular+postseason validation before aggregate commit, observation ordering, durable-first publication, and standings invalidation only on content change. Unknown/failed partitions and empty-over-populated replacements retain prior-good data; genuine empty absence is distinct. Targeted child writers were outside that convergence. Historical repair cannot bypass lifecycle-active-year guards with `force`.

E1B/B1 closed preseason maintenance gaps with explicit job ownership: daily transition owns unarmed discovery and the final seven-day approach to first game; weekly maintenance owns earlier cache-armed preseason and ordinary active-season upkeep. A sticky postseason-boundary latch makes lifecycle-critical maintenance pause-exempt. Settings gate ordinary work, not critical transition/boundary work; mixed years are handled once under their owner. Source records weekly QStash activation on 2026-07-29, Tuesday 12:00 UTC, with provider-free gate proofs.

E1C's media and venue caches enrich display without owning kickoff or game identity. Media joins by exact provider game id; venue display fills by venue id; invalid/conflicting payloads retain prior-good evidence. Independent leases, observation-ordered commits, a 30-day venue TTL rechecked after lease acquisition, and bounded memo visibility prevent duplicate spend/stale publication. Primary broadcast is deterministic, and `startTimeTBD` shows date plus “Time TBD.” Enrichment failure serves base rows and cannot fail canonical schedule/lifecycle work.

Initially manual-only enrichment became eligible after both populated `written-clean` and `unchanged-clean` canonical successes, because broadcast can change while schedule rows do not. Weekly and transition call sites run after their canonical/probe/lifecycle duties; no new scheduler was required. Critical-boundary enrichment inherits that operation's exemption. The §8i live observation was still pending in these source entries; it is not asserted complete here.

PLATFORM-110 adds one best-effort vanished-id event after a confirmed changed full-season commit, retaining complete count and at most 25 identities; same-id edits stay silent. It neither repairs disappeared games nor adds provider requests. Its closeout did not verify promotion. The weekly score backstop is described separately under score automation.

PR references: #422, #423, #424, #425, #426, #512.

### 25. Live-score automation, writer convergence, and final-score backstop

B1/B2's staged engine and lock convergence culminated in recorded production activation on 2026-07-28: QStash `turfwar-live-scores-3m`, retries zero, Scores automation on, and gated no-target proofs. The dormant headings are superseded by that activation.

The cron derives targets from one cache-only canonical build in the kickoff −15-minute to +24-hour window. It chooses a global FBS scoreboard request while games remain open, otherwise one exact `/games` final-reconciliation partition, with one billed request per run and the shared quota reserve. Child partitions merge under advisory transactions against reconciled prior evidence, preserving monotonic state and per-game observation freshness. Scoreboard finals retain pending-confirmation ids until `/games` confirms numeric finals and oriented participants.

Manual repair joins the same lock protocol but retains its own authoritative replacement semantics: network work stays outside the transaction; newer/tied live observations are protected, valid manual state advances can supersede them, idless rows are uncertainty, and status/process-cache/invalidation effects follow confirmed commit. Shared locking did not erase distinct caller semantics.

Public/browser reads remain cache-only and reconcile child, aggregate, and canonical-week alias shapes. Durable snapshot time and clean client observation time are separate; final→final score corrections trigger server refresh. Per-game stale overlays were not delivered by B2B. Later browser cadence is recorded under live display.

PLATFORM-107's weekly schedule-refresh sweeper fills finals missing beyond the live window by exact provider id, filtering covered games **before** the writer. It does not rewrite an existing final; differing scores are logged. Missing/duplicate ids fail closed, and repair/failure counts reach event/receipt. Thus this is a missing-final backstop, not a general final-score correction or game-stat reconciliation pass.

PLATFORM-115 gave scoreboard/final-score, game-stats cron, and admin-score requests a shared 40-second CFBD timeout; cron remains one attempt and admin replaces three short attempts with one longer attempt. Eligibility, cadence, reserve, and unrelated provider jobs were unchanged.

PR references: #416, #417, #418, #505, #534.

### 26. Odds attachment, atomic refresh, hydration, and favorite correction

PLATFORM-030/031 made attachment event-centric: centralized team resolution, same-pair candidates narrowed by ±24-hour commence-time tolerance, and attachment only when one candidate remains. Nonattachment reasons distinguish unmatched pair, ambiguity, date mismatch, and consumed/duplicate events. Commence time is attachment metadata, not a second canonical identity or new public/durable snapshot field; older undated caches remain valid without a migration fetch.

C1/C2 converged manual/automatic refresh on one execution authority. Token-safe five-minute leases, durable backoff, a post-acquisition cadence recheck, observation ordering, and atomic raw-cache plus per-game commits prevent duplicate spend and inconsistent success. Empty classification uses transaction-fresh context. Provider URL/exception diagnostics redact query credentials; quota estimates are conservative and corrected by the next trusted probe. Automatic policy preserves 50 credits with at most one billed request and no retry.

Production activation is recorded by C2 and confirmed by C3's documentation correction: `turfwar-odds-hourly` invokes the app, which decides whether work is due. Public `/api/odds` is durable-cache-only and performs no maintenance writes; closing-line maintenance belongs to authorized refresh/cron. Cross-instance commits have bounded memo visibility.

C3 removed the old browser kickoff-window gate: stored lines hydrate once per selected season and after schedule rebuilds, even for distant or completed games. Stale-season responses are canceled; focus/navigation/live-score timers do not create periodic Odds refresh. Existing cache lines are no longer hidden simply because no game is near kickoff.

PLATFORM-089 widened target eligibility to 45 days with staged 24-hour, six-hour, and pregame two-hour checks. An hourly scheduler is not an hourly provider fetch. Far-out withdrawals are `early-lines-withdrawn` no-ops with reason-aware health handling; a completed check is not fabricated data freshness.

PLATFORM-123 later fixed favorite pairing from signed home/away spreads through the shared upset helper. New/stored snapshots and frozen closing-line **read projections** render correctly without rewriting durable closing history; pick'em retains its spread without inventing a favorite, and malformed-row validation remains intact. This closes the producer defect carried by the weekly recap.

PR references: #331, #332, #419, #420, #421, #469, #556.

Documentation: `docs/operations/diagnostics.md`.

### 27. Rankings refresh and publication-aware automation

E2A/B merged 2026-07-30 and the source's later §8j update records production activation, superseding its initial unprovisioned status. Public rankings stays cache-only with bounded durable rereads and an eight-day freshness horizon; manual and automatic work use one year authority with token-safe lease, two-partition validation, cross-year checks, observation ordering, and prior-relative completeness. Failed/empty/incomplete observations cannot erase prior-good poll weeks or sources.

The QStash heartbeat (04:00/22:00 UTC) is only a trigger. Registry-selected production years feed five ordered application publication windows: final AP/Coaches, CFP, opening-week exception, weekly AP/Coaches, and preseason discovery. Cache-only context and exact-window token-safe claims precede quota/provider work. Completed publication windows are immutable/provider-free; failed or contended attempts release claims, and unconfirmed completion reports partial. The delivered quota floor was 1,007, distinct from score/game-stat defaults.

Delayed delivery outside minute-exact slots and accumulated completion records were accepted operational properties, not silently corrected. The source retained cross-authority indeterminate-commit vocabulary and synthetic-final-poll replacement concerns. Later exact FBS poll-source matching is recorded with standings coverage; demo exclusion and registry validity are covered in their shared records.

PR references: #427, #428.

### 28. Roster upload, canonical aliases, and direct editing

The upload pipeline validates exact/alternate-name → stored alias → conservative fuzzy suggestions, restricted to the FBS pool. Fuzzy suggestions require human confirmation or an explicit picker choice; the validation endpoint writes nothing and final PUT independently refuses unresolved names. Fuzzy matching is an upload convenience, not a replacement for canonical game identity. Confirmed aliases persist globally, with an exhaustive idempotent migration of legacy league/year scopes before the migration sentinel is written.

The direct roster editor supports per-row dirty state, bulk reassignment with explicit save, and server-response resynchronization through the same ownership CSV endpoint. RFC 4180 parsing/escaping prevents quoted-name amplification, and `NoClaim`/empty ownership remain supported data. Editing, CSV import, and live drafting have distinct user workflows but share the ownership handoff. Historical year-source fixes aligned editor/upload scopes; later lifecycle-year authority supersedes earlier calendar-based defaults. Upload errors stay visible even when automatic completion bypasses the review screen.

PR references: #202, #203, #229.

### 29. Public entry, deployment branding, and shared wordmark

The original landing/admin-card iterations culminated in a server-rendered public page that reads no league registry data for non-admin visitors. Resolving access before loading data fixed anonymous directory serialization, blank no-JavaScript rendering, and signed-in non-admins receiving the admin branch. Non-admins retain a working sign-out; admin owner counts resolve each league's own season and count distinct owners rather than team rows.

Launch work established Turf War branding, production Clerk configuration, `turfwar.games`, and the dashboard-configured `tscturfwar.com` → `/league/tsc` redirect. These are recorded deployment outcomes, not a fresh domain or authentication audit.

POLISH-004 replaced unsuccessful native SVG/CSS stadium constructions with a licensed Adobe Stock photograph and shared `TurfWar` wordmark on landing/login/admin entry. Hero and lower content anchoring replaced margin tuning that fought vertical centering. Decorative-raster guidance superseded the blanket raster prohibition; temporary landing color exceptions were removed. Public HTML remains useful without JavaScript and independent of corrupt league storage.

Wordmark cleanup restored normal tracking and a 0.02em f/W join instead of blanket negative tracking that canceled the font's r/f kerning. Font family, size, and layout were unchanged; the mark remains platform-font-dependent. Full brand-identity expansion was not delivered by the stadium slice.

PR references: #272, #465, #466, #468.

Documentation: `docs/vision.md`.

### 30. Theme, owner colors, shared navigation, and responsive foundations

Earlier product-design work established underline navigation, dedicated league routes including Members, consistent History chrome and deep links, FBS Polls presentation, compact/mobile standings, chart/table-as-legend interaction, and Vercel Speed Insights. The temporary hardcoded History founding-year subtitle was replaced by league metadata. Retired selectors, props, and duplicate legends were removed where their consumers disappeared.

Owner colors evolved from hardcoded names to a dynamic alphabetical-index palette, constructed from canonical owner ordering and passed to chart/legend consumers; isolated season-arc rendering has its own valid context. Names are color-coded when they serve as a chart legend, not indiscriminately. Hover/highlight mitigates crowding at large owner counts.

**POLISH-010 supersedes light-mode delivery:** dark became the sole app theme on 2026-08-19 because the champion-accent language could not meet the small-text contrast requirement on white. `dark:` utilities became unconditional and JavaScript palette selection funnels through `isDarkTheme()`; a CSS-only change would leave light hex palettes on dark surfaces. Light base classes and exported palette parameters remain dormant for reversibility, not as completed dual-theme support. Remaining light-parameter escape paths and unwalked surfaces were recorded, not declared fixed.

PR references: #500.

### 31. Documentation ownership, verification discipline, and preview isolation

PRE-LAUNCH-TIDYUP introduced the shared test entry point and removed `papaparse`; markdownlint joined the standard lint chain with an explicit repository policy. DOCS-012 separated execution queue/deferrals, roadmap direction, prompt execution lineage, and completed outcome history. DOCS-013 recorded exact-commit review, evidence-based attribution, bounded remediation, reconstruction when scope is wrong, PR sizing, and independent unmasked gates. These historical milestones point to `AGENTS.md`; they do not duplicate or replace its current instructions.

Recurring lessons are retained once: establish the real consumer/authority before editing; test the behavior actually claimed; prove negative observers with positive controls; mutate one compiling property at a time; and do not infer runtime use from a near-name grep match. An unused second model can contradict its consumer unnoticed, and an extra remediation can introduce defects of its own. Later POLISH-024 explicitly bound read-use claims to mutation evidence.

PLATFORM-108 removes provider pacing only when both the explicit disable flag and Node test-child signal are present; production timing and all eleven intervals remain unchanged. Injected clocks verify serialization without sleeps. It did not solve JSDOM startup. PLATFORM-121 replaced calendar-expiring Odds route fixtures with execution-relative timing while preserving same-pair separation; the later September closeouts still recorded two separate standing Item 137 odds failures, so this ledger does not turn those runs into an all-green claim. Item 137 (#696) finished that work on 2026-09-11: `writer-convergence.test.ts` and one further `odds-quota-guard.test.ts` fixture now derive kickoffs from execution time, clearing both standing failures, so the suite carries no known-failure baseline and is verified against zero. PLATFORM-121's reach was overstated — a third fixture pinned to 2026-12-01 was still live, measured green three days before it and red three days after. `npm run test:clock-shift -- <days>` now detects the class, which no bisect can find because an older commit is not an older clock.

Preview received an isolated database on 2026-08-13. The build-gate correction identifies `vercel.json`'s `ignoreCommand` as the effective docs-only gate and distinguishes a branch ref advance from a deployment; dashboard allowlisting was present but overridden. This documents isolation, not automated branch/database cleanup.

PR references: #306, #392, #429, #444, #506, #553, #742.

Documentation: `docs/README.md`.

## Historical checkpoints

Dates below are those recorded in the supplied ledger, not inferred from the consolidation date or current production. “Date not recorded” is intentional. A source id identifies the exact per-source index row. These checkpoints preserve the earlier state and later update; they do not present the latest state as if it had always held. Outcomes above remain summaries, not verbatim snapshots of every historical assertion.

| Recorded date / sequence | Source ids | State at that checkpoint and subsequent change |
| --- | --- | --- |
| Date not recorded | S049, S052, S053, S054, S055, S057 | Entries explicitly said complete while PRs #217, #216, #214, #213, and #211 were still open. The index preserves that recorded state; later merge dates are not inferred. |
| Date not recorded | S032, S033, S037, S028, S029, S031 | Panel direction and two brainstorming sessions were planning checkpoints (queued/in progress/deferred), followed by separately recorded panel/generator/copy implementations. No date is supplied for that sequence and unimplemented proposals are not promoted to shipped work. |
| Date not recorded | S042, S070 | Preseason setup initially used Go Live to transition immediately; the later season-transition entry decoupled setup completion from automatic season start. |
| Date not recorded → 2026-08-08 | S067, S068, S124 | Founded Year was initially editable. F2J subsequently froze it after creation with a verified recovery-only exception. The original editable-field decision was real history, not a documentation typo. |
| Date not recorded → 2026-08-03 | S058, S053, S055, S069, S143 | Initial draft inputs included SP+/win totals and metric-based auto-pick. Later draft polish made auto-pick random; F2G1 retired recommendation inputs and the dead metric setting on 2026-08-03. Original selection policy is preserved as superseded history. |
| Date not recorded → 2026-08-19 | S066, S147 | Light/dark support and paired owner palettes shipped first. POLISH-010 retired light as an active theme on 2026-08-19; its old implementation was not merely a mistaken claim. |
| Date not recorded → 2026-08-07 | S059, S060, S116 | Historical backfill API/UI and 2021–2024 import were delivered first. F2H2A removed the standing backfill API/UI on 2026-08-07; builders and deliberate one-off repair capability survived. |
| Date not recorded → 2026-08-08 | S026, S122 | Launch hardening introduced returning-owner framing. INSIGHTS-022 later removed it because archived membership did not establish a future return, while retaining the engine suppression rule. |
| 2026-07-17 | S019 | H1 merged dormant (#396); parsing/analytics contracts were production-disconnected and activation remained future work. |
| 2026-07-18 | S018 | H2 merged dormant (#397); production writers remained legacy-only. A merged durable merge service was not yet the active ingestion path. |
| 2026-07-21 | S074 | Fenced legacy writer merged (#399); the replacement revision-lineage design was rejected. Initialization was a prerequisite before fenced deployment; the source did not date its execution here. |
| 2026-07-22 | S075, S076, S077, S078, S079 | C1–C4 and D merged dormant (#400–404); analytics evidence/finality and rollout transitions were implemented without activating consumers. D explicitly recorded no transition executed and production still legacy. |
| 2026-07-24 | S080, S081, S082, S083 | Alias and classification corrections plus numeric participant ids and paired archive snapshots merged (#405–408). Numeric validation/analytics remained dormant; old schedule caches required refresh and snapshot-bearing archives required rebuild before activation. |
| 2026-07-25 | S084, S085 | Polling/refresh prerequisite (#409) remained unwired. Collision remediation (#411) closed the code mechanism, but the 2024 durable archive was still recorded as corrupted pending the §8d operator sequence. |
| 2026-07-26 — preactivation checkpoint | S086 | §8d correction sequence was recorded performed: 2021–2025 schedules refreshed, collision/parity checks rerun, archives rebuilt. H3E activation was still PENDING and writer control remained legacy. #410/#412 being merged did not establish activation. |
| 2026-07-26 — activation checkpoint | S087 | Writer transitioned legacy → armed → active; production artifact `a161e33` was promoted; the controlled refresh and QStash auth proof succeeded. The entry initially retained two closeout items: observe a gates-open delivery and restore automatic production-domain assignment. |
| Later follow-up — date not separately recorded | S087 | The same source entry explicitly closes both remaining H3E items: gates-open no-target deliveries were observed and domain assignment restored. It does not give a separate timestamp for this follow-up; it is not silently dated 2026-07-26. |
| 2026-07-27 | S089 | F1 (#414) subsequently added the secret-safe per-invocation runtime logging that the H3E activation checkpoint had explicitly left as a non-blocking gap. |
| 2026-07-27 → 2026-07-28 | S090, S091, S092 | Live-score engine B1 merged dormant on July 27; B2A lock convergence remained dormant on July 28. B2B code delivery and the separately executed §8f activation are both recorded July 28. The entry retains preactivation prose as well as the later activation update. |
| 2026-07-28 → 2026-07-29 | S093, S094, S095 | Odds C1 was dormant at merge; C2 initially described code-only delivery with §8g pending, then records §8g executed. C3 on July 29 confirms/corrects the activation documentation. The source gives July 28 as the C2 merge date but no separately dated §8g operation; no exact activation date is invented. |
| 2026-07-29 | S096, S097, S098 | E1A and E1B/B1 initially merged dormant. E1B activation was held for the preseason gap; after B1 closed it, §8h was recorded executed July 29. Both dormant-at-merge and subsequent active states are retained. |
| 2026-07-30 | S099, S100 | Presentation C1 merged manual-only. C2 subsequently wired automatic enrichment under already-active schedulers; §8i observation remained PENDING in the source. Eligibility is not a recorded successful live observation. |
| 2026-07-30 | S101, S102 | Rankings E2A merged dormant; E2B initially said NOTHING PROVISIONED OR ACTIVATED with §8j pending. Its later follow-up explicitly says §8j EXECUTED 2026-07-30 and automation ACTIVE. Both checkpoints remain historical facts. |
| 2026-07-30 → 2026-08-07 | S035, S107, S129, S126 | Early manual rollover was tightened to the shared strict gate by F2B on July 30. F2H3A on August 7 retired execution but retained preview; F2H4 later that same recorded date removed the preview, routes, and Season Management page. The source does not supply times within that day. |
| 2026-08-04 → 2026-08-07 | S141, S138, S137, S136, S135, S128 | Manual demo authority landed first (August 4), then automated targeting/operational-year exclusions (August 5); typed demo feedback and truthful manual-control presentation landed August 7. Intermediate cross-job handoff gaps were real during the staged rollout, not final behavior. |
| 2026-08-06 | S134, S133, S132, S131 | R1→R4 hardened four registry consumers sequentially. Each intermediate entry still described unconverted siblings; by R4 container handling was complete. R3 explicitly accepted invalid-target standing warnings, superseding R2’s objection. Missing-status recovery was still not delivered. |
| 2026-08-13 → 2026-08-18 | S152 | Preview database isolation is recorded August 13. Build-gate documentation was corrected on main at `0232d525` on August 18; the source does not call that SHA a merge commit. |
| 2026-08-25 | S154, S155 | Week-resolution/coverage UI changes and trend-empty/preseason-origin work were recorded promoted. The broader grouped entries carry ranges of implementation dates, not one invented merge timestamp. |
| 2026-08-26 → 2026-08-27 | S150, S156, S157 | Vanished-game logging was not promoted at its August 26 closeout. Visible transition anchor merged August 26 and was verified live August 27; game-level gap diagnostics were promoted August 27. These are separate delivery records. |
| 2026-08-27–30 — as recorded | S158, S159, S160, S161, S162, S163, S164, S165, S170 | These merge entries explicitly leave production promotion unverified. The classification fix additionally requires a full-season refresh. No later deployment is inferred from adjacent promoted PRs. |
| 2026-08-28 → 2026-08-29 | S159, S160, S161, S163, S164, S165 | Recap skeleton and fact slices landed sequentially; record-change and odds facts were initially unwired. 026f on August 29 completed rendering. Durable event-source and Forward Look remained outside delivery. |
| 2026-08-29 | S166 | POLISH-015’s entry explicitly records owner-confirmed production promotion on the merge date; that confirmation is not generalized to sibling recap or standings PRs. |
| 2026-08-31 | S172, S017, S016 | Team-records cache initially depended on new-final triggers and an eight-day diagnostic. The production backfill filled the empty cache; PLATFORM-118 added an independent twelve-hour ceiling/hourly job and fourteen-hour diagnostic. All are dated August 31, without invented within-day timestamps. |
| 2026-09-04 → 2026-09-06 | S009, S008, S007, S004, S002, S001 | Overview ordering and dead-context cleanup superseded older presentation rules. Scoreboard additions landed September 5, Schedule records were explicitly removed pending identity-aware reconciliation, and September 6 row-tint capability remained caller-unwired. |

## Per-source evidence index

Each source milestone carries the four evidence fields below: PR(s), merge commit, recorded date, and outcome number. Source ids/names identify the row; they are not a fifth evidence claim. All 172 source records are mapped once, including four embedded entries. Original lookup titles are retained even when they say “dormant” or “not yet built.”

- PRs here identify the individual source record, not every PR mentioned in its review or follow-ups. Campaign-level reference lists above remain broader navigation aids.
- Merge SHAs are copied only where the source identifies a merge, or explicitly associates the campaign’s final slice with its independently recorded merge. A review/implementation/docs SHA is not relabeled as a merge. Multiple PR/merge associations are labeled individually.
- “Not recorded” means the supplied source lacks that field; it does not assert no PR/merge exists. No repository lookup was performed. Older “complete, PR open” states remain marked. A date may be a merge, promotion, operation, or campaign interval; special cases are labeled.
- Mentioned source files are not restored as an inventory. The associated Git change is the authority for the actual diff. Review and intermediate SHAs are intentionally not exhaustively reproduced.

| Source milestone | PR(s) | Merge commit | Recorded date | Outcome |
| --- | --- | --- | --- | --- |
| S001 · PLATFORM-087 Slice 5b — Card-owner scoreboard row modifier — Complete | #575 | `fef083ae` | 2026-09-06 | 01 |
| S002 · PLATFORM-087 Slice 5 + Item 112 — Schedule scoreboard and disclosure — Complete | #572 | `f424222a` | 2026-09-05 | 01 |
| S003 · Item 135 — Matchups opponent count and its collapse control — Complete | #571 | Not recorded | 2026-09-05 | 03 |
| S004 · PLATFORM-087 Slice 5a — Shared Scoreboard Contract — Complete | #570 | `4caa1a79` | 2026-09-05 | 01 |
| S005 · PLATFORM-BROWSER-POLL-CADENCE — Complete | #567 | `3c2d8774` | 2026-09-05 | 04 |
| S006 · PLATFORM-RETIRE-POSTSEASON-TEMPLATE — Complete | #565 | `7e505437` | 2026-09-04 | 23 |
| S007 · POLISH-024 — Retire the Dead OverviewContext Fields — Complete | #564 | `cac6dab9` | 2026-09-04 | 02 |
| S008 · POLISH-023 — Overview Sort Rules — Complete | #563 | `1546bbc8` | 2026-09-04 | 02 |
| S009 · POLISH-022 — Overview Section Order — Complete | #562 | `f4e13ad0` | 2026-09-04 | 02 |
| S010 · POLISH-021 — NoClaim Presentation and Schedule Participant Naming — Complete | #560 | `0b95aeca` | 2026-09-03 | 03 |
| S011 · PLATFORM-123 — Correct Odds Favorite Pairing — Complete | #556 | `bbd40a47` | 2026-09-03 | 26 |
| S012 · PLATFORM-121 — Deterministic Odds Route Fixtures — Complete | #553 | `e952a657` | 2026-09-02 | 31 |
| S013 · PLATFORM-120 — Hot Schedule-Build Relevance Filter and Week-0 Deletion — Complete | #551 | `ce176ccd` | 2026-09-02 | 23 |
| S014 · POLISH-019 — Overview Recent Finals Promotion — Complete | #549 | `751a86b4` | 2026-09-01 | 01 |
| S015 · PLATFORM-119 — Pool-Safe Standings Warm-on-Write — Complete | #547 | `197bde67` | 2026-08-31 | 06 |
| S016 · PLATFORM-118 — Team-Records Freshness Authority — Complete | #546 | `c29801a4` | 2026-08-31 | 05 |
| S017 · Team-records backfill (2018, 2021-2026) — Complete | None — production operation | Not recorded | 2026-08-31 | 05 |
| S018 · PLATFORM-086H2 — Durable Game-Stats Merge Service (Dormant) — Complete | #397 | `c48e1ca` | 2026-07-18 | 22 |
| S019 · PLATFORM-086H1 — Game-Stats Data Contract (Dormant Foundation) — Complete | #396 | `0f8b562` | 2026-07-17 | 22 |
| S020 · PLATFORM-086G2 — Odds Boundary & Usage Truthfulness — Complete | #395 | `0ee58b4` | 2026-07-16 | 21 |
| S021 · PLATFORM-086G1 — CFBD Score & Quota Truthfulness — Complete | #394 | `987dd04` | 2026-07-14 | 21 |
| S022 · PLATFORM-086A — Provider-Refresh Observability Foundation — Complete | #391 | `9da8857` | 2026-07-14 | 21 |
| S023 · Markdownlint Documentation Tooling — Complete | #392 | `c8b8d12` | 2026-07-14 | 31 |
| S024 · Draft Timer Integrity + Server-Authoritative Round Boundaries — Complete | #319, #320, #321 | Not recorded | Not recorded | 12 |
| S025 · HISTORY-RECORDS Phase 2 — Complete | #313 | Not recorded | Not recorded | 08 |
| S026 · Season Launch Hardening — Complete | #302, #303, #304 | Not recorded | Not recorded | 14 |
| S027 · Standings Ownership Model Redesign — Complete | Not recorded | Not recorded | Not recorded | 06 |
| S028 · Insights Panel Redesign + Polish — Complete | Not recorded | Not recorded | Not recorded | 10 |
| S029 · Insights Engine — Generator Batch 2 — Complete | Not recorded | Not recorded | Not recorded | 09 |
| S030 · Insights Engine — Context Extension — Complete | Not recorded | Not recorded | Not recorded | 09 |
| S031 · Copy Variation Architecture — Complete | Not recorded | Not recorded | Not recorded | 09 |
| S032 · Insights Panel UI Direction — Decided (not yet built) | Not recorded | Not recorded | Not recorded | 10 |
| S033 · Insights Engine — Opus 1M Brainstorming Session 2 | Not recorded | Not recorded | Not recorded | 09 |
| S034 · Insights Engine — Generators and Wiring — Complete | #278 | Not recorded | Not recorded | 09 |
| S035 · Season Rollover — Complete | #278 | Not recorded | Not recorded | 17 |
| S036 · History Page Polish — Complete | #278 | Not recorded | Not recorded | 08 |
| S037 · Insights Engine — Opus 1M Brainstorming | Not recorded | Not recorded | Not recorded | 09 |
| S038 · Insights Engine Foundation — Complete | #276 | Not recorded | Not recorded | 09 |
| S039 · Game Stats Pipeline — Complete | #274, #275 | Not recorded | Not recorded | 22 |
| S040 · P7B-6 — Draft Board UI Polish: Complete | Not recorded | Not recorded | Not recorded | 12 |
| S041 · P7B-5 — Owner Confirmation Flow: Complete | Not recorded | Not recorded | Not recorded | 13 |
| S042 · P7B-4 — Pre-Season Setup Flow: Complete | Not recorded | Not recorded | Not recorded | 13 |
| S043 · Phase 7F — Overview Featured Games: Complete | #241 | Not recorded | Not recorded | 01 |
| S044 · Phase 7A–7E — Product Design Audit (Standings through Speed Insights): Complete | Not recorded | Not recorded | Not recorded | 30 |
| S045 · P6E — Roster Editor: Complete | #229 | Not recorded | Not recorded | 28 |
| S046 · P6 — Admin Polish and Commissioner UX: Complete | #230, #231, #232, #233, #234 | Not recorded | Not recorded | 15 |
| S047 · P6D — Admin UI Restructure: Complete | #228 | Not recorded | Not recorded | 15 |
| S048 · P6 — Clerk Auth Fixes and Admin Data Cleanup: Complete | #221, #222, #223, #224, #225, #226, #227 | Not recorded | Not recorded | 14 |
| S049 · Phase 6 — Admin Cleanup and Auth (P6A–P6C): Complete | #217 (open at entry) | Not recorded | Not recorded | 14 |
| S050 · Phase 6C — Landing Page Polish: Complete | Not recorded | Not recorded | Not recorded | 29 |
| S051 · Phase 6B — Admin Page Restructure: Complete | Not recorded | Not recorded | Not recorded | 15 |
| S052 · Phase 6A — Clerk Auth Setup: Complete | #216 (open at entry) | Not recorded | Not recorded | 14 |
| S053 · Phase 5 — Draft / Owner Assignment Tool (P5A–P5D): Complete | #214 (open at entry) | Not recorded | Not recorded | 12 |
| S054 · P5D — Draft Summary and Confirmation | #214 (open at entry) | Not recorded | Not recorded | 12 |
| S055 · P5C — Live Draft Board | #213 (open at entry) | Not recorded | Not recorded | 12 |
| S056 · P5C — Live Draft Board — Initial Implementation Details | Not recorded | Not recorded | Not recorded | 12 |
| S057 · P5B — Draft Setup and Settings | #211 (open at entry) | Not recorded | Not recorded | 12 |
| S058 · P5A — Draft Data Infrastructure | #210 | Not recorded | Not recorded | 12 |
| S059 · P4D Polish, Backfill, and Historical Data Infrastructure | #207 | Not recorded | Not recorded | 08 |
| S060 · Historical Season Backfill Endpoint | Not recorded | Not recorded | Not recorded | 08 |
| S061 · P4D — League History and Owner Career UI | #204 | Not recorded | Not recorded | 08 |
| S062 · Roster Upload Fuzzy Matching | #202, #203 | Not recorded | Not recorded | 28 |
| S063 · Phase 4C — Season Detail UI | #201 | Not recorded | Not recorded | 08 |
| S064 · Navigation, CTA Consistency & History Chrome (standalone) | Not recorded | Not recorded | Not recorded | 30 |
| S065 · Overview Page Polish (standalone) | Not recorded | Not recorded | Not recorded | 02 |
| S066 · Light Mode & Owner Color System (standalone) | Not recorded | Not recorded | Not recorded | 30 |
| S067 · P7A-1 — Founded Year (Phase 7A) | Not recorded | Not recorded | Not recorded | 13 |
| S068 · Phase 7A — Commissioner Self-Service | Not recorded | Not recorded | Not recorded | 13 |
| S069 · P7B-7 — Draft Flow Polish | Not recorded | Not recorded | Not recorded | 12 |
| S070 · P7B Season Transition Architecture — Complete | Not recorded | Not recorded | Not recorded | 13 |
| S071 · P7B Dry Run Polish — Complete | #270 | Not recorded | Not recorded | 13 |
| S072 · P7B Launch Preparation — Complete | #272 | Not recorded | Not recorded | 29 |
| S073 · Event-Centric Date-Aware Odds Attachment — Complete | #331, #332 | Not recorded | Not recorded | 26 |
| S074 · PLATFORM-086H3B Replacement — Fenced Legacy Game-Stats Writer — Complete | #399 | `69d3770` | 2026-07-21 | 22 |
| S075 · PLATFORM-086H3C1 — Canonical Game-Stats Evidence Read Model (Dormant) — Complete | #400 | `cf8c584` | 2026-07-22 | 22 |
| S076 · PLATFORM-086H3C2 — Dormant Safe Ingestion Coordination (Adapter) — Complete | #401 | `61fe69c` | 2026-07-22 | 22 |
| S077 · PLATFORM-086H3C3 — Dormant Analytics Finality Gate — Complete | #402 | `c41121b` | 2026-07-22 | 22 |
| S078 · PLATFORM-086H3D — Dormant Writer-Control Rollout Safety — Complete | #403 | `ddc356e` | 2026-07-22 | 22 |
| S079 · PLATFORM-086H3C4 — Dormant Analytics Readiness Correction — Complete | #404 | `aa91391` | 2026-07-22 | 22 |
| S080 · PLATFORM-086 — Team-Catalog Derived-Alias Safety — Complete | #405 | `d5ee260` | 2026-07-24 | 23 |
| S081 · PLATFORM-086 — Schedule Non-FBS Postseason Classification Safety — Complete | #406 | `a015348` | 2026-07-24 | 23 |
| S082 · PLATFORM-086H3C5 — Numeric Participant Validation (embedded) | #407 | `a0cfff0` | 2026-07-24 | 22 |
| S083 · PLATFORM-086H3E1 — Paired Analytics Provenance (embedded) | #408 | `a4dd9d5` | 2026-07-24 | 22 |
| S084 · PLATFORM-086H3E2 — Refresh and Polling Prerequisite (embedded) | #409 | `d04f3b3` | 2026-07-25 | 22 |
| S085 · PLATFORM-086H3E4 — Second-Round Conference Collision Remediation (embedded) | #411 | `4e4535d` | 2026-07-25 | 23 |
| S086 · PLATFORM-086H3E external scheduler — migration + pre-activation remediation (2026-07-26) | #410, #412 | #410: not recorded; #412: `a161e33` | 2026-07-26 | 22 |
| S087 · PLATFORM-086H3E production activation checkpoint (2026-07-26) | None — production operation | Not recorded | 2026-07-26 | 22 |
| S088 · PLATFORM-086I — Provider Data Status Settings Feedback — Complete | #413 | `da99a11` | 2026-07-27 | 20 |
| S089 · PLATFORM-086F1 — Game-Stats Cron Execution Logging — Complete | #414 | `a7f5db2` | 2026-07-27 | 20 |
| S090 · PLATFORM-086B1 — Live-Score Polling Engine (Dormant) — Complete | #416 | `4cbea60` | 2026-07-27 | 25 |
| S091 · PLATFORM-086B2A — Score-Writer Lock Convergence (Dormant) — Complete | #417 | `4039c98` | 2026-07-28 | 25 |
| S092 · PLATFORM-086B2B — Live-Score Activation Wiring (Dormant) — Complete | #418 | `57fab82` | 2026-07-28 | 25 |
| S093 · PLATFORM-086C1 — Odds Refresh Authority & Writer Convergence (Dormant) — Complete | #419 | `b9c6cb3` | 2026-07-28 | 26 |
| S094 · PLATFORM-086C2 — Odds Polling Activation (Dormant) — Complete | #420 | `262fdf0` | 2026-07-28 | 26 |
| S095 · PLATFORM-086C3 — Odds Cache UI Hydration — Complete | #421 | `8029136` | 2026-07-29 | 26 |
| S096 · PLATFORM-086E1A — Full-Season Schedule Refresh Authority — Complete (Dormant) | #422 | `f320a7e` | 2026-07-29 | 24 |
| S097 · PLATFORM-086E1B — Weekly Schedule Automation with Operation-Aware Controls — Complete (Dormant) | #423 | `2ddf5c4` | 2026-07-29 | 24 |
| S098 · PLATFORM-086E1B1 — Preseason Weekly Coverage with Season-Transition Handoff — Complete (Dormant) | #424 | `587d5e3` | 2026-07-29 | 24 |
| S099 · PLATFORM-086E1C1 — Schedule Presentation Cache + Cache-Only UI (Manual-Only) — Complete | #425 | `1f27f5c` | 2026-07-30 | 24 |
| S100 · PLATFORM-086E1C2 — Automatic Schedule-Presentation Wiring (Weekly + Season-Transition) — Complete | #426 | `29976c1` | 2026-07-30 | 24 |
| S101 · PLATFORM-086E2A — Season Rankings Refresh Authority + Cache-Only Reader — Complete (Dormant) | #427 | `a656861` | 2026-07-30 | 27 |
| S102 · PLATFORM-086E2B — Publication-Aware Rankings Automation — Complete (Merged; Unprovisioned) | #428 | `1c34352` | 2026-07-30 | 27 |
| S103 · PRE-LAUNCH-TIDYUP — Complete | #306 | Not recorded | Not recorded | 31 |
| S104 · DOCS-013 — Binding Execution Boundaries — Complete | #444 | `2b09e82` | 2026-08-04 | 31 |
| S105 · DOCS-012 — Current-Ledger Deconfliction + Ledger-Ownership Governance — Complete | #429 | `ea4fa60` | 2026-07-30 | 31 |
| S106 · PLATFORM-086F2A — Admin Control-Plane Inventory + Target IA — Complete | #430 | `4d6b897` | 2026-07-30 | 15 |
| S107 · PLATFORM-086F2B — Lifecycle Authority Safety — Complete | #431 | `5658413` | 2026-07-30 | 17 |
| S108 · PLATFORM-086F2C — Maintenance Action Model + Data Maintenance & Recovery Foundation — Complete | #432 | `5e2c021` | 2026-07-30 | 15 |
| S109 · PLATFORM-086F2D1 — Provider Maintenance Relocation — Complete | #433 | `fa5c0f6` | 2026-07-30 | 15 |
| S110 · PLATFORM-086F2D — Operational Mutation Relocation (D1 + D2) — Complete | #433, #434 | #433: `fa5c0f6`; #434: `a2a56fc` | 2026-07-30 | 15 |
| S111 · PLATFORM-086F2E1 — External Scheduler Receipts — Complete | #435 | `4404ad3` | 2026-07-31 | 20 |
| S112 · PLATFORM-086F2E2A — Lifecycle Scheduler Receipts + Events — Complete | #436 | `fa6e967` | 2026-07-31 | 20 |
| S113 · PLATFORM-086F2E2B — Scheduler Receipt Reader + Delivery Classifier — Complete | #437 | `f84b676` | 2026-07-31 | 20 |
| S114 · PLATFORM-086F2F — System Health Read Model — Complete | #438 | `b9a1688` | 2026-08-02 | 20 |
| S115 · PLATFORM-086F2G — System Health UI — Complete | #439 | `c5e38be` | 2026-08-03 | 20 |
| S116 · PLATFORM-086F2H2A — Admin Season Backfill Retired — Complete | #456 | `cb40c03` | 2026-08-07 | 08 |
| S117 · PLATFORM-090 — Game-Stats Preseason Health State — Complete | #470 | `ee39e09` | 2026-08-11 | 20 |
| S118 · PLATFORM-089 — Odds Early-Season Polling — Complete | #469 | `ff5aa0c` | 2026-08-10 | 26 |
| S119 · TURFWAR Wordmark Kerning Cleanup — Complete | #468 | `fc77420` | 2026-08-10 | 29 |
| S120 · POLISH-004 — Public Homepage Stadium — Complete | #466 | `38f5719` | 2026-08-09 | 29 |
| S121 · PLATFORM-088 — Homepage Entry Truth — Complete | #465 | `f578f22` | 2026-08-08 | 29 |
| S122 · INSIGHTS-022 — Offseason Roster Content — Complete | #464 | `0f48b87` | 2026-08-08 | 09 |
| S123 · PLATFORM-086F2 — Admin Control-Plane IA Redesign (Campaign) — Complete | #463 | Final slice #463: `d9a8e93` | 2026-08-08 campaign closeout | 15 |
| S124 · PLATFORM-086F2J — Commissioner Boundaries and Navigation Closeout — Complete | #463 | `d9a8e93` | 2026-08-08 | 16 |
| S125 · PLATFORM-086F2I — Platform Configuration and Team Identity — Complete | #462 | `cbd3ed5` | 2026-08-08 | 16 |
| S126 · PLATFORM-086F2H4 — Season Management Retired — Complete | #461 | `8f56835` | 2026-08-07 | 17 |
| S127 · PLATFORM-086F2H3B2 — System Health Lifecycle-Integrity Issue — Complete | #460 | `5822a16` | 2026-08-07 | 20 |
| S128 · PLATFORM-086F2H3B1 — Lifecycle Presentation and Typed Test-Control Feedback — Complete | #459 | `b07f2d6` | 2026-08-07 | 18 |
| S129 · PLATFORM-086F2H3A — Rollover Surface Consolidation — Complete | #458 | `6a8b86c` | 2026-08-07 | 17 |
| S130 · PLATFORM-086F2H2B — Rollover Operator Truth — Complete | #457 | `876d87c` | 2026-08-07 | 17 |
| S131 · PLATFORM-086F2H1R4 — Rollover Registry-Container Truth + Year Validity — Complete | #455 | `995c18e` | 2026-08-06 | 19 |
| S132 · PLATFORM-086F2H1R3 — Rankings Registry-Container Truth + Year Validity — Complete | #454 | `10186b2` | 2026-08-06 | 19 |
| S133 · PLATFORM-086F2H1R2 — Weekly-Schedule Registry-Container Truth + Year Validity — Complete | #453 | `3a58767` | 2026-08-06 | 19 |
| S134 · PLATFORM-086F2H1R1 — Registry-Read Truth + Season-Transition Year Validity — Complete | #452 | `e29bb47` | 2026-08-06 | 19 |
| S135 · PLATFORM-086F2H1T5 — System Health Operational-Year Isolation — Complete | #451 | `6e881b5` | 2026-08-05 | 18 |
| S136 · PLATFORM-086F2H1T4 — Rankings Demo-League Exclusion — Complete | #450 | `27a6c37` | 2026-08-05 | 18 |
| S137 · PLATFORM-086F2H1T3 — Weekly-Schedule Demo-League Exclusion — Complete | #449 | `c15413e` | 2026-08-05 | 18 |
| S138 · PLATFORM-086F2H1T2 — Season-Transition Demo-League Exclusion — Complete | #448 | `6ab927c` | 2026-08-05 | 18 |
| S139 · PLATFORM-086F2H1SB — Admin Server Action Authorization — Complete | #447 | `8021b1f` | 2026-08-05 | 14 |
| S140 · PLATFORM-086F2H1SA — Protected-Path Matcher Coverage — Complete | #446 | `533aed8` | 2026-08-04 | 14 |
| S141 · PLATFORM-086F2H1T1 — Slugless Demo-League Lifecycle Authority — Complete | #445 | `8e6f122` | 2026-08-04 | 18 |
| S142 · PLATFORM-086F2H1B — Guarded Automatic Season Transition — Complete | #443 | `be0c950` | 2026-08-04 | 17 |
| S143 · PLATFORM-086F2G1 — Draft-Assistance Retirement — Complete | #440 | `9c3b6ce` | 2026-08-03 | 12 |
| S144 · PLATFORM-086F2H1A — Lifecycle Guards Core — Complete | #442 | `d800fd6` | 2026-08-04 | 17 |
| S145 · POLISH-007 — Game-Day Confidence Layer — Complete | #495 | `3a76fca3` | 2026-08-19 | 04 |
| S146 · POLISH-009 — History Stats Mobile Layout and Controls — Complete | #497 | `e91f2f65` | 2026-08-19 | 08 |
| S147 · POLISH-010 — Dark-Only Theme — Complete | #500 | `6109df6f` | 2026-08-19 | 30 |
| S148 · PLATFORM-107 — Weekly Final-Score Sweeper — Complete | #505 | `878a3466` | 2026-08-21 | 25 |
| S149 · PLATFORM-108 — Test-only Upstream Pacing Bypass — Complete | #506 | `1896b149` | 2026-08-22 | 31 |
| S150 · PLATFORM-110 — Vanished CFBD Schedule Record Logging — Complete | #512 | `1d550c1e` | 2026-08-26 | 24 |
| S151 · Season Setup and Draft Readiness — Complete | Not recorded | Not recorded | 2026-08-11 → 2026-08-16 | 13 |
| S152 · Preview Isolation and Build-Gate Documentation — Complete | Not recorded | Not recorded | 2026-08-13 isolation; 2026-08-18 documentation | 31 |
| S153 · Insights Preseason Truth and Engagement Expansion — Complete | Not recorded | Not recorded | 2026-08-15 → 2026-08-18 | 09 |
| S154 · Rankings, Week Resolution, and Standings-Coverage Integrity — Complete | Not recorded | Not recorded | 2026-08-18 → 2026-08-25 | 06 |
| S155 · Trend Empty States and Preseason Origin — Complete | #510, #511 | Not recorded | 2026-08-25 promotion | 07 |
| S156 · PLATFORM-111 — Visible Season Transition Anchor — Complete | #514 | `dc8b3528` | 2026-08-26 merge; 2026-08-27 promotion | 17 |
| S157 · PLATFORM-112 — Game-Level Completed-Score Gap Diagnostics — Complete | #516 | `30bb515f` | 2026-08-27 promotion | 20 |
| S158 · PLATFORM-113 — Elapsed-Time Conclusion Diagnostics — Complete | #518 | `bc0e741f` | 2026-08-27 | 20 |
| S159 · INSIGHTS-026a — Request-Time Weekly Recap Skeleton — Complete | #519 | `68d7f792` | 2026-08-28 | 11 |
| S160 · INSIGHTS-026b — Weekly Recap Layout and Overview Tile — Complete | #521 | `af0a2118` | 2026-08-29 | 11 |
| S161 · INSIGHTS-026c — Weekly Recap Details — Complete | #523 | `e41832ec` | 2026-08-29 | 11 |
| S162 · PLATFORM-114 — Schedule Eligibility from the Provider Division Label — Complete | #524 | `4a78d1b5` | 2026-08-29 | 23 |
| S163 · INSIGHTS-026d — Weekly Recap Record-Change Projection — Complete | #525 | `6b541730` | 2026-08-29 | 11 |
| S164 · INSIGHTS-026e — Weekly Recap Odds Upsets — Complete | #527 | `a1b25582` | 2026-08-29 | 11 |
| S165 · INSIGHTS-026f — Weekly Recap Final Wiring — Complete | #529 | `faadabb4` | 2026-08-29 | 11 |
| S166 · POLISH-015 — Overview Games Region Corrections — Complete | #531 | `50b75f2f` | 2026-08-29 | 01 |
| S167 · PLATFORM-115 — CFBD Request Timeout — Complete | #534 | `6492e68d` | 2026-08-30 | 25 |
| S168 · POLISH-016 — Overview Live Scoreboard Component — Complete | #535 | `5fd59d39` | 2026-08-30 | 01 |
| S169 · POLISH-017 — Overview Featured Scoreboard and Green Live — Complete | #537 | `e0a7b8ab` | 2026-08-30 | 01 |
| S170 · PLATFORM-116 — Overview Standings Live Signal — Complete | #539 | `fce338f3` | 2026-08-30 | 04 |
| S171 · POLISH-018 — Shared Live Status Treatment — Complete | #541 | `9a45e1f3` | 2026-08-31 | 01 |
| S172 · PLATFORM-117 — CFBD Team-Records Cache — Complete | #543 | `9376521e` | 2026-08-31 | 05 |
