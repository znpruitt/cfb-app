PROMPT_ID: PLATFORM-139-RECORD-RECONCILIATION-v3
PURPOSE: Item 139 — a final must carry the record INCLUDING the result being read. v3 is a reconstruction. It opens with a DESIGN PASS, because two implementations have now failed on WHERE the derivation is computed, not on whether it is correct.
SCOPE: decided by the design pass, then confirmed by the owner. The reconciliation seam and its tests. NOT `CompactGameScoreboard.tsx`. No provider call, no cache-invalidation trigger, no client-side counting.

Read `AGENTS.md` first. Nothing in it is restated. Three of its rules bind unusually hard here:
**reconstruction over accumulation** (which is why you exist), **carry findings forward across the
whole stopped history**, and **reachability before design** — the rule that withdrew v1's withholding
policy after someone finally measured the population.

---

## STOP — THIS PROMPT HAS TWO STOPS

1. A **read receipt**, before anything.
2. A **design pass**, before any implementation.

Both end with you waiting for the owner. The second is the point of v3. Do not skip to code because
the design looks obvious — it looked obvious twice.

---

## Why v2 was abandoned — read this before you form any opinion

**v2 (`132a0daf`, branch `platform-139-record-reconciliation-v2`) is abandoned. Do NOT cherry-pick,
rebase, or copy from it. Do NOT copy from v1 (`716bb6d1`) either.** Both are reference only.
`AGENTS.md`: reconstruct by re-deriving, because the stopped history carries the defects that stopped
it.

**v1 died on the boundary.** It computed the reconciliation in the browser, so it had to ship the
schedule there: **~263 KB → ~738 KB across five dynamic routes**. Wrong side of the wire.

**v2 fixed that completely and then died on the COST.** It moved the derivation to the server, held
the payload at **262,550 → 262,550 bytes — exactly flat**, and passed every gate. What it could not
solve is that its derivation needs a full-season build, and there is nowhere cheap to put one:

| round | the fix | what the next round found |
| --- | --- | --- |
| 3 | reconcile on the server | all five routes do an uncached full-season scan |
| 4 | cache the `SeasonScoredBuild` | it exceeds Next's 2 MiB Data Cache entry limit, so it is never stored — every route rebuilds ~3,700 games |
| 5 | cache only a compact projection (904,484 B, stored) | the projection is invalidated and never warmed |

**Three rounds, one problem, moved three times.**

**CORRECTION, 2026-09-07 — an earlier version of this prompt got the precedent wrong, and the
correction matters to your design.** It said `assembleSeasonScoredBuild`'s three callers are batch or
occasional work and that **"none is a page render path."** That is false. Verified:

- `src/app/league/[slug]/insights/page.tsx:15` declares `export const dynamic = 'force-dynamic'`.
- It calls `loadWeeklyRecap` on every render, which reaches `loadRecapContext`, which calls
  `assembleSeasonScoredBuild`.
- `loadRecapContext` is wrapped in **`React.cache` only** (`loadRecapContext.ts:174`) — per-request
  dedup, **not** cross-request. Note the asymmetry on the same page: `loadInsights` IS wrapped in
  `unstable_cache` with a TTL (`loadInsights.ts:391-396`). The recap half is not.
- The gate is `leagueStatus.state === 'season' && year matches`
  (`weeklyRecapFacts.ts:93-98`), and production's `tsc` league registry reads
  `{"year":2026,"state":"season"}`. **It passes today.**

**So a full-season build on a render path is not v2's invention — it is live in production right now
on the Insights page.** v2's error was extending it from one route to five, on paths that are hit far
harder. Filed separately as **Item 141**; do not fix it here, and do not cite it as precedent for
doing the same thing again. Rounds 4 and 5 were attempts to make a batch-shaped assembly survive a
request path, and they are why v3 exists.

**Round 5's finding is worse than it was reported. Verified on the branch 2026-09-07:**

