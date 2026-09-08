# Item 87 — Follow-on input: Matchups implementation gap analysis

> **Status:** input for review, not applied.
>
> **Supersession:** where this document and any earlier follow-on disagree, this one is newer. It specifically corrects the reading that the outcome tint was rejected — see §2.

Gap analysis of the shipped Matchups view against `mockups/matchups-schedule-mockup.html`, from screenshots of Week 1 (all final) and Week 2 (all scheduled).

**Ordered by member impact, not by which item owns each piece.** Several of these cross item boundaries and one of them is a collision rather than a gap.

---

## Tier 1 — the scheduled week is visibly broken

Week 2 is the worse of the two screenshots by a wide margin, and three defects compound there.

### 1.1 Scheduled rows have no right-edge anchor

Every scheduled row shows two team names and nothing on the right. `DESIGN.md:95` requires an anchor on every row; the scoreboard contract fills it with the **record** when a game is scheduled, which is exactly why the anchor holds different content per state.

**This resolves the records question rather than leaving it open.** "Records stay off Matchups" and the anchor rule cannot both hold. Most games are scheduled most of the week, so deferring records leaves the majority of rows structurally incomplete, not merely plainer.

### 1.2 The empty odds footer reserves height

Matchups passes no `footerSlot`, but the component's `min-h-4` wrapper renders regardless — producing roughly 40px of dead space under every scheduled game. Combined with 1.1 the row reads as unfinished rather than sparse.

### 1.3 Kickoff metadata sits above the row, not in the status row

Shipped renders `Kickoff Sat, Sep 12, 11:00 AM` as a line above the teams. The mockup puts state and time together in the status row at the top of the block. The shipped form spends a full line on one fact and separates it from the state label that qualifies it.

---

## Tier 2 — one collision, and it blocks Item 119

### 2. Outcome is encoded twice, and the left edge is occupied

Week 1 shows **both** a coloured left rail per game (red for a loss, green for a win) **and** a grey tint on the card owner's row.

**This is not a gap. It is two treatments doing one job, in the slot a third needs.**

The mockup moved outcome into the tint specifically so the line-start slot could carry team identity. Shipped kept the rail and added a neutral tint, so:

- outcome is stated twice on the same row;
- the left edge is spent, and **Item 119's team-colour bar has nowhere to go**.

**Correction to an earlier reading:** the outcome-coloured tint was **not rejected**. `item-87-followon-team-highlight.md` predates the decision; `item-87-followon-presentation-decisions.md` supersedes it and specifies the full lifecycle — neutral when scheduled, an in-progress treatment when live, a static outcome treatment when final. The mockup's `hl-outcome` is the settled treatment.

**Resolution:** retire the left rail, keep the tint, and let the tint carry outcome per the lifecycle table. That frees the line-start slot for 119.

---

## Tier 3 — settled rules not yet applied

### 3.1 Final rows carry dates

Every final shows `vs BHooper · Thu, Sep 3, 7:00 PM`. Finals show no date or time on any surface — settled, and reaffirmed on the grounds that kickoff order is inferable from the sort.

### 3.2 Tags are absent

No `Upset`, `Ranked spotlight` or `Top matchup` anywhere. The status row has no tag slot, and per the seam findings `contextSlot` renders *above* the header row — so using it would add a line to tagged rows only, which is the exact defect the presentation doc says to avoid.

### 3.3 The `vs Owner` chip is retained

The mockup deletes it. With the owner rendered as a suffix on each team line, the chip restates a fact already on screen — and on a self game it is the only thing that distinguishes the row, which the card-owner tint now does better.

### 3.4 No third column tier

Shipped is `lg:grid-cols-2` with no third tier. The three-column tier at 1372px is recorded with derived arithmetic in `item-87-followon-three-column-tier.md`.

*The prose line in the Matchups design doc saying "Matchups keeps its two-column owner-card grid" is the stale side of that contradiction. The CSS and the tier doc are correct.*

---

## Tier 4 — new, previously unrecorded

### 4. The owner header swaps its record for a status word

Week 1 shows `Ballard 4–5`. Week 2 shows `Ballard Scheduled`.

Two different kinds of fact in one slot. **"Scheduled" is not a record**, and the stat strip directly below already says `0 WINS` and `— WIN%`, so the status word adds nothing the card does not state twice over.

**Recommend `0–0`.** A week with no results has a record; it is nil. Showing the record shape unconditionally means the header slot holds one kind of fact, and the eye learns one place to find it.

This is not in any document, in the mockup, or in any item. Filing it here as a new finding.

---

## Present and correct

The `FCS` marker, ranks, the four-stat strip, the owner header, the 760px single-column tier, and the card-owner tint's existence. Not everything diverged.

---

## Sequencing note

Several of these are cheap and independent: final-row dates (3.1), the `vs Owner` chip (3.3), the header record (4), and the empty footer (1.2). None requires a new seam or a design decision.

**1.1 and 2 are the two that need deciding before anything else moves.** Records make scheduled rows legal, and retiring the rail is a precondition for Item 119 rather than a polish item.
