# Item 87 — Reference: the game row, element by element

> **Status:** reference. Consolidates decisions already recorded across the campaign set; adds nothing new. Where this and another document disagree, check `item-87-INDEX.md` — this is a description of the settled contract, not a new ruling.
>
> **Surfaces governed:** Overview, Matchups, Schedule, weekly recap. Every element below is a property of the shared row unless it explicitly names a consumer.
>
> **Reference mockup:** `mockups/matchups-schedule-mockup.html`.

---

## Why this document exists

The row's design is settled but scattered across fourteen documents, and the same questions have been asked more than once. This states every element, what it holds, and why — so a reader does not have to reconstruct the reasoning from the order in which it was decided.

---

## Anatomy

A game renders as a **block** with two or three parts:

```text
┌─────────────────────────────────────────────────────────┐
│ STATUS ROW      state · time · broadcast      [ TAG ]   │
│ ▍ #10  Team A   (3–5)  Owner              anchor        │
│ ▍      Team B   (4–4)  Owner              anchor        │
│ odds / metadata line                     (tier 2 only)  │
└─────────────────────────────────────────────────────────┘
```

Two team lines, always. Never one, never three.

---

## 1. The status row

### Structure

```html
<div class="sb-status">
  <span class="sb-meta"> state · time · broadcast </span>
  <span class="eyebrow"> TAG </span>
</div>
```

**One flexible left group, one fixed tag pinned right.**

**Why structural rather than `margin-left: auto`:** auto margins only absorb *free* space. A tagged status row at two or three columns has none — the row is already overflowing — so the tag lands wherever the metadata ends rather than at the right edge. The left group must grow (`flex: 1 1 auto; min-width: 0`) and the tag must be `flex: none`. This behaves identically whether the row is roomy or overflowing, and whether or not metadata is present at all.

**Degradation:** metadata shrinks and ellipses; the tag never clips. Without `min-width: 0` a flex item will not shrink below its content width, so the row overflows and the **tag** is what gets clipped, being last in DOM order. That is backwards — the tag is the scarce signal and the date is recoverable from the group heading above it.

### Metadata order: state, then time, then broadcast

Fixed. A row missing a broadcast has a shorter left side, not a differently ordered one.

**State** is `SCHEDULED`, `FINAL`, or the live badge. **Never defined by negation** — `!== 'scheduled'` means every state not named inherits the branch, which is how kickoff ended up printing on final rows. Enumerate per state.

**Time** appears on scheduled and live rows. **Never on final rows** — see §5.

**Broadcast** appears on scheduled and live rows. A completed game's broadcast is dead information.

**No qualifier prefix.** `Streaming · ACC Extra` becomes `ACC Extra` — the prefix does not help a reader who does not recognise the name and is redundant for one who does. It is also inconsistent, since FOX and ESPN2 carry no equivalent, so the label appears only when the answer is less familiar. It is the longest metadata string on the surface and the first to truncate.

### Mobile: the row wraps below one column

The single-line contract is **scoped to multi-column layouts**, not absolute. It exists to stop a wrapping header desynchronising team rows across a grid row; at one column there is no adjacent card to desynchronise from, so the reason does not apply.

It matters on phones. At 375–430px portrait, minus page and block padding, a row has ~276–346px inner. State label, tag and gaps take ~213px, leaving 60–130px for metadata — enough to truncate a kickoff time to about ten characters. On a scheduled game the time is more useful than the tag, so the tag drops to its own line and both survive.

---

## 2. The tag

### Treatment: bronze pill, uppercase, right-aligned

`#dbc190` text, `rgba(201,166,107,0.40)` border at 0.5px, 10px, `0.08em` tracking.

**Bronze, not blue.** `DESIGN.md:153` forbids blue for "featured" or "important", and a tag means exactly that — the shipped blue was non-compliant, so bronze is a correction rather than a preference.

**Bronze does not collide with champion amber**, because the champion treatment does not render until a title is awarded — podium cards for #1–#3 are neutral all season. At season end the two remain distinguishable as a desaturated tan against a dark saturated gold. **Known limitation:** bronze pill text against champion amber measures **2.13:1**, so the pair is distinguishable but not strongly. Recorded rather than argued away.

*An earlier draft of this document cited 1.32:1 here. That figure is real but measures the pill **border** against the pill **text** — a pair nobody reads across. It is the third non-reproducing figure in this campaign, and like the other two the conclusion it supported was sound, which is precisely why nobody rechecked it.*

**One treatment, no per-class variation.** An earlier draft gave outcome tags a pill and selection tags plain text, reasoning that they are different classes. The distinction is real but **undecodable** — a reader cannot learn "pill means outcome" from looking. Rejected.

