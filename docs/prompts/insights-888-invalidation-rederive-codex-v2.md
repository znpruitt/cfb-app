# INSIGHTS-888 v2 — reconstruction from the settled design

```text
PROMPT_ID: INSIGHTS-888-INVALIDATION-REDERIVE-CODEX-v2
PURPOSE: v1 (`codex/insights-888-invalidation-rederive`, stopped at `6b8b646a`) is ABANDONED by owner
         decision 2026-10-13 after four review rounds, two remediation rounds and one authorized
         coverage reconstruction, still carrying two confirmed defects. The DESIGN is settled and
         survives; the implementation does not. Rebuild it from `main`.
SCOPE:   As v1 — the ForwardLook payload and composer, `/api/insights/[slug]`'s response,
         `useInsightsFeed`'s invalidation, and the seam through `useLiveRefresh`, `CFBScheduleApp`
         and `parseForwardLook`. DO NOT change the three families' decisions, the tile, the
         rendering, the changeover, or DESIGN.md.
CARRIES: This prompt IS the carry-forward required by AGENTS.md before dispatching a reconstruction:
         every accepted finding as a requirement, every refutation with its evidence, and every fix
         that must NOT be reproduced. **Do not read the stopped branch for guidance** — read it only
         if a requirement below is ambiguous, and treat §3 as the warning label on it.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - A measurement claim states the population it was taken over.
```

---

## Why v1 was abandoned rather than patched

Four review rounds. Two remediation rounds spent. One authorized reconstruction of the coverage
predicate. **It still carried two confirmed defects**, and the owner's test was the decisive one:

| | `main` today | v1 as stopped |
| --- | --- | --- |
| freshness | one stale claim, ~133ms race | correct |
| transient bootstrap failure | tile unaffected | **tile hidden for the session** |
| open page across a deploy | tile unaffected | **tile lost until reload** |

**It traded a rare stale claim for a tile that vanishes on transient errors** — worse on the one
dimension this work exists to fix. The design was never the problem; **every defect lived in a
mechanism a round had just added.**

---

## RECEIPT ADJUDICATED 2026-10-14 — proceed. Readiness and coverage approved; four prompt corrections

### APPROVED: the readiness signal

```ts
scoresObservedAt !== null || scoreHydrationState.regular || scoreHydrationState.postseason
```

**Derived per render from existing signals — which is what makes it unable to latch**, and that is the
whole of §2.1. A thrown bootstrap leaves all three unset; a later clean NARROW poll updates
`scoresObservedAt` and composition becomes eligible **without requiring another full-season read**.
Coverage recomputes from current inputs, so supplying a missing result restores the pair with no latch
to reset — §1.10 satisfied by construction rather than by a rule.

**No new fetch, completeness state, revision authority or bootstrap guard.** Correct.

### APPROVED, and IMPROVED: the coverage predicate

Your three states stand. **Your addition is better than this prompt's table and is adopted:**

> **Positive completion evidence is different.** An attached final, or explicit completed-game
> evidence, requires a usable result **despite a missing or inconsistent date** — and
> `gameStatus.ts:193`'s conclusion classifier already distinguishes it.

**§1.9 said "undated establishes neither", and left a game KNOWN complete through a bad date
unaccounted for.** Absent date does not suppress; present completion evidence does require a result.
Those are different axes and the prompt collapsed them.

Also adopted: an ordinary dated meeting whose kickoff has passed with an unverifiable result withholds
that pair; cancellation stays excluded; withholding lasts only while its cause persists.

### CORRECTION 1 — §1.7 contradicted §2.3, and your reading controls

§1.7 listed odds hydration among preparation-changing inputs while §2.3 forbids repeating schedule
preparation on odds arrival. **The specific requirement wins: odds change COMPOSITION; games, roster
and historical context change PREPARATION.** §1.7 is corrected below.

### CORRECTION 2 — §4's recap row conflated two questions, and planning had already been corrected on it

The evidence cited (a mounted test showing the recap surviving a failed client bootstrap) establishes
**bootstrap independence, not immunity to stale claims.** Corrections to the recap's own games DO
change it — which the §888 lane established on a fixture earlier, and planning accepted, and then
reintroduced in this prompt's refutation table. **The accepted server-snapshot asymmetry governs and
carries forward.** The row is corrected below.

### CORRECTION 3 — v1 evidence is not v2 verification

**The split-composer timings and the 256 compact-payload round trips describe v1.** Neither
implementation exists on `main`. They are context for why a decision was made, **not verification of
anything you build.** V2 needs its own tests and its own measurements, and any figure quoted in the
closeout must say which implementation produced it.

### NEW REQUIREMENT — §2.8: preserve the outer composition failure boundary

**Your catch, and it is the one most likely to have been lost.** `loadTimelyContent`
(`loadWeeklyRecap.ts:25`) catches composition failure so the recap survives it. **§4's
malformed-participant refutation says the crash is not branch-caused; it does NOT authorize removing
the guard that contains it.** That is the removed-guard rule exactly: the guard may be wrong about HOW
the failure arrives and is right about WHAT MUST NOT HAPPEN.