- The compact projection is tagged `ALL_STANDINGS_TAG` / `standingsSlugTag` / `standingsYearTag`
  (`canonicalSeasonScoredBuild.ts:43`).
- `src/app/api/cron/live-scores/route.ts:454` runs
  `if (totalCommitted > 0) await invalidateAndWarmStandingsForYear(year)`.
- `live-scores` fires **every 3 minutes**, and `standingsCacheWarmer` warms canonical standings
  **only** — not the projection.

**So during a game day the cache is discarded every ~3 minutes and never refilled, and every member
page load rebuilds ~3,700 games.** It works on a quiet Tuesday and is dead during live play — the one
window this feature exists for. That is round 3's behaviour, three rounds later.

**And the obvious patch is worse than the defect.** Warming the projection from the cron moves a
3,700-game build onto `live-scores`, which is **75% of all Vercel Active CPU** and the precise thing
Item 102 is being built to shrink. Read path: slow pages. Cron path: CPU blowup. Cache: invalidated
faster than it is used.

**That is the reconstruction trigger, and it is architectural, not a surviving P2.** `AGENTS.md:348`
reserves reconstruction for sedimentary product behaviour, architecture, or scope — this is scope.
**The input is wrong: this derivation should not need a full-season build at all.**

---

## CARRIED FORWARD — binding, and not up for re-litigation

`AGENTS.md` requires walking the whole stopped history, not just the round that stopped the branch.

### Settled by owner ruling — do not reopen

- **Positional counting is binding.** `/records` exposes totals, not covered game IDs, so the record's
  own `games` count is the only available basis. Reviewers proposed identity-verified coverage three
  times across two branches; ruled against three times.
- **Score-store uncertainty must PROPAGATE, not become false absence** — and your receipt was right
  that this reads as narrowing the campaign's _"records must degrade, never take a page down"_. It
  does not. **They govern two different failures; RULED 2026-09-07:**
  1. **The `team-records` read fails** — the record prop is absent. The team line renders with **no
     anchor, a blank hole**, never a fallback to the spread
     (`item-87-live-watchlist-scoreboard.md:183-188`, a deliberate owner exception to `DESIGN.md:95`).
     Unchanged, and **not this branch's to touch**.
  2. **The score store fails** — records loaded fine; you cannot tell which games are unreflected. The
     stored record renders, unreconciled. **That is exactly what `main` does today, so it is the
     absence of an improvement, not a regression.** The page stays up and the record still shows.
     Blanking it here would be withholding, which is banned.

  **What must not happen is a failure being INDISTINGUISHABLE from a reconciliation that legitimately
  found nothing to fold.** That is round 5 finding 3's real substance, and it is an **observability**
  requirement — the two cases render identically and must be told apart in logs and diagnostics. Do
  not turn it into a rendering difference.
- **No withholding policy.** Withdrawn after measurement (below). An unreadable game is skipped. That
  is the whole policy.
- **No cache-invalidation trigger.** The pre-v1 attempt had four defects from one mechanism: no game
  identity, so it blanked every team's record for one final, never fired on first-seen finals, and
  over-fired on same-winner corrections.
- **Records stay OFF Schedule.** Item 87 slice 5 removed them pending this item. Restoring them is
  separate work with its own review.

### Refuted with evidence — do not "fix" these

- **A raw exact-ID score fallback must NOT be added.** It bypasses canonical orientation validation
  and would revive **five measured reversed rows**. Rejected in round 5.
- **Withholding for unreadable finals is unnecessary:** 2 of 3,831 completed 2025 games. Being wrong
  by one game on two rows a season does not justify blanking a team's record everywhere it appears.

### Measured against production — do NOT re-derive these

| measurement | result |
| --- | --- |
| 2025 teams whose `record.total.games` equals their completed count | **668 / 668**, across a 1–17 game spread |
| 2025 completed games with an unusable final score | **2 of 3,831** |
| disrupted schedule rows, 2023–2026 | **0** |
| reversed score rows | 5, **all canonical FBS; 0 in the non-FBS fallback population** |
| cross-season-type duplicate provider IDs | **0** |
| null kickoffs | **0** |