### Which tags exist in which state

| Class | Examples | Valid on |
|---|---|---|
| **Selection** — why the game was surfaced | Game of the Week, Top 25 Matchup | any state |
| **Outcome** — what happened | Upset | **final only** |

An outcome tag cannot render on a game that has not been played. An implementation treating these as one undifferentiated list will render `Upset` on a scheduled game.

**Constraint on the taxonomy, and it bounds what a cap can ever do.** The two `LeagueGameTag` outcome/tension tags are **mutually exclusive by state**: `upset` requires `state === 'final'` (`gameTags.ts:716`) and `upset_watch` requires `state !== 'final'` (`:730`). With `top_25_matchup` as the only other member, **the league family can never carry more than two tags.** So a cap in `prioritizeGameTags` would be unreachable code, and any test written for it could not use real data. Recorded here rather than only in closed Item 166, because the next reader to compare that function against the cap rule will otherwise rediscover it.

**UPDATED 2026-09-08 by Items 157 and 162 — the cap is now unreachable on BOTH sides.** This paragraph previously said the Overview highlight family was the one the cap governs, because `deriveGameHighlightTags` could reach three (`top25`/`ranked`, `contenderWatch`, `close`). Retiring `ranked` and `contenderWatch` leaves `top25` and `close`, so that family also tops out at two and `TOP_BADGE_LIMIT` binds on no input anywhere. **The cap is retained as a documented forward guard, not deleted** — `DESIGN.md` requires it, and removing an implementation because it is currently unreachable would leave that rule with nothing behind it. What makes it bind again is a third tag able to CO-FIRE with both survivors; one mutually exclusive with either would leave it unreachable. `TOP_BADGE_LIMIT = 2` at `gameTags.ts:52`, applied at `:556`.

### Two suppression rules

**A tag that restates its container is suppressed.** A section titled *Head-to-head results* must not tag every row `HEAD-TO-HEAD`. The tag's job is to distinguish *within* the section; when every row shares the reason, it carries nothing and the distinguishing fact gets demoted to prose.

**A tag that restates the row is suppressed.** `RANKED TEAM` beside `#25 Missouri` adds nothing — the rank is on the row. **Applied 2026-09-08 (Item 157): `Ranked Team` is retired.** The rule was stated here and violated in the code for as long as both existed. Item 163 extended it to Matchups' `vs <owner>` pill and added the reason the rule needs: **position decides whether restatement aids scanning**, and a marker sitting after the content it restates cannot do that job. `DESIGN.md` now carries both halves.

**`Top 25 Matchup` is not shortened to `Top 25`. Shipped 2026-09-08 (Item 157)** — `LEAGUE_TAG_LABELS` had rendered the short form on Schedule and Matchups, so this rule and the code disagreed while it was written. Both surfaces now render the long label, and the tag is bounded to ranks 1–25 on both sides (`isRankedTop25`, `gameTags.ts:682`) rather than merely "has a rank". The two tags encode different facts: both teams ranked versus one. "Top 25" reads as a property of the game and would fire on `#1 Ohio State` against an unranked opponent. "Both ranked" is not derivable at a glance the way one visible rank is, so "Matchup" is the word carrying the information.

### Cap

Two. Three pills crowd the metadata out entirely at column width even without wrapping — the tag slot is `flex: none`, so at three tags the metadata absorbs the whole squeeze and ellipses to nothing.

**The selector applies the cap, not the renderer** (`DESIGN.md:293`, amended). A render-time truncation of a list the selector still builds in full leaves the cap invisible to anything testing the selector. `prioritizeGameTags` chooses which two survive.

**Already implemented — `TOP_BADGE_LIMIT = 2` (`gameTags.ts:52`), applied in
`deriveGameHighlightTags` at `:556`.** Item 166 was filed to add it and closed unworked on
2026-09-08. `prioritizeGameTags` needs none: `upset` and `upset_watch` are mutually exclusive by
state, so the league family cannot reach three.

**Its test no longer proves the cap, and that is recorded rather than papered over.**
`gameTags.test.ts:941` had asserted the cap against a game carrying three qualifying tags; after the
Item 157 and 162 retirements no input reaches three, so the assertion was **deleted rather than left
passing vacuously** and the test renamed to the tag SET it still pins (`:956`). Be precise about the
remaining limit: the two survivors are pushed in priority order, so that test does not discriminate
the sort either. A fixture built to keep a cap test green is the vacuous-test failure this campaign
has shipped four times, and it was not built here.

---

## 3. The team lines

