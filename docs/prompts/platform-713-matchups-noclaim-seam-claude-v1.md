PROMPT_ID: PLATFORM-713-MATCHUPS-NOCLAIM-SEAM-CLAUDE-v1
PURPOSE: Matchups treats the internal `NoClaim` sentinel as a real league owner. Route its ownership
reads through the shared seam, so a game against an undrafted team stops reporting — and RENDERING —
as an owner matchup.
SCOPE: `src/lib/matchups.ts`, `src/lib/selectors/matchups.ts`, and their suites. NOT
`rosterEditing.ts`, NOT `gameOwnership.ts` itself, NOT Overview or Schedule (both already correct),
NOT the historical/archive surfaces AGENTS.md rule 11 records as a deferral.
CARRIES: `AGENTS.md` rule 11, **Centralized game ownership**, verbatim in the part that binds here:

> UI surfaces, routes, and selectors must not duplicate ownership-resolution logic or attribute
> ownership by raw provider-label equality.

> Known deferrals (do not document as fixed): … historical/archive ownership surfaces
> (`historySelectors`, `trends`, `leagueRecords`, and the Insights context/generators …) that still
> match by raw label.

**That deferral is the boundary of this slice.** Do not extend the fix into the historical surfaces;
do not record them as fixed.

Issue: [#713](https://github.com/znpruitt/cfb-app/issues/713).

---

## The issue understates it. The defect is member-visible, in two places.

#713 describes two booleans. Measured at `3fbd35fc`, those two booleans are **read nowhere in
`src/`** — `isOwnerVsOwner` and `isOpponentUnownedOrNonLeague` are declared at `matchups.ts:49-50`,
set at `:249-250` and `:264-265`, and no consumer outside that file references either. Verify that;
if it holds, correcting them is bookkeeping.

**The part that reaches a member is `opponentOwner`, on the same object, from the same
`bucket.homeOwner`:**

1. **`selectors/matchups.ts:45-48`** — `deriveOpponentDescriptor` returns
   `` `vs ${slateGame.opponentOwner}` `` whenever that string is truthy. `NoClaim` is truthy, so an
   undrafted opponent renders **"vs NoClaim"**.
2. **`matchups.ts:126` and `:138`** — the owner-summary `detail` is
   `` `${bucket.awayOwner} vs ${bucket.homeOwner}` ``, entered under
   `if (bucket.awayOwner && bucket.homeOwner)`. Both truthy includes both sentinel, so the line reads
   **"SomeOwner vs NoClaim"**.

## The root: Matchups is the surface that never adopted the seam

`displayOwner` (`gameOwnership.ts:23-25`) exists exactly for this — *"Hide the internal unowned-team
sentinel at member-facing render seams."* It is applied in `OverviewPanel.tsx:785,794,906,915` and
`GameWeekPanel.tsx:105-106`. **It is applied nowhere on the Matchups path.** Two of three surfaces
route through the shared seam; this one resolves ownership by raw truthiness, which is what rule 11
forbids.

So this is not four independent patches. It is one surface adopting a seam the others already use.

## Why it survived — and the precedent that names the test hazard

`buildConfirmedOwnersCsv` writes `NoClaim` as a real owner for every undrafted eligible team, so the
sentinel only appears **after a draft is confirmed**. Before confirmation an unowned team is absent
and reads `''`, which every one of these predicates handles correctly.

`rosterEditing.ts:30-36` already records this exact trap, in the docblock of its own `isUnowned`
helper:

> **TWO representations, and missing the second is the defect this closes.** … Found by the owner in
> one click on a confirmed league. **It survived the tests because the fixture represented unowned
> teams the FIRST way and the assertion generalised to both.**

**A fixture that represents an unowned team as `''` cannot reach this defect.** Every test you add
must use a confirmed-draft roster carrying `NoClaim`, and must fail if the fix is reverted. This is
the third item in this family — Item 135 corrected the opponent-count path and left this one, and its
own closeout recorded that all three call sites had encoded the duplication as intended behaviour.

---

## RULINGS ON THE READ RECEIPT — 2026-09-12, binding. THE PROMPT ABOVE IS SUBSTANTIALLY WRONG.

**Three claims refuted, all verified:**

1. **"`displayOwner` is applied nowhere on the Matchups path" is FALSE.** It is applied at
   `MatchupsWeekPanel.tsx:198`, `:199` and `:496`. **My grep was `head -8` and those lines are 11–14
   of the output** — the command truncated the evidence that refutes the claim. I wrote a ruling
   about this exact failure on #733 one item ago, then reproduced it.
2. **"vs NoClaim" never reaches a member.** `MatchupsWeekPanel:240-247` computes
   `opponentOwnedBySomeoneElse` on `opponentOwner != null && !== owner`, which includes the sentinel,
   and suppresses the descriptor. Computed and discarded.
3. **`matchups.ts:126,138` reach nobody.** `buildMatchupCardViewModel` has exactly one reference in
   `src/` — its own definition. The whole `MatchupCardViewModel` path is dead, and it was my headline
   defect.

Q4's premise was also broken: Matchups tests already construct `NoClaim` rosters.

**The live member-visible defect is the one you found and I never looked at:** `OwnerPanel.tsx:518`,
`opponentOwners.join(', ')` unfiltered, fed by `matchups.ts:424-430` via `ownerView.ts:345,372`. The
adjacent `'Unowned / non-league only'` fallback is the intent, stated in the code, unreachable today.

### Ruling 1 — FIX AT THE SOURCE. Scope expanded.

Stop `deriveWeekMatchupSections` writing the sentinel into `bucket.homeOwner`/`awayOwner`. Sixteen
reads become correct at once, and **a downstream compensation is itself evidence the model is wrong
upstream** — `selectors/overview.ts:463` filtering both-NoClaim games out of Featured exists only
because the buckets lie. Patching four readers keeps the lie and keeps the compensation.

**SCOPE now includes verifying the Overview consumers** (`overview.ts:91,192,316,388,397` and
`selectors/overview.ts:463`) — verifying, not redesigning. **Determine whether the Featured
compensation becomes dead. Remove it only if you can prove it dead with a mutation; if it survives
for an independent reason, say which.** Do not leave a filter that does nothing without a sentence
explaining why it stays.

### Ruling 2 — YES, add the `OwnerPanel` test. The SCOPE line was written from the wrong model.

`OwnerPanel.tsx` and `ownerView.ts` are in scope for **tests and any guard the source fix does not
reach**. If the source fix makes `opponentOwners` sentinel-free, they need no production change — but
the assertion that proves it belongs at the render, because that is where the defect is visible and
where its absence was never covered.

### Ruling 3 — your `CARRIES` reading is correct.

Rule 11's deferral names `historySelectors`, `trends`, `leagueRecords` and the Insights
context/generators. `ownerView.ts` and `OwnerPanel.tsx` are current-season member surfaces and are not
on that list. Reaching them is not extending into the deferral.

### Also fix, since the source change reaches it

Q5's self-matchup is a live wrong model behind one component filter: both sides undrafted produces
`finalSelf` and a `1W / 1L` accounting claim for a game no member owns, and empties `otherGames` so
`deriveExcludedGamesSummary` would claim every game appears on an owner card. The source fix should
close it — **assert that it does.**

Proceed to implementation.

## STOP — read receipt before writing any code

1. Confirm or break the claim that `isOwnerVsOwner` and `isOpponentUnownedOrNonLeague` have no reader
   in `src/` outside `matchups.ts`. A field-name grep under-reports — `OwnerSlateGame` reaches
   `MatchupsWeekPanel.tsx:158` whole, and `deriveOwnerOutcome` / `deriveOpponentDescriptor` take the
   entire object. Check what those do with it, not just whether they name the fields.
2. Enumerate **every** place Matchups reads an owner string: `bucket.homeOwner`, `bucket.awayOwner`,
   `slateGame.opponentOwner`, `slateGame.owner`. For each, say whether it feeds a rendered string, a
   boolean, a sort, or a grouping. **A sort or grouping that silently reorders is worse than a
   visible wrong label**, and the issue names neither.
3. `displayOwner` returns `null` for the sentinel. Is `null` the right substitute at each site, or
   does one of them need the non-owner BRANCH instead — the FCS/placeholder/conference path
   `deriveOpponentDescriptor` already has below its early return? Name which, per site.
4. Does any Matchups test today construct a roster with `NoClaim`? If none does, say so — that is the
   coverage gap, and it explains why three call sites shipped with this.
5. `SELF_DESCRIPTOR` fires on `opponentOwner === slateGame.owner`. What happens when both sides are
   undrafted and both read `NoClaim`? Trace it. Say whether the current code claims a member is
   playing themselves.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
