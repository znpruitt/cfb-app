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

## Member surface boundary

`/league/*` is a MEMBER surface. Operators reach their tooling through the admin gear; members never
see the machinery.

- **No operator diagnostics.** No provider names (CFBD), status codes, raw error strings, cache
  terminology, or coverage counters ("Scores available for 98/100 games."). Every one of those
  conditions is already reported by System Health — rendering a second, worse-worded copy on a
  league page serves nobody and answers a question the member did not ask.
- **No actions a member cannot perform.** The server guards are sound (`/api/schedule` refuses
  `bypassCache` without admin; `/api/postseason-overrides` requires admin on write), so an
  admin-only control on a member surface is not a security hole — it is a button that always fails.
  Gate it on `isAdmin` rather than deleting it: the same control that is useless to a member is the
  operator's repair path, and removing it outright leaves the one person who can fix a broken page
  with nothing to click. That mistake was made once here, justified by "server-refused anyway" —
  which is true for a member and false for the admin the guard admits.
- **No retry a failure cannot answer.** Offer a retry only where the app can distinguish a transient
  failure from a permanent one. A schedule failure caused by a malformed CACHED row returns the same
  result on every attempt, so a "Try again" button is an invitation to click forever.
- **Messages state impact and a safe next step**, in that order, and stop. "This league's schedule
  isn't available right now. Please check back shortly." — not what failed, where, or how to repair
  it.
- **Game-day confidence is bounded, evidence-backed, and member-safe.** The league header may say
  "Preparing for kickoff" only inside the 15-minute pregame polling window, "Waiting for scores"
  after kickoff when no usable score has attached, and "Tracking scores" only when a recent exact-
  target refresh completed and an in-progress score attached in that same read. Tracking evidence
  expires after seven minutes; a stale in-progress row, incomplete read, historical season, or known
  disruption makes no confidence claim. "Known" means present in the current cached schedule or
  attached score: raw provider schedule status survives normalization for this gate, while a
  provider-side schedule change is not knowable until the schedule-refresh path observes it
  (ordinary maintenance is weekly, with manual repair available). The signal uses neutral text and a
  neutral dot, with motion only while tracking and a persistent accessible polite status region — it
  never exposes provider/cache details or uses success/error color semantics. For a nondisrupted
  owned-team row in the same bounded post-kickoff gap, say "Awaiting score", never the contradictory
  "Upcoming" or the unsupported "Live". POLISH-007.

Internal issue strings are still produced and available to the app; this boundary governs what
reaches member JSX. Note what that does NOT currently mean: for the rankings and schedule failures
this rule covers, the producing catches call only `setIssues` — there is no console, telemetry, or
server hop, so once the member render is removed the string is received and dropped. The operator's
channel is System Health, which derives those conditions independently from durable state. Do not
read this rule as a promise that anything logs them; wiring that is separate work.

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
- No color for decoration — every color must encode meaning. This stands unamended for every
  surface. The public landing briefly carried a scoped turf-accent exception; it was removed with the
  vector element that consumed it, and the landing's colour now comes entirely from a photograph.
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
- Handpicked 14-color palette — all visually distinct against the dark ground, no near-duplicates
- The light-background palette variant is dead data since POLISH-010; `isDarkTheme()` always
  selects the dark one
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
- Theme resolution: `isDarkTheme()` (`src/lib/ownerColors.ts`) returns dark unconditionally since
  POLISH-010, so the dark hex is always selected. The light hex in each pair is dead data, kept
  only so the retirement stays reversible — do not rely on it and do not add new pairs
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

## Theme

**Dark is the only theme (POLISH-010).** The app does not respond to
`prefers-color-scheme`, offers no toggle, and has no light rendering. Do not add one, and do not
author a light half for a new component.

- `globals.css` declares `@custom-variant dark (&)`, which makes every `dark:` utility
  unconditional. Verified in the emitted bundle: `prefers-color-scheme` appears **zero** times, and
  `.dark\:text-amber-400` compiles to a plain rule. That one line is the whole switch and the whole
  rollback.
- `:root` carries the dark values and declares `color-scheme: dark` **on the root scroller**. On a
  wrapper it would govern only that element's own UA widgets — see the landing-page note below,
  which is where that was learned.
- **The light class layer is retained, dormant.** ~1,127 light base classes still pair with `dark:`
  variants that now always win. This is deliberate: retirement is reversible by the variant
  declaration. **Do NOT promote `dark:` utilities to base classes** — that is ~2,365 edits and a
  one-way door. Equally, do not add new light halves; they are dead on arrival.
- **JavaScript colour resolution goes through `isDarkTheme()`** (`src/lib/ownerColors.ts`), which
  returns dark unconditionally. Owner colours, insight category colours, and the season-arc chart
  pick from light/dark hex PAIRS in JS, so a CSS-only retirement would have painted light palettes
  onto a dark UI. Their light values are now dead data, kept for the same reversibility reason.
  A narrow test asserts no production file reads `prefers-color-scheme` through `matchMedia`.