Two lines, **away then home, in every state including final.** CFB convention. Ordering is fixed by home/away; **emphasis is separate** and marks the leader or winner. The two are never conflated.

Nominal away/home hold on neutral-site games; the neutral marker goes on the metadata line.

### Line-start slot: the team colour bar

8px solid bar, ~72% opacity, luminance-normalised.

**Identity, not semantics.** It says "this is Michigan," not "this is good, active or interactive" — which is why it cannot collide with the reserved palette the way a meaning-bearing hue would. It is the one available route to visual richness on a deliberately monochrome surface.

**Why a bar and not a background.** Gradient and full-width band were both rejected: they sit *behind* the text and conflict with the row's most important signal, since a losing team with a bright primary can visually outweigh a winner with a dark one. Avoiding that would mean dimming on the trailing side, at which point the colour carries outcome as well as identity and stops being identity.

**Luminance normalisation is required, not polish.** Roughly a fifth of the FBS has a primary invisible on a dark background — Penn State `#041E42`, Hawai'i `#024731`, Virginia `#232D4B`.

#### The 72% was decided, but never measured — and it was tuned against the opposite failure

**Traced 2026-09-09 by the Item 119 lane, at planning's request.** The value originated in the
2026-09-03 mockup as the selected *wider solid bar, muted* variant, chosen so bright primaries would not
compete with result emphasis. **Later documents ratified `0.72` itself without any contrast comparison
establishing it.** The rationale justifies some reduction; nothing justifies that number.

**The consequence is the part worth recording.** The mute exists to tame the BRIGHT end of the
distribution. The failure Item 198 is being built to fix is at the DARK end — and the same global
multiplier that stops Oregon competing with a winner is what drags a normalised navy from 3:1 raw to
2.10:1 composited. **The dark end is collateral damage from a lever aimed at the bright end.**

**So "just raise the opacity" is not the smaller fix, and planning proposed it before checking.**
Raising it reintroduces precisely the problem it was added to solve. A single global opacity is the
wrong instrument for a two-ended distribution.

**The hypothesis this leaves for Item 198, to be measured rather than assumed:** if normalisation
clamps lightness into a band, it solves BOTH ends with one instrument — and the opacity mute becomes
redundant rather than merely suboptimal. If that holds, `0.72` can go to `1.0`, which raises every
composited ratio without touching a hue.

#### MEASURED 2026-09-09, on the resynced catalog — the hypothesis holds, and the two goals are in direct conflict

**135 bars render** (125 primary, 10 alternate; Georgia Southern, Penn State and UConn omitted).
**Only 31 of 135 — 23.0% — clear 3:1 composited.** Distribution: min **1.431**, median **2.099**,
mean 2.452, p75 2.937, max **5.789**. 52 teams sit below 2.00.

**The median is the finding.** Compositing 72% over `#0A0A0A`, a raw **3.00:1** colour lands at
**2.086:1** — and the measured median is **2.099**, back-solving to **raw 3.025:1**. The normaliser is
hitting its target almost exactly. **The opacity is what breaks it**, costing **0.93** of ratio at the
median and **1.82** at the level that would clear 3:1.

**So the three goals cannot all hold.** To reach 3:1 composited at 72%, every colour must be
**4.815:1 raw** — bright enough that the mute has been defeated by the thing it was added to prevent.
**Pick two of: 72% opacity, 3:1 composited, muted colour.**

**And a band beats the mute at the mute's own job.** Today's brightest bar is 5.789 composited
(10.5:1 raw). A normalisation band of roughly 3:1–5:1 raw at full opacity would put every bar between
3.0 and 5.0 composited — **raising the dark end AND lowering the bright end below where it sits now.**
A global multiplier cannot do that; it moves every colour the same direction. **This is the case for
piece 2 being a band, not a lift.**

**One question that must be answered before the target is:** WCAG 1.4.11's 3:1 governs UI components
required to understand content. **This bar is redundant with the team name beside it.** 3:1 is a
defensible aspiration here, not a mandate — and 1.431:1 is indefensible on any reading. **Item 198
should choose a visibility floor deliberately rather than inheriting 3:1 by default.**

#### The band shipped as 2.5 / 5.5 — and the argument that carried it was WRONG

**Recorded 2026-09-10, correcting my own reasoning rather than the decision.** I argued 2.5 over 3.0
on the grounds that a 3.0 floor collapses the band — 0.734 of span on zinc-950 against 1.541 at 2.5 —
and that the wider span preserves variation between teams.

