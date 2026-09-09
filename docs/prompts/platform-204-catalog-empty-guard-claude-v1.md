PROMPT_ID: PLATFORM-204-CATALOG-EMPTY-GUARD-CLAUDE-v1
PURPOSE: Item 204 — the admin team-database refresh commits an empty upstream body unconditionally, and neither the prior-good path nor the seed catalog rescues it. Guard it before the Item 199 resync click makes it reachable.
SCOPE: `src/app/api/admin/team-database/route.ts`, `src/lib/teamDatabase.ts` if the guard belongs at the builder, `src/lib/server/teamDatabaseStore.ts` if the read-side hole is closed here, and tests. NOT the seed script (Item 201). NOT `teamColors.ts`. NOT a stored-field rename.
CARRIES: NONE, having checked `item-87-INDEX.md` — this is an audit-spine item, not an Item 87 item.

Read `AGENTS.md` first. **Core rules 1** is the rule this item exists to extend; nothing about it is
restated here.

## The defect, traced end to end by planning before filing

`route.ts:38` does `records: Array.isArray(rows) ? rows : []` and then commits unconditionally. **A CFBD
200 carrying a non-array body, or a genuine `[]`, replaces the 138-row catalog with an empty one.**

**Two things look like guards and are not. Verify both before you design anything.**

1. **`previousItems` is not retention.** `buildTeamDatabaseFile` uses it only to compute `updatedCount`
   (`teamDatabase.ts:270-273`). It never contributes an item. With `records: []` the built file is
   `items: []`.
2. **The seed catalog is not a safety net here.** `teamDatabaseStore.ts:112` is
   `toTeamDatabaseFile(record?.value) ?? (await readSourceCatalogFallback())`, and `toTeamDatabaseFile`
   returns null only when `items` is **not an array** (`:75`). An empty array returns a valid file.
   **`??` does not fire on `[]`.** The row is present-but-empty, not absent, so the fallback is
   unreachable.

**This campaign has shipped this exact defect before and fixed it — PLATFORM-128.** If your fix leaves a
second `??`-over-a-possibly-empty-array anywhere on this path, it is the same bug in a new place.

## The second hole at the same boundary

`teamDatabaseStore.ts:68` reads `toNullableString(value.altColor)` where `value` is an untyped
`Record<string, unknown>`. **A stored field rename type-checks the object KEY and leaves the READ
silent** — 138 durable rows would return `undefined` with a green build. The Item 199 lane found this
while proving the stored name must not move.

**Decide whether it belongs in this slice and say why either way.** It is the same boundary and the same
class — the durable catalog is unvalidated in both directions — but it is a different failure, and
folding an unrelated hardening into a guard slice is how a two-line fix becomes a reconstruction. **A
reasoned "no, filed separately" is a complete answer.**

## What the guard must decide, and it is not obvious

**An empty response and a non-array response are not the same event.** One is a provider saying "no
teams", which for `/teams/fbs` mid-season is almost certainly wrong but is syntactically valid. The
other is a shape violation. **Say whether you treat them identically and why.**

**And a PARTIAL response is the harder case.** 138 today; if CFBD returns 4, no guard keyed on
`length === 0` fires, and the catalog loses 134 teams. **State what your guard does at 4, at 100, and at
138**, and if the answer is "nothing at 4", say so as a deliberate boundary rather than leaving it
undiscovered. Do not invent a percentage threshold without saying what it costs when FBS membership
legitimately changes.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Confirm or refute both "looks like a guard" claims by reading the code**, quoting the lines. If
   either is wrong, that is the finding and the design changes.
3. **What does the operator see today when the sync writes an empty catalog?** Quote the summary fields
   and say whether any of them would tell the owner something just went wrong. A guard that refuses
   silently is a different defect.
4. **Enumerate every reader of the durable catalog** that would be affected by an empty one — identity,
   classification, aliases, standings, anything else. **This is the blast radius and nobody has written
   it down.** Say which of them degrade gracefully and which produce wrong output rather than no output.
5. **Does any OTHER dataset's guard already solve this shape?** `AGENTS.md` → Core rules 1 names
   schedule, rankings and game-stats. **Read one of them and say whether its pattern transfers**, or why
   the catalog needs something different. Reusing a proven shape beats inventing a fourth.
6. Anything that CONTRADICTS what you were handed. The two guard claims, the `??` behaviour and the
   PLATFORM-128 precedent are all mine and all checkable.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/204-catalog-empty-guard` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`.

**Do NOT push `preview`.** Codex holds it for Item 119.

<task>
1. **Reject an empty or non-array upstream body before committing**, retaining prior-good.
2. **Surface the refusal in the operator summary** — the owner is going to click this button expecting
   `With alternate color: 0 → 138`, and a silent no-op is indistinguishable from a silent wipe.
3. **Close the read-side `??` hole if and only if you have argued it belongs here.**
</task>

<gate>
**Do NOT touch the seed script or `src/data/teams.json`** — Item 201, and it needs a 138-row
regeneration this slice must not carry.

**Do NOT rename the stored field.** The Item 199 lane proved by mutation that it reaches 8 files and
that the compiler sees only half of it.

**Do NOT change what a successful sync writes.** This slice changes only what an UNSUCCESSFUL one does.

STOP and report if the guard cannot be expressed without a magnitude threshold — that is a decision
about how much of the catalog may vanish silently, and it is the owner's.
</gate>

<completeness_contract>
- **An empty upstream body leaves the durable catalog at 138**, asserted against the stored row, not
  against a return value.
- **A non-array body does the same**, asserted separately — one test covering both proves neither.
- **A successful sync still replaces the catalog**, asserted by mutation: break the guard so it rejects
  everything, and show a named test go red. **A guard that rejects all input passes every negative
  test.**
- **The refusal is visible to the operator**, asserted against the summary the panel renders.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving a successful sync still
writes; the blast-radius enumeration from receipt item 4; and anything you deliberately did not do.

**Say plainly whether the resync click is now safe**, and what the owner should expect to see if CFBD
returns something bad at the moment he presses it.

**Report your ruling on the read-side hole** — in this slice, or filed, with the reasoning.

Closeout is a separate pre-merge commit after review convergence: registry entry and Item 204 status.
`docs/next-tasks.md` is planning's — stand off it.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. Promotion is not. **Push the branch only — not `preview`.**
</output_contract>
