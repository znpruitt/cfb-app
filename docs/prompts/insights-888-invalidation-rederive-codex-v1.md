# INSIGHTS-888 — re-derive Forward Look's invalidation: the server stamps what it composed against

```text
PROMPT_ID: INSIGHTS-888-INVALIDATION-REDERIVE-CODEX-v1
PURPOSE: Forward Look detects "a result changed" by diffing a client-held baseline against a
         client-held score snapshot. Those are two independently-fetched async sources with no
         ordering between them, and four remediation rounds each fixed one ordering case and left
         the next reachable. Replace the mechanism: the server stamps the result set it composed
         against, and the client compares that given value to the one it observes.
SCOPE:   The `ForwardLook` payload type and its composer, `/api/insights/[slug]`'s response, and
         `useInsightsFeed`'s invalidation (`:272-287`). DO NOT change the three content families,
         the tile, the rendering, the changeover off `selectWeeklyRecapTileState`, or
         `loadRecapContextForSeasonScope`'s gather — all correct across four review passes.
CARRIES: From AGENTS.md's reconstruction rule, amended 2026-10-06 out of this very branch:
         **"wrong model" means the MECHANISM, not the concept.** The concept here — compose forward
         stories, invalidate when results change — was right from round zero and stays. **This slice
         rebuilds exactly the component that earned it and nothing else.**

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - A measurement claim states the population it was taken over.
```

---

## ADJUDICATED 2026-10-10 — direction holds; three rulings, and the standings allowance is DENIED

### 1. Preparation boundary — ACCEPTED as you recommend

Prepare reusable schedule and history inputs once per context change; compose from current scores on
change. **Your measurement is the argument:** standings derivation ~0.2ms against rivalry evaluation
12.2ms in the same case, so the expensive work is the part that does NOT depend on scores.

**Your caveat binds: the split needs its own measurement.** Do not carry the unchanged-composer
numbers across to the split design.

**"Stable" means reusable between explicit context updates, not frozen for the mount** — your
correction, and it is right. Schedule rebuilds, postseason overrides, roster reloads and odds
hydration all move those inputs.

**And do not serialize whole `SeasonArchive` objects.** 9,594,557 bytes across six archives is a
decisive number; compact historical preparation is mandatory, not an optimisation.

### 2. Snapshot freshness — ACCEPTED, and planning's rationale was WRONG

I justified the recap asymmetry with "its claims cannot go stale." **False, and you disproved it on a
fixture:** a correction to a reported game changes recap winners, records and points, and the composer
explicitly supports incomplete recaps that later complete. A LATER UNRELATED game cannot invalidate
the recap; a CORRECTION to one of its own games can. Those are different claims and I conflated them.

**Your wording is adopted verbatim as the decision:**

> Forward Look follows displayed client scores immediately. Recap and ordinary Insights remain server
> snapshots, updated by their retained fetch triggers; removing result-triggered fetching means
> corrections and late completions can wait until the next such fetch.

**The collateral is accepted with it:** today the completed-result dependency refetches the entire
response, so removing it also removes recap and ordinary-Insights freshness updates. That delay is
acceptable for backward-looking content. **If it later proves not to be, their refresh policy is
separate work and must not recreate Forward Look's reconciliation mechanism** — your line, kept.

### 3. Standings allowance — DENIED, and you should not need it

**Do not carve an exception in the Standings Ownership Invariants, and do not call `deriveStandings`
client-side.** Two precedents say why, and the second is one planning ruled on itself:

- **Rule 3 exists because render-time merging of canonical and live data caused the NoClaim-at-#1 bug
  and took EIGHT remediation rounds** before the current architecture replaced it.
- **#827 fixed "one screen presents two leaders"** — a podium and a table disagreeing because they
  read standings from different moments. **A Forward Look deriving its own standings would reproduce
  exactly that**: the tile saying "now tied" while the condensed table two inches below still shows
  them one apart.

**Rule 2 already provides the sanctioned path.** *"Client owns only the liveDelta overlay. In-progress
game annotations and computed per-owner pending stats live in `LiveDelta`, computed by
`selectLiveDelta` / `useLiveDelta`."* Overview already consumes it — `selectOwnerPendingDelta` yields
per-owner pending wins and losses.