**The shipped measurement says the span is barely occupied either way.** Against `#333336`: min
**2.5001**, median **2.5103**, max **3.4810** — the median sits one hundredth above the floor and the
max IS the ceiling. **At least half the teams clamp to the floor and the remainder pile at the
ceiling**, because 101 of 135 inputs were below the floor and clamp to it wherever it sits. A 3.0
floor would have clamped 106. **Five teams separated the two cases, not a collapsed band.**

**The honest reason 2.5 beat 3.0 is that it brightens the whole set less** — a floor of 3.959:1 on
zinc-950 rather than 4.766:1 — keeping bars closer to true colour and further from competing with
result emphasis. Same decision, correct rationale.

**The consequence to watch is that bar LIGHTNESS now carries almost no information.** Teams are
separated by hue alone. Where several share a palette — California, Wake Forest and Purdue all read
gold — the bars are near-identical.

#### CONFIRMED A DEFECT 2026-09-10 by the owner walkthrough: the band must REMAP, not CLAMP

**Four reds on one Overview screen read as the same colour.** Measured against `#333336`:

| team | | raw |
| --- | --- | --- |
| Louisville | `#C9001F` | **2.101:1** |
| Ohio State | `#BA0C2F` | **1.908:1** |
| Indiana | `#990000` | **1.412:1** |
| Oklahoma | `#841617` | **1.264:1** |

**Their real spread is 0.837, and all four sit BELOW the 2.5 floor — so the clamp lifts every one to
exactly 2.500 and the spread becomes 0.000.** Oklahoma's dark crimson and Louisville's bright cardinal
render identically. The owner's objection — *"I don't think that's representative of real life"* — is
arithmetic, not perception.

**A monotone remap onto the SAME bounds preserves 0.787 of the 0.837 — 94% of the real distinction —
with identical floor and ceiling guarantees**: Louisville 3.484, Ohio State 3.303, Indiana 2.836,
Oklahoma 2.698.

**This is a specification defect, not an implementation one.** The ruling said "floor 2.5, ceiling 5.5"
and never said what happens BETWEEN them; clamping is the natural reading of a floor and a ceiling.
**A band is a range to map INTO, not a pair of walls to press against.**

**Use FIXED input bounds, not the observed min and max.** An observed-range remap makes every team's
colour depend on the whole catalog, so one new team shifts all 135. Fixed bounds are stable across
catalog changes and still preserve ordering; only values outside them clamp.

#### The alternate-colour outline — owner proposal 2026-09-10, to be PROTOTYPED not decided

**Proposal:** render the 8px bar as the primary with a thin outline in the team's alternate, so the
bar is defined by an edge rather than by its own luminance.

**Measured against the production catalog, and it is a strong VISIBILITY instrument.** On the common
surface (`#09090B`, five of six contexts) at a 3:1 outline threshold, **the primary alone fails for 87
teams; both colours fail for only 6.** On the worst surface (`#333336`) both fail for 25.

**It is a WEAK DIFFERENTIATOR, and the four reds show why.** Ohio State's grey `#A7B1B7` reads at
9.11:1 and Indiana's and Oklahoma's white at 19.90:1 — but **Indiana and Oklahoma share a white
outline over dark red and still match**, and **Louisville's `#000000` outline is 1.06:1 against the
surface, contributing nothing.** White and black are the sport's two most common alternates.

**The two ideas are complementary, not alternatives, and that is the real finding.** The band must
currently lift 101 of 135 because the FILL alone carries visibility. **Give the bar a defined edge and
that burden drops** — the floor can fall well below 2.5, the remap gets a wider and gentler range, and
Oklahoma's crimson stays crimson rather than being pushed toward Louisville's cardinal.
**Outline for visibility, remap for differentiation.**

**Two costs to weigh at the walkthrough.** A second colour on every row doubles the chroma on a
deliberately monochrome surface — this campaign rejected gradients and full-width bands for competing
with the row's real signal, and a two-tone bar carries more visual weight than a solid one. And
**whether a 1px outline on an 8px bar reads at all on a non-retina display is a measurement nobody has
taken.**

**Owner decision 2026-09-10: prototype both on preview and look, rather than deciding from numbers.**

> **CORRECTED 2026-09-09 — this paragraph said "Work in OKLCH, not HSL" as an instruction, and the decision is STAGED.** `item-87-followon-team-colour.md` splits Item 119 into two separately shippable pieces: **(1) the 8px bar on the EXISTING HSL normaliser**, contrast-lifted to ≥3:1, and **(2) an OKLCH port ONLY IF (1) measures badly at 8px**, with the reserved-hue guard. **Piece 2 is conditional and is not a dependency of piece 1.** This document stated the endpoint as though it were the requirement — the reference is meant to consolidate settled decisions, and what is settled is the staging. Found by the Item 119 lane at its read receipt.

