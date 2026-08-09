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
- No color for decoration — every color must encode meaning. **Scope: data surfaces.** The public
  landing (`/`) carries no data and holds a documented, landing-scoped exception — see "Landing
  page" below. That exception does not relax this rule anywhere else.
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

## Landing page (`/`)

PLATFORM-088, amended by POLISH-004. Governs **both states of the public landing** — the signed-out visitor AND the
signed-in non-admin, who receives the same page. Scoping this to "signed-out only" was itself a
defect: it left the signed-in state with no design authority, which is how a JavaScript-dependent
sign-out control slipped past the no-JavaScript rule three bullets below. The platform-admin
dashboard behind the same route is an operator surface and follows the admin conventions instead.

- **It is an entry page, not a marketing site.** Say what Turf War is in a sentence or two, then get
  an invited member into their league. No feature tour, no screenshots, no pricing, no testimonials.
- **Members arrive by shared link.** There is no slug input, no public league directory, and no
  signup on this page — the entry contract is recorded in `docs/vision.md`. Copy must not imply an
  affordance the page does not have: the previous version read "Enter your league URL" above a static
  code sample with nothing to type into.
- **Server-rendered, always.** The landing's CONTENT must render without JavaScript and without
  Clerk. It branched client-side until PLATFORM-088; the page was blank with JS disabled, and a slow
  or failed auth script produced the same result. It must also read no league or registry data — a
  visitor who has never heard of this league should not depend on its storage being available.
- **Every auth-dependent affordance is decided on the SERVER, never re-derived in the browser.** A
  control that inspects `isLoaded`/`isSignedIn` client-side shows the wrong thing until Clerk
  hydrates — on this page that meant offering "Sign in" to someone already signed in, pointing at
  `/login`, which returns them here: a loop on any slow connection. Pass the resolved fact down as a
  prop and let the control own only its click.
- **Content renders without JavaScript; a control may still need it to ACT.** Sign-out calls Clerk
  from the browser, and no server-side teardown is reachable from a plain form post. That is not a
  hole in the rule above: Clerk's sign-IN is equally client-side, so no session can exist without
  JavaScript having run. State this distinction rather than claiming more than is true.
- **Normal text meets 4.5:1 against the dark composition.** Since POLISH-004 there is only one
  theme here, so the ratio is measured against black rather than "in both themes": `zinc-400`
  (~8.4:1) and `zinc-300` (~11.6:1) are the working tokens. Do NOT carry light-theme pairs like
  `text-gray-600 dark:text-zinc-400` onto this page — the light half renders near-black on black for
  a visitor whose system is set to light.
- **No horizontal overflow at 390px.** Keep the single content column inside `max-w-xl` with real
  horizontal padding, break long strings, and keep the sign-in affordance in normal flow — fixing it
  to a viewport corner clipped it on small screens. Decorative layers are viewport-bounded by
  `inset`, and an outermost inline `<svg>` clips its own overflow, so geometry drawn outside the
  viewBox never reaches the page — the landing root's `overflow: hidden` is defensive rather than
  load-bearing.
- **Affordances are named for who can actually use them.** The sign-in link reads "Platform admin
  sign-in" because middleware admits only platform admins; it previously said "Commissioner login".
- **Typography is still the primary hierarchy.** Scale contrast, a second type register, a
  constrained measure, and deliberate vertical rhythm — tight within a group, generous between
  groups — carry the page. Colour supports the composition; it does not create the hierarchy. When
  this page reads flat, reach for type before pigment.
- **The landing is an ALWAYS-DARK stadium composition.** Fixed dark regardless of the visitor's OS
  preference: no `prefers-color-scheme` block, no `dark:` variants, and no light-theme text token
  anywhere in the files that render it — a `text-gray-600 dark:text-zinc-400` pair renders
  near-black on black for a light-OS visitor. The page must also declare `color-scheme: dark` and
  paint the document canvas, or UA chrome and rubber-band overscroll stay light behind it. A stadium rendered on white is
  not a lighter version of this page, it is a broken one. Every other app and admin surface remains
  theme-aware — this exception stops at `/`.
- **One landing-scoped turf token is permitted, for the two field treatments only.**
  `--landing-turf` is declared on `.landing-root` in `src/styles/publicLanding.css` and reaches the
  wordmark underline and the lower perspective field through the `landing-turf-stroke` /
  `landing-turf-fill` rules. The SVGs carry no colour of their own, so editing the token is what
  changes the page — a duplicated literal in the art module made this claim false once already. Nothing else on the page takes green — not the
  guidance panel, not the admin link, not the account controls — and alpha variants of that one value
  are used rather than additional green tokens.
- **This is an explicit EXCEPTION to the semantic colour rules above, not a repeal of them.** Those
  rules — amber for champion signals, blue for interactivity, no colour for decoration — govern
  DATA surfaces, where colour must encode meaning because there is meaning available to encode. This
  page carries no data. Owner decision (POLISH-004): a restrained turf accent here is art direction
  for the product's front door, and it is scoped so it cannot leak into any surface where the
  semantic rules apply.
- **It does NOT create an app-wide brand token.** `--landing-turf` lives on one element on one page.
  Promoting it to a global token, adding a logo, or applying it across the app is separate, still
  unscheduled work (`HOMEPAGE-BRAND-IDENTITY` in `docs/next-tasks.md`) and would amend the colour
  rules above in its own change.
- **Decoration is inert.** Background SVG is `aria-hidden`, `focusable="false"`, `pointer-events:
  none`, and carries no text — meaningful copy is real DOM text so it can be selected, searched, and
  announced in order. No raster assets, `next/image`, canvas, video, animation framework, or
  decorative client-side JavaScript: the page's atmosphere costs no hydration and no request.

## Scope discipline

- Do not add features not explicitly requested
- If a better solution exists, recommend it before implementing
- Every prompt includes explicit scope limits
- UI additions require explicit justification — adding complexity without clear user value is a defect
