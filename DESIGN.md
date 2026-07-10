# CFB App Design Principles

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: durable UI/UX and design-system principles — layout, tables, cards, color, typography, component presentation
Supersedes: (none)

> **Doc authority (source of truth):** this file is canonical for **UI/UX and the design system** — layout, tables, cards, color, typography, and component presentation. Code architecture and agent operating rules live in `AGENTS.md`; Claude-specific working guidance lives in `CLAUDE.md`. This file should not carry code-architecture claims. See [`docs/README.md`](docs/README.md) for the full documentation map and per-doc ownership.

## Core philosophy
- The app should feel thoughtfully laid out and highly functional, not AI-assembled
- Every UI element must earn its place — if it duplicates information available elsewhere, remove it
- Interaction over decoration — use hover/click states to reveal context rather than cluttering the resting state
- Information density is a feature, not a risk — tighter layouts with less redundancy serve users better

## Layout
- Two-column layouts should feel intentional — column headers align, vertical rhythm matches across columns
- Remove section headers that restate what the nav tab already communicates
- Tighten padding aggressively — default spacing assumptions are usually too generous for a data-dense app

## Multi-line row pattern
- Line 1: primary identifier + right-anchored value (rank, score, count, delta) — body size (14–15px), weight 500, primary text color
- Line 2: secondary metadata — 12px, weight 400, `var(--color-text-tertiary)` (or the equivalent dim token)
- 2px margin between lines, no border between them, no internal padding
- Trailing-whitespace test: if a single-line row ends with notable whitespace before the right-anchored value, restructure to multi-line — the line-2 metadata must add context the user would want to see anyway
- Applied on the main Overview standings rows; History Overview Championships, Top rivalries, Title droughts, and Movers sections
- Not appropriate when line-2 content adds no information (basic to-do lists, link lists) — the pattern earns its place when line-2 metadata is at least as informative as the primary value

## List row width discipline
- Earned-width rule: a row's content must fill its allotted width — short primary content + short right-anchored value should either restructure to multi-line (so line 2 fills width) or sit in a narrower container
- Right-edge anchor rule: every row needs a right-edge anchor — a colored numeric value (delta in green/red, score, count in amber), a routing arrow (→), or a small icon (trend chip, status indicator)
- Rows that trail into whitespace with no visual terminus drift — the eye loses the row's left-to-right relationship and the section reads as disconnected names instead of structured data
- Production examples: AP Poll uses trend chips, Standings uses multi-line blocks, Insights uses arrows
- Single-line drift fix: if a section's rows are inherently single-line and a right-anchor isn't natural, constrain the section's width — do not let it stretch

## Navigation
- Underline tab style throughout — no pills, no background fills, no rounded borders on active states
- Sub-view tabs belong in the content area, not a dedicated nav band
- Tab labels should describe content, not restate the parent — "League Table" not "Standings"

## Tables
- Tables serve as legends when charts are present — do not duplicate the table data in a separate legend
- Color encodes identity at the interaction layer — row tints on hover/select connect table to chart
- On the full Standings page, rank numbers carry the owner's chart line color — minimal footprint, maximum utility
- Redundant columns should be hidden when they carry no information (e.g. MOVE column at season end)
- On mobile, hide lower-priority columns (PF, PA) and remove card borders — let the table breathe

## Responsive column degradation
- Tables define an explicit column-priority order — columns drop in the declared order as viewport (or container) width decreases
- CSS-driven column wrapping or horizontal scroll are last-resort fallbacks, not the default response
- Each table component declares its priority inline (comment) or in a co-located doc — a table without a declared priority is not ready for production at multiple breakpoints
- Always show: identifier columns (rank, name) and the table's defining metric (record for standings, score for rivalries)
- Drop first: derived/secondary metrics inferable from other columns or page-level summary stats (avg-finish, seasons-played when "6 seasons played" already shows on the page)
- Drop next: contextual columns that duplicate information visible elsewhere on the page (titles count when a Championships section is also visible)
- Drop last: any column whose absence would make the row meaningless
- Prefer container queries over viewport media queries — a sidebar-narrowed desktop table has the same constraint as a mobile-width table; if container queries aren't viable yet, document the viewport breakpoints that trigger each drop
- Reference example — History Overview All-time standings: always rank/owner/record; drop avg-finish first, then seasons, then titles, then win% last