The OKLCH shape, when and if piece 2 happens: clamp lightness into band, cap chroma, preserve hue, clamp rather than scale. **A reserved-hue guard is required so a gold team's bar does not read as champion amber.**

**No colour, no bar.** FCS teams have none in the data (the refresh uses `/teams/fbs`). An absent bar reads as missing data; a grey bar reads as a team whose colour is grey.

### Prefix slot: rank or classification, never both

`#10` when ranked, `FCS` when FCS, empty otherwise. **Mutually exclusive by construction** — rankings derive from FBS poll data only, and `rankings.ts` explicitly rejects `FCS Coaches Poll`, failing closed rather than borrowing another division's rankings. No precedence rule is needed.

**Guard:** if a rank ever appears on an FCS team it indicates a data defect upstream. Render it and let it look wrong. A display rule that quietly hides impossible data makes the bug harder to find.

### Team name

Primary. Full display name, not an abbreviation.

### Record

**Inline parenthetical** on live and final rows; **the right-edge anchor** on scheduled rows. Always the **current** record — on a final row that means the post-game record, including the result just shown.

Position varies by state because the anchor holds whatever is most relevant for that state. One rule for the value, no state-dependent branching on what the record *means*.

### Owner

Tertiary suffix after the team name.

**`NoClaim` is never rendered.** It is an internal sentinel for an unowned team, written deliberately at the data layer. Displayed as an owner name it reads as a fourteenth member. **Absence is the signal.** Keep the value in the data model for analysis; guard at the render seam via `displayOwner()`.

Three unowned states render distinctly:

| State | Prefix | Owner shown |
|---|---|---|
| FCS opponent | `FCS` | none |
| Unowned FBS (`NoClaim`) | none | none |
| Owned team | rank if ranked | owner name |

---

## 4. The anchor

Right-edge, tabular numerals, **one per line, always**.

| State | Anchor holds |
|---|---|
| Scheduled | the record |
| Live | the score |
| Final | the score |
| Awaiting score | `–` |

**When the record is unavailable, the anchor is blank.** It does not fall back to the spread. A blank says the value is unavailable; a spread says the value is `−6.5`, which misrepresents what the slot means — a reader cannot tell whether they are looking at a record or a line. Missing data beats wrong data.

**Blank is correct in two different conditions that are not equivalent.** A store failure is transient and needs no item. "Not wired to this surface" is a sequencing state that needs a filed item and the dependency stated in the prompt. Collapsing them licenses shipping a permanently blank column and calling it correct degradation.

---

## 5. No date or time on final rows

A final row shows `FINAL` and the score. Nothing else.

**Why the sort key can be hidden:** kickoff order is inferable from position. Within a date group, games in kickoff order cluster finals first, then live, then scheduled, because earlier kickoffs are further along. The reader sees results at the top and upcoming games below without any row displaying a time.

*An earlier rationale — "the container supplies temporal context" — was weaker: it held for date-grouped Schedule and week-tabbed Matchups but broke on the postseason tab, which has no container. The sort-order argument holds everywhere.*

**Consequence, accepted:** the day of a completed game is not recoverable from the row on surfaces without date grouping. Judged acceptable — for a completed game the result is the information.

---

## 6. The odds / tier-2 line

Optional. Present on Matchups (nine games justifies it) and in Schedule's expanded body. Suppressed where sixty rows would make it noise.

**The band is reserved only when the caller supplies a footer contract.** A surface passing none renders no band. Within a surface that *does* render odds, a row without odds still reserves — that is what keeps the grid aligned. Reserving a band nothing will ever fill is not alignment; it is uniform dead space.

**Conference sits here, on its own line**, not appended to the odds string. Same-conference games collapse to "ACC matchup" rather than "ACC vs ACC". **FCS is a classification, not a conference** — this line names the actual conference; the FCS marker lives in the prefix slot.

---

## 7. Owner highlight — Matchups only

The card owner's row takes a background tint. **Matchups only**, because a card is scoped to one owner and "which of these teams is this card's owner's" is derivable from the card itself. Highlighting the *viewing member's* teams anywhere else requires a user↔owner mapping that does not exist.

### The tint tracks state across the game's life

| State | Treatment |
|---|---|
| Scheduled | neutral |
| Live, level | neutral — no direction yet |
| Live, ahead | green base + travelling band |
| Live, behind | red base + travelling band |
| Final, won | static green |
| Final, lost | static red |

**Hue carries direction; motion carries certainty.** An earlier version distinguished live from final by opacity alone, which read as one being slightly wrong rather than as two states. Motion makes them different in kind.

