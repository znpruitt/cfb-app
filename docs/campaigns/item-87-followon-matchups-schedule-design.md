# Item 87 — Follow-on input: Matchups and Schedule design decisions

> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.

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

### 2. The collapsed row drops the owner when only one side is owned

The shipped Schedule renders UAlbany at Buffalo with no owner, though Buffalo is Jackson's; the owner line appears to fire only for owner-vs-owner games. **Low severity** — Matchups is the purpose-built view for an owner's full slate — but still an inconsistency. The transition resolves it as a side effect, since the scoreboard lists owners unconditionally.

### 3. Inconsistent team naming within one card

The shipped expanded view renders "ualbany" lowercase against "BUF" abbreviated in the same card, suggesting two naming sources feeding one view. **Verified:** `GameWeekPanel.participantDisplayInfo` (`:57-68`) falls back to `participant.displayName`, which is the canonical id slug (`schedule.ts:706`) when `labels` is undefined for a non-catalog team; catalog teams get `labels.scoreboardName` via `pickDisplayLabel` (`teamIdentity.ts:171-176`) → `BUF`. **Fix:** fall back to `csvAway`/`rawName` (`schedule.ts:715`), the proper-cased provider name, not the id. A few lines. **Bundle with the `NoClaim` fix** — both are presentation-layer, tiny, and visible today.

---

## Contract widenings — currently unrecorded, must be written down before implementation

`CompactGameScoreboard` does not support these today. None is in the base addendum or `DESIGN.md`. **Record them before any consumer is built**, or a second campaign will discover them the way this one did.

### 1. Prefix slot accepts a classification marker

Renders `#rank` only today (`CompactGameScoreboard.tsx:45-47`). It must also accept an FCS marker.

**No precedence rule is needed — the collision cannot occur.** Rankings are derived from FBS poll data only, so an FCS team never carries a rank. The two markers are mutually exclusive by construction of the ingestion pipeline, not by display convention.

That makes the prefix slot a single-valued classification marker: rank if ranked, FCS if FCS, otherwise empty. No precedence logic, no ambiguous case to test. *This closes the CLI's open question; an earlier draft proposed a precedence rule on the assumption the data permitted both.*

**Guard worth keeping anyway:** if a rank ever appears on an FCS team it indicates a data defect upstream, not a display case. Rendering the rank and letting it look wrong is preferable to silently masking it.

### 2. Neutral-site marker

`usesNeutralSiteSemantics` (`gameUi.ts:5`) already drives the `vs` separator on `GameWeekPanel`, and `neutralSite` / `neutralSiteDisplay` flow through `schedule.ts:79, :133` → `AppGame.neutral` / `neutralDisplay`. `CompactGameScoreboard` has no marker. Nominal away/home are always populated, so **away → home ordering is unchanged** and this is purely a metadata marker on the date line.

**Postseason forces this independently of the transition** — conference championships arrive first, then bowls and the CFP. Worth shipping as a standalone widening rather than waiting.

### 3. Broadcast on live rows

`CompactGameScoreboard.tsx:16-19` gates broadcast on `state === 'scheduled'`. The design calls for it on **scheduled and live** rows, and not on finals — a completed game's broadcast is dead information. Third widening, previously unstated.

### 4. Odds position — three conflicting positions on record

The design doc has said "suppressed on Schedule"; the mockup places spread/O/U/ML in tier 2; the base addendum's slice-5 contract says "Schedule attaches odds… the row exposes slots." **Settled here: odds live in the tier-2 expanded body on Schedule** — present but not competing with sixty rows of tier-1 content — and inline on Matchups, where nine games per card justify them. This supersedes "suppressed on Schedule."

### 5. Amber `upset` card border — needs an explicit decision

`GameWeekPanel.tsx:42` `cardEmphasisClasses` renders an amber border for upsets, which is a reserved-colour violation. **But the base addendum explicitly exempts it** as "emphasis, out of scope for every slice." The transition deletes the card chrome it lives on, so the exemption becomes moot by accident. Either re-scope the exemption or record that the transition retires it deliberately — do not let it lapse silently.

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

### The scoreboard is the row; there is no one-line collapse

The shipped collapse hides the wrong tier. **Tier 1** is teams, owners, records, score and broadcast — what a schedule is *for*. **Tier 2** is venue, moneyline and conference. Collapsing to one line hid tier 1 to protect against tier 2, which meant expanding a finished game just to see the score.

Now the scoreboard always renders and only tier 2 sits behind a "More" affordance.

**Cost:** roughly double the scroll — two columns at ~60 games a week approaches 2,000px. Acceptable because the filter cuts it to the live handful in one click, and because the alternative hid scores on a results view.

**Expansion may not survive.** What remains behind it is venue and city (mildly useful), moneyline (niche) and conference matchup (inferable from the teams). If unused it can go entirely, leaving a plain scoreboard with no interaction. Retained for now because removing information that exists today should be a decision, not a side effect.

### Broadcast network is tier 1

"Can I watch this" is the question a schedule answers, so the network sits in the status row beside the kickoff time. It renders on **scheduled and live rows only** — a completed game's broadcast is dead information, and the row's job at that point is the result. Same principle as the anchor: the status row carries what is actionable for that state. Games with no listed broadcast omit it rather than rendering a placeholder.

### Conference sits in tier 2, on its own line

Not appended to the odds string, where it read as an afterthought and coupled two unrelated facts. Conference is context rather than something a member acts on, and the page already carries a conference *filter*, so the dimension is handled at page level — the row only needs to state it.

**Same-conference games collapse** to "ACC matchup" rather than "ACC vs ACC". Conference is strictly a team attribute, so the "X vs Y" form is a game-level summary of two facts and needs this special case.

