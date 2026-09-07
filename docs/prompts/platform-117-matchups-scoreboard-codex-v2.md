PROMPT_ID: PLATFORM-117-MATCHUPS-SCOREBOARD-CODEX-v2
PURPOSE: Item 117 — Matchups adopts the shared `CompactGameScoreboard`. This is the first consumer of the card-owner treatment slice 5b shipped, and it carries two live defects: a row that never says which team belongs to which owner, and eyebrow tags that violate `DESIGN.md:147`.
SCOPE: `src/components/MatchupsWeekPanel.tsx` and its tests. `CompactGameScoreboard.tsx` is NOT to be widened. **NARROWED to the correctness work by owner decision 2026-09-07 — the four presentation divergences your v1 receipt found are now Item 143.** No selector change, no data-layer change, no records work.

Read `AGENTS.md` first, then **`DESIGN.md` — canonical for UI, and this slice corrects a live violation of it.** Neither is restated here.

## v2 — YOUR RECEIPT NARROWED THIS. Read the split before anything else.

**Your v1 receipt was right on every count and the scope changed because of it.** Four contested
items are OUT of this slice and are now **Item 143**, to be decided against the component's real
seams rather than re-derived:

| now Item 143, NOT yours | the seam finding you made, verified |
| --- | --- |
| eyebrow tags inside the status row | `contextSlot` renders above the header (`:121`) — tags there add a line |
| odds on live/final | `footerSlot` is gated `state === 'scheduled'` (`:243`) |
| the `SCH`/`LIVE`/`FINAL` status pill | component-owned `statusLabel`, no injection seam |
| the freshness-gated live indicator | component's is hardcoded |

**Why the split, and it is not "smaller scope":** card-owner marking and the bronze tag COLOUR need
no new seam, so they cannot be blocked by the seam question. Bundling them would make a defect
members see today wait on a design decision that first needs a corrected document.

**Two corrections to v1, both yours:**

1. **`DESIGN.md:147`, not `:148`.** My citation was off by one.
2. **v1 told you to preserve records, broadcast and odds as "facts the shipped row shows".
   `GameRow` renders NONE of the three** — odds only feed `computeGameTags`. That instruction
   contradicted this prompt's own gate against adding records, and followed literally would have
   produced the thing it bans. **Preserve what `GameRow` ACTUALLY renders; verify by reading it, not
   by trusting this prompt's list.**

**The design document is a BAD SOURCE and is being repaired separately (Item 144).** You found ten
stale claims in it; the count is not in dispute. **Interim authority, owner ruling 2026-09-07: the
mockup is authoritative for LAYOUT AND STRUCTURE, this prompt and `DESIGN.md` are authoritative for
VALUES.** Do not read a colour off the mockup or a layout off the prose. The `#c9a66b` override you
found has been fixed at source; the other contradictions you named have not, so treat the file
accordingly.

**Two live defects you found are filed and are NOT yours:** kickoff metadata on non-scheduled rows is
**Item 142**; the design-doc reconciliation is **Item 144**.

## Why this is not a restyle

Two defects ship today and both are corrections, not preferences.

1. **The row never says which team belongs to which owner.** `MatchupsWeekPanel`'s bespoke `GameRow`
   (`:136`) renders `Colorado @ Georgia Tech` above `vs BHooper`. A reader cannot tell which of those
   two teams the card owner holds. This is the same owner→team mapping defect the Overview redesign
   fixed, and it is the reason the shared component exists.
2. **The eyebrow tags are filled BLUE pills** (`MatchupsWeekPanel.tsx:267`):
   `border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30
   dark:text-blue-200`. **`DESIGN.md:147` reserves blue for interactivity or active state and states
   plainly: never use blue to mean "featured" or "important".** `UPSET` and `TOP 25` are exactly an
   importance signal. **This is a correction to shipped, not a taste call — do not re-argue it.**

## You are the FIRST consumer of the card-owner prop

Verified 2026-09-07: `isCardOwnerTeam` (`CompactGameScoreboard.tsx:11`) has **no production consumer**
— the only references outside the component are in its own test file. Slice 5b built the seam; this
item supplies the consumer.

**The caller marks participants; the component does not re-derive ownership.** Pass
`isCardOwnerTeam` per participant and let the component render the neutral tint. When the card owner
holds both teams, both rows tint and the corners square between them —
`bothParticipantsBelongToCardOwner` (`:99`) already handles that. **Dimming and owner colour were
rejected.** Do not add either.

## References — READ THESE BEFORE WRITING ANYTHING

- **`DESIGN.md`** — canonical. `:147` for the blue rule; the record rule and the anchor rule apply as
  written.
- **`docs/campaigns/item-87-followon-team-highlight.md`** — canonical for the card-owner treatment.
- **`docs/campaigns/item-87-followon-matchups-schedule-design.md`** → _Matchups — design decisions_,
  and `mockups/matchups-schedule-mockup.html` (`:73-76` for the tag treatment).
  **TREAT THIS DOCUMENT AS A BAD SOURCE.** You found **ten** stale claims in it; they are recorded on
  **Item 144**, which repairs it. **Interim authority: the MOCKUP is authoritative for LAYOUT AND
  STRUCTURE; `DESIGN.md` and this prompt are authoritative for VALUES.** Do not read a colour off the
  mockup or a layout off the prose. You need this document for almost nothing in v2 — the scope that
  depended on it moved to Item 143.