Guards for the last three are cheap and were accepted narrowly — **log and return empty enrichment,
never take a page to the error boundary.** That was round 4's ruling and it stands.

### Latent, carried openly — not this branch's to close

- A genuinely uncredited concluded game (a completed cancellation) could shift the positional prefix
  and double-count the newest credited result. Arithmetically valid; **no production trigger
  established** — zero disrupted rows across four seasons, and the 668/668 gate held.
- A side-reversing postseason override could pair canonical orientation with raw participant IDs.
  Production currently holds **zero** stored postseason overrides.

### What v2 earned and v3 must not lose

- **The payload stays flat.** 262,550 bytes in, 262,550 bytes out. This is the constraint v1 broke and
  v2 satisfied; measure it and report both numbers.
- **The server is the right side of the boundary.** That question is closed.
- `hasUsableFinalScore` (`src/lib/gameStatus.ts:96`) does two jobs; both branches found this
  independently. Know which one you need where.

---

## References — READ THESE BEFORE WRITING ANYTHING

- **`docs/campaigns/item-87-live-watchlist-scoreboard.md` → _Records across scoreboard states —
  resolved_.** Canonical for PLACEMENT and for **"One rule, not two… No state-dependent branching in
  the data layer."**
- **`DESIGN.md`** — canonical for the RULE: a record is always the team's record today, with the
  binding corollary that a final carries the result being read.
- [`docs/next-tasks.md`](../next-tasks.md) → **Item 139**, and **Item 140**, which is the reason the
  design pass exists in this form.
- `src/lib/seasonBuild.ts` on `main` — `SeasonScoredBuild` (`:72`) and `assembleSeasonScoredBuild`
  (`:88`). **Check its callers on `main` yourself before designing.** Verified 2026-09-07:
  `seasonRollover.ts:65` (batch), `gameStats/analyticsProvenance.ts:75` (occasional), and
  `recap/loadRecapContext.ts:110` — which **is** on a `force-dynamic` page render path, with only
  per-request memoization. See the correction above; that one is Item 141, not yours.
  Note also that `loadSeasonScheduleItems` **does not exist on `main`** — v2 created it as a cheap
  split-out. If you want it, you are building it.
- `src/lib/selectors/teamRecordsClient.ts` on `main` — `teamRecordsClientProps`, the exact-CFBD-ID
  join, and `uncreditableTeamIds`.
- The abandoned branches, as reference only: `716bb6d1` (v1), `132a0daf` (v2).

---

## STOP 1 — post a READ RECEIPT

Report these, then **STOP and wait**. A branch checkout is fine; nothing else.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. Quote **"One rule, not two"** and the sentence after it about the data layer. Say what the
   state/anchor table varies by state and what it does not, and why that constrains this slice.
3. **Name the three things v2 got RIGHT that you are required to preserve**, and say for each what
   would tell you that you had lost it.
4. `assembleSeasonScoredBuild` (`seasonBuild.ts:88` on `main`) performs a sequence of loads and a
   full identity/score attachment before it returns. **List every step**, and mark which are needed to
   answer _"which of this team's completed games are not yet in its record, and what were their
   outcomes?"_ Then **name its three callers on `main`** and say what they have in common that five
   page routes do not — and note that one of the three is NOT what the earlier draft claimed, per the
   correction above. This is the design pass's central question and the receipt is where you show you
   can see it.
5. Anything in the references that CONTRADICTS or narrows what you were handed. If nothing, say so
   explicitly.

A receipt that summarises without quoting is not a receipt.

---

## STOP 2 — the DESIGN PASS

**This is why v3 exists. Produce a written design and STOP. No implementation, no tests, no branch
commits beyond notes.**

**The constraint that defines v3: NO FULL-SEASON BUILD ON ANY REQUEST OR CRON PATH.** If your design
needs one, it is v2 again and you must say so rather than proceed.

Answer these, with evidence rather than assertion:

