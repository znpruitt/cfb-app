# Item 87 — Follow-on input: Matchups and Schedule design decisions

> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.
>
> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.
>
> **INDEX (verified 2026-09-08 against the code): PARTLY SUPERSEDED — and mostly DISCHARGED, not stale.** The
> three defects, the four contract widenings, the Schedule tier/sort/disclosure decisions, the bronze pills and
> steps 1–5 of the recommended order all shipped (POLISH-021, slice 5a PR #570, slice 5 PR #572, Item 117
> PR #581). Superseded: *Open — card-owner treatment* (team-highlight tint), *Same component, different
> consumption* (both claims), and "the filter cuts it" (Item 118, unbuilt). Each is marked in place below.

**Additive.** References but does not modify the base addendum. **Correction:** an earlier draft cited `item-87-followon-matchups-schedule.md` as a predecessor holding the contract additions. **That file was never committed and does not exist in git.** The additions it was said to carry are therefore recorded nowhere — they are written down below instead. This is the same failure mode that produced the Featured contradiction: a decision referenced as settled that no document actually holds.

**Reference mockup:** `mockups/matchups-schedule-mockup.html`

---

## Defects found — independently fixable, do not gate on this transition

Three defects surfaced while designing against the shipped views. All are separable from the transition and at least one is user-visible today.

### 1. `NoClaim` renders to members as an owner name — fix now

The Schedule shows "NoClaim vs LHooper" on the Massachusetts–Rutgers row. `NoClaim` is the league's internal convention for an unowned team, not a person; presented in the owner slot it reads as a fourteenth member.

**Verified entry point:** written deliberately at the data layer — `draft.ts:181` and `:240` write `NoClaim` into the owners CSV for unowned FBS teams; `rosterByTeam` (`CFBScheduleApp.tsx:637-640`) maps team → `'NoClaim'`; `getOwnerForGameSide` (`gameOwnership.ts:58`) returns it; nothing between there and the DOM guards it. Three surfaces render it to members: the Schedule collapsed line (`GameWeekPanel.tsx:232`), Schedule and Postseason expanded rows (`GameScoreboard.buildTeamContext:128-129`), and a literal `NoClaim (FBS)` badge on Matchups (`selectors/matchups.ts:42` → `MatchupsWeekPanel.tsx:285`). Overview is the model — it guards with `=== NO_CLAIM_OWNER ? null` at every scoreboard call site.

**Rule:** a `NoClaim` owner renders **no owner suffix at all**.

**Implementation caution:** do not change `getOwnerForGameSide` to return `undefined` for the sentinel — `standings.ts:91 hasOwnedTeam` and `insights/context.ts` read the roster and may depend on it. This is a presentation rule: add one `displayOwner()` helper at the three render seams and converge Overview's six inline guards on it. The absence is the signal, exactly as it is for an FCS opponent. The sentinel stays in the data model — it supports analysis and future insights over the unowned bucket — so this is a presentation rule only: never map the sentinel into the owner slot.

This is a small, visible, self-contained fix. It should not wait on a cosmetic transition.

> **DISCHARGED (verified 2026-09-08):** POLISH-021-NOCLAIM-PRESENTATION shipped `displayOwner()` in
> `src/lib/gameOwnership.ts`; Schedule (`GameWeekPanel.tsx:101-102`) and Matchups (`MatchupsWeekPanel.tsx:171-172`,
> `:415`) render through it. The sentinel stays in the data model, as this section required. A third read of the
> sentinel as an owner was later found in the owner-count sort key and deleted
> (`item-87-followon-section-ordering-resolutions.md` → *Noted while removing the owner-count keys*).

### 2. The collapsed row drops the owner when only one side is owned

The shipped Schedule renders UAlbany at Buffalo with no owner, though Buffalo is Jackson's; the owner line appears to fire only for owner-vs-owner games. **Low severity** — Matchups is the purpose-built view for an owner's full slate — but still an inconsistency. The transition resolves it as a side effect, since the scoreboard lists owners unconditionally.

> **DISCHARGED (verified 2026-09-08):** slice 5 (PR #572) — every Schedule row renders both owner suffixes through
> the shared row.

### 3. Inconsistent team naming within one card

The shipped expanded view renders "ualbany" lowercase against "BUF" abbreviated in the same card, suggesting two naming sources feeding one view. **Verified:** `GameWeekPanel.participantDisplayInfo` (`:57-68`) falls back to `participant.displayName`, which is the canonical id slug (`schedule.ts:706`) when `labels` is undefined for a non-catalog team; catalog teams get `labels.scoreboardName` via `pickDisplayLabel` (`teamIdentity.ts:171-176`) → `BUF`. **Fix:** fall back to `csvAway`/`rawName` (`schedule.ts:715`), the proper-cased provider name, not the id. A few lines. **Bundle with the `NoClaim` fix** — both are presentation-layer, tiny, and visible today.

> **DISCHARGED (verified 2026-09-08):** `participantDisplayInfo` no longer exists; the Schedule selector falls back
> to `participant.rawName` before `displayName` (`src/lib/selectors/gameWeek.ts:113`).

---

## Contract widenings — currently unrecorded, must be written down before implementation

`CompactGameScoreboard` does not support these today. None is in the base addendum or `DESIGN.md`. **Record them before any consumer is built**, or a second campaign will discover them the way this one did.

> **DISCHARGED (verified 2026-09-08):** recorded and built as slice 5a (PLATFORM-087 / PR #570, 2026-09-05) before
> slice 5 and Item 117 consumed them. `DESIGN.md` → *Cards and game results* carries the prefix rule, the header
> metadata order with broadcast on scheduled/live/awaiting, the neutral-site label, and the non-reserving tier-2
> slot. A reviewer reported this section as a stale claim because nothing had marked it done — it is the named
> DISCHARGE case in `AGENTS.md`. Per-widening marks follow.

### 1. Prefix slot accepts a classification marker

Renders `#rank` only today (`CompactGameScoreboard.tsx:45-47`). It must also accept an FCS marker.

**No precedence rule is needed — the collision cannot occur.** Rankings are derived from FBS poll data only, so an FCS team never carries a rank. The two markers are mutually exclusive by construction of the ingestion pipeline, not by display convention.

That makes the prefix slot a single-valued classification marker: rank if ranked, FCS if FCS, otherwise empty. No precedence logic, no ambiguous case to test. *This closes the CLI's open question; an earlier draft proposed a precedence rule on the assumption the data permitted both.*

**Guard worth keeping anyway:** if a rank ever appears on an FCS team it indicates a data defect upstream, not a display case. Rendering the rank and letting it look wrong is preferable to silently masking it.

> **DISCHARGED and CURRENT (verified 2026-09-08):** `rank`, `rankSource` and `classification` are all on the
> participant props (`CompactGameScoreboard.tsx:12-14`); the render is rank first, else `FCS`, else nothing
> (`:189-193`). "No precedence rule is needed" is NOT stale: the mutual-exclusion claim about the data still holds,
> and the display guard in the paragraph above is exactly what `DESIGN.md` records ("a ranked-FCS collision is an
> upstream-data defect, and the defensive display rule lets rank win"). Item 117 pinned that precedence by test.

### 2. Neutral-site marker

`usesNeutralSiteSemantics` (`gameUi.ts:5`) already drives the `vs` separator on `GameWeekPanel`, and `neutralSite` / `neutralSiteDisplay` flow through `schedule.ts:79, :133` → `AppGame.neutral` / `neutralDisplay`. `CompactGameScoreboard` has no marker. Nominal away/home are always populated, so **away → home ordering is unchanged** and this is purely a metadata marker on the date line.

**Postseason forces this independently of the transition** — conference championships arrive first, then bowls and the CFP. Worth shipping as a standalone widening rather than waiting.

> **DISCHARGED (verified 2026-09-08):** `neutralSite` prop at `CompactGameScoreboard.tsx:23`, defaulted `:85`,
> rendered `:151` as the trailing `Neutral site` header label (slice 5a). Schedule passes
> `usesNeutralSiteSemantics(g)`; Matchups passes `game.neutral`.

### 3. Broadcast on live rows

`CompactGameScoreboard.tsx:16-19` gates broadcast on `state === 'scheduled'`. The design calls for it on **scheduled and live** rows, and not on finals — a completed game's broadcast is dead information. Third widening, previously unstated.

> **DISCHARGED, with the state set widened (verified 2026-09-08):** shipped as `showsBroadcast = state !== 'final'`
> (`CompactGameScoreboard.tsx:111`), so **awaiting** carries broadcast too — the owner ruling recorded in `DESIGN.md`
> and in the correction under *Broadcast network is tier 1* below. `DESIGN.md` has since ruled that state-dependent
> rendering is enumerated per state, never by negation; the enumerated set is scheduled, live, awaiting.

### 4. Odds position — three conflicting positions on record

The design doc has said "suppressed on Schedule"; the mockup places spread/O/U/ML in tier 2; the base addendum's slice-5 contract says "Schedule attaches odds… the row exposes slots." **Settled here: odds live in the tier-2 expanded body on Schedule** — present but not competing with sixty rows of tier-1 content — and inline on Matchups, where nine games per card justify them. This supersedes "suppressed on Schedule."

> **HALF DISCHARGED (verified 2026-09-08):** the Schedule half shipped — `oddsSummary` renders inside the tier-2
> `<details>` (`GameWeekPanel.tsx:182`, selector `gameWeek.ts:262`). The Matchups half did NOT: Item 117 shipped no
> odds text. **CORRECTED 2026-09-08 — the rest of this note was wrong and it propagated.** It read that because the
> component's odds footer was gated to `scheduled` rows, "inline on Matchups" for **live and final** rows was an
> Item 143 divergence. **That inferred a REQUIREMENT from a CODE CONSTRAINT.** The widening above names no state,
> and the mockup names them: **all six `sb-odds` elements sit in SCHEDULED blocks — none on live, none on final** —
> with `Line not posted` as the explicit empty case. The wrong sentence reached INDEX CARRY row 29 and then Item
> 143's divergence table before an implementer's read receipt stopped on it. **LIVE for Matchups, scheduled rows
> only — now Item 168.**

### 5. Amber `upset` card border — needs an explicit decision

`GameWeekPanel.tsx:42` `cardEmphasisClasses` renders an amber border for upsets, which is a reserved-colour violation. **But the base addendum explicitly exempts it** as "emphasis, out of scope for every slice." The transition deletes the card chrome it lives on, so the exemption becomes moot by accident. Either re-scope the exemption or record that the transition retires it deliberately — do not let it lapse silently.

> **HALF DISCHARGED (verified 2026-09-08):** the border is gone — slice 5 deleted `cardEmphasisClasses` and the
> registry entry records "the retired one-line/card-emphasis implementation". What is still missing is the
> DECISION: neither the registry nor `DESIGN.md` says the border was deliberately retired with the eyebrow pill
> carrying its emphasis forward (`DESIGN.md` never mentions `upset`). INDEX CARRY row 4 stays LIVE for that half;
> the base addendum's exemption is marked retired.

---

## Three unowned states, rendered distinctly

Unowned FBS teams exist (that is what `NoClaim` represents), which resolves an earlier open question. Three states now render differently, and the distinction is meaningful rather than incidental:

| State | Prefix | Owner suffix | Example |
|---|---|---|---|
| FCS opponent | `FCS` marker | none | Abilene Christian, UAlbany |
| Unowned FBS (`NoClaim`) | none | none | Massachusetts, Purdue |
| Owned team | rank, if ranked | owner name | Rutgers · LHooper |

Beating an FCS team and beating an unowned FBS team are different achievements, which is why the FCS marker stays separate from the owner slot rather than collapsing into a single "unowned" treatment.

---

## Schedule — design decisions

> **`DESIGN.md` governs the shared scoreboard's STATE behaviour; this section governs Schedule's
> layout.** This document predates the slice 5a rulings, and three of its statements about state
> behaviour have now been found stale against `DESIGN.md` — finals carrying a kickoff time, broadcast
> on `awaiting`, and the live row's clock. Each is corrected in place below. **Where this section
> states what a STATE renders, check `DESIGN.md` first** — it is canonical for UI and carries the
> dated owner rulings. What is genuinely Schedule's to decide is tier assignment, sort, grouping and
> disclosure.

### The scoreboard is the row; there is no one-line collapse

The shipped collapse hides the wrong tier. **Tier 1** is teams, owners, records, score and broadcast — what a schedule is *for*. **Tier 2** is venue, moneyline and conference. Collapsing to one line hid tier 1 to protect against tier 2, which meant expanding a finished game just to see the score.

Now the scoreboard always renders and only tier 2 sits behind a "More" affordance.

> **DISCHARGED (verified 2026-09-08):** slice 5 (PR #572) — tier 1 always visible, tier 2 (venue, odds,
> conference, admin override) behind More/Less (`GameWeekPanel.tsx:182-200`).

**Cost:** roughly double the scroll — two columns at ~60 games a week approaches 2,000px. Acceptable because the filter cuts it to the live handful in one click, and because the alternative hid scores on a results view.

> **CURRENT but its premise is UNBUILT (verified 2026-09-08):** there is no state filter on Schedule; "the filter
> cuts it to the live handful" is Item 118. The scroll cost is being paid today without the mitigation.

**Expansion may not survive.** What remains behind it is venue and city (mildly useful), moneyline (niche) and conference matchup (inferable from the teams). If unused it can go entirely, leaving a plain scoreboard with no interaction. Retained for now because removing information that exists today should be a decision, not a side effect.

### Broadcast network is tier 1

"Can I watch this" is the question a schedule answers, so the network sits in the status row beside the kickoff or game clock. It renders on **scheduled, live and awaiting rows — not finals**. A completed game's broadcast is dead information, and the row's job at that point is the result.

> **DISCHARGED (verified 2026-09-08):** broadcast renders in the status row on scheduled, live and awaiting rows
> (`CompactGameScoreboard.tsx:111`, selector `gameWeek.ts:260`).

**Correction 2026-09-05.** This section previously said "scheduled and live rows only", omitting `awaiting`. That predates the owner ruling now recorded at `DESIGN.md:182`: *awaiting is an indeterminate post-kickoff subset of live, and a broadcast label names the game's carrier rather than claiming the game is currently on air.* `DESIGN.md` governs. Same principle as the anchor: the status row carries what is actionable for that state. Games with no listed broadcast omit it rather than rendering a placeholder.

### Conference sits in tier 2, on its own line

Not appended to the odds string, where it read as an afterthought and coupled two unrelated facts. Conference is context rather than something a member acts on, and the page already carries a conference *filter*, so the dimension is handled at page level — the row only needs to state it.

**Same-conference games collapse** to "ACC matchup" rather than "ACC vs ACC". Conference is strictly a team attribute, so the "X vs Y" form is a game-level summary of two facts and needs this special case.

**FCS is a classification, not a conference.** The conference line must name the actual conference (United Athletic, Coastal Athletic, Big Sky); the FCS marker lives in the prefix slot. Easy for a classification to leak into a conference field — worth checking the data distinguishes them.

> **DISCHARGED (verified 2026-09-08):** the tier-2 conference line shipped as `conferenceSummary`
> (`gameWeek.ts:263`). The leak check this paragraph asks for is not recorded anywhere; treat it as unverified.

**Alternative if conference proves tier 1:** abbreviate it (ACC, B1G, MW) and place it inline on the team line. Rejected for now — that line already carries a colour bar, rank or FCS marker, team, record and owner, and conference would be the sixth element. If the page-level filter makes members expect it per row, the inline form is the fallback and something else has to give way.

### Sorted strictly by kickoff, ascending, within each date group

A schedule's contract is time order, so live games are **not** floated to the top the way the Overview promotion model does — the filter covers "show me what's live" without breaking the one guarantee the view makes.

**Kickoff times render on SCHEDULED rows. Live rows carry the in-game clock instead, and finals
carry neither — owner decision 2026-09-05, reconciled with `DESIGN.md:204`.** A live row's status row
is a green dot plus `Live` plus the game clock (`Live · Q3 8:12` in the mockup); the kickoff has
already happened, so the clock is the actionable value. `awaiting` carries its neutral
`Awaiting score` label with no clock, since the absence of a clock is the state. An earlier draft of this section said the opposite ("kickoff times therefore render on
every row including finals: with the sort keyed to a value, hiding that value on most rows makes the
order look arbitrary"). **That was wrong, and it contradicted `DESIGN.md:208`**, which states that a
final row carries no date and no time and names *date-group headings on Schedule* as the container
supplying temporal context — a dated owner decision of 2026-09-04. `DESIGN.md` is canonical for UI;
this document was the one in error.

The reasoning that resolves it rather than merely overruling it: **a kickoff time is a useful fact
only while the game is in the future.** For a completed game the result is the information. And the
"order looks arbitrary" objection does not survive — the rows are still sorted by kickoff, so for
finals the ORDER ITSELF carries the relative timing. The value is redundant on those rows, not
hidden.

**Open — landing position.** Ascending order means a mid-Saturday visit opens on the morning's finals with live games below the fold. Options: leave it, scroll to the first non-final game on load, or anchor the current date group. A scroll-position question, not a sort question.

> **DISCHARGED above, OPEN here (verified 2026-09-08):** the kickoff sort and the per-state status value shipped in
> slice 5 (`gameWeek.ts:254-259`: clock on live, kickoff on scheduled, nothing on final). Landing position is still
> undecided and unowned — INDEX CARRY block.

### The status key becomes a real filter

The FINAL / IN PROGRESS / SCHEDULED pills were a colour key for the status-coloured cards — useless before this transition and meaningless after it, since the colours they explained are gone. Replaced with single-select state filtering.

- **Counts are the point.** Sixty-plus games a week; the problem is finding the two live ones. Counts answer "is anything live" without a click.
- **Zero-count states dim rather than disappear**, so the absence is stated rather than implied, and the bar does not reflow through the day.
- **Chips are neutral, not status-coloured** — colouring them would reintroduce exactly what the transition removes and spend palette on a persistent control.
- Empty date groups hide under a filter rather than leaving orphaned headings.

**This is additive functionality**, not part of the transition proper, and should be scoped as such.

> **DISCHARGED as a scoping instruction, UNBUILT as a feature (verified 2026-09-08):** filed as Item 118 — Schedule
> status filter with counts. The legacy FINAL / IN PROGRESS / SCHEDULED pills went with the card chrome.

---

## Matchups — design decisions

Owner cards and the stat strip are unchanged; the game list becomes scoreboards, rendered **expanded inline with no collapse**. Roughly nine games per card does not justify hiding them, and reading a slate at once is the point of the view.

**Open — card-owner treatment.** On an owner-scoped card the card owner's name repeats on one line of every scoreboard. The mockup carries a toggle comparing full weight against dimmed: dimming reduces noise and makes the opponent easier to scan; full weight keeps the component identical to every other surface. This is the only place the component meets a pre-scoped container.

> **SUPERSEDED (verified 2026-09-08):** decided as a neutral background tint on the card owner's row, dimming
> rejected — `item-87-followon-team-highlight.md` (identity axis: never owner colour), with the tint's outcome hue
> over the game's life in `item-87-followon-presentation-decisions.md` → *Owner highlight on Matchups*. The neutral
> tint shipped (slice 5b, Item 117); the outcome hue has not, and the outcome rail it replaces is still rendered —
> `item-87-followon-matchups-gap-analysis.md` §2.

---

## Same component, different consumption

The row treatment is now identical across Overview, Matchups and Schedule. Only two things vary per consumer, and both have reasons:

- **Odds footer.** Shown on Matchups (nine games, helps evaluate a slate) and the Overview watchlist (curated and small). Suppressed on Schedule (sixty-plus rows; decision-support becomes noise).
- **Tier-2 expansion.** Schedule only, and possibly not for long.

That is a cleaner story than the earlier draft, which had three different collapse behaviours.

> **SUPERSEDED (verified 2026-09-08), both claims.** "Suppressed on Schedule" is overridden by widening 4 above
> (odds sit in Schedule's tier 2; only the odds FOOTER is suppressed). "Identical across Overview, Matchups and
> Schedule" is overridden by Item 143, which records four Matchups divergences the shared component cannot express
> (status pill, live indicator, eyebrow placement, odds on live/final).

---

---

## Eyebrow tags — bronze, rendered as pills

### Colour: bronze, a correction to the shipped blue

**Blue is not a weaker choice — it is NON-COMPLIANT, and that is the whole argument.** `DESIGN.md:153`
(re-derived 2026-09-08) states *"Blue signals interactivity or active state only — never use blue to mean
'featured' or 'important'."* An eyebrow tag is exactly a featured/important signal, so the shipped
`text-blue-300` violates a rule already on the books — `OverviewPanel.tsx:755` for the reason row, `:195`
for the chip. **Bronze is a CORRECTION to shipped, not a preference deviating from it.** The secondary
objection — that blue is the interactive token, so eyebrows would share a colour with links and controls
— is true but subordinate to the rule.

> **REFRAMED 2026-09-08, and the earlier framing is retired rather than merely supplemented.** This
> section previously opened by rebutting *"shipped is blue"* as descriptive, and reached the
> non-compliance finding four paragraphs down, below the status callout. **A prompt author reading the
> top of the section got the weak version** — the same position-not-prominence failure this campaign
> documented elsewhere. The non-compliance claim now leads because it is the claim that settles the
> question; everything below it answers objections that no longer decide anything.

Bronze was decided earlier in this campaign, ranked above sky, neutral and fuchsia. An intermediate mockup reverted it to the shipped `text-blue-300` after a review flagged gold as champion-reserved. **That flag bundled two claims and neither survives.**

*"Shipped is blue"* is descriptive, and it is now moot: what ships is non-compliant, so matching it is not a goal. A mockup proposing a change is precisely what deviates from what ships, which was never an argument against bronze even before the rule was found.

*"Gold is champion-reserved"* is answered by temporal separation. The champion treatment does not render until a title is awarded — podium cards for #1–#3 are neutral all season, confirmed by inspection — so bronze is uncontested through the year. At season end the two remain distinguishable: bronze is a desaturated tan, champion amber (`#BA7517`) a dark saturated gold. The reservation binds a token to a purpose, not a hue neighbourhood.

**The known weakness, measured rather than asserted.** **CORRECTED 2026-09-08 — the figure previously
stated here (1.37:1) reproduces as none of the candidate pairs, and the conclusion drawn from it is
what stopped anyone rechecking it (`AGENTS.md` → a stated figure must reproduce).** This section names
two bronzes with roles, so "bronze against champion gold" was ambiguous. Recomputed, sRGB relative
luminance, `(L1+0.05)/(L2+0.05)`:

| pair | ratio |
| --- | --- |
| **pill TEXT `#dbc190` vs champion `#BA7517` — what a viewer actually sees** | **2.13:1** |
| base bronze `#c9a66b` vs champion `#BA7517` | 1.62:1 |
| pill border `#c9a66b` vs pill text `#dbc190` — an internal pair nobody reads across | 1.32:1 |

**The operative number is 2.13:1**, and the conclusion is unchanged: essentially no luminance
separation, so the distinction is carried by hue and saturation alone. That is
the one moment the two sit adjacent, and it is the case that fails for a viewer with reduced colour
discrimination. Temporal separation covers the rest of the year; this is precisely what it does not
cover. If the pairing ever needs to survive that viewer, the instrument is a luminance step, not a
different hue.

> **DISCHARGED on Schedule and Matchups, OPEN on Overview (verified 2026-09-08):** bronze pills ship on Schedule
> (`GameWeekPanel.tsx:17-18`: border `#c9a66b` at 40%, text `#dbc190`) and Matchups (Item 117, PR #581). Overview's
> reason row is still `text-blue-300` (`OverviewPanel.tsx:755`; the chip at `:195`) and no item owns its
> conversion — an Item 144 queue finding.

### Treatment: pills, uniformly

Every eyebrow renders as a pill — hairline bronze border, brighter bronze text. No per-class variation.

**Two bronze values, with roles.** Base `#c9a66b` (8.63:1 on the dark composition); pill **text**
`#dbc190` (11.35:1); pill **border** `#c9a66b` at 40% opacity. The split is deliberate — a border
should recede relative to the label it encloses — but both values are stated here because naming one
while the mockup renders two is the same gap as an arithmetic that does not reproduce its own number.

**The mixed version is rejected.** An earlier draft gave the outcome tag (*Upset*) a pill while selection tags (*Ranked spotlight*, *Top matchup*) stayed plain, reasoning that they are different classes: pre-game selection reasons versus post-game outcome facts. The distinction is real but **undecodable** — a reader cannot learn "pill means outcome" from looking, so the shape difference was a distinction the design knew and did not communicate. Decoration carrying a semantic argument.

Within each state, a tagged row already stands out from untagged rows, so shape does no scanning work. Only the word does.

**Pills rather than plain text** cuts against this campaign's direction of removing chrome, but a hairline border on a 10px label is a long way from card chrome, and the tags carry more presence with one.

### This answers the amber `upset` border

The base addendum exempts that border as *"emphasis, out of scope for every slice."* The transition deletes the card chrome it lives on, so without a decision the exemption lapses by side effect rather than by choice.

**Slice 5 should record the border as deliberately retired, with the eyebrow pill carrying its emphasis forward.**

> **LIVE — the recording half (verified 2026-09-08):** the border is retired in code and the registry records the
> deletion, but no document states the retirement as a decision with the pill carrying the emphasis. INDEX CARRY
> row 4.

**State the cost plainly:** a pill is quieter than a border around a card. A border catches the eye across sixty rows; an eyebrow does not. That is acceptable if Schedule is a reference surface and making games jump out belongs to Featured and the recap — but it is a real reduction, not a like-for-like replacement. If upsets should stay prominent, the honest instrument is a hue assigned in `INSIGHTS-017-PALETTE`, not a shape difference.

### Not applied to the Featured reason row

The Featured tile's reason row (`sb-title`) stays plain bronze text. It is a card title on its own line rather than an inline tag beside a status, and a border there would read as chrome on a tile that already has some. Consequence: bronze appears in two shapes. Flagged rather than settled — making it a pill too is a one-line change if the inconsistency reads badly.

## Corrections to earlier premises

- **Item 90 is delivered** (POLISH-018, PR #541) and had already been narrowed off `GameScoreboard`/`GameWeekPanel` before slice 5 was filed. There is nothing to re-scope; slice 5 already owns Schedule's colour.
- **Item 92 is delivered** as PLATFORM-117.
- **Schedule is Item 87 slice 5**, which already exists. **Matchups is not in slice 5's scope** and needs its own number. The status filter is a third piece of work, as this doc already says.

## Recommended order

1. **`NoClaim` + `ualbany` fallback** — independent, tiny, member-visible now.
2. **Record the widenings** above in the base addendum and `DESIGN.md`, before any implementation.
3. **Widen `CompactGameScoreboard`** as its own slice, so both consumers build on one contract.
4. **Schedule (slice 5)** — retires `cardEmphasisClasses` and the one-line collapse, adopts the filter.
5. **Matchups** (new item).
6. **Team colour** — after 3, since it lands in the shared component.

> **DISCHARGED 1–5, LIVE 6 (verified 2026-09-08):** 1 = POLISH-021; 2 = `DESIGN.md` (slice 5a closeout); 3 = slice
> 5a, PR #570; 4 = slice 5, PR #572 (the filter went to Item 118 rather than shipping with it); 5 = Item 117, PR
> #581. 6 is Item 119, unbuilt — and it is now a restoration, not a widening
> (`item-87-followon-team-colour-regression.md`).

## Questions for the CLI

1. Where does `NoClaim` enter the presentation layer, and are there other surfaces rendering it as an owner besides Schedule?
2. Confirm the collapsed-row owner logic fires only for owner-vs-owner games, and where.
3. What are the two naming sources behind "ualbany" versus "BUF"?
4. Does the schedule wire item carry `neutralSite` to presentation, with nominal away/home populated?
5. Item numbers: the `NoClaim` fix (recommend filing and dispatching independently), and the Matchups/Schedule transition.
6. Confirm item numbering for: the `NoClaim` + naming fix (next free is 116), the `CompactGameScoreboard` widenings slice, and the Matchups transition.

> **DISCHARGED (verified 2026-09-08):** questions 1–4 are answered in place above (*Verified* paragraphs under each
> defect, and widening 2); 5–6 resolved as POLISH-021, slice 5a and Item 117.