**Moving composition into render must keep an equivalent boundary: a composition failure must not take
the recap, the Insights feed or the page with it.** Pin it.

### Accepted as answered

§2.4's `canonicalStandings?.rows ?? []` allocating a fresh array per render is a real memoization
hazard and worth naming in the report. §2.5 is subtle and right: the `unavailable` odds arm is
reachable in the SERVER loader and becomes unreachable client-side, **so express the client's real
conditions rather than transplanting a server-only union.**

## §1 — THE SETTLED DESIGN. This is specification, not suggestion

Each of these cost at least one round to establish. **None is open.**

1. **One tile, same slot, replacing the recap at the Thursday 06:00 ET cutoff.** Narrative lines, not
   a game list. Expandable. `DESIGN.md` → *Elevated timely-content zone*.
2. **Three families** — standings implications, rivalry implications, upset risk — with a per-family
   cap and the Insights panel's merge-and-slot discipline. **The merge/slot pattern does NOT cap per
   family; that cap is additional and needs its own test.**
3. **It must NOT consume `watchlistPriority`.** That ranker is `Math.max` over `top25`/`upset`/
   `game-of-slate`/`close`/`ranked-team` and **not one term knows about owners** — a rivalry collision
   with a title race scores 0 unless a team is AP-ranked. Correct for the watchlist, wrong here.
4. **The server supplies STABLE context; the client composes over the scores it already renders.**
   That is what removes the second source and with it the whole reconciliation problem.
5. **Standings facts come from `canonicalStandings.rows`** — the same snapshot the podium and
   condensed table use. **No client-side `deriveStandings`.** Standings Ownership Invariant rule 3
   exists because render-time merging caused the NoClaim-at-#1 bug and took eight rounds to replace,
   and #827 fixed "one screen presents two leaders".
6. **Freshness, stated narrowly:** *Forward Look's standings claims follow the displayed canonical
   standings. Its game eligibility and rivalry claims follow displayed client scores.* Behind
   **together** with the table is the property we want.
7. **Preparation split:** prepare schedule and history once per context change; compose from scores on
   change. "Stable" means reusable between explicit context updates, **not frozen for the mount** —
   schedule rebuilds, postseason overrides and roster reloads move those inputs.
   **CORRECTED at the receipt: odds change COMPOSITION, not preparation.** This bullet listed odds
   hydration among preparation-changing inputs and contradicted §2.3.
8. **Do not serialize whole `SeasonArchive` objects.** Six production archives total **9,594,557
   bytes**. Compact historical preparation is mandatory.
9. **Coverage predicate:** coverage is required **only for meetings whose result could change the
   record.** Future-dated, undated and postponed are three distinct states and **none of them is "a
   played game we can't see."** A verified week-6 streak does not become unverifiable because a
   week-12 meeting lacks a date.
10. **"All season" means while that input persists, not a permanent latch.**
11. **Compose only when visible.**
12. **Family-level failure isolation** — `rivalries: null` must preserve standings and upsets.

## §2 — ACCEPTED FINDINGS, restated as requirements

Each of these was confirmed by review on v1. **A latent finding still counts: it was latent in the old
shape, not necessarily in the new one.**

1. **A successful poll after a thrown bootstrap must reveal the tile.** v1's hydration gate latched,
   hiding Forward Look for the session even after a narrow poll succeeded — recovering only on an
   explicit full read. **This is the defect that stopped the branch. Design the readiness signal so it
   re-evaluates rather than latches.**
2. **Preserve last-good history across same-scope refetch failures.** Manual and boundary 500s, with
   scope isolation.
3. **Odds arrival recomposes without repeating schedule preparation.**
4. **Empty canonical rows are a stable, handled input**, not a fallback that produces claims about a
   zero-win league.
5. **No unreachable arm.** v1 shipped an `unavailable` odds branch that became unreachable once
   composition moved client-side. **Do not write a branch whose necessity and exercise are different
   conditions.**
6. **Incomplete inputs must not produce claims.** `{}` before hydration is loading state, not an empty
   season. **But see §1.9 — withholding must be scoped to meetings that could change the claim**, which
   is precisely where v1's second remediation went wrong.
7. **PRESERVE THE OUTER COMPOSITION FAILURE BOUNDARY.** `loadTimelyContent`
   (`loadWeeklyRecap.ts:25`) catches composition failure so the recap survives it. Moving composition
   into render must keep an equivalent boundary — **a composition failure must not take the recap, the
   Insights feed, or the page.** §4's malformed-participant refutation says that crash is not
   branch-caused; it does not authorize removing the guard that contains it.
8. **Cross-version payload incompatibility is ACCEPTED, not fixed.** Each parser accepts its own shape
   and rejects the other; an open bundle receiving a new response loses the tile until reload. Owner
   decision: every payload change has deploy-window skew, promotion timing is owner-controlled, and a
   version field would not make an old bundle understand a new shape. **Record it in the closeout; do
   not build for it.**

## §3 — FIXES THAT MUST NOT BE CARRIED FORWARD

**The stopped diff contains these and they read as corrections. They are not.**

