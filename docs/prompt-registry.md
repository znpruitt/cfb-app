# Prompt Registry

Status: Current ledger
Last verified: 2026-09-05
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
- **Concise legacy formats are grandfathered.** Do not expand or mechanically restyle an
  already-short record merely to match the current labels. DOCS-014 compacted verbose historical
  records; Git and PR history retain their former forensic detail.

---

## Prompt ledger (most recent first)

### PLATFORM-BROWSER-POLL-CADENCE-v2

- Purpose: reduce expected live-score display staleness without doubling browser reads through the
  full 24-hour finals tail.
- Scope: cadence tiering in the client polling helper and hook, full-partition behavioral tests, and
  canonical architecture, runbook, operator-policy, and cadence-comment corrections; no cron, TTL,
  provider-call, cache-boundary, or `/api/scores` behavior change.
- Outcome: visible tabs read the full eligible partition set every 90 seconds while any eligible game
  is inside `[kickoff − 15 min, kickoff + 8 h]` without a usable final (final status plus both numeric
  scores), then every 180 seconds. Missing or ambiguous evidence stays fast through the hard ceiling.
  Expected display staleness improves by about 45 seconds (25%); Item 128 removed the redundant team
  catalog request before this merged.
- Review / verification: the settled design replaced two abandoned branches after review disproved
  partial partition polling. Production remediation `20870cfc` received clean Codex confirmation and
  `/code-review` found no correctness defect; its three LOWs resolved as an intentional lazy-
  hydration trade, a cadence-divisibility assertion, and an operations clarification. Final
  pre-merge head `9d3cd081` passed TypeScript, all 4,661 tests, and `lint:all`.
- Status: Merged via PR #567 (merge commit `3c2d8774`), 2026-09-05.

### PLATFORM-127-RETAIN-PROVIDER-USAGE-SERIES-v1

- Purpose: retain the CFBD quota figures the app already probes, because `/info` reports the CURRENT
  PERIOD only and CFBD exposes no history — so a calendar-month rollover destroys the prior month's
  burn permanently, and no second source counts provider calls.
- Scope: a new ungated QStash cron (`turfwar-usage-sample-6h` → `GET /api/cron/usage-sample`, every
  6 hours) plus its schedule manager, a durable observation log at `app_state` scope `provider-usage`
  key `cfbd-observations`, a scheduler receipt and cron execution log matching the sibling jobs, and
  `usage-sample` added to the closed `EXTERNAL_SCHEDULER_JOBS` contract. Observation-only: nothing in
  `src/` reads the log, and it must never become an input to the game-stats quota gate, which needs a
  FRESH reading.
- Outcome: the store holds raw observations — `{ at, remaining, limit }` per probe, sorted, bounded at
  1,700 entries — and derives nothing at write time. An earlier accumulating design (one entry per UTC
  day carrying `usedMax`/`usedLatest`/`periodSequence`) was rewritten after five review rounds each
  found a defect in the same write-time decisions; the rewrite removed 767 lines. `limit` is context
  only, never subtracted, because `used` is `limit − remaining` and a patron-tier change therefore
  moves it with no calls made. A quota-period boundary is now read off the series, where `remaining`
  rises. A second opportunistic producer on the game-stats probe was built and then removed: one
  durable row with two writers produced lost updates, clock skew reading as a reset, and out-of-order
  commits.
- Review / verification: FOUR paired review rounds. Earlier rounds were reviewed at `c057eee6`,
  `26638026` and `0ceb2121`; `c057eee6` is no longer an ancestor of this branch — the rebase onto
  `main` after Item 128 rewrote it as `cda2bc88` — so it is recorded as history, not as the verified
  commit. The FINAL reviewed commit is the one that merges. Findings across the rounds: an
  availability gate keyed on the derived `used`; a receipt asserting a definite loss on an uncertain
  commit; a coherence check that reintroduced the first defect through a fabricated Tier 0 limit; a
  reread that could confirm a commit that never happened; and a tolerant reader on the WRITE path
  that would have destroyed the whole log on one unparseable row. Each was remediated and
  mutation-proven. Gate evidence is stated against the merged commit below, each command run
  separately with its own exit code.
- Second remediation round (owner-authorized): the confirming passes returned two Codex P2s and one
  `/code-review` finding, none caused by the first round — a receipt that asserted a definite loss
  when a lost COMMIT acknowledgement left durability unknown, a rotation-checklist step demanding
  "no provider attempt" from a deliberately ungated job, and a writer that ignored the coherence
  verdict the route computed three lines above it. The write now resolves the uncertainty with a
  reread rather than reporting it, `buildProviderUsageObservation` is the single place a reading
  becomes an observation (so gate and stored value cannot disagree), and runbook step 7 exempts
  `usage-sample` with §8m's proof in its place.
- Re-derivation round (owner-authorized, after the second confirming pass): that pass showed the
  previous round had been net-negative — its coherence check REINTRODUCED the availability defect it
  followed, because `cfbdCanonicalLimitForTier` fabricates Tier 0's 1,000 for any unrecognised tier,
  so a true `remaining` was discarded and `partial` filed indefinitely; and its reread could confirm
  a commit that never happened, since this module deliberately permits two observations to share a
  timestamp. Both were DELETED rather than guarded: nothing derives from `limit`, and an uncertain
  write is reported rather than resolved. The tri-state now reaches the reader — `recorded: boolean |
  null` through response, receipt target, validator and UI, which renders a third distinct
  "durability unknown". Stale eight/six-job counts corrected in `operations/deployment.md`,
  `architecture/admin-control-plane.md` and `lifecycleCronExecutionLog.ts`, and two ninth-job
  coverage gaps closed (`sections.test.tsx` asserted eight labels; the receipt enumeration skipped
  `usage-sample`).
- `/info` billing: CFBD's developer confirmed on 2026-09-04 that `/info` and `/info/usage` do not
  count against the allowance. Every place this branch asserted it now cites that source.
  `quotaPolicy.ts`'s "verified empirically during the operator manual proof" parenthetical is stale
  as a result — left untouched as out of scope, and filed.
- Open follow-ups, deliberately NOT folded in: the route has no outer `catch`, diverging from sibling
  cron routes (no reachable throw today); and `usage-sample`'s delivery grace equals exactly one cron
  period where every sibling uses two or more, so clock skew could file a spurious `late`.
- Status: Complete and reviewed; NOT yet merged, and the QStash schedule is NOT yet provisioned —
  `manage:usage-sample-schedule upsert --apply` requires the owner's `QSTASH_TOKEN`. Until it runs,
  System Health correctly reports `usage-sample` with a scheduler-delivery warning.

### PLATFORM-128-LIVE-POLL-TEAM-CATALOG-v1

- Purpose: stop every browser live-score poll from refetching the full team catalog it already holds
  in memory, so Item 95 portion 1's 90-second fast tier does not double an avoidable cost.
- Scope: pass `CFBScheduleApp`'s existing `teamCatalog` state into `useLiveRefresh` instead of calling
  `fetchTeamsCatalog()` inside `refreshLiveData`; no new endpoint, no new cache, no change to score
  attachment, provider calls, or the poll cadence itself.
- Outcome: removed one `/api/teams` function invocation, durable catalog read, server-side
  normalize/filter/sort/serialize and client parse per tick, per visible tab. `fetchTeamsCatalog` sets
  `cache: 'no-store'`, so the removed call was never browser-cached. An empty catalog forwards as
  `undefined`, which makes `fetchScoresByGame` fetch one itself — a deliberate improvement over the
  old `[]`, which `??` does not treat as absent and which therefore attached scores against an empty
  catalog with no retry. Accepted trade recorded in the param doc: polls are now pinned to the
  bootstrap catalog until a full schedule reload, where the old per-tick fetch picked up an operator
  re-sync within one tick.
- Review / verification: exact commit reviewed by both reviewers, `9f98315c` — Codex no findings,
  `/code-review` three LOW, all remediated in `62dd1843`. The load-bearing one was a stale closure:
  `teamCatalog` was read inside `refreshLiveData` but omitted from its `useCallback` deps, and this
  repo does not enable `react-hooks/exhaustive-deps`. Confirming pass on `62dd1843`: Codex no
  findings, `/code-review` two LOW and no correctness defect, both folded in here. `npx tsc --noEmit`
  exit 0; `npm test` exit 0 at 4,593 tests; `npm run lint:all` exit 0, each run separately.
- Status: Merged to `main`, 2026-09-04. Sequencing satisfied: Item 95 portion 1 merged after it via
  PR #567, so the faster browser tier never shipped with the redundant catalog request.

### PLATFORM-RETIRE-POSTSEASON-TEMPLATE-v1

- Purpose: retire the unreferenced postseason template before its hardcoded, incomplete bracket and
  stale provider-week assumptions could be mistaken for a supported model.
- Scope: delete `src/lib/postseason-template.ts`; no replacement, caller, test, live postseason path,
  or runtime behavior change.
- Outcome: removed the 183-line dead module. Searches found no surviving source or script reference,
  no test file existed, and no second static template generator was found.
- Review / verification: exact implementation commit `12da576e`; Codex and `/code-review` returned no
  findings. TypeScript, `lint:all`, all 4,590 tests (delta 0), and the production build passed.
- Status: Merged via PR #565 (merge commit `7e505437`), 2026-09-04.

### SCHEDULE-REFRESH-DIAGNOSTIC-DOCUMENTATION

- Purpose: preserve the September 1 weekly schedule-refresh investigation as repository-owned
  evidence and future implementation planning without changing runtime behavior.
- Scope: documentation only — the diagnostics operating guide, scheduler-receipt contract, active
  queue Items 93/126, and prompt ledger; no application code, scheduler, provider, receipt, System
  Health, or QStash mutation.
- Outcome: recorded confirmed delivery/application evidence, the high-confidence but unproven
  three-by-12-second CFBD timeout inference, the later successful manual recovery, the separate
  September 3 authorization failure, and the exact evidence-loss boundaries. Filed bounded receipt,
  event-correlation, upstream-classification/history, dashboard, and timeout-budget follow-ups.
- Review / verification: documentation diff inspected for authority boundaries and evidence versus
  inference language; Markdown and diff-integrity checks recorded with the task handoff.
- Status: Complete — documentation-only; published directly to `main`, 2026-09-04.

### SCHEDULE-REFRESH-FAILURE-DIAG

- Purpose: read-only production investigation of the September 1, 2026 weekly schedule-refresh
  delivery that QStash considered successful while TurfWar recorded an application failure.
- Scope: traced cron authentication, target selection, `refreshFullSeasonSchedule`, CFBD partition
  fetching/completeness, reconciliation, score sweep, durable persistence, provider status, runtime
  logging, scheduler receipts, and the later manual recovery; no mutations.
- Outcome: the 37,124 ms invocation and same-day 36,917 ms rankings provider failure strongly support
  a transient CFBD partition timeout exhausting three 12-second attempts. The precise season type
  and transport category are not provable; the September 3 401 is a separate pre-authentication
  issue. Full evidence classification is retained in `docs/operations/diagnostics.md`.
- Review / verification: inspected the exact receipt deployment (`197bde6725c37fc2f0857e0a7438fba7eaca9fdd`),
  read-only production receipt/provider state, retained Vercel/QStash logs, relevant source/history,
  and the later successful provider status; no code or production state changed.
- Status: Complete — read-only diagnostic, no implementation.

### POLISH-024-RETIRE-OVERVIEW-SECTION-ORDER-v1

- Purpose: Item 124 — retire `OverviewContext` fields that are declared, populated, and read by
  nothing, one of which had begun contradicting the section order POLISH-022 shipped.
- Scope: `src/lib/overview.ts` and the four Overview test fixtures. No component, selector or
  data-layer change; no user-visible change.
- Outcome: `OverviewContext` reduced to `{ scopeDetail }` — the single field anything reads. Removed
  `sectionOrder`, `scopeLabel`, `highlightsTitle`, `highlightsDescription`, `liveDescription` and
  `emphasis`, plus the orphaned `OverviewSectionKind` type; `deriveOverviewContext` lost both
  parameters that only fed deleted fields and collapsed from four slate branches to one line.
- Notes: THREE false reader claims were made and corrected on this branch, all from greps that
  matched near-namesakes — `highlightsTitle` (the Featured heading is a literal string),
  `context.emphasis` "five components branch on it" (nothing reads it), and the second written one
  sentence after correcting the first. `AGENTS.md` → Verification gained a binding rule as a result:
  a claim that something IS READ requires a mutation, not a grep. One test was deleted rather than
  gutted, its subject having been `scopeLabel`; a comment records why.
- Review / verification: exact pre-merge head `8742d6dd`. `npx tsc --noEmit` exit 0,
  `npm run lint:all` exit 0, `npm test` exit 0 with 4,590 passing (−1, the deleted test),
  `npm run build` exit 0 — added as a gate because an exported type's surface changed. Codex clean
  in both rounds; `/code-review` found the `emphasis` claim in round 2.
- Status: Merged via PR #564 (merge commit `cac6dab9`), 2026-09-04.

### POLISH-023-OVERVIEW-ORDERING-REMAINDER-v1

- Purpose: Item 125 portions 1 and 2 — Live sorts by kickoff alone, and a Featured final carries no
  date or time. Extended at review to every Overview game section.
- Scope: `src/lib/selectors/overviewGameSections.ts`, `src/lib/selectors/overview.ts`,
  `src/components/OverviewPanel.tsx`, `DESIGN.md`, and the nearest tests. No data-layer change.
- Outcome: every owner-count sort key on Overview is gone — Live, Recent finals, the watchlist
  tiebreak, and Featured — leaving `watchlistPriority` as the sole deliberate non-kickoff key.
  `compareOverviewLiveItems` also lost the in-progress-before-awaiting partition. Featured stops
  passing `clock`, and `DESIGN.md` was amended, since it required the opposite.
- Review / verification: two rounds. Codex clean in round 2. Round 1 found the `DESIGN.md` conflict
  and a cap test whose date template produced `T110:00:00`, so a row was undated and sliced for the
  wrong reason. Round 2 found three false exhaustiveness claims of mine — Featured still held the
  key I had scoped out — a `DESIGN.md` rationale citing containers Overview does not have, and a
  test coupled to a fixture's literal kickoff. The owner then ruled the Featured key out.
  Exact head `c0cba813`: `npx tsc --noEmit` exit 0, `npm run lint:all` exit 0, `npm test` exit 0
  with 4,591 passing (+5). Every new assertion mutation-proven; two drafts of the watchlist test
  were vacuous and the mutation caught both.
- Status: Merged via PR #563 (merge commit `1546bbc8`), 2026-09-04.

### POLISH-022-OVERVIEW-SECTION-ORDER-v1

- Purpose: render Overview's game sections in the owner-decided order — Featured → Live → Recent
  finals → Upcoming watchlist — instead of the inherited Featured → watchlist → Live → Recent finals,
  which placed the only time-sensitive section third.
- Scope: `src/components/OverviewPanel.tsx` (JSX block move only) and the two Overview component
  test files. No selector, cap, condition, or data change; the five other decisions in
  `docs/campaigns/item-87-followon-section-ordering.md` are explicitly not in scope.
- Outcome: the watchlist block moved below Recent finals. Verified a pure permutation — the sorted
  line multisets of `main` and `HEAD` for `OverviewPanel.tsx` are identical, 28 lines added and 28
  removed with every line paired.
- Review / verification: exact head `2879f5f3`, clean tree. `npx tsc --noEmit` exit 0,
  `npm run lint:all` exit 0, `npm test` exit 0 with 4,586 passing (+1). One new order test carrying
  four presence assertions as positive controls, mutation-proven — restoring `main`'s
  `OverviewPanel.tsx` fails `Recent finals must precede the watchlist`. Codex review clean;
  `/code-review` found no correctness bugs and three low findings, two closed by this closeout and
  one filed as Item 124.
- Status: Merged via PR #562 (merge commit `f4e13ad0`), 2026-09-04.

### POLISH-021-NOCLAIM-PRESENTATION-v1

- Purpose: stop the internal `NoClaim` roster sentinel from rendering as a member name on Schedule,
  Postseason, and Matchups, and stop canonical-id slugs from leaking into expanded Schedule rows.
- Scope: shared ownership presentation, Schedule and expanded scoreboards, Matchups owner cards,
  Overview guard convergence, and the nearest component/library tests. Ownership attribution,
  roster contents, draft behavior, and scoreboard contracts were unchanged.
- Outcome: `displayOwner` now hides the sentinel at member seams; Matchups suppresses sentinel
  opponent metadata and owner cards and remains owner-only with no count-only excluded-games block.
  Non-catalog teams use provider casing while catalog scoreboard labels remain authoritative.
- Review / verification: exact pre-merge head `5fd15a07` passed TypeScript, `lint:all`, and all 4,585
  tests (net +4). Seam, explicit-roster, empty-owner-row, and participant-name mutations failed the
  intended assertions. Reviews caught the explicit-sentinel Matchups path, the bare `vs` row, and an
  inconsistent excluded summary; the approved remediations addressed each, and final Codex review
  was clean. Final `/code-review` confirmation was unavailable because its local client was not
  authenticated.
- Status: Merged via PR #560 (merge commit `0b95aeca`), 2026-09-03.

### PLATFORM-123-ODDS-FAVORITE-PAIRING-v1

- Purpose: correct the live Odds display defect that paired one participant's name with the other
  participant's spread on normal symmetric book lines, including frozen historical closing lines.
- Scope: the shared spread/favorite derivation, new-snapshot production, stored-snapshot projection,
  upset-policy consumption, and focused producer/projection/render tests. Fetching, attachment,
  cadence, cache schema, and durable writes were unchanged.
- Outcome: one signed-side-spread helper now selects the favorite for all three consumers. Valid
  stored snapshots are corrected non-mutatively on read; already-correct rows remain correct;
  pick'em keeps the reported spread with no favorite; malformed durable rows remain visible to the
  recap validation boundary instead of being silently repaired.
- Review / verification: exact pre-merge head `b7685e10` passed TypeScript, `lint:all`, and all 4,570
  tests. Six tests were added and one producer test gained two assertions; none were removed or
  weakened. Reverting to the absolute-value comparison failed five tests, including the real
  provider-shaped symmetric fixture (`Clemson` observed instead of `Georgia`). One remediation
  preserved malformed-row validation; Codex and `/code-review` confirmations then found no credible
  in-scope P0/P1/P2.
- Status: Merged via PR #556 (merge commit `bbd40a47`), 2026-09-03.

### PLATFORM-121-ODDS-FIXTURE-EXPIRY-v2

- Purpose: replace odds-route fixtures whose fixed kickoffs made correct production closing-line
  behavior turn the test suite red as the wall clock advanced.
- Scope: `src/app/api/odds/__tests__/route.test.ts` and its local timing helper only; no production
  route, odds-library, or durable-store behavior changed.
- Outcome: all pregame, post-kickoff, delayed-kickoff, and same-pair-rematch fixtures now state their
  temporal relationship relative to execution time. Repeated meetings stay 30 days apart, safely
  outside the 24-hour attachment tolerance, and the remaining durable snapshot captures are relative.
- Review / verification: exact pre-merge head `5d49f400` passed TypeScript, `lint:all`, and the
  4,552-test suite with no test additions, removals, skips, or weakened assertions. The 21-test route
  file passed at ten clock offsets through +700 days across four time zones; the same harness
  reproduced `main`'s growing failure count (4 at +0, 5 at +60, 6 at +365), proving the non-expiry
  check was not vacuous. Four assertion mutations failed as intended, and a temporary 36-hour
  attachment tolerance remained 21/21 green after the rematch-fixture remediation. Codex and
  `/code-review` left no credible in-scope P0/P1/P2.
- Status: Merged via PR #553 (merge commit `e952a657`), 2026-09-02.

### PLATFORM-121-ODDS-TEST-HARNESS-v1

- Purpose: restore four failing odds-route tests under the initial theory that their schedule fetch
  mocks were inert after a server-side cache-reader migration.
- Scope: the odds route test harness only; production changes were explicitly forbidden.
- Outcome: stopped at the diagnosis gate. The route still self-fetches its schedule, both mock styles
  fire, and durable seeding was the wrong repair; the actual defect was wall-clock fixture expiry.
- Review / verification: the first test's observed schedule year proved the mock executed. Re-running
  historical commits under the current clock was rejected as an invalid regression-bisection method;
  the corrected analysis and deterministic proof moved to v2.
- Status: Superseded/unimplemented; replaced by `PLATFORM-121-ODDS-FIXTURE-EXPIRY-v2` / PR #553.

### PLATFORM-120-SCHEDULE-FBS-FILTER-v3

- Purpose: reduce canonical schedule-build cost at the two highest-frequency readers while deleting
  the unsupported member-visible week-0 derivation.
- Scope: the live-score and game-stats canonical build contexts, a shared FBS-relevance predicate,
  the regular-season span used for postseason offsets, and focused regression coverage. Durable
  schedule writers and the `/api/schedule` response remain unchanged.
- Outcome: both hot contexts now omit only regular-season rows whose two normalized provider
  classifications are known non-FBS, retain every postseason row, and keep the full raw game-stats
  snapshot for metadata and duplicate-CFBD-id rejection. Provider week 1 is always canonical week 1.
- Review / verification: exact pre-merge head `9259ea9e` passed TypeScript and `lint:all`; the
  4,552-test suite added nine passing tests and retained the four then-expired PLATFORM-121 odds
  failures reproduced on `main`. Mutations proved both reader filters, duplicate-id rejection, postseason
  offset containment, and week-0 deletion. Codex and `/code-review` left no credible in-scope
  P0/P1/P2.
- Status: Merged via PR #551 (merge commit `ce176ccd`), 2026-09-02. Item 104 remains the
  architectural follow-up for replacing the scalar canonical-week model; Item 100b remains
  date-gated before the 2027 opening slate.

### PLATFORM-120-SCHEDULE-FBS-FILTER-v2

- Purpose: relocate the v1 write-path predicate to the live-score and game-stats canonical readers.
- Scope: the same two readers, a neutral relevance predicate, and tests; write-path changes were
  reverted.
- Outcome: stopped after the reader filter exposed three raw-row dependencies: the postseason offset
  moved with the filtered regular-season span, game-stats lost duplicate-provider-id evidence, and
  the live-score test did not prove rows were absent from the build.
- Review / verification: the stop established the complete raw-row dependency inventory and the
  acceptance tests carried by v3; no v2 behavior was merged.
- Status: Superseded/unimplemented; replaced by v3 / PR #551.

### PLATFORM-120-SCHEDULE-FBS-FILTER-v1

- Purpose: filter both-known-non-FBS rows when full-season CFBD schedules were persisted and remove
  canonical week 0.
- Scope: both durable schedule writers, schedule normalization, canonical-week derivation, and tests.
- Outcome: stopped. The predicate was sound, but deleting accurate rows made deliberately filtered
  empties indistinguishable from provider empties, created false vanished-game diagnostics, blinded
  schedule-eligibility diagnostics, and weakened raw schedule expectation-oracle guards.
- Review / verification: review findings were reproduced and attributed to the write boundary;
  durable writes and `/api/schedule` were restored before v2/v3 work proceeded. The independently
  mutation-proven week-0 deletion was retained.
- Status: Superseded/unimplemented; replaced by v2 and then v3 / PR #551.

### PLATFORM-119-LEAGUE-PAGE-PAINT-v2

- Purpose: move canonical standings recomputation from the first post-score reader onto the score
  writer without risking the three-connection app-state pool.
- Scope: the public and live-cron score-write paths, one shared standings maintenance authority, and
  focused route/cache concurrency tests. No schedule, component, UI, or caching-library change.
- Outcome: each committed score mutation immediately invalidates and repopulates the same registered
  league/year standings keys in the request; failures remain non-fatal. A process-wide queue is
  entered before the year-scoped durable transaction, preventing concurrent warmers from holding all
  pool clients while their nested standings reads wait for another.
- Review / verification: exact pre-merge head `784b3f06` passed TypeScript, `lint:all`, and the
  4,515-test full suite. Its production tree is patch-identical to reviewed `e70a2e1a`; Codex and
  `/code-review` found no credible in-scope P0/P1/P2, and the deadlock mutation fired the
  different-year pool-client assertion.
- Status: Merged via PR #547 (merge commit `197bde67`), 2026-08-31. The v1 response filter (119b)
  was withdrawn on the canonical-week correctness finding, not deferred; Items 99 and 100 supersede
  it.

### PLATFORM-118-TEAM-RECORDS-FRESHNESS-v2

- Purpose: guarantee clock-based recovery for cached team records and prevent counted-but-uncredited
  provider rows from rendering as trustworthy W-L-T values before Item 87 consumes them.
- Scope: the shared records freshness authority and reader, an authenticated hourly Team records
  QStash job plus scheduler/health integration, the fourteen-hour diagnostic contract, operations
  documentation, and focused/full-suite verification. Lifecycle pausing remains Item 96.
- Outcome: the six-hour finalisation floor now coexists with an independent twelve-hour ceiling; the
  hourly caller supplies no finalisation while the untouched live-scores caller keeps its signal.
  Uncreditable rows remain distinguishable from absence by team id, and stale diagnostics count them
  as present without deriving records from scores.
- Review / verification: production commit `2be6f8f8` passed TypeScript, `lint:all`, and the full
  suite; deleting the ceiling or reader guard fired their named discriminating assertions. Codex and
  `/code-review` confirmations found no credible in-scope P0/P1/P2 after one remediation; the
  fourteen-hour threshold explicitly assumes an unpaused hourly job, inherited by Item 96.
- Status: Merged via PR #546 (merge commit `c29801a4`), 2026-08-31.