## Charts
- Charts need breathing room — right edge padding prevents data point clipping
- Y-axis domain should hug actual data range, not default to 0–max
- Use convergence-based domain calculation to avoid early-season variance distorting the view
- Final week x-axis label reads "Final" not a week number
- Labels that duplicate legend information should be removed — let the legend do its job
- Hover interactions should be bidirectional — chart affects table, table affects chart
- On mobile, show a compact vertical legend alongside a horizontally scrollable chart

## Color
- Amber/gold is reserved exclusively for champion/podium signals — not a general accent color
- Blue signals interactivity or active state only — never use blue to mean "featured" or "important"
- Chart line colors are fixed per owner for the full season — never change with standings position
- No color for decoration — every color must encode meaning
- CFP round badges use neutral slate/gray — distinct from status colors

## Interaction model
- Hover to preview, click to lock, click again to unlock
- Multi-select is additive — clicking multiple rows builds a comparison set
- All interactions reset cleanly — no orphaned state
- Bidirectional binding between table and chart is the standard pattern for this app
- On mobile, interaction lives in a dedicated legend — not the data table

## Cards and game results
- Game cards sit on a dark surface tint with a light border — discrete, bordered objects (see Containerization), carrying team-color accent bars on the top and bottom edges
- Rankings display inline with team names — "#4 Oregon vs #2 Indiana"
- Use W16 CFP rankings for postseason game cards — not Final Poll rankings
- CFP round badges use full words — "CFP Quarterfinal" not "CFP QF"
- Conference championship badges include the conference name — "SEC Champ"
- Regular bowl games carry no badge — rankings tell the story
- Winner score is full opacity/weight, loser score is muted
- "Top matchup" and "Close" are internal selection signals only — never user-facing labels
- Game selection is context-aware: postseason surfaces playoff/bowl games, in-season surfaces current week
- First Round CFP games are identified by neutral site = false (campus games)

## Containerization
- Outer card containers are removed from all Overview sections except the season podium
- Individual game cards retain borders — they are discrete objects
- Major sections may be separated by either generous whitespace alone (minimum 40px between sections) or a horizontal divider (0.5px, `var(--color-border-tertiary)`)
- Whitespace separation is preferred for dashboard-style pages where sections share a visual rhythm and column structure (History Overview, main Overview)
- Dividers are appropriate when adjacent sections have different visual weights or structural patterns and need explicit visual separation
- Card chrome is reserved for content that has a meaningful border signal (e.g. amber champion border)

## Owner Colors
- Each owner has a single persistent assigned color defined in src/lib/ownerColors.ts
- getOwnerColor(ownerName) is the sole source of owner color across the entire app
- Handpicked 14-color palette — all visually distinct in dark mode, no near-duplicates
- Owner colors are used for chart lines and their companion table legend labels
- Colors are fixed — not derived from standings position or render order
- Future: user-assignable colors are a planned enhancement but not yet implemented

