PROMPT_ID: PLATFORM-676-OVERVIEW-SECTION-EXPANSION-CODEX-v1
PURPOSE: Give Overview's four capped sections the expand-in-place control that Item 87 decided and
nothing implements, and make the section count tell the truth in the same change.
SCOPE: `src/components/OverviewPanel.tsx`, `src/lib/selectors/overviewGameSections.ts`,
`src/lib/selectors/overview.ts`, and their existing suites. NOT Matchups, NOT Schedule, NOT
`CompactGameScoreboard` internals, NOT the three-column tier (#678/#726, unbuilt).
CARRIES: the LIVE standing rules binding every Item 87 prompt, plus both Item 115 rows, verbatim
from `docs/campaigns/item-87-INDEX.md`:

> **1 — LIVE.** A build with records absent or stale **will not match the mockup**, and a reviewer
> comparing them must read that as a **sequenced dependency, not a defect**. State this in the
> prompt. **Owner ruling 2026-09-08:** a missing record leaves the anchor **blank**, never the
> spread — and a **store failure** (transient, no item) is NOT the same condition as **"not wired to
> this surface"** (a sequencing state that needs a filed item and this sentence in the prompt).
> Records are wired on Overview and Matchups; Schedule remains in the second state under Item 156.

> **6 — LIVE.** **Do not "restore" the mockup's tint inset.** The implementation ships `0 -8px` plus
> squared facing corners; the mockup's former `-1px -8px` produced a darker stripe at the seam.
> **Anyone reconciling the two changes the MOCKUP, not the code.**

> **7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation** before putting it in a prompt — they have been stale at least twice, and
> `DESIGN.md` moved again on 2026-09-08.

> **8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be forked**.
> **CORRECTED 2026-09-08 — "four consumers plus the recap" was wrong on both halves.** There are
> **five direct renderers**: Overview `GameCardList` (serving Live AND Recent finals), Overview
> `WatchlistScoreboardList`, Overview `FeaturedGamesList`, `GameWeekPanel`, and Matchups `GameRow` —
> three importing modules, six rendered contexts. **And the recap is NOT a consumer**:
> `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`, which is what Item 143 creates
> the seam for.

> **9 — LIVE.** **Never suppress individual finals against recap content**, and do not reintroduce a
> subtler version. Recent finals is complete; the recap is curated.

> **14 — Item 115.** **Counts become totals in the same change that makes the surplus reachable**;
> visible-only until then.

> **15 — Item 115 / 134.** Caps are counts, not rows; decide whether they become tier-dependent or
> stay ragged.

---

Read `DESIGN.md` before starting. Issue: [#676](https://github.com/znpruitt/cfb-app/issues/676).

## The decision already exists

`docs/campaigns/item-87-live-watchlist-scoreboard.md:318` settles the design:

> **Progressive disclosure per section:** bounded default, expands in place. Header link → Matchups
> tab; footer control expands this week's slate.

This is unbuilt work, not an open question. The cap was designed as **a default you open past**, not
a ceiling.

## Owner ruling, 2026-09-11 — expansion does not persist across navigation

**An expanded section resets to its bounded default when the member leaves Overview and comes back.**
It is a single click to reopen, and a default that stops being the default after one click is not a
default. Anyone who always wants the full slate has Matchups.

**The auto-refresh case is already decided and is different.** While the member is sitting on the
page and scores refresh underneath, an open section **stays open** and only the contents change —
`item-87-live-watchlist-scoreboard.md:382`, which also states that a finalising game migrates to
Recent finals immediately, including while a section is expanded. That document attributes the
survival to `router.refresh()` preserving client state. **Verify that for whatever you build rather
than inheriting it** — the citation it gives (`useLiveRefresh.ts:443`) does not resolve; the file is
`src/components/hooks/useLiveRefresh.ts` and mentions `router.refresh()` only in a comment at :126.

## Why this is sharper than a volume problem

Live sorts by kickoff alone since POLISH-023, so the cap changed meaning from "scored rows win the
slots" to "earliest kickoffs win the slots." A provider gap across one kickoff window routes those
games to awaiting-score, and the abandonment gate holds them there for up to `GAME_MAX_DURATION_MS`
— 8h from kickoff, `src/lib/standingsHistory.ts:109`, confirmed. Six such rows hold the earliest
`sortDate`s, fill Live, and every later game carrying a real score is sliced off.

**The Live section can show six "Awaiting score" rows and zero scores during a live slate, for
hours.** That is not a defect of the sort — the rows are in the decided order. It is the hard cap
with no way past it.

**Owner note 2026-09-04:** this does not reopen the rejected awaiting-score partition —
repositioning on a polling surface is still worse. But eight hours is not the "brief gap" that
decision assumed, and this slice has to handle the scoreless-row direction specifically.

#727 has just established when a row is `awaiting` versus carrying usable score evidence, and
recorded the eight-hour transition as deliberately unchanged. Read that entry before starting.

## The count is a truth defect, and row 14 binds it to this change

`src/components/OverviewPanel.tsx:1585`:

```ts
const liveTitle = `Live · ${gameSections.live.length}`;
```

`gameSections.live` is already sliced, so **"Live · 6" against ten live games is false today.**

`section-ordering-resolutions.md:75` states why it was left that way and why it cannot be fixed
alone: making it a total *before* the surplus is reachable "would state that ten games exist while
four remain unreachable, which is a promise it cannot keep." Row 14 is the other half — **counts
become totals in the same change that makes the surplus reachable.** That is this change.

Live is currently the only section rendering a count. Establish that before widening it.

## Row 15 — take the ragged option and say so

Caps are counts, not rows. Whether they become tier-dependent belongs with the three-column tier,
which is unbuilt (#678, #726). **Stay ragged, and record it as a deliberate deferral** naming those
issues, so the next author does not re-derive it.

## Verified state — re-derived at `d987f62a`, because the issue's citations have drifted

| fact | verified location |
| --- | --- |
| Live / Recent finals / Watchlist cap at 6 | `src/lib/selectors/overviewGameSections.ts:10-12` |
| Featured cap at 4 | `src/lib/selectors/overview.ts:82` (`OVERVIEW_RESULTS_LIMIT`) |
| `All results →` header links | `OverviewPanel.tsx:1757`, `:1815` |
| the count built after the slice | `OverviewPanel.tsx:1585` |
| abandonment window, 8h | `src/lib/standingsHistory.ts:109` |

**The issue body is stale on three of these** and states a sixth that does not reproduce: it cites
`overview.ts:69` for the Featured cap of 4 (line 67 is `DEFAULT_LIVE_ITEM_COUNT = 6`, a different
constant in a different file), and `OverviewPanel.tsx:1651`/`:1737` for the header links. Do not
copy citations forward from the issue — re-derive, per standing rule 7.

**No expansion control exists anywhere.** Verified across `OverviewPanel.tsx`,
`CompactGameScoreboard.tsx` and `navigation/ViewMoreLink.tsx`: no `aria-expanded`, no show-more
control. The two `useState` calls in `CompactGameScoreboard.tsx:75-76` are logo-load retry state and
are unrelated.

## The test gap closes here

`src/lib/selectors/__tests__/overviewGameSections.test.ts:323` —
`live rows ignore owner count and keep the six-row cap on kickoff order` — uses one unscored row
plus six scored ones, so **it never exercises the direction where unscored rows consume the cap**:
the exact failure this item exists to fix. A test that cannot reach the scenario is not coverage for
it.

---

## STOP — read receipt before writing any code

Answer from the files, not from this prompt. Every question below is one this prompt could be wrong
about.

1. How many Overview sections render a count today, and what is each one's exact template string?
   Quote them with `file:line`.
2. `OVERVIEW_WATCHLIST_LIMIT` is applied at `overviewGameSections.ts:224` with a `break`, not a
   `.slice` like the other two. Does that change what "the surplus" means for Watchlist — is there a
   reachable remainder to expand into, or does the loop stop building one? Show the code path.
3. For each of the four sections, name where the **unsliced** collection is available to the
   component. If any section's surplus is discarded in the selector and never reaches
   `OverviewPanel`, say which, because that decides whether this is a component change or a selector
   change.
4. Does an expanded section survive `router.refresh()` for the mechanism you intend to use? State
   the mechanism and what you verified, not what the campaign document asserts.
5. `GameCardList` serves both Live and Recent finals (standing rule 8). What breaks if expansion
   state is held per-component rather than per-section?
6. **What in this prompt contradicts what you found in the files?** Answer specifically. Three of its
   citations were already stale once.

Do not start until the receipt is answered and I have ruled on it.
