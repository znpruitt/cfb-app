# Item 87 — document index

> **Read this before any `item-87-*` document.** Fifteen documents accumulated across this campaign, each additive, none editing its predecessors. This index is the only place that records what overrides what.
>
> **Maintenance rule:** a new follow-on updates *this file only*. Per-document headers stay generic so that landing a document does not require editing every other one.

---

## Status legend

| Mark | Meaning |
|---|---|
| **CURRENT** | Authoritative. Nothing overrides it. |
| **PARTLY SUPERSEDED** | Some sections overridden — the entry names which. |
| **SUPERSEDED** | Do not decide from this document. Kept for history. |

---

## The documents

### Base

**`item-87-live-watchlist-scoreboard.md`** — **PARTLY SUPERSEDED**
The campaign addendum. Component contract, slices, colour sequencing.

- Contains **both** readings of Featured — the "neutral-final scoreboard" table entry and the "separate axis from state" block. That contradiction is **Item 113**'s, and `featured-intent.md` supplies the product intent.
- Line references throughout are stale; `overview.ts` has been restructured since.
- The amber `upset` border exemption is **retired** — see `matchups-schedule-design.md` and the eyebrow decision.

### Scoreboard contract

**`item-87-followon-records.md`** — **PARTLY SUPERSEDED**
Records across scoreboard states; the anchor rule per state.

- **`:44` predicted the exact confusion of 2026-09-08 and the prompt did not carry it:** *"Item 87's
  shipped appearance will differ from the mockup until Item 92 lands. The implementation prompt must
  state this explicitly, or a reviewer comparing the build against the reference will read the absent
  records as a defect rather than a sequenced dependency."* Item 117's v2 prompt omitted it; the owner
  compared the build to the mockup and read absent records as a defect. **Any prompt touching a
  scoreboard surface must carry this sentence until Item 92 lands.**
- The **records rule is CURRENT** and load-bearing: the record is the anchor on scheduled rows. `matchups-gap-analysis.md` §1.1 shows what breaks without it.
- Its **`:37` "live and final rows omit the inline parenthetical"** is NOT superseded and NOT a
  contradiction of `:15`/`:17` — **verified 2026-09-08.** It sits under *Consequence — Item 92* and
  states the **DEGRADATION** rule for when records are unavailable, while `:15`/`:17` state the
  normal case. It reads as a contradiction only because the fallback is written in the same voice as
  the primary rule, three sections apart. **Fix the voice, not the status.**
- **There is no finals-clearing document, and none was deleted** — searched `docs/` and git history.
  The **displacement rule** does exist (`item-87-followon-section-ordering.md:39`) but governs the
  **Recent finals SECTION emptying on Overview**, not records on final rows. Two subjects sharing the
  word "finals".

**`item-87-followon-featured-intent.md`** — **CURRENT**
The two Featured concepts and the product intent. Cross-references Item 113, which owns reconciliation. Cap is **four**.

### Ordering

**`item-87-followon-section-ordering.md`** — **PARTLY SUPERSEDED**
Six decisions found living only in mockup markup. Per-decision status in its own header. All four open items are answered by its child.

**`item-87-followon-section-ordering-resolutions.md`** — **CURRENT**
Live sorts by kickoff alone; owner-count key removed; no date or time on final rows; Matchups sorts kickoff with finals last; counts wait for Item 115. Carries the sort-rules table for all four sections.

### Postseason

**`item-87-followon-postseason-context.md`** — **PARTLY SUPERSEDED**
Establishes that finals carry no date *because the container supplies temporal context*.

- The **grouping proposal is superseded**: it treated Bowls and CFP rounds as disjoint groups, which they are not — quarterfinals and semifinals *are* bowls. Corrected in `postseason-grouping-notes.md`.
- The **rationale is also superseded**, and by a better one: kickoff order is inferable from the sort, which holds regardless of container. Recorded in `matchups-gap-analysis.md` §3.1.

**`item-87-followon-postseason-grouping-notes.md`** — **CURRENT**
Group from `playoffRound` and `postseasonSubtype`, order from `startDate`, never from `week`. Reuse `deriveFeaturedGameBadge`. The `'first-round'` typing trap.

**`item-87-followon-postseason-refinements.md`** — **CURRENT**
Key the generic CFP group on `playoffCompetition === 'cfp'` — a positive test on provider data, superseding the parse-failure condition in the notes doc. Parser evidence across five seasons. The `eventKey` collision.

### Colour

**`item-87-followon-team-colour.md`** — **PARTLY SUPERSEDED**

- The **decision is CURRENT**: solid 8px muted bar at ~72% in the line-start slot; gradient and full-width band rejected; ship on the existing HSL normaliser before considering OKLCH.
- The **framing is superseded**. §A describes widening a 2–3px incumbent. There is no incumbent — slice 5 deleted it. See `team-colour-regression.md`.

**`item-87-followon-team-colour-regression.md`** — **CURRENT**
Item 119 is a restoration, not a widening. `teamColors.ts` orphaned. `DESIGN.md` correction. Covers Overview, Matchups and Schedule.

**`item-87-followon-team-highlight.md`** — **SUPERSEDED**
> **Do not decide from this document.** Its neutral-tint conclusion predates the owner's decision to have the tint carry outcome across the game's lifecycle. Reading it as current has already produced one wrong review conclusion and, downstream, shipped code that encodes outcome twice. The lifecycle table in `presentation-decisions.md` is authoritative.

Still current in it: the buildable/not-buildable analysis (no user↔owner mapping exists), and the two stacking bugs recorded as implementation notes.

### Layout and presentation

**`item-87-followon-matchups-schedule-design.md`** — **PARTLY SUPERSEDED**
Structural design for both views, the three unowned states, the defect list. **The most stale document in the set — eleven known wrong claims.**

- **"Matchups keeps its two-column owner-card grid" is stale.** See `three-column-tier.md`.
- Presentation details throughout are superseded by `presentation-decisions.md`.
- *CLI: this document needs the reconciliation pass (Item 144) before anything else is decided from it.*

**`item-87-followon-three-column-tier.md`** — **CURRENT**
Overview grid tiers: 1 / 2 / 3 columns, third above 1300px, derived. Matchups owner cards at 1372px; Schedule blocks at 1320px are in `presentation-decisions.md`.

**`item-87-followon-presentation-decisions.md`** — **CURRENT**
Status-row structure with right-aligned tags; Schedule as discrete blocks; date dividers; mobile wrapping; **the lifecycle tint table**; weight emphasis suppressed on live. Three implementation traps: `margin-left: auto` failing at column width, block layout ignoring grid `gap`, and `min-width: 0` deciding whether the tag or the metadata clips.

**`item-87-followon-matchups-gap-analysis.md`** — **CURRENT**
Shipped Matchups against the mockup, ordered by member impact. The rail/tint collision blocking Item 119. Records as the scheduled anchor. The owner-header status word.

---

## Per-document header to add

One line at the top of every `item-87-*` document. Generic by design — it does not name what supersedes it, so landing a new document never requires editing this line anywhere.

```text
> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.
```

---

## What went wrong, recorded once

Every document here was written additively, on the reasoning that editing a committed document loses history. That reasoning is sound and the conclusion drawn from it was not: history is preserved by *marking* what a document no longer governs, not by leaving it silent.

The cost was not abstract. Three wrong statements came out of this set in two days — a records/broadcast/odds list, the card-owner treatment, and the column count — and the second of those reached shipped code.
