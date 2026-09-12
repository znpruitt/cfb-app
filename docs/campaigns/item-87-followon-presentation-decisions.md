# Item 87 — Follow-on input: Matchups and Schedule presentation decisions

> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.
>
> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.
>
> **INDEX (verified 2026-09-08): CURRENT.** Nothing overrides it. Two things have moved since it was written and are
> marked inline: the mobile wrapping rule is now RECONCILED into `DESIGN.md` as an amendment (2026-09-08), and the
> Schedule 1320px arithmetic is Item 152's to settle. The status-row structure, the tint lifecycle and the
> weight-suppression rule are decided and UNBUILT (Item 143 for Matchups). The rail retirement requires
> planning reassignment after Item 119's 2026-09-10 retirement.

**Reference mockup:** `mockups/matchups-schedule-mockup.html` — carries all of this. Where the mockup and this document disagree, the mockup is newer; say so rather than guessing.

Additive to `item-87-followon-matchups-schedule-design.md`, which covers the structural design. This records presentation decisions taken while reviewing slice 5 as shipped and iterating on the mockup.

---

## Status row

> **Surfaces governed:** **Overview, Matchups, Schedule, recap — all four.** — added 2026-09-08 per `item-87-INDEX.md` CARRY row 71. This is shared-row anatomy; it reads as a Schedule decision only because that is where the work happened. **Overview was found six such decisions behind** (Item 160).

### Structure: growing left group, tag pinned right

```html
<div class="sb-status">
  <span class="sb-meta"> state · time · broadcast </span>
  <span class="eyebrow"> TAG </span>
</div>
```

**Metadata order is fixed:** state, then time, then broadcast. Tags right-align.

**The left group must grow (`flex: 1 1 auto; min-width: 0`).** This is not cosmetic — see the implementation note below.

**Why right-aligned:** the tag's position becomes constant regardless of how long the status string is, and tags form a scannable column down the right edge. Left-inline placement put the tag at a different offset on every row.

### Implementation note — `margin-left: auto` is not sufficient

The obvious implementation is `margin-left: auto` on the tag. **It silently fails at column width.** Auto margins only absorb *free* space, and a tagged status row at three columns has none — the row is already overflowing, so the tag lands wherever the metadata ends rather than at the right edge.

The working approach is structural: a left group that grows, and a tag that is `flex: none`. This behaves identically whether the row is roomy or overflowing, and whether or not metadata is present at all — the Upset row, whose left group holds only `FINAL`, aligns the same as a row with a full date string.

Cost several attempts to find, because the CSS rule was correct and the layout condition it depended on was absent. Worth stating in the prompt.

### Degradation: metadata shrinks, tag never clips

`min-width: 0` plus `text-overflow: ellipsis` on the metadata; `flex: none` on the tag. Without `min-width: 0` a flex item will not shrink below its content width, so the row overflows and the **tag** is what gets clipped, being last in DOM order. That is backwards: the tag is the scarce signal, and the date is recoverable from the group heading above it.

### Mobile: the single-line contract is scoped, not absolute

An earlier document recorded header rows as single-line **by contract**. That was stated too broadly.

The contract exists because a wrapping header desynchronises team rows across a grid row. **At one column there is no adjacent card to desynchronise from**, so the reason does not apply.

It matters on phones. At 375–430px portrait, minus page and block padding, a row has ~276–346px inner. The fixed elements — state label, tag, gaps — take ~213px, leaving 60–130px for metadata, so a kickoff time truncates to about ten characters. On a scheduled game the time is more useful than the tag.

**Rule:** below the single-column breakpoint the status row wraps and the tag drops to its own line. Both survive intact.

> **RECONCILED (verified 2026-09-08):** owner ruling, recorded as an amendment in `DESIGN.md` → *Cards and game
> results* ("Header rows never wrap … EXCEPT at single-column layouts"). Narrowed as the owner did: the collision is
> **tagged scheduled rows at phone width**; an untagged row has roughly 131px more room and fits. It buys a kickoff
> time on tagged rows on phones and is not a general licence to wrap. The shipped component still ellipsizes
> (`CompactGameScoreboard` header is `whitespace-nowrap`); building the exception is Item 143's.

---

## Tags

> **Surfaces governed:** **Overview, Matchups, Schedule, recap — all four.** — added 2026-09-08 per `item-87-INDEX.md` CARRY row 71. A property of the tag SLOT, not of any one surface: any surface rendering a tag must not render an outcome tag on a game that has not kicked off.

### Outcome tags only exist on final rows

*Upset*, and anything else describing what happened, cannot render on a scheduled or live game. *Ranked spotlight* and *Top matchup* are selection reasons and may appear in any state.

Same slot, but the valid value set depends on state. An implementation treating them as one undifferentiated tag list will happily render "Upset" on a game that has not kicked off.

---

## Schedule layout

> **Surfaces governed:** **Schedule only.** — added 2026-09-08 per `item-87-INDEX.md` CARRY row 71. Genuinely scoped — discrete blocks, date headings and the block tier are Schedule's own structure, not shared-row anatomy. Overview's column tier is `three-column-tier.md` (Item 134).

### Games are discrete blocks

Subtle neutral fill (`rgba(255,255,255,0.022)`), 5px radius, 7px/10px padding. Divider rules removed — the fill separates, so blocks pack tighter than a divider list allowed.

