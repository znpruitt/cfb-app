# Movement insights — the model

Status: Current
Last verified: 2026-08-19
Owner: Insights engine
Canonical for: what each movement-shaped insight card asserts, what population it measures, and
who may be its subject
Supersedes: (none)

Written during `INSIGHTS-033` because the year-over-year card had been wrong four different ways in
three passes, each fix producing the next round's finding. Every defect was a copy branch reading a
partition the code had computed correctly somewhere else. The fix for that is not another patch; it
is writing down what each card claims before touching it.

## The distinction that was missing

**A climb is an internal season fact. A season-to-season swing is a different insight altogether.**
(Owner ruling, 2026-08-19.) The generator named `improvement` — headline "Biggest year-over-year
leap" — compares two archives' final ranks, so it was always the *swing*, never the climb. The climb
card did not exist.

Four cards, four distinct facts. Listed by id prefix and `InsightType`, because
those are what a reader can grep for — an earlier version of this table invented
names (`improvement_record`, `climb`, `slide`) that match nothing in the code.
Note the two archive cards SHARE the `improvement` type and are told apart by id,
which is also why the departed-owner exemption below is granted by id prefix and
never by type.

| Id prefix | `InsightType` | Fact | Window | Subject |
| --- | --- | --- | --- | --- |
| `season-swing-<year>-` | `improvement` | Largest rank gain between the two most recent completed seasons | Two archives | Whoever made it |
| `season-swing-record-` | `improvement` | Largest single season-to-season rank gain in league history | Every archive pair | Whoever holds it |
| `season-climb-` | `season_climb` | Largest rise from an owner's LOWEST rank this season to their current rank | Current season, weekly | A current participant |
| `season-slide-` | `season_slide` | Largest fall from an owner's HIGHEST rank this season to their current rank | Current season, weekly | A current participant |

**A gain is measured against the owners present in BOTH seasons.** Raw finishing
position is not comparable across seasons of different size: a league going from
six owners to three hands everyone who stayed a three-place "gain" for doing
nothing, and the record card would enshrine that artifact permanently. Ranking
within the common set removes it by construction; for an unchanged roster the
numbers are identical.

These are deliberately distinct from two cards that already exist and must not be duplicated:
`existing:trajectory`'s `movement` is week-over-week (last resolved week vs the one before), and its
`surge` is a trailing-window burst gated on wins and games-back gain. Neither measures a
season-scale rise, which is why `season_climb` is new rather than a rename.

## Populations, and who may be named

**A record is a fact about the league's history; membership only decides who may be NAMED.**
That is `INSIGHTS-030`'s rule and it holds here. What `INSIGHTS-033` adds is that the partition has
to be carried through *every branch of the copy*, not just applied to the population — a title
saying "Longest" over a member-only search is the same defect as the body saying it.

- Both `season-swing-` cards measure over **every owner in the archives**. No membership filter at
  all.
- `season_climb` and `season_slide` measure over the **current season's standings**, whose rows are
  by definition this season's participants. Membership is not a question these two can ask wrongly.

**Subject may be a departed owner** for the two archive cards (owner ruling, 2026-08-19). A
completed season's biggest mover is a fact about that season in the same way its champion is, and
withholding it is itself a claim — the reasoning `INSIGHTS-032` established for `season_wrap`. This
requires an exemption from the departed-owner wiring rule, granted **by id prefix only** and
recorded in `AGENTS.md` Insights invariant 5. It is sound **only while the copy names its season**,
which is why the year is mandatory below and pinned by test rather than assumed.

## Copy rules

1. **Both archive cards state their years.** "Alice climbed from 9th to 2nd between 2024 and 2025."
   A record from another season is meaningless without it, and the year is what makes naming a
   departed owner safe.
2. **`season-swing-record-` is suppressed when it would name the same climb as the season card** —
   same owner, same season pair. Two cards saying one sentence is worse than one card. The record
   card also states its season in the TITLE, since it is the one that names a holder from an
   arbitrary past year.
3. **`season_climb` and `season_slide` name the week the extreme was set**:
   "Alice has climbed from 9th in week 4 to 2nd." The baseline is the owner's own
   season low (or high), so it moves as the season goes — an owner who drops
   further resets it, and returning to the same rank later resets it too, so the
   week named is the most recent one at that extreme. **A tie names every
   owner's own baseline and week**, one sentence each; collapsing them into a
   shared distance drops the week this rule requires.
4. No card asserts that anyone is still playing. The archive cards describe a finished season; the
   season cards describe the standings as they are.

## What this model does NOT cover

- A year-over-year FALL card. `trending_down` reports multi-season decline and `movement` reports
  the week's biggest drop; a season-to-season fall card was not requested and is not implied.
- An all-time record for `season_climb`/`season_slide`. Archives do carry `standingsHistory`, so it is
  computable, but it needs every archived season's weekly snapshots to be complete and was not part
  of this slice's approval.
