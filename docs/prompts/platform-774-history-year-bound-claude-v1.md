PROMPT_ID: PLATFORM-774-HISTORY-YEAR-BOUND-CLAUDE-v1
PURPOSE: `GET /api/history/[slug]/[year]` has no year ceiling and accepts non-integers, and every
distinct value mints a `revalidate: false` cache entry whose only tag fires once a season. Bound it.
SCOPE: `src/app/api/history/[slug]/[year]/route.ts`, the RSC page
`src/app/league/[slug]/history/[year]/page.tsx` if it shares the defect, `src/lib/seasonArchive.ts`
only if the bound cannot live at the callers, and their suites. NOT the Insights bound (#770,
shipped), NOT the other seven year parsers, NOT the archive write path.
CARRIES: **NONE from the Item 87 index — checked; no row is owned by #774 or the history API.** The
governing precedent is #770's derivation, which shipped 2026-09-13 (`31fc892a`, PR #775) and is
recorded in `AGENTS.md` → Season Launch invariant 4:

> **`?year=` is bounded at the route** … A caller-supplied year is accepted only within
> `[MIN_SEASON_YEAR, currentYear + 1]` **or** when it equals the league's own operating year, and a
> rejected value returns **400** … **The same shape is still OPEN on `/api/history/[slug]/[year]` —
> #774.**

**Reuse #770's STRUCTURE — a route-level bound, a 400, a disjunct that cannot reject a legitimate
value. Do NOT reuse its CEILING.** See below; it is wrong here.

Issue: [#774](https://github.com/znpruitt/cfb-app/issues/774).

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** `claude/base` is level with `origin/main` at
`3c375b89` — branch from it and **verify the SHA**. `npm test` exits 0 on clean `main`; **the
known-failure set is EMPTY**.

**`CLAUDE.md`'s push-`preview` instruction is SUSPENDED for this branch.** The UI lane holds a
slice-scoped grant. This slice has no user-visible surface beyond an error response. Verify locally.

## The defect, and it is worse than #770's

`route.ts:19-22`:

```ts
const year = Number(yearParam);
if (!Number.isFinite(year) || year < 2000) { … 400 }
```

**A floor, no ceiling — and `Number()`, not an integer parse.** Measured:

| input | `Number()` | passes | cache key |
| --- | --- | --- | --- |
| `2026.5` | 2026.5 | yes | `"2026.5"` |
| `2026.0000001` | 2026.0000001 | yes | `"2026.0000001"` |
| `2e10` | 20000000000 | yes | `"20000000000"` |
| `0x7E0` | 2016 | yes | `"2016"` |
| `" 2026 "` | 2026 | yes | `"2026"` |

**#770's key space was 28 integers per league. This one is DENSE** — there are infinitely many
accepted values between any two years, so no enumeration bounds it. That is the finding #774's body
does not yet carry, and it is the reason this is not simply "#770 one route over."

**And the entries are far more permanent.** `getSeasonArchive` caches under
`['season-archive', leagueSlug, String(year)]` with **`revalidate: false`** — no time expiry —
tagged `[seasonArchiveSlugTag(leagueSlug), seasonArchiveYearTag(leagueSlug, year)]`. A genuinely
absent year caches `null`, and `seasonArchive.ts:104` confirms that is deliberate: *"Only genuine
emptiness is cacheable."*

**A LEAD, NOT A FINDING — re-derive it (receipt item 2).** The #770 lane reported in passing that
`invalidateSeasonArchive`'s only production writer is the season-rollover cron. If true, the slug tag
fires **once a season**, so within a season these entries are effectively permanent — where #770's
self-retire on every score write. **It was established while working a different route and has not
been verified. A single missed writer changes the conclusion.**

## The ceiling is NOT `currentYear + 1`, and this is the decision

The Insights bound accepts `currentYear + 1` because a league legitimately operates in a future season during
rollover. **An ARCHIVE of a future season cannot exist** — an archive is a record of a season that
finished. So #770's ceiling would admit at least one year that can never hold an archive, and
possibly more.

**Derive the right ceiling from what an archive can be**, and say which you chose:

- the league's **operating year** (`resolveLeagueOperatingYear`), or
- the newest year the league actually has (`getSeasonArchiveYears` / the `season-archive-years` key).

The second is tighter and may be circular — it is itself a cached read. **Say which, and why the one
you picked cannot reject a year the league genuinely holds.** That is the property #770's disjunct
bought, and it is the one that matters.

**Integers only.** Whatever the range, `Number.isInteger` is required — it is what collapses a dense
space to a countable one, and it is the larger half of this fix.

## Severity, stated correctly

**This is not an anonymous vector today.** Measured 2026-09-13: all three production leagues carry a
`passwordHash`, so `isAuthorizedForLeague`'s passwordless admit is satisfied by none of them and the
404 blend runs first. **The live vector is any league member holding the password cookie.** A
passwordless league remains a supported configuration the code deliberately admits, so this is worth
fixing — but do not write the closeout as though it were open to the internet, and correct #774's own
body if it implies that.

## Acceptance boundary

- A caller cannot mint an unbounded or dense set of cache entries.
- **A year the league genuinely holds is never rejected** — including the oldest archive (2018 for
  `tsc`) and the operating year.
- Rejected values return **400**, matching the route's existing plain-text error shape or #770's
  `{ error, field: 'year' }` — **pick one and say why**; the route currently returns plain text.
- The RSC page is covered or explicitly shown not to share the defect.
- No change to the archive WRITE path or to what a legitimate archive returns.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. **One complete run that itself exits 0**; a test that cannot execute in
  your environment is a coverage gap to report, not a pass. Report the DELTA measured at both ends.
- **Reproduce first, with a FRACTIONAL year** — that is the case an integer-only fix closes and a
  range-only fix does not. Confirm two distinct cache entries result.
- **Mutation-prove the bound can see a rejected year**, paired with a positive control proving the
  same fixture serves a legitimate one — including the league's oldest archive, not just the current
  year.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge, on the branch: `docs/prompt-registry.md` and the `docs/next-tasks.md` row, **keyed by the
issue link**. Record the ceiling with its derivation, the integer requirement, and the verified
answer on `invalidateSeasonArchive`'s writers. **`AGENTS.md` Season Launch invariant 4 names #774 as
the open shape and is owed an amendment at merge — that file is planning's; report the sentence.**

## STOP — read receipt before writing any code

1. **Reproduce with a fractional year.** Two requests, `?year=2026.5` and `?year=2026.6`, on a league
   you can reach. Confirm two distinct cache entries. **If it does not reproduce, say so.**
2. **Re-derive the tag lead.** Enumerate every production caller of `invalidateSeasonArchive`. If the
   rollover cron is genuinely the only one, say so with the search that supports it. **A count of one
   is a claim.**
3. **What is the widest year this league legitimately holds?** Give the actual values —
   `getSeasonArchiveYears` for each production league, and the operating year. Then say which makes
   the better ceiling and why the other does not.
4. **Does the RSC page share the parser, or have its own?** If its own, does it have the same holes?
5. **Is `season-archive-years` (the sibling cache key) reachable with a caller-supplied value**, or is
   it keyed by slug alone? If it is slug-only it is not in scope — confirm rather than assume.
6. **Enumerate every reader of the parsed year and CLASSIFY it** — key / tag / lookup / comparison
   bound / display. #770 found its worst consumer only because the list was classified rather than
   flat.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
