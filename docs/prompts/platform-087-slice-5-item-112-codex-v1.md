PROMPT_ID: PLATFORM-087-SLICE-5-ITEM-112-CODEX-v1
PURPOSE: Item 87 slice 5 + Item 112 — Schedule adopts the shared scoreboard row. The scoreboard always renders; only tier 2 sits behind a "More" affordance, which IS Item 112's disclosure model landing on Schedule first.
SCOPE: `src/components/GameWeekPanel.tsx` and its tests; `src/components/MatchupsWeekPanel.tsx` ONLY for the `ownerOutcomeRowClasses` asymmetry named below, plus its tests; selectors under `src/lib/selectors/` only where Schedule's row data requires it. NOT `CompactGameScoreboard.tsx` — see the gate. No new dependency.

Read `AGENTS.md` first, then `DESIGN.md` — it is canonical for UI and this is UI work. Neither is
restated here.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical. Where these and the task list below disagree, these win.**

- [`docs/campaigns/item-87-followon-matchups-schedule-design.md`](../campaigns/item-87-followon-matchups-schedule-design.md)
  → **§ Schedule — design decisions** (`:85` onward). This is the specification. Every subsection is
  binding: the no-collapse rule, broadcast as tier 1, conference in tier 2, the kickoff sort, and
  § *Eyebrow tags* (`:151`).
- [`docs/campaigns/item-87-followon-section-ordering.md`](../campaigns/item-87-followon-section-ordering.md)
  → `:63`. Its relative-label decision is **unbuilt and constrains this slice**.
- [`docs/campaigns/item-87-live-watchlist-scoreboard.md`](../campaigns/item-87-live-watchlist-scoreboard.md)
  — the scoreboard family's state model.
- [`docs/next-tasks.md`](../next-tasks.md) → run-order item 3. **Slice 5 has no open owner decisions**;
  the amber `upset` border question was settled 2026-09-05 and the entry records the reopen condition.
- [`mockups/matchups-schedule-mockup.html`](../../mockups/matchups-schedule-mockup.html) — the visual
  target. Open it. Do not infer layout from prose. Note it is **layout truth, not colour truth**:
  re-derive colour against the app surface, per `DESIGN.md`.

`DESIGN.md` already carries the settled scoreboard contract from slice 5a — the prefix marker rule,
broadcast state set, neutral-site placement, tier-2 non-reservation, and the component-local
`zinc-500` prohibition. Read it there rather than re-deriving any of it.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. No code and no tests until the owner replies; a branch checkout
is fine.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. From the design doc § *Sorted strictly by kickoff*: quote the paragraph beginning **"Open —"** and
   say in one line what it means for this slice. It is the one thing in the Schedule section that is
   NOT decided.
3. From § *Conference sits in tier 2*: quote the same-conference collapse rule and the one-sentence
   reason it needs a special case. Then state what the conference line must never contain.
4. `item-87-followon-section-ordering.md:63` — quote the relative-label rule and say how many relative
   labels ship.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If you find
   nothing, say so explicitly — but note that one subsection of the Schedule spec is explicitly
   **not part of this slice**.

A receipt that summarises without quoting, or that could have been written from the chat message
alone, is not a receipt. If two references disagree, say so rather than resolving it yourself.

## Branch

Work in `/Users/zach/cfb-app-codex`, on `platform/087-slice-5-item-112` branched from current
`origin/main`. **Creating the branch before the receipt is fine** — the gate blocks CODE, not a
checkout. (An earlier dispatch message and this prompt disagreed on that; the gate's intent is that no
implementation begins until the receipt is answered.) A `pre-push` hook runs `npm run lint:all` and refuses a failing push; do
not bypass it with `--no-verify`. Claude is concurrently in `/Users/zach/cfb-app-claude` on platform
work (`src/lib/schedule`, `src/lib/server`) — no component overlap.

<task>
Schedule adopts the shared scoreboard row, per the design doc § Schedule.

1. **The scoreboard is the row. Delete the one-line collapse.** Tier 1 — teams, owners, records,
   score, broadcast — always renders. Only tier 2 (venue, moneyline, conference) sits behind "More".
   That affordance IS Item 112's disclosure model; it lands here first.
