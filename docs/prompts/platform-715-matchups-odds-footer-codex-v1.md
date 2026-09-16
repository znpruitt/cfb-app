# PLATFORM-715 — odds on scheduled Matchups rows

```text
PROMPT_ID: PLATFORM-715-MATCHUPS-ODDS-FOOTER-CODEX-v1
PURPOSE: Render the betting line on SCHEDULED Matchups rows, with `Line not posted` as explicit
         content when no line exists. Requires a contract-specific display formatter for
         `CombinedOdds`; three formatters exist, but none implements this contract.
SCOPE:   src/lib/gameCardPresentation.ts (new formatter + tests) and
         src/components/MatchupsWeekPanel.tsx (the caller) and its tests.
         DO NOT modify src/lib/odds.ts, CompactGameScoreboard.tsx, matchups.ts, gameTags.ts, or
         any selector. If the work appears to need one, stop and report — that is a finding.
CARRIES: Item 87 INDEX row 29, verbatim in the part that binds:
         "Odds inline on Matchups — SCHEDULED ROWS ONLY. CORRECTED 2026-09-08 by owner ruling.
         This row previously read 'including live and final rows'; that phrase is in neither the
         design document nor the mockup. The document (`matchups-schedule-design.md:104`) says only
         'inline on Matchups, where nine games per card justify them' and names no state. The
         mockup names the states: all six `sb-odds` elements sit in SCHEDULED blocks — zero on
         live, zero on final — and gives the empty case an explicit `Line not posted`. The 'live
         and final' phrasing came from the 2026-09-08 discharge note below the widening, which
         inferred a requirement from a code constraint (the footer was gated to `scheduled`).
         A gate is not a requirement."

         Item 155's ruling, which stays in force: the reserved empty BAND was REMOVED from
         Matchups and must not return. A vertical list has no peer to align with, so it reserves
         no height. `Line not posted` is CONTENT, not a spacer.
```

---

## Why this is its own slice

This issue was grouped with #723 and #725 as "Matchups caller work" and **split out at the read receipt**,
because the issue's claim that it is caller-only turned out to be false. The data is present and the
seam is open — both true — but **none of the three display formatters for `CombinedOdds` implements
this contract.** `watchlistOddsFooter` uses canonical favorite data and nullable empty content;
`formatOddsSummary` is an expanded Schedule summary with labels and moneylines; `buildOddsSummary`
is a diagnostic string with source metadata. The type carries fifteen fields and the mockup shows
one rendering of three of them, so this slice still needs its own formatter and decisions for the
cases the mockup does not show.

