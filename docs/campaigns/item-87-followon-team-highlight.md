# Item 87 — Follow-on input: card-owner team highlight on Matchups

> **Status:** input for review, not applied.

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

Owner colour is reserved for lists acting as a legend for an adjacent chart. `DESIGN.md:321` records Standings rank numbers as an exception, carrying owner line colour — but that is the rule's rationale applying, not a hole in it: that list is functionally a legend for the chart beside it. The exception sits exactly where the reservation's reasoning holds, which makes it a test. A Matchups row tint has no chart to key to, so it fails the test the exception passes.

**Dimming the card owner is rejected.** An earlier draft offered it as the alternative, on the reasoning that the repeated owner name was noise. The tint supersedes it: dimming distinguished the owner's row by *suppressing* the other one, costing legibility on the opponent to gain it on the owner. The tint marks the row positively and leaves both sides readable. Same class of improvement as the anchor rule — encode the thing you mean rather than degrade what you don't.

This closes the card-owner treatment question that had been open since the Matchups mockup was built.

---

## Implementation notes from the mockup

Two stacking bugs surfaced while building it, both worth knowing:

**A pseudo-element at `z-index: -1` paints behind the stacking context, not behind its parent.** The tint disappeared under the owner card's own background. Fix: `isolation: isolate` on the row, so the row becomes its own stacking context and the tint lands behind the row's text rather than behind the card.

**Lifting row content above the tint by making children `position: relative` breaks the team-colour bar.** The bar is absolutely positioned against `.sb-line`; making `.who` positioned re-anchors it, shifting every bar on a highlighted row. `isolation` removes the need for that rule entirely.

---

## Residual — this ships the legibility fix, not the request

The feedback said *my* teams. On that member's own card the card owner and the member coincide, so the highlight answers it. **On another owner's card it does not** — Matt's card highlights Matt's teams, which is a coherent rule but not what was asked for.

Worth being explicit about that when it lands, rather than treating the feedback as closed.

---

## The blocked feature, filed

**Highlight the viewing member's teams on every surface** — inside other owners' Matchups cards, on Overview, on Schedule. Substantially more useful than the per-card version, and it is what the feedback asked for.

**Blocked on a user↔owner mapping.** That linkage is presumably in scope for the multi-tenant work; if so, this is a concrete consumer of it worth noting there rather than a hypothetical benefit.

Filed now despite being unbuildable, so the dependency is recorded in the direction that matters: not "this feature is blocked," but "identity linkage unlocks this."
