PROMPT_ID: PLATFORM-087-SLICE-5A-SCOREBOARD-CONTRACT-v1
PURPOSE: Widen the shared `CompactGameScoreboard` contract so slice 5, Item 112, Item 117, Item 115, Item 119 and Item 118 build on ONE reviewed component change instead of each re-deriving it. Item 87 slice 5a only.
SCOPE: `src/components/CompactGameScoreboard.tsx` and `src/components/__tests__/CompactGameScoreboard.test.tsx`; `src/components/OverviewPanel.tsx` ONLY where the new props must be supplied; `src/components/__tests__/OverviewPanel.test.tsx`. No other consumer, no new dependency, no design token changes.

Read `AGENTS.md` first, then `DESIGN.md` — it is canonical for UI and this is UI work. Neither is
restated here. Queue context: `docs/next-tasks.md` → **Item 87 slice 5a** (run-order position 3).

## Start from a NEW branch

Branch from current `origin/main`, named `platform/087-slice-5a-scoreboard-contract`. Do NOT reuse or
build on `platform/browser-poll-cadence`, `platform/browser-poll-interval`, or any other existing
branch — those are merged or abandoned, and a stacked branch has twice produced a review against the
wrong base in this campaign.

## Why this is its own slice

Split from slice 5 by owner decision 2026-09-03. Five later items consume this component. Widening it
once, under review, is the point: if slice 5 / 117 / 119 each widened it themselves, the contract
would be settled three times and reviewed three times.

<task>
Widen the contract with four additions. Each is a PROP the component accepts and renders; none may
change what an existing caller renders today.

1. **Classification marker in the prefix slot** — `rank | FCS | empty`, MUTUALLY EXCLUSIVE. A ranked
   team shows its rank; an unranked team **whose classification is exactly `fcs`** shows an FCS
   marker; everything else shows nothing.

   **CORRECTION 2026-09-05, after dispatch.** This originally said "an unranked NON-FBS team shows an
   FCS marker". That is wrong and would ship a defect: `ProviderClassification` is
   `'fbs' | 'fcs' | 'ii' | 'iii'` (`conferenceSubdivision.ts:89`), and Division II/III map to `OTHER`,
   not FCS — so a non-FBS test would label real D-II and D-III opponents as FCS. The settled design
   says "FCS if FCS, otherwise empty"
   (`docs/campaigns/item-87-followon-matchups-schedule-design.md:41-47`). Require
   `classification === 'fcs'`, and include NEGATIVE coverage for `'ii'` and `'iii'`.

   Rank comes from the existing `rank`/`rankSource` participant fields; classification from
   `homeClassification`/`awayClassification` on `AppGame` (`src/lib/schedule.ts:102`), matched EXACTLY
   as `rankings.ts` matches — no substring or case-insensitive widening.
2. **Neutral-site marker.**
3. **Broadcast on LIVE rows.** `CompactGameScoreboard.tsx:16-19` accepts `broadcast` today but the
   component renders it on scheduled rows only; live rows must be able to carry it too.
4. **A tier-2 expansion slot** — a render slot the later slices fill. Empty by default.
</task>

<completeness_contract>
- **Overview must render IDENTICALLY before and after. Prove it by MUTATION, not by inspection**:
  break each new branch in turn and show a SPECIFIC named test going red, then restore. A screenshot,
  a visual check, or "I verified the markup is unchanged" is not evidence.
- Every new prop is exercised by a test that fails when the prop is ignored.
- The rank/FCS exclusivity is asserted in BOTH directions: a ranked FCS team shows the rank and NOT
  the FCS marker, and an unranked FCS team shows the marker.
- NEGATIVE coverage for `'ii'` and `'iii'`: neither may render an FCS marker.
- The classification match is EXACT. A test must pin that a near-miss value does not produce a marker.
- Test count delta reported as a measured number.
</completeness_contract>

<gate>
Stop and report, without coding around it, if: the classification data is not reachable from what
`OverviewPanel` already passes (do NOT add a data fetch or widen a server payload to get it); the
neutral-site fact is not already on `AppGame`; or the tier-2 slot cannot be added without changing an
existing caller's output. Any of those means the slice boundary is wrong, and that is the owner's
call.

Do NOT touch `MatchupsWeekPanel`, `GameWeekPanel`, or the Schedule surfaces — those are slice 5,
Item 117 and Item 118, each with owner decisions still parked. The amber `upset` border and the
card-owner treatment are explicitly NOT in this slice.
</gate>

<verification>
Run each separately and report its own exit code — never chained behind `&&` or a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; which mutation proved each new branch; and
anything you deliberately did not do.

Push the BRANCH ONLY. **Do not push `preview`, or any preview branch** — that is Claude's alone
(`AGENTS.md` → Preview branch). This slice has a USER-VISIBLE surface, and the owner has been asked
separately whether Claude should push preview on your behalf so it can be clicked through; that
decision is not yours to make inside this task.

The Codex worktree's dev server is port **3010**, not 3000.
</output_contract>
