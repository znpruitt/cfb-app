# PLATFORM-729 — Schedule team names

```text
PROMPT_ID: PLATFORM-729-SCHEDULE-TEAM-NAMES-CODEX-v1
PURPOSE: Render the provider's full school name on Schedule rows (and the Postseason tab, which
         renders the same panel), matching Overview and Matchups. Today every FBS team on Schedule
         renders as an abbreviation.
SCOPE:   src/lib/selectors/gameWeek.ts (the name derivation at :186-195 and its callers in the
         selector) plus src/components/__tests__/GameWeekPanel.test.tsx and
         src/lib/__tests__/selectors-gameWeek.test.ts. GameWeekPanel.tsx only if receipt item 1 shows
         the selector cannot carry the change alone. src/lib/teamIdentity.ts only as receipt item 2
         rules. DO NOT modify DESIGN.md (planning amended it before this prompt), OverviewPanel.tsx,
         MatchupsWeekPanel.tsx, CompactGameScoreboard.tsx, the team catalog or any stored data, or the
         odds summary's canonical `odds.favorite` fallback (receipt item 4).
CARRIES: Item 87 INDEX, LIVE rows for the Schedule surface, verbatim:

         Row 1: "A build with records absent or stale **will not match the mockup**, and a reviewer
         comparing them must read that as a **sequenced dependency, not a defect**. State this in the
         prompt. **Owner ruling 2026-09-08:** a missing record leaves the anchor **blank**, never the
         spread — and a **store failure** (transient, no item) is NOT the same condition as **"not
         wired to this surface"** (a sequencing state that needs a filed item and this sentence in the
         prompt). Records are wired on Overview and Matchups; Schedule remains in the second state
         under Item 156."

         Row 7: "**Do not read campaign status from the canonical document**, and **re-derive every
         line-number citation** before putting it in a prompt — they have been stale at least twice,
         and `DESIGN.md` moved again on 2026-09-08."

         Row 8: "Selection and precedence stay selector-owned; the scoreboard **must not be forked**.
         [...] There are **five direct renderers**: Overview `GameCardList` (serving Live AND Recent
         finals), Overview `WatchlistScoreboardList`, Overview `FeaturedGamesList`, `GameWeekPanel`,
         and Matchups `GameRow` — three importing modules, six rendered contexts."

         Row 71: "**A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is recorded**
         — Overview, Matchups, Schedule, recap. [...] **every decision in it about the status row, the
         tag slot or row anatomy applies to all four surfaces.**"
```

**Records are absent on Schedule by design (row 1).** Blank record anchors are Item 156's sequencing
state, not a defect of this slice.

---

## The ruling

**Owner decision 2026-09-16 on #729: full names.** `DESIGN.md` now carries the rule (the bullet after
*"Rankings display inline with team names"*): scoreboard rows show the provider's full school name,
**every surface uses the same field**, and a team outside the catalog or a TBD placeholder goes
through that same field, so one row never mixes forms.

## What planning measured, read at `main` after `80a3cf6b`

**The issue understates the problem.** #729 names `OLE MISS` and `MSST`, which reads as if a handful of
teams are abbreviated. **Every FBS team is.**

- `participantScoreboardName` (`gameWeek.ts:186-195`) returns `participant.labels.scoreboardName` for
  a catalog team, and the raw provider name only for a team without labels.
- `scoreboardName` is picked in order (`teamIdentity.ts:179-185`): a hand-written override (5 teams,
  `:137-157`), then `shortDisplayName`, then `abbreviation`, then `displayName`.
- **The production team catalog (`app_state` scope `team-database`, key `current`) has 138 FBS teams
  and 0 carry a `shortDisplayName`**, measured on the read-only replica 2026-09-16. So the chain lands
  on `abbreviation` for every catalog team: `ALA`, `ASU`, `ARST`, `AF`.
- **An FCS opponent is not in the catalog**, so it falls back to the raw provider name. A row can read
  `ALA` against `Eastern Washington`.

