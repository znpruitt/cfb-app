PROMPT_ID: PLATFORM-087-SLICE-5B-CARD-OWNER-ROW-CODEX-v1
PURPOSE: Item 87 slice 5b — add a card-owner row modifier to the shared `CompactGameScoreboard` so Item 117 can adopt the component without also widening it. The field ships with ZERO consumers.
SCOPE: `src/components/CompactGameScoreboard.tsx` and `src/components/__tests__/CompactGameScoreboard.test.tsx`. Nothing else. Not `MatchupsWeekPanel.tsx`, not `OverviewPanel.tsx`, not `GameWeekPanel.tsx`, no selector, no new dependency.

Read `AGENTS.md` first, then `DESIGN.md` — canonical for UI, and it already carries the scoreboard
contract slice 5a settled. Neither is restated here.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical, and they win over anything summarised below.**

- [`docs/campaigns/item-87-followon-team-highlight.md`](../campaigns/item-87-followon-team-highlight.md)
  — the whole document. It is short, and it settles the treatment, the two rejected alternatives, the
  two stacking bugs, and the residual. **Where it and this prompt disagree, it wins.**
- [`mockups/matchups-schedule-mockup.html`](../../mockups/matchups-schedule-mockup.html) — `:64-71`
  is the tint. **Layout truth, not colour truth** — re-derive colour against the app surface.
- [`docs/next-tasks.md`](../next-tasks.md) → run-order item 3, **Item 87 slice 5b**, including the
  rejected wrapper-class alternative and the 2026-09-05 correction about caller count.
- `src/components/CompactGameScoreboard.tsx` — the component as it stands after slice 5.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. A branch checkout is fine; no code, no tests, until the owner
replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. From the team-highlight doc: quote the paragraph about `DESIGN.md:321` and the Standings
   exception, then say in one line what test it establishes and why a Matchups row tint fails it.
3. The doc records **two stacking bugs**. Name both, and say why ONE fix closes both.
4. **How many components call `CompactGameScoreboard` today?** Name them. Then say how many will set
   the field this slice adds. Do not answer from the queue entry — check.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing,
   say so explicitly — but note that one thing this slice is usually described as doing, it does not.

A receipt that summarises without quoting, or that could have been written from a chat message, is not
a receipt. If two references disagree, say so rather than resolving it yourself.

## Branch

`platform/087-slice-5b-card-owner-row`, branched from current `origin/main`, in
`/Users/zach/cfb-app-codex`. A `pre-push` hook runs `npm run lint:all` and refuses a failing push; do
not bypass it with `--no-verify`. Claude is concurrently in `/Users/zach/cfb-app-claude` on
`src/lib/schedule` and `src/lib/server` — no component overlap.

<task>
Add a per-participant flag marking the row as belonging to the card's owner, and render a neutral
background tint on that row.

1. **The flag is on the participant**, beside `owner`, `rank`, `classification`, `record`, `score`.
   A caller cannot reach a participant row otherwise — the component renders them internally, which
   is the reason this slice exists.

   **A boolean, NOT the card's owner for the component to compare — and this is deliberate.**
   The obvious alternative is passing the card owner once and letting the component match it against
   `participant.owner`. Rejected: `AGENTS.md` rule 11 (**Centralized game ownership**) puts ownership
   judgement behind one seam, and `displayOwner` (`src/lib/gameOwnership.ts:24`) is that seam — it
   returns `null` for the `NoClaim` sentinel. A component comparing owner strings itself would
   re-derive ownership and could repeat **Item 138** exactly: `isOwnerVsOwner` reads `NoClaim` as a
   real owner because it tests `!opponentOwner` rather than going through the seam, so a game against
   nobody reports owner-versus-owner. **The caller decides ownership; the component renders what it
   is told.** Expect a reviewer to ask why not compare internally — this paragraph is the answer.

