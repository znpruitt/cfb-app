# PLATFORM-816 — standings cache-versus-fresh diagnostic

```text
PROMPT_ID: PLATFORM-816-STANDINGS-CACHE-DELTA-CLAUDE-v1
PURPOSE: Make the audit's second validation gate runnable — an admin-gated read-only route that
         returns the CACHED canonical standings beside a FRESH uncached rebuild for one league and
         year, with a per-team delta, and says which of the two the cached read actually was: an
         existing snapshot or one this request just created.
SCOPE:   a new route under src/app/api/debug/, its tests, and the minimum export needed from
         src/lib/selectors/leagueStandings.ts (`computeCanonicalStandings` is module-private at
         :447). DO NOT change caching behaviour, tags, `invalidateStandings`, any member-facing
         surface, System Health, or anything #693 touched. DO NOT write to any store. If the
         diagnostic appears to need a behaviour change to be observable, stop and report — that is
         a finding, not a licence.
CARRIES: NONE from the Item 87 campaign index, having checked — this is audit/platform work and
         touches no scoreboard row, tag slot or row anatomy.

         Two standing obligations that DO bind here, carried verbatim from their issues:

         #771 (open): "Admin API guard fails open when ADMIN_API_TOKEN is unset outside production."
         This route must not become reachable without credentials on preview.

         #714 (open, measured): the Insights page already pays for a full-season build on every
         render. A fresh standings rebuild is the same order of cost. This route is admin-only and
         must never be reachable from a member path or a scheduled job.
```

---

## What exists, read at `main` `5c8e2b3e`

| fact | where |
| --- | --- |
| the cached snapshot never expires; tag invalidation is the only way it changes | `leagueStandings.ts:210-232`, `revalidate: false` |
| the public entry point | `getCanonicalStandings` (`:320`) — returns the CACHED value |
| the uncached computation | `computeCanonicalStandings` (`:447`) — **module-private** |
| an existing test-only bypass | `getCanonicalStandings` skips both cache layers when `leagueStatusOverride` is passed (`:325-332`). It is labelled test-only; do not repurpose it silently |
| year resolution happens BEFORE the cache | `resolveStandingsYear` (`:257`), and the resolved year is part of the cache key (`canonicalStandingsCacheKeyParts`, `:163`) |
| the admin gate | `requireAdminAuth` (`src/lib/server/adminAuth.ts:198`), used by every route under `src/app/api/debug/` |
| the route shape to follow | `src/app/api/debug/archive-integrity/route.ts` — `export const dynamic = 'force-dynamic'`, `requireAdminAuth` first, `NextResponse.json` out |

**Nine `/api/debug/*` routes already exist.** This is a tenth of the same kind, not a new surface.

---

## THE PART THAT DECIDES WHETHER THE ROUTE IS WORTH BUILDING

**Reading the cached value can create it.** If no snapshot exists for that league and year, the
cached read computes one, stores it, and returns it — and it will equal the fresh rebuild, because
both were computed from the same inputs seconds apart. **A clean report from a cache miss is
byte-identical to a clean report from a genuine hit, and only one of them means anything.**

This is the same shape as a review of nothing wearing a clean report's shape, and as a mutation
harness that silently fails to apply: *"did not run"* and *"ran and found nothing"* render
identically. **The route must separate them and say which happened**, or a clean result is
unreadable and the gate is worse than not running.

A workable mechanism, to confirm or refute at the receipt rather than adopt on my say-so: count
executions of the uncached computation in-process, read the cached value, and compare the count
before and after. If the count moved, the cached read was a MISS and this request created the
snapshot. If it did not, an existing snapshot was returned. **Whatever mechanism you choose needs
its own positive control** — a test proving the detector reports MISS when the cache is genuinely
empty, and HIT when it is not. Proving the comparison works is not proving the detector works.

---

## The response

One league, one year per request, both from query parameters. Bound and validate both:
`#770` and `#774` are the precedent — an unvalidated year parameter mints a cache entry per distinct
value, and this route's cost per entry is a full-season build.

Return, at minimum:

- **`cacheRead`**: `"hit"` or `"miss"`, from the mechanism above, plus what it rests on
- **the resolved year**, and whether it came from the parameter or from `resolveStandingsYear`
- **per team**: wins, losses, ties, points for, points against, and final position, for both sides
- **`differences`**: the teams whose values differ, with both values, and an empty array when none do
- **`matches`**: a boolean, and the count compared — so a zero-length comparison cannot read as agreement

**A comparison over zero teams must not report agreement.** Print the population, per
`A MEASUREMENT'S COVERAGE IS PART OF ITS RESULT`.

---

## Acceptance

1. Against a warmed snapshot, the route reports `hit` and a correct per-team comparison.
2. Against an empty cache, it reports `miss`, and the report says the snapshot was created by this
   request — **not** that cached and fresh agree.
3. A deliberately stale snapshot (warm it, change an input, suppress invalidation) produces a
   non-empty `differences` array naming the changed teams. **This is the test that proves the route
   can see the thing it exists to see.** Without it the route is an unproven observer.
4. Unauthenticated requests get 401, including with `ADMIN_API_TOKEN` unset (#771).
5. An out-of-range or non-numeric year is rejected before any build runs, and mints no cache entry.
6. No store write occurs on any path — prove it, don't assert it.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**The detector needs its own positive control** (acceptance 2), separate from the comparison's
(acceptance 3). An observer that watches a guard is not proven by proving the guard.

**Negative assertions need a proven observer.** "No store write occurred" needs a control showing the
same harness DOES see a write when one happens.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **How will you tell a cache hit from a cache miss?** Name the mechanism, say what it observes, and
   say how it behaves under concurrent requests and across Fluid instances. If the honest answer is
   that it cannot be distinguished in-process, say so — that finding is worth more than the route.
2. **How do you obtain the FRESH value?** Exporting `computeCanonicalStandings`, the existing
   `leagueStatusOverride` bypass, or something else. Say what each costs: the override is labelled
   test-only, and widening a test-only door for production use is a decision, not a detail.
3. **Does reading the cached value inside a Route Handler behave the same as in an RSC page?**
   `unstable_cache` is not `React.cache`, and this repo has measured the two behaving differently in
   route handlers. State what you verified, not what you expect.
4. **What is the cost of one request**, in store reads and in build work, and what stops it being
   called repeatedly? Give the number of games a 2026 rebuild walks.
5. **Which league and year would you run this against first**, and what does the current production
   data say the answer should be? All three leagues carry passwords; name them.
6. **Can a stale snapshot be produced in a test at all?** Acceptance 3 depends on it. If
   `unstable_cache` cannot be driven under `node:test`, say so and say what the test proves instead —
   the limitation gets stated, never worked around.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