Those two shipped in `539982ee` (PR #800). This is the remainder.

---

## What already exists, verified at `main`

**The data reaches the row.** `MatchupsWeekPanel` receives `oddsByKey` and already reads the row's
entry — it currently passes it only to `computeGameTags`.

**The seam is open.** Item 155 made `CompactGameScoreboard`'s footer content-gated, so any state may
carry a `footerSlot`. The caller decides which do.

**The favorite is already derivable, and the helper is exported.** `deriveFavoriteSpreadPair(homeSpread,
awaySpread)` in `src/lib/odds.ts` returns `{ favoriteSide: 'home' | 'away' | null, spread }` — the
lower signed value is the favorite's line, equal values are a pick'em with a reported spread and no
favorite, and missing side data returns `null` because it cannot be derived. **Use it. Do not
re-derive the comparison.**

---

## THE TRAP THAT COST THE LAST SLICE A ROUND — READ THIS BEFORE WRITING THE FORMATTER

**`CombinedOdds.favorite` is a CANONICAL name. The Matchups row renders RAW PROVIDER names. They
diverge.**

`favoriteNameForSide` (private, `odds.ts:168-175`) returns `game.canHome` / `game.canAway`. The row
renders `slateGame.game.csvAway` / `csvHome`. And `canHome = homeResolved.canonicalName ?? item.homeTeam`
while `csvHome = item.homeTeam` — so **they differ exactly when the resolver canonicalises an alias**,
which is the case nobody will have in a fixture.

**The odds line would then name a team by a string that does not appear on the row it sits under.**

**REQUIREMENT: the formatter takes the signed spreads, resolves the side, and renders the ROW'S OWN
name. It must never print `favorite`.** Found by the UI lane on the #723 receipt; it is the single
most likely way to ship this looking correct.

---

## The rendering

**Format, from the mockup** (`mockups/matchups-schedule-mockup.html:401`):

```text
Georgia Tech −7.5 · O/U 48.5
```

**Character-exact.** The minus is **U+2212 MINUS SIGN** (`&minus;`), not a hyphen. The separator is
**U+00B7 MIDDLE DOT** (`&middot;`), not a period. The mockup's `.sb-odds` also carries `num` for
tabular figures and `white-space: nowrap` with ellipsis overflow.

**Empty case:** `Line not posted`, as a real string on the row. **Not a reserved band** — Item 155
removed that from Matchups and it does not come back. Rows are uniform because they all carry
content, not because one is padded.

**Scheduled rows only. Zero on live, zero on final.** That is row 29's owner ruling, already
corrected once. Do not widen it.

## The cases the mockup does not show

**All three have ZERO production instances** — measured by the UI lane against `durable-odds:2026`,
all 305 records: spread+total 305, spread-only 0, total-only 0, pick'em 0, favorite-null-with-spread
0. Structurally reachable (the type nulls each field independently and pick'em is explicitly
modelled), observed never.

| case | render |
| --- | --- |
| spread, no total | `Georgia Tech −7.5` alone |
| total, no spread | `O/U 48.5` alone |
| **pick'em** (equal side spreads) | **`Pick'em · O/U 48.5`** — OWNER RULING 2026-09-15 |
| neither | `Line not posted` |

The separator is the only thing that disappears in the first two. **Pick'em was escalated rather than
defaulted** because `Pick'em` / `PK` / suppress-the-spread are three different products and the
mockup, `DESIGN.md` and the issue are all silent; zero instances means a wrong guess ships
unobserved and stays wrong.

---

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**A test's name is a claim and must be falsifiable.** The last slice renamed a test to fix a stale
name and **the new name was equally unfalsifiable** — a final-row assertion discriminates nothing
when two independent mechanisms both suppress finals. Before you name a test, say which mutation
reddens it.

**Negative assertions need a proven observer.** A test asserting "no odds on live rows" must include
a positive control showing the same harness DOES see odds on a scheduled row — otherwise it passes
because the fixture never had odds at all.

**Pair every mechanism comment with the test that asserts the same behaviour.** If no test asserts
it, the comment is unverifiable and must say less. Eight false mechanism comments have shipped on
the sibling issue; this is the check that catches them inside the commit.

---

## STOP — read receipt before writing any code

1. **Where should the formatter live, and what is its signature?** `gameCardPresentation.ts` beside
   `formatPrimaryBroadcastLabel` is SCOPE's assumption. Say whether that holds, and what it takes —
   a `CombinedOdds` plus what else, given it must render the row's own names.
2. **Confirm or refute the divergence.** Show `canHome`/`csvHome` diverging, from the code. Then say
   whether any CURRENT production row would render differently — a count, not a judgement.
3. **`deriveFavoriteSpreadPair` returns `{favoriteSide: null, spread}` for a pick'em AND `null` for
   missing side data.** Confirm those are distinguishable at the call site, and say what your
   formatter does with each.
4. **Does `CombinedOdds` reach the row for games with no odds at all** — is the map entry absent, or
   present with null fields? This decides whether `Line not posted` is an absence branch or a
   null-fields branch, and getting it wrong makes one of them dead code.
5. **What renders today on a scheduled Matchups row's footer?** Nothing, per the issue. Verify it,
   and say whether adding one changes row height or spacing for rows that currently have none.
6. **Enumerate the states `projectMatchupsGameState` can return**, and confirm `scheduled` is the
   only one that gets a footer. `Members` also reaches `unavailable` through
   `projectMembersGameState`, but does not consume `CompactGameScoreboard`; of the scoreboard
   consumers, Matchups is the one that can render the defect. Say explicitly that `unavailable`
   gets no odds, from the ruling rather than from the code.
7. **Is the U+2212 / U+00B7 requirement satisfiable in the test harness?** A raw U+2028 once made a
   test look vacuous on this project. Say how you will assert the exact characters.
8. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