**This is a partial reversal of removing card chrome, and deliberately so.** What the transition removed was *status-coloured borders carrying meaning*. A neutral fill carrying grouping is a different instrument doing a different job. At sixty games a flat divider list reads as one object rather than as individual games.

### Three-column tier at 1320px

`3 × (400px minimum row + 24px block padding) + 2 × 16px gap = 1320`. This was described as higher
than Overview's former 1300px proposal because each block carries its own padding. PLATFORM-678 has
since set Overview independently at 1348px after accounting for its shipped logo slot, so that
historical comparison no longer describes the current ordering. Schedule's own number remains Item
152's.

> **DOES NOT REPRODUCE — Item 152 (verified 2026-09-08).** The arithmetic as written gives **1304**, the mockup's
> comment (2 × 20px gap) gives **1312**, and the mockup's own CSS (10px block padding, 16px column gap) gives
> **1300**. No number is chosen here; Item 152 picks one and corrects the two statements that disagree with it.
> The Matchups figure (1372px) does reproduce from its inputs and lives only in the mockup (`:218-220`, the `.owner-grid` container query).

### Block layouts need margin, not gap

At single column the grids become `display: block`, and **block layout ignores grid `gap`** — blocks stack with no separation at all. Adjacent-sibling margins are required: `.grow + .grow` on Schedule, `.owner-card + .owner-card` on Matchups. This was a real defect in the mockup and would be an easy one to ship.

### Date headings

Three changes, and the third does most of the work:

1. **Asymmetric spacing** — roughly double the space above, tighter below, so the heading belongs to the group it introduces rather than floating between two.
2. **Quieter but distinct in kind** — uppercase, letterspaced, secondary. A date heading is chrome, not content. Making it *bigger* would fight the game rows; making it *different* separates without competing.
3. **A 1px rule at ~16% white, spanning the full width above it.** The layout has no other horizontal line at this level, so the eye has nothing to catch on. First group omits it — nothing above to separate from.

---

## Owner highlight on Matchups

> **Surfaces governed:** **Matchups** for the tint and its motion — **but see the exception below.** — added 2026-09-08 per `item-87-INDEX.md` CARRY row 71. *Weight emphasis is suppressed on live games* is filed here and is **NOT Matchups-scoped**: dimming the trailing side overstates on any live row, on every surface. The owner tint is named there only as a partly-redundant reinforcement. **It is misfiled under this heading for exactly the reason row 71 exists.**

### The tint tracks state across the game's whole life

| State | Treatment |
|---|---|
| Scheduled | neutral tint |
| Live, level | neutral tint — no direction yet |
| Live, ahead | green base with a travelling band |
| Live, behind | red base with a travelling band |
| Final, won | static green |
| Final, lost | static red |

> **CURRENT and UNBUILT (verified 2026-09-08):** this is the settled lifecycle; the mockup's `hl-outcome` mode is the
> reference. It does not conflict with `item-87-followon-team-highlight.md`, which decides the IDENTITY axis (the
> tint is never owner colour); this table decides the OUTCOME axis. Shipped code renders the neutral tint only
> (slice 5b, Item 117) and still draws the outcome rail beside it — `item-87-followon-matchups-gap-analysis.md` §2.

**Hue carries direction; motion carries certainty.** An earlier version distinguished live from final by opacity alone (11% vs 19%), which read as one of them being slightly wrong rather than as two states. Motion makes them different in kind.

### Motion specification

A band travels across the tint and reverses, rather than looping. `alternate` with `ease-in-out` over 4.5s each way — easing matters because a linear reversal snaps at each end and reads as a bounce, while easing decelerates into the turn and reads as a slow breath. Looping also produces a discontinuity as the band resets.

Band at ~15% alpha over ~70% of the row width. **Wide and soft rather than narrow and bright** — the same energy spread over more area reads as ambient rather than as an alert, and does not interfere with legibility. Earlier values (26% over 55%) were too present.

`prefers-reduced-motion: reduce` stops the sweep and leaves the base tint. Note this is a real degradation, not cosmetic: those users lose the provisional marker and keep only direction. If that matters, the fallback could reinstate an opacity difference for them.

### Weight emphasis is suppressed on live games

> **Surfaces governed: all four**, despite this section's parent heading — the rule is about live rows, not about owner highlighting. See the parent's surfaces line.

Dimming the trailing side is a claim about a **settled** result. On a live game it overstates — a team down three in the first quarter is not the loser, and rendering them like one says more than the score does. Finals keep it.

The owner-row tint already carries direction on live games, so the dimming was also partly redundant there.

---

## Not defects

> **Surfaces governed:** **Overview, Matchups, Schedule, recap — all four.** — added 2026-09-08 per `item-87-INDEX.md` CARRY row 71. Reading absent or stale records as a defect rather than a sequenced dependency is a reviewer failure available on every surface (CARRY row 1).

Records absent from shipped rows remain expected pending their wiring. **SUPERSEDED 2026-09-10:**
the team-colour bar did not land; 28px CFBD logos now occupy the shared line-start slot.

> **LIVE — the reviewer-facing form of INDEX CARRY row 1 (verified 2026-09-08).** Records on Matchups and Schedule
> are a sequencing state, not a defect; the 2026-09-08 ruling in `item-87-live-watchlist-scoreboard.md` → *Watchlist
> card* says what that state requires.
