PROMPT_ID: PLATFORM-135-OPPONENT-COUNT-CLAUDE-v1
PURPOSE: Item 135 — "Show N more opponents" on Matchups understates, because the opponent summary counts sentinel labels rather than distinct opponents. Fix the count. Change nothing that renders.
SCOPE: `src/lib/selectors/matchups.ts`; its existing suite at `src/lib/__tests__/selectors-matchups.test.ts`; `src/components/MatchupsWeekPanel.tsx` and its tests. No shared scoreboard component, no other panel, no new dependency.

Read `AGENTS.md` first. Nothing in it is restated here.

## References — READ THESE BEFORE WRITING ANYTHING

- [`docs/next-tasks.md`](../next-tasks.md) → **Item 135**. Canonical; it wins over anything summarised
  below.
- [`docs/next-tasks.md`](../next-tasks.md) → **Item 117**, which retains this as a constraint on its
  own later rework. Read it so you do not do 117's job here.
- `src/lib/selectors/matchups.ts` — the whole file. It is short.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. No branch, no code, no tests until the owner replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. The two sentinel strings `deriveOpponentDescriptor` can return for an unowned opponent, with the
   line number of each `return`.
3. `MatchupsWeekPanel:194` — quote the condition, and say which of the two sentinels it suppresses
   and which it does not. Then say, in one line, why that asymmetry is CORRECT and must survive.
4. The line that renders the user-visible count, verbatim, with its line number.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing,
   say so explicitly.

A receipt that summarises without quoting is not a receipt.

## Branch and worktree

Work in **`/Users/zach/cfb-app-claude`** — see `CLAUDE.md` → **Worktrees and session roles**.
`git pull`, then branch from current `origin/main` as `claude/135-opponent-count`. Never commit to
`main`. A `pre-push` hook runs `npm run lint:all` and refuses a failing push; do not bypass it with
`--no-verify`.

<task>
`summarizeSlateOpponents` (`matchups.ts:51`) keys its count map on
`getSummaryOpponentLabel` (`:45`), which returns `deriveOpponentDescriptor`'s string. For unowned
opponents that string is one of two sentinels — `'FCS'` (`:39`) and `'NoClaim (FBS)'` (`:42`) — so
every unowned FBS opponent collapses into ONE entry and every FCS opponent into ONE entry.
`MatchupsWeekPanel:335` derives `hiddenCount` from `opponentSummaryEntries.length` and `:398` renders
`Show ${hiddenCount} more opponents`. Three unowned opponents therefore count as one.

Give the summary a key that distinguishes opponents — the opponent's team identity — so the count is
the number of distinct opponents.

**Re-key ONLY the two sentinel branches — settled 2026-09-05, after your receipt.** You were right
that `<task>` and `<completeness_contract>` pulled in opposite directions here, and the contract
governs. Owned opponents stay keyed on the opponent owner, `Self` on `'Self'`, placeholder/derived on
the participant `displayName`. Keying every branch on team identity would split an owner fielding two
teams against this owner in one week, and split two `Self` games — moving counts the contract says
must not move.

**SECOND, AND THIS IS NEW — make the control work.** Your receipt found that `isExpanded`
(`:332`) is read only at `:398` for the button's own label, while the list at `:378` is
`slate.games.map(...)` unsliced, so clicking hides nothing. That matters more than it first appears:
`hasHiddenOpponents` is `entries.length > DEFAULT_VISIBLE_OPPONENTS` (`:334`), so the sentinel
collapse currently suppresses the button entirely on many slates — and **correcting the count raises
the length, which would make a dead button appear on MORE slates.** Fixing the count alone makes the
surface worse. **Owner decision: fix both.**

**Collapsed means the first N OPPONENTS, not the first N games.** The label counts opponents while the
list renders games, so this is stated rather than left to you: when collapsed, render the games whose
opponent falls within the first `DEFAULT_VISIBLE_OPPONENTS` summary entries — they are in
first-appearance order. Slicing games instead would make the label lie in a new way.
</task>

<gate>
**The rendered descriptor does not change. This is the whole risk in this task.**

Both sentinels are CORRECT where they render, and the asymmetry between them is deliberate:

- `MatchupsWeekPanel:194` suppresses `'NoClaim (FBS)'` from the row's metadata — an unowned FBS
  opponent is not worth a badge.
- `'FCS'` is NOT suppressed and renders as a badge on purpose. An FBS team beating an FCS team means
  something different, which is why the marker exists at all.

So: change the COUNT's key, leave `deriveOpponentDescriptor`'s return values and every render path
alone. If you find yourself editing what a row displays, or "tidying" the sentinels away, stop — that
is the wrong task.

**Do not do Item 117's job.** 117 reworks Matchups onto the shared scoreboard and keeps its own
constraint about wiring `entry.label` into JSX. Do not wire labels into JSX here, do not touch the
shared component, and do not delete the dormant `formatSlateSummaryText` path — 117 decides that.

STOP and report if the opponent's team identity is not reachable from `OwnerSlateGame` without a new
data fetch or a widened payload.
</gate>

<completeness_contract>
- A test that FAILS on the current code: a slate with N distinct unowned FBS opponents must count N,
  not 1. Same for FCS. Show it red before the fix, green after — that is the whole point of this item,
  so a test that cannot demonstrate the bug is not evidence.
- **A test that the rendered descriptor is unchanged.** Assert the row output for an unowned FBS
  opponent and for an FCS opponent, before and after. Prove it by MUTATION: break the suppression at
  `:194` and show a SPECIFIC named test going red, then restore.
- Owned opponents, `Self`, and placeholder/derived participants keep counting exactly as they do
  today. Assert each; do not assume.
- **The control actually collapses.** A slate with more than `DEFAULT_VISIBLE_OPPONENTS` opponents
  renders fewer games collapsed than expanded, and every game returns when expanded. Prove by
  MUTATION that the assertion can fail — restore the unsliced list and show a SPECIFIC named test
  going red.
- **`Show N more opponents` equals the number of opponents actually withheld.** Assert the label
  against the hidden opponent count, not against a literal.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&` and never behind a pipe,
which reports the last command's status rather than the gate's:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation that proved the render is
unchanged; and anything you deliberately did not do.

State the counting behaviour in one line for each case — owned, self, unowned FBS, FCS,
placeholder — so a reviewer can check the contract without reading the diff.

Push the BRANCH ONLY, and push `preview` with it — you own the feature branch, so `preview` is yours
per `AGENTS.md` → **Preview branch**. Do not open a PR.
</output_contract>