2. **Both rows tint when the card owner holds both teams — owner decision 2026-09-05.** The 2026
   season has **39 games** where one owner holds both sides, so this is production's shape, not an
   edge case. The rule stays simple with no special case, and the card still reads as distinct from
   its neighbours. Do not suppress the tint when both participants carry the flag, and cover it with
   a fixture.
3. **The tint is a background, never text weight.** Weight already carries winner/loser on final
   rows; emphasising by weight would render a losing team of theirs bold-and-dimmed — two signals
   arguing on one row.
4. **Neutral, not owner colour.** The mockup's `rgba(255,255,255,0.055)` composites to `#171717` on
   the app surface. Verified: `zinc-50` reads 17.18:1 over it, `zinc-100` 16.31:1, and `zinc-400` —
   the worst case, carrying losing team names and every record/owner suffix — reads **7.00:1**. All
   clear 4.5:1, so the tint costs no legibility. Re-derive rather than trusting these.
5. **The mechanism, from the mockup (`:64-71`):** `position: relative` and `isolation: isolate` on the
   row, plus an `::after` at `inset: -1px -8px`, `border-radius: 4px`, `pointer-events: none`,
   `z-index: -1`.
</task>

<gate>
**This field has ZERO consumers and must not gain one here.** `CompactGameScoreboard` is called by
`OverviewPanel` and `GameWeekPanel` — that is all, today. `MatchupsWeekPanel` is not on the shared
component; **Item 117 is what puts it there, and Item 117 is the consumer.** Do not touch any caller,
and do not "prove it works" by wiring one up. Its absence of consumers is the point: 117 then adopts
the component without also widening it.

**Every currently-rendered row must be untouched.** No caller sets the flag, so Overview and Schedule
must render byte-identically. `position: relative` and `isolation: isolate` are safe here — the
component contains **no absolutely-positioned element today** (verified) — but that is a fact to
re-confirm, not to assume.

**Do NOT implement the owner-colour variant.** The mockup keeps it behind a toggle for comparison
only; the doc rejects it, and `DESIGN.md:283` reserves owner colour for lists acting as a chart
legend. Do not implement dimming either — that alternative is explicitly superseded.

**Do NOT try to highlight the VIEWING MEMBER's teams.** There is no mapping from a signed-in identity
to a league owner, which is why this is card-owner-scoped. The doc files that as blocked on the
multi-tenant user↔owner linkage.

STOP and report if the tint cannot be rendered without changing the row's layout or box size, or if
`isolation: isolate` changes anything currently rendered.
</gate>

<completeness_contract>
- **Overview and Schedule render byte-identically. Prove it by MUTATION** — force the flag on for all
  participants and show a SPECIFIC named test going red, then restore.
- The tint renders when the flag is set and is absent when it is unset, absent, or false.
- **Contrast is asserted, not assumed:** a test pins the tint token, and the reasoning that
  `zinc-400` over the composited surface still clears 4.5:1 is recorded at the code site.
- **The stacking fix is pinned with its reason.** `isolation: isolate` is not decoration — without it
  a `z-index: -1` pseudo-element paints behind the whole card, and the tint vanishes. Assert it is
  present and comment WHY, or the next refactor removes it as redundant.
- **Item 119 note at the code site:** the team-colour bar will be absolutely positioned against this
  row. `isolation` is what lets that coexist with the tint; making row children `position: relative`
  instead would re-anchor the bar and shift it on every highlighted row.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe,
which reports the last command's status rather than the gate's:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against. Report your measured test delta.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation that proved existing rows are
unchanged; and anything you deliberately did not do.

Closeout is a separate pre-merge commit after review convergence — `DESIGN.md` gains the row modifier
in the scoreboard contract, and `docs/next-tasks.md` takes the slice status. Record what SHIPPED.

Push the BRANCH ONLY. **Do not push `preview`** — `AGENTS.md` → **Preview branch** reserves it for
Claude, and the 2026-09-05 amendment narrowed which Claude session owns it rather than extending it
to Codex. Do not open a PR.

The Codex worktree's dev server is port **3010**, not 3000.
</output_contract>
