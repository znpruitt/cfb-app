PROMPT_ID: PLATFORM-778-ARCHIVE-SLUG-VALIDATION-CLAUDE-v1
PURPOSE: Two admin debug routes read season archives under a `leagueSlug` taken from the query string
and never checked, so a slug naming no league mints a cache entry tagged for a league that will never
exist — and nothing can ever reclaim it.
SCOPE: `src/app/api/debug/archive-audit/route.ts`,
`src/app/api/debug/archive-integrity/route.ts`, and `src/lib/seasonArchive.ts` if the refusal belongs
in the authority (see the decision below), plus their suites. NOT the year bound (#770/#774, both
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
naming a league that does not exist can never fire**, because no rollover will ever run for it, and
`revalidate: false` means no time expiry either. **These are the only entries in this family with no
reclamation path at all.**

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
