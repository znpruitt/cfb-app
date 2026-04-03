# Phase 5 — Draft/Owner Assignment Tool Design

**Status:** Design approved — open questions resolved. Ready for implementation.
**Depends on:** Phase 3 (multi-league support), Phase 4 (historical analytics for draft card context).
**No implementation has begun.**

---

## 1. Goals

### What does the draft tool need to enable for the 2026 season?

- Replace the manual CSV upload as the primary method for assigning teams to owners
- Support a live in-person draft at a brewery or similar setting
- Commissioner runs the draft from a single web interface
- Owners follow along on their phones via a read-only spectator view
- Draft state is persistent — survives browser close, refresh, or connectivity interruption
- All picks are editable by the commissioner if needed
- Draft card provides objective team data to support decision-making during the draft

### Minimum viable draft tool for 2026 season launch

A fully functional live draft with commissioner control, spectator view, persistent state, and draft cards showing SP+, win totals (when available), last season record, preseason rank, home/away split, and ranked opponent count. Draft completion writes the final roster to the owner assignment system.

---

## 2. Draft Flow

The draft proceeds through four sequential phases:

**Phase 1 — League Roster Setup**
1. Commissioner navigates to /league/[slug]/draft/setup
2. System auto-populates prior year owners from the most recent archived season
3. Commissioner reviews the roster — removes owners who are not competing, adds new owners
4. Commissioner confirms the league roster before proceeding

**Phase 2 — Draft Settings**
1. Commissioner sets draft configuration:
   - Style: Snake (initial implementation; others as future enhancements)
   - Draft order: Random (auto-generated), manual entry, or reverse championship order from prior season
   - Pick timer: 30s, 60s, 90s, 2min, or no timer
   - Timer expiry behavior: auto-pick (commissioner chooses metric at setup) or pause-and-prompt
   - Number of rounds: Auto-suggested based on total FBS teams divided by number of owners; commissioner can override
   - Draft date/time: Optional scheduling for sharing with participants
2. Commissioner confirms settings and proceeds to draft board

**Phase 3 — Live Draft Board**
Commissioner view and spectator view are separate but share the same persistent draft state.

**Phase 4 — Draft Summary and Confirmation**
1. Overview of all owner rosters upon draft completion
2. Commissioner reviews and makes any final edits
3. Commissioner confirms — final roster is written to the owner assignment system

---

## 3. Routing

- /league/[slug]/draft/setup — Phase 1 and 2: roster setup and settings (commissioner, admin-gated)
- /league/[slug]/draft — Phase 3: live draft board (commissioner, admin-gated)
- /league/[slug]/draft/board — Phase 3: spectator view (public, shareable link)
- /league/[slug]/draft/summary — Phase 4: draft summary and confirmation (commissioner, admin-gated)

---

## 4. Draft State Model

Draft state is persisted in appStateStore under scope `draft:${leagueSlug}` and key `${year}`.

The DraftState type includes:
- leagueSlug: string
- year: number
- phase: 'setup' | 'settings' | 'preview' | 'live' | 'paused' | 'complete'
- owners: string[] — ordered list of participating owners
- settings: DraftSettings
- picks: DraftPick[] — ordered list of all picks made
- currentPickIndex: number — index into the full pick order
- timerState: 'running' | 'paused' | 'expired' | 'off'
- timerExpiresAt: string | null — ISO timestamp
- createdAt: string
- updatedAt: string

The DraftSettings type includes:
- style: 'snake'
- draftOrder: string[] — owner names in draft order for round 1
- pickTimerSeconds: number | null — null means no timer
- timerExpiryBehavior: 'pause-and-prompt' | 'auto-pick'
- autoPickMetric: 'sp-plus' | 'preseason-rank' | null — only relevant when timerExpiryBehavior is auto-pick
- totalRounds: number
- scheduledAt: string | null — ISO timestamp, optional

The DraftPick type includes:
- pickNumber: number — overall pick number, 1-based
- round: number
- roundPick: number — pick within the round
- owner: string
- team: string — canonical CFBD team name
- pickedAt: string — ISO timestamp
- autoSelected: boolean — true if auto-picked on timer expiry

---

## 5. Pick Order Generation

Snake draft pick order is fully derived from settings — never stored, always computed:

- Round 1: owners in draftOrder
- Round 2: owners in reverse draftOrder
- Round 3: same as Round 1
- Continues alternating through totalRounds

Current pick owner is derived from currentPickIndex and the computed order sequence.

---

## 6. Draft Preview Mode