**Why light was retired rather than finished.** The champion accent
(`ChampionshipsSection.tsx`, `text-amber-600 dark:text-amber-400`) measures **11.86:1** on the dark
ground and **3.19:1** on white, and the `Reigning` label carrying it is 10px — under the WCAG
large-text threshold, so light mode was failing AA. No amber step is both gold and accessible on
white: `amber-300`–`amber-600` all fail 4.5:1 there, `amber-700`/`800` pass but read brown. Amber is
the semantic champion/podium colour, so the accent language the app is built on cannot be rendered
in light at all. Light was never designed here — it accumulated as the unprefixed base layer, while
197 hardcoded hex literals across 15 files were authored dark-only.

## Decorative raster backgrounds

Applies app-wide, not to one page. Introduced by POLISH-004, and it SUPERSEDES the earlier blanket
prohibition on raster assets, which was written before any surface needed atmosphere.

- **A raster is permitted for DECORATION only.** It must carry no semantic content: no text, no
  logo, no UI, no data, nothing a reader would need to select, search, translate, or hear announced.
- **Meaningful content stays in the DOM.** If a person needs it, it is real text — never baked into
  an image. This is the line the rule exists to hold.
- **Brand marks stay vector/native.** They scale with their surroundings, need no asset, and must
  stay crisp at any size.
- **Assets are LOCAL.** No remote images, no third-party CDN, no runtime image service. The app ships
  what it renders.
- **Reference for a decorative background rather than an `<img>`.** It is not content, so it does not
  belong in the DOM: a background costs no hydration and no layout, and gradients composite in the
  same stack, which is what blends a plate into the page.
- **Performance-conscious and purposeful.** Serve AVIF with a WebP fallback via `image-set()`, size
  to the composition rather than to a round number, and keep the weight proportionate — a dark,
  low-frequency scene should be tens of kilobytes, not hundreds. A raster that could have been a
  gradient should be a gradient.
- **Legibility is the author's problem, not the plate's.** Text over an image needs a scrim sized to
  clear 4.5:1 against the brightest region it actually crosses, not against the average.

When native CSS/SVG can carry the idea, prefer it. Reach for a raster when the thing being drawn is
atmosphere — depth, haze, light falloff, texture — which vector primitives approximate badly.

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
- **No horizontal overflow at 390px.** Keep the single content column inside `max-w-2xl` with real
  horizontal padding, break long strings, and keep the sign-in affordance in normal flow — fixing it
  to a viewport corner clipped it on small screens. The decorative layer is bounded by `inset`, so
  the landing root's `overflow: hidden` is defensive rather than load-bearing — an earlier version of
  this rule explained it with inline-SVG clipping, on a page that now contains no SVG at all.
- **Affordances are named for who can actually use them.** The sign-in link reads "Platform admin
  sign-in" because middleware admits only platform admins; it previously said "Commissioner login".
- **Typography is still the primary hierarchy.** Scale contrast, a second type register, a
  constrained measure, and deliberate vertical rhythm — tight within a group, generous between
  groups — carry the page. Colour supports the composition; it does not create the hierarchy. When
  this page reads flat, reach for type before pigment.
- **The landing is an ALWAYS-DARK stadium composition.** Fixed dark regardless of the visitor's OS
  preference: no `prefers-color-scheme` block, no `dark:` variants, and no light-theme text token
  anywhere in the files that render it — a `text-gray-600 dark:text-zinc-400` pair renders
  near-black on black for a light-OS visitor. The page must also paint the document canvas and
  declare `color-scheme: dark` **on the ROOT scroller** (`html:has(.landing-root)`), or UA chrome and
  rubber-band overscroll stay light behind it. On a non-root element `color-scheme` governs only that
  element's own widgets — and the landing root has `overflow: hidden`, so it has no scrollbar to
  govern; declared there, the rule looks right and does nothing. A stadium rendered on white is
  not a lighter version of this page, it is a broken one. Since POLISH-010 the landing is no longer
  an exception — the whole app is dark-only — but this page keeps its own canvas rule because it
  paints black rather than the app's `--background`, and it predates the global switch.
- **No colour accent on this page.** A landing-scoped `--landing-turf` token once painted a
  perspective-field strip beneath the wordmark. Both are GONE: once the stadium plate carried the
  football identity, a miniature field competed with the real one behind it and, at that scale, read
  as a green platform rather than a mark. The token was removed with its only consumer rather than
  kept for its own sake. **The page's colour now comes entirely from the photographic plate**, and
  the semantic colour rules above stand unamended for every surface — the exception this section once
  carried no longer exists.
- **Decoration is inert.** The scene layer is `aria-hidden`, `pointer-events: none`, and carries no
  text — meaningful copy is real DOM text so it can be selected, searched, and announced in order. Any
  inline decorative SVG that returns here must also be `focusable="false"`. No `next/image`, canvas,
  video, animation framework, or decorative client-side JavaScript.
- **The stadium scene is a decorative raster, and the wordmark is type alone.** Two attempts to build
  the scene natively could not make vector primitives read as a field rather than as geometry —
  recorded so it is not attempted a third time. The vector strip that once accompanied the wordmark
  was then removed as redundant: the durable rule above says atmosphere is what rasters are for, and
  a second miniature field was not a brand mark, it was a repeat of the background.

## Scope discipline

- Do not add features not explicitly requested
- If a better solution exists, recommend it before implementing
- Every prompt includes explicit scope limits
- UI additions require explicit justification — adding complexity without clear user value is a defect