**FCS is a classification, not a conference.** The conference line must name the actual conference (United Athletic, Coastal Athletic, Big Sky); the FCS marker lives in the prefix slot. Easy for a classification to leak into a conference field — worth checking the data distinguishes them.

**Alternative if conference proves tier 1:** abbreviate it (ACC, B1G, MW) and place it inline on the team line. Rejected for now — that line already carries a colour bar, rank or FCS marker, team, record and owner, and conference would be the sixth element. If the page-level filter makes members expect it per row, the inline form is the fallback and something else has to give way.

### Sorted strictly by kickoff, ascending, within each date group

A schedule's contract is time order, so live games are **not** floated to the top the way the Overview promotion model does — the filter covers "show me what's live" without breaking the one guarantee the view makes. Kickoff times therefore render on every row including finals: with the sort keyed to a value, hiding that value on most rows makes the order look arbitrary.

**Open — landing position.** Ascending order means a mid-Saturday visit opens on the morning's finals with live games below the fold. Options: leave it, scroll to the first non-final game on load, or anchor the current date group. A scroll-position question, not a sort question.

### The status key becomes a real filter

The FINAL / IN PROGRESS / SCHEDULED pills were a colour key for the status-coloured cards — useless before this transition and meaningless after it, since the colours they explained are gone. Replaced with single-select state filtering.

- **Counts are the point.** Sixty-plus games a week; the problem is finding the two live ones. Counts answer "is anything live" without a click.
- **Zero-count states dim rather than disappear**, so the absence is stated rather than implied, and the bar does not reflow through the day.
- **Chips are neutral, not status-coloured** — colouring them would reintroduce exactly what the transition removes and spend palette on a persistent control.
- Empty date groups hide under a filter rather than leaving orphaned headings.

**This is additive functionality**, not part of the transition proper, and should be scoped as such.

---

## Matchups — design decisions

Owner cards and the stat strip are unchanged; the game list becomes scoreboards, rendered **expanded inline with no collapse**. Roughly nine games per card does not justify hiding them, and reading a slate at once is the point of the view.

**Open — card-owner treatment.** On an owner-scoped card the card owner's name repeats on one line of every scoreboard. The mockup carries a toggle comparing full weight against dimmed: dimming reduces noise and makes the opponent easier to scan; full weight keeps the component identical to every other surface. This is the only place the component meets a pre-scoped container.

---

## Same component, different consumption

The row treatment is now identical across Overview, Matchups and Schedule. Only two things vary per consumer, and both have reasons:

- **Odds footer.** Shown on Matchups (nine games, helps evaluate a slate) and the Overview watchlist (curated and small). Suppressed on Schedule (sixty-plus rows; decision-support becomes noise).
- **Tier-2 expansion.** Schedule only, and possibly not for long.

That is a cleaner story than the earlier draft, which had three different collapse behaviours.

---

---

## Eyebrow tags — bronze, rendered as pills

### Colour: bronze `#c9a66b`, a deliberate deviation from the shipped blue

Bronze was decided earlier in this campaign, ranked above sky, neutral and fuchsia. An intermediate mockup reverted it to the shipped `text-blue-300` after a review flagged gold as champion-reserved. **That flag bundled two claims and only one holds.**

*"Shipped is blue"* is descriptive. A mockup proposing a change is precisely what deviates from what ships, so this is not an argument against bronze.

*"Gold is champion-reserved"* is answered by temporal separation. The champion treatment does not render until a title is awarded — podium cards for #1–#3 are neutral all season, confirmed by inspection — so bronze is uncontested through the year. At season end the two remain distinguishable: bronze is a desaturated tan, champion amber (`#BA7517`) a dark saturated gold. The reservation binds a token to a purpose, not a hue neighbourhood.

Blue would also have been poor independently: it is the interactive token, so eyebrows would share a colour with links and controls.

### Treatment: pills, uniformly

Every eyebrow renders as a pill — hairline bronze border, brighter bronze text. No per-class variation.

**The mixed version is rejected.** An earlier draft gave the outcome tag (*Upset*) a pill while selection tags (*Ranked spotlight*, *Top matchup*) stayed plain, reasoning that they are different classes: pre-game selection reasons versus post-game outcome facts. The distinction is real but **undecodable** — a reader cannot learn "pill means outcome" from looking, so the shape difference was a distinction the design knew and did not communicate. Decoration carrying a semantic argument.

Within each state, a tagged row already stands out from untagged rows, so shape does no scanning work. Only the word does.

**Pills rather than plain text** cuts against this campaign's direction of removing chrome, but a hairline border on a 10px label is a long way from card chrome, and the tags carry more presence with one.

### This answers the amber `upset` border

The base addendum exempts that border as *"emphasis, out of scope for every slice."* The transition deletes the card chrome it lives on, so without a decision the exemption lapses by side effect rather than by choice.

**Slice 5 should record the border as deliberately retired, with the eyebrow pill carrying its emphasis forward.**

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

## Questions for the CLI

1. Where does `NoClaim` enter the presentation layer, and are there other surfaces rendering it as an owner besides Schedule?
2. Confirm the collapsed-row owner logic fires only for owner-vs-owner games, and where.
3. What are the two naming sources behind "ualbany" versus "BUF"?
4. Does the schedule wire item carry `neutralSite` to presentation, with nominal away/home populated?
5. Item numbers: the `NoClaim` fix (recommend filing and dispatching independently), and the Matchups/Schedule transition.
6. Confirm item numbering for: the `NoClaim` + naming fix (next free is 116), the `CompactGameScoreboard` widenings slice, and the Matchups transition.
