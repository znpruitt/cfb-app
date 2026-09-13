PROMPT_ID: PLATFORM-770-INSIGHTS-YEAR-BOUND-CLAUDE-v1
PURPOSE: An anonymous `?year=` on the Insights API has no upper bound and is echoed into the cache
key, so every distinct value is a guaranteed miss, a full league rebuild, and a new cache entry. This
is the amplifier #627 was filed for and explicitly did not close.
SCOPE: `src/app/api/insights/[slug]/route.ts`, `src/lib/insights/loadInsights.ts` if the cache
identity must change, and their suites. NOT the draft routes (admin-gated — see below), NOT
`bypassSuppression` (#627 shipped, #768 owns its existence), NOT the Insights page's own build
(#714), NOT the bypass path's sort tiebreak (#769).
CARRIES: **NONE from the Item 87 index — checked; no row is owned by #770 or the Insights API.** The
binding constraints are in the code and in `AGENTS.md` → Season Launch invariant 4, which I amended on
2026-09-13 to record exactly this gap:

> **What #627 did NOT close: an anonymous `?year=` is unbounded** (`n >= 2000`, no ceiling) and is
> echoed into the cache key, so it remains a guaranteed miss and a full rebuild per distinct value,
> with the guard never consulted — #770.

Issue: [#770](https://github.com/znpruitt/cfb-app/issues/770), found by the #627 lane during review
remediation and filed rather than folded in — bounding the parser changes behaviour for callers not
passing `bypassSuppression`, which #627's acceptance boundary forbade.

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** `claude/base` is now a resting pointer kept level
with `origin/main` — branch from it after fast-forwarding, and **verify the SHA**.
`npm test` exits 0 on clean `main`; **the known-failure set is EMPTY**.

**`CLAUDE.md`'s push-`preview` instruction is SUSPENDED for this branch.** The UI lane holds a
slice-scoped grant and `AGENTS.md:856` makes it conditional on one writer to the ref. This slice has
no user-visible surface. Verify locally; if you think you need `preview`, stop and ask.

## The defect

`parseYear` (`route.ts:14`):

```ts
const n = Number.parseInt(raw, 10);
return Number.isFinite(n) && n >= 2000 ? n : undefined;
```

**A floor and no ceiling.** `resolvedYear` then becomes cache identity verbatim —
`insightsCacheKeyParts(slug, resolvedYear)` (`loadInsights.ts:182`) emits `String(resolvedYear)` as a
key segment.

So `?year=987654321` is a guaranteed miss and a full `buildLeagueInsightContext`. **Anonymous, on any
passwordless league, with no `bypassSuppression` parameter — #627's guard is never consulted.**

**Two costs, and the second is the one that is easy to miss.** The rebuild was measured by the #627
lane at **~157 ms median** on a 900-game file-backed fixture (7 concurrent store/provider reads,
`getCanonicalStandings`, `loadArchives`, a full `buildScheduleFromApi`, 23 generators); on Neon those
are network round trips, so production is higher. And **each distinct value mints another
`unstable_cache` entry** — unbounded key cardinality from an anonymous caller, not merely wasted work.

## A class, not an instance — and its reachability differs

**There are EIGHT copies of `parseYear` in `src/app`, every one `n >= 2000` with no ceiling.** The
other seven are draft routes.

**Do not sweep them in on that pattern.** I checked one: `draft/[slug]/[year]/route.ts` POST calls
`requireAdminRequest(req)` as its **first executable statement**, and writes
`setAppState(draftScope(slug), String(year), draft)` at `:453` — so an unbounded year there mints a
**durable** key, but only for an admin. **That is a data-hygiene question with a different owner and a
different severity, and this slice does not fix it.** Whether the remaining six are gated the same way
is receipt item 3 — I did not check them, and you should not assume from one.

## The decision this item owns

**What is a valid year, and what does a rejected one do?** Neither is obvious and neither may be
invented.

- `league.year` and `context.archives` describe what a league actually has.
- A *future* year is meaningful during rollover — `resolveLeagueOperatingYear` exists for it.
- A far-future or far-past year is meaningful to nobody.

**And say what a rejected year returns.** Today a sub-2000 value yields `undefined` and falls back to
the resolved operating year — silent. An explicit `400` is more honest and is a behaviour change for
anonymous callers. **Pick one, state the argument, and note that this is precisely the kind of
unreviewed behaviour change #627 refused to make inside its own boundary.**

**Consider whether the cache key should be DERIVED rather than ECHOED.** Bounding the parser fixes
this instance; a key segment taken verbatim from a query parameter is the shape. If you bound the
parser only, say why the shape is acceptable.

## Acceptance boundary

- An anonymous caller cannot force an unbounded number of distinct cache keys or rebuilds.
- **A legitimate year still works** — including whatever rollover needs. A bound that breaks the
  operating-year path in preseason is worse than the defect.
- The rejected-year response shape is decided and stated, not left to fall out of the parser.
- **No change to `bypassSuppression` behaviour.** #627 shipped; do not re-open it.
- Draft routes untouched.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. Report the test DELTA, measured at both ends against `main`.
- **Reproduce first.** Two anonymous requests with two absurd distinct years must currently produce
  two rebuilds and two cache entries, and must not after. **A test that does not go red against
  `main` is not a regression test for this.**
- **Mutation-prove the bound can SEE a rejected year** — assert the specific rejection, not merely
  that the response is not a rebuild. Pair it with a positive control proving the SAME fixture
  accepts a legitimate year, or it passes for the wrong reason.
- Cover the rollover case explicitly: whatever `resolveLeagueOperatingYear` can return must pass.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge, on the branch: a `docs/prompt-registry.md` entry and the `docs/next-tasks.md` row, **keyed
by the issue link — new work gets no legacy item number.** Record the bound WITH its derivation, the
rejected-year shape as decided, and whether the echo-versus-derive question was closed or left open.
**`AGENTS.md` Season Launch invariant 4 names #770 as the open gap and is owed an amendment on merge —
that file is planning's; report the sentence rather than editing it.**

## STOP — read receipt before writing any code

1. **Reproduce it.** Two anonymous requests, two absurd distinct years, on a passwordless league.
   Report what each cost and confirm two distinct cache entries resulted. **If it does not reproduce,
   the issue is wrong and I need to know before you build.**
2. **What is the widest year the app can legitimately be asked for?** Derive it — `league.year`,
   `context.archives`, `resolveLeagueOperatingYear` during rollover. Give the actual values for a
   real league, not a range you find plausible.
3. **Are the other seven `parseYear` copies gated?** I checked exactly one (`draft/[slug]/[year]`
   POST, admin-gated, first statement). Enumerate the rest with their gate. **A count of "all
   admin-gated" is a claim** — show it per route.
4. **Does any anonymous path other than this one echo a caller-supplied value into a cache key?**
   `canonicalStandingsCacheKeyParts` is named in `loadInsights.ts`'s own comment as the mirror. If it
   has the same shape, say so — that changes this from an instance to a class with an anonymous
   reach.
5. **What breaks if a rejected year returns 400 instead of falling back?** Name the callers. The UI's
   `useInsightsFeed.ts` is one; say what it does with a 400 today.
6. **Is `unstable_cache` key cardinality bounded by anything** — eviction, TTL, a platform limit? If
   you cannot establish it, say so; the answer decides whether the second cost is real or theoretical,
   and I would rather have "unknown" than a guess.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