When a draft is created with a future scheduledAt date, both the commissioner view and spectator view enter preview mode until the scheduled start time.

Preview mode behavior:
- Displays the scheduled draft date and time prominently
- Shows the full available teams panel with DraftCard components — owners can browse teams
- Shows the confirmed owner roster and draft order
- No picks can be made — draft board is locked
- Commissioner can start the draft early by manually advancing from preview to live
- Spectator view shows "Draft starts at [date/time]" with a countdown

---

## 7. Commissioner Draft Board

Route: /league/[slug]/draft. Admin-gated. Full draft control interface.

### Layout

- Top bar: Round/pick indicator, pick timer (large, prominent), commissioner controls
- Main panel: Available teams (searchable, filterable) with DraftCard components
- Right panel: Draft board showing all picks by round and owner
- Bottom bar: Previous pick, current pick (On the Clock), next pick

### Commissioner Controls

- Make pick: Click a team card in the available teams panel
- Pause/Resume timer: Toggle timer state
- Go back a pick: Undo the most recent pick — restores team to available pool
- Edit any pick: Click any pick in the draft board to reassign it to a different team
- Skip owner: Move to next owner if needed (rare edge case)
- Reset draft: Discard all picks and return to setup — requires explicit confirmation dialogue acknowledging all draft progress will be lost

### Timer Expiry Behavior

When timerExpiryBehavior is pause-and-prompt:
- Timer reaches zero — draft pauses automatically
- Commissioner sees a prompt with two options: Auto-pick (using the configured metric) or Select manually
- Auto-pick immediately makes the pick and resumes
- Select manually keeps the draft paused and highlights the available teams panel for the commissioner to choose

When timerExpiryBehavior is auto-pick:
- Timer reaches zero — pick is made automatically using the configured autoPickMetric
- Draft resumes immediately

### Available Teams Panel

- Search by team name
- Filter by conference
- Filter by SP+ tier (top third / middle / bottom third)
- Sort by: team name (default), SP+ rating, preseason rank, win total if uploaded
- Each team renders a DraftCard component

### Draft Board Panel

- Grid layout: rounds as rows, owners as columns
- Each cell shows the team picked or is empty/pending
- Current pick highlighted
- Clicking any completed pick opens edit mode

---

## 8. Spectator View

Route: /league/[slug]/draft/board. Public — no auth required. Shareable link.

### Behavior

- Polls /api/draft/[slug]/[year] every 3-5 seconds for updated draft state
- Read-only — no pick-making capability
- Shows same draft board as commissioner view
- Shows same available teams panel with DraftCard components for team browsing
- Shows timer countdown synced to server timerExpiresAt timestamp
- Shows "On the Clock" indicator for current owner
- In preview mode: shows scheduled start time and countdown
- No commissioner controls visible

---

## 9. Draft Card

Each undrafted team renders a DraftCard component in the available teams panel on both commissioner and spectator views.

### Data Sources

- SP+ rating: CFBD /ratings endpoint — automatic, fetched and cached pre-draft
- SP+ tier: Derived from SP+ — automatic, top/middle/bottom third of all FBS teams
- Win total (over/under): Commissioner CSV upload — manual, optional, one upload per season
- Last season record: CFBD historical data — automatic
- Preseason rank: AP Poll (already fetched) — automatic
- SOS tier: Derived from schedule + SP+ — automatic, Easy/Medium/Hard relative tiers
- Home/Away split: CFBD schedule — automatic
- Ranked opponent count: AP Poll + schedule — automatic

### Win Total Handling

Win totals are optional. If no win total CSV has been uploaded, the win total field is simply absent from the card — no placeholder, no empty state, no indication of missing data. The card reads cleanly without it.

### Rules

- No colors implying good or bad
- No best pick or recommendation language
- No sorting suggestions
- Data is objective and neutral — supports owner decision-making without prescribing choices

---

## 10. Draft Card Data Infrastructure

### SP+ Fetch

New admin endpoint: POST /api/admin/cache-sp-ratings

- Fetches SP+ ratings for the current season from CFBD /ratings endpoint
- Caches in appStateStore: scope sp-ratings, key ${year}
- Commissioner runs this once before the draft
- Admin-gated

### Win Total Upload

- Commissioner uploads a CSV via existing RosterUploadPanel-style UI
- CSV format: Team, WinTotalLow, WinTotalHigh
- Goes through existing fuzzy team name matching pipeline
- Stored in appStateStore: scope win-totals, key ${year}
- Optional — win totals are typically available from bookmakers in late July/August

### Selector

