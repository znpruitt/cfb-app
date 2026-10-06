# INSIGHTS-026c — Forward Look: the timely zone stops going empty on Thursday

```text
PROMPT_ID: INSIGHTS-026C-FORWARD-LOOK-CODEX-v1
PURPOSE: Overview's elevated timely-content zone renders NOTHING from the Thursday 06:00 ET recap
         cutoff until the next week's results become eligible — most of every football week, and the
         part members are most engaged in. `selectWeeklyRecapTileState` already returns `'upcoming'`
         at exactly the right moment and both its consumers read that as "render nothing". Give the
         state an occupant: one tile, same slot, narrative lines about the week ahead.
SCOPE:   The recap tile's state branch (`CFBScheduleApp.tsx:1142-1150`), a new Forward Look composer
         and its selectors beside `src/lib/recap/`, and the tile rendering. DO NOT change
         `selectWeeklyRecapTileState`, `loadRecapContextForSeasonScope`'s gather, the watchlist, the
         Insights panel, `watchlistPriority`, or DESIGN.md (planning owns it — the rules are written).
CARRIES: From INSIGHTS-026 (`docs/roadmap.md:219-228`), the campaign's own words for this portion,
         verbatim: **"Forward Look: Future schedule/rankings preview for the immediate upcoming
         canonical week — games to watch, owner-vs-owner collision previews, rivalry implications,
         and who needs a win."** The roadmap also says it "needs its own schedule/rankings inputs";
         **planning has measured that claim and it is largely false — see "The gather already
         exists".**

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - A measurement claim states the population it was taken over. Several figures below are
           planning's measurements against live production data; their populations are stated and you
           should re-derive any you build on.
```

---

## RECEIPT ADJUDICATED 2026-10-06 — proceed. All six corrections accepted; three change the work

**The stop trigger does NOT fire.** No family needs a new data path, verified by running the real
loader against a production snapshot. **The single-slice scope holds.**

### Corrections that change what you build

1. **`'upcoming'` does NOT mean the next week is unplayed.** Week 6 carries three kickoffs before the
   Thursday cutoff. **Planning wrote the false version into `DESIGN.md` and it is now corrected there.**
   **Consequence: the composer must not assume every game ahead of it is unplayed.** A preview that
   previews a finished game is wrong. Decide explicitly what happens to an already-kicked game in the
   upcoming week — exclude it, or treat it as context — and say which.

2. **Odds availability is not odds freshness, and coverage collapses past the current week.** Your own
   table: **week 6 had 58 lines for 58 games; week 8 had 4 for 56; week 11 had 6 for 67** — and the
   week-8 lines were captured September 4-5, a month stale.
   **So upset risk is viable ONLY because this tile's scope is the immediate upcoming week.** Build it
   that way deliberately, with a staleness guard, and do not let it be extended to later weeks later —
   a month-old spread is not a current one. State the guard's threshold and why.

3. **Streaks need the ordered meeting sequence.** A 9-1 aggregate is not a nine-game streak, and
   `selectAllTimeHeadToHead` gives aggregates. **The rivalry family's "distance from even" needs both**
   — the aggregate for tightness, the ordered sequence for a live streak. That is more derivation than
   this prompt implied.

### Corrections to this prompt's claims, accepted

4. **Standings are DERIVABLE from the gather, not already computed in it.** This prompt said "already
   in the build". You derived 15 real-owner rows via `deriveStandings`; that is work, not a lookup.

5. **Planning's 304/302/309 were RAW schedule rows — the wrong population.** The normalized gather
   holds 59/56/67 for those weeks. **The collision counts reproduce exactly (50/50/62)**, which are the
   figures the design rested on, so the conclusion stands and the denominator was mislabelled. That is
   planning failing its own name-the-population rule.

6. **The Insights merge does NOT cap per family.** It sorts engine insights by `priorityScore`
   descending, appends unseen-ID fallbacks to five, and slices. **So "follow that pattern" was wrong
   where it met this prompt's own per-family cap requirement.** Follow the pattern for merge and slot
   discipline; **the per-family cap is an ADDITIONAL, explicit requirement** and it needs its own test.

7. **The recap primitives need adaptation, not reuse.** The disclosure frame and compact two-line
   presentation carry over. `MovementList` carries retrospective labels, and `TileHighlightsList`
   renders `RecordChangeRow` or `GameScoreboard` rather than generic narrative lines. Budget for new
   line renderers; the frame is what you inherit.

### Acceptance 6 was wrong and is REPLACED — this is the ruling that matters most

This prompt asked for a "stated state" when out of season, which contradicts `DESIGN.md`'s
"inapplicable renders nothing". **You were right that the canonical rule governs.** But the conflict
exposed a case neither document covered, and it is now ruled in `DESIGN.md`:

