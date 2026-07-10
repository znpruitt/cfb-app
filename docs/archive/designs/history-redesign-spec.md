> **Status: Archived — historical reference only** (as of 2026-07-09). Not current implementation authority. See [`docs/archive/README.md`](../README.md); current authority lives in `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `docs/architecture/**`, and `docs/operations/**`.

# History page redesign — design spec

**Status:** Draft for HISTORY-RECORDS Phase 2 revision
**Companion to:** `DESIGN.md` (overall visual conventions)
**Mockup reference:** `history-redesign-minimal.html`

This document captures the visual decisions for the History Overview tab redesign. It is intentionally implementation-agnostic — it describes intent and rules, not specific CSS or Tailwind utilities. Claude Code translates these rules into the existing component patterns (Tailwind, React, existing primitives like `LeaguePageShell`, `FormerOwnerBadge`, `RecordBadge`).

When this spec conflicts with `DESIGN.md`, `DESIGN.md` wins — call out any such conflict explicitly rather than silently overriding.

---

## 1. Page-level layout

The History Overview tab is a single dashboard composed of stacked sections. No hero, no card chrome on sections, no top/bottom borders framing sections. Sections are separated by whitespace alone.

Section order, top to bottom:

1. **Championships** — full-width list of unique champions, with summary stat in the section head
2. **Dashboard row** — three columns: All-time standings · Recent podiums · Records
3. **Top rivalries + Title streaks** — two-column row (1.4fr / 1fr proportion)
4. **Season-over-season movement** — full-width section with two sub-columns (climbs / drops)
5. **Season archive** — full-width horizontal year strip

The page lives inside `LeaguePageShell` and renders under the History subnav (Overview / Stats / Rivalries / Archive). Phase 2 implements only the Overview tab; Stats / Rivalries / Archive remain placeholder routes until Phase 3.

## 2. Spacing scale

Four values, applied consistently:

| Token | Value | Use |
|-------|-------|-----|
| section | 40px | Vertical gap between major sections |
| block | 20px | Gap between section-head and section content |
| row | 10px | Vertical padding inside table/list rows |
| tight | 8px | Eyebrow-to-title gaps, header-to-content gaps inside small components |

These supersede ad-hoc spacing values. If a section needs more breathing room than 40px, that is a signal the section needs internal restructuring — do not increase the section gap.

## 3. Divider policy

Only two horizontal dividers exist on the page:

1. **Subnav underline** — the standard subnav active-tab indicator. Same as production.
2. **Column-header underline inside `data-table`** — separates column labels from data rows. Functional, not decorative.

Everything else is whitespace, alignment, and color. Specifically:

- No top or bottom borders framing any section
- No row-level borders inside any table or list (Standings, Champions, Records, Rivalries, Streaks, Movers)
- No card-style chrome around content groups
- No border-radius pills around interactive items unless they are buttons (Archive year-links are plain text, not pills)

If table density becomes hard to scan in production, the fix is very-low-contrast zebra striping (~3% white on alternate rows), **not** reintroducing row borders.

## 4. Section-head pattern

Every section uses the same head: an h2 on the left, a delegation link or summary stat on the right, separated 20px from the content below.

- **h2:** 15px, weight 500, neutral text color
- **Right slot:** either an info-link "Full X →" delegation to a deeper page, or a compact summary stat (e.g., "4 champions across 6 seasons · 11 still chasing")
- **Alignment:** baseline-aligned

The Championships section uses the summary-stat variant. All other sections use the delegation-link variant.

## 5. Typography hierarchy

Reuse existing app conventions where they exist; the values below are the targets.

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Section h2 | 15px | 500 | text |
| Body / row content | 14px | 400-500 | text / dim per role |
| Secondary meta | 13px | 400 | text-dim |
| Tertiary meta / podium meta | 11-12px | 400 | text-faint |
| Eyebrows / column labels | 10-11px | 600 | text-faint, letter-spacing 0.08-0.1em, uppercase |
| Tabular numbers | matches body | 400-500 | per role, `font-variant-numeric: tabular-nums` |

All numeric data uses tabular-nums for column alignment.

## 6. Color discipline

The page uses neutrals plus a small reserved palette. No decorative color.

- **Amber** — championship-related content only. Title counts, year-of-title labels, "REIGNING" marker, champion's rank-number on podium, champion's name in standings titles column, "1 in a row" streak counts.
- **Green / Red** — directional movement only. "+12" climb deltas, "−9" drop deltas. Nowhere else.
- **Category colors (teal / purple / coral / blue)** — Records column eyebrows only, mapping to the four record categories established in Phase 1's `RecordBadge` (career / season / rivalry / event).
- **Info-link blue** — section-head delegation links ("Full standings →") and only those.
- **Neutrals** — text, text-dim, text-faint, border. Everything else.

Colors encode meaning. They are never used for decoration or visual variety.

## 7. Component conventions

### 7.1 Championships row

Flex layout:
- Name: fixed width, sized to fit the longest name including the FormerOwnerBadge (~140px)
- Title count: fixed width sized to fit "2 titles" (~70px)
- Years list: auto width, content-sized
- Reigning marker: pushed to right edge with `margin-left: auto`

Champion names render as bold neutral text. Title counts and years render in amber. The reigning marker is a small uppercase label in amber, no background fill, no border.

Sorted by title count descending, then by most-recent-title-year descending. Former owners get the FormerOwnerBadge inline next to their name, no special positioning treatment otherwise.

### 7.2 `data-table` (used by Standings, Streaks)

- `table-layout: fixed` with explicit `<colgroup>` widths. Owner column gets the auto/leftover width; numeric columns get explicit pixel widths sized to their content.
- Column header underline (the only divider). Cell padding 8px right of non-numeric, 8px left of numeric, 9-10px vertical.
- Cell `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` — long names truncate rather than wrap.
- Standings dashboard column shows: rank · owner · record · win% · titles. Avg-finish is omitted on this dashboard summary; it lives on the full Standings page.
- Numeric columns right-align. Text columns left-align. Headers match cell alignment.

### 7.3 Recent podiums column

Three season blocks vertically stacked, separated by 20px (block spacing), no dividers.

Each block is:
- Year eyebrow ("2025 SEASON") — uppercase 11px, text-faint
- Three rows, one per podium slot

Each podium row is a 3-column flex layout:
- Place number (18px wide column) — 11px, weight 600. Amber for 1st place, text-faint for 2nd/3rd.
- Name — 14px, color cascades by place: 1st = text, 2nd = text-dim, 3rd = text-faint. 1st gets weight 500.
- Meta — 11px tabular nums, pushed to right with `margin-left: auto`. 1st shows total wins ("81 W"); 2nd and 3rd show games behind ("7 GB"). 1st's meta is text-dim; 2nd/3rd's meta is text-faint.

Section head links to "Full history →" — destination is the Stats subtab (Phase 3 wires this).

### 7.4 Records column

Vertical list of 5 marquee records. No row borders, 4px gap between items, 8px vertical padding per item.

Each item:
- Eyebrow (10px, 600, uppercase, category color) — one of CAREER / SEASON / RIVALRY / EVENT
- Title (14px, weight 500, text)
- Sub (13px, text-dim, tabular nums) — the holder and the value
- Trailing right arrow (16px, text-faint) — indicates clickable; click target is the full-record detail

Selection of which 5 records to surface is editorial — they should represent each category at least once and skew toward the most narratively interesting records the league has. Phase 3 may revisit this set.

### 7.5 Top rivalries row

Flex layout per row, no fixed widths:
- Pair (text, with FormerOwnerBadge inline if applicable): "Shambaugh vs Whited"
- Score: pushed right with `margin-left: auto`. Tabular nums, weight 500, text.
- Meta: tabular nums, 12px, text-dim. "68 games · 6 seasons"

Score and meta cluster on the right side of the row.

### 7.6 Title streaks table

Standard `data-table` with three columns: Owner · Streak · Years. Streak count uses the amber treatment (matches title-count discipline). Years column is dim.

### 7.7 Movers (climbs + drops)

Two parallel sub-columns under the section head, each labeled with a small uppercase col-label ("BIGGEST CLIMBS" / "BIGGEST DROPS").

Each row is a flex layout:
- Owner: fixed 90px width, weight 500
- Span ("2018→2021"): 12px, text-faint
- Ranks ("#13 → #1"): 13px, text-dim
- Delta ("+12" / "−9"): pushed right with `margin-left: auto`. Weight 500. Green for climbs, red for drops.

### 7.8 Season archive

Horizontal flex strip with wrap. Each item is a plain text-only link, no border, no card chrome:
- Year eyebrow ("2025") — 11px, 600, uppercase, text-faint, tabular nums
- Champion name — 14px, weight 500, amber

24px row gap, 32px column gap. Hover state changes the link's color treatment subtly.

Section head links to "All seasons →" — destination is the Archive subtab (Phase 3).

## 8. Delegation links — Phase 2 vs Phase 3 boundary

Every section head's right-side link points to a destination that Phase 3 will fully wire up. In Phase 2:

- Subtab routes for Stats / Rivalries / Archive are scaffolded with placeholder content ("Coming soon" or similar) — no functional content yet
- Overview's section-head links point at those placeholder routes
- The placeholder pages render under the same `LeaguePageShell` and HistorySubNav so navigation works end-to-end

Phase 3 fills the placeholder pages with real content and turns the delegation links into useful destinations. Phase 2 ships with the connections established but the destinations thin.

This means the user navigating from Overview → Full standings will land on a "Stats — Coming soon" page during Phase 2. That is acceptable and intentional. It is **not** acceptable for the links to be broken (404) or for the subtab routes to error.

## 9. Data dependencies

Each component below requires data from a specific selector. This list is for verification — confirm each piece exists before implementing, raise a flag for any that don't.

| Component | Data needed | Likely source |
|-----------|-------------|---------------|
| Championships section | Per-owner title list with years, sorted | Existing `selectChampionships` or equivalent |
| All-time standings (top 8) | Career standings with wins, losses, win%, titles | Existing all-time standings selector |
| Recent podiums (last 3 seasons) | Per-season top-3 finishers with wins for 1st, GB for 2nd/3rd | May require new selector or extension; if missing, defer with a Phase 3 task |
| Records (5 marquee) | Phase 1's `selectAllRecords()` filtered to 5 highest-priority items | Phase 1 records selector — already merged |
| Top rivalries (5) | Existing top-rivalries selector with games, seasons, score | Existing |
| Title streaks | Per-owner consecutive-title streak data | Existing or new — likely already computed |
| Movers (climbs + drops, top 4 each) | Season-over-season finish deltas with from/to ranks | Existing per-season-finish data with delta computation |
| Season archive | List of seasons with champions | Existing |

## 10. What this redesign explicitly does not do

- Does **not** introduce a hero card. Page leads with the Championships section directly.
- Does **not** use the Insights component pattern verbatim — the Records column borrows the structure (eyebrow + title + sub + arrow) but lives as part of the dashboard row, not as a standalone Insights surface.
- Does **not** replace or modify the production main Overview page. This redesign applies only to the History Overview tab.
- Does **not** ship Stats / Rivalries / Archive content in Phase 2. Those subtabs are scaffolded only.
- Does **not** retain the EraSummary, TitleTimeline, or 18-card Record Book grid components from V2. Those are removed; their content responsibilities are absorbed into Championships, Recent podiums, and Records respectively.
- Does **not** retain the Storylines section. It was empty-state-only and never earned its place.
- Does **not** modify production behaviour for the seasons not yet visualized in Recent Podiums (>3 seasons ago). The full podium history lives behind the "Full history →" delegation, which is a Phase 3 destination.

## 11. Components that survive from V2 / Phase 1 / Foundation

- `RecordBadge` component (Phase 2) — reused in the Records column eyebrows
- `selectAllRecords()` selector (Phase 1) — feeds the Records column
- HistorySubNav (Phase 2) — unchanged, renders above the Overview content
- `resolveHistoryHref` (Phase 2 remediation) — used for delegation link URLs
- FormerOwnerBadge (Foundation) — used inline in Championships, Rivalries
- LeaguePageShell wrapping (Foundation) — wraps the page
- Active/Former filter mechanism (Foundation) — survives, lives on the full Standings page rather than the dashboard summary

## 12. Components removed from V2

- `EraSummary` — composition retired
- `TitleTimeline` — composition retired (its data role absorbed into Championships)
- `Storylines` (the empty-state-only variant) — composition retired
- 18-card Record Book grid composition — retired (replaced by the 5-record marquee in the dashboard column; the full 18 live on Stats subtab in Phase 3)
- ChampionshipsBanner — retired (replaced by Championships section)
- SeasonRecapCard — retired

If any of the retired component files are imported elsewhere outside the History page, those imports should be audited and removed. If a retired component has reusable sub-pieces, those sub-pieces can be lifted into shared utilities; otherwise the files can be deleted.
