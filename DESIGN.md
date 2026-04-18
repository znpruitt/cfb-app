# CFB App Design Principles

## Core philosophy
- The app should feel thoughtfully laid out and highly functional, not AI-assembled
- Every UI element must earn its place — if it duplicates information available elsewhere, remove it
- Interaction over decoration — use hover/click states to reveal context rather than cluttering the resting state
- Information density is a feature, not a risk — tighter layouts with less redundancy serve users better

## Layout
- Two-column layouts should feel intentional — column headers align, vertical rhythm matches across columns
- Remove section headers that restate what the nav tab already communicates
- Tighten padding aggressively — default spacing assumptions are usually too generous for a data-dense app

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
- Game cards use a dark surface tint — no border, defined by background only
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
- Horizontal dividers (0.5px, var(--color-border-tertiary)) separate major sections
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
- CTAs are plain text ↗ aligned right in the same header row
- No card chrome around section headers

## Trends / GB Race
- Renamed from "Trends" to "GB Race" on Overview
- Inline chart labels removed — companion table serves as legend
- Companion table shows GB change over last 5 weeks with total GB column
- Owner names color-coded using getOwnerColor()

## Color encoding
- Owner names are color-coded ONLY when the table is serving as a legend for an adjacent chart
- Rank numbers in all standings tables are plain muted text — never colored
- Chart line colors and their companion table legend colors must always match via getOwnerColor()

## Overview standings row hierarchy
- Primary line: rank (muted) · name · champion badge (if applicable) · record · GB
- Secondary line: Win% · Diff — smaller font, muted
- No column headers on condensed snapshot tables — data is self-evident at this density
- GB is the primary metric in a pool format and sits on the primary line

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
