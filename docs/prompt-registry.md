# Prompt Registry

Purpose:

- track important prompts
- provide reusable references
- document prompt evolution

The registry should remain:

- concise
- high-signal
- manually maintained

---

## Active Prompts

### P3B-TRENDS-FORM-DOTS-v1
- Purpose: Recent form dots panel — last-5-game W/L indicators using actual game scores, displayed alongside the title chase chart on the Overview Trends card.
- Scope: `src/components/OverviewPanel.tsx` (RecentFormPanel), `src/lib/selectors/trends.ts` (selectRecentOutcomes).
- Notes: Retroactively registered. Covers PR #183 on phase-3b-visual-sweep.

---

## Retroactively Registered Prompts

### P3B-TRENDS-TITLE-CHASE-v1
- Purpose: MiniTrendsGrid — compact SVG title chase chart (top-5 contenders, Games Back) for Overview Trends card. Iterated through viewBox fix, inline labels, bump chart, and final title chase framing.
- Scope: `src/components/MiniTrendsGrid.tsx`, `src/components/OverviewPanel.tsx`, `src/lib/selectors/trends.ts`.
- Notes: Retroactively registered. Covers PRs #178–#182 on phase-3b-visual-sweep.

### P3A-OVERVIEW-REDESIGN-v1
- Purpose: Phase 3A visual redesign — champion podium hero, Rankings tab, app-wide palette and layout sweep, and Trends section restructure (removed TrendsDetailSurface from Overview).
- Scope: `src/components/OverviewPanel.tsx`, `src/components/MiniTrendsGrid.tsx` (initial), `src/app/trends/`.
- Notes: Retroactively registered. Covers PRs #173–#177 on phase-3a-overview-redesign and phase-3b-visual-sweep.

### P2B-OVERVIEW-UX-CAMPAIGN-v1
- Purpose: Phase 2B league UX/engagement campaign — Overview hierarchy fix, signal-first copy pass, member feedback entry point, information density pass, app flow improvements, and visual design language.
- Scope: `src/components/OverviewPanel.tsx`, `src/components/StandingsPanel.tsx`, copy/label edits throughout.
- Notes: Retroactively registered. Covers PRs #167–#172 on branches phase-2b-*.

### DOCS-PROMPT-GOVERNANCE-BOOTSTRAP-v4
- Purpose: Move engineering operating instructions into the repo and establish PROMPT_ID-based traceability.
- Scope: docs only.
- Notes: Initial bootstrap for in-repo prompt governance, summary identification, instruction block identification, and commit traceability.

### DOCS-CODEX-SELF-CHECK-v1
- Purpose: Require Codex to self-check PROMPT_ID compliance before returning summaries or creating commits.
- Scope: docs only.
- Notes: Follow-up governance hardening after initial in-repo bootstrap.

### DOCS-POST-MERGE-GOVERNANCE-FIXES-v1
- Purpose: Resolve optional instruction-block validation and improve commit traceability without degrading readable git history.
- Scope: docs only.
- Notes: Post-merge cleanup for governance consistency and maintainability.

### DOCS-PROMPT-RESPONSE-REQUIREMENT-v1
- Purpose: Update prompt governance to require explicit final response requirements in every Codex prompt.
- Scope: docs only.
- Notes: Ensures response-format expectations are restated at execution time, including Section 2 and Section 3.8 applicability.