**So the question to answer before anyone proposes an exception: are Forward Look's standings facts
expressible as canonical standings plus the liveDelta overlay?** If they are, the tile is exactly as
fresh as the standings table and **cannot disagree with it**, which is a stronger property than the
freshness this whole issue has been chasing. If they are not, say precisely which fact resists it —
that is a real finding and planning will rule again.

### Noted

**The approval guard refusing to export production records into `/tmp` was correct**, and using
synthetic data plus a count-only census was the right response rather than an obstacle to route
around.

## DIRECTION CHANGED 2026-10-09 (owner) — COMPOSE OVER THE SCORES THE CLIENT ALREADY HAS

**The owner asked why the tile does not draw from the same score data as the schedule, and that
question dissolves the problem rather than solving it.** Planning had just been about to recommend
accepting the race as a measured residual. Withdrawn.

### Why there is a gap at all

The tile's claims are composed SERVER-side from the server's read of scores; the scoreboard renders
the CLIENT's separately-polled scores. Two reads of the same underlying facts, arriving at different
times through different paths. **Every defect in the four-round table lives in that gap.** Five rounds
have tried to reconcile the two arrivals; none removed the second one.

### The split, from the inputs

`WeeklyRecapContext` (`loadRecapContext.ts:15-27`) plus `ForwardLookInputs` (`forwardLook.ts:33-40`):

| input | changes during a session? |
| --- | --- |
| `scoresByKey` | **yes — this is the whole problem** |
| `standings` | **yes — derived from scores** |
| `games` (schedule) | no |
| `rosterByTeam` (the draft) | no |
| `odds` | slowly; already carries a 24h expiry |
| `records` — archives + historical rosters | no, prior seasons are immutable |

**Only the score-dependent inputs move. Everything else is stable for the life of a page.**

### The direction

**The server supplies the STABLE context — draft, odds, archives. The client composes the claims over
the scores it already holds and already renders.**

Then the tile's claims and the scoreboard's numbers come from **one source by construction**. No
second arrival, so no gap, no ordering question, and **no revision authority to invent** — which the
receipt correctly established does not exist and would reach score writers and snapshot transport to
build.

**And it likely removes the refresh request entirely.** A new final recomposes locally instead of
re-fetching Insights. The expensive call we spent four rounds trying not to trigger spuriously stops
being part of the mechanism.

**Check the regression table against it before anything else:** all four rows should be
*unreachable*, not *handled*. If any row still needs a rule, say so — that is the signal this is
another managed reconciliation rather than a removed one.

### Four things to establish BEFORE building. This is the receipt

1. **What does composing cost on the client?** Selectors over a few hundred games — likely small,
   entirely unmeasured. Measure it; a slow compose on every score tick is a worse trade than the
   race.
2. **Does anything else depend on server-side composition?** The Insights page renders the full
   recap and may share plumbing. Enumerate the consumers before moving the seam.
3. **What happens to the payload and `parseForwardLook`?** The wire shape becomes stable context
   rather than composed lines. Say what the new contract is.
4. **The recap stays server-composed — is that asymmetry acceptable?** It is defensible, because the
   recap's claims are about finished games and cannot go stale. **But it must be a stated decision
   with that reason, not a side effect**, and planning will record it in `DESIGN.md` if so.

**If any of the four says no, report it.** This direction is planning's third on this mechanism and
the previous two were wrong — the receipt killed both with evidence from the repo. **Treat it as a
proposal to falsify, not an instruction.**

## RECEIPT ADJUDICATED 2026-10-09 — item 5 is correct and it REFUTES the direction above

**"A total order, not a reconciliation of two timelines" was wrong.** A content signature establishes
EQUALITY, not order. The receipt's reverse case is the proof: the client reads results **A**, the
server composes against newer **B**, and `A ≠ B` refreshes an already-current payload. **That is
round 2's spurious-refresh cost bug, reappearing inside its replacement** — and declining to claim the
design was sufficient was the right call. Calling an inequality check sufficient would have repeated
the mechanism mistake exactly.

### The direction, corrected: the stamp needs an ORDERING component as well as a content one

Two questions, two quantities:

- **"Did anything differ?"** — the content signature. The receipt's answer stands: sorted
  `[canonical game key, home score, away score]` tuples for usable finals, which is what
  `selectCompletedResultsKey` already computes. **Planning's "game keys alone" suggestion was wrong
  and is withdrawn** — it loses score-correction invalidation.
- **"Which side is newer?"** — currently unanswered, and the whole of item 5.

