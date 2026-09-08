# Item 87 — Follow-on input: card-owner team highlight on Matchups

> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.
>
> **Status:** decision settled; component seam merged via PR #575; UI adoption remains Item 117.
>
> **INDEX (verified 2026-09-08 after a full read): CURRENT.** Nothing later overrides any decision here. Item 117
> has since shipped the adoption (PR #581, 2026-09-07). This file was twice marked SUPERSEDED by readers who had not
> opened it; the reading that `presentation-decisions.md` supersedes it is wrong and is marked at the paragraph it
> concerns.

Origin: member feedback on the Matchups page — *"this screen should color my teams."*

---

## What is buildable, and what is not

**Not buildable: highlighting the viewing member's teams globally.** There is no mapping from a signed-in identity to a league owner. Clerk establishes who is signed in; owner identity comes from the league roster, and the two are not linked. Without that link the app cannot answer "which teams are *yours*" on Overview, Schedule, or inside another owner's Matchups card.

**Buildable: highlighting the card owner's teams on Matchups.** A Matchups card is already scoped to one owner, so "which of these two teams belongs to this card's owner" is derivable from the card itself, with no identity linkage required.

That distinction is why this is a Matchups-only feature rather than an app-wide one.

---

## Decision — neutral background tint on the card owner's row

**Background, not text weight.** Weight already carries winner/loser on final rows. Emphasising the owner's team that way would render a losing team of theirs bold-and-dimmed — two signals arguing on one row. A tint sits behind the text and leaves the outcome hierarchy intact. Same reasoning that rejected the team-colour gradient, applied in the other direction.

**Neutral rather than owner colour.** `DESIGN.md` reserves owner colour for lists acting as a chart legend, so using it here would be a rule change rather than an application of one. It would also be a third identity colour on a single row, alongside the team-colour bar at line start. The mockup keeps an owner-colour variant behind a toggle for comparison only.

> **CURRENT — and it is the IDENTITY axis only (verified 2026-09-08).** "Neutral" here rejects OWNER colour: the
> whole argument is the legend reservation and a third identity colour. `item-87-followon-presentation-decisions.md`
> → *The tint tracks state across the game's whole life* gives the same tint an OUTCOME hue once a direction exists
> (neutral while scheduled or level; green/red ahead, behind, won, lost). Not owner-coloured, and outcome-coloured
> once a direction exists: both hold, and that document extends this one rather than superseding it. "The
> team-colour bar at line start" is a dependency, not a fact about shipped code — slice 5 deleted the bar and Item
> 119 restores it (`item-87-followon-team-colour-regression.md`).

Owner colour is reserved for lists acting as a legend for an adjacent chart. `DESIGN.md:321` records Standings rank numbers as an exception, carrying owner line colour — but that is the rule's rationale applying, not a hole in it: that list is functionally a legend for the chart beside it. The exception sits exactly where the reservation's reasoning holds, which makes it a test. A Matchups row tint has no chart to key to, so it fails the test the exception passes.

**Dimming the card owner is rejected.** An earlier draft offered it as the alternative, on the reasoning that the repeated owner name was noise. The tint supersedes it: dimming distinguished the owner's row by *suppressing* the other one, costing legibility on the opponent to gain it on the owner. The tint marks the row positively and leaves both sides readable. Same class of improvement as the anchor rule — encode the thing you mean rather than degrade what you don't.

This closes the card-owner treatment question that had been open since the Matchups mockup was built.

---

## Implementation notes from the mockup

Two stacking bugs surfaced while building it, both worth knowing:

**A pseudo-element at `z-index: -1` paints behind the stacking context, not behind its parent.** The tint disappeared under the owner card's own background. Fix: `isolation: isolate` on the row, so the row becomes its own stacking context and the tint lands behind the row's text rather than behind the card.

**Lifting row content above the tint by making children `position: relative` breaks the team-colour bar.** The bar is absolutely positioned against `.sb-line`; making `.who` positioned re-anchors it, shifting every bar on a highlighted row. `isolation` removes the need for that rule entirely.

---

## Adjacent tinted rows — squared facing corners

**Owner decision 2026-09-06.** On a self game both rows tint, so two tints sit adjacent. Three
behaviours are possible at the seam and only one is right:

- **Rounded on both, no vertical bleed** (`inset: 0 -8px`) — the two blocks curve away from each other
  and leave a light pinch at each end of the seam.
- **Negative vertical bleed** (`inset: -1px -8px`, the mockup's original) — the tints overlap, and two
  5.5% layers read as a **darker stripe** across the seam. **Ruled out**: a darker artifact is more
  visible than a lighter one, and avoiding it is why the implementation moved to zero inset.
- **Squared facing corners — CHOSEN.** When the adjacent row is also tinted, the touching corners
  square off so the pair reads as one block with rounded outer corners only. No overlap, so no
  doubled alpha, and no pinch.

The component already knows both participants, so the condition is available without new plumbing.

**Deviation from the mockup, recorded so it is not "restored".** The mockup specifies
`inset: -1px -8px`. The implementation ships `0 -8px` plus squared facing corners. Anyone reconciling
the two should change the mockup, not the code — the mockup's value predates the both-rows-tint rule
and produces the darker stripe above.

> **LIVE OBLIGATION — INDEX CARRY row 6 (verified 2026-09-08), and applied to the mockup on this pass:**
> `mockups/matchups-schedule-mockup.html` now carries `inset: 0 -8px 0 12px` with squared facing corners between
> adjacent tinted rows, matching the shipped component (`DESIGN.md` → *The optional `isCardOwnerTeam` participant
> modifier*). The code was not touched.

## Horizontal bleed and flush focus rings

**Owner decision 2026-09-06.** Keep the 8px horizontal bleed and accept a caller constraint rather
than changing this slice. Item 117's intended Matchups owner card has 14–16px horizontal padding, so
the tint stops 6–8px before that card's outer focus ring.

> **CURRENT (verified 2026-09-08):** Item 117 shipped (PR #581) and `DESIGN.md` records the same constraint under
> *Horizontal-bleed integration constraint*. Schedule still supplies no `isCardOwnerTeam` flag.

Continuing the 2026-09-06 decision: `GameWeekPanel` places its ring flush around
the scoreboard and a tinted descendant would paint over it, but Schedule supplies no
`isCardOwnerTeam` flag and is not a consumer of this feature.

If a future user↔owner mapping makes Schedule a consumer, that integration must first paint its focus
indicator above descendant content or add an inner horizontal gutter. The zero-consumer state is not
evidence that a flush ring and the bleed compose safely; it is why no Schedule change belongs here.

## Residual — this ships the legibility fix, not the request

The feedback said *my* teams. On that member's own card the card owner and the member coincide, so the highlight answers it. **On another owner's card it does not** — Matt's card highlights Matt's teams, which is a coherent rule but not what was asked for.

Worth being explicit about that when it lands, rather than treating the feedback as closed.

---

## The blocked feature, filed

**Highlight the viewing member's teams on every surface** — inside other owners' Matchups cards, on Overview, on Schedule. Substantially more useful than the per-card version, and it is what the feedback asked for.

**Blocked on a user↔owner mapping.** That linkage is presumably in scope for the multi-tenant work; if so, this is a concrete consumer of it worth noting there rather than a hypothetical benefit.

Filed now despite being unbuildable, so the dependency is recorded in the direction that matters: not "this feature is blocked," but "identity linkage unlocks this."

> **NOT IN THE QUEUE (verified 2026-09-08):** "filed" means this section; `docs/next-tasks.md` carries no item for
> the viewing-member highlight or the user↔owner mapping it needs. Reported to planning as an Item 144 queue
> finding. The residual above ("this ships the legibility fix, not the request") is likewise unrecorded in the
> Item 117 closeout.