1. **What is the smallest input that answers the question?** The derivation needs, per team, the
   games at position ≥ `record.total.games` and their outcomes. Establish what that actually requires.
2. **Test this hypothesis and report whether it holds — do not assume it, and do not treat it as the
   answer I want.** `team-records` refreshes **hourly**, so a record can only be behind by games that
   finalised recently; those are a handful, concentrated in the current week. Meanwhile the raw
   schedule rows already carry `awayId` / `homeId` **as exact CFBD IDs** — the same basis
   `teamRecordsClientProps` joins on, confirmed against a production row — so per-team completed
   counts may be derivable from the raw schedule blob with **no identity resolution and no score
   attachment**. If that holds, scores are needed only for the short unreflected tail rather than for
   ~3,700 games. **Verify or refute it.** A refutation with evidence is a good outcome; assuming it
   and being wrong is v2 again.
3. **Where does it get computed, and what invalidates it?** Name the cache tags if you cache at all.
   **A design whose cache is invalidated by `live-scores` every 3 minutes is v2**; say so if that is
   where you land.
4. **What does it cost on the five dynamic routes, and on any cron it touches?** Estimate before you
   build. v2 passed every gate and still shipped a build-per-request during games — no existing test
   could see it, and yours will not either unless you design for it.
5. **Does Item 140 change the answer?** Item 140 would stamp, per game, the first observation at which
   it read final — which makes "unreflected" directly answerable. It is **not built**, so v3 must not
   depend on it. But say whether it would simplify this, because that changes what the owner
   sequences next.
6. **What breaks if you are wrong?** For each risk, whether a test could catch it.

**Recommend one design. Give the runner-up and why you rejected it.** The owner rules before you
build.

---

## Branch

Branch from current `origin/main`, named to distinguish it from both abandoned attempts. A `pre-push`
hook runs `npm run lint:all` and refuses a failing push.

<gate>
**Do NOT compute this in the browser.** v1's grave.

**Do NOT require a full-season build on a request or cron path.** v2's grave.

**Do NOT build a cache-invalidation trigger**, a withholding policy, an identity-verified coverage
model, or a raw exact-ID score fallback. All four are settled above.

**Do NOT touch `CompactGameScoreboard.tsx`** or restore records to Schedule.

STOP and report if the payload grows at all, if your design needs a full-season build, or if a call
site cannot reach what the server needs.
</gate>

<completeness_contract>
Applies to the implementation, after the design is approved.

- **A final renders the record INCLUDING its own result.** The headline; assert it directly.
- **A record three games behind folds all three.** A one-game fixture cannot distinguish "folds the
  current game" from "folds everything unreflected", and those are different implementations.
- **A record already current is unchanged.** No double-counting; the common case.
- **Ties fold.** `TeamRecordItem['total']` carries `ties`, and the projected type drops it — a tied
  game must not vanish.
- **An unreadable game is skipped and the rest still fold.**
- **The COST is asserted, not assumed.** v2's defect was invisible to every test it wrote and to both
  reviewers for two rounds. Assert the work done on a cold path — a count of games processed, or the
  absence of the expensive call — so a future regression is visible to the suite rather than to
  production.
- **Payload measured before and after**, both reported.
- **Generate over the type's contract** (`AGENTS.md`), varying games-completed, records-behind-by, tie
  presence, and unreadable games — not over one season's shape.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline. Exactly
those two, or stop and report.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; **the payload before and after**; **the
measured cost on a cold path**; the mutation proving the fold covers all unreflected games rather than
only the current one; and anything you deliberately did not do.

Say plainly that records remain absent from Schedule and that restoring them is separate work.

**Say plainly what happens during a live game day** — that is the question v2 answered wrongly for
three rounds, and a report that does not address it directly has not addressed the reason v3 exists.

Closeout is a separate pre-merge commit after review convergence: registry entry (recording v1 and v2
as superseded/unimplemented and v3 as the execution record), Item 139 status, and the `DESIGN.md`
record paragraph.
</output_contract>