**Background, not text weight.** Weight already carries winner/loser on finals; emphasising the owner's team that way would render a losing team of theirs bold-and-dimmed — two signals arguing on one row.

**Neutral, not owner colour.** `DESIGN.md` reserves owner colour for lists acting as a chart legend. The Standings exception proves the rule rather than breaking it: rank numbers carry owner line colour there *because* that list is functionally a legend for the adjacent chart. A Matchups row has no chart to key to.

**Motion spec:** band travels and reverses (`alternate`, `ease-in-out`, ~4.5s each way). Easing matters — a linear reversal snaps at each end and reads as a bounce. Band at ~15% alpha over ~70% of the row: wide and soft rather than narrow and bright, so the same energy spread over more area reads as ambient. `prefers-reduced-motion` stops the sweep and keeps the base tint — a real degradation, since those users lose the provisional marker and keep only direction.

**Requires `isolation: isolate` on the row.** A `z-index: -1` pseudo-element paints behind the *stacking context*, not behind its parent, so without it the tint disappears under the card's background. And the obvious workaround — `position: relative` on row content — re-anchors the team colour bar and shifts it. This is load-bearing.

---

## 8. Weight emphasis

Winner weighted, loser dimmed. **On finals only.**

Suppressed on live games: dimming a team down three in the first quarter overstates what the score says, and the owner-row tint already carries direction there. A claim about a settled result should only be made once the result is settled.

---

## 9. Layout

**Schedule games are discrete blocks** — neutral fill `rgba(255,255,255,0.022)`, 5px radius, 7px/10px padding, no divider rules. At sixty games a flat divider list reads as one object. This is a partial reversal of removing card chrome, and deliberately so: what was removed was *status-coloured borders carrying meaning*; a neutral fill carrying grouping is a different instrument.

**Column tiers** are driven by container queries. Overview games 1/2/3 columns with the third above 1300px; Matchups owner cards at 1372px (higher — each card carries its own padding); Schedule blocks at 1320px. Each is derived from a minimum row width, not chosen. **If row anatomy changes — logos taking the line-start slot — the minimum moves and every breakpoint moves with it.**

**Block layout ignores grid `gap`.** At one column the grids become `display: block` and stack with no separation at all. Adjacent-sibling margins are required. This is easy to ship unnoticed because it appears at one breakpoint only.

**Date headings** carry a full-width rule above, asymmetric spacing binding them to the group below, and uppercase tertiary styling. A date heading is chrome, not content: making it bigger would fight the game rows; making it quieter but structurally distinct separates without competing.

---

## 10. Ordering

| Surface | Rule |
|---|---|
| Overview Live | kickoff ascending, nothing else |
| Overview Recent finals | kickoff descending, newest first |
| Overview watchlist | `watchlistPriority` first, then kickoff |
| Schedule | kickoff ascending within date groups |
| Matchups | non-final by kickoff, then finals by kickoff |

**No owner-count key anywhere.** Quantity of owners does not affect rank. Relevance promotion belongs to Featured; a hidden relevance key makes the order unreadable, since a member cannot tell why one game sits above another.

**No awaiting-score partition on Live.** A row that jumps to its kickoff position when a score arrives is a reposition on a polling surface, which is worse than a blank row sitting among scored ones.

**The watchlist keeps its priority key** — it is a *curated* list, so ordering by the reason for curation is legible rather than hidden, and it is where notable games that miss Featured's cap land.

**Matchups differs from Schedule for a structural reason:** Schedule is date-grouped, so chronology is structural there and moving finals to the end would tear games out of their date headings. A Matchups card has no grouping — one owner, one week, one list — so nothing structural depends on its order. The rule reduces to plain kickoff once a week completes.

---

## 11. Consumer matrix

Which slots each surface supplies. **A slot a surface does not pass renders nothing** — it does not reserve space, and it does not fall back.

| | Overview | Matchups | Schedule | Recap |
|---|---|---|---|---|
| **States rendered** | scheduled, live, final, awaiting | scheduled, live, final, **awaiting** | scheduled, live, final | final only |

