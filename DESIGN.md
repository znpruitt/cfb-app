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
- Rank numbers carry the owner's chart line color — minimal footprint, maximum utility
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

## Scope discipline
- Do not add features not explicitly requested
- If a better solution exists, recommend it before implementing
- Every prompt includes explicit scope limits
- UI additions require explicit justification — adding complexity without clear user value is a defect