2. **Delete `cardEmphasisClasses`** (`GameWeekPanel.tsx:39-50`). The amber `upset` border at `:42` is
   **deliberately retired** — owner decision 2026-09-05, not a side effect. The eyebrow pill carries
   the emphasis forward.
3. **Broadcast is tier 1**, in the status row beside kickoff, on **scheduled and live rows only**.
   Games with no listed broadcast omit it rather than rendering a placeholder.
4. **Conference in tier 2 on its own line**, not appended to the odds string.
5. **Sort strictly by kickoff ascending within each date group.** Live games are NOT floated.
   **Kickoff times render on scheduled and live rows ONLY — finals carry none.** Your receipt
   correctly found that the design doc and `DESIGN.md:208` conflicted here. **Owner ruling
   2026-09-05: `DESIGN.md` wins** — a kickoff time is a useful fact only while the game is in the
   future, and the "order looks arbitrary" objection does not survive, because the rows are still
   sorted by kickoff so for finals the ORDER ITSELF carries the relative timing. The design doc has
   been corrected; re-read § *Sorted strictly by kickoff*.
6. **Carry the `ownerOutcomeRowClasses` sibling asymmetry into `MatchupsWeekPanel`**
   (`MatchupsWeekPanel.tsx:99`, consumed at `:165`).
7. **Eyebrows render as bronze pills**, uniformly — no per-class variation. Values and the reasoning
   are in the design doc § *Eyebrow tags*.
</task>

<gate>
**Do NOT widen `CompactGameScoreboard`.** Slice 5a settled that contract under its own review, and
slice 5b owns the next widening (the card-owner row modifier). If Schedule needs something the
component does not expose, STOP and report it — that is a finding about the contract, and it is the
owner's call whether it belongs in 5b. Reaching into the component here defeats the reason 5a was
split out.

**The status filter is NOT in this slice.** The design doc says so itself: *"This is additive
functionality, not part of the transition proper, and should be scoped as such."* It is **Item 118**.
Do not build the filter, the counts, the chips, or the empty-group hiding.

**Do not resolve the open landing-position question.** The design doc leaves it open deliberately;
ascending order means a mid-Saturday visit opens on morning finals. Report what your change does to
landing position and leave it as-is. It is a scroll-position question, not a sort question.

**Do not remove tier-2 content.** Expansion may not survive long-term, but the doc is explicit:
*"removing information that exists today should be a decision, not a side effect."*

STOP and report if the conference data does not distinguish an FCS *classification* from an actual
conference — the doc flags that as worth checking, and a classification leaking into the conference
line is a data finding, not something to paper over in presentation.
</gate>

<completeness_contract>
- **Every deleted behaviour is deliberate and tested.** `cardEmphasisClasses` deletion in particular:
  assert no amber border renders for an `upset` card, and prove by MUTATION that the assertion can
  fail — restore the class and show a SPECIFIC named test going red.
- **Broadcast state coverage:** renders on scheduled and live, absent on final, absent when no
  broadcast is listed. Four cases, four assertions.
- **Finals carry no kickoff time** (task item 5) is asserted directly, and proven by MUTATION —
  render a time on a final and show a SPECIFIC named test going red, then restore. This reverses what
  an earlier draft of the design doc said, so it is exactly the rule a future reader is most likely to
  undo by accident.
- **The sort is asserted as a property, not by example:** for a date group with mixed states, every
  row's kickoff is >= its predecessor's, finals included.
- **Same-conference collapse** is asserted in both forms — "ACC matchup" for a same-conference game,
  "X vs Y" for a cross-conference one.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&` and never behind a pipe,
which reports the last command's status rather than the gate's:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; which mutation proved the `cardEmphasisClasses`
deletion; what your change does to landing position; and anything you deliberately did not do.

**Also report any `dark:text-zinc-500` you touched or left in `GameWeekPanel.tsx`** — it has 2, and
Item 133b assigns them to whichever slice owns the file. Fixing them here is in scope; leaving them is
acceptable if you say so.

Push the BRANCH ONLY. **Do NOT push `preview` or any preview branch.** An earlier version of this
prompt said the opposite; that was an error and `AGENTS.md` → **Preview branch** governs — `preview`
belongs to Claude alone. The 2026-09-05 amendment narrowed WHICH Claude session owns it (the one
holding the feature branch); it did not extend it to Codex. Do not open a PR.

The Codex worktree's dev server is port **3010**, not 3000.
</output_contract>