> **AMENDED 2026-09-08 — Matchups renders `awaiting`, and this row previously said it did not.** It recorded
> what SHIPS rather than what is correct: Matchups never reaches `awaiting` because it decides its own status
> label, which is the defect Item 143 exists to fix. **A row past kickoff with no usable score renders `SCH`
> today** — a claim that the game has not started. `awaiting` is the honest state, the component already
> renders it, and Overview already reaches it.
>
> **No time limit, and that is measured rather than assumed.** Overview omits an unresolved row after eight
> hours because Live is a section that should empty; **a Matchups card is an owner's week and must never drop
> a game**, so `awaiting` persists until a score arrives. The obvious worry — a row stuck on `awaiting` for
> weeks — does not occur. **Measured across ALL SEVEN SEASONS in the cache, 2026-09-08** (the first pass
> covered 2026 only; a reviewer flagged the scope and extending it was cheaper than recording the limit):
> **fourteen games total are past kickoff without a final score — ZERO FBS and ZERO FCS.** Two are D-II/D-III
> in 2026; twelve are unclassified rows in 2023-24. **Not one is reachable on a Matchups card**, which shows an
> owner's FBS teams and their opponents. **Building a window for it would guard nothing**, which is the same
> mistake the stopped v3 branch made with disrupted statuses.
>
> **Schedule is NOT amended here.** Nobody has audited it (Item 181), and the same reasoning may or may not
> apply to a date-grouped surface. Do not extend this row by symmetry.
| **Status row** | yes | yes | yes | yes |
| **Tag slot** | yes | yes | yes | yes |
| **Team colour bar** | yes | yes | yes | yes* |

| **Rank / FCS prefix** | yes | yes | yes | yes |
| **Record** | yes | yes | yes | no |
| **Owner suffix** | yes | yes | yes | yes |
| **Anchor** | record / score / `–` | record / score | record / score | score |
| **Odds footer** | yes | yes | tier-2 body | no |
| **Tier-2 expansion** | no | no | yes | no |
| **Owner tint** | no | **yes** | no | no |
| **Broadcast** | scheduled, live | scheduled, live | scheduled, live | n/a |
| **Date grouping** | no | no | **yes** | no |
| **Week scoping** | no | **yes** (tab) | no | **yes** (week) |

> **\* The recap's `yes` is a FORECAST, not current — marked 2026-09-09.** The recap is not a consumer of this component at all: `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`. Its row describes what it would supply after adoption, which is blocked behind Item 143's seam. **Item 119 does not give the recap a bar**, and a reader comparing this table to the code should not read the gap as a defect.

**Three rows in that table are the whole reason it exists.** The owner tint is Matchups-only because a card is scoped to one owner. Date grouping is Schedule-only, which is why Schedule cannot reorder finals to the end. And the recap renders no records, which is why its status rows are frequently tag-only — a case no other consumer exercises.

---

## 12. Overview sections

Overview is the only surface that partitions by state. The others render one list and let each row declare its own state.

**Section order: Featured → Live → Recent finals → Upcoming watchlist.** Ordered by temporal distance from now — happening, just happened, coming up. Live sits above the watchlist because live games are the only content with a deadline; upcoming games are stable all week, and placing stable content above volatile content buries the thing that expires.

**The order is self-managing.** Empty sections hide, so outside a slate Live disappears and the watchlist rises without any conditional logic. The order asserts itself only when Live has content, which is exactly when it should.

**Section counts are totals, not visible counts** — but *not yet*. The current `.length`-after-`.slice` reads false, and making it a true total before Item 115 ships would state that ten games exist while four remain unreachable. The real defect is the silent cap; the count is only how it surfaces. Both land together.

**Recent finals uses displacement, not clearing.** It holds the N most recent completed games, displaced by newer results. No clearing event, no duration to calibrate. Week 0 solves itself.

**Awaiting score** is a distinct state: past kickoff, no score available, `–` on both anchors, routed to Live by kickoff time. It persists up to `GAME_MAX_DURATION_MS` — eight hours — so Live can show blank rows for an afternoon, not a brief gap. Item 115's cap work must handle scoreless rows specifically rather than treating cap as a volume problem.

---

## 13. Featured

**A separate axis from state**, not a fourth section. A featured game enters when selected and stays through scheduled → live → final, appearing **only** in the Featured tile and excluded from the state sections — preserving one game, one place.

That orthogonality is the whole point: every other section moves games between partitions as they progress; Featured exempts a game from that movement. It sits still while everything else flows past.

**Capped at four**, settled on the CFP-round argument.

**Selection belongs to the insights pipeline**, not to this component. Only pair-anchored insights qualify. The reason label occupies the tag slot and inherits its palette from `INSIGHTS-017-PALETTE`.

**Unresolved — Item 113.** The shipped Featured is *results-based*: filtered to completed games, rendered in recency order, which makes it close to a second Recent finals. The design intent is *must-watch*: selected before kickoff on insight criteria. These are different features sharing a name, with unrelated selection pipelines. Until 113 resolves it, do not build against either reading.

**The CFP round badge is slate, not bronze** — `deriveFeaturedGameBadge` has two branches and the sibling is already slate. Bronze there would split one badge family by hue with nothing a reader could decode.

---

## 14. The recap

