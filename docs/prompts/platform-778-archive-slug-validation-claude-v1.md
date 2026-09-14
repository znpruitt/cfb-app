PROMPT_ID: PLATFORM-778-ARCHIVE-SLUG-VALIDATION-CLAUDE-v1
PURPOSE: Two admin debug routes read season archives under a `leagueSlug` taken from the query string
and never checked, so a slug naming no league mints a cache entry tagged for a league that will never
exist — and nothing can ever reclaim it.
SCOPE: `src/app/api/debug/archive-audit/route.ts`,
`src/app/api/debug/archive-integrity/route.ts`, and `src/lib/seasonArchive.ts` — **including
`listSeasonArchives`, added 2026-09-14 at the receipt gate: it mints a SEPARATE cache identity under
the same `archive:<slug>` tag and shares the hole** — plus their suites. NOT the year bound (#770/#774, both
shipped), NOT the other debug routes' year parsers, NOT the archive write path.
CARRIES: **NONE from the Item 87 index — checked; no row is owned by #778 or the debug surfaces.**
The governing precedent is #774, merged 2026-09-13 (`4c939fbf`, PR #779), recorded in `AGENTS.md` →
Season Launch invariant 4:

> **Still open: two admin debug routes cache archives under an UNVALIDATED `leagueSlug`, and those
> entries carry a tag no rollover can ever fire — [#778](https://github.com/znpruitt/cfb-app/issues/778).**

Issue: [#778](https://github.com/znpruitt/cfb-app/issues/778), found by the #774 lane while
adjudicating a review finding whose framing it corrected.

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** Fast-forward `claude/base` — it is behind — then
branch and **verify the SHA**. `npm test` exits 0 on clean `main`; **the known-failure set is EMPTY**.

**`CLAUDE.md`'s push-`preview` instruction is SUSPENDED for this branch.** The UI lane holds a
slice-scoped grant. This slice has no user-visible surface. Verify locally; if you think you need
`preview`, stop and ask.

## The defect

`archive-audit/route.ts:452-461` and `archive-integrity/route.ts:319-338` both do only this before
reading:

```ts
const leagueSlug = url.searchParams.get('leagueSlug');
if (!leagueSlug || !yearParam) { … 400 }
```

then `getSeasonArchive(leagueSlug, year)`, which caches under
`['season-archive', leagueSlug, String(year)]` with **`revalidate: false`**, tagged
`[seasonArchiveSlugTag(leagueSlug), seasonArchiveYearTag(leagueSlug, year)]`.

**So `?leagueSlug=anything&year=2020` mints an entry tagged `archive:anything`.**

**Why that is worse than #774's junk entries, which are already fixed.** Those carried
`archive:<real-slug>`, and the season-rollover cron fires that tag — swept once a season. **A tag
naming a league that does not exist can never fire**, because no rollover will ever run for it.
**CORRECTED 2026-09-14 at the receipt gate:** `revalidate: false` is **not** "no time expiry" —
`unstable-cache.js:27` reads `typeof revalidate !== 'number' ? CACHE_ONE_YEAR : revalidate`, and
`CACHE_ONE_YEAR = 31536000`, so it becomes a **one-year TTL**. Verified on disk: the minted entries
carry `"revalidate":31536000`. So the accurate claim is **no tag-driven reclamation, and a one-year
floor** — past every operational horizon, but not unbounded. The fix is unchanged; the sentence was
wrong and #778's body is corrected to match.

**A third sibling already does it right and is the pattern:**
`debug/insights-career-diagnostic/route.ts:21-23` calls `getLeague(leagueSlug)` and returns
`404 league-not-found` before touching the cache.

## What is NOT wrong here — corrected from the originating review

The review framed this as #774's dense-key-space defect. **It is not.** Both routes use
`Number.parseInt`, which truncates — `2026.5` → `2026`, `2e10` → `2`, `0x7E0` → `0`. **Their year
space is countable**, which is #770's shape. **The year is not the problem; the slug is**, and a fix
aimed at the year would close almost nothing.

## The decision this item owns

**Where does the refusal live — the two routes, or `getSeasonArchive` itself?**

`getSeasonArchive` has **15 non-test call sites**. Eleven take `slug` from an RSC route param; four
take a query-string value. **Two of the four forgot to validate.** That ratio is the argument for the
authority owning the refusal rather than each caller remembering — the same reasoning `AGENTS.md`
auth invariant 8 applies to Server Actions, that route protection is never the authority.

**My lean is the authority, and the receipt must test it rather than adopt it.** `getSeasonArchive`
would need `getLeague`, which is `React.cache`'d and therefore free within a request — but it couples
the archive reader to the registry, and that coupling is the cost to weigh.

**And a route param is not proof a league exists either.** `/league/<anything>/history/2020` is a
valid URL shape. **Receipt item 3: establish whether the eleven RSC call sites are actually safe**, or
whether some reach `getSeasonArchive` before validating. If any do, the member-facing surface has the
same hole and this item just got bigger — **report it, do not sweep it in.**

## Acceptance boundary

- An unknown `leagueSlug` cannot mint a cache entry on either debug route.
- **The refusal matches `insights-career-diagnostic`'s shape** — `404 league-not-found` — unless you
  argue otherwise; two siblings answering the same condition differently is the divergence this item
  exists to remove.
- **Every legitimate caller is unaffected**, including the eleven RSC sites and the eleven-plus
  library call sites, whether or not the refusal moves into the authority.
- No change to what a valid archive read returns, or to the write path.

**Residue to record, not fix:** entries already minted by a typo are **not enumerable and not
purgeable** short of a global cache purge. This slice stops new ones; it cannot clean old ones. Say so
plainly rather than implying the exposure is closed retroactively.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. **One complete run that itself exits 0**; a test that cannot execute is a
  coverage gap to report, not a pass. Report the DELTA measured at both ends.
- **Reproduce first**, the way #774 did: hit a debug route with a nonexistent slug and show the entry
  on disk under `NEXT_PRIVATE_DEBUG_CACHE=1`, then show it absent after. **A status-code assertion
  alone does not observe the cache**, which is the distinction #774's `2026.5`-planted-archive test
  drew.
- **Mutation-prove the refusal can see an unknown slug**, paired with a positive control proving the
  same fixture serves a real one.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge, on the branch: `docs/prompt-registry.md` and the `docs/next-tasks.md` row, **keyed by the
issue link**. Record where the refusal landed and why, the RSC finding from receipt item 3, and the
unreclaimable-residue note. **`AGENTS.md` Season Launch invariant 4 names #778 as still open and is
owed an amendment at merge — that file is planning's; report the sentence rather than editing it.**

**At merge, verify BOTH directions in the shared ledger files.** A clean `ort` result is not the same
claim as "both sides survived" — PR #777 silently reverted a true correction that way, and #774's lane
caught a later one only because it read the merged file. Read it; do not report the absence of
conflicts.

## RULINGS ON THE READ RECEIPT — 2026-09-14, binding

**The refusal goes in the AUTHORITY, covering BOTH `getSeasonArchive` and `listSeasonArchives`.**
Your item-5 argument is the one that carries it, and it is stronger than the ratio this prompt
offered: **a refusal placed only in `getSeasonArchive` leaves the sibling unguarded for the next
caller.** The 2-of-3 ratio is weaker than my 2-of-4 framing — accepted — and the measured cost is one
registry store read per request, which is zero.

**Q1 — RETURN `null` (and `[]`), do not throw.** Your lean is right and the reason is stronger than
"it preserves callers": **`null` is already the contract's answer for "this league has no archive," and
a league that does not exist genuinely has none.** So this is the authority answering correctly, not
a refusal smuggled in as a return value. A throw would change eight currently-safe callers' failure
mode to buy nothing. `listSeasonArchives` returns `[]` on the same reasoning.

**The two routes keep an explicit `404 league-not-found`**, matching `insights-career-diagnostic`. The
authority stops the mint; the route says why. Those are different jobs and both are wanted.

**Q2 — amend `seasonArchive.ts:232`, in the same commit. Granted, and it is yours to write:** that
comment lives in `src/`, which is your file, and the prose being #774's does not change who owns the
line. **Say WHY the two properties differ** rather than just narrowing the old claim — the year bound
stayed at the callers because only a caller can tell a client-supplied value from a server-derived
one, and **no equivalent distinction exists for a slug: there is no legitimate server-derived slug
naming a league that does not exist.** A reader who sees only "the callers apply this and the
authority does not" four lines from an authority-applied refusal will read it as contradicted.

**Accepted corrections, all five.** The one-year TTL (this prompt is corrected above, and #778's body
with it); the 8/3/4 split replacing my 11/4; `listSeasonArchives` sharing the hole (now in SCOPE); the
`seasonArchive.ts:232` precedent; and both routes echoing the raw slug into their 404 body. **The
acceptance boundary's "eleven RSC sites and the eleven-plus library call sites" is void** — use your
measured population.

**Two things in your sweep to carry into the closeout rather than leave in the receipt:**

- **Site 7 (`admin/[slug]/preseason/owners:46`) is safe BY READING, not by observation** — your probe
  got a 307 from middleware and the page body never ran. Say so; it is the one cell in that table with
  a different warrant.
- **`recap/loadRecapContext.ts:45` is safe by three unrelated accidents, not by a check.** It calls
  `getLeague` nowhere. That is worth a sentence, because the next change to any one of those three
  paths removes the protection with nothing to fail.

**Do not widen to the standings or insights caches** — you measured them as reclaimable and
TTL-bounded respectively, and that is the finding.

**Expect the bill you quoted:** `seasonArchive.test.ts` and `seasonArchiveYearBound.test.ts` plant
archives for slugs no registry fixture backs. Quoting it at the receipt rather than discovering it in
round 3 is the right instinct — plant the registry entries rather than weakening the guard.

## STOP — read receipt before writing any code

1. **Reproduce it.** A nonexistent slug on each of the two routes, with the cache entry shown on disk.
   Report the tags on it. **If no entry is minted, the issue is wrong and I need to know first.**
2. **Confirm the tag can never fire.** Enumerate every production caller of `revalidateTag` that could
   emit `archive:<slug>`, and say what would have to happen for one to fire for a league that does not
   exist. #774 established `saveSeasonArchive` as `invalidateSeasonArchive`'s only production caller —
   **re-derive rather than inherit it.**
3. **Are the eleven RSC call sites safe?** For each, say what validates the slug before
   `getSeasonArchive` is reached, and name any that do not. **A count of "all safe" is a claim.**
4. **Cost of moving the refusal into `getSeasonArchive`:** how many call sites would need a `league`
   they do not currently have, and does `getLeague`'s `React.cache` genuinely make it free within a
   request? Measure rather than assume.
5. **Does anything else in `src/` cache under a caller-supplied slug** the way this does? #770 and
   #774 were each an instance of a class; say whether this one is too.
6. **Enumerate every reader of `leagueSlug` in the two routes and CLASSIFY it** — cache key / tag /
   store lookup / display. #774 found its worst consumer only because the list was classified.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
