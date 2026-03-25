# PROMPT_ID: P2B-OVERVIEW-FEATURE-AUDIT-v1
# PURPOSE: Audit the current Overview page to identify overlapping versus uniquely valuable modules before UI redesign work. Provide planning guidance that improves coherence without changing runtime behavior.
# SCOPE: OverviewPanel and directly related helper usage only; no API, ingestion/model, or implementation changes. Analysis and planning output only.

## Concise summary

The current Overview surface contains seven distinct modules, but three of them (League snapshot, League summary hero, and League standings) all answer the same core question: **"Who is leading right now?"**. The page is information-rich but redundant at the top, while unique context modules (highlights, live feed, matrix) are pushed lower. A cleaner hierarchy should preserve the adaptive season-context hero and game-centric modules, while collapsing duplicated standings summaries into one primary ranking block.

## Module-by-module audit

### 1) League snapshot (top card)
- **Visible purpose:** quick at-a-glance dashboard of leader, chase gap, swing games, and live owned games, plus a featured weekly callout and a condensed standings table.
- **Main user question:** "What is the league state in one glance?"
- **Key inputs/data used:**
  - `computeStandings(games, scoresByKey, rosterByTeam)` for leader/records and table rows.
  - `computeWeeklyInsights(...)` for swing games and live owned games counts.
  - `keyMatchups` + `deriveGameHighlightTags(...)` + rankings for featured weekly callout selection.
- **Category:** standings/ranking **and** weekly narrative/context.
- **Notes:** this card is currently a composite of three submodules (snapshot metrics, featured callout, mini standings table).

### 2) League summary hero
- **Visible purpose:** context-aware season narrative banner (leader/championship framing, gap/diff signal, placement summary).
- **Main user question:** "What does the current season phase mean for the title race?"
- **Key inputs/data used:**
  - `standingsLeaders` for leader/runner-up/third placement and metrics.
  - `context.scopeLabel/scopeDetail` for scope messaging.
  - `liveItems` + `keyMatchups` + `standingsCoverage` via `deriveLeagueSummaryPhase(...)` to switch tone/headline across in-season, postseason, and complete states.
- **Category:** season narrative/context.
- **Notes:** this is the only module that meaningfully changes message framing by league phase.

### 3) Insight strip
- **Visible purpose:** short rotating-style insight chips (leader gap, rank movement, live impact, top-25 signal, close games).
- **Main user question:** "What are the most important league talking points right now?"
- **Key inputs/data used:**
  - `deriveLeagueInsights(...)` with `standings`, `previousStandings`, `recentResults` (`keyMatchups`), `liveGames` (`liveItems`), and rankings map.
- **Category:** season narrative/context + recent activity.

### 4) League standings (main left card)
- **Visible purpose:** fuller standings list with rank movement arrows and optional coverage message.
- **Main user question:** "How does everyone rank right now?"
- **Key inputs/data used:**
  - `standingsLeaders` (from `deriveOverviewSnapshot` input `standingsRows`).
  - `previousStandingsLeaders` for up/down arrows.
  - `liveCountByOwner` (derived from `computeStandings`) for live badges.
  - `standingsCoverage.message/state` for data-quality context.
- **Category:** standings/ranking.

### 5) Highlights list (right card, `context.highlightsTitle`)
- **Visible purpose:** curated key matchups/results depending on current slate emphasis.
- **Main user question:** "Which league-relevant games matter most right now?"
- **Key inputs/data used:**
  - `keyMatchups` from `deriveOverviewSnapshot`.
  - `context.highlightsTitle` from `deriveOverviewContext` (live/upcoming/recent/standings emphasis).
  - rankings + `deriveGameHighlightTags(...)` and top-owner set for badges.
- **Category:** weekly narrative/context + recent activity.

### 6) Live card (`Live · N`)
- **Visible purpose:** dedicated live scoreboard feed for in-progress games.
- **Main user question:** "What is live right now and how is it affecting the pool?"
- **Key inputs/data used:**
  - `liveItems` from `deriveOverviewSnapshot` (built from all games, filtered to in-progress).
  - score state via `gameStateFromScore` and formatted score/kickoff labels.
- **Category:** recent activity.

### 7) Head-to-head matrix
- **Visible purpose:** owner-vs-owner weekly game-count and final record matrix.
- **Main user question:** "Who is directly matched up against whom this week, and what are the head-to-head results?"
- **Key inputs/data used:**
  - `matchupMatrix` from `deriveOwnerMatchupMatrix(...)` using week games, standings order, roster mapping, and scores.
- **Category:** filtering/navigation support + weekly narrative/context.

## Overlap and commonality analysis

### True duplication
1. **League snapshot mini standings table** vs **League standings card**
   - Both render `CondensedStandingsTable` with near-identical columns/visual semantics.
   - Both answer "who is ranked where".

2. **League snapshot leader metric** vs **League summary hero headline/record**
   - Both restate current leader and top-line record context.

### Partial overlap (distinct framing)
1. **League snapshot metrics** and **Insight strip**
   - Shared signals: gap/live/swing-like urgency.
   - Snapshot is fixed KPI tiles; Insight strip is narrative ranking of most salient events.

2. **Featured weekly callout** and **Highlights list top item**
   - Both derive from `keyMatchups`; callout is a single-line teaser while Highlights is full context list.

3. **League summary hero** and **League standings**
   - Inputs overlap (`standingsLeaders`) but outputs differ: narrative framing (hero) vs full rank detail (table).

### Genuinely unique/defensible content
1. **Head-to-head matrix** is unique relational information not available in standings/highlights.
2. **Live card** is unique as dedicated real-time operational view (status + score + kickoff per game).
3. **League summary hero** is unique because phase-awareness (in-season/postseason/complete) changes interpretation, not just values.

## Unique value focus: season summary hero

Even though the hero shares leader inputs with standings/snapshot, it is still uniquely valuable because it:
- changes headline semantics (`League leader`, `Championship race`, `Champion`) based on `deriveLeagueSummaryPhase(...)`,
- switches the supporting metric from win% gap to point differential in late-season/complete contexts,
- blends season placement with scope metadata (`Week X`, postseason scope) to explain *why* this moment matters.

Recommendation: keep this module, but avoid repeating the same leader facts in neighboring cards.

## Proposed cleaner Overview layout plan

### Keep
- **League summary hero** (primary context anchor).
- **League standings** (single canonical rankings module).
- **Highlights list** (weekly relevance module).
- **Live card** (real-time module; hide when no live games as currently).
- **Head-to-head matrix** (advanced relational utility).
- **Insight strip** (optional compact narrative enhancer, preferably adjacent to hero).

### Merge
- Merge **League snapshot KPI tiles** into either:
  - a compact row under the hero, or
  - an expandable "Quick stats" area in the standings card.
- Remove duplicated standings table from League snapshot.

### Remove
- Remove standalone **League snapshot card** as a full section (it is the largest redundancy source).
- Remove standalone **Featured weekly callout** once highlights stays near top; its content is already represented in highlights.

### Move
- Keep matrix on Overview but place below game modules (or move to Matchups tab if Overview needs simplification on smaller screens).

### Recommended top-to-bottom hierarchy
1. **League summary hero** (season context + title race framing)
2. **Insight strip** (brief "what changed")
3. **Two-column core:**
   - left: **League standings** (single ranking source)
   - right: **Highlights** then **Live**
4. **Head-to-head matrix** (deep-dive utility)

This ordering preserves both strategic context (season) and tactical context (week/live) while minimizing repeated leader/standings content.