**All rows are final.** No state variation, no live badge, no awaiting-score handling, no odds footer. This is an argument *for* using the shared component, not against: it exercises a subset of the states, passes nothing for the slots it does not need, and gets the anatomy free. A component with props unused by one consumer is unremarkable; a row rendering differently on one surface is the actual defect.

**Metadata carries only what the row cannot state itself.** "38-point margin" beside scores of 48 and 10 restates arithmetic already on screen. Margin, combined points and "zero points allowed" are all dropped as derivable. An upset's spread survives — the line is not visible anywhere.

The test is not whether a fact is interesting. Margin *is* interesting. It is whether the row already states it. Restating a visible fact costs a line and teaches the reader that the metadata slot is decorative.

**Consequence: most status rows are tag-only.** Six of seven in the mockup carry no metadata at all. The left group must hold open so the tag stays right-aligned — a case no other consumer exercises, since Matchups and Schedule always have a state label holding the left side.

**Adoption is blocked on Item 143.** The recap needs a tag in the status row and metadata beside it; neither seam exists. `contextSlot` renders *above* the header row and would add a line; `footerSlot` is scheduled-only. These are the same four "fits neither slot" findings that stopped Matchups — checked before scoping this time rather than after.

**Section titles name what they contain, not why games were selected.** *Notable results*, not *Head-to-head results* — which then tags every row `HEAD-TO-HEAD` and states one fact twice.

---

## 15. Postseason

Not yet built. **Item 154**, specified across three documents.

**Group by round; label the bowl on the row.** Round and bowl are two attributes, not one taxonomy — under the 12-team format the quarterfinals and semifinals *are* bowl games, so "Bowls" and "CFP rounds" are not disjoint and cannot both be group headings.

| Group | Bowl names present |
|---|---|
| CFP First Round | no — campus sites |
| Bowls (non-CFP) | yes |
| CFP Quarterfinals | yes — the game *is* a bowl |
| CFP Semifinals | yes |
| National Championship | no |

Groups run in calendar order, which interleaves: first round, then non-CFP bowls, then quarterfinals. **The bowl name is a per-game eyebrow**, in the tag slot — so a row reads *Rose Bowl* under a *CFP Quarterfinals* heading, and both facts survive.

**Group from `playoffRound` and `postseasonSubtype`; order from `startDate`. Never from `week`** — postseason week 1 spans first-round games, non-CFP bowls *and* the championship.

**CFP group membership is `playoffCompetition === 'cfp'`** — a positive test on provider data. A round that fails to parse loses its subgroup, not its bracket, and cannot fall into non-CFP Bowls even by accident.

**Reuse `deriveFeaturedGameBadge`** for round labels rather than re-deriving them. It returns `null` for non-CFP bowls, which independently confirms the bowl name belongs in the row eyebrow rather than as a round badge.

**Identity collision — Item 121.** All four CFP first-round games share `eventKey: "cfp-first-round"`, and therefore one `eventId`. The key composes `cfp-${round}` and appends a bowl name; first-round games are campus-hosted and have none. `eventId` is also the React list key and the operator label-override key, so four identical keys land in one list.

The fix is not adding a team id to the composed key. `eventKey` is doing two jobs — naming a bracket **slot** before teams are known, and identifying a **resolved** game after. `cfp-first-round` is a correct slot name; the defect is resolved games inheriting it. Prefer `providerGameId` once a real game exists, keep the round key for the TBD slot. That fix changes a game's key mid-lifecycle, so anything holding the old key across resolution must survive or migrate it.

**Typing trap:** `schedule.ts` omits `'first-round'` from the named union while the wire type includes it. The value survives at runtime through the `| string` arm, so a grouping `switch` written against the named union silently drops all four first-round games — and a test suite generated from that union would pass.

---

## 16. What is easy to ship wrong

Collected because each was found the hard way.

**State defined by negation.** `!== 'scheduled'` means every state not named inherits the branch. Enumerate per state.

**Block layout ignores grid `gap`.** At one column the grids become `display: block` and stack with no separation. Needs adjacent-sibling margins. Appears at one breakpoint only.

**`margin-left: auto` on the tag.** Silently does nothing when the row overflows, which is the common case at column width.

**Missing `min-width: 0`.** The tag clips instead of the metadata, being last in DOM order — backwards.

**`z-index: -1` without `isolation: isolate`.** The tint paints behind the card, not behind the row. And the obvious workaround shifts every colour bar.

**Reserving a footer band a surface never fills.** Not alignment; dead space.

**A breakpoint derived from row anatomy, then anatomy changing.** Every tier moves when the row does. Logos in the line-start slot are the next one.
