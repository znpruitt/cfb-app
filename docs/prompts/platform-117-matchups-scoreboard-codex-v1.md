PROMPT_ID: PLATFORM-117-MATCHUPS-SCOREBOARD-CODEX-v1
PURPOSE: Item 117 — Matchups adopts the shared `CompactGameScoreboard`. This is the first consumer of the card-owner treatment slice 5b shipped, and it carries two live defects: a row that never says which team belongs to which owner, and eyebrow tags that violate `DESIGN.md:148`.
SCOPE: `src/components/MatchupsWeekPanel.tsx` and its tests. `CompactGameScoreboard.tsx` is NOT to be widened — it already has every prop this needs. No selector change, no data-layer change, no records work.

Read `AGENTS.md` first, then **`DESIGN.md` — canonical for UI, and this slice corrects a live violation of it.** Neither is restated here.

## Why this is not a restyle

Two defects ship today and both are corrections, not preferences.

1. **The row never says which team belongs to which owner.** `MatchupsWeekPanel`'s bespoke `GameRow`
   (`:136`) renders `Colorado @ Georgia Tech` above `vs BHooper`. A reader cannot tell which of those
   two teams the card owner holds. This is the same owner→team mapping defect the Overview redesign
   fixed, and it is the reason the shared component exists.
2. **The eyebrow tags are filled BLUE pills** (`MatchupsWeekPanel.tsx:267`):
   `border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30
   dark:text-blue-200`. **`DESIGN.md:148` reserves blue for interactivity or active state and states
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

- **`DESIGN.md`** — canonical. `:148` for the blue rule; the record rule and the anchor rule apply as
  written.
- **`docs/campaigns/item-87-followon-team-highlight.md`** — canonical for the card-owner treatment.
- **`docs/campaigns/item-87-followon-matchups-schedule-design.md`** → _Matchups — design decisions_,
  and `mockups/matchups-schedule-mockup.html` (`:73-76` for the tag treatment).
  **TREAT THIS DOCUMENT AS INPUT, NOT AS CANONICAL.** Three of its claims have now been found stale;
  it predates the slice 5a/5b rulings. Where it disagrees with `DESIGN.md` or the team-highlight doc,
  they win. **Report every stale claim you find** — that list is the closeout's job, and this is the
  fourth time.
- `src/components/CompactGameScoreboard.tsx` — the full prop surface, including `contextSlot` /
  `footerSlot`, `state`, `matchupLabel`, `rank`/`rankSource`, `record`, `broadcast`.
- `src/components/GameWeekPanel.tsx` — Schedule's conversion, the working precedent. Read how it
  passes participants and slots before inventing anything.
- [`docs/next-tasks.md`](../next-tasks.md) → **Item 117**.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote `DESIGN.md:148`.** Then quote the current tag classes at `MatchupsWeekPanel.tsx:267` and
   state the settled replacement exactly — border, text colour, and fill.
3. `CompactGameScoreboard` takes `away` and `home` participants. **Name every field on
   `CompactScoreboardParticipant`**, and say which one this slice is the first production caller of.
4. **`GameRow` (`:136`) renders things the shared component does not take as a scalar prop** — the
   status pill, the live indicator, the tag row, the odds. Say which of `contextSlot` / `footerSlot`
   each belongs in, and name anything that fits neither. **Anything that fits neither is a finding,
   not a licence to widen the component.**
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
inline with no collapse and the odds footer on**.

1. **Mark the card owner's participants.** Each Matchups card belongs to an owner; set
   `isCardOwnerTeam` on whichever participants that owner holds. Both, when they hold both.
2. **Fix the owner→team mapping.** The row must make it unambiguous which team is the card owner's.
   That is the defect, and the tint alone is the fix only if it is legible without the `vs` line.
3. **Convert the eyebrow tags to bronze**, hairline border, no fill:
   `border: 0.5px solid rgba(201,166,107,0.40)`, text `#dbc190`. Tags right-align in the status row
   with `flex-wrap: nowrap`, so a tagged card gains no line.
4. **Keep every fact the shipped row shows.** Rank, record, owner, score, status, broadcast, odds,
   tags. A conversion that silently drops a fact is a regression.
</task>

<gate>
**Do NOT widen `CompactGameScoreboard`.** It has the props this needs. If it genuinely does not,
STOP and report — slice 5a and 5b each widened it once under review, and a third widening driven by
one consumer is how a shared component becomes a union of its callers.

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
- **Every fact the old row rendered still renders.** Enumerate them in the test, do not spot-check.
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