New selector: src/lib/selectors/draftTeamInsights.ts

- Pure function — no API calls, no side effects
- Derives all DraftCard data from cached SP+, win totals, schedule, and rankings
- SOS tier derived as relative percentiles across all FBS teams: bottom 30% = Easy, middle 40% = Medium, top 30% = Hard
- Home/away split derived from schedule
- Ranked opponent count derived from AP poll + schedule

---

## 11. Draft Summary and Confirmation

Route: /league/[slug]/draft/summary. Admin-gated.

### Content

- All owner rosters shown as cards
- Each card shows owner name and their full team list
- Commissioner can make final edits before confirming
- Interesting facts panel:
  - League anniversaries (owners in their Nth season based on historical archives)
  - Main rivals based on historical head-to-head records
  - Any owner with a returning championship team

### Draft History

Completed drafts are not stored separately. The meaningful output of the draft — the owner roster — is preserved in the season archive via ownerRosterSnapshot. Team rosters do not change during the season so no replay or trade history is needed. The season archive is the historical record.

### Final Confirmation

- Confirm Draft button writes the final roster to appStateStore as the official owner assignment for the season — equivalent to CSV upload
- Confirmation is irreversible without a new draft or manual CSV upload override
- After confirmation, redirects to /league/[slug]/overview

---

## 12. Draft Reset

The commissioner can reset a draft at any time during the live phase. Reset behavior:

- Commissioner clicks Reset Draft
- Confirmation dialogue appears: "This will permanently discard all draft picks and return to setup. This cannot be undone."
- On confirmation: all picks cleared, currentPickIndex reset to 0, phase returns to 'setup'
- Prior draft state is not preserved — reset is permanent

---

## 13. API Routes

- GET /api/draft/[slug]/[year] — Read current draft state (public)
- POST /api/draft/[slug]/[year] — Create new draft (admin-gated)
- PUT /api/draft/[slug]/[year] — Update draft state: picks, timer, phase (admin-gated)
- POST /api/draft/[slug]/[year]/pick — Make a pick (admin-gated)
- POST /api/draft/[slug]/[year]/unpick — Undo last pick (admin-gated)
- PUT /api/draft/[slug]/[year]/pick/[n] — Edit pick number n (admin-gated)
- POST /api/draft/[slug]/[year]/reset — Reset draft to setup (admin-gated)
- POST /api/draft/[slug]/[year]/confirm — Write final roster to owner assignment (admin-gated)
- POST /api/admin/cache-sp-ratings — Fetch and cache SP+ ratings from CFBD (admin-gated)

---

## 14. Real-Time Sync

Spectator view polls GET /api/draft/[slug]/[year] every 3 seconds. Commissioner view polls every 1 second for timer accuracy. No WebSockets required for an in-person draft — polling latency is acceptable.

Timer is server-authoritative: timerExpiresAt is stored in draft state. Both views derive remaining time from timerExpiresAt minus now() to stay in sync.

---

## 15. Implementation Sequence

**P5A — Draft Data Infrastructure**
- SP+ cache endpoint and admin trigger
- Win total CSV upload via existing fuzzy matching pipeline
- draftTeamInsights.ts selector
- DraftCard component

**P5B — Draft Setup and Settings**
- /league/[slug]/draft/setup page
- Roster setup UI (auto-populate from prior year archive, add/remove owners)
- Draft settings UI (style, order, timer duration, timer expiry behavior, rounds)
- Draft preview mode with scheduled start time
- Draft state creation API

**P5C — Live Draft Board**
- Commissioner view at /league/[slug]/draft
- Spectator view at /league/[slug]/draft/board
- Pick, unpick, and edit pick API endpoints
- Timer logic with pause-and-prompt and auto-pick behaviors
- Draft reset with confirmation
- Real-time polling

**P5D — Draft Summary and Confirmation**
- /league/[slug]/draft/summary page
- Final roster write to owner assignment
- Interesting facts panel using historical archive data

---

## 16. Resolved Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Draft reset | Allowed with confirmation dialogue — all picks discarded, returns to setup, not recoverable |
| 2 | Draft preview mode | Spectator and commissioner views show scheduled start time and team browser before draft goes live |
| 3 | Timer expiry behavior | Commissioner chooses at setup: pause-and-prompt (commissioner decides auto or manual) or auto-pick (immediate, metric configurable) |
| 4 | Win totals absent | Field is simply absent from draft card — no placeholder, no degraded UX |
| 5 | Draft history | Not stored separately — owner roster is preserved in season archive via ownerRosterSnapshot, which is the meaningful record |