## Podium
- Three equal horizontal cards
- Champion (#1) gets amber border (1.5px, #BA7517) and amber rank label
- #2 and #3 get neutral borders and muted rank labels
- No narrative text on podium cards — data speaks for itself
- No "Season podium" section title
- Amber is reserved exclusively for champion signals — never used for decoration

## Champion Narrative Copy
- Champion margin is always expressed in games back, never win percentage delta
- Win% is a tiebreaker — never the primary margin descriptor

## Section Headers
- Plain text section title, 15px, font-weight 500
- CTAs are plain text → aligned right in the same header row
- No card chrome around section headers

## Trends / GB Race
- Renamed from "Trends" to "GB Race" on Overview
- Inline chart labels removed — companion table serves as legend
- Companion table shows GB change over last 5 weeks with total GB column
- Owner names color-coded using getOwnerColor()

## Color encoding
- Owner names are color-coded ONLY when the table is serving as a legend for an adjacent chart
- Rank numbers are plain muted text in the Overview condensed snapshot and the History standings tables; the full Standings page is the deliberate exception — its rank numbers carry the owner's chart line color (see Tables). Podium rank labels use the Podium tier accent (amber #1, muted #2/#3), never owner color
- Chart line colors and their companion table legend colors must always match via getOwnerColor()

## Overview standings row hierarchy
- Specific application of the `## Multi-line row pattern` — see that section for typography
- Primary line: rank (muted) · name · champion badge (if applicable) · record · GB
- Secondary line: Win% · Diff
- GB is the primary metric in a pool format and sits on the primary line
- Column headers are omitted on condensed snapshot tables of ≤4 columns where data is self-evident at the table's density (rank · name · record · GB) — retained on dense tables of ≥5 columns where the additional columns introduce metrics whose meaning is not obvious from value alone (Win%, Seasons, Avg, Titles)

## Overview trifold layout
- Three columns: Standings (25%) · FBS Polls (25%) · Insights (50%)
- Poll column shows AP Poll during regular season and season end, CFP Rankings during postseason
- Top 10 entries only in the poll column
- Poll column header uses same styling as peer column headers (15px, font-medium)
- CTA links to full rankings page
- Insights is not a standalone full-width section — it only renders in column 3

## Insights Panel
- Shows up to 5 insights, sorted by priorityScore (or Season Recap + 4 when `fresh_offseason`)
- First row gets visual prominence — `text-[15px]` title vs `text-[14px]` for rows 2–5
- Each row: category microlabel (10px uppercase, 0.08em tracking, category color) · title · description
- Rows are tappable when `navigationTarget` is set; minimum 44px tap target
- Panel footer: "See all →" link routes to `/league/[slug]/insights`
- Full-insights page mirrors row structure with all rows at `text-[15px]`
- Mobile: panel renders full-width (no column constraint); rows retain identical structure

## Insight Category Colors
- Categories use one-to-one color tokens defined in `src/lib/insightCategories.ts`
- Current palette (light / dark hex pairs):
  - HISTORICAL: `#534AB7` / `#AFA9EC`
  - RIVALRY: `#993C1D` / `#F0997B`
  - CAREER: `#0F6E56` / `#5DCAA5`
  - TRAJECTORY: `#993556` / `#ED93B1`
  - STATS: `#5F5E5A` / `#B4B2A9`
- Theme resolution: `useIsDarkMode()` hook reads `window.matchMedia('(prefers-color-scheme: dark)')` and picks the matching hex
- Semantic colors are one-to-one and off-limits for categories:
  - Amber = champion/podium
  - Green = positive delta
  - Red = negative delta
  - Blue = interactivity/active state
- Category colors must draw from unassigned palette stops — never reuse a semantic color

## Poll phase logic
- inSeason → AP Poll
- postseason → CFP Rankings
- complete → AP Poll (final)

## Light/dark mode
- Dark mode uses Tailwind `media` strategy (`prefers-color-scheme`) — no `.dark` class on `<html>`
- Light mode is the base Tailwind class layer (no prefix needed); dark mode uses `dark:` variants
- Page background in light mode: white (`--background: #ffffff`)
- Card surfaces in light mode: `bg-gray-50` with `border-gray-300` — provides visible separation from white page
- Nested containers (cards inside cards): `bg-white` with `border-gray-300`
- Navigation tab borders: `border-gray-200` in light, `dark:border-zinc-700` in dark
- Active tab text: `text-gray-900` in light, `dark:text-white` in dark
- Owner colors: separate lightness-adjusted palettes for light and dark backgrounds (same hues)
- Owner color auto-detection via `window.matchMedia('(prefers-color-scheme: dark)')`
- User preference override: deferred until user accounts are built
- When adding user override: switch Tailwind to `class` strategy, add theme provider

## Scope discipline
- Do not add features not explicitly requested
- If a better solution exists, recommend it before implementing
- Every prompt includes explicit scope limits
- UI additions require explicit justification — adding complexity without clear user value is a defect