### PLATFORM-118-TEAM-RECORDS-FRESHNESS-v1

- Purpose: close the same freshness and reader-creditability gaps as the replacement prompt.
- Scope: originally limited to the records refresh/cache modules and therefore lacked an independent
  idle-time trigger; a later scope revision added a Team records job after implementation had begun.
- Outcome: stopped. The first branch was not reused; v2 was re-derived from clean `main` after the
  original scope and the no-schedule instruction proved incompatible with clock-based recovery.
- Review / verification: review of stopped PR #545 established that `live-scores` exits on idle
  deliveries before reaching records, so its finalisation-only call could not enforce a ceiling.
- Status: Superseded/unimplemented (PR #545); replaced by v2 / PR #546.

### PLATFORM-117-TEAM-RECORDS-v1

- Purpose: cache CFBD year-wide team records so Item 87 slice 4 can anchor scheduled matchups on
  each team's W-L record without adding a provider call to any public read.
- Scope: one `/records?year=` URL builder, normalized year-scoped records/cache-control state, a
  finalisation-triggered refresh inside the existing live-scores job, an independent `records`
  provider-health row, cache diagnostics, and tests. No consumer, route, or scheduler job shipped.
- Outcome: `refreshTeamRecords({ year })` works for any requested year without canonical-season
  context; it opens its own year-scoped attempt, commits allowlisted rows keyed by `teamId`, rejects
  zero-row replacement of prior-good data, and is bounded to one call per qualifying run behind a
  durable six-hour floor (at most 124 calls in 31 days). Cache health has an independent eight-day
  ceiling, and score commits invalidate standings before the optional records request can wait.
- Review / verification: exact PR head `021925a3` passed lint, TypeScript, and the 4,496-test suite.
  Mutation checks named the failing assertions for final-transition gating, arbitrary-year refresh,
  scope isolation, the durable floor, zero-row retention, the eight-day no-final health ceiling, and
  standings-invalidation ordering. Final `/code-review` found no issue; Codex's repeat suggestions
  were rejected against the fixed final-only cadence, the specified zero-row drift boundary (there
  is no authoritative arbitrary-year team roster), and the measured quota-free `/info` behavior
  used by the 1,002 reserve gate.
- Status: Merged via PR #543 (merge commit `9376521e`), 2026-08-31.

### POLISH-020-OVERVIEW-WATCHLIST-SCOREBOARD-v1

- Purpose: convert the Overview watchlist to the shared compact scoreboard with team records and a
  single odds footer, completing slice 4 of Item 87 and removing the last Overview surface with a
  bespoke row type.
- Scope: `OverviewPanel`'s watchlist renderer, `CompactGameScoreboard`, `teamRecordsClient`, the
  `canonicalStandingsClientProps` server-prop threading across all five `league/[slug]` routes, the
  Overview highlight/chip labels, the watchlist depth constant, and focused component/selector
  coverage. Slice 5 (Schedule), row disclosure, and section-level expansion remained out of scope.
- Outcome: watchlist rows use the shared scoreboard anatomy; records arrive as a server prop rather
  than a client fetch; one odds footer per row; the section renders single-column on mobile via an
  `@container` ancestor. The highlight eyebrow and the owner-proximity chip were renamed to what each
  measures (`Game of the Week`, `Contender Watch`) — they previously rendered the same words for
  different signals. Watchlist depth raised 4 → 6 to match Live and Recent finals.
- Review / verification: exact pre-merge head `2bf34d9c` passed TypeScript, `lint:all`, and all 4,581
  tests, each gate its own command and exit code against a clean tree. Two mutations were observed
  failing rather than assumed: removing the watchlist `@container` fires the shared-scoreboard
  assertion, and widening `OVERVIEW_WATCHLIST_LIMIT` to 8 fires the cap assertion. The cap test was
  rebuilt from a five-game pool to eight, because a cap of six would otherwise have left the original
  assertion passing while exercising no truncation. The owner verified both late adjustments on
  preview. **Review state is incomplete and deliberately recorded as such:** review and remediation
  ran against `086c0d1c`, and the `2bf34d9c` delta (one string, one integer, four test assertions)
  carries no review outcome. Diffstat 18 files / +986 −209 crosses the AGENTS.md:306 >15-file signal;
  the expansion is the five-route records threading (~140 lines) and a 265-line server/client
  boundary test added during remediation, with approval requested in the PR rather than assumed.
- Status: Merged via PR #558 (merge commit `c730b4d0`), 2026-09-03. The owner approved the
  18-file diffstat and accepted the unreviewed `2bf34d9c` delta by inspection at merge; both were
  requested in the PR rather than assumed.

### POLISH-019-RECENT-FINALS-PROMOTION-v1

- Purpose: add Recent finals to Overview and make each owned game move through exactly one of the
  watchlist, Live, or Recent finals sections as kickoff and score evidence change.
- Scope: `OverviewPanel`, the Overview section-routing selectors, the compact scoreboard's neutral
  awaiting state, the Item 87 campaign/design contract, and focused selector/component coverage.
  Watchlist records, Schedule rework, and the postseason team-id merger remained out of scope.
- Outcome: Recent finals is a complete newest-first list with no recap-content deduplication and a
  shared Thursday 06:00 ET expiry boundary. Confirmed kickoff promotes a game to Live; missing or
  unusable score evidence renders neutral `Awaiting score` for at most eight hours; usable finals
  promote immediately; abandonment and ownership exclusion are per-game and precede state routing.
- Review / verification: exact code commit `5d83e035` passed TypeScript, `lint:all`, and 74/74
  focused tests, with one net test added. The full suite retained four odds-route failures later
  completed under PLATFORM-121; one unchanged diagnostics file timed out under aggregate host load and then
  passed 89/89 directly. Routing mutations fired their named transition/exclusivity assertions.
  Independent Codex and Claude confirmation left no credible in-scope P0/P1/P2; the remaining LOW
  findings share the currently unreachable disruption-label seam tracked beside Item 63.
- Status: Merged via PR #549 (merge commit `751a86b4`), 2026-09-01.

### POLISH-018-LIVE-STATUS-TREATMENT-v1

- Purpose: replace the partial green-live/amber-live conversion with one shared status-label
  treatment and re-cut final status from green to neutral.
- Scope: `gameUi.ts`, `CompactGameScoreboard`, Matchups, Members, Overview, and focused coverage.
  Schedule and recap stayed unchanged; Item 87 slice 5 owns the accepted Schedule residual.
- Outcome: one borderless uppercase label now supplies live emerald plus a static dot, neutral final,
  sky scheduled, and dimmer accessible unknown tones. Matchups consumes the same shape with its
  neutral freshness-gated pulse. The dead `statusClasses` and all three bespoke consumer class
  helpers were deleted.
- Review / verification: exact code commit `db147036` passed `npm run lint`, TypeScript, and the
  4,476-test full suite. **RETRACTED 2026-09-02 — the accusation was wrong; this entry's claim was
  accurate.** A correction posted here earlier the same day asserted the full-suite claim was false,
  on the basis that re-running the odds route tests at commit `db147036` yields four failures. That
  method was invalid: the four failing fixtures carry a fixed kickoff of `2026-09-01T19:30Z`, and
  `applyPregameOddsSnapshot` (`src/lib/odds.ts:225`) correctly refuses a first-seen pregame snapshot
  once the wall clock passes it. Re-running an old commit TODAY therefore fails for today's date, not
  for that commit's code. On 2026-08-31 the kickoff was still in the future and the suite genuinely
  passed. POLISH-018 reported accurately; the retracted correction is left visible so the faulty
  method is not repeated. See `PLATFORM-121-ODDS-FIXTURE-EXPIRY-v2`. Four test declarations were
  added relative to `main`; existing render assertions were retargeted without removing coverage.
  Reverting unknown to zinc-500 failed on
  `unknown label must use dimmer accessible zinc`. Independent Codex and Claude reviews found the
  same contrast gap; one remediation closed it, and confirmation left no credible in-scope
  P0/P1/P2 after the settled Matchups and source-token requirements were applied.
- Status: Merged via PR #541 (merge commit `9a45e1f3`), 2026-08-31.

### PLATFORM-116-STANDINGS-LIVE-SIGNAL-v1

- Purpose: keep the Overview standings row's live signal visible through tied games and stale score
  reads, then retire the redundant amber live-count pill.
- Scope: `liveDelta` pending-delta selectors, the Overview standings badge and count pill, and
  focused selector/component coverage. Other live surfaces and the broader color sweep stayed out.
- Outcome: Overview now reads a last-known pending delta behind a current-game-state gate, renders
  `+0–0` for tied or temporarily scoreless live games, removes the `N live` pill, and leaves the
  fresh-only accessor unchanged for Standings and Members.
- Review / verification: exact PR head `772cf4ca` passed TypeScript, `lint:all`, the 4,472-test full
  suite, and production build. Eight tests were added relative to `main`; existing only-signal,
  stale, and tied assertions were retargeted without weakening coverage. Initial Codex and Claude
  reviews agreed on a null-score gap, closed in one remediation. The required confirmation passes
  were mistakenly delayed until after merge; Codex confirmed the remediation, and Claude's repeated
  findings were evaluated against the explicit current-state and component-scope contract with no
  credible in-scope P0/P1/P2 remaining.
- Status: Merged via PR #539 (merge commit `fce338f3`), 2026-08-30.

### POLISH-017-FEATURED-SCOREBOARD-GREEN-LIVE-v1

- Purpose: convert Overview Featured results to the shared compact scoreboard, remove the last
  reachable green-final treatment on Overview, and make compact-scoreboard live status green.
- Scope: Featured row rendering, the compact scoreboard's final variant and additive context slot,
  Overview live-state color, the two-column container layout, DESIGN.md, and focused component
  coverage. Watchlist, promotion, Featured selection, and other game surfaces remain unchanged.
- Outcome: Featured keeps its existing final-only selection/order and expanded kickoff context while
  rendering neutral final scoreboards in fixed away → home order with winner emphasis. Green now
  means live within the Overview compact-scoreboard family; the surviving watchlist badge call is
  unreachable for final/live rows.
- Review / verification: exact PR head `3ec1e766` passed TypeScript, `lint:all`, the 4,464-test full
  suite, and production build. Three tests were added and two were retargeted without weakened
  assertions; browser checks confirmed two- and one-column layouts. Independent Codex and Claude
  reviews confirmed no attributable P0/P1/P2 remained.
- Status: Merged via PR #537 (merge commit `e0a7b8ab`), 2026-08-30.

### POLISH-016-SCOREBOARD-COMPONENT-LIVE-v1

- Purpose: introduce the shared game-scoreboard micro-component and convert the Overview Live
  section as the first Item 87 implementation slice.
- Scope: the live-only scoreboard row anatomy, Overview Live rendering and drilldown behavior,
  neutral live styling, two-column responsive layout, required `DESIGN.md` amendments, and focused
  component/integration coverage. Featured, recent finals, Watchlist, promotion, and green-live
  remain outside this slice.
- Outcome: Overview Live now renders through the shared team-primary scoreboard with fixed
  away-to-home order, leader weight independent of position, rank prefixes, owner suffixes, and
  right-anchored scores. Live status is structural and neutral; the section's amber border/tone
  drift is removed. Its All matchups action targets the displayed game's week and clears filters
  that could otherwise hide that game.
- Review / verification: exact PR head `661531a2` passed TypeScript, `lint:all`, the 4,461-test full
  suite, production build, and two-/one-column browser checks; 11 tests were added relative to
  `main`. Independent Codex review found no actionable regression. The owner waived the final
  Claude rerun after the focused test/navigation follow-up.
- Status: Merged via PR #535 (merge commit `5fd59d39`), 2026-08-30.

### PLATFORM-115-CFBD-REQUEST-TIMEOUT-v1

- Purpose: let CFBD-backed live-score and game-stat automation tolerate ordinary peak-Saturday
  provider latency without increasing billed calls per cron run.
- Scope: the two live-scores requests, the game-stats cron request, the separate admin scores
  refresh decision, and focused timeout, billing, and prior-good retention coverage. Eligibility,
  cadence, quota reserve, schedule windows, fallback behavior, and other provider jobs are unchanged.
- Outcome: all four scoped CFBD requests now use a shared 40-second ceiling. Both cron paths retain
  their one-attempt policy; the admin scores refresh deliberately changes from three 12-second
  attempts to one 40-second attempt, bounding one operator action to one billed call.
- Review / verification: exact PR head `c9a580e0` passed TypeScript, `lint:all`, the 4,450-test full
  suite, and production build. Eight test declarations were added for accepted-band success,
  over-ceiling failure, exact billed-request counts, and prior-good retention. Independent Codex
  review was clean; Claude confirmed the production policy and identified proof-harness defects,
  which a user-approved proof-only correction closed without another independent review. Mutation
  checks prove a second attempt fails the billed-URL assertions on all three paths.
- Status: Merged via PR #534 (merge commit `6492e68d`), 2026-08-30.

### POLISH-015-OVERVIEW-GAMES-REGION-v1

- Purpose: correct three visible Overview games-region defects during the active season without
  restructuring a surface that Item 87 will replace.
- Scope: watchlist/live state exclusion, chronological watchlist ordering with quality retained as
  labels, current-condition empty copy, and focused selector/component coverage. Section names,
  section order, and the future scoreboard/promotion model remain unchanged.
- Outcome: in-progress games no longer enter the watchlist; scheduled games sort by kickoff, then
  same-kickoff ownership priority, then stable game key; recent dated finals remain newest-first with
  undated finals last; and the empty state now reads `No recent results yet.`
- Review / verification: code commit `679f559a` passed TypeScript, lint, and the 4,442-test suite
  during confirmation review. Independent Codex and Claude reviews ran against that same commit;
  two remediation rounds moved ordering to the display seam and kept non-finite result dates out of
  bounded recent slots. Mutation checks pin the predicate, both ordering seams, and the copy.
- Status: Merged via PR #531 (merge commit `50b75f2f`), 2026-08-29; production promotion confirmed
  by the owner on 2026-08-29.

### INSIGHTS-026f-RECAP-FINAL-WIRING-v1

- Purpose: complete the request-time weekly recap by wiring every finished fact family into the
  approved Insights and Overview renderings.
- Scope: full recap composition, progressive Overview disclosure, independent archive/odds
  enrichment failure handling, truthful record and rivalry transition copy, dead Overview pulse
  removal, design-system guidance, browser verification, and focused regression coverage.
- Outcome: Insights now renders all weekly results, leaders, movement, head-to-head outcomes,
  accolades, record changes, and odds upsets; Overview retains the compact headline and reveals
  dense records, leaders, movement, and at most three prioritized highlights in place. Unavailable
  enrichment families disappear without taking down the core recap.
- Review / verification: exact commit `eab9c0cc` passed TypeScript, `lint:all`, the 4,439-test full
  suite, production build, and desktop/mobile browser checks. Independent Claude and Codex reviews
  closed every P2; final mutation checks pinned broad-tie predecessor identity, invariant tied
  rivalry values, and constituent ordering with no remaining P0/P1/P2 finding.
- Status: Merged via PR #529 (merge commit `faadabb4`), 2026-08-29; production promotion not yet
  verified.

### INSIGHTS-026e-RECAP-ODDS-UPSETS-v1

- Purpose: add odds-vs-result upset facts to the request-time weekly recap without exposing an
  interim member-facing rendering.
- Scope: one shared odds-upset policy for game-card tags and recap facts, cache-only durable odds
  loading, canonical week/ownership/finality selection, structured favorite/winner/line provenance,
  owned-v-owned deduplication, deterministic ordering, and focused boundary/failure-path coverage.
- Outcome: each eligible recap now derives structured odds upsets from the season-scoped durable
  odds store using the same six-point pregame-spread policy as game badges. Asymmetric book rows use
  the resolved favorite side's own spread; genuine odds absence yields no facts while read
  uncertainty remains distinct.
- Review / verification: exact commit `3d1ed850` passed TypeScript, `lint:all`, the 4,416-test full
  suite, and production build. One remediation round fixed asymmetric-line threshold selection and
  pinned ordering/ownership/week edges; final independent Codex and Claude reviews found no
  remaining P0/P1/P2 issue. Non-blocking follow-ups remain recorded with item 42.
- Status: Merged via PR #527 (merge commit `a1b25582`), 2026-08-29; production promotion not yet
  verified.

### INSIGHTS-026d-RECAP-RECORD-CHANGES-v1

- Purpose: add the allowlisted partial-season record-change projection to the request-time weekly
  recap pipeline without exposing an interim member-facing rendering.
- Scope: historical and live evidence projection for the six active-season-safe record ids,
  week-explicit before/current diffing, cache-only archive and roster context loading, raw recap
  facts, and focused parity, tie, rivalry, ownership, and failure-path coverage.
- Outcome: each eligible recap now derives record changes against prior completed-season history
  without feeding a partial season into the career accumulator. Live evidence uses canonical
  ownership/finality, deduplicates owned-v-owned games, excludes placeholder owners, and preserves
  the newest tied occurrence for weekly change context while legacy Records behavior stays
  unchanged by default.
- Review / verification: exact commit `52895e79` passed TypeScript, `lint:all`, the 4,402-test full
  suite, and production build. One remediation round closed tied-context, placeholder, parity-fixture,
  archive-absence, and rivalry-coverage findings; final independent Codex and Claude reviews found
  no remaining P0/P1/P2 issue. Non-blocking follow-ups remain recorded with item 42.
- Status: Merged via PR #525 (merge commit `6b541730`), 2026-08-29; production promotion not yet
  verified.

### PLATFORM-114-SCHEDULE-PROVIDER-CLASSIFICATION-v1

- Purpose: stop schedule eligibility reconstructing a participant's division when CFBD already
  stamps it on the same `/games` row, after a name-normalization collision put an entire Division II
  season into the canonical schedule as tracked games belonging to an ownable FBS team.
- Scope: provider `home_classification` / `away_classification` normalized at the mapper and
  persisted through `ScheduleItem`, `ScheduleWireItem`, and `AppGame`; preferred over conference and
  name inference in `classifyTeamSubdivision`, re-validated at that boundary because durable rows and
  postseason overrides arrive as unvalidated JSON; the conference fallback narrowed to the one match
  source that can assert a division; provider label surfaced in the eligibility diagnostic. Identity
  resolution, score attachment, scheduling, and lifecycle policy are unchanged.
- Outcome: a row the provider classifies `ii`/`iii` can no longer be promoted to FBS by a resolver
  collision (`Missouri S&T` and `Missouri State` share the normalized key `missourist`). Rows lacking
  the label keep the prior inference path, so the fix reaches production only after a full-season
  schedule refresh repopulates the cache.
- Review / verification: commit `e1edb680` passed TypeScript, `lint:all`, the 4,388-test full suite,
  and `next build`; five mutations each killed by a distinct test. Independent Codex review found no
  actionable finding; the second reviewer's MEDIUM (unvalidated provider label at the boundary) and
  LOW (unreachable policy-source disjunct) were remediated, and its observability finding is tracked
  as a deferral rather than folded in. Behaviour confirmed on preview after an authorized cache
  refresh.
- Status: Merged via PR #524 (merge commit `4a78d1b5`), 2026-08-29; production promotion and the
  required schedule-cache refresh not yet verified.

### INSIGHTS-026c-RECAP-DETAILS-v1

- Purpose: add week-explicit movement, owner matchup detail, and weekly accolades to the proven
  request-time recap pipeline without advancing the record-change or odds slices.
- Scope: pure current-season facts derived from canonical owned final participations, recap view
  model composition, the approved Week leaders and Movement renderings, guarded additive payload
  parsing, and focused selector/composer/RSC/client coverage. Owner matchup and biggest-blowout
  facts remain derived but intentionally unwired until the notable-results stage.
- Outcome: each eligible recap now carries cumulative rank movement for known finals in that exact
  week, distinct-owner per-game matchup facts, aggregate owner high scores, and deduplicated closest
  game/biggest blowout facts. Insights renders the qualified week movement and leader strip;
  Overview adds the same facts to its compact/expanded tile without coupling recap failure to the
  standing feed.
- Review / verification: eight test declarations were added for explicit-week movement, first-week
  suppression, multi-team/cardinality handling, tied risers, additive payload compatibility, and
  full-page rendering/accessibility. Exact commit `7cdfaa48` passed TypeScript, `lint:all`, the
  4,378-test full suite, and production build; final independent Claude and Codex confirmations
  reported no remaining findings.
- Status: Merged via PR #523 (merge commit `e41832ec`), 2026-08-29.

### INSIGHTS-026b-RECAP-LAYOUT-v3

- Purpose: preserve the approved weekly-recap layout while rebuilding only the Overview data seam
  around one server-coherent request-time recap payload.
- Scope: attach an independently failing recap view model to the existing authenticated Insights
  response after its cross-request cache; consume it through guarded client fetching with one
  eligibility-boundary refresh; remove v2's recap-specific score-hydration coupling; retain the
  Slice 1 selectors, Insights lead section, shared layout components, and design amendments.
- Outcome: the approved Insights lead and expandable Overview tile now share the same recap layout
  and server-coherent view model. The Overview client fetch is enabled only on that surface,
  reevaluates at the schedule-independent 06:00 ET boundary, preserves healthy standing insights
  when recap refresh fails, and renders the tile outside the schedule-success gate while keeping it
  immediately above the podium in normal flow.
- Review / verification: the v2 seam audit selected the existing authenticated Insights route as
  the bounded replacement and preserved Slice 1. The v3 review cycle then closed lifecycle-year,
  cache-placement, refresh-race, request-cost, and degraded-schedule seams. Exact code commit
  `2176e7c2` passed TypeScript, `lint:all`, the 4,370-test full suite, and production build; final
  independent Claude and Codex confirmations reported no actionable findings.
- Status: Merged via PR #521 (merge commit `af0a2118`), 2026-08-29.

### INSIGHTS-026b-RECAP-LAYOUT-v2

- Purpose: rebuild the weekly recap's approved layout and Overview tile on the proven Slice 1 facts
  without changing the remaining vertical content slices.
- Scope: shared recap header and weekly-record grid, the Insights lead section, a request-time
  Overview tile derived from already-hydrated app data, calendar-only tile phase selection, focused
  rendering/selector coverage, and the three owning design-system amendments. No new endpoint,
  durable artifact, scheduler, record projection, odds policy, or unwired content placeholder.
- Outcome: the Insights recap now uses the mockup's headline and four-column weekly-record layout;
  Overview gets a normal-flow, collapsed-by-default recap tile during the eligible-to-Thursday
  window, with expansion revealing the compact shared rows. Schedule rebuilds now clear stale
  identity-bound scores and re-arm hydration, while regular/postseason cleanliness gates the exact
  recap week independently. Recap context uncertainty remains independent from standing insights,
  and the mounted tile reevaluates the 06:00 ET boundaries.
- Review / verification: the first independent Claude/Codex review round found lifecycle,
  incomplete-copy, accessibility, and mockup-fidelity seams; remediation cycle 1 addresses them
  with focused hook, selector, composer, RSC, and component coverage. The independent rereview found
  two remaining hydration seams: cross-phase failures were aggregated, and an older in-flight build
  could suppress the replacement generation's bootstrap. Remediation cycle 2 makes hydration
  phase-specific and generation-aware, restores the two member-facing uncertainty notices, moves
  Overview applicability into a tested selector, and applies the final row-hairline correction.
  Full gates and the final independent rereview are required before merge and are reported with the
  implementation handoff.
- Status: Superseded/unmerged by `INSIGHTS-026b-RECAP-LAYOUT-v3` after final review found a
  server/client roster-generation seam in the Overview data path.

### INSIGHTS-026b-RECAP-LAYOUT-v1

- Purpose: apply the approved weekly-recap mockup as a layout stage between the walking skeleton and
  the remaining fact-family slices.
- Scope: the same member surfaces and design-system amendments later retained by v2.
- Outcome: stopped after two remediation rounds exposed an unstable seam: the mounted Overview tile
  could miss its request-time 06:00 ET transitions, and extending the insights response added an
  uncached season build to the existing endpoint. No v1 implementation was merged.
- Review / verification: the seam assessment required clean reconstruction from `origin/main`
  instead of a third patch to the stopped branch.
- Status: Superseded/unimplemented by `INSIGHTS-026b-RECAP-LAYOUT-v2`.

### INSIGHTS-026a-RECAP-SKELETON-v1

- Purpose: establish the request-time weekly Look Back pipeline before adding the remaining recap
  fact families, Overview rendering, or durable event-source delivery.
- Scope: pure target-week and weekly-result selectors, cache-only recap context loading, recap view
  model composition, the existing Insights RSC lead section, and focused regression coverage. No
  cron, scheduler registration, durable recap artifact, Overview wiring, odds, or record projection.
- Outcome: an exact-active-season recap now selects the immediately preceding eligible canonical
  week after its next-day 06:00 ET cutoff and renders per-owner W-L/PF/PA plus truthful unresolved,
  abandoned, missing-result, and no-result states without coupling standing insights to recap
  availability.
- Review / verification: 31 focused tests were added for lifecycle, calendar boundaries, canonical
  ownership, finality, loader failure, composition, and RSC rendering. TypeScript and lint passed;
  the full 4,347-test suite passed with one file worker after the host-starved four-worker runs
  produced only top-level timeout cancellations. Independent Codex review found no actionable
  P0-P3; Claude found no P0-P2, and its actionable P3 copy findings were remediated.
- Status: Merged via PR #519 (merge commit `68d7f792`), 2026-08-28.

### PLATFORM-113-ELAPSED-TIME-CONCLUSION-DIAGNOSTICS-v1

- Purpose: make the elapsed-time allowance observable when canonical season finality accepts
  unresolved games without positive result evidence.
- Scope: the shared request-time pending-game finality selector, the cache-only canonical
  live-score context, score-health and System Health diagnostics, bounded provider-addressable game
  identities, focused regression coverage, and owning documentation. Score ingestion, attachment,
  polling, lifecycle policy, and resolved-week selection are unchanged.
- Outcome: System Health emits `scores-elapsed-time-conclusions` only when the complete canonical
  pending population clears the eight-hour allowance. It retains the complete affected count,
  exposes at most six sanitized game identities, supports aggregate and child schedule-cache
  shapes, and evaluates elapsed conclusions independently from the six-hour completed-slate gate
  that still governs terminal score-gap coverage.
- Review / verification: exact code commit `21113f08` passed TypeScript, lint, the 4,316-test full
  suite, and focused finality/diagnostics coverage including the mixed-timing regression. Independent
  Codex and Claude reviews found no actionable P0/P1/P2 correctness issue.
- Status: Merged via PR #518 (merge commit `bc0e741f`), 2026-08-27.

### PLATFORM-112-GAME-SCORE-GAP-DIAGNOSTICS-v1

- Purpose: stop one terminal score from hiding a missing completed-game result elsewhere in the
  same provider week and give the operator enough identity to run the existing recovery action.
- Scope: cache-only score diagnostics, the shared canonical live-score context and conclusion
  fields it consumes, bounded structured System Health identities, focused tests, and owning
  documentation. Score ingestion, attachment precedence, refresh cadence, and repair actions are
  unchanged.
- Outcome: every addressable expected game in a completed `(providerWeek, seasonType)` partition is
  checked against its own canonically attached score. Canceled games resolve scorelessly;
  placeholder, pending, and disrupted games do not owe a final without stronger conclusion
  evidence; a final requires both numeric scores. Diagnostics retain the complete affected count
  while exposing at most six sanitized, bounded game identities with CFBD id and provider partition.
- Review / verification: thirteen focused tests were added and the obsolete slate-granularity
  assertion was replaced with the sibling-gap contract; coverage includes exact-snapshot use,
  pending/disrupted/placeholder treatment, incomplete finals, bounded totals, identity sanitization,
  System Health rendering, and repair routing. Sanitizer and kickoff-normalization protections were
  mutation-proven. Exact code commit `b035d890` passed TypeScript, `lint:all`, and the 4,301-test full
  suite; independent Codex and Claude reviews found no credible in-scope P0/P1/P2. Their
  non-blocking observations are retained as evidence-gated queue item 81. Production was verified
  serving `30bb515f` after its 13:44 CDT promotion on 2026-08-27.
- Status: Merged via PR #516 (merge commit `30bb515f`), 2026-08-27.

### PLATFORM-111-TRANSITION-ANCHOR-v2

- Purpose: anchor the daily preseason-to-season transition and member-facing season-start date to a
  game a league can actually see, while keeping every consumer date-based and without filtering
  non-FBS rows out of the canonical schedule.
- Scope: the shared schedule-probe authority; the three live durable probe writers in the manual
  schedule route, weekly schedule-refresh cron, and season-transition cron (plus the manual route's
  pre-existing unreachable duplicate block); the pure UTC-date boundary shared by `StandingsPanel`
  and `CFBScheduleApp`; focused policy, route, selector, and component tests; owning documentation.
- Outcome: `firstGameDate` is now midnight UTC on the earliest date with an FBS participant resolved
  through the durable catalog and league-agnostic aliases. Provider-only observed names cannot
  self-resolve; exact kickoff time and TBD confidence are ignored; no eligible row falls back to the
  earliest parseable UTC date and no parseable date returns `null`. The whole post-commit probe
  update—identity reads plus durable write—shares one typed failure phase, so a derivation failure
  preserves committed schedule work as `partial / probe-write-failed` in events and receipts.
  Awaiting-season presentation remains active before and throughout the opening UTC date, then
  expires at the following UTC midnight; legacy exact-kickoff probe values normalize to their UTC
  date. A durable Southern Conference identity is explicitly pinned as FCS rather than
  league-visible.
- Review / verification: Claude confirmed one P2 in the initial diff: asynchronous identity reads
  could throw after schedule commit while the route still classified the phase as `other`. The
  first remediation is pinned through the event, receipt, committed schedule, and absent probe. A
  later seam audit found that two member consumers still interpreted the new midnight anchor as an
  exact kickoff; v2 centralizes their UTC end-of-date boundary without restoring kickoff-time state.
  Expanded focused helper, probe, selector, and component suites passed 118/118; the mandatory full
  suite passed 4,289/4,289. TypeScript, ESLint, Prettier, Markdown lint, diff checks, and the React
  review checklist passed. Tests used local provider stubs; no external provider request or
  production-state mutation occurred. After promotion, the QStash schedule-refresh job persisted
  the corrected exact-midnight `2026-08-29T00:00:00.000Z` probe at 02:56 UTC on 2026-08-27 while
  preserving `baseCachedAt`, verifying the production path end to end.
- Status: Merged via PR #514 (merge commit `dc8b3528`), 2026-08-26.

### DOCS-018-CURRENT-AUTHORITY-RECONCILIATION-v1

- Purpose: remove completed rollout/migration history and stale provider/auth claims from documents
  that are supposed to describe current architecture and operations.
- Scope: current auth, provider-data, storage, diagnostics, admin-control-plane, game-stats writer,
  onboarding, architecture-map, roadmap, and related user-facing provider-description wording;
  archive only the historical context still useful for future tasking. No runtime policy, cadence,
  permission, provider call, durable state, or deployment change. The owner approved each document
  reconstruction in sequence and then explicitly authorized the remaining cross-doc authority pass;
  review remediation added the binding auth authority and two directly cited current/source files;
  the final branch diff is 25 files, +3,362/-10,616, still dominated by deleting duplicated history
  from the queue, prompt ledger, and operator references rather than runtime expansion.
- Outcome: current docs now distinguish today's platform-admin-only enforcement from the planned
  commissioner/member role model and describe all active provider jobs; the admin and game-stats
  authorities were reconstructed around present behavior; completed F2 migration history moved to a
  dated archive; doc maps and roadmap references point to the right current or historical owner; two
  stale System Health automation descriptions were corrected.
- Review / verification: audited against live route inventories, auth helpers, maintenance-action
  descriptors, scheduler receipt types, provider settings, and writer-control/ingestion/evidence
  code. Independent Claude and Codex reviews were gathered against `67195db3` before remediation;
  the accepted authority, operator-procedure, link, archive-convention, and retained-rationale
  findings were handled together under the owner's ruling that commissioner/member roles remain
  planned product direction. Pre-remediation TypeScript, focused regression, lint, and Markdown
  gates passed; remediation verification is reported against its exact commit in PR #513.
- Status: Implemented on the feature branch; not yet merged.

### DOCS-017-APP-ARCHITECTURE-SKETCH-v1

- Purpose: make the compact App Architecture sketch accurately show the production data boundary
  without duplicating the full architecture or deployment documentation.
- Scope: `docs/CFB_APP_ARCHITECTURE.md`, its wording reference in the architecture overview, and
  this registry record. No runtime, provider, cache, scheduler, or deployment change.
- Outcome: the sketch now distinguishes authorized provider refreshes from cache-only public reads,
  shows durable schedule/score/odds caches, preserves schedule-derived canonical game identity, and
  depicts scores, odds, ownership, and presentation as overlays feeding selectors/components and UI.
- Review / verification: checked against `AGENTS.md`, the current architecture overview and game-data
  flow; Markdown structure, local links, and diff integrity verified.
- Status: Implemented on the feature branch; not yet merged.

### DOCS-016-DEPLOYMENT-RUNBOOK-RECONSTRUCTION-v1

- Purpose: restore the production deployment runbook as a current operator procedure instead of a
  mixed procedure-and-rollout-history ledger.
- Scope: restructure `docs/deployment-runbook.md`; archive completed 2026 promotion/provider
  activation evidence; update directly affected documentation links and status claims. No runtime,
  provider cadence, deployment, secret, gate, or production-state mutation.
- Outcome: current promotion, preview, build-gate, provider emergency-control, presentation
  observation, and recovery procedures remain in the runbook; completed repair/activation evidence
  moved to a dated operations archive; one canonical five-schedule `CRON_SECRET` rotation replaced
  the accumulated two/four/five-schedule variants.
- Review / verification: cross-reference, Markdown-link, stale-claim, and diff-integrity checks.
- Status: Implemented on the feature branch; not yet merged.

### DOCS-015-VISION-REFRESH-v1

- Purpose: restore `docs/vision.md` as an evergreen product and production-data-policy authority
  after provider automation, multi-league support, and production launch made several status claims
  stale.
- Scope: `docs/vision.md` structure and wording plus this registry record; no roadmap priority,
  runtime behavior, access policy, provider cadence, or design-system change.
- Outcome: the vision now distinguishes durable league state, provider-backed shared snapshots, and
  derived read models; reflects controlled production automation and current multi-league support;
  preserves the private-link entry decision; and frames commissioner signup as conditional growth.
- Review / verification: checked against the current roadmap, production activation records, and
  documentation ownership map; Markdown lint and diff-integrity checks completed.
- Status: Implemented on the feature branch; not yet merged.

### DOCS-014-PROMPT-REGISTRY-COMPACTION-v1

- Purpose: restore the prompt registry as a concise historical index rather than a duplicate case
  file for implementation and review history.
- Scope: `docs/prompt-registry.md` only; compact verbose records, restore chronological placement,
  index formal precursor prompts, and preserve current queue/architecture ownership boundaries.
- Outcome: verbose records retain purpose, scope, shipped or stopped outcome, review/verification
  provenance, and implementation status; detailed narratives remain recoverable from Git and PR
  history instead of living in the active ledger.
- Review / verification: structural checks cover heading uniqueness, chronological placement of the
  repaired entries, prompt-ID coverage, five-field shape for compacted records, and Markdown lint.
- Status: Implemented on the feature branch; not yet merged.

### PLATFORM-110-SCHEDULE-VANISHED-GAME-LOGGING-v2

- Purpose: make a CFBD game record that disappears between canonical schedule snapshots visible to operators without treating ordinary same-id rewrites as incidents.
- Scope: the shared full-season schedule refresh authority, an observability-only partition baseline reader, a secret-safe structured runtime event, direct helper tests, integration controls, and operator documentation.
- Outcome: after a confirmed `written-clean` durable commit, positive numeric ids absent from the new snapshot emit one `schedule-games-vanished` event. Same-id kickoff/team/venue rewrites are silent; prior ids deduplicate; malformed rows are skipped individually; details cap at 25 while preserving the total count; logging cannot fail the commit.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #512 (`1d550c1e`), 2026-08-26. Not promoted at the recorded closeout.

### PLATFORM-110-SCHEDULE-VANISHED-GAME-LOGGING-v1

- Purpose: add the same vanished-record runtime signal to the full-season CFBD schedule refresh.
- Scope: the stopped `platform/schedule-vanished-game-logging` branch (`8f347441`, `24badae2`,
  `ee813bf6`) and its two remediation rounds.
- Outcome: abandoned after review showed that its partition fallback compared child timestamps to a
  single `nowMs` reused across the season-transition year loop. A live partition write during an
  earlier year's provider work could therefore silence the later year's first aggregate comparison.
  The replacement was re-derived from clean main; none of these commits was cherry-picked.
- Review / verification: the first rounds corrected kickoff-metric contamination and added direct
  event coverage, but mutation review proved the timestamp mechanism and fallback path were not
  independently established. The remaining production defect triggered the repository's
  reconstruction rule rather than a third patch.
- Status: Superseded/unimplemented — never merged. Replaced by
  `PLATFORM-110-SCHEDULE-VANISHED-GAME-LOGGING-v2`.

### POLISH-014-TREND-SEASON-ORIGIN-v1

- Purpose: make week one an ordinary trend instead of a special case, closing `docs/next-tasks.md` item 74 and the two MEDIUM findings folded into it.
- Scope: Primary touched areas: `selectors/trends.ts`, `MiniTrendsGrid.tsx`, `OverviewPanel.tsx`, `history/SeasonArcChart.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `SEASON_ORIGIN_GAMES_BACK` states what `deriveStandings` already claims about an unplayed record — everyone level at 0 games back — rather than inventing data, and gives a one-week series the second endpoint a line needs. Measured: one resolved week renders `M7.0,0.0 L462.9,0.0` and `M7.0,0.0 L462.9,145.5` where the pre-fix render produced moveto-only paths.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #511 (`2b81da6a`), 2026-08-25. Promoted at the recorded closeout.

### POLISH-013-TREND-EMPTY-STATES-v1

- Purpose: stop Overview's "GB Race" rendering a heading, a divider and a link over a completely empty body, and close `docs/next-tasks.md` item 72.
- Scope: Primary touched areas: `OverviewPanel.tsx`, `lib/trendEmptyState.ts`, `MiniTrendsGrid.tsx`, `selectors/historyResolution.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: the section asks `selectGamesBackTrend` — the selector both children reduce to — and keeps rendering when it is empty, with an explained empty state and no axes. It applies whenever the league has owner rows, so a `preseason-names` league no longer sees it appear at the draft. The section requires a DRAWABLE series — one with at least two points — because a one-point series emits a moveto-only path that SVG does not render.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #510 (`cf159341`), 2026-08-25. Promoted at the recorded closeout.

### PLATFORM-109-STANDINGS-PENDING-PAYLOAD-v1

- Purpose: stop shipping the whole season's unplayed-game list to the browser so the browser can reduce it to one of three strings, and close `docs/next-tasks.md` item 64(a) and 64(d).
- Scope: new `selectors/canonicalStandingsClient.ts`; the five `league/[slug]` route pages; `CFBScheduleApp` and `OverviewPanel` prop contracts; `selectors/seasonContext.ts`, `selectors/overview.ts`, `selectors/leagueStandings.ts`, `insights/loadInsights.ts`; tests.
- Outcome: `canonicalStandingsClientProps` derives the season context server-side from the UNSTRIPPED snapshot and strips `pending` before the client boundary; the pages spread both together so one cannot ship without the other. Measured on the real production 2026 schedule (3,610 rows): 898 pending entries, canonical snapshot 80,922 → 16,789 JSON bytes.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #509 (`be80181a`), 2026-08-25. Promoted at the recorded closeout.

### POLISH-012-TREND-CHART-HOOKS-CRASH-v1

- Purpose: Fix a LIVE production crash — clicking the Win % chart tab on the standings page threw and dropped the whole page to the error boundary — and enforce the rule that prevents its class.
- Scope: `SharedTrendChart` / `TrendChartBody` in `TrendsDetailSurface.tsx`, the three trend selectors in `selectors/trends.ts`, `history/SeasonArcChart.tsx`, `eslint.config.mjs`, and tests.
- Outcome: two causes, both fixed. `SharedTrendChart` ran five hooks, took an early return for `rows.length === 0`, then ran three more; both metric charts sit in a ternary at the SAME position so React reconciles them onto ONE fiber, and a metric switch crossing that boundary changed the hook count. Extracted `TrendChartBody` (all hooks, no early return) behind a hook-free wrapper.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #508 (`013ec32b`), 2026-08-23. Promoted at the recorded closeout.

### POLISH-011-STANDINGS-COVERAGE-COPY-v1

- Purpose: Replace the member-facing standings coverage message with the owner's decided wording, and remove two coverage variants no production caller could reach.
- Scope: `deriveStandingsCoverage`, the `coverageOptions` pass-through on `deriveStandingsHistory`, the Overview notice, and their tests.
- Outcome: the incomplete state makes ONE claim, `Waiting on complete results`.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered tests, build as applicable.
- Status: Merged via PR #507 (`15573589`), 2026-08-23. Not promoted at the recorded closeout.

### PLATFORM-108-TEST-PACING-AND-STARTUP-v1

- Purpose: Stop test suites paying the production provider pacing delay, deliberately cover the shared pacing gate, and re-measure the suite before deciding whether to change the 30-second per-file limit.
- Scope: Primary touched areas: `fetchUpstream.ts`, `run-tests.mjs`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The runner sets `UPSTREAM_PACING_DISABLED=1`; `applyPacing` honors it only when Node also supplies the exact test-child signal `NODE_TEST_CONTEXT=child-v8`. This is deliberately independent of `NODE_ENV` (route harnesses overwrite it) and `APP_STATE_TEST_ISOLATION` (store isolation has one meaning). Missing or changed signals fail closed to pacing.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #506 (`1896b149`), 2026-08-22.

### PLATFORM-107-FINAL-SCORE-SWEEPER-v2

- Purpose: Give a provider-final, score-required game that missed its ordinary live-polling window automatic eventual recovery on the next weekly schedule refresh, while keeping recorded finals immutable and measuring kickoff churn.
- Scope: The whole-season schedule wire/normalization seam, an opt-in final-score sweep through the existing `mergeScoresIntoPartition` authority, exact score-refresh status resolution, cron event/receipt projections, and tests.
- Outcome: Weekly cron refreshes now group CFBD finals by provider week and season type, match cache coverage by exact `seasonType:providerGameId`, and submit only missing usable finals. Existing finals are never restated; different scores are logged with bounded identity.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #505 (`878a3466`), 2026-08-21.

### PLATFORM-106-SCHEDULE-REFRESH-TEST-SPLIT-v1

- Purpose: Stop two test files crossing the 30-second per-file budget under full-suite contention, which made `npm test` fail intermittently on the maintenance host.
- Scope: Primary touched areas: `scripts/run-tests.mjs`, `_routeHarness.ts`, `_pageHarness.tsx`, `src/test/__tests__/testRunner.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `nodeTestConcurrency` is `Math.min(4, Math.max(1, availableParallelism() - 1))` — a true cap that never exceeds Node's default on a constrained host. **The cap is the load-bearing fix; the two splits add margin and do not make higher file concurrency safe** — recorded in `run-tests.mjs` because that is where someone would remove it.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #504 (`792b27a6`), 2026-08-21.

### PLATFORM-105A-SCORE-COVERAGE-INTEGRITY-v1

- Purpose: Prevent a cumulative standings snapshot from resolving when an owned game has strong score-bearing conclusion evidence but no attached numeric result, while preserving canceled games as legitimate scoreless terminal outcomes.
- Scope: one ordered conclusion-evidence classifier shared by week progress and standings coverage; the coverage guard order; focused precedence, production-shape, and cumulative-policy tests; and the canonical week-resolution model.
- Outcome: final score evidence, schedule `completed: true`, or schedule `status: 'final'` now require both numeric points before an owned game satisfies standings coverage; any of those signals beats a conflicting cancellation label, while cancellation alone remains `scoreless-terminal`. Coverage remains cumulative and fail-closed intentionally: an early missing owned result blocks every later snapshot because those standings omit the same result.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #503 (`31db3706`), 2026-08-20.

### PLATFORM-105-WEEK-RESOLUTION-v1

- Purpose: A week counts as played only when its games have concluded, so a season in progress stops reporting itself as over from its first Saturday.
- Scope: the week-resolution predicate, `selectSeasonContext`, and the consumers of the meaning they changed. Model in `docs/architecture/week-resolution.md`.
- Outcome: A week is resolved only when real planned games have concluded, and season finality is based on every real game having a result rather than vacuous score coverage. This made early- and mid-season lifecycle states reachable instead of reporting the season as final from week one.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #502 (`e197d449`), 2026-08-20.

### POLISH-010-DARK-ONLY-THEME-v1

- Purpose: Retire light mode.
- Scope: Primary touched areas: `globals.css`, `publicLanding.css`, `DESIGN.md`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `dark:` utilities are unconditional, so the ~1,127 light base classes they pair with are dormant rather than deleted and the retirement reverts by the single variant declaration.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #500 (`6109df6f`), 2026-08-19.

### POLISH-009-HISTORY-STATS-MOBILE-v1

- Purpose: Repair the History → Stats mobile view after owner ranks, names, values, and controls collapsed into the fixed desktop grid; make its small controls usable by touch and restore the apparently inert Active-only filter.
- Scope: the owner-ranking and event-record responsive layouts, their Show-all controls, `ActiveOnlyToggle`, History Stats roster wiring, a pure History membership selector, and focused component/selector coverage.
- Outcome: Mobile record podiums stack below the label/actions header and return to three columns at `lg`; Show all and the owner switch have 44px mobile targets. Active filtering now takes current membership from the canonical confirmed roster. Before a new roster is confirmed it uses only the most recent archived roster (then that archive's final standings as a backstop), instead of the union of every archived owner that made every former owner appear active.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #497 (`e91f2f65`), 2026-08-19.

### POLISH-008-POLL-MOVEMENT-COLUMN-v1

- Purpose: Stop the FBS Polls tab claiming every ranked team was unranked a week ago.
- Scope: `RankingsPageContent` and its tests. No selector, route, data-model or cache change.
- Outcome: When no prior poll exists, the movement column is omitted rather than labeling every ranked team NR. In-season movement remains visible under the accurate “vs last” label, including genuine new entrants.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #496 (`3a11696f`), 2026-08-19.

### POLISH-007-GAME-DAY-CONFIDENCE-LAYER-v1

- Purpose: Give members a truthful sign that the app is alive around kickoff without reviving the false page-wide live claims cut from POLISH-005.
- Scope: exact-week score-response observation evidence, the client live-refresh hook, a pure game-day confidence selector.
- Outcome: The neutral header moves through bounded `Preparing for kickoff`, `Waiting for scores`, and `Tracking scores` states. Tracking requires a recent successful exact-scope provider attempt plus an in-progress score attached in that same poll; stale, incomplete, historical, and disrupted inputs fail closed, including canceled/postponed games with no score row.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #495 (`3a76fca3`), 2026-08-19.

### PLATFORM-104-POLL-SOURCE-MATCHING-v1

- Purpose: Stop a non-FBS poll from claiming an FBS rankings column. Owner report, 2026-08-18, from production: the Coaches Poll showed one row, `se louisiana` at rank 20.
- Scope: `normalizePollSource` in `src/lib/rankings.ts`, `mergeWeekRankings` in `src/lib/server/rankings.ts`, and `src/lib/__tests__/rankings.test.ts`. No UI, route, or cache change.
- Outcome: Poll normalization now uses an exact fail-closed allowlist and one-claim-per-source merging, preventing FCS or lower-division coaches polls from replacing the FBS Coaches Poll. AP and CFP coverage was added, and unmatched provider names are observable without accepting them.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #494 (`cb2bd7f0`), 2026-08-19.

### PLATFORM-103-TEST-SUITE-HYGIENE-v1

- Purpose: Make test discovery truthful and give the growing Node test suite focused iteration commands without changing application behavior or migrating test frameworks.
- Scope: `package.json`, the Node test wrapper, four co-located route suites, the test-layout and runner proof suites, the insights-suppression TTL boundary test, test-operation guidance, and the queue/architecture projections.
- Outcome: The four previously excluded route suites now live under their nearest `__tests__/` directories with every assertion preserved. `npm test` scans every `*.test.ts[x]` below `src/`; the layout audit rejects executable tests outside `__tests__/`, and its fixture-tree positive control proves the recursive observer sees a misplaced file. `test:file`, `test:lib`, `test:api`, and `test:components` share isolation, test tsconfig, and timeout behavior.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, tests as applicable.
- Status: Merged via PR #493 (`fc64391d`), 2026-08-18.

### POLISH-006-MATCHUPS-HEADER-REMOVAL-v1

- Purpose: Remove the week summary bar above the week pills on the league surface. Owner framing, 2026-08-18: "the bar is just carrying duplicative information that is already presented more cleanly on the page, i would argue for full removal of it."
- Scope: `CFBScheduleApp`, `WeekControls`, `src/lib/matchups.ts`, the `CFBScheduleApp` and `WeekControls` tests, and the queue/registry entries. No selector, route, or data-model change. `WeekControls` entered scope at review — see the accessibility finding below.
- Outcome: The duplicate week-summary bar and its misleading owner-count metric were removed. The existing week pills, empty state, and excluded-games panel remain the single member-facing presentation, with selected-week accessibility exposed directly by WeekControls.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #492 (`5abed2ff`), 2026-08-18.

### POLISH-005-MEMBER-SURFACE-BOUNDARY-v1

- Purpose: Remove operator and debug data-state UI from member-facing surfaces, so a member sees the app rather than its plumbing.
- Scope: `CFBScheduleApp`, `GameWeekPanel`, `MatchupsWeekPanel`, `TrendsDetailSurface`, `RankingsPageContent`.
- Outcome: Member surfaces no longer expose score/odds coverage counters, raw provider issues, fatal-bootstrap detail, or the Data notes prop chain; those diagnostics remain operator concerns. A proposed live indicator was removed after repeated evidence showed it could not state freshness truthfully.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #491 (`c08667f3`), 2026-08-18.

### INSIGHTS-032-SEASON-RECAP-v2

- Purpose: the season recap survives rollover.
- Scope: Primary touched areas: `selectors/insights.ts`, `generators/existing.ts`, `OverviewPanel.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The recap now reads the adjacent completed-season archive during preseason, names the season it describes, gates on finality, and derives the chase from the games-back slope. The failed v1 attempt was abandoned and v2 was re-derived from clean main.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #490 (`30fe85ee`), 2026-08-18.

### INSIGHTS-025-MEMBERSHIP-CHANGES-v6

- Purpose: Publish who joined, who returned and who left, derived at request time from the season archives and the season's confirmed draft.
- Scope: `src/lib/insights/` (generator, history, context, engine, loader), the insights diagnostics surface, and publication-transition cache invalidation across the five draft writers.
- Outcome: Merged as the INSIGHTS-025 slice. Membership for a season is the owner set of that season's CONFIRMED DRAFT (`context.seasonOwners`), with departures a set difference against the previous year's archive. Owner rulings: "a confirmed draft should be the gate to report results on who joined/left" and "a simple compare between the confirmed roster and the previous year's owners."
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered tests, build as applicable.
- Status: Merged via PR #487 (`0d28595b`), 2026-08-17.

### INSIGHTS-031-ROSTER-SCHEDULE-CONTENT-v1

- Purpose: The first insight content about the DRAFT rather than about college football. A game between two of an owner's own teams caps their upside — two roster-games that cannot beat anyone else.
- Scope: `insights/rosterSchedule.ts` (the pure cross-product), a generator emitting two types.
- Outcome: **the copy was written WITH the owner, line by line, rather than drafted and reviewed** — a deliberate process change, because a reviewer can check whether a sentence is true and only the owner can say whether it is any good, and this campaign had burned rounds on the difference. Every aside shipped is his or was cut by him.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #486 (`cad8362e`), 2026-08-17.

### INSIGHTS-023-PRESEASON-GATES-v1

- Purpose: Career records and league history were dark in preseason. Not by decision — the gates were set one at a time over months and disagreed: `career:volatility` ran, `career:points_leader` did not, though both are facts about finished seasons.
- Scope: `career:points_leader` and `career:greatest_season` opened into preseason, the AGENTS.md invariant-5 amendment, the copy-policy cache bump, and a gates suite. **Narrowed at review from four gate groups** — `historical` and `rivalry` were reverted to `main`.
- Outcome: decided by a two-question rule written at each gate — (1) does it need current-season evidence? (2) otherwise, is it a fact about a completed season or an accumulated record? Measured over HTTP against `main` on identical seeded data: 4 insights → 6, nothing else moved, both new lines carrying INSIGHTS-030's record citations with a real departed owner.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #485 (`389765fa`), 2026-08-16.

### INSIGHTS-030-LEAGUE-RECORD-POPULATION-v1

- Purpose: A record is a fact about the league's history; membership decides only who may be NAMED.
- Scope: Primary touched areas: `src/lib/insights/superlative.ts`, `career.ts`, `historical.ts`, `rivalry.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `resolveSuperlative` takes ONE population plus an `isMember` predicate. Eligibility is applied once to everyone and membership only partitions what survives, which makes member-cited-as-departed unrepresentable rather than merely tested for. Three standings — `holds` / `shares` / `trails`. Copy is gated on `leagueMembersSource`: when membership is only last season's roster the copy states both figures and claims nothing about who is playing.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #484 (`94e0d6da`), 2026-08-16.

### INSIGHTS-023a-LEAGUE-MEMBERSHIP-v1

- Purpose: Give the insights engine the league's actual membership.
- Scope: Primary touched areas: `src/lib/insights/context.ts`, `types.ts`, `loadInsights.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: membership resolves confirmed list → current roster → previous roster, with the source carried through to the diagnostic page. **The precedence was ruled by the owner and it inverted my first fix.** I had made the team→owner CSV win over the confirmed list; `confirmedRoster.ts` documents the opposite, because a confirmed list is an owner DECISION and a CSV is a derived artefact.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #483 (`084dec88`), 2026-08-16.

### INSIGHTS-019-DIAGNOSTIC-PAGE-v1

- Purpose: Make the Insights funnel observable — "why is my feed thin, and would rotation have anything to work with?" was answerable only by reading code.
- Scope: Primary touched areas: `src/lib/server/insightsDiagnostics.ts`, `/admin/[slug]/insights`, `src/lib/insights/limits.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: reports generated → served (All Insights) → Overview, per generator and per insight, with the Overview shortfall that client-side fallback cards cover. The backlog spec was STALE and was not built to: it called for the "suppressed set" and NEW-tag verification, both retired or deferred. Owner confirmed the funnel is the question.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, build as applicable.
- Status: Merged via PR #482 (`bfcba960`), 2026-08-16.

### PLATFORM-102-SERIALIZE-DRAFT-WRITERS-v1

- Purpose: Stop concurrent draft writers from silently erasing each other's picks, before the league's first real draft.
- Scope: Primary touched areas: `DELETE /confirm`, `PUT /api/owners`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `DraftBoardClient` fires the expire PUT automatically at countdown zero, so a pick submitted as the clock ran out was erased by expiry's stale whole-record write while its caller got a 200 — and the board then prompted for an auto-pick on a filled slot, assigning a random team. Reading under the lock makes the buzzer-beater win instead.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #481 (`a99a1038`), 2026-08-16.

### INSIGHTS-018-ROTATION-AND-NEW-TAG-v1 (ABANDONED — not merged)

- Purpose: Rotate the Insights feed on a weekly boundary and badge genuinely-changed items NEW.
- Outcome: **Stopped after four review rounds at `7b4b7664`; the branch was abandoned, not merged.**
  The un-draining half was cut out and shipped alone as INSIGHTS-029.
- **The SCOPE was the defect, not any single finding.** Rotation does nothing until the pool exceeds
  the feed, and the live league had fewer insights than it had slots. Building it first meant four
  rounds of findings against machinery with no job to do yet. Deferred behind INSIGHTS-023 (which
  widens the pool) rather than cancelled — the requirements worth reusing are recorded in
  `docs/next-tasks.md`, which is canonical for what is queued.
- **Rotation must not order by anything the write path advances.** Two attempts ordered by "least
  recently shown"; both failed, and the second failed BECAUSE of the first — showing an insight
  changed the next selection's input, so the feed churned within a bucket and then pinned the same
  set forever.
- **Every defect that reached a commit was one the tests could not observe.** A control comparing
  arrays where only the SET mattered; badge assertions passing on a still-open window rather than on
  the thing under test; a coverage guarantee asserted only under the conditions where it holds.
  Mutation testing caught several — but only because it was run after the tests already passed.

### INSIGHTS-029-STOP-DRAINING-THE-FEED-v1

- Purpose: Stop per-insight suppression from emptying a league's Insights feed. Split out of INSIGHTS-018 and shipped alone.
- Scope: Primary touched areas: `src/lib/insights/engine.ts`, `src/lib/insights/loadInsights.ts`, `AGENTS.md`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The served feed now uses a pure sort-and-cap instead of per-insight suppression, preventing unchanged historical facts from disappearing permanently. Suppression writes left the serving path, and the debug endpoint reports that truthfully.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #479 (`49c76ee9`), 2026-08-15.

### PLATFORM-100-NOCLAIM-SORTS-UNOWNED-v1

- Purpose: a confirmed roster spells "unowned" as the literal owner `NoClaim`, and the roster editor recognised only an empty string.
- Scope: `src/lib/rosterEditing.ts` (an `isUnowned` predicate shared by the sort, the Save gate and the dropped-owner count), the confirmation sentence in `src/components/admin/RosterEditorPanel.tsx`, and `src/lib/__tests__/rosterEditing.test.ts`.
- Outcome: **TWO representations of one fact, and the tests only ever saw one.** Before confirmation an unowned team is absent from the roster and reads as `''`; `buildConfirmedOwnersCsv` then writes `NoClaim` for every undrafted team. PLATFORM-099's fixture used the first shape and its assertion — "unowned teams sort LAST in both directions" — generalised to both. It was true for the shape it tested and false for the shape production writes.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #478 (`c5293a14`), 2026-08-14.

### PLATFORM-099-DRAFT-NIGHT-SAFETY-v1

- Purpose: remove the ways the draft and roster surfaces could destroy or misreport work on draft night, without touching the membership-authority predicate that stopped PLATFORM-098.
- Scope: Draft reset and roster-editing surfaces, lifecycle-aware operating-year resolution, active-season roster overwrite protection, their focused tests, and owning documentation.
- Outcome: Draft reset now requires a typed league slug; roster editing sorts by committed ownership and reports replacements/dropped rows truthfully; lifecycle-aware year resolution preserves the active-season overwrite guard while leaving genuine historical backfills unguarded.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #477 (`9537f7e8`), 2026-08-14.

### PLATFORM-098-MEMBERSHIP-AUTHORITY-AFTER-PUBLICATION-v1

- Purpose: make the owner roster the authority for league membership once a draft has published, so editing owners after confirmation stops writing a record nothing visible reads.
- Scope: The stopped membership-authority branch spanning draft publication, owner-roster persistence, reset/reopen/undo behavior, and related tests; no commits from the attempt were merged.
- Outcome: The attempt was abandoned after repeated authority predicates failed on reopen, undo, reset, and legacy-record states. Remaining membership-authority work is retained in the active queue rather than shipping an unsound precedence rule.
- Review / verification: Review did not converge, so the attempt was stopped or superseded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Superseded/unimplemented — not merged.

### PLATFORM-096-PRECONFIRMATION-PICK-EDITING-v1

- Purpose: let a commissioner correct a mis-entered draft before confirming it.
- Scope: Draft summary pick editing, draft mutation routes and transactions, vacancy/reassignment helpers, affected roster projections, and focused route/component tests.
- Outcome: Commissioners can reassign, swap, unassign, and refill draft picks before publication while preserving roster consistency and refusing invalid or conflicting edits.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #476 (`6b0b8eca`), 2026-08-14.

### PLATFORM-095-PUBLICATION-WAYFINDING-v1

- Purpose: make every surface point at Confirm before publication, and offer `Continue Setup` only after it.
- Scope: `DraftHeaderArea`, `DraftSummaryClient`, the preseason checklist copy, `AssignmentMethodCard`, and `setAssignmentMethod`, plus `DraftSetupShell` and `AssignmentMethodCard`.
- Outcome: Every draft surface now directs commissioners to Confirm before publication and offers Continue Setup only afterward. The summary exposes the publish action prominently, assignment-method changes are guarded by draft state, and broken/self-referential destinations were corrected.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #475 (`7d7b4c62`), 2026-08-13.

### PLATFORM-094-DRAFT-PUBLICATION-AND-READINESS-v2

- Purpose: make a draft's PUBLICATION a fact the app can ask about, and make setup readiness ask for it. The preseason checklist and the Complete Setup action disagreed about "are teams assigned?", and both were reading a phase that cannot answer it.
- Scope: Primary touched areas: `DraftState.publishedPicks`, `selectors/teamAssignment.ts`, `server/teamAssignmentStore.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Draft publication became explicit durable state backed by a picks digest. Confirmation publishes rosters atomically, later edits resynchronize publication, and preseason readiness requires the published assignment rather than inferring it from draft phase.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #474 (`263a48b0`), 2026-08-13.

### PLATFORM-094-TEAM-ASSIGNMENT-READINESS-v1

- Status: **Superseded/unimplemented.** Branch `platform/094-team-assignment-readiness` abandoned at
  `51c4beab` after two remediation rounds, per `AGENTS.md` → reconstruction over accumulation.
  Rebuilt from clean `main` as `-v2` by re-deriving, not cherry-picking.
- **Why it stopped.** Each round's fix relocated the defect into the next seam. Round 1 fixed the
  dead end and moved the problem into a publication FLAG that every draft writer had to clear by
  hand — nine write sites, two updated. Round 2 made it a timestamp, which retracted publication on
  unrelated metadata edits and could compare equal within a millisecond, and its own change lost the
  pick-edit resync's phase gate so an edit mid-reopen rewrote live ownership.
- **The audit that should have come first, and did not.** Three commands established: the official
  roster has six writers (not the two designed around); `phase: 'complete'` exposes Undo, Reset and
  the pick timer, so it is not a resting state; and twenty sites read `phase === 'complete'` meaning
  two different things. Every round of findings came from a seam that inventory would have listed.
- Recorded rather than discarded: my stated reason for declining the writer-serialization finding in
  round 2 was wrong — it considered only the ordering where the other writer lands last.

### PLATFORM-093-NEW-LEAGUE-PRESEASON-BIRTH-v1

- Purpose: let a newly created league be set up. Every league was born `season`, and the whole owner-confirmation flow is gated on `preseason`, so a new league could never confirm owners — and since PLATFORM-092 it could not create a draft either.
- Scope: `POST /api/admin/leagues` and the admin create form. Nothing else.
- Outcome: a new league is born `{ state: 'preseason', year }`, and the season year is DERIVED rather than entered. An unconfigured league with no owners, no roster and no draft is setting up, not in season.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered tests, build as applicable.
- Status: Merged via PR #473 (`7deafdb3`), 2026-08-12.

### PLATFORM-092-PRESEASON-OWNER-CONFIRMATION-GATE-v2

- Purpose: enforce "owners must be confirmed before a draft can occur" by removing the unreconciled copy of the roster that `DraftState` carries — not by validating that copy against its source.
- Scope: Primary touched areas: `selectors/confirmedRoster`, `server/confirmedRosterStore`, `/api/draft/[slug]/[year]`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: a draft now TAKES its owners from the confirmed roster instead of accepting them from the request, so a draft holding names nothing else agrees with is unrepresentable rather than merely detected.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests, build as applicable.
- Status: Merged via PR #472 (`4b301296`), 2026-08-11.

### PLATFORM-092-PRESEASON-OWNER-CONFIRMATION-GATE-v1

- Purpose: enforce the invariant "owners must be confirmed before a draft can occur", so a draft can neither be created without a current-season roster nor created for people who were never on it.
- Scope: The stopped draft-creation and owner-confirmation design, including copied draft owners, current-season roster persistence, and mutation-entry validation.
- Outcome: The attempt was abandoned because it tried to detect divergence between copied owner lists at every mutation boundary instead of removing the duplicate authority. Its settled product decisions were carried into v2.
- Review / verification: Review did not converge, so the attempt was stopped or superseded.
- Status: Superseded/unimplemented — not merged; replaced by `PLATFORM-092-PRESEASON-OWNER-CONFIRMATION-GATE-v2`.

### PLATFORM-091-PRESEASON-STATUS-BANNER-v1

- Purpose: make the league banner state the league's actual preseason readiness instead of claiming `{year} Draft scheduled · Date TBD` from the lifecycle state alone, and give every league surface the facts that decision needs.
- Scope: Primary touched areas: `selectors/preseasonBanner`, `selectors/leagueLifecycle`, `/league/[slug]/*`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: a LIFECYCLE state was standing in as evidence for a DRAFT-STATUS claim. Because `DraftSettings.scheduledAt` is nullable by design, a null date was reconciled with `· Date TBD` rather than treated as the absence of evidence, so one lifecycle fact licensed four materially different states.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests as applicable.
- Status: Merged via PR #471 (`75d32b7b`), 2026-08-11.

### PLATFORM-090-GAME-STATS-PRESEASON-HEALTH-STATE-v1

- Purpose: stop the System Health Game stats row rendering an operational warning when the absence of cached game-stat data is the expected preseason state, without weakening any genuine missing-evidence warning.
- Scope: `providerDataDiagnostics` (publishes the expectation), `systemHealthPanels` (`deriveDatasetFreshness` + the provider-data rollup), `systemHealth` (wiring), and their focused suites.
- Outcome: the diagnostics authority already decided whether evidence should exist — that decision gates every missing-evidence branch — but never PUBLISHED it, so the presentation layer could not tell an expected absence from a real gap and defaulted to yellow `No cached data`, which folded into `Provider data → Attention needed` and `Overall → Attention needed`.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered tests, build as applicable.
- Status: Merged via PR #470 (`ee39e09`), 2026-08-11.

### PLATFORM-089-ODDS-EARLY-SEASON-POLLING-v1

- Purpose: poll Odds on a staged horizon so already-available lines are maintained before the old 7-day cliff, and stop the Odds health card warning when nothing is pollable.
- Scope: `pollingPolicy`, `cronExecutionLog`, `cron/odds/route`, `providerDataDiagnostics`, plus `schedulerExecutionStatus` (its closed cadence set gates the validating receipt reader).
- Outcome: eligibility and cadence were the SAME 7-day number, so a game outside it was not a target at all rather than one checked less often. Production on 2026-08-09: 125 rows committed Jul 29, then `skipped / no-eligible-target · 0 eligible game(s)` on every hourly delivery while the snapshot aged into `odds-cache-stale`.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered tests as applicable.
- Status: Merged via PR #469 (`ff5aa0c`), 2026-08-10.

### TURFWAR-WORDMARK-KERNING-CLEANUP-v1

- Purpose: one shared-wordmark typography pass — balance the whole `T-u-r-f-W-a-r` sequence as an optical composition instead of patching one pair at a time.
- Scope: `src/styles/wordmark.css`, `src/components/brand/Wordmark.tsx`, one stale comment in `src/styles/publicLanding.css`, and the two test files that pinned the old arithmetic. No size, layout, copy, font-family, or behaviour change.
- Outcome: **the `r`/`f` crowding and the `f`/`W` word-space were ONE defect.** The UI faces this app renders in kern `r` → `f` OPEN (+0.023em in SF at weight 800) because the `r`'s arm and the italic `f` collide without it; the mark's blanket `letter-spacing: -0.03em` applies after every letter and so cancelled that per-pair correction wholesale, closing the pair to a **1px pinch at the landing's 96px while its neighbours sat at 5–6px**.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered tests as applicable.
- Status: Merged via PR #468 (`fc77420`), 2026-08-10.

### TURFWAR-APP-WORDMARK-REUSE-v1

- Purpose: Extract the homepage wordmark into a shared treatment and adopt it on the two interior surfaces that render product identity, at their existing compact scale.
- Scope: new `src/components/brand/Wordmark.tsx` and `src/styles/wordmark.css`, `PublicLanding`, `/login`, `AdminLeagueDashboard`, a new `src/test/renderTree.ts` helper, and tests. Two commits: extraction with no rendered change, then adoption.
- Outcome: The homepage wordmark became a shared accessible component and was adopted by login and the admin dashboard without changing their compact scale. Rendered-contract tests replaced import-shape assertions.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: superseded on the branch before merge; merged as history via PR #466 (`38f5719`), 2026-08-09. The revision it describes never reached `main` as live code.

### TURFWAR-HOMEPAGE-WORDMARK-SIMPLIFY-v1

- Purpose: Remove the vector perspective-field strip beneath the wordmark, now redundant against the stadium plate, and let the wordmark stand on its own.
- Scope: `PublicLanding`, the landing stylesheet, landing tests, `DESIGN.md`. `LandingFieldArt.tsx` DELETED — the strip was its only remaining export. No replacement decoration added, by instruction.
- Outcome: The public wordmark treatment was simplified and its spacing made explicit while preserving the approved brand composition and accessibility contract.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #466 (`38f5719`), 2026-08-09.

### TURFWAR-HOMEPAGE-ADOBE-STADIUM-PLATE-v1

- Purpose: Replace the generated plate with the licensed Adobe Stock stadium photograph.
- Scope: production derivatives, the scene rule, and the landing asset contract. No behaviour change.
- **The prompt stated a 2048×1365 source; the supplied file was 6144×4096** — the same 3:2
  composition at 3×. Producing the named `stadium-2048` asset therefore required a DOWNSCALE, which
  is the permitted direction, and the derivatives were attributed to the v3 source by CONTENT
  FINGERPRINT rather than by filename (mean pixel distance 0.86 vs v3, 32.4 vs the superseded v2).
  `stadium-2048.avif` 91 KB / `stadium-2048.webp` 143 KB; `stadium-1672.*` retired. The 9.5 MB
  licensed original stays in the gitignored `references/`, so the repository does not redistribute it.
- **`center bottom` became `center`, and the aspect ratio is the reason.** A 3:2 source under `cover`
  crops vertically on any desktop viewport, and `bottom` takes that entire crop off the TOP where the
  light banks are: 15.6% at 1920×1080, 36.7% at 2560×1080 — which removes them completely.
- **A legibility scrim was REQUIRED, not stylistic:** this field is vividly lit where the generated
  one was dim, and the guidance card and sign-in link cross it. Legibility is measured against the
  brightest region text actually crosses, not the average.

### TURFWAR-HOMEPAGE-STADIUM-PLATE-V2-v1

- **Executed and then SUPERSEDED before it reached a commit.** A corrected v2 generated plate was
  converted and the derivatives written, then reverted when the licensed Adobe Stock image arrived.
  Recorded so the branch history is legible: the v2 work is not in the diff, and its absence is
  deliberate rather than an oversight.

### TURFWAR-HOMEPAGE-MOBILE-COMPOSITION-v1 / -FRAMING-v2 / -LOWER-STACK-SPACING-v1 / -GOALPOST-REVEAL-v2

- Purpose: record the sequence that corrected the public landing’s mobile composition and goalpost overlap.
- Scope: Public landing mobile hero anchoring, lower-stack spacing, stadium-plate framing, and related visual verification.
- Outcome: The first three margin-based attempts were superseded after proving that centering moved the composition at only half the requested rate. The final pass anchors the hero at the top, lets the lower stack claim remaining space, and uses mobile-specific plate framing.
- Review / verification: Review and verification details remain in the linked Git and PR history.
- Status: Complete — grouped historical record; passes 1–3 were superseded by the final composition.

### TURFWAR-HOMEPAGE-WORDMARK-KERNING-v1

- Purpose: optical separation at the wordmark's `f` → `W` boundary without changing the spelling.
- **The first attempt was correct CSS that shipped, won the cascade, and was invisible.** A `0.04em`
  margin had to pay back the wordmark's `-0.03em` tracking before adding anything, leaving a NET gap
  of +0.01em — about 1px — and, since the mark is centred, moving each word half a pixel. Diagnosis
  required ruling out a deployment lag, a duplicate implementation, and a cascade loss first.
- Shipped at `0.09em` for a net `0.06em`. A test pinned the NET rather than the margin, so
  retightening the tracking could not silently swallow the gap again — the exact failure that
  produced the round.
- **SUPERSEDED by `TURFWAR-WORDMARK-KERNING-CLEANUP-v1`.** Both halves of this entry's fix were
  wrong, and the second defect was already latent in the first: `0.06em` of net gap reads as a WORD
  SPACE at hero size, and the global `-0.03em` tracking this margin was sized against was itself
  cancelling the typeface's `r` → `f` kern. **The net-pinning test described above no longer
  exists** — it protected the very treatment that had to be removed. The join is now `0.02em`
  against `letter-spacing: normal`.

### PLATFORM-HOME-LANDING-RASTER-SCENE-v1

- Purpose: Replace the unsuccessful native CSS/SVG stadium scene with the approved decorative raster plate, preserving homepage structure, behaviour, and the improved hero composition.
- Scope: `PublicLanding`, `LandingFieldArt`, the landing stylesheet, landing tests, `DESIGN.md`, and two production image derivatives. No routing, auth, registry, or application-shell change.
- Outcome: The landing page gained a local decorative stadium scene while keeping meaningful content in the DOM and the product mark vector-based. Tests require the local asset and prevent a DOM image/canvas/video replacement.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #466 (`38f5719`), 2026-08-09.

### POLISH-004-PUBLIC-HOMEPAGE-STADIUM-v1

- Purpose: Redesign the public landing with a restrained, always-dark stadium atmosphere while preserving PLATFORM-088's server-rendered authentication, privacy, and entry behaviour exactly.
- Scope: `PublicLanding`, a new `LandingFieldArt` module, a landing stylesheet, `SignOutControl` colour tokens, focused tests, `DESIGN.md`, and the queue/registry entries.
- Outcome: The public landing shipped as an always-dark, accessible stadium composition built from scoped CSS/SVG decoration while preserving PLATFORM-088 authentication, privacy, and entry behavior.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #466 (`38f5719`), 2026-08-09.

### PLATFORM-088-HOMEPAGE-ENTRY-TRUTH-v1

- Purpose: Make the homepage tell the truth to each visitor — a server-rendered public entry page that works without JavaScript and leaks no registry data, and an admin-only league dashboard that reads each league's own season.
- Scope: Primary touched areas: `src/app/page.tsx`, `src/components/home/*`, `src/app/layout.tsx`, `DESIGN.md`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The root page now renders a no-JavaScript public entry without exposing registry data and an admin-only dashboard whose league cards resolve each league’s own operating season.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #465 (`f578f22`), 2026-08-08.

### INSIGHTS-022-OFFSEASON-ROSTER-CONTENT-v1

- Purpose: Keep the retrospective rookie benchmark available through the whole offseason, and stop four career cards from calling people "Returning owner" on the strength of a borrowed prior-season roster.
- Scope: Primary touched areas: `src/lib/insights/generators/career.ts`, `src/lib/insights/framing.ts`, `src/lib/insights/loadInsights.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The retrospective rookie benchmark remains available through offseason, while four career generators no longer infer “Returning owner” from a borrowed prior-season roster. The copy-policy cache identity was bumped.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #464 (`0f48b87`), 2026-08-08.

### PLATFORM-086F2H1R4-ROLLOVER-YEAR-VALIDITY-v1

- Purpose: Prevent malformed registry containers and unusable lifecycle years from reaching automatic or manual season rollover, permanent archive storage, or lifecycle persistence.
- Scope: the season-rollover cron, its shared manual `/api/admin/rollover` consumer, `groupRolloverTargets`, `completeSeasonRollover`, and their event/receipt/manual contracts. No recovery implementation, UI redesign, archive cleanup, or other automation job.
- Outcome: `groupRolloverTargets` takes a REQUIRED refusal sink and validates production `status.year` AFTER the demo exclusion, publishing refusals as it counts them. The cron refuses a malformed container with `failure / registry-malformed` at HTTP 500 (Vercel-native delivery boundary) and the manual route with 409 (admin API contract: the request is well-formed and no dependency is down).
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #455 (`995c18e`), 2026-08-06.

### PLATFORM-086F2H2A-RETIRE-SEASON-BACKFILL-v1

- Purpose: Retire the admin season-backfill surface rather than harden it.
- Scope: Primary touched areas: `POST /api/admin/backfill`, `/admin/season`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The obsolete season-backfill operation and UI were retired while preserving the legitimate historical data readers and recovery boundaries identified by the audit.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #456 (`cb40c03`), 2026-08-07.

### PLATFORM-086F2H2B-ROLLOVER-OPERATOR-TRUTH-v1

- Purpose: Stop the daily season-rollover cron from making two false statements to the operator.
- Scope: `GET /api/cron/season-rollover` zero-target reason and per-league error separation, `RolloverRefusalSink`.
- Outcome: Rollover presentation now distinguishes genuine archive/transition outcomes from skipped or misattributed work, removing two operator-facing false claims and preserving the underlying cron authority.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #457 (`876d87c`), 2026-08-07.

### PLATFORM-086F2J-COMMISSIONER-BOUNDARIES-AND-NAVIGATION-v2

- Purpose: Freeze the league's founding year after creation, surface the orphaned Draft Sequencing page, correct copy describing authority the app does not have, and put the league-password route under test. Final F2 slice.
- Scope: Primary touched areas: `PATCH /api/admin/leagues/[slug]`, `/admin`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: League configuration became immutable after creation where required, destructive operations gained explicit orphan/slug-reuse protections, and commissioner navigation was aligned with supported authority boundaries.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #463 (`d9a8e93`), 2026-08-08.

### PLATFORM-086F2I-PLATFORM-CONFIGURATION-AND-TEAM-IDENTITY-v1

- Purpose: Make League Management a REGISTRY surface rather than a second configuration surface, protect the irreversible league delete from being too easy, and finish Team Identity's naming.
- Scope: Primary touched areas: `/admin/leagues`, `POST /api/admin/leagues`, `DELETE /api/admin/leagues/[slug]`, `/debug/teams`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Platform configuration and team-identity repair were consolidated behind guarded admin operations, including safe delete, slug-reuse rejection, orphan verification, and canonical team resolution.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #462 (`cbd3ed5`), 2026-08-08.

### PLATFORM-086F2H4-RETIRE-SEASON-MANAGEMENT-v1

- Purpose: Retire `/admin/season` and everything that existed only to serve it. An admin surface represents what a human can inspect, decide, diagnose, or operate; a backend subsystem does not earn a page by existing.
- Scope: Primary touched areas: `/api/admin/rollover`, `src/lib/manualRollover.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The remaining Season Management page and preview-only rollover route were retired, leaving the season-rollover cron as the sole rollover surface and System Health as its operator-facing evidence.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #461 (`8f56835`), 2026-08-07.

### PLATFORM-086F2H3B2-SYSTEM-HEALTH-LIFECYCLE-INTEGRITY-v1

- Purpose: Surface a dedicated System Health issue when any scheduler receipt reports refused production lifecycle records, independently of the aggregate job result.
- Scope: `src/lib/server/systemHealthIssues.ts` (new code + derivation), its test and fixtures, and the owning operations documentation.
- Outcome: `lifecycle-data-unusable` — `warning`, axis `global`, subject `lifecycle-integrity`, `repair: null`. Derived purely from facts the issue model already receives: the count rides on the receipt TARGET for the four lifecycle-bearing jobs and the parser normalizes a legacy `undefined` to 0, so no new read was needed. Until now it surfaced only as a suffix inside a collapsed scheduler row.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #460 (`5822a16`), 2026-08-07.

### PLATFORM-086F2H3B1-LIFECYCLE-PRESENTATION-AND-TEST-CONTROL-FEEDBACK-v1

- Purpose: Render each league's lifecycle STATE separately from what ADVANCES it, correct the demo league's automation copy, and return typed operator feedback from the demo lifecycle controls.
- Scope: Primary touched areas: `[slug]/page.tsx`, `TestLeagueControls.tsx`, `[slug]/actions.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Lifecycle state and advancement ownership now render as separate facts, demo automation copy matches actual targeting, and demo lifecycle controls return persistent typed feedback.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #459 (`b07f2d6`), 2026-08-07.

### PLATFORM-086F2H3B-SEASON-MANAGEMENT-PRESENTATION-AUDIT-v1

- Purpose: audit whether Season Management stated lifecycle state, automation ownership, and demo
  controls truthfully.
- Scope: read-only review of league lifecycle presentation, demo automation copy, test controls,
  and the System Health lifecycle-integrity seam.
- Outcome: separated lifecycle state from the mechanism that advances it and defined two bounded
  implementation slices: presentation/control feedback and lifecycle-integrity diagnostics.
- Review / verification: owner decisions were settled before the F2H3B1 implementation and the
  remaining diagnostic work shipped in F2H3B2.
- Status: Complete — read-only precursor to F2H3B1 and F2H3B2.

### PLATFORM-086F2H3A-ROLLOVER-SURFACE-CONSOLIDATION-v1

- Purpose: Retire manual rollover EXECUTION and consolidate the two rollover panels into one production-only status surface that keeps the preview. The daily cron becomes the sole rollover executor; `/api/admin/rollover` becomes preview-only.
- Scope: Primary touched areas: `POST /api/admin/rollover`, `src/lib/manualRollover.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Manual rollover execution was retired because it duplicated the cron without unique recovery semantics. The cron became the sole executor while the uniquely useful archive preview and owner-level movement detail remained temporarily available.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #458 (`6a8b86c`), 2026-08-07.

### PLATFORM-086F2H3-ROLLOVER-SURFACE-AUDIT-v1

- Purpose: determine whether manual rollover execution and its two admin panels still represented
  distinct, necessary capabilities.
- Scope: read-only audit of the rollover cron, admin execution/preview route, Season Management
  surfaces, and recovery semantics.
- Outcome: established that manual execution duplicated the cron without a force or recovery
  advantage, while the archive preview remained uniquely useful; the owner settled those product
  decisions before implementation.
- Review / verification: conclusions were carried into the independently reviewed F2H3A slice.
- Status: Complete — read-only precursor to
  `PLATFORM-086F2H3A-ROLLOVER-SURFACE-CONSOLIDATION-v1`.

### PLATFORM-086F2H1R3-RANKINGS-YEAR-VALIDITY-v1

- Purpose: Apply the R1/R2 registry-container and lifecycle-year truth to the rankings publication cron.
- Scope: Primary touched areas: `GET /api/cron/rankings`, `/api/rankings`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: the container is read through `readLeagueRegistry()` and a malformed one refuses with `failure / registry-malformed` before any publication-context read, window claim, `/info` probe, provider request, refresh lease/status write, or commit. The read stays BEHIND the automation gate, so a corrupt registry can never turn a deliberately paused run into a scheduler failure.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #454 (`10186b2`), 2026-08-06.

### PLATFORM-086F2H1R2-WEEKLY-SCHEDULE-YEAR-VALIDITY-v1

- Purpose: Ensure weekly schedule automation rejects corrupt registries and invalid lifecycle years before selecting a maintenance year or spending provider quota.
- Scope: Primary touched areas: `GET /api/cron/schedule-refresh`, `cronExecutionLog.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: the route reads the container through `readLeagueRegistry()` and refuses a malformed one with `failure / registry-malformed` before any schedule read, probe, latch, settings read, provider request, or presentation refresh — instead of `no-maintenance-target`, which asserted no active league exists.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #453 (`3a58767`), 2026-08-06.

### PLATFORM-086F2H1R1-SEASON-TRANSITION-YEAR-VALIDITY-v1

- Purpose: Give the league-registry read a truthful container classification, and stop malformed production lifecycle years entering the season-transition cron's grouping, provider, lifecycle, event, or receipt paths.
- Scope: Primary touched areas: `leagueRegistry.ts`, `GET /api/cron/season-transition`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `readLeagueRegistry()` classifies `ok` / `missing` / `malformed`; a store failure still throws, so unavailability stays distinct from corruption, and a present non-array value — including a stored JSON `null` — is malformed, deliberately unlike `readScheduleItems`.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #452 (`e29bb47`), 2026-08-06.

### PLATFORM-086F2H1T5-SYSTEM-HEALTH-YEAR-ISOLATION-v1

- Purpose: Stop the demo league selecting the System Health operational season, resolving the year from production registry state alone while preserving lifecycle precedence, both fallbacks, the clamp, and the numeric return type.
- Scope: `resolveOperationalSeasonYear` (`src/lib/server/systemHealthYear.ts`), its focused suite, the diagnostics page suite, truthful source comments, and the owning documentation.
- Outcome: The resolver filters `TEST_LEAGUE_SLUG` from its population ONCE, before both branches, delegating the unchanged three-step rule to a private helper that receives only the filtered list — so the unfiltered registry is out of lexical scope where the rule runs.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #451 (`6e881b5`), 2026-08-05.

### PLATFORM-086F2H1T4-RANKINGS-DEMO-EXCLUSION-v1

- Purpose: Make the demo league manual-only for automatic rankings publication by resolving target-year ownership from production leagues alone, eliminating its quota and scheduler impact without changing publication-window policy.
- Scope: Primary touched areas: `src/lib/rankings/automaticContext.ts`, `GET /api/cron/rankings`, `vercel.json`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The selector filters `TEST_LEAGUE_SLUG` per league inside its ownership loop — never against the resolved years, which would drop a year a production league also occupies — and returns a closed `{ years, excludedDemoCandidate }`. The exclusion flag derives from `slug` and `status.state` only, so a malformed legacy year cannot flip the zero-target reason and an `offseason` demo record is not an excluded candidate.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #450 (`27a6c37`), 2026-08-05.

### PLATFORM-086F2H1T3-WEEKLY-SCHEDULE-DEMO-EXCLUSION-v1

- Purpose: Make the demo league manual-only for weekly schedule maintenance by removing it from the weekly cron's year-ownership computation, and close the false `season-transition-owner` deferral T2 left behind.
- Scope: Primary touched areas: `GET /api/cron/schedule-refresh`, `vercel.json`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `TEST_LEAGUE_SLUG` is filtered PER LEAGUE inside the ownership loop — never against the resolved `targetYears`, which would drop a year a production league also occupies. It is an owner-selector change, not only a target removal: `season` outranks `preseason`, so a demo league in `season(Y)` must not promote Y to the pause-exempt active-season policy over production leagues in `preseason(Y)`.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #449 (`c15413e`), 2026-08-05.

### PLATFORM-086F2H1T2-SEASON-TRANSITION-EXCLUSION-v2

- Purpose: Make the demo league manual-only for preseason→season by excluding it from the daily season-transition cron before any provider work, lifecycle write, or operational count.
- Scope: Primary touched areas: `GET /api/cron/season-transition`, `vercel.json`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `TEST_LEAGUE_SLUG` is filtered BEFORE the zero-target decision and before grouping, so a demo-only year never reaches a probe read/write, provider refresh, lifecycle write, invalidation, or any count on the response, event, or receipt. A demo-only registry reports `skipped / no-automatic-preseason-leagues`; `no-preseason-leagues` keeps its exact meaning, since reusing it would tell an operator no league awaits transition when one does.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered tests as applicable.
- Status: Merged via PR #448 (`6ab927c`), 2026-08-05.

### PLATFORM-086F2H1SB-SERVER-ACTION-AUTHORIZATION-v1

- Purpose: Make every repository-owned admin Server Action enforce platform-admin authorization at its own execution boundary.
- Scope: Primary touched areas: `src/lib/auth/requireAdminAction.ts`, `src/app/admin/[slug]/actions.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `requireAdminAction(name)` calls `resolvePlatformAdminDecision()` (the closed shared decision, NOT the `isPlatformAdminSession()` boolean wrapper) with NO argument — a `Request` would reach the token branch, whose no-token path authorizes any caller outside production — and refuses outright when `CLERK_SECRET_KEY` is blank, since Clerk's signature check degrades to an HMAC over the empty string. A thrown authorization evaluation is a refusal, never a pass.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered tests as applicable.
- Status: Merged via PR #447 (`8021b1f`), 2026-08-05.

### PLATFORM-086F2H1SA-PROTECTED-PATH-MATCHER-COVERAGE-v1

- Purpose: Close a demonstrated authentication bypass that let protected `/admin` and `/debug` paths containing a static-file extension skip Clerk middleware.
- Scope: The middleware matcher and a focused test that evaluates the real middleware and Next configuration; no authentication logic, action, UI, API, or lifecycle change.
- Outcome: `/admin/:path*` and `/debug/:path*` are matched explicitly. Matcher entries are OR'd, so their POSITION in the array carries no meaning — only their existence does.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered tests as applicable.
- Status: Merged via PR #446 (`533aed8`), 2026-08-04.

### PLATFORM-086F2H1T1-TEST-CONTROL-SAFETY-v2

- Purpose: Make the demo league's manual lifecycle controls structurally safe BEFORE removing the demo league from automatic jobs — exclusion promotes the manual control to that league's sole preseason→season path.
- Scope: Primary touched areas: `src/lib/leagueRegistry.ts`, `src/app/admin/[slug]/actions.ts`, `src/lib/league.ts`, `TestLeagueControls.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `setTestLeagueLifecycleState(state)` / `resetTestLeagueLifecycle()` take NO slug and derive + structurally validate the year INSIDE the serialized registry transaction, so a caller cannot compute a year from a React-`cache`d pre-lock read and submit it against a record that moved. An unusable stored year or an unrepresentable successor refuses with the registry byte-equivalent; reset derives nothing and always recovers a corrupt record.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered tests as applicable.
- Status: Merged via PR #445 (`8e6f122`), 2026-08-04.

### PLATFORM-086F2H1B-AUTOMATED-TRANSITION-CONVERGENCE-v1

- Purpose: Migrate the daily season-transition cron onto an exact-year, transaction-guarded transition, and make concurrent/deleted/refused targets explicit across every reporting surface.
- Scope: Primary touched areas: `src/lib/leagueRegistry.ts`, `GET /api/cron/season-transition`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Binding behavior is in [`AGENTS.md`](../AGENTS.md) → **Lifecycle Authority Invariants**; the contract is in [`docs/architecture/admin-control-plane.md`](architecture/admin-control-plane.md) → **Automated transition convergence**; the additive backward-compatible receipt counters are in [`docs/architecture/storage-and-caching.md`](architecture/storage-and-caching.md).
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered tests as applicable.
- Status: Merged via PR #443 (`be0c950`), 2026-08-04.

### PLATFORM-086F2H1A-LIFECYCLE-GUARDS-CORE-v2

- Purpose: Reconstruct the lifecycle-guard core from clean `main` after the larger PR #441 attempt accumulated review-driven scope and was rejected before merge.
- Scope: One `guardedLifecycleWrite` authority and shared `applyLifecycleStatus` projection for the commissioner offseason→preseason and exact-year setup-completion actions; the compatibility `updateLeagueStatus` setter delegates through that authority.
- Outcome: State validation or successor derivation occurs against the registry record held under the transaction lock; accepted changes persist lifecycle status and top-level year together; stale, concurrent, or unusable-year requests write nothing. Persisted legacy years remain structurally tolerated while new records use the existing `2000..currentUTCYear+1` horizon.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #442 (`d800fd6`), 2026-08-04.

### PLATFORM-086F2G1-DRAFT-ASSISTANCE-RETIREMENT-v1

- Purpose: Remove SP+ ratings and win totals from the draft experience before the in-person draft. These inputs made team selection artificially easy and silently drove available-team ordering.
- Scope: Primary touched areas: `src/lib/selectors/draftTeamInsights.ts`, `src/app/league/[slug]/draft/page.tsx`, `.../draft/board/page.tsx`, `src/app/admin/data/cache/page.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The draft embeds no SP+/win-total recommendation signal. Available teams are shown in one deterministic, recommendation-free order (locale-aware alphabetical + stable canonical team-id tie-break) identical for the commissioner and spectator boards; only neutral factual context (identity, conference, colors, schedule shape, prior-season record, preseason AP rank, ranked- opponent count) remains.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #440 (`9c3b6ce`), 2026-08-03.

### PLATFORM-086F2G-SYSTEM-HEALTH-UI-v1

- Purpose: The System Health UI for the admin control plane.
- Scope: Primary touched areas: `src/app/admin/diagnostics/page.tsx`, `src/components/admin/systemHealth/*`, `systemHealthPanels.ts`, `systemHealthYear.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Current-status dashboard — stoplight overview → prioritized issues → always-visible scheduler (7) / provider (6) / quota-storage (3) rows with row-level forensic disclosure → Automation safety controls last. Health policy stays server-side (panels/freshness derived + tested); React maps status → color.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #439 (`c5e38be`), 2026-08-03.

### PLATFORM-086F2F-SYSTEM-HEALTH-READ-MODEL-v1

- Purpose: The consolidated server-side System Health read model that F2G will render.
- Scope: Primary touched areas: `src/lib/server/systemHealth.ts`, `providerRefreshHealth.ts`, `lastError.message`, `systemHealthIssues.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Six independent facts; gates never demote a missing/late delivery; canonical freshness stays cache/evidence-sourced (never provider-status timestamps); one CFBD observation vs the 1,007 reserve and Odds vs the real 53-credit threshold; nullable truthful repair destinations (Data Maintenance / Season Management / Team Identity / none — never an ineffective action); subsystem failures degrade independently without leaking raw errors/paths/credentials.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #438 (`b9a1688`), 2026-08-02.

### PLATFORM-086F2E2B-SCHEDULER-RECEIPT-READER-CLASSIFIER-v1

- Purpose: The final scheduler-receipt foundation before F2F.
- Scope: Primary touched areas: `schedulerExecutionStatus.ts`, `src/lib/server/schedulerDeliveryHealth.ts`, `vercel.json`, `package.json`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The reader loads `scheduler-execution-status` ONCE and returns exactly seven state-bearing rows in canonical order; each carries its policy, the `requiredStartedAt` slot, a `deliveryState` (`on-time`/`late`/`missing`/`invalid`/`unavailable`), and the safely-parsed receipt or `null`.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #437 (`f84b676`), 2026-07-31.

### PLATFORM-086F2E2A-LIFECYCLE-SCHEDULER-RECEIPTS-v1

- Purpose: First half of the audited F2E2 split — extend the merged F2E1 receipt system to the two Vercel-native lifecycle crons and add their previously-missing secret-safe runtime execution-log events.
- Scope: Primary touched areas: `schedulerExecutionStatus.ts`, `src/lib/lifecycleCronExecutionLog.ts`, `vercel.json`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Every authenticated lifecycle invocation writes one allowlisted receipt (`source: 'vercel-cron'`); the five QStash jobs keep `source: 'qstash'` byte-equivalent. Both routes emit exactly one secret-safe event per invocation (auth failures included). Season transition provider truth is `exec.years.some(...providerCallAttempted)` (E1A's field); rollover is always `providerCallAttempted: false`.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #436 (`fa6e967`), 2026-07-31.

### PLATFORM-086F2E1-EXTERNAL-SCHEDULER-RECEIPTS-v1

- Purpose: First scheduler-health slice of the F2 admin control-plane redesign.
- Scope: Primary touched areas: `src/lib/server/schedulerExecutionStatus.ts`, `scheduler-execution-status/<job>`, `crypto.randomUUID`, `exec.years = entries`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Each successfully authenticated invocation writes ONE allowlisted receipt (`version`/job/`source:'qstash'`/`invocationId`/start+complete instants/nonnegative-integer duration/result/reason/`providerCallAttempted`/bounded target — multi-year jobs cap at eight entries).
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #435 (`4404ad3`), 2026-07-31.

### PLATFORM-086F2D2-SCORE-ATTACHMENT-RECOVERY-RELOCATION-v1

- Purpose: Complete the F2D operational-mutation relocation.
- Scope: Primary touched areas: `/admin/data/cache`, `/admin`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: One captured target (year 2000..currentUTCYear+1 / blank-or-bounded week 0–99 / all|regular|postseason) drives the disclosure, the mandatory `window.confirm` (naming the target, cache mutations, possible per-week fan-out, and — for week-scoped runs — the route's ACTUAL derivation: season-wide refresh per season type with games in that week, no games → no refresh), the exact request params, and the result label.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #434 (`a2a56fc`), 2026-07-30.

### PLATFORM-086F2D1-PROVIDER-MAINTENANCE-RELOCATION-v1

- Purpose: First slice of the F2D operational-mutation relocation (split at its audit into D1/D2).
- Scope: Primary touched areas: `/admin/data/cache`, `team-database/route.test.ts`, `manualRefresh.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: System Health is observational plus operational safety controls only.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #433 (`fa5c0f6`), 2026-07-30.

### PLATFORM-086F2C-MAINTENANCE-ACTION-MODEL-v1

- Purpose: Establish the Data Maintenance & Recovery page foundation.
- Scope: Primary touched areas: `src/lib/admin/maintenanceActions.ts`, `/admin/data/cache`, `/admin`, `/admin/season`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: All eight maintenance actions now disclose cost, scope, and effect accessibly; lifecycle rollover moved to Season Management; and historical-score repair records one truthful refresh attempt while distinguishing valid no-ops from writes.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #432 (`5e2c021`), 2026-07-30.

### PLATFORM-086F2B-LIFECYCLE-AUTHORITY-SAFETY-v1

- Purpose: Eliminate the three lifecycle correctness risks identified by PLATFORM-086F2A.
- Scope: Primary touched areas: `src/lib/leagueRegistry.ts`, `src/lib/rolloverTargeting.ts`, `src/lib/manualRollover.ts`, `/api/admin/rollover`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `updateLeagueStatus` is the ONE lifecycle mutation authority.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #431 (`5658413`), 2026-07-30.

### PLATFORM-086F2A-ADMIN-CONTROL-PLANE-IA-v1

- Purpose: Establish the audited admin control-plane inventory and target information architecture as canonical documentation before any PLATFORM-086F2 code slice.
- Scope: Documentation-only. New `docs/architecture/admin-control-plane.md` (canonical); queue and roadmap projections (`docs/next-tasks.md` Active priority 1, `docs/roadmap.md` 086 table); doc-index rows (`docs/README.md`, `docs/architecture/overview.md`); this entry.
- Outcome: The audit (read-only, `main` @ `7d5741a`, 2026-07-30) is recorded with independent source verification, including corrections: the rollover cron path is `/api/cron/season-rollover`; the `/admin/leagues` legacy-token copy references a panel that IS present (the real defect is a label mismatch plus legacy-fallback wording); five co-located `route.test.ts` convention violations exist (the team-database one also behaviorally drifted).
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered lint, tests as applicable.
- Status: Merged via PR #430 (`4d6b897`), 2026-07-30.

### DOCS-013-EXECUTION-BOUNDARIES-v1

- Purpose: Make the execution boundaries that repeated F2H failures exposed BINDING and discoverable in one place, instead of re-deriving them per prompt.
- Scope: Primary touched areas: `AGENTS.md`, `CLAUDE.md`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The review limit is ADAPTIVE, not a round count — both reviews are gathered on the same commit before any patch, one normal cohesive remediation is allowed, a second requires explicit user approval and only for a defect directly caused by the first, and there is no third. Reconstruction from clean `main` is the prescribed response to accumulation, re-derived rather than cherry-picked.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered lint, tests as applicable.
- Status: Merged via PR #444 (`2b09e82`), 2026-08-04.

### DOCS-012-CURRENT-LEDGER-DECONFLICTION-v2

- Purpose: Reconcile the current planning and historical ledgers so each document has one clear responsibility.
- Scope: Documentation-only, six files — `AGENTS.md` (new binding "Ledger ownership during closeout" subsection under Documentation closeout timing) plus `docs/README.md`.
- Outcome: One canonical execution queue and deferrals list (`next-tasks.md`); roadmap describes direction, not PR internals; historical ledgers keep their evidence without masquerading as current planning; future closeouts write per-ledger projections instead of copying full final reports (binding in `AGENTS.md`).
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered lint as applicable.
- Status: Merged via PR #429 (`ea4fa60`), 2026-07-30.

### PLATFORM-086E2B-RANKINGS-PUBLICATION-AUTOMATION-v1

- Purpose: Activate the merged PLATFORM-086E2A rankings authority through a publication-aware cron route.
- Scope: Primary touched areas: `GET /api/cron/rankings`, `src/app/api/cron/rankings/route.ts`, `league.year`, `src/lib/rankings/automaticContext.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: no provider work outside a due, newly claimed publication window.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #428 (`1c34352`), 2026-07-30.

### PLATFORM-086E2A-RANKINGS-REFRESH-AUTHORITY-v1

- Purpose: The first bounded slice of PLATFORM-086E2 (rankings automation).
- Scope: Primary touched areas: `src/lib/rankings/{refreshAuthority,refreshLease,refreshResult,publicationPolicy,quotaPolicy}.ts`, `src/lib/server/rankings.ts`, `src/app/api/rankings/route.ts`, `src/lib/gameStats/quotaPolicy.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: manual refresh available / public reads cache-only / automatic refresh dormant.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #427 (`a656861`), 2026-07-30.

### PLATFORM-086E1C2-SCHEDULE-PRESENTATION-AUTOMATION-WIRING-v1

- Purpose: Invoke the proven E1C1 schedule-presentation authority automatically after successful canonical weekly and season-transition schedule refreshes.
- Scope: Primary touched areas: `src/app/api/cron/schedule-refresh/route.ts`, `src/app/api/cron/season-transition/route.ts`, `refresh.status === 'success' && refresh.items.length > 0`, `/api/schedule`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: presentation data refreshes automatically alongside every qualifying canonical weekly/season-transition success under the existing schedulers.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #426 (`29976c1`), 2026-07-30.

### PLATFORM-086E1C1-SCHEDULE-PRESENTATION-CACHE-UI-v1

- Purpose: The first combined E1C slice — cache normalized CFBD game-media and venue metadata, join it cache-only into schedule responses.
- Scope: Primary touched areas: `src/lib/schedule/{schedulePresentation,schedulePresentationResult,schedulePresentationLease,schedulePresentationLog,schedulePresentationRefresh,schedulePresentationJoin}.ts`, `/games/media?year=`, `/venues`, `/games`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: presentation data is manually seedable and automatically dormant; public traffic remains provider-free; game cards truthfully separate confirmed kickoffs from `Time TBD`, show one deterministic preferred outlet, and display catalog-enriched venue lines, all degrading to exact prior output when enrichment is absent.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #425 (`1f27f5c`), 2026-07-30.

### PLATFORM-086E1B1-PRESEASON-WEEKLY-COVERAGE-v1

- Purpose: Close the dormant E1B preseason freshness gap before provisioning `turfwar-schedule-weekly`.
- Scope: Primary touched areas: `src/lib/schedule/weeklyRefreshOperation.ts`, `cronExecutionLog.ts`, `vercel.json`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: the corrected ownership model — preseason unarmed → daily transition owns discovery; preseason first-game > 7d → weekly E1B ordinary maintenance; preseason within 7d → transition owns freshness + lifecycle transition; active season / postseason boundary → existing E1B policy.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #424 (`587d5e3`), 2026-07-29.

### PLATFORM-086E1B-WEEKLY-SCHEDULE-AUTOMATION-v2

- Purpose: Activate the merged E1A full-season schedule authority through one weekly, cache-armed QStash trigger with **operation-aware** controls.
- Scope: Primary touched areas: `src/lib/schedule/weeklyRefreshOperation.ts`, `schedule/<year>-all-all`, `FullSeasonScheduleRefreshResult.providerCallAttempted`, `GET /api/cron/schedule-refresh`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: at merge the weekly route was production-capable but **DORMANT — no QStash schedule existed**; activation is the separate operator-run runbook **§8h** sequence (since EXECUTED — see Status) (preflight → provision gates-closed → exact-authentication scheduled proof (`skipped / automation-paused-or-disabled`, `providerCallAttempted: false`, quota unchanged) → open the Schedule toggle → verify one gated run → docs-only record).
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #423 (`2ddf5c4`), 2026-07-29.

### PLATFORM-086E1B-WEEKLY-SCHEDULE-AUTOMATION-v1

- Purpose: automate weekly schedule maintenance during the season.
- Scope: the proposed scheduler boundary and its relationship to lifecycle reconciliation.
- Outcome: stopped before implementation because it selected Vercel Cron for external provider
  polling; the replacement uses QStash for provider polling and reserves Vercel Cron for internal
  lifecycle work.
- Review / verification: the scheduling-boundary error was resolved during re-planning; no runtime
  implementation from v1 shipped.
- Status: Superseded/unimplemented — replaced by
  `PLATFORM-086E1B-WEEKLY-SCHEDULE-AUTOMATION-v2`.

### PLATFORM-086E1A-SCHEDULE-REFRESH-AUTHORITY-v1

- Purpose: The correctness prerequisite for weekly schedule automation (PLATFORM-086E1B).
- Scope: Primary touched areas: `src/lib/schedule/{fullSeasonScheduleRefreshResult,scheduleRefreshLease,fullSeasonScheduleRefresh,nationalChampionshipRollover}.ts`, `schedule-refresh-control/<year>`, `crypto.randomUUID`, `schedule/<year>-all-all`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: one authority for every full-season writer; concurrent writers cannot duplicate provider work or overwrite newer state (lease + observation ordering); complete-before-commit + empty-response truth preserved; only confirmed durable commits publish cache/status success/invalidation; the active-season historical bypass is closed; rollover requires a structured championship + confirmed canonical final; useful no-extra-call schedule metadata is retained.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #422 (`f320a7e`), 2026-07-29.

### PLATFORM-086C3-ODDS-CACHE-UI-HYDRATION-v1

- Purpose: Fix the confirmed production gap where a successful Odds refresh populated the durable canonical cache but game cards showed no lines.
- Scope: Primary touched areas: `src/components/hooks/useOddsHydration.ts`, `GET /api/odds?year=<season>`, `Odds fetch failed: unable to load current odds.`, `src/components/hooks/useLiveRefresh.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: every cached canonical Odds record reaches its matching game card regardless of kickoff time (far-future, live, completed, postseason); browser Odds traffic is cache-only and provider-free; Odds hydrate once per selected season, not periodically; the misleading window policy no longer suppresses cached-line display. `GameScoreboard` renders spread / over-under / moneyline from the hydrated cache as before (no UI redesign).
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #421 (`8029136`), 2026-07-29.

### PLATFORM-086C2-ODDS-POLLING-ACTIVATION-v1

- Purpose: Activate the merged, DORMANT PLATFORM-086C1 Odds refresh authority in CODE ONLY.
- Scope: Primary touched areas: `src/lib/odds/oddsRefreshExecutor.ts`, `src/app/api/cron/odds/route.ts`, `/sports`, `/odds`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: the manual and automatic Odds refresh paths cannot diverge (one executor).
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #420 (`262fdf0`), 2026-07-28.

### PLATFORM-086C1-ODDS-REFRESH-AUTHORITY-v1

- Purpose: Build the shared, concurrency-safe Odds refresh authority required before automatic Odds polling (PLATFORM-086C2) can be activated.
- Scope: Primary touched areas: `src/app/api/odds/route.ts`, `src/lib/odds/`, `refreshResult.ts`, `refreshLease.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Manual `/api/odds?refresh=1`, the future automatic refresh, and public canonical closing-line maintenance share the lease + observation-ordering authority.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #419 (`b9c6cb3`), 2026-07-28.

### DOCS-011-PLATFORM-086B2B-PRODUCTION-ACTIVATION-CLOSEOUT-v1

- Purpose: Documentation-and-memory-only closeout recording that the PLATFORM-086B2B live-score activation sequence (deployment-runbook §8f) was executed successfully in production on 2026-07-28.
- Scope: Deployment runbook §8f; current deployment, diagnostics, and game-data-flow docs; campaign ledgers; and recorded operator evidence for live-score activation. Documentation only.
- Outcome: Recorded the completed production activation of live-score automation, reconciled the runbook and current architecture text to observed deployment state, and retained the operating procedure as historical recovery guidance.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered lint as applicable.
- Status: **✅ complete — documentation + memory closeout committed directly to `main` (post-merge docs convention, no PR).** No provider/production interaction; `npm run lint:markdown` + `git diff --check` clean; the diff contains no runtime files.

### PLATFORM-086B2B-LIVE-SCORE-ACTIVATION-v1

- Purpose: Activate the merged, dormant PLATFORM-086B1 live-score engine + PLATFORM-086B2A writer-lock in CODE ONLY (one reviewed PR). Provide the operator tooling and browser/route wiring for schedule-armed 3-minute live-score polling.
- Scope: Primary touched areas: `scripts/lib/qstashSchedule.ts`, `scripts/manage-live-scores-schedule.ts`, `/api/cron/live-scores`, `*/3 * * * *`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: **Deferred (owner decision):** per-game overlay freshness — `snapshotAt`/`isStale` are per-partition/global, not per-game, so in a provider-gap scenario a fresh game can ride over a stale sibling (strictly better than pre-B2B, which reported every game fresh on any poll; true fix = per-game timestamps → per-game staleness, a separate slice). Documented in `src/lib/scores.ts` and `docs/next-tasks.md` deferrals.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #418 (`57fab82`), 2026-07-28.

### PLATFORM-086B2A-SCORE-WRITER-LOCK-CONVERGENCE-v1

- Purpose: Eliminate the concurrency gap between authorized manual score refreshes and the dormant PLATFORM-086B1 live-score engine BEFORE automation is activated — the B1-deferred item.
- Scope: Primary touched areas: `src/lib/scores/manualPartitionMerge.ts`, `src/app/api/scores/route.ts`, `scoreMerge.ts`, `manualPartitionMerge.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Code-only prerequisite; **no activation** — B2B still owns the QStash schedule, browser refresh, descriptor flip, and rollout. The rounds-2–5 findings were all merge-policy corner cases in the concurrent manual-vs-live window (inert while dormant); the core lock mechanism was stable from round 1. After eventual merge, follow the post-merge status-flip convention with the real merge commit.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #417 (`4039c98`), 2026-07-28.

### PLATFORM-086B1-LIVE-SCORE-POLLING-ENGINE-v1

- Purpose: Implement and verify the DORMANT backend engine for schedule-armed CFBD live-score polling.
- Scope: Primary touched areas: `GET /api/cron/live-scores`, `src/lib/liveScores/*`, `/games`, `CacheEntry.itemUpdatedAtById`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Engine stays dormant until **PLATFORM-086B2** activates it. One deferred non-blocker (documented in `scoreMerge.ts`): the `/api/scores?refresh=1` manual-repair path still writes the partition via a plain `setAppState` upsert that does not honor the live-merge advisory lock — a B2 concern (inert while dormant, self-healing).
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #416 (`4cbea60`), 2026-07-27.

### PLATFORM-086F1-GAME-STATS-CRON-EXECUTION-LOGGING-v1

- Purpose: Add one secret-safe, machine-readable runtime event for every invocation of the QStash-triggered game-stats cron, making scheduler decisions.
- Scope: Primary touched areas: `GET /api/cron/game-stats`, `src/lib/gameStats/cronExecutionLog.ts`, `console.log`, `src/app/api/cron/game-stats/__tests__/execution-logging.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `partial` is a first-class truthful outcome (never collapsed to success/failure). `cfbd-api-key-missing` and the defensive `ingestion-failed` catch are unreachable at runtime (`fetchCfbdUsage` throws on an empty key so the quota gate refuses first with `usage-unavailable`; H2 funnels every expected ingestion fault into a typed interpreter outcome), so their event mappings are guarded by a static source-pin rather than fabricated runtime states.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #414 (`a7f5db2`), 2026-07-27.

### PLATFORM-086I-SETTINGS-FEEDBACK-v1

- Purpose: Surface the global-pause and per-dataset auto-refresh toggle mutation errors the Provider Data Status panel already stored but never rendered.
- Scope: Primary touched areas: `src/components/admin/ProviderDataStatusPanel.tsx`, `src/components/admin/__tests__/ProviderDataStatusPanel.feedback.test.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Only a setting-consumed (`interactive`) dataset can populate a toggle-error key, so the toggle alert renders only on the Game Stats card today; planned/lifecycle-exempt datasets have no toggle and no alert. The manual-refresh feedback path is separate and unchanged. This closes the PLATFORM-086 deferred finding #2; provider automation continues with 086B (live-score polling) per the campaign execution order.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #413 (`da99a11`), 2026-07-27.

### DOCS-010-CURRENT-DOCUMENTATION-RECONCILIATION-v1

- Purpose: Post-PLATFORM-086H3E-activation reconciliation of the repository's current/canonical documentation and production-code comments with the activated game-stats architecture.
- Scope: Primary touched areas: `AGENTS.md`, `game-data-flow.md`, `storage-and-caching.md`, `auth-and-privacy.md`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Reconciled current architecture, operations, comments, and documentation ownership with the activated provider/game-stats runtime, replacing stale dormant or planned wording without changing behavior.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests as applicable.
- Status: **✅ COMPLETE — self-verified and independent Codex review clean.** Documentation/comment-only; no runtime behavior change.

### PLATFORM-086H3E3-FINAL-ATOMIC-WIRING-v1

- Purpose: Atomically activate the complete live game-stats path across admin reads and refresh, cron polling, analytics, diagnostics, and writer controls.
- Scope: Admin game-stats route, 15-minute cron, analytics consumers, evidence diagnostics, admin cache panel, activation invariants, scheduler configuration, and operations documentation.
- Outcome: The game-stats contract was activated end to end: admin refresh and cron share one ingestion path and interpreter, analytics consume paired provenance, diagnostics are evidence-based, and writer control is durably active.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #410 (`23baf4f`), 2026-07-26.

### PLATFORM-086H3E-EXTERNAL-SCHEDULER-MIGRATION-v1

- Purpose: Move the 15-minute game-stats poll off Vercel crons (Vercel Hobby rejects sub-daily cron expressions at deploy time, which blocked the E3 staged-production build) onto an external QStash schedule that calls the UNCHANGED.
- Scope: Primary touched areas: `GET /api/cron/game-stats`, `*/15`, `process.exitCode`, `/code-review`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Changes only `vercel.json` (removed the `/api/cron/game-stats` cron; kept the two daily lifecycle crons), `package.json` (`manage:game-stats-schedule` script), `src/lib/gameStats/__tests__/activation-invariants.test.ts` (flipped: the game-stats cron must be ABSENT), and adds `scripts/manage-game-stats-schedule.ts` + its test. The route (`src/app/api/cron/game-stats/route.ts`) and the E3 serving behavior are byte-unchanged.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #410 (`23baf4f`), 2026-07-26.

### PLATFORM-086H3E-EXTERNAL-SCHEDULER-PRE-ACTIVATION-REMEDIATION-v1

- Purpose: The bounded fix-forward remediation required before PLATFORM-086H3E activation, on `main` after PR #410.
- Scope: Primary touched areas: `scripts/manage-game-stats-schedule.ts`, `src/app/api/cron/game-stats/route.ts`, `vercel.json`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: **CLI (`scripts/manage-game-stats-schedule.ts`):** the upsert request now includes the exact raw HTTP header `Upstash-Redact-Fields: header[Authorization]` (NOT the SDK's `header: true`), so QStash stores/returns the forwarded route credential as `REDACTED:<opaque>` while still delivering the real `Bearer <CRON_SECRET>` to the route — keeping the plaintext secret out of QStash's readable state.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests as applicable.
- Status: Merged via PR #412 (`a161e33`), 2026-07-26.

### PLATFORM-086H3E4-SECOND-ROUND-CONFERENCE-COLLISION-REMEDIATION-v1

- Purpose: Correct the reproducible postseason identity collision that corrupted the 2024 TSC archive.
- Scope: Primary touched areas: `src/lib/teamIdentity.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: The three corrections: (1) `matchConferenceChampionshipSlotByText` matches aliases as complete normalized tokens/phrases.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #411 (`4e4535d`), 2026-07-25.

### PLATFORM-086H3E2-DORMANT-REFRESH-POLLING-PREREQUISITE-v1

- Purpose: Second prerequisite slice of the approved PLATFORM-086H3E activation decomposition.
- Scope: Primary touched areas: `vercel.json`, `publicProjection.ts`, `git diff --name-status main -- src/`, `refreshOutcome.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: `refreshOutcome.ts` — `interpretGameStatsRefreshOutcome` classifies a `GameStatsIngestionResult`.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #409 (`d04f3b3`), 2026-07-25.

### PLATFORM-086H3E1-PAIRED-ANALYTICS-PROVENANCE-v1

- Purpose: First prerequisite slice of the approved PLATFORM-086H3E activation decomposition.
- Scope: Canonical slate snapshot construction and parsing, season archives, backfill and preview integration, dormant-boundary allowance, focused tests, and documentation; no live consumer or writer activation.
- Outcome: New archives persist a minimal, strict `gameStatSlate` derived from the exact schedule build and paired only with that archive's own scores; malformed snapshots fail closed and no consumers were activated.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #408 (`a4dd9d5`), 2026-07-24.

### PLATFORM-086H3C5-DORMANT-NUMERIC-PARTICIPANT-VALIDATION-v1

- Purpose: Resolve the PLATFORM-086H3C1 numeric participant-validation deferral before PLATFORM-086H3E activation.
- Scope: Primary touched areas: `/api/schedule`, `ParticipantSlot.teamId`, `teamIdentity.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: (1) **Schedule persistence (additive, shared-mapper only):** `CfbdScheduleGame` recognizes `homeId`/`awayId` in camel and snake casings.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #407 (`a0cfff0`), 2026-07-24.

### PLATFORM-086-SCHEDULE-NON-FBS-POSTSEASON-CLASSIFICATION-SAFETY-IMPLEMENTATION-v1

- Purpose: Correct the schedule-normalization defect that assigns CFP event identities to explicitly non-FBS postseason games.
- Scope: Primary touched areas: `/verify`, `/api/schedule`, `src/lib/schedule/cfbdSchedule.ts`, `fbs/fbs`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: One production file — `src/lib/schedule/cfbdSchedule.ts`.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #406 (`a015348`), 2026-07-24.

### PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY-IMPLEMENTATION-v1

- Purpose: Prevent CFBD's bare `San Diego` label from resolving to San Diego State while preserving curated shorthand and safe production catalog behavior.
- Scope: Derived-alias generation, curated overrides, bundled catalog regeneration, durable-catalog read sanitation, standings and Insights cache identities, and focused identity tests.
- Outcome: (1) Both alias generators (`buildDerivedAlts` in `scripts/fetch-cfbd-teams.ts`; `buildDerivedTeamAliases` in `src/lib/teamDatabase.ts`) now emit the compact tokens-first join ONLY when the two tokens are the whole variant (`tokens.length === 2`); three-token compaction preserved.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #405 (`d5ee260`), 2026-07-24.

### PLATFORM-086H3C4-DORMANT-ANALYTICS-READINESS-CORRECTION-v1

- Purpose: Correct the dormant canonical analytics path so final-and-complete eligibility is INDEPENDENT of C1's six-hour missing-data/recovery threshold.
- Scope: Primary touched areas: `/verify`, `PartitionCoverage.games`, `src/lib/gameStats/publicProjection.ts`, `classifyScorePackStatus(input.scoresByKey[game.key]) === 'final'`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `projectAnalyticsPartition` (`src/lib/gameStats/publicProjection.ts`) now takes the required paired input `CanonicalAnalyticsReadInput = { slate, scoresByKey }` plus `(week, seasonType, committedRecord: WeeklyGameStats | null, seasonRelation)` — the old `(PartitionCoverage, scoresByKey)` signature is REMOVED with no overload or compatibility path.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #404 (`aa91391`), 2026-07-22.

### PLATFORM-086H3D-DORMANT-WRITER-CONTROL-ROLLOUT-SAFETY-v1

- Purpose: Complete the PLATFORM-086H3B writer-control fence into a full.
- Scope: Primary touched areas: `/verify`, `game-stats-writer-control/state`, `src/lib/gameStats/writerControlTransition.ts`, `scripts/transition-game-stats-writer-control.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: (1) `src/lib/gameStats/writerControlTransition.ts` — `transitionWriterControl({expected, to, apply})`, one atomic operation in one transaction rooted (advisory-locked) on the control key: presence-aware reread → strict parse → expected-state check → edge validation → conditional write of ONLY the exact `{recordVersion, state}` shape.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #403 (`ddc356e`), 2026-07-22.

### PLATFORM-086H3C3-DORMANT-ANALYTICS-FINALITY-GATE-v1

- Purpose: Make C1's dormant analytics projection require canonical FINAL-score evidence IN ADDITION to complete game-stat evidence, per the approved read-only audit — not a reader redesign, and not reopening the product decision.
- Scope: Primary touched areas: `/verify`, `AppGame.key`, `meta.cache=hit`, `src/lib/gameStats/publicProjection.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: `projectAnalyticsPartition(coverage, scoresByKey)` in `src/lib/gameStats/publicProjection.ts` gains a REQUIRED `scoresByKey` map keyed by the canonical `AppGame.key` (the attachment key).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #402 (`c41121b`), 2026-07-22.

### PLATFORM-086H3C2-DORMANT-SAFE-INGESTION-COORDINATION-v1

- Purpose: The smallest dormant adapter connecting ONE already-fetched CFBD `/games/teams` response to H1 parsing.
- Scope: `src/lib/gameStats/ingestionCoordinator.ts`, focused tests, and the dormant-boundary guard only; no provider, route, cron, status, or reader wiring.
- Outcome: Added a dormant ingestion coordinator that validates provider payloads, classifies empty, invalid, and non-persistable responses, forwards all parsed observations to H2, and returns its durable merge result unchanged.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #401 (`61fe69c`), 2026-07-22.

### PLATFORM-086H3C1-CANONICAL-EVIDENCE-READ-MODEL-v1

- Purpose: The dormant, schedule-authoritative canonical game-stats evidence **READ** model.
- Scope: Primary touched areas: `/verify`, `meta.cache=hit`, `src/lib/gameStats/`, `canonicalSlate.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: 4 dormant modules under `src/lib/gameStats/` — `canonicalSlate.ts` (schedule-authoritative expectation via `buildScheduleFromApi`; addressable-game slate; duplicate CFBD-id rejection by parsed numeric id), `evidenceAuthority.ts`.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #400 (`cf8c584`), 2026-07-22.

### PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE-v1

- Purpose: Replace the frozen PLATFORM-086H3B revision-status authority with the small reliability core the audits endorsed — a durable writer-control fence for the LIVE legacy game-stats writer, reusing prerequisite A.
- Scope: Primary touched areas: `/verify`, `.env.local`, `.env`, `src/lib/gameStats/writerFence.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: (1) `src/lib/gameStats/writerFence.ts` — durable writer-control record.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #399 (`69d3770`), 2026-07-21.

### PLATFORM-086H3B-VALUE-AND-SCOPE-AUDIT-v1 / PLATFORM-086H3B-SPLIT-EXTRACTION-PLAN-v1

- Status: **Read-only architectural audits (no code, no branch, no PR, no `/verify`).** Independent of, and corroborated by, a parallel Codex audit.
- Purpose: Determine whether the PLATFORM-086H3B revision-status authority branch (`platform/086h3b-revision-status-authority` @ `30705b9`) should be merged, simplified, split, or parked; then define the smallest replacement prerequisite from `main`.
- Result: Concluded B must NOT be merged. Game stats are reconstructible provider projections (no irreplaceable product data, no manual-edit path, self-healing weekly cron); no product feature reads revision/lineage/commit-stamp; none leaves the DB; and after a point-in-time restore nothing outside the same `app_state` table remembers a revision — so permanent lineage + revision-reuse prevention defend a scenario that cannot occur at this (hobby-scale, commissioner-operated) stage. Recommendation: freeze B as a read-only reference and land ONE small fenced-legacy-writer prerequisite (serialize + revalidate a durable control record), with lineage/revision/repair removed from C/D/E. Implemented as PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE-v1 (above); design in `docs/ai/game-stats-writer-fence.md`.

### PLATFORM-086H3A-APP-STATE-MULTI-KEY-TRANSACTION-v1

- Purpose: Add a generic, durable **multi-key** app-state transaction capability so a later prerequisite can atomically co-commit an evidence row with its revision-ledger row.
- Scope: Primary touched areas: `/verify`, `src/lib/server/appStateStore.ts`, `JSON.stringify([scope, key])`, `1817/1817`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: `src/lib/server/appStateStore.ts` — `AppStateKeyTxn` gains `readKey(scope,key)` / `writeKey(scope,key,value)` / `lockKey(scope,key)`, preserving the existing single-key `read`/`write` and every current caller.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #398 (`2793a6f`), 2026-07-19.

### PLATFORM-086H2-DURABLE-GAME-STATS-MERGE-SERVICE-v1

- Purpose: Provide the **dormant** durable merge authority PLATFORM-086H3 will activate atomically across validated ingestion → durable merge → cache completeness → schedule-relative recovery → analytics projection → truthful availability.
- Scope: `src/lib/gameStats/durableMerge.ts`, transactional app-state support, merge and transaction tests, and dormant-boundary protections; no production caller.
- Outcome: Added the dormant durable merge authority with provider-id identity, conservative category merging, per-game observation fencing, deterministic duplicate handling, transactional same-key serialization, and typed durability outcomes.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #397 (`c48e1ca`), 2026-07-18.

### PLATFORM-086H1-GAME-STATS-DATA-CONTRACT-IMPLEMENTATION-v1

- Purpose: Establish the game-stats data contract — strict parsing, typed classification, bounded legacy compatibility, canonical projection, duplicate selection.
- Scope: `src/lib/gameStats/contract.ts`, its pure and boundary tests, and the recursive dormant-boundary guard; no production writer or reader activation.
- Outcome: Added a dormant strict game-stats contract covering parsing, classification, bounded legacy compatibility, analytics projection, and deterministic duplicate selection while production behavior remained unchanged.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #396 (`0f8b562`), 2026-07-17.

### PLATFORM-086G2-ODDS-BOUNDARY-USAGE-TRUTHFULNESS-v1

- Purpose: Close deferred PLATFORM-086A findings #4 and #3 at the Odds boundary as one cohesive PR.
- Scope: Primary touched areas: `src/app/api/odds/route.ts`, `src/lib/odds/emptyOddsClassifier.ts`, `Promise.allSettled`, `src/lib/server/oddsUsageStore.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: **Odds payload boundary** (`src/app/api/odds/route.ts` + new pure `src/lib/odds/emptyOddsClassifier.ts`): a 200 response is no longer valid merely because it coerces to an empty array.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #395 (`0ee58b4`), 2026-07-16.

### PLATFORM-086G1-CFBD-SCORE-QUOTA-TRUTHFULNESS-v1

- Purpose: Close deferred PLATFORM-086A findings #6 and #7 at the CFBD boundary as one cohesive PR.
- Scope: Primary touched areas: `src/lib/scores/emptyScoresClassifier.ts`, `src/app/api/scores/route.ts`, `src/lib/api/cfbdUsage.ts`, `src/app/api/admin/usage/route.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: **Scores empty classification** (new pure `src/lib/scores/emptyScoresClassifier.ts`; wired in `src/app/api/scores/route.ts`): `refreshScorePartition` no longer maps every empty CFBD array to a no-op.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Merged via PR #394 (`987dd04`), 2026-07-14.

### DOCS-009-PLATFORM-086-PLANNING-RECONCILIATION-v1

- Purpose: Implement the approved post-PLATFORM-086A planning reset as a narrow documentation-only change.
- Scope: `docs/next-tasks.md`, `docs/roadmap.md`, `docs/prompt-registry.md`, `docs/completed-work.md`, `CLAUDE.md`, and the quota row in `docs/operations/deployment.md`; no runtime changes.
- Outcome: Reconciled provider-campaign planning after PLATFORM-086A, split deferred correctness work by provider family, established cohesive PR-sizing guidance, and corrected current quota and cadence documentation.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered lint, tests as applicable.
- Status: Complete — merged via PR #391; Git history retains the exact commit and date.

### PLATFORM-086A-REFRESH-OBSERVABILITY-v1

- Purpose: Build truthful durable provider-refresh observability, controls, cache-only diagnostics, and freshness reporting as the foundation for later automation.
- Scope: Provider refresh status, target scoping, automatic/manual refresh entry points, admin health presentation, durable status storage, tests, and operating documentation across schedule, scores, odds, rankings, and game stats.
- Outcome: **Status model** (`src/lib/server/providerRefreshStatus.ts`, scope `provider-refresh-status`, one key per dataset): `beginProviderRefreshAttempt` / `recordProviderRefreshSuccess` / `recordProviderRefreshFailure`.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Merged via PR #391, 2026-07-14.

### PLATFORM-085C-SCHEDULE-ROUTE-SCHEMA-DRIFT-SAFETY-v1

- Purpose: Close the narrow edge PLATFORM-085B intentionally left open.
- Scope: Primary touched areas: `/api/schedule`, `src/app/api/schedule/route.ts`, `upstream.length > 0`, `items.length === 0`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: `fetchSeasonType` now **throws** on (a) a non-array upstream payload and (b) a nonempty upstream (`upstream.length > 0`) that maps to zero rows (`items.length === 0`) — schema drift → uncertainty.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-085B-SEASON-TRANSITION-SCHEDULE-SAFETY-v1

- Purpose: Make season-transition schedule refreshes safe against partial provider results.
- Scope: Primary touched areas: `src/app/api/cron/season-transition/route.ts`, `/api/scores`, `/api/odds`, `AGENTS.md`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: `fetchCfbdSchedule` now returns `{ items, failedSeasonTypes }`, classifying each requested partition: a fetch that **throws**, returns a **non-array**, or normalizes a **nonempty** payload to **zero** rows (schema drift) is recorded as failed/uncertain; a successful fetch returning **zero** rows (e.g. postseason before bowls) is valid absence.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-085A-PROVIDER-CACHE-COMMIT-ORDER-v1

- Purpose: Make provider cache writes durable-first so process memory never publishes "fresh" provider data before durable storage succeeds.
- Scope: Primary touched areas: `oddsCache.entries`, `src/lib/server/rankings.ts`, `await setAppState(...)`, `/api/scores`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Audited every provider refresh write path that maintains a process-local cache alongside durable app-state and reordered each to persist durably BEFORE publishing to memory and BEFORE invalidating standings.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-084B-CANONICAL-SCORE-CACHE-RECONCILIATION-v1

- Purpose: Make canonical standings, rollover/archive, and public `/api/scores` use the SAME cache-only score reconciliation, so a week-specific score cache refresh.
- Scope: Primary touched areas: `/api/scores`, `src/lib/server/scoreCacheReader.ts`, `teamIdentity.ts`, `src/lib/__tests__/scoreCacheReader.test.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Extracted the public season-wide reconciliation (`aggregateSeasonScoresResponse`) into a shared cache-only reader `loadReconciledSeasonScores` (`src/lib/server/scoreCacheReader.ts`).
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-084A-CANONICAL-CACHE-FAILURE-SEMANTICS-v1

- Purpose: Stop the canonical standings selector from caching _uncertainty_ as valid output.
- Scope: Primary touched areas: `src/lib/preseasonOwnerStore.ts`, `try/catch → null`, `src/lib/selectors/leagueStandings.ts`, `.catch(() => [])`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Audited every app-state read in the `getCanonicalStandings` → `computeCanonicalStandings` → `resolve{Offseason,Season,Preseason}` → `liveDeriveStandings` path and classified each as absence-cacheable vs failure-must-reject.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-083-OWNERS-CSV-OPERATOR-GUARD-v1

- Purpose: Add an active-season owner-roster overwrite guard so a CSV import or inline roster-editor save cannot silently clobber a confirmed current-season roster.
- Scope: Primary touched areas: `PUT /api/owners`, `src/app/api/owners/route.ts`, `year >= league.year`, `parseOwnersCsv(existing).length > 0`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: `PUT /api/owners` (`src/app/api/owners/route.ts`) now guards league-scoped writes: for the league's active season (`year >= league.year`; past years are historical backfill), a write that would replace an already-populated roster (`parseOwnersCsv(existing).length > 0`) returns `409 { error: 'owner_roster_overwrite_requires_override', message }` unless `?override=1` is passed.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-082B-INSIGHTS-CACHE-ENTRYPOINTS-v1

- Purpose: Second/final split of `APPSTATESTORE-CACHING` — cache Insights output so it is not rebuilt on every page visit when inputs are unchanged, and review Insights entry-point cache behavior.
- Scope: Primary touched areas: `src/lib/insights/engine.ts`, `src/lib/insights/loadInsights.ts`, `React.cache`, `leagueStandings.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Split the engine (`src/lib/insights/engine.ts`) into `generateRawInsights` (pure, deterministic in `context`) and `applySuppression` (stateful — reads+writes the suppression store; output depends on run count); `runInsightsEngine` now composes them with identical behavior.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-082A-ARCHIVE-READ-CACHE-v1

- Purpose: First split of `APPSTATESTORE-CACHING` — add a safe cross-request cache to season archive reads to cut repeated Postgres reads (and egress) on the hot history/insights paths before the August draft.
- Scope: Primary touched areas: `src/lib/seasonArchive.ts`, `React.cache`, `incremental-cache/index.js:309`, `src/lib/__tests__/seasonArchive.test.ts`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Wrapped `getSeasonArchive(slug, year)` and `listSeasonArchives(slug)` (`src/lib/seasonArchive.ts`) in `React.cache` (per-request dedup) over `unstable_cache` (cross-request, tag-only, `revalidate: false`), mirroring the canonical-standings pattern. Cache keys are `['season-archive', slug, year]` and `['season-archive-years', slug]`; a per-year read carries tags `archive:${slug}` + `archive:${slug}:${year}`, the year list carries `archive:${slug}`.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### DOCS-008-FINAL-DOCS-CONSISTENCY-CLEANUP-v1 (PR #382)

- Purpose: Resolve the five small documentation-consistency findings from the broad post-closeout Codex review (after PRs #375–#381). Narrow docs-only cleanup; does not reopen the consolidation sequence.
- Scope: Primary touched areas: `AGENTS.md`, `/admin`, `roadmap.md`, `README.md`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: (1) **Prompt-ID hygiene** — relabeled every `**Prompt ID to assign:**` bullet in `docs/next-tasks.md` (7) and `docs/roadmap.md` (7) to `**Backlog slug (provisional):**`, and added a note in each doc that backlog slugs are provisional planning labels, not formal prompt IDs — the formal `PROMPT_ID` (`<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` per `AGENTS.md`) is assigned only at task activation (with `<###>` checked against this registry then).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered lint, tests, build as applicable.
- Status: Complete — merged via PR #382; Git history retains the exact commit and date.

### DOCS-007-ROOT-DOCS-ARCHIVE-HYGIENE-v1 (PR #381)

- Purpose: Narrow post-DOCS-006 hygiene pass — audit the three remaining legacy-looking `docs/` root files and either archive them or justify keeping them, so root `docs/` reads cleanly. Docs-only; not a new archive campaign.
- Scope: Primary touched areas: `CLAUDE.md`, `architecture/overview.md`, `README.md`, `AGENTS.md`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Audited all three. **Kept `docs/CFB_APP_ARCHITECTURE.md` in place** — it is genuinely `Status: Current (reference)` and actively cited by `CLAUDE.md` and `docs/architecture/overview.md` as a current quick-sketch companion, so archiving would mislabel it; it only _looked_ legacy because it was a bare ASCII diagram, so added a proper H1 + lifecycle metadata header (and a "reference, not authority; see `architecture/overview.md`" note) to de-legacy it.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests, build as applicable.
- Status: Complete — merged via PR #381; Git history retains the exact commit and date.

### DOCS-006-ARCHIVE-PATH-DECISION-v1 (PR #380)

- Purpose: Resolve the final deferred documentation-closeout item — the `archive/` path decision — so standalone historical audit/design/prompt artifacts are preserved without reading as current implementation authority.
- Scope: Primary touched areas: `archive/`, `Scope: docs/game-stats-audit.md`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Standardized `docs/archive/` for standalone historical artifacts, retained campaign retrospectives in place, moved ten files with history preserved, and added archive policy and indexing.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests, build as applicable.
- Status: Complete — merged via PR #380; Git history retains the exact commit and date.

### DOCS-005-LIFECYCLE-METADATA-ROLLOUT-v1 (PR #379)

- Purpose: Complete the deferred lifecycle-metadata rollout.
- Scope: Primary touched areas: `Status / Last verified (2026-07-09) / Owner / Canonical for / Supersedes`, `AGENTS.md`, `cfb-engineering-operating-instructions.md`, `CLAUDE.md`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Added standard lifecycle metadata to ten active governance and reference documents, leaving the archive-path decision as the sole documentation follow-up.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests, build as applicable.
- Status: Complete — merged via PR #379; Git history retains the exact commit and date.

### DOCS-004-DESIGN-CONTRADICTION-CLEANUP-v1 (PR #378)

- Purpose: Resolve the two known `DESIGN.md` self-contradictions deferred through DOCS-002A/C so the canonical UI/design doc is internally consistent — docs-only, no runtime UI change.
- Scope: Primary touched areas: `DESIGN.md`, `StandingsPanel.tsx`, `style={{ color: ownerColorFn(row.owner) }}`, `GameWeekPanel.tsx`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Verified current intended behavior from implementation (two read-only code sweeps) before editing.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests as applicable.
- Status: Complete — merged via PR #378; Git history retains the exact commit and date.

### DOCS-002C-ARCHITECTURE-OPERATIONS-DOCS-v1 (PR #377)

- Purpose: Create canonical current-architecture and operations documentation so runtime behavior and operator guidance no longer live only in governance files and the deployment runbook.
- Scope: Primary touched areas: `AGENTS.md`, `CFB_APP_ARCHITECTURE.md`, `deployment-runbook.md`, `overview.md`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Added six architecture docs under `docs/architecture/`.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests, build as applicable.
- Status: Complete — merged via PR #377; Git history retains the exact commit and date.

### DOCS-002B-PLANNING-HISTORY-CLEANUP-v1

- Purpose: Second DOCS-002 slice — planning/history docs cleanup so the current queue, roadmap, ledger, and completed-work stop competing.
- Scope: Primary touched areas: `prompt-registry.md`, `completed-work.md`, `AGENTS.md`, `DESIGN.md`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: `docs/next-tasks.md` — collapsed the completed "Audit-driven correctness + docs sequence".
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### DOCS-002A-GOVERNANCE-AND-DOCUMENTATION-INDEX-v1

- Purpose: First, narrowed slice of the DOCS-002 structural docs consolidation — establish a documentation index / source-of-truth map and tighten the root governance docs, without the larger planning/history/architecture restructure.
- Scope: Primary touched areas: `AGENTS.md`, `DESIGN.md`, `CLAUDE.md`, `README.md`, plus related tests and documentation. Git and PR history retain the complete file-level scope.
- Outcome: Docs-only.
- Review / verification: Independent Codex and Claude reviews were completed; accepted findings were adjudicated and remediated as recorded. Reported verification covered tests as applicable.
- Status: Complete — merged via PR #375; Git history retains the exact commit and date.

### DOCS-001B-GOVERNANCE-CORRECTNESS-DOCS-CLEANUP-v1

- Purpose: Governance-correctness docs cleanup + three-doc (`AGENTS.md`/`CLAUDE.md`/`DESIGN.md`) deconfliction, ahead of the PLATFORM-069+ audit sequence. Docs-only.
- Result: ✅ Done (PR #357). Removed stale hang/`TeamsDebugPanel` warnings; corrected the role model; documented the `gameOwnership.ts` current-season attribution invariant; established the docs-closeout timing rule; honest CSV wording; reconciled `next-tasks.md`; added the "Doc authority (source of truth)" headers to the three governance docs.
- Notes: Backfilled retroactively during DOCS-002B (the collapsed `next-tasks.md` Section 0 points here for per-item history). No runtime/test/config/script changes.

### DOCS-001A-DEPLOYMENT-RUNBOOK-SECRETS-PRIVACY-v1

- Purpose: Deployment-runbook secrets + privacy wording fix. Docs-only.
- Result: ✅ Done (PR #356). Corrected the `docs/deployment-runbook.md` secrets/privacy guidance.
- Notes: Backfilled retroactively during DOCS-002B (the collapsed `next-tasks.md` Section 0 points here for per-item history). No runtime/test/config/script changes.

### PLATFORM-081b-CLEANUP-DRYRUN-READONLY-v1

- Purpose: Tooling hotfix (no runtime alias change).
- Scope: Primary touched areas: `src/lib/server/appStateStore.ts`, `scripts/cleanup-legacy-league-aliases.ts`, `src/lib/server/__tests__/appStateStore.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Codex clean, no findings (first pass). Verification: `git diff --check`/`tsc`/`lint:all` clean; targeted tests 11/11 (9 legacy alias cleanup + 2 new appStateStore). Branch `platform/platform-081b-cleanup-dryrun-readonly`, PR #373.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — merged via PR #373; Git history retains the exact commit and date.

### DOCS-003-STANDINGS-PRESEASON-STATE-CONTRADICTION-VERIFICATION-v1

- Purpose: Resolve the tracked `STANDINGS-PRESEASON-STATE` table-vs-prose contradiction by verifying from source whether the preseason cold-cache blank-standings behavior shipped or a correctness gap remains.
- Scope: Docs only. `docs/next-tasks.md` — resolved the tracked contradiction item and corrected the stale INSIGHTS-017 backlog line (status table at line 39 was already correct).
- Outcome: **Docs-stale.** The fix shipped in the Season Launch Hardening campaign (Phase 2, commits `88af434` + `43516b0`) and is verified present + tested. `src/lib/selectors/leagueStandings.ts` defines the `CanonicalStandingsSource` value `'preseason-awaiting-kickoff'` + `inferredSeasonStart` field; the season/preseason empty paths call `getScheduleProbeState(year)` and return `preseasonAwaitingKickoffSnapshot(...)` (no `Date.now()` in the cached selector).
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-081-SEED-KEY-CLEANUP-LEGACY-LEAGUE-SCOPED-ALIASES-v1

- Purpose: Clean up redundant legacy `aliases:${slug}:${year}` seed-copy app-state keys left behind after the PLATFORM-067 alias migration made runtime resolution ignore league-scoped keys.
- Scope: Primary touched areas: `src/lib/server/legacyAliasCleanup.ts`, `scripts/cleanup-legacy-league-aliases.ts`, `src/lib/server/appStateStore.ts`, `src/lib/server/__tests__/legacyAliasCleanup.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Three Codex rounds. Round-1 two P2s: (1) `safeToDelete` trusted the sentinel → fixed to per-entry promotion check; (2) script accessed app-state before loading env → silent file fallback → fixed with dotenv + postgres storage gate. Round-2 one P1: promotion counted key-existence, so a repair over a demoted seed copy was a false positive → fixed to require the stored global VALUE to equal the repair's target. Round-3 clean.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-080-IN-SESSION-FINALIZED-GAME-RSC-REFRESH-v1

- Purpose: Fix the pre-existing in-session standings staleness surfaced in the PLATFORM-079a review.
- Scope: Primary touched areas: `src/components/hooks/useLiveRefresh.ts`, `src/components/CFBScheduleApp.tsx`, `router.refresh()`, `src/components/hooks/__tests__/useLiveRefresh.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: **Why `router.refresh()` suffices** — `getCanonicalStandings` is `unstable_cache`-wrapped (cached until `revalidateTag`), but the `/api/scores` write path already calls `invalidateStandingsForYear` when it writes a final, so the tag is busted and `router.refresh()`'s recompute picks up the new final.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-079b-ADMINDEBUGSURFACE-USELIVEREFRESH-DEAD-PLUMBING-CLEANUP-v1

- Purpose: Remove the PLATFORM-078-deferred `AdminDebugSurface` + `surface==='admin'` path and the now-dead state/handler/hook-prop chain it was the sole consumer of.
- Scope: Primary touched areas: `src/components/AdminDebugSurface.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/hooks/useLiveRefresh.ts`, `src/components/hooks/useScheduleBootstrap.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `AdminDebugSurface` was reachable only through `CFBScheduleApp`'s `surface==='admin'` branch, which no production route mounts (only a test did). `refreshLiveData` and the `manual` authorized-refresh machinery are RETAINED — `refreshLiveData` powers internal auto-refresh (useEffect), and `manual` still authorizes upstream scores/odds refresh (PLATFORM-075 semantics unchanged); it simply has no live caller now.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-079a-CFBSCHEDULEAPP-CANONICAL-STANDINGS-v1

- Purpose: Retire the client-side `deriveStandings` path in `CFBScheduleApp` (outside `src/lib/selectors/`) and source Members owner options/selection + owner colors + standings-fed surfaces from the canonical selector output.
- Scope: Primary touched areas: `src/components/CFBScheduleApp.tsx`, `src/components/__tests__/CFBScheduleApp.test.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Verified (via subagent map) canonical is guaranteed present at all 4 league routes (`getCanonicalStandings` never returns null/undefined; pages pass it unconditionally) and that every records-bearing surface already resolved `canonicalStandings?.rows ?? clientRows` → canonical won in production.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-078-DEAD-CODE-SWEEP-ALIASES-TEAMNAMES-ADMINDEBUGSURFACE-v1

- Purpose: Conservative P3 dead-code sweep — remove only code proven unreferenced/unreachable by static search; do not trust the candidate list blindly.
- Scope: Primary touched areas: `src/lib/aliases.ts`, `src/lib/teamNames.ts`, `./teamNormalization`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Removed the unreferenced aliases module and dead team-name helpers. AdminDebugSurface was retained after static and trial-removal evidence showed it was reachable and entangled with live refresh state, making its removal a separate architecture task.
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-077-INSIGHTS-CANONICAL-GAMES-IN-PROCESS-v1

- Purpose: Stop Insights from HTTP self-fetching its own app routes and privately rebuilding schedule/game state; consume the same canonical in-process game/lifecycle inputs production standings use.
- Scope: Primary touched areas: `src/lib/insights/loadInsights.ts`, `next/headers`, `/api/schedule`, `/api/teams`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The self-fetch was server-calling-its-own-routes-over-HTTP — bypassing the in-process pipeline and (subtly) omitting `manualOverrides`, so Insights' `games` could diverge from the standings the same function already consumes via `getCanonicalStandings`. Fix aligns Insights' game build exactly with `liveDeriveStandings` (identical inputs → identical `AppGame[]`).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-076-DEBUG-ROUTE-CANONICAL-PARITY-v1

- Purpose: Make `/api/debug/*` diagnostics trustworthy by resolving identity/schedule/attachment against the SAME canonical pipeline production uses, instead of a weaker parallel one.
- Scope: Primary touched areas: `src/app/api/debug/_lib/loadDebugSeasonContext.ts`, `/api/conferences`, `src/app/api/debug/scores/route.ts`, `src/app/api/debug/postseason-score-attachment/route.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Root cause was uniform — debug routes fetched `/api/aliases?year=` (the year-only stored editor view) rather than the effective resolver map, so every identity/eligibility verdict resolved against a strictly weaker alias set than production. Audited all 14 debug routes via four parallel read-only analyses; `debug/schedule`, `debug/scores-attachment`, `conference-diagnostics`, and both insights routes were already canonical.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-075-PROVIDER-QUOTA-HARDENING-PUBLIC-STALE-READS-v1

- Purpose: Protect the CFBD/Odds monthly quotas from public traffic by making the public `/api/odds` and `/api/scores` surfaces pure cache readers.
- Scope: Primary touched areas: `src/app/api/odds/route.ts`, `src/app/api/odds/routeInternals.ts`, `src/app/api/scores/route.ts`, `src/lib/server/appStateStore.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Product call resolved as interpretation A — public is a pure cache reader; all upstream fetches require an authorized `refresh=1` (platform admin / server cron / `ADMIN_API_TOKEN` via `requireAdminAuth`); the league-password gate grants no fetch authority; public freshness is best-effort and quota protection wins.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-074-DEBUG-ROUTES-PLATFORM-ADMIN-MIDDLEWARE-GATE-v1

- Purpose: Gate the `/debug/*` browser page family behind platform-admin authorization (the `/debug/teams` page had no server-side gate) and consolidate the platform-admin definition into one shared predicate.
- Scope: Primary touched areas: `src/lib/auth/platformAdmin.ts`, `publicMetadata.role`, `/admin`, `/debug`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `/api/debug/*` is intentionally NOT middleware-gated — all 12 routes already call `requireAdminAuth` at the route boundary (PLATFORM-020), which uniquely supports the `ADMIN_API_TOKEN` fallback middleware can't express. The four concerns stay distinct: Clerk auth, Clerk admin role, league password (`LEAGUE_AUTH_SECRET`), admin API token.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — merged via PR #364; Git history retains the exact commit and date.

### PLATFORM-073-POSTSEASON-ATTACHMENT-EDGE-CASES-v1

- Purpose: Fix three postseason edge cases in the canonical score/schedule attachment layer without introducing cross-phase mismatches or missing provider-id matches.
- Scope: Primary touched areas: `src/lib/scoreAttachment.ts`, `match.orientation`, `src/lib/schedule.ts`, `lib/__tests__/postseasonAttachmentEdges.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Odds attachment uses a separate pair-keyed index (`gameAttachment.ts`, no provider-id path), so defect 1 is scoped to the score path.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — merged via PR #363; Git history retains the exact commit and date.

### PLATFORM-072-POST-CONFIRM-DRAFT-EDIT-OWNERSHIP-DRIFT-v1

- Purpose: Fix ownership drift when a draft pick is edited after confirmation.
- Scope: Primary touched areas: `src/lib/draft.ts`, `src/app/api/draft/[slug]/[year]/confirm/route.ts`, `src/app/api/draft/[slug]/[year]/pick/[n]/route.ts`, `lib/__tests__/draft.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Only `phase === 'complete'` resyncs; pre-confirm phases (incl. a draft reopened via confirm `DELETE`, which intentionally holds the last confirmed CSV until re-confirm) are unchanged. The patch MOVES the pick's claim (old-team→new-team) rather than rebuilding from picks, so it preserves unrelated `/api/owners` admin repairs.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — merged via PR #362; Git history retains the exact commit and date.

### PLATFORM-071-CRON-PRESEASON-STANDINGS-INVALIDATION-SWEEP-v1

- Purpose: Close the remaining documented `invalidateStandings` gaps for season-lifecycle and preseason ownership flows — mutations that change a league's standings surface but left the cached canonical snapshot stale (hard-refresh workaround).
- Scope: Primary touched areas: `src/app/admin/[slug]/actions.ts`, `src/app/api/cron/season-rollover/route.ts`, `src/app/api/cron/season-transition/route.ts`, `src/lib/selectors/leagueStandings.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: All four flows are league-scoped → per-league `invalidateStandings` (umbrella tag covers all cached years); no global tag, no registry enumeration. Failure/unauthorized/no-op/skip paths do not invalidate. Deliberately not wired (recorded in the docstring): `completeSetup` (setupComplete flag; no standings-content change) and the `slug='test'` dev-tooling actions.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — merged via PR #361; Git history retains the exact commit and date.

### PLATFORM-070-TEAM-DB-WRITES-STANDINGS-INVALIDATION-v1

- Purpose: Close the team-database write → canonical standings invalidation gap.
- Scope: Primary touched areas: `src/lib/selectors/leagueStandings.ts`, `src/app/api/admin/team-database/route.ts`, `src/app/api/aliases/route.ts`, `src/lib/server/teamDatabaseStore.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Year/league-scoped mutations still use `invalidateStandings(slug, year)` unchanged. Design converged across three Codex rounds — P2 (registry-read ordering) → P1 (cross-instance catalog staleness defeated tag invalidation) → P2 (pre-write snapshot registry race) — landing on a single shared tag (race-free, no post-commit `getLeagues()` to fail) plus per-request catalog reads.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — merged via PR #360; Git history retains the exact commit and date.

### PLATFORM-069-DRAFT-WIN-TOTALS-CANONICAL-ALIAS-SOURCE-v1

- Purpose: Fix the remaining draft/win-totals alias-source bypass after PLATFORM-067 — resolve team names through the shared canonical scoped alias source instead of a locally built year+seed map that ignored stored global aliases.
- Scope: Primary touched areas: `src/app/api/draft/[slug]/[year]/pick/route.ts`, `pick/[n]/route.ts`, `src/app/api/admin/win-totals/route.ts`, `{ ...SEED_ALIASES, ...aliases:${year} }`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `confirm/route.ts` inspected — writes already-canonical eligible team names, resolves no raw labels, so unchanged. No league-scoped runtime aliases reintroduced; no unrelated runtime behavior changed. Post-confirm draft-edit ownership drift remains **PLATFORM-072** (out of scope). Verification: new suites 12/12; related draft/teamIdentity/alias/odds suites 162/162; `git diff --check`, `tsc --noEmit`, `lint:all` clean.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests as applicable.
- Status: Complete — merged via PR #359; Git history retains the exact commit and date.

### PLATFORM-067-REMOVE-LEAGUE-ALIAS-LAYER-v1

- Purpose: Remove league-scoped aliases from canonical alias resolution — team aliases are not league-specific (settled product decision). Final runtime precedence: **stored global → year → SEED_ALIASES**.
- Scope: Primary touched areas: `src/lib/server/globalAliasStore.ts`, `draftSchedule.ts`, `board/boardData.ts`, `bootstrap.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: `getScopedAliasMap(_leagueSlug, year)` keeps the slug arg for API/call-site compatibility but it no longer affects resolution. **PLATFORM-066 production data check** found NO unique league-scoped repairs — all prod `aliases:${slug}:${year}` entries (`test:2025`, `test:2026`, `tsc:2025`) were copied current-seed defaults already represented in `aliases:global` + `SEED_ALIASES`, so **no migration was required** (prod migration sentinel already set).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — merged via PR #355; Git history retains the exact commit and date.

### PLATFORM-066-LEAGUE-ALIAS-DATA-CHECK-v1

- Purpose: Read-only production data check gating PLATFORM-067 — confirm whether any stored `aliases:${slug}:${year}` keys exist and whether they are already represented in `aliases:global`. No code or app-state changes.
- Scope: read-only `SELECT` against production `app_state` (Neon); no writes, no promotion, no deletes, no app routes called.
- Notes: Migration sentinel `aliases:global::migration-done` is SET in prod. Only 3 league scopes exist — `aliases:test:2025`, `aliases:test:2026`, `aliases:tsc:2025` (test/dev leagues) — and every entry is a copied current-`SEED_ALIASES` default already present in `aliases:global` (62 entries) with identical targets. Zero entries need promotion; zero conflicts; no real production league has a unique league-scoped repair. **Classification: safe to remove the league layer with no data migration** → executed as PLATFORM-067.

### PLATFORM-065-CLEANUP-ORPHANED-STAGING-UTILS-v1

- Purpose: Dead-code cleanup of the alias-**staging** helpers left orphaned after PLATFORM-064 removed the hidden league-scoped alias editor and its write path. No behavior change.
- Scope: Primary touched areas: `src/lib/aliasStaging.ts`, `src/lib/adminDiagnostics.ts`, `CFBScheduleApp.test.tsx`, `IssuesPanel.test.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Reachability confirmed all three helpers had **zero reachable production callers** post-064 (`aliasStaging.ts` no importers; `hasStagedAliasChanges` no refs; `getAdminAlertCount` test-only). Kept `splitIssueDiagnostics` — still live in `IssuesPanel.tsx`.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — merged via PR #354; Git history retains the exact commit and date.

### PLATFORM-064-REMOVE-HIDDEN-LEAGUE-ALIAS-EDITOR-v1

- Purpose: Remove the unreachable in-app league-scoped alias editor + its write path (surfaced by the PLATFORM-061 audit; safe now per PLATFORM-062/063 follow-ups). No reachable behavior change.
- Scope: Primary touched areas: `CFBScheduleApp.tsx`, `AdminDebugSurface.tsx`, `IssuesPanel.tsx`, `aliasesApi.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: The league editor rendered only under `CFBScheduleApp surface==='admin'`, which no route mounts (only a test), so its `PUT /api/aliases?league=` write path had no reachable caller. The league RESOLUTION layer in `getScopedAliasMap` is untouched (separate data-gated follow-up); it stays the ONLY client path to league-scoped repairs (via `GET ?scope=effective`). Client identity now flows solely through the effective resolver map.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — merged via PR #353; Git history retains the exact commit and date.

### PLATFORM-063-REMOVE-DEAD-TRENDS-PAGEDATA-v1

- Purpose: Delete the dead `trendsPageData` module + its test (dead-code cleanup surfaced by PLATFORM-062). No live behavior change.
- Scope: deleted `src/lib/trendsPageData.ts` and `src/lib/__tests__/trendsPageData.test.ts`.
- Notes: `trendsPageData.ts` (`loadCanonicalTrendsPageData` / `TrendsPageData`) was imported only by its own test — no production importers, no barrel re-exports. The live trends page (`src/app/league/[slug]/trends/page.tsx`) redirects to `standings?view=trends`, which renders through the canonical standings/client-bootstrap path; that redirect is untouched. Post-delete: zero dangling references, tsc/lint:all/build green, focused standings/aliases/odds/selectors/globalAliasStore suites (115 tests) green. Codex review clean ("deleted module was referenced only by its deleted test; the live trends route uses the canonical standings flow"). Full `npm test` not run (documented Overview hang).
- Follow-ups (remaining from the PLATFORM-061 audit): (1) hidden league alias editor removal (safe now — unreachable UI); (2) data-gated league alias layer removal (needs prod data check + product decision).

### PLATFORM-062-CANONICAL-ALIAS-ODDS-TRENDS-v1

- Purpose: Align the remaining odds/trends alias consumers with canonical effective resolution. Focused correctness PR — does NOT remove league-scoped aliases or the hidden editor.
- Scope: `src/app/api/odds/route.ts` (+ `route.test.ts`). Trends was found to be **dead code** (see below) — not modified.
- Outcome: `odds/route.ts` `readAliasesForSeason` read only `aliases:${season}` (year scope) + hand-merged `SEED_ALIASES`, **missing stored global aliases**, so odds identity could diverge from canonical schedule/standings. Odds requests carry **no league context** (`/api/odds` query is season+markets; client fetches `?year=` only), so odds now resolves via `getScopedAliasMap('', season)` → stored global > year > SEED_ALIASES (league+year layer N/A).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-060-CANONICAL-ALIAS-REMAINING-CONSUMERS-v1

- Purpose: Fix the two remaining raw alias-consumer divergences found after the alias-model sequence (055→057→059→058). Focused correctness PR — does NOT remove league-scoped aliases.
- Scope: `src/app/league/[slug]/draft/page.tsx`, new `src/app/league/[slug]/draft/draftSchedule.ts` (+ test), `src/app/api/debug/{archive-audit,archive-integrity,game-stats-diagnostic}/route.ts`.
- Outcome: `draft/page.tsx` had hand-merged `{ ...SEED_ALIASES, ...aliases:${year}, ...aliases:${slug}:${year} }` for both current- and prior-year schedules — it **missed stored `aliases:global`** and used **inverted precedence** (league > year, no stored-global tier), so draft-board identity could mis/unresolve a global- or seed-resolved team vs canonical/live.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP-v1

- Purpose: Final alias-model item — make the client resolve schedule/liveDelta identity via the effective scoped alias map.
- Scope: Primary touched areas: `src/app/api/aliases/route.ts`, `src/lib/aliasesApi.ts`, `src/lib/bootstrap.ts`, `src/components/hooks/useScheduleBootstrap.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: **Stored vs effective are deliberately distinct.** `GET /api/aliases?scope=effective` is the read-only resolver view (`getScopedAliasMap`); the default `?league=` GET stays the editable STORED view, so the in-app alias editor never round-trips global/seed defaults into a scope.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-059-CANONICAL-ALIAS-SERVER-CONSUMERS-v1

- Purpose: Align the last server-side alias consumer with the effective scoped alias map after PLATFORM-055/057, so rollover/backfill archives can't diverge from live canonical.
- Scope: `src/lib/seasonRollover.ts` (`buildSeasonArchive`). Tests: new `src/lib/__tests__/seasonRollover-aliases.test.ts`.
- Notes: **`buildSeasonArchive` now consumes `getScopedAliasMap(slug, year)`** (stored global > league+year > year > `SEED_ALIASES`) instead of loading only `aliases:${slug}:${year}` for game identity — the same effective resolution live canonical standings use, feeding both `buildScheduleFromApi` and the score-attachment resolver. Removed the private league-only alias load; archive persistence format and display labels unchanged. `loadInsightsForLeague`'s games builder was already migrated in PLATFORM-057 — verified, not changed. Tests prove the archive resolves games via global-only / year-only / `SEED_ALIASES` fallbacks, a league+year repair beating the seed, and archive standings agreeing with live canonical for the same fixture. Codex review clean (no findings). Focused suites 186 pass / 0 fail; tsc/lint:all/build green. Full `npm test` not run (documented Overview hang).
- Follow-up (final alias-model item): **PLATFORM-058-CLIENT-EFFECTIVE-ALIAS-BOOTSTRAP** — now fully unblocked; change the client GET/bootstrap to consume the effective map.

### PLATFORM-057-SEED-ALIASES-TO-GLOBAL-v1

- Purpose: Make the static `SEED_ALIASES` bundle globally available to all server alias consumers so PLATFORM-058 can safely change client alias bootstrap. Prerequisite for 058.
- Scope: Primary touched areas: `src/lib/server/globalAliasStore.ts`, `src/lib/selectors/leagueStandings.ts`, `src/app/api/aliases/route.ts`, `src/app/api/owners/route.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: **Approach (user-approved): seeds are merged IN-MEMORY, not persisted.** After weighing a persist+versioned-sentinel design, chose to expose `SEED_ALIASES` as a code-defined lowest-precedence layer, which dissolved the write/invalidation/versioning problems at the root. Final model: - Effective precedence **stored global > league+year > year > SEED_ALIASES** (seeds are defaults; any persisted manual repair beats them).
- Review / verification: Review and verification were completed as recorded in Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-055-CODEX-FINDINGS-REMEDIATION-2-v1

- Purpose: Address Codex re-review of PLATFORM-055 — align every active alias consumer with canonical's effective (global-first) alias semantics.
- Scope: `src/lib/insights/context.ts` (P2, shipped); P1 flagged as a scope boundary (not shipped). Tests: new `src/lib/__tests__/insights-context-aliases.test.ts`.
- Outcome: **P2 shipped** — `insights/context.ts` `loadOwnerSeasonStats` now resolves via `getScopedAliasMap` instead of the private `[league, year, global]` accumulator-wins merge (which was league-first and lacked the normalized dedup). Same resolver wiring as canonical; removed dead `loadAliasMap` + now-unused `getAppState`/`AliasMap` imports.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-055-CODEX-FINDINGS-REMEDIATION-v1

- Purpose: Fix the two Codex review findings on PLATFORM-055 before merge (in-scope corrections, not follow-ups).
- Scope: Primary touched areas: `src/lib/server/globalAliasStore.ts`, `src/app/api/aliases/route.ts`, `globalAliasStore.test.ts`, `aliases/route.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Normalized alias precedence by resolver identity and added standings invalidation for year-only alias writes and actual global-alias migrations.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-055-CANONICAL-GLOBAL-ALIAS-MERGE-v1

- Purpose: Make canonical standings consume the effective (scoped) alias map instead of the league-only scope, and invalidate affected canonical standings caches when global aliases change.
- Scope: Primary touched areas: `src/lib/selectors/leagueStandings.ts`, `src/app/api/aliases/route.ts`, `src/lib/server/__tests__/globalAliasStore.test.ts`, `src/app/api/aliases/__tests__/route.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Precedence preserved (global > league+year > year) via the existing `getScopedAliasMap`; no new merge helper, all matching still through `teamIdentity.ts`. Global alias writes invalidate the per-league umbrella tag only (no year), since a global alias can affect any cached year.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-053-INSIGHTS-CANONICAL-STANDINGS-INPUTS-v1

- Purpose: Make `loadInsightsForLeague` consume canonical standings rows/history from `getCanonicalStandings` instead of independently re-deriving standings.
- Scope: `src/lib/insights/loadInsights.ts` (standings rows/history from canonical; removed the local derivation + the score fetch that only fed it). Tests: new `loadInsights.test.ts`.
- Outcome: Standings rows/history now come from `getCanonicalStandings({ slug, year, currentDate })` (`canonical.rows` → currentStandings; `canonical.standingsHistory` → weeklyStandings + `selectSeasonContext`); authoritative even when empty/null, no local fallback. `games`/roster/rankings/lifecycle/suppression preserved.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-051-OVERVIEW-LIVEDELTA-OVERLAY-v1

- Purpose: Add the Standings/Members-compatible pending W–L `liveDelta` badge to Overview Top-N standings rows (Overview previously received `liveDelta` but `void`ed it). Preceded by the read-only **PLATFORM-050-OVERVIEW-LIVEDELTA-OVERLAY-AUDIT-v1**.
- Scope: `src/components/OverviewPanel.tsx` (consume `liveDelta`; thread into `CondensedStandingsTable`; badge beside record). Tests: `OverviewPanel.test.tsx`.
- Notes: Presentation-only badge on Top-N rows via the shared `selectFreshOwnerPendingDelta` — visible `+1–0`, title/aria `Live this week: 1–0`, `data-overview-live-pending`; gated by the rendered `row.owner`. Never mutates/projects rank/record/win%/differential and never re-sorts; canonical rows/history/coverage resolution (PLATFORM-047/048) untouched. Stale/missing/tied/NoClaim/absent deltas render nothing. The existing `{n} live` pill (a distinct signal) is unchanged; podium/hero cards get no badge this phase; no `router.refresh`. Codex review: clean, no findings. Deferred: **PLATFORM-052** (podium/hero live badge, candidate), `liveCountByOwner` staleness alignment (candidate), **PLATFORM-045** route-loader dedup. `npm test` 1069 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-049-STANDINGS-COVERAGE-CANONICAL-CONTRACT-v1

- Purpose: Make Standings rows, history, and coverage come from the same canonical snapshot whenever one is supplied.
- Scope: Primary touched areas: `src/lib/selectors/standingsCanonicalInputs.ts`, `src/components/StandingsPanel.tsx`, `standingsCanonicalInputs.test.ts`, `StandingsPanel.test.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Standings coverage now canonical-preferred; local coverage only when NO canonical snapshot is supplied; missing/null canonical coverage → conservative `{ state: 'error', message: 'Standings coverage is unavailable.' }` (never local; `CanonicalStandings.coverage` stays required — defensive runtime handling).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-046-MEMBER-HEADER-LIVE-OVERLAY-v1

- Purpose: Add a Standings-compatible `liveDelta` pending W–L badge to the Members owner header without changing the canonical header baseline (the follow-up deferred from PLATFORM-044).
- Scope: `src/lib/selectors/liveDelta.ts` (new pure `selectFreshOwnerPendingDelta`), `src/components/StandingsPanel.tsx` (use the helper — behavior-neutral), `src/components/OwnerPanel.tsx` (optional `liveDelta` prop + badge beside Record), `src/components/CFBScheduleApp.tsx` (pass `liveDelta`). Tests: `selectors-liveDelta`, `OwnerPanel`, `StandingsPanel`, `CFBScheduleApp`.
- Notes: `selectFreshOwnerPendingDelta(liveDelta, owner)` centralizes stale suppression, owner lookup, NoClaim exclusion, and the nonzero-decision check (returns the fresh pending delta or null); Standings now uses it (markup/copy unchanged) and Members reuses it. The Members badge renders beside the header Record (`+1–0`, title `Live this week: 1–0`), gated by `snapshot.header?.owner` — a null header is never resurrected by liveDelta; canonical rank/record/win%/differential are untouched; no projected standings; no `router.refresh`. Fresh nonzero → badge; stale/missing/zero-decision → none; NoClaim never annotated. Codex review: clean, no findings. Deferred follow-ups: **PLATFORM-045** (route-loader dedup), and candidates — Overview liveDelta overlay, Standings-surface canonical coverage. `npm test` 1050 pass / 0 fail / 0 skipped; tsc/lint:all/build green.

### PLATFORM-048-OVERVIEW-COVERAGE-CANONICAL-CONTRACT-v1

- Purpose: Make Overview coverage canonical-preferred whenever a canonical standings snapshot is supplied (closing the remaining gap PLATFORM-047 characterized: rows/history were canonical but coverage stayed local).
- Scope: Primary touched areas: `src/lib/selectors/overview.ts`, `src/components/OverviewPanel.tsx`, `src/components/CFBScheduleApp.tsx`, `overview-canonical-contract.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Overview coverage now comes from canonical when a snapshot is supplied; client-derived coverage is used only when NO snapshot is supplied. A supplied snapshot with missing/null coverage returns the conservative `{ state: 'error', message: 'Standings coverage is unavailable.' }` (never local) — `CanonicalStandings.coverage` stays required at the type level (defensive runtime handling only).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-047-OVERVIEW-CANONICAL-CONTRACT-CHARACTERIZATION-v1

- Purpose: Test-first characterization of the Overview canonical-vs-local source boundary before any behavioral migration. No behavior change.
- Scope: Primary touched areas: `src/lib/selectors/overview.ts`, `src/components/OverviewPanel.tsx`, `overview-canonical-contract.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Pinned Overview contract — **rows**: canonical when a snapshot is supplied.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-044-CANONICAL-MEMBER-RECORDS-v1

- Purpose: Make the Members view owner header (rank/record/win%/point differential) use canonical standings rows instead of locally derived standings, so Members agrees with the Standings surface.
- Scope: `src/lib/ownerView.ts` (`deriveOwnerViewSnapshot` takes optional `canonicalStandingsRows`; header sourced from it), `src/components/CFBScheduleApp.tsx` (pass `canonicalStandings?.rows`). Tests: `ownerView.test.ts`.
- Outcome: Members owner header now prefers canonical standings. **Canonical is authoritative when supplied** (per review decision): when a canonical snapshot is passed — even empty or omitting the owner — the header is the canonical row or `null`, never the local row, so Members never resurrects an owner/standings canonical excludes. Local rows are used for the header only when NO canonical snapshot is supplied (`undefined`, e.g. Trends/History routes).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-043-SCHEDULE-ROUTE-CANONICAL-INPUTS-v1

- Purpose: Make `/league/[slug]/schedule` provide the same canonical standings, league status, and archive context as the root league route, so entering directly through Schedule is a route-specific entry into the same canonical app state.
- Scope: `src/app/league/[slug]/schedule/page.tsx` (load `getCanonicalStandings` + `listSeasonArchives` + derive `leagueStatus`/`mostRecentArchivedYear`, mirroring the root route). Test: new `src/app/league/[slug]/schedule/__tests__/page.test.tsx`.
- Outcome: `/league/[slug]/schedule` now receives the same canonical standings/status/archive inputs as the root league route. Component fallbacks remain intentionally in place (empty/unavailable leagues still receive a canonical snapshot the fallback branches handle).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-042-LEAGUE-SEASON-RESOLUTION-v1

- Purpose: Make `CFBScheduleApp` schedule/scores/aliases/rankings/insights/storage use the league-resolved season instead of falling back to global `DEFAULT_SEASON` for active-season and offseason leagues.
- Scope: new pure `src/lib/leagueSeason.ts` (`resolveLeagueSeason`); `src/components/CFBScheduleApp.tsx` (seed `selectedSeason` via the resolver; collapse the duplicate `draftLookupYear`). Tests: new `leagueSeason.test.ts` + a `CFBScheduleApp` active-season regression.
- Outcome: Client schedule/scores/aliases/rankings/insights/storage now use the league-resolved season. `resolveLeagueSeason` precedence: `leagueStatus.year` (preseason/season) → `leagueYear` → `defaultSeason`; active-season and offseason leagues no longer silently use `DEFAULT_SEASON` when league-specific year info exists.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-039-CANONICAL-GAME-OWNERSHIP-LOOKUP-v1

- Purpose: Make current-season ownership resolution use centralized, resolver-free game-identity candidates instead of raw provider-name equality.
- Scope: Primary touched areas: `src/lib/gameOwnership.ts`, `gameTags.ts`, `standings.ts`, `selectors/liveDelta.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Current-season ownership lookup now uses centralized resolver-free game ownership candidates (participant teamId → canonical/display/raw → `canHome/away` → `csvHome/away` legacy fallback; exact-match). This does **not** preserve or expand CSV-upload architecture. Provider-facing display labels (`csvHome/csvAway`) preserved. Codex P2 addressed: `OverviewPanel.liveCountByOwner` also routed through the shared helper.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-036-FBS-FCS-MATCHUP-SELECTOR-CLASSIFICATION-v1

- Purpose: Classify FCS opponents through canonical conference-subdivision policy instead of local conference-name regexes.
- Scope: Primary touched areas: `src/lib/conferenceSubdivision.ts`, `src/lib/matchups.ts`, `src/lib/selectors/matchups.ts`, `src/lib/selectors/gameWeek.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Matchup selector/display FCS classification now uses shared conference subdivision policy (`isPolicyFcsConference`, backed by `resolvePresentDayConferencePolicy`) instead of local regexes; the helper is pure and does not consult the mutable CFBD conference index.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-035-DRAFT-BOARD-CANONICAL-ALIAS-LOADING-v1

- Purpose: Load draft-board aliases from server-safe scoped storage so server-rendered schedule insights populate.
- Scope: Primary touched areas: `src/lib/server/globalAliasStore.ts`, `src/app/league/[slug]/draft/board/boardData.ts`, `src/app/league/[slug]/draft/board/page.tsx`, `aliases.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Spectator draft board alias loading now uses server-safe appState sources. `getScopedAliasMap` walks `aliases:global` + deprecated `aliases:{slug}:{year}` / `aliases:{year}` scopes with precedence **global > league+year > year** (global is the canonical store; legacy scopes are deprecated and migration preserves global entries — matches the owners upload merge).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1

- Purpose: Make production odds attachment event-centric and date-aware so upstream odds events attach to the correct canonical schedule game via team identity + commence time, with no same-pair fan-out and no arbitrary duplicate first-win.
- Scope: Primary touched areas: `src/lib/oddsAttachment.ts`, `src/lib/gameAttachment.ts`, `ScheduleAttachmentGame.date`, `src/app/api/odds/routeInternals.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Commit `(this PR)`. Algorithm: iterate events → resolve pair via `teamIdentity` `buildPairKey` → candidate canonical games from `buildSchedulePairIndex` → if `commenceTime` present and any candidate dated, narrow to ±24h window → attach only when exactly one candidate remains; skip on zero/multiple. One-to-one safety via a consumed-game set (a claimed game is never overwritten).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-030-ATTACHMENT-REGRESSION-TESTS-v1

- Purpose: Add regression coverage for schedule-based score/odds attachment and schedule eligibility BEFORE changing odds matching behavior (PLATFORM-031-EVENT-DATE-AWARE-ATTACHMENT-v1).
- Scope: Test-only. `src/lib/__tests__/{oddsAttachment,scoreAttachment,schedule-eligibility}.test.ts`. No production changes; no testability exports needed.
- Outcome: Commit `(this PR)`. Odds: passing tests document current schedule-canonical safety (unmatched events create no entries; only canonical games attach) AND current UNSAFE pair-only behavior (one event fans out to both same-pair games; duplicate provider events first-win).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-020-ADMIN-DEBUG-API-GATES-v1

- Purpose: Require admin authorization on `/api/admin/*` and `/api/debug/*` GET routes that expose diagnostics / storage / API-usage state or can trigger quota-bearing internal fetches.
- Scope: Primary touched areas: `admin/{usage,storage,odds-usage}`, `admin/win-totals`, `lib/apiUsage.ts`, `lib/scoreAttachmentDebug.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Commit `(this PR)`. `admin/usage` makes a live CFBD call (`fetchCfbdUsage`) — the primary quota-exposure fix.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### DRAFT-010-CONFIRM-ELIGIBILITY-v1

- Purpose: Fix draft confirmation so it uses the same eligible-team definition as draft setup and works with the current `src/data/teams.json` shape.
- Scope: Primary touched areas: `src/lib/draft.ts`, `src/app/api/draft/[slug]/[year]/{confirm,route,pick/route,pick/[n]/route}.ts`, `src/lib/__tests__/draft.test.ts`, `src/app/api/draft/[slug]/[year]/__tests__/confirm-eligibility.test.ts`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Commit `(this PR)`. Added one source of truth in `draft.ts` — `getDraftEligibleTeams`/`isDraftEligibleTeam`/`NON_DRAFTABLE_SCHOOLS` defining eligibility as "exclude the `NoClaim` placeholder" (not a `classification` field).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, lint, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

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
- Outcome: Commit `(this PR)`.
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered TypeScript, tests, build as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

### PLATFORM-001-TEST-BASELINE-CLEANUP-v1

- Purpose: Clean up the stale Node test baseline surfaced once `npm test` could terminate.
- Scope: Primary touched areas: `OverviewPanel.test.tsx`, `TrendsDetailSurface.test.tsx`, `MatchupsWeekPanel.test.tsx`, `MatchupMatrixView.test.tsx`, plus focused tests and owning documentation; Git and PR history retain the complete scope.
- Outcome: Commit `711a032`. The two cancellations were emergent: ~26 (OverviewPanel) / ~13 (TrendsDetailSurface) stale `assert.match` failures each carried the full ~14KB rendered HTML, and the accumulation choked the runner into a file-level timeout (TrendsDetailSurface's `selected focus mode` case also hit an async-teardown spin).
- Review / verification: Review and verification details remain in the linked Git and PR history. Reported verification covered tests as applicable.
- Status: Complete — historical execution record; Git history retains the exact commit and merge metadata.

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
- Outcome: [shipped, stopped, or superseded behavior]
- Review / verification: [concise evidence and review state]
- Status: [implementation/merge state only]