**Do NOT reach for a clock.** The two sides read different catalogs — the public scores route uses the
bundled catalog, the server build the synced one — so their instants are not established as
comparable, and a skew would produce exactly the spurious refresh being designed out.

**The candidate planning would look at first: the COUNT of usable finals is monotonic within a
season.** Finals accumulate; they do not un-happen. It is derivable from the same tuples already
established as common, so it needs no new quantity and inherits the comparability the receipt proved.
A strictly greater client count means the client is strictly ahead. Equal counts with differing
content is a score correction, which is a separate case and needs its own answer.

**That is a candidate, not the ruling.** **Derive the comparison rule and bring it back** — planning
was wrong about the last one and is not going to dictate this one from a distance. State what each
ordering case does and why, including equal-count-differing-content, and show the four-round table
still dissolving under it.

### Other corrections, all accepted

- **The stamp belongs on `ForwardLook`, computed from the exact context that composed its lines**, and
  **a retained or cached payload keeps its original stamp.** The receipt's reason is the load-bearing
  one: *refreshing the stamp independently would falsely certify old claims.* `parseForwardLook:41`
  reconstructs the object, so it must preserve and validate the field.
- **"No clock-driven requests" was too absolute.** The 06:00 ET eligibility boundary IS a fetch
  dependency (`useInsightsFeed.ts:347`) and is deliberate. The rule is: **ordinary ticks do not
  refetch; crossing the eligibility boundary does.** Acceptance 3 below means the former.
- **"A final at ANY point triggers exactly one refresh" was wrong.** A final already present in the
  initial composition requires **zero** additional refreshes. Acceptance 2 is corrected.
- **Scope widens, as it must.** Removing the baseline touches `useLiveRefresh` and `CFBScheduleApp`;
  transporting the stamp touches `parseForwardLook`. That is the mechanism's real surface and the
  SCOPE line above understated it.

### The window: measure it LOCALLY, not in production

Production returned the password gate on both probes — **zero authenticated Overview loads, so neither
probe measured the requested interval**, which the receipt stated rather than estimating around.
Correct, and planning should have anticipated it.

**Use the `verify` skill**: seed the file-fallback durable store and boot the dev server without a
database. A real page load with real timing is what the acceptance wants; it does not have to be
production. If the local interval is not representative, say why rather than reporting it as if it
were.

## Why this is a re-derivation and not a fifth round

**Four rounds produced four P2s, each inside the mechanism the previous round added:**

| round | fix | what review then found |
| --- | --- | --- |
| 0 | the tile | forward claims go stale when a result lands |
| 1 | expiry + family isolation | the held payload kept a broken streak |
| 2 | invalidate on results changing | an empty baseline reads every existing final as new |
| 3 | record a baseline at mount | a final landing between two fetches is absorbed into that baseline |

**Not four bugs. One wrong mechanism surfacing one layer in each time.** Planning overrode the
reconstruction trigger after round 2 — arguing the model was right and the bug was local — and round 3
disproved that. The rule in `AGENTS.md` was amended because of it.

## The mechanism as shipped

| citation | what it does |
| --- | --- |
| `useLiveRefresh.ts:489` | on bootstrap only, calls `onScoreBaseline(nextScores)` — *"live polls must not reseed it"* |
| `useInsightsFeed.ts:278-287` | `establishResultBaseline` sets `{ scope, key: selectCompletedResultsKey(scores) }` |
| `useInsightsFeed.ts:278` | `completedResultsKey = observedResultsKey === baselineKey ? 'baseline' : observedResultsKey` |

**The race, stated precisely:** the Insights payload and the score bootstrap are fetched
independently. A final landing between them is present in the bootstrap's `nextScores`, so it enters
the baseline as "already known" — while the Insights payload, composed before it, does not reflect it.
Baseline says known; payload is stale; nothing refreshes.

**There is no instant at which the client knows it holds a consistent pair.** That is why each round
closed one ordering and opened the next.

## The direction — and it kills all four by construction

**The server stamps the result set it composed against into the payload.** `ForwardLook`
(`forwardLook.ts:26-32`) has `seasonYear`, `recapTarget`, `target`, `weekLabel`, `lines` — **no
version field. Add one.**

