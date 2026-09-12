PROMPT_ID: PLATFORM-671-LIVE-FINALS-TAG-SLOT-CODEX-v1
PURPOSE: Give Overview's Live and Recent finals sections the status-row tag slot that Featured
already has, so a game that is a Top 25 Matchup, a Close game, or an Upset says so on the row.
SCOPE: `src/components/OverviewPanel.tsx` (`GameCardList` and its call sites),
`src/lib/selectors/overviewGameSections.ts`, `src/lib/selectors/overview.ts`, `src/lib/gameTags.ts`
if and only if the vocabulary decision below requires it, plus tests for each file touched.
OUT OF SCOPE: the watchlist and Featured (already tagged), Matchups, Schedule, the recap, the
`Close`-on-unplayed-game defect (#716), the dead watchlist scoring term (#685), and any change to
section ROUTING or ORDERING.
CARRIES:

> Copied verbatim from `docs/campaigns/item-87-INDEX.md` → **CARRY THIS**. Rows 1, 6, 7, 8 and 9 are
> the LIVE standing rules, binding on every Item 87 prompt. **Checked the "LIVE obligations by owning
> item" table: no row there is owned by Item 173.** Rows 10–13 are Item 113, 24 is Item 142, 29 is
> Item 168, 30 is Item 143, 31 is Item 152, 20 is a planning reassignment.

- **Row 1 (LIVE).** A build with records absent or stale **will not match the mockup**, and a reviewer comparing them must read that as a **sequenced dependency, not a defect**. State this in the prompt. **Owner ruling 2026-09-08:** a missing record leaves the anchor **blank**, never the spread — and a **store failure** (transient, no item) is NOT the same condition as **"not wired to this surface"** (a sequencing state that needs a filed item and this sentence in the prompt). Records are wired on Overview and Matchups; Schedule remains in the second state under Item 156.
- **Row 6 (LIVE).** **Do not "restore" the mockup's tint inset.** The implementation ships `0 -8px` plus squared facing corners; the mockup's former `-1px -8px` produced a darker stripe at the seam. **Anyone reconciling the two changes the MOCKUP, not the code.** *(Applied 2026-09-08: `matchups-schedule-mockup.html` now carries `0 -8px 0 12px` plus squared facing corners.)*
- **Row 7 (LIVE).** **Do not read campaign status from the canonical document**, and **re-derive every line-number citation** before putting it in a prompt — they have been stale at least twice, and `DESIGN.md` moved again on 2026-09-08.
- **Row 8 (LIVE).** Selection and precedence stay selector-owned; the scoreboard **must not be forked**. **CORRECTED 2026-09-08 — "four consumers plus the recap" was wrong on both halves.** There are **five direct renderers**: Overview `GameCardList` (serving Live AND Recent finals), Overview `WatchlistScoreboardList`, Overview `FeaturedGamesList`, `GameWeekPanel`, and Matchups `GameRow` — three importing modules, six rendered contexts. **And the recap is NOT a consumer**: `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`, which is what Item 143 creates the seam for.
- **Row 9 (LIVE).** **Never suppress individual finals against recap content**, and do not reintroduce a subtler version. Recent finals is complete; the recap is curated.

---

## Lane and branch

**UI lane, `/Users/zach/cfb-app-codex`.** Branch off current `origin/main`. `main` is at `2bd76544`
and `npm test` exits 0 on it — **the known-failure set is EMPTY**, so any failure stops the merge.
Push `preview` with every commit on the branch, including the closeout commit.

---

## What is actually wrong

`GameCardList` (`src/components/OverviewPanel.tsx:750`) renders **both** Live and Recent finals and
passes **no `tagSlot` at all**. `CompactGameScoreboard` has accepted one since Item 143
(`src/components/CompactGameScoreboard.tsx:41`, rendered at `:256`), and Featured uses it
(`OverviewPanel.tsx:995`, shipped by PLATFORM-173A). Live and Recent finals never got it.

The cause is upstream of the component. `selectOverviewGameSections`
(`src/lib/selectors/overviewGameSections.ts:197`) takes `sectionItems: OverviewGameItem[]` —
**unprioritized** — and builds `live` and `recentFinals` as bare `OverviewSectionItem` (`:232-233`).
Only the `scheduled` collection carries prioritized data, because it is assembled from
`watchlistCandidates`. Tags live on `PrioritizedOverviewItem.highlightTags`, produced by
`prioritizeOverviewItems` (`src/lib/selectors/overview.ts:304`), which is called twice
(`:569` watchlist, `:574` results) and never for these two sections.

**173a is the precedent for the RENDER half and does not settle the SELECTOR half.** Featured could
wire a tag slot in one component edit because `FeaturedGamesList` already received prioritized items.
These two sections do not.

## The decision this item has to make, and must not guess

**Which vocabulary do Live and Recent finals use?** There are two, and the issue's own framing spans
both:

1. `deriveGameHighlightTags` (`src/lib/gameTags.ts:529`) emits exactly **two** tags — `top25`
   ("Top 25 Matchup") and `close` ("Close") — sorted by priority and capped at `TOP_BADGE_LIMIT = 2`
   (`:52`). This is what Featured and the watchlist render.
2. The league family (`LEAGUE_TAG_LABELS`, `src/lib/gameTags.ts:574`) carries `upset`, `upset_watch`
   and `top_25_matchup`. **`Upset` exists ONLY here.** `deriveGameHighlightTags` cannot produce it.

So #671's sentence *"`Upset` existed in the league family and reached Recent finals never"* is not
satisfied by wiring `highlightTags` through. **Wiring `highlightTags` alone gives Recent finals
`Top 25 Matchup` and `Close` and still no `Upset`.**

**Establish, do not assume, and report the answer in the receipt:**

- Is `Upset` in scope for Recent finals under this item, or is it a second slice? Item 157 unified
  the two vocabularies' LABELS; it did not merge the producers.
- If `Upset` is in scope, what is its predicate on a final, and where does it belong — extended into
  `deriveGameHighlightTags`, or read from the league family at the selector seam? A new producer is
  a fork; Row 8 forbids forking the scoreboard and the same reasoning applies to the selector.
- **Recommendation to test, not to adopt:** ship `top25` + `close` through the existing producer in
  this slice and file `Upset` separately, because the first is a wiring change and the second is a
  vocabulary change with its own predicate to justify. **If you disagree after reading the code, say
  so with the measurement behind it** — that is a better outcome than following this line.

## Two design rules that decide what may render

Re-derived against `DESIGN.md` today (Row 7); both sit in the *Cards and game results* group around
`DESIGN.md:296-320`:

- **"A marker restates nothing the row already shows, and POSITION decides whether restatement aids
  scanning."** A `Live` tag on the Live section or a `Final` tag on Recent finals restates the
  container and must not render. The campaign input states the same rule as *"a tag that restates its
  container is suppressed"* (`docs/campaigns/item-87-followon-overview-back-application.md`).
- **"Chips are capped at two"**, and **the selector must apply the cap, not the renderer.**
  `deriveGameHighlightTags` already slices to `TOP_BADGE_LIMIT`. If you introduce any second source
  of tags, the cap must still be applied once, in the selector, over the combined list — not twice,
  and never in `GameCardList`.

## A live hazard to state, because this change can widen it

`gameMargin` (`src/lib/gameTags.ts:70`) returns `null` when either score is `null`, so `close` cannot
fire without scores — **but a `0-0` attached score pack yields margin 0 and fires `Close`.** That is
the exact mechanism of **#716** (`Close` can fire on a game that has not been played), which today is
confined to the watchlist's scheduled pack. Live's `awaiting-score` rows are rows past kickoff whose
score has not attached; **if any of them carry a `0-0` pack rather than a null one, this change puts
`Close` on a game with no score on it.**

**Measure it, do not reason about it.** Determine whether an `awaiting-score` route can reach
`GameCardList` with a non-null `0-0` score pack. If it can: suppress `close` on `awaiting` rows in
**this** branch and say so in the receipt — #716 stays open and unfixed for the watchlist, and this
is a containment, not its fix. If it cannot, say that, with what you ran.

## Acceptance boundary

- Live and Recent finals rows render tags in `CompactGameScoreboard`'s `tagSlot` — the right edge of
  the **status row**, adding no line — matching what Featured ships.
- **Section routing and ordering are byte-identical.** `compareOverviewLiveItems`,
  `compareOverviewRecentFinals`, `routeForItem`, the expiry filter and the Featured-key exclusion all
  behave exactly as before. If the selector's signature changes to carry prioritized items, that is a
  plumbing change whose output ordering is unchanged, and a test must pin it.
- No tag restates its section.
- The cap is applied in the selector, once.
- **No fork of `CompactGameScoreboard`, and no second tag producer** without the justification above.
- Untagged rows are visually unchanged. `hasRenderableContent`
  (`src/components/CompactGameScoreboard.tsx:185`) already guards the empty slot — confirm rather
  than assume, since `[]` and `undefined` are different inputs to it.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each as its own command, each reporting its
  own real exit code, never behind a pipe. Report the test DELTA (added / changed / removed), not a
  total.
- **Every claim of the form "X now renders" needs a test that goes RED without the production
  change.** Mutation-prove each new assertion by reverting the production edit and reading WHICH
  assertion fired — a test that passes against both states is vacuous, and this campaign has shipped
  several.
- A test keyed on tag **ids** rather than rendered label strings, so a label change does not silently
  make it pass. (POLISH-010 shipped a vacuous test keyed on labels; do not repeat it.)
- Pin the "no tag restates its container" rule with a negative test that can actually see the tag —
  construct a fixture that WOULD produce the forbidden tag and assert its absence, with a positive
  control proving the fixture can produce a tag at all.

## Reviews

Both `/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop
and ask the owner to invoke them against the exact commit. Gather both before any remediation.
Reviews are a gate, not a queue: converge, do not treat each report as new work.

## Closeout

The closeout commit lands **on the branch, before the merge** — `docs/prompt-registry.md` entry for
this PROMPT_ID, and the `docs/next-tasks.md` / issue #671 state. Record what SHIPPED, including the
vocabulary decision as taken, not as this prompt proposed it.

## Notes for the implementer

- **Item 115 (#676) has shipped** (PR #744, `11350f11`), so the "173b interacts with Item 115 and
  should be sequenced rather than run concurrently" blocker on the issue is **discharged**. The
  section builder is yours alone.
- `topOwnerNames` is **not** an input to `prioritizeOverviewItems` — it was retired with Item 162 and
  survives only in comments and tests. Do not reintroduce it. Nothing about league standing may reach
  this selector.
- `#678`'s three-column tier shipped (PR #751, `4cfae75a`) and Live/Recent finals caps stay
  count-based. Tags must not change how a row wraps at the wide tier; if they do, that is a finding,
  not a licence to adjust caps.
