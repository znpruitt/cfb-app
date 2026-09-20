# PLATFORM-827 — the Overview standings table shows live records

```text
PROMPT_ID: PLATFORM-827-OVERVIEW-LIVE-RECORDS-CODEX-v1
PURPOSE: Overview's condensed Standings table takes its RECORD VALUES from the last fully resolved
         week while the podium above it and the Standings page show live ones, so on a game day one
         screen names two different leaders. Make the table's values live; keep movement anchored on
         resolved weeks.
SCOPE:   src/lib/selectors/overview.ts and src/components/OverviewPanel.tsx (the condensed table and
         what feeds it), plus their tests. DO NOT change the Insights column's inputs, the GB Race
         chart, the Standings page, the podium, any canonical standings computation, or DESIGN.md
         (planning owns it — the rule is already written).
CARRIES: NONE from the Item 87 campaign index, having checked — this is an Overview section's data
         source, not scoreboard row anatomy.

         One standing obligation binds, from AGENTS.md: a claim in a comment needs a test asserting
         the same behaviour. The selector's existing comment at `overview.ts:548-555` explains why
         MOVEMENT is anchored on resolved weeks; after this slice it must not read as though the
         VALUES are too.
```

---

## The defect, seen on production 2026-09-19

During Week 3's Saturday games, one screen showed:

| surface | leader | source |
| --- | --- | --- |
| Overview podium | **Chamness 17–6** | `standingsLeaders.slice(0, 3)` (`overview.ts:604`) |
| Overview Standings table | **BHooper 15–4** | `standingsTopN` ← `resolvedCurrent` (`overview.ts:555`, `:621`) |
| Standings page | Chamness 17–6 | live canonical rows |

**The numbers are consistent — they are from two different moments.** The latest fully resolved week
was Week 2, so the table showed end-of-Week-2 records while the podium included that day's finals:
Chamness went 3–0 (14–6 → 17–6), BHooper 0–2 (15–4 → 15–6), Surowiec 2–0 (14–4 → 16–4).

**Nothing on the screen says which moment each surface describes.** Not a caching defect — the #816
diagnostic compared the live snapshot against a fresh rebuild the same afternoon and every owner
matched.

## The ruling, already recorded

**Owner decision 2026-09-19 on [#827](https://github.com/znpruitt/cfb-app/issues/827),** written into
`DESIGN.md` under *Overview standings row hierarchy*: **"Records are live, movement is resolved."**
The condensed table's record, Win%, Diff and GB are the live canonical rows — the same values the
podium and the Standings page show — and rank movement stays anchored on the latest fully resolved
weeks, so a partial week never makes the comparison skip a boundary.

`DESIGN.md` marks the rule **not yet implemented**. This slice implements it.

## What the code does today

- `resolvedCurrent = resolvedMovement.latest ?? standingsLeaders` (`overview.ts:555`) feeds
  `standingsTopN` (`:621`) and `standingsHasMore` (`:623`).
- `deriveResolvedMovementStandings` (`overview.ts:134-153`) returns the latest and previous resolved
  weeks from `standingsHistory`.
- The comment at `:548-555` justifies the anchor **for movement**, and says live-display surfaces
  (the hero and the GB Race chart) already use `standingsLeaders` directly.
- The table renders through `CondensedStandingsTable` (`OverviewPanel.tsx:606`), which takes
  `previousRows` (`:1873`), plus `deltaWeeks`/`deltasByOwner` from `positionDeltaData`
  (`:1800-1815`, via `selectPositionDeltas`).

## The question this slice must answer

**What the rank arrow means once the rows are live.** Today the arrow and the record come from the
same resolved pair, so they agree. With live rows, an arrow computed from Week 1 → Week 2 sits beside
a live rank and a member will read it as today's movement.

**And the two surfaces already disagree.** The Standings page derives movement through
`deriveStandingsMovementByOwner` over a NoClaim-filtered history (`StandingsPanel.tsx:205-221`), which
is not the same computation as Overview's `selectPositionDeltas`. On 2026-09-19 the same owner showed
`↑3` on the Standings page and up-one on Overview. **Read both before choosing**; they should mean the
same thing, and saying why they differ is part of the receipt.

## Acceptance

1. The condensed table's record, Win%, Diff, GB and rank come from the same live rows as the podium,
   proven by a test that fails if the table and the podium diverge — not by two fixtures that happen
   to match.
2. **Movement stays anchored on resolved weeks**, and its meaning is stated in the header or the
   column's accessible label so a member is not left to infer it.
3. **The Insights column still reads resolved standings** (`OverviewPanel.tsx:1697-1704`) — its claims
   are week-over-week and genuinely need finished weeks. Pin that it did not change.
4. The GB Race chart, the podium and the Standings page are unchanged, each pinned.
5. The selector comment no longer reads as though the values are anchored too, and names the test that
   asserts the new behaviour.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.**

**Acceptance 1 is the likely false green:** during a fully resolved week the live rows and the
resolved snapshot are identical, so a fixture built from a completed week passes whether or not the
fix exists. Use a fixture with a partial week — finals landed after the last resolved boundary — and
show the test failing against today's code.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **Every consumer of `resolvedCurrent`** besides `standingsTopN` and `standingsHasMore`, and for each
   one whether it wants live or resolved values.
2. **What does the rank arrow compare after this change?** Your recommendation, and what a member
   would take it to mean.
3. **Why do Overview and the Standings page disagree about movement today?** Name both computations
   and say whether they should converge here or in a separate slice.
4. **What breaks if `standingsHistory` is absent** — preseason, a new league, a store failure? Today
   `resolvedCurrent` falls back to `standingsLeaders`; say what the live path does in each case.
5. **Does anything else on Overview mix a resolved value with a live one** in the same visual block?
   The podium and the table are the known pair; check the rest before fixing one.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