The client then compares **one value it was given** against **one value it observes**. **The original
version of this line called that "a total order" and it is not — see the adjudication above; a content
signature gives equality only, and the ordering component is still to be derived.** The table below
holds for the content half, which is why the direction survives the correction:

| round's defect | why the new mechanism cannot have it |
| --- | --- |
| 0 — claims go stale | observed ≠ stamped → refresh |
| 1 — held payload keeps a broken streak | same |
| 2 — empty baseline reads existing finals as new | **there is no baseline to seed**; the payload supplies the reference |
| 3 — a final between fetches is absorbed | the stamp is fixed at compose time, so a later final makes observed ≠ stamped → refresh |

**If your design does not dissolve all four this way, it is a patch wearing a rebuild's name. Say so
rather than shipping it.**

## THE NEW RISK, and it is the first thing to establish

**The server's compose-time scores and the client's observed scores come from different fetches.** If
the two keys are not computed over the same population by the same rule, `observed ≠ stamped` fires on
differences that are not new results — and **a spurious refresh is round 2's cost bug reappearing in
the replacement.**

**CORRECTED at the receipt: the 3.33s figure is ACTIVE CPU, not response latency** — derived from 10
CPU-seconds across three invocations in a single 12-hour window on 2026-09-01
(`vercel-active-cpu.md:170`), with the dashboard rounding to whole minutes above 60s. Planning has
repeated it as latency in several places and it is not. **It has not been re-measured, and "the most
expensive route in the app" has not been re-established.** Treat it as an order-of-magnitude reason to
avoid needless invocations, not as a number to reason from.

**ESTABLISHED AT THE RECEIPT:** the common quantity is sorted
`[canonical game key, home score, away score]` tuples for usable finals in the selected season — which
`selectCompletedResultsKey` already computes. **Planning's "game keys alone" guess was wrong and is
withdrawn: it loses score-correction invalidation.** An unloaded or incomplete observation must not be
treated as an authoritative empty result set.

## The cost constraint, unchanged

**No clock-driven requests.** Invalidation fires when results change, never when time passes. That
property is correct in the shipped code and must survive the rebuild — pin it.

## The window has never been measured

Planning called the race's window "narrow" and never derived it. **Measure it**: how long between the
Insights response resolving and the score bootstrap completing, on a real page load. It decides whether
this was a rare annoyance or a routine Saturday one, and the issue's stated priority rests on a number
nobody has taken.

## Acceptance

1. **Invalidation does not depend on the client reconciling two independently-fetched sources.** The
   reference value arrives with the payload.
2. **A final already present in the initial composition triggers ZERO refreshes; a final arriving
   after it triggers exactly one.** Pinned at the boundaries, not only in the steady state. The
   four-round table is the regression list and each row gets a test.
3. **Ordinary ticks do not refetch**, pinned. The 06:00 ET eligibility boundary remains a deliberate
   fetch dependency and is not what this means.
4. **Mount with existing finals produces exactly ONE Insights request**; a final arriving after mount
   produces a second. This is round 2/3's assertion pair and it survives verbatim.
5. **The stamp is computed over a population both sides see identically**, stated and tested — a
   fixture where the two sides' score data differs in shape but not in completed results must NOT
   trigger a refresh.
6. **The window measurement is reported with its population**, whatever the outcome.
7. **Nothing outside the invalidation changes.** The three families, the tile, the rendering and the
   changeover are untouched, each pinned.

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 5 is the likely false green.** A test where both sides are built from the same fixture
object proves nothing about two independently-fetched sources. Construct them separately, with
differences that are not new results, and assert silence.

**Acceptance 2's boundary cases are the whole point.** A steady-state test passes under the shipped
mechanism too — it passed four times. The boundaries are where every round died.

---

## STOP — read receipt before writing any code

1. **Are the server's compose-time scores and the client's observed scores computed over the same
   population, by the same rule?** If not, say what quantity IS common to both. **Answer this first;
   it decides the design.**
2. **Where does the stamp belong** — `ForwardLook`, the enclosing insights payload, or a response
   header? Say what each costs if the payload is cached or shared.
3. **What is the measured window** between the Insights response and the score bootstrap, on a real
   load?
4. **Does anything else consume `establishResultBaseline` or `selectCompletedResultsKey`?** Enumerate;
   this slice removes or repurposes both.
5. **Does your design dissolve all four rows of the regression table by construction**, or does it
   close them one at a time? Answer honestly — the second is what this issue exists to stop.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