1. **`f3e5fbb6`'s all-unknown-meetings suppression.** It omitted a rivalry line if ANY potential
   meeting was unverifiable, which suppressed verified records because of unrelated future, undated or
   postponed games. **It was itself superseded by `6b8b646a` on the same branch**, so the stopped
   history contains both the wrong predicate and its replacement. §1.9 is the requirement; this is the
   shape to avoid.
2. **The round-1 hydration gate as implemented.** The requirement survives (§2.1, §2.6); the
   implementation latches and is what stopped the branch.
3. **Any separate revision, completeness or baseline authority.** Rejected twice. The five-case
   comparison contract derived during v1 is correct and **belongs to
   [#890](https://github.com/znpruitt/cfb-app/issues/890)**, not here — v1 could route around the
   problem by removing its second source; #890 cannot.

## §4 — REFUTED, WITH THE EVIDENCE. Do not re-derive these

**A reviewer may raise any of these again. Each already cost a round.** Per the standing rule, a
repeat you believe is wrong gets a TEST, not a rebuttal — these are the tests' subjects.

| claim | refutation |
| --- | --- |
| `participants: null` is a new branch-caused crash | The same throw goes through the **unchanged** live-overlay selector earlier, and the schedule builder reconstructs valid participants from all four malformed wire shapes tested |
| Rivalry evaluation costs 12.2ms | That measured the **pre-split** composer. Current: **0.5ms** median (900 games + 5,533 historical), **1.7ms** at the 3,679-game stress case. Hoisting the compact map is optional cleanup |
| Cross-archive dedup is new dead code | It existed on base. Duplicate archive input retains three wins; removing the outer guard produces six. `2025` and `02025` both resolve to 2025 |
| Malformed payloads prove a producer defect | **256 outcome combinations round-trip**, including duplicated archive input. No producer path established. Failed same-scope refetches retain history |
| The recap depends on client bootstrap | The unchanged comment says the recap is **server-derived**, and a mounted test confirms it survives a failed client bootstrap while Forward Look does not. **NOT a claim that the recap cannot go stale** — corrections to its own games DO change it; the accepted server-snapshot asymmetry governs |
| Five pre-odds lines can render | Impossible — the family caps allow four |
| The usable-final COUNT can order observations | **Not monotonic.** `manualPartitionMerge.ts:107` lets an authoritative response omit a final or replace it with a nonfinal; the test at `:44` asserts the omission |
| `liveDelta` can advance standings facts | `selectLiveDelta` counts in-progress leads and **excludes finals**. Folding pending wins in turns "currently leading" into "has won" |

**Production census, 2026-10-13:** zero undated or postponed-status games across **3,679** games in
2026 and **3,831** in 2025. That bounds observed impact and does **not** make the §1.9 predicate
optional — a postponement is an ordinary football event, and #830 exists because a weather-delayed
game rendered wrongly.

## §5 — Out of scope, named so they are not folded in

- **[#890](https://github.com/znpruitt/cfb-app/issues/890)** — the shared canonical bootstrap gap.
  Rivalry moving with client scores while standings wait is an **accepted cost** under §1.6. **No
  tile-specific holdback.**
- **[#891](https://github.com/znpruitt/cfb-app/issues/891)** — duplicate target selection, repeated
  preparation, fixture boundaries. Parked, and re-derive rather than inherit.
- **[#892](https://github.com/znpruitt/cfb-app/issues/892)** — what to render when coverage IS
  incomplete. Pre-existing, reaches the recap, owner's ruling.

## Acceptance

1. **The four-round regression table from v1 stays dissolved** — stale claims, held streaks, duplicate
   generation, bootstrap absorption. Each gets a test.
2. **§2.1: a successful poll after a thrown bootstrap reveals the tile.** The defect that stopped v1.
3. **§1.9's coverage predicate**, with future, undated and postponed each tested separately.
4. **§1.5: standings facts trace to `canonicalStandings.rows`**, pinned — and a fixture where client
   scores and canonical rows disagree must show the tile agreeing with the **table**.
5. **No unreachable arms** (§2.5), and no separate authority (§3.3).
5b. **A composition failure does not take the recap or the page** (§2.7), pinned by a test that throws
   inside composition and asserts the recap still renders.
6. Every §4 refutation carries a test, so a repeat is answered by a run rather than a round.

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 4 is the likely false green.** A fixture built from one source cannot show the tile
following canonical rather than client scores. Construct them in disagreement.

**Acceptance 3's three states are separate tests.** v1's second remediation passed a "withholds on
incomplete coverage" test while suppressing verified records — one assertion covering three states is
how that shipped.

---

## STOP — read receipt before writing any code

1. **Which of §2's seven requirements are already satisfied by `main`**, and which are new work?
2. **What is your readiness signal, and how does it re-evaluate rather than latch?** §2.1 is the defect
   that stopped v1; answer it before anything else.
3. **How do future, undated and postponed differ in your coverage predicate?** Name the three
   behaviours separately.
4. **Does anything in §4 contradict what you find?** A refutation that no longer holds is a finding.
5. **What in this prompt contradicts the code?**

Do not start until the receipt is answered and it has been ruled on.