- `src/components/CompactGameScoreboard.tsx` — the full prop surface, including `contextSlot` /
  `footerSlot`, `state`, `matchupLabel`, `rank`/`rankSource`, `record`, `broadcast`.
- `src/components/GameWeekPanel.tsx` — Schedule's conversion, the working precedent. Read how it
  passes participants and slots before inventing anything.
- [`docs/next-tasks.md`](../next-tasks.md) → **Item 117**.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote `DESIGN.md:147`.** Then quote the current tag classes at `MatchupsWeekPanel.tsx:267` and
   state the settled replacement exactly — border, text colour, and fill.
3. `CompactGameScoreboard` takes `away` and `home` participants. **Name every field on
   `CompactScoreboardParticipant`**, and say which one this slice is the first production caller of.
4. **Enumerate what `GameRow` (`:136`) ACTUALLY renders, from the code.** Not from this prompt — v1's
   list was wrong. For each, say whether it survives the conversion, moves to a slot, or belongs to
   Item 143. **Anything needing a new seam is Item 143 by construction, not a finding to re-report.**
5. `ownerOutcomeRowClasses` (`:96`) exists on this file today. Say what it does, whether it survives
   the conversion, and how it relates to the card-owner tint — **they are not the same thing.**
6. Anything in the references that CONTRADICTS or narrows what you were handed. If nothing, say so
   explicitly — but the Matchups design doc has a known stale section, so "nothing" is unlikely.

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/117-matchups-scoreboard` from current `origin/main`, in `/Users/zach/cfb-app-codex`. Never
commit to `main`. A `pre-push` hook runs `npm run lint:all`. The Claude lane is on
`src/lib/server/` and the cron routes — no overlap.

<task>
Replace `MatchupsWeekPanel`'s bespoke `GameRow` with `CompactGameScoreboard`, rendered **expanded
inline with no collapse**. Whether the odds footer carries content in every state is **Item 143** —
use the component's existing behaviour and do not change it.

1. **Mark the card owner's participants.** Each Matchups card belongs to an owner; set
   `isCardOwnerTeam` on whichever participants that owner holds. Both, when they hold both.
2. **Fix the owner→team mapping.** The row must make it unambiguous which team is the card owner's.
   That is the defect, and the tint alone is the fix only if it is legible without the `vs` line.
3. **Convert the eyebrow tags to bronze**, hairline border, no fill:
   `border: 0.5px solid rgba(201,166,107,0.40)`, text `#dbc190`. **COLOUR ONLY. Their PLACEMENT is
   Item 143** — leave them where they render today rather than moving them into the status row.
4. **Keep every fact `GameRow` ACTUALLY renders.** Read it and enumerate them; do not work from a
   list in this prompt. A conversion that silently drops a fact is a regression, and one that ADDS a
   fact is out of scope.
5. **`ownerOutcomeRowClasses` survives as wrapper-level behaviour**, as your receipt said. It is not
   the card-owner tint: the outcome rail says how the owner's game is going, the tint says which team
   is theirs. Both, not either.
</task>

<gate>
**Do NOT widen `CompactGameScoreboard`. This is now absolute, not a stop-and-report** — you already
made that report and it produced Item 143. If something needs a seam, it belongs to 143 by
construction. Slice 5a and 5b each widened it once; a third and fourth driven by one consumer is how
a shared component becomes the union of its callers.

**Do NOT move the eyebrow tags into the status row.** Colour only. Placement is Item 143.

**Do NOT add records to Matchups beyond what the component already renders**, and do not wait on
Item 139. Records reach this surface the same way they reached Schedule: separately.

**Do NOT re-derive ownership inside the component.** The caller marks; the component renders.

**Do NOT reintroduce dimming or owner colour.** Both rejected on the record.

**Do NOT touch `src/lib/`.** This is a component slice.

STOP and report if a fact the shipped row displays has nowhere to go, or if the Matchups design doc
contradicts `DESIGN.md` on anything beyond the known-stale card-owner section.
</gate>

<completeness_contract>
- **The owner→team mapping is asserted directly** — a test that fails if the card cannot distinguish
  which participant belongs to the card owner. This is the defect; assert it, do not infer it from
  class names.
- **Both-teams-owned squares the inner corners**, single-team-owned rounds all four. Assert both.
- **No blue remains on the tags.** Assert against the rendered element, and assert the bronze values.
  A test keyed on a label rather than the element is vacuous — that failure has shipped here before.
- **Every fact the old row rendered still renders — enumerated from the CODE**, not from this
  prompt's list. Do not spot-check, and do not add one.
- **The outcome rail and the card-owner tint coexist** and are distinguishable. They are different
  facts about the same row.
- **`CompactGameScoreboard`'s prop surface is unchanged.** Assert it, so a later widening is a
  deliberate act rather than a drift.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the owner→team
assertion is real; every stale claim found in the Matchups design doc; and anything you deliberately
did not do.

**Say plainly what a member sees that they did not see before** — this is the first user-visible
change in this campaign since slice 5b, and the report should read as a product change, not a
refactor.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 117 status,
and **correcting the stale claims in the Matchups design doc rather than only listing them.**

Push branch and `preview` together. Merge is delegated to this lane under `CLAUDE.md` →
**Worktrees and session roles**, including the four conditions. Promotion is not.
</output_contract>