**What the other two surfaces use:**

| surface | name | source |
| --- | --- | --- |
| Overview | `Alabama` | `game.csvAway` / `csvHome` (`OverviewPanel.tsx:826`, `:835`, `:944`, `:953`) |
| Matchups | `Alabama` | `slateGame.game.csvAway` (`MatchupsWeekPanel.tsx:179`) |
| Schedule | `ALA` | `labels.scoreboardName` (`gameWeek.ts:189`) |

**The same names feed Schedule's tier-2 odds line.** `formatOddsSummary` (`gameWeek.ts:155`) takes
`{ away: awayTeamName, home: homeTeamName }` from the call at `:346`, so "Spread: MSST -3.5" becomes
"Spread: Mississippi State -3.5" with no change to the formatter.

**Tests defending the abbreviations:** `GameWeekPanel.test.tsx:843-844` (`OLE MISS`, `MSST`) and
`:1197-1198` (`MSST`, `Spread: MSST -3.5`), with fixtures at `:795`, `:807`, `:879`, `:1080`, `:1092`,
`:1151`, `:1163`. `teamIdentity.test.ts:131` pins the override itself.

---

## Acceptance

1. A Schedule row renders the same name string Overview and Matchups render for the same game, for a
   catalog FBS team, an FCS team outside the catalog, and a TBD placeholder. **Prove "the same field"
   with a test that fails if Schedule's source diverges from Overview's**, not only with matching
   literals in two fixtures.
2. The tier-2 odds line names teams by the same full names.
3. The Postseason tab shows the same change, and placeholder labels such as `SEC Team TBD` are unchanged.
4. **Long names fit.** At the narrowest two-column container width and at phone width, the longest
   2026 provider name truncates on the team line rather than wrapping or pushing the row's right-hand
   anchor off. Measure the longest name in the stored 2026 schedule, and include it in the required
   browser gate. Overview already renders these names in the same component, so say whether its evidence
   transfers or why it does not.
5. Each assertion that defended an abbreviation is replaced, not deleted, and the replacement is
   stated per line.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**A fixture-based test needs a positive control proving the fixture can fail.** Acceptance 1 is the
likely false green: a fixture whose `labels.scoreboardName` already equals `csvAway` passes with the
defect restored. Use fixtures where the abbreviation and the provider name differ, and show the test
failing against today's code.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **Which field, exactly?** Overview reads `game.csvAway` / `csvHome`. The selector's fallback reads
   `participant.rawName`, then `displayName`. Say whether `csvAway` equals `rawName` for a team
   participant after the merge in `buildAuthoritativeGameCollection`
   (`schedulePostseasonHelpers.ts`, `participantCsvValue`), and what each yields for a TBD placeholder.
   Pick the one that makes acceptance 1 structural rather than coincidental.
2. **After the change, does anything still read `labels.scoreboardName`?** Planning found
   `gameWeek.ts:189` as its only production reader. If none remain, say whether to delete the field and
   the five overrides' `scoreboardName` entries, or keep them. `AGENTS.md` requires a module left with
   no production consumer to say why in the code, so "keep" needs a named future consumer. Also list the
   readers of `labels.displayName` and `labels.shortDisplayName`.
3. **Does any other Schedule behaviour read `awayTeamName` / `homeTeamName`**: sorting, search,
   filters, `aria-label`s, focus targets, `matchupLabel`? Enumerate the readers of the card's name fields.
4. **`formatOddsSummary` falls back to `odds.favorite`** (a canonical name) when the favorite side
   cannot be derived (`gameWeek.ts:163`). After this change a row can say `Ole Miss` while that fallback
   prints the canonical name. Say whether that fallback is reachable on real 2026 odds rows (a count),
   and leave it unchanged either way. It is filed-if-reachable residue, not this slice.
5. **The longest provider name** in the stored 2026 schedule, its character count, and what it renders
   like at the two widths in acceptance 4.
6. **Which existing assertions change**, by file and line, and why each replacement is not a weakening.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