- **Inapplicable** — out of season, no league, no week — **renders nothing.** Unchanged.
- **Applicable but empty** — in season, `'upcoming'`, and no family produced a line — **still renders.**
  At minimum it names the week ahead.

**Collapsing the zone because a selector returned an empty list reproduces the exact defect this
occupant exists to fix**, and it would do it on the quiet weeks a member most needs orientation.
Acceptance 6 below is rewritten to this.

## Why this is urgent in a way the rest of the backlog is not

**Every other open item is accumulating risk. This one has decaying value.** A bug waits; a week of
preview content that was never shown cannot be shown later. The owner's words: *"we're losing weeks of
content by allowing it to languish."*

**And it has languished for a mechanical reason worth not repeating.** It was portion 3 of a
three-portion issue (#637). Nobody takes a third of an issue, so all three portions sat. Planning
split it out as [#886](https://github.com/znpruitt/cfb-app/issues/886) on 2026-10-06.

## The defect, measured

`selectWeeklyRecapTileState` (`src/lib/selectors/weeklyRecapFacts.ts:329-357`) returns **three**
states. `'upcoming'` means *last week is finished and the next has not started*, after the Thursday
cutoff (`RECAP_ELIGIBILITY_HOUR = 6`, `:21`), DST-correct in ET.

**Both consumers hear it as "stop":**

| consumer | behaviour on `'upcoming'` |
| --- | --- |
| `CFBScheduleApp.tsx:1149` | `return state === 'recap' ? weeklyRecapResponse : null` — **renders null** |
| `overviewGameSections.ts:193` | computes `expiredFinalWeeks` — an **expiry** signal |

The state was never the problem. **Nothing was listening to it.**

## The gather already exists — this is the assumption to test FIRST

Planning verified it, and the whole single-slice scope rests on it:
`loadRecapContextForSeasonScope` (`src/lib/recap/loadRecapContext.ts:177-182`) takes
`leagueSlug`, `seasonYear`, `leagueStatus`, `now` — **no week parameter** — and gates only on
`isWeeklyRecapActiveSeason`, a season-level check. It assembles in one pass:

| gathered | serves |
| --- | --- |
| `assembleSeasonScoredBuild` — the whole season, **including future weeks** | all three families (standings are DERIVED from it, not read) |
| `rosterByTeam` — owner ↔ team | collisions, rivalries |
| season archives + historical rosters | rivalry history |
| odds by game key | upset risk |

**If you find a family that genuinely needs its own data path, STOP AND REPORT.** That is the stated
trigger and the reason the single-slice scope was authorized.

## Owner rulings — all made, none open

1. **One tile, same slot, replacing the recap.** Not two tiles, not a second heading. `DESIGN.md` →
   *Elevated timely-content zone*.
2. **Narrative lines, not a game list**, and **expandable** as the recap is. Reuse the recap's line
   primitives (`MovementList`, `TileHighlightsList` in `RecapPrimitives.tsx`), not `GameScoreboardList`.
3. **Three families**: standings implications, rivalry implications, upset risk.
4. **It must NOT consume `watchlistPriority`.** See below — this is the trap.

## THE TRAP — the watchlist ranks on national profile, and it is right there

`watchlistPriority` (`overview.ts:357-381`) is a `Math.max` over `top25` (100), `isUpsetWatch` (95),
`isGameOfSlate` (90), `close` (80), `hasTop25RankedTeam` (70). On a scheduled row only 100, 90 and 70
can fire — the other two need a score or an in-progress game.

**Not one term knows about owners.** Measured by planning 2026-10-06: a game between two drafted
teams, owned by rivals, with a title race riding on it scores **0** unless a team is AP-ranked.

That is correct for the watchlist and wrong here. **Reusing it would make the tile agree with the game
list twenty pixels below it**, which is the duplication `DESIGN.md` now forbids.

## The three families

**Measured against production, 2026-10-06** — the live schedule joined to the 2026 draft (135 picks),
then **re-measured by the lane against the NORMALIZED gather**, which is the population that matters:

| week | gathered games | involving a drafted team | **owner-vs-owner collisions** | selected odds |
| --- | --- | --- | --- | --- |
| 6 | 58 | 58 | **53** | 58 |
| 8 | 56 | 56 | **50** | **4** |
| 11 | 67 | 67 | **62** | **6** |

Planning's first pass reported 304/302/309 games — **raw national schedule rows, the wrong
denominator.** The collision counts reproduced exactly, so the design conclusion stands; the
population label did not.

**The problem is selection, not availability.** ~135 of ~136 FBS teams are drafted, so nearly every
FBS-vs-FBS game is a collision. **A list is not an option; every family needs a ranking.**

### 1. Standings implications

Every drafted team's game moves an owner ±1. A collision moves two owners in **opposite** directions —
a 2-game relative swing — so collisions dominate automatically.

**The stake is not "two owners play". It is "this game can change their order."** Weight by standings
proximity: a collision one game apart can flip them; #1 against #14 cannot. **Standings are DERIVED
via `deriveStandings`, not read off the gather** — corrected at the receipt.

### 2. Rivalry implications

Owner-vs-owner records are tracked in history (owner-confirmed). **Both extremes are interesting and
the middle is not:**

- **tight** — near-even head-to-head, neither has separated
- **lopsided** — a long streak that might finally break

**So this is ONE criterion, not two: distance from even, in either direction.** A 6–4 rivalry is the
boring case; 5–5 and 9–1 are both stories.

### 3. Upset risk

From the odds already loaded. **This is the only family that reaches a game where just one owner has a
team**, which the other two are blind to by construction — a leader's team as an underdog is a real
stake.

### Combining them

Each family produces candidate lines with a score; merge, take the top few, **cap per family so one
cannot crowd the tile**. Follow the Insights panel's merge and slot discipline
(`OverviewPanel.tsx:1794` — `priorityScore` sort, unseen-ID fallbacks appended to the slot count, then
slice). **But it does NOT cap per family** — corrected at the receipt. The per-family cap is an
additional requirement with its own test.

## Structure — families must be ADDITIVE

**This is the risk control for a slice this size, and it is not optional.**

- **Floor:** the gather, the changeover off `selectWeeklyRecapTileState`, and the rendering frame.
  **That alone stops the zone being empty** and is the thing that must ship.
- **Each family is an independent selector on top.** If review faults one, it drops without touching
  the other two or the frame.

PLATFORM-757a took five remediation rounds because each round changed **the model**. This is three
parallel things over one settled gather — a different shape, and it stays that way only if the
families do not reach into each other.

**Size is pre-authorized.** This will likely cross the 1,500-line stop-and-reassess threshold; the
reason is stated here so you do not stop cold on it. **The trigger to actually stop is a family
needing its own data path.**

## Acceptance

1. **The zone is not empty between the Thursday cutoff and the next week's eligibility**, for a league
   in an active in-season week. This is the acceptance the slice exists for.
2. **The changeover is driven by the existing `selectWeeklyRecapTileState`**, not a second timing rule.
   Two sources of truth for "which week is current" is a defect class this repo keeps finding.
3. **A test pins the changeover at the boundary minute**, and a mutation moving the cutoff reddens it.
4. **No family consumes `watchlistPriority` or any AP-rank-only criterion.** Pin it: a fixture where a
   high-stakes unranked collision outranks a low-stakes ranked game.
5. **Each family is independently droppable** — a test demonstrates the tile renders correctly with any
   one family returning nothing.
6. **Inapplicable renders nothing; applicable-but-empty still renders.** Out of season, no league or
   no week renders nothing, per `DESIGN.md`. **An in-season `'upcoming'` week where no family produced
   a line still renders, naming the week ahead** — pinned by a test, because collapsing the zone there
   reproduces the defect this slice exists to fix.
7. **Nothing below the zone changes.** The watchlist, the Insights panel and the scoreboard grids are
   untouched, each pinned.

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 4 is the likely false green.** A test asserting "the tile shows a collision" passes under
a national ranker too, as long as the collision happens to involve a ranked team. The fixture must
make the two rankings **disagree**, and assert the league-stakes answer wins.

**Acceptance 1's fixture must use the real changeover**, not a hand-set state. A test that constructs
`'upcoming'` directly proves the renderer, not the integration — and the integration is the defect.

---

## STOP — read receipt before writing any code

Answer from the FILES and from production data where stated. Enumerate rather than counting.

1. **Does `loadRecapContextForSeasonScope` actually yield usable future-week games?** Planning checked
   the signature and the gate; you check the DATA. Name a future week and say what is present and what
   is null for its games.
2. **Which of the three families, if any, needs something the gather does not provide?** This is the
   stop trigger. Answer it before anything else.
3. **What does the recap tile's compact rendering actually look like today**, and which of its
   primitives carry over? Name them.
4. **How does the Insights panel cap and merge its families?** You are to follow that pattern; state
   what it is rather than inferring it.
5. **Is owner-vs-owner history reachable from this context**, and over how many prior seasons? The
   owner says it is tracked; say where and what shape.
6. **What in this prompt contradicts what you found in the files or the data?**

Do not start until the receipt is answered and it has been ruled on.
