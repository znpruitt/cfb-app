# Item 87 — Follow-on input: clarifying what "Featured" means

> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.

**Cross-references Item 113**, which files the same contradiction from the code side. This doc supplies the product intent; 113 owns the reconciliation. Do not duplicate.

---

## What the CLI verification settled

- **Featured is results-based as shipped.** `resultCandidates` filters to `hasUsableFinalScore` (`overview.ts:470`); selection is `selectFeaturedGames` (`:376`) over `prioritizedResults` (`:483`). *All results →* goes to the Schedule tab (`OverviewPanel.tsx:1651`).
- **`prioritizeOverviewItems` is a pure map** — it does not re-sort, so Featured renders in recency order, never highlight order. Worth knowing: the section is not currently "featured" in any editorial sense.
- **Slice 2 converted Featured**, and `stateBadgeClasses` has zero occurrences in `src/`. The base addendum's green-live account holds via the conversion route. **The third case — Featured left as-is — did not happen.**
- **The base addendum contains both readings**: its existing-code table calls Featured a "neutral-final scoreboard," while its "separate axis from state" block describes the must-watch tile. That contradiction is Item 113's.

---

## The two concepts

| | **Featured as results** (shipped) | **Featured as must-watch** (design intent) |
|---|---|---|
| Contents | completed games only | games in any state |
| Selected | *after* the game, on outcome | *before* kickoff, on matchup |
| Selection input | outcome notability | insight anchoring — rivalry, podium rematch, standings stakes |
| Lifecycle | appears once final, ages out | enters at selection, persists through scheduled → live → final |
| Question answered | "what happened that mattered" | "what should I watch" |

---

## Intent — stated plainly

**Featured is a small set of must-watch games, capped at four, selected before kickoff on insight criteria, which persist in their own tile through every state of the game's life.** It is not a results highlight reel.

*(Cap is four, settled 2026-09-03 in PR #559 on the CFP-round argument. An earlier draft of this document said three; that is superseded.)*

Its defining property is that it is **orthogonal to state**. Every other section on Overview partitions by state and moves games between partitions as they progress; Featured exempts a game from that movement. A featured game sits still while everything else flows past it.

---

## Why the distinction matters

**1. The results reading is redundant three ways.** Recent finals already holds completed games; the recap's notable results covers the same ground editorially each week. A third surface showing notable completed games states one fact three times — the duplication the promotion model exists to remove. The fact that Featured currently renders in *recency* order rather than highlight order sharpens this: it is close to being a second Recent finals.

**2. The must-watch reading is redundant with nothing.** It is the only surface following a single game across its lifecycle.

**3. The one-place rule breaks under the results reading.** A featured final also appears in Recent finals. Under the must-watch reading, a featured game appears only in Featured and is excluded from the state sections.

**4. The selection pipelines are unrelated.** Outcome-based selection runs after the whistle on `gameTags.ts` thresholds. Insight-anchored selection must run *before* kickoff against archived standings, rivalry records and current standings. Building one yields none of the other.

---

## Recommendation

**Remove the results-based Featured rather than reworking it.** Its role splits cleanly — recency to Recent finals, weekly editorial to the recap's notable results.

Removal is clean per the CLI trace: outside `OverviewPanel` the selection path has one consumer, `featuredGameKeys` (`:1481`) → the exclusion at `overviewGameSections.ts:172`, which becomes a no-op. `deriveGameMovementInsights`'s `recentResults` param has no production callers. Deleting it removes `FeaturedGamesList`, `selectFeaturedGames`, `OVERVIEW_RESULTS_LIMIT`, `featuredGameKeys` and the `:1644` render condition.

**The must-watch tile is then a new feature, not a conversion**, owned by the insights work which already owns its selection criteria.

**Do not ship both.** Two tiles named Featured — one results, one upcoming — is worse than either alone.

---

## Open

Whether removal or redefinition is the right route is Item 113's call; this doc only supplies the intent and the argument. If 113 lands on redefinition, the selection pipeline is the work, not the rendering.
