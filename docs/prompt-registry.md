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

### P3-MULTILEG-CLOSEOUT-v1
- Purpose: Audit Phase 3 implementation against design doc, update planning docs to reflect Phase 3 complete, register all Phase 3 prompt IDs.
- Scope: docs only — completed-work.md, roadmap.md, next-tasks.md, prompt-registry.md, phase-3-multi-league-design.md.
- Notes: Phase 3 closeout. No code changes.

### P3-MULTILEG-FALLBACK-CLEANUP-v1
- Purpose: Remove now-redundant `readAliasesScopedOnly` function from aliases route — identical to `readAliases` after fallback removal.
- Scope: `src/app/api/aliases/route.ts` only.
- Notes: PR #196. Follow-on to P3-MULTILEG-FALLBACK-REMOVAL-v1.

### P3-MULTILEG-FALLBACK-REMOVAL-REVIEW-v1
- Purpose: Read-only verification that fallback removal is correct and scope helpers preserve the no-league-param path.
- Scope: Read-only. `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: All items passed. Flagged that `readAliasesScopedOnly` was now redundant — addressed by P3-MULTILEG-FALLBACK-CLEANUP-v1.

### P3-MULTILEG-FALLBACK-REMOVAL-v1
- Purpose: Remove temporary TRANSITION FALLBACK from all three durable data GET handlers after TSC migration confirmed complete.
- Scope: `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts` — GET handlers only.
- Notes: PR #196. No-league-param path unchanged on all three routes.

### P3-MULTILEG-ADMIN-UI-COPY-v1
- Purpose: Replace developer terminology with plain-language commissioner-facing copy on `/admin/leagues/`.
- Scope: `src/app/admin/leagues/page.tsx` only — copy and labels only.
- Notes: PR #195. Slug field relabeled "League URL", annotation updated to "(URL — permanent)", header description rewritten, empty state example year corrected to 2025.

### P3-MULTILEG-ADMIN-UI-FIX-v1
- Purpose: Improve empty state seed reminder to include example values for slug, display name, and year.
- Scope: `src/app/admin/leagues/page.tsx` only.
- Notes: PR #194. Empty state now includes: league URL — work-league, display name — Work League, year — 2025.

### P3-MULTILEG-ADMIN-UI-REVIEW-v1
- Purpose: Pre-merge review of P3-MULTILEG-ADMIN-UI-v1 implementation.
- Scope: Read-only. `src/app/admin/leagues/page.tsx`, `src/components/AdminDebugSurface.tsx`.
- Notes: One partial finding — empty state seed reminder lacked example values. Addressed by P3-MULTILEG-ADMIN-UI-FIX-v1.

### P3-MULTILEG-ADMIN-UI-v1
- Purpose: Create `/admin/leagues/` management page for commissioner to view, create, and edit leagues.
- Scope: `src/app/admin/leagues/page.tsx` (new), `src/components/AdminDebugSurface.tsx` (League Management link).
- Notes: PR #194. Reuses `AdminAuthPanel`, `requireAdminAuthHeaders`. Inline edit, create form with client-side slug validation.

### P3-MULTILEG-WRITE-SCOPE-REVIEW-v1
- Purpose: Read-only verification that write-scope fix correctly passes `leagueSlug` through all save functions.
- Scope: Read-only. API client functions and CFBScheduleApp save call sites.
- Notes: All items passed. Recommend merge.

### P3-MULTILEG-WRITE-SCOPE-FIX-v1
- Purpose: Fix write-path bug — save functions were not passing `leagueSlug` to API calls despite reads being league-scoped.
- Scope: `src/lib/aliasesApi.ts`, `src/lib/ownersApi.ts`, `src/lib/postseasonOverridesApi.ts`, `src/components/CFBScheduleApp.tsx`.
- Notes: PR #193. Establishes full read/write symmetry for all three durable data paths.

### P3-MULTILEG-ROUTING-FIX-REVIEW-v1
- Purpose: Read-only verification of routing fix — bootstrap chain threading and matchup href.
- Scope: Read-only. `src/components/CFBScheduleApp.tsx`, bootstrap chain files, `src/components/OverviewPanel.tsx`.
- Notes: All items passed. Recommend merge.

### P3-MULTILEG-ROUTING-FIX-v1
- Purpose: Thread `leagueSlug` through full bootstrap chain; restore `?view=matchups` on matchup insight links.
- Scope: `src/lib/bootstrap.ts`, `src/components/hooks/useScheduleBootstrap.ts`, `src/components/OverviewPanel.tsx`.
- Notes: PR #193. Bootstrap chain now complete: CFBScheduleApp → useScheduleBootstrap → bootstrapAliasesAndCaches → all three load functions.

### P3-MULTILEG-ROUTING-REVIEW-v1
- Purpose: Pre-merge review of P3-MULTILEG-ROUTING-v1 routing implementation.
- Scope: Read-only. All new league route files, root redirects, navigation components.
- Notes: Two findings: bootstrap chain not threaded end-to-end; matchup insight href missing `?view=matchups`. Both addressed by P3-MULTILEG-ROUTING-FIX-v1.

### P3-MULTILEG-ROUTING-v1
- Purpose: Implement `/league/[slug]/` route hierarchy; convert root routes to registry-based redirects; update navigation components.
- Scope: `src/app/league/[slug]/` (new pages), `src/app/page.tsx`, `src/app/standings/page.tsx`, `src/app/rankings/page.tsx`, `src/app/trends/page.tsx`, `src/components/CFBScheduleApp.tsx`, `src/components/OverviewPanel.tsx`, `src/components/RankingsPageContent.tsx`.
- Notes: PR #193. Root routes read registry at request time; redirect to first league's slug or render empty state if no leagues.

### P3-MULTILEG-FOUNDATION-FIX-v2
- Purpose: Fix malformed slug silent coercion bug and alias incremental merge inheritance bug.
- Scope: `src/app/api/aliases/route.ts` (readAliasesScopedOnly), `src/app/api/owners/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192. Added slug format validation to PUT routes. Introduced `readAliasesScopedOnly` to prevent new leagues inheriting legacy alias map on first incremental write.

### P3-MULTILEG-FOUNDATION-FIX-VERIFY-v1
- Purpose: Read-only verification that registry check is only in PUT (not GET) after FIX-v1 changes.
- Scope: Read-only. `src/app/api/admin/leagues/route.ts` only.
- Notes: Confirmed GET is public, PUT has registry validation. Verified correct.

### P3-MULTILEG-FOUNDATION-FIX-v1
- Purpose: Fix three pre-merge review findings — duplicate guard into `addLeague()`, GET leagues public, PUT registry validation.
- Scope: `src/lib/leagueRegistry.ts`, `src/app/api/admin/leagues/route.ts`, `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192.

### P3-MULTILEG-FOUNDATION-REVIEW-v1
- Purpose: Read-only pre-merge review of P3-MULTILEG-FOUNDATION-v1 storage layer implementation.
- Scope: Read-only. All files created or modified in foundation PR.
- Notes: Three findings addressed by P3-MULTILEG-FOUNDATION-FIX-v1.

### P3-MULTILEG-FOUNDATION-v1
- Purpose: Implement Phase 3 storage layer — `League` type, `leagueRegistry.ts`, admin API routes, updated durable-data routes with `?league=` support and TRANSITION FALLBACK.
- Scope: `src/lib/league.ts` (new), `src/lib/leagueRegistry.ts` (new), `src/app/api/admin/leagues/route.ts` (new), `src/app/api/admin/leagues/[slug]/route.ts` (new), `src/app/api/owners/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/postseason-overrides/route.ts`.
- Notes: PR #192.

### P2-FOUNDATION-AUDIT-v1
- Purpose: Read-only codebase audit — reconcile actual implementation state against all planning documents and produce a structured markdown discrepancy report.
- Scope: Read-only. All planning docs + key source files. No code or document changes.
- Notes: Produced discrepancy report covering data pipeline, owner model, historical data, selector architecture, admin/persistence, and feature completeness. Findings used to drive post-audit doc updates.

### P2-OVR-TRENDS-LABELS-v1
- Purpose: Color-code delta panel owner names to match trend line colors; restore endpoint annotations (owner name + GB) on trend chart.
- Scope: `src/components/MiniTrendsGrid.tsx` (export CONTENDER_COLORS, restore annotation lane), `src/components/OverviewPanel.tsx` (PositionDeltaPanel seriesColors prop).
- Notes: Added to PR #188 branch. Merged as part of PR #188.

### P2-OVR-TRENDS-POLISH-v1
- Purpose: Fix chart label dead space; add meaningful postseason week labels (CCG, Bowl, CFP) instead of raw W17/W18 on x-axis.
- Scope: `src/components/MiniTrendsGrid.tsx` (label lane removal), `src/lib/weekLabel.ts` (new file), `src/components/OverviewPanel.tsx` (weekLabelFn via buildWeekLabelMap).
- Notes: Added to PR #188 branch. Merged as part of PR #188.

### P2-OVR-TRENDS-POSTSEASON-v1
- Purpose: Fix postseason week truncation in trend charts; replace W/L dots panel with week-over-week standings position change deltas.
- Scope: `src/lib/schedule.ts` (postseasonCanonicalWeek), `src/lib/selectors/trends.ts` (selectPositionDeltas), `src/components/OverviewPanel.tsx` (PositionDeltaPanel replaces RecentFormPanel).
- Notes: PR #188. Covers the three-commit sequence merged on phase-3b-visual-sweep.

### P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1
- Purpose: Fix standings sort to wins-first (primary) per league rules; add regression tests; realign docs to match.
- Scope: `src/lib/standings.ts` (sort comparator), `src/lib/__tests__/standings.test.ts` (three new regression tests), docs updates.
- Notes: PR #184. Corrected sort from winPct-first to wins-first with winPct/PD/PF tiebreakers.

### DOCS-CLAUDE-MD-BOOTSTRAP-v1
- Purpose: Create CLAUDE.md as a Claude Code-specific companion to AGENTS.md, establishing Claude's role, interaction preferences, and architectural guardrails without duplicating shared project operating content.
- Scope: `CLAUDE.md` (new file), `docs/prompt-registry.md` update only.
- Notes: Follow-on to DOCS-PHASE-RECONCILIATION-v1.

### P2D-TRENDS-FORM-DOTS-v1
- Purpose: Recent form dots panel — last-5-game W/L indicators using actual game scores, displayed alongside the title chase chart on the Overview Trends card.
- Scope: `src/components/OverviewPanel.tsx` (RecentFormPanel), `src/lib/selectors/trends.ts` (selectRecentOutcomes).
- Notes: Retroactively registered. Covers PR #183 on phase-3b-visual-sweep. Renamed from P3B-TRENDS-FORM-DOTS-v1 per DOCS-PHASE-RECONCILIATION-v1.

### DOCS-PHASE-RECONCILIATION-v1
- Purpose: Reconcile phase numbering across all project docs (3A/3B → 2C/2D), incorporate doc revisions, close duplication gaps.
- Scope: docs only — AGENTS.md, docs/roadmap.md, docs/next-tasks.md, docs/completed-work.md, docs/prompt-registry.md, docs/cfb-engineering-operating-instructions.md, docs/vision.md.
- Notes: Active. Single-commit docs reconciliation pass.

---

## Retroactively Registered Prompts

### P2D-TRENDS-TITLE-CHASE-v1
- Purpose: MiniTrendsGrid — compact SVG title chase chart (top-5 contenders, Games Back) for Overview Trends card. Iterated through viewBox fix, inline labels, bump chart, and final title chase framing.
- Scope: `src/components/MiniTrendsGrid.tsx`, `src/components/OverviewPanel.tsx`, `src/lib/selectors/trends.ts`.
- Notes: Retroactively registered. Covers PRs #178–#182. Renamed from P3B-TRENDS-TITLE-CHASE-v1 per DOCS-PHASE-RECONCILIATION-v1.

### P2C-OVERVIEW-REDESIGN-v1
- Purpose: Phase 2C visual redesign — champion podium hero, Rankings tab, app-wide palette and layout sweep, and Trends section restructure (removed TrendsDetailSurface from Overview).
- Scope: `src/components/OverviewPanel.tsx`, `src/components/MiniTrendsGrid.tsx` (initial), `src/app/trends/`.
- Notes: Retroactively registered. Covers PRs #173–#177. Renamed from P3A-OVERVIEW-REDESIGN-v1 per DOCS-PHASE-RECONCILIATION-v1.

### P2B-OVERVIEW-UX-CAMPAIGN-v1
- Purpose: Phase 2B league UX/engagement campaign — Overview hierarchy fix, signal-first copy pass, member feedback entry point, information density pass, app flow improvements, and visual design language.
- Scope: `src/components/OverviewPanel.tsx`, `src/components/StandingsPanel.tsx`, copy/label edits throughout.
- Notes: Retroactively registered. Covers PRs #167–#172 on branches phase-2b-*.

### P2B-OVERVIEW-FEATURE-AUDIT-v1
- Purpose: Audit current Overview page modules for overlap vs. unique value before UI redesign. Planning output only — no implementation.
- Scope: OverviewPanel analysis only. No code changes.
- Notes: Planning doc only. Informed P2B-OVERVIEW-UX-CAMPAIGN-v1 implementation.

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

---

## Superseded Prompts

### P3A-OVERVIEW-REDESIGN-v1
- Superseded by: P2C-OVERVIEW-REDESIGN-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

### P3B-TRENDS-TITLE-CHASE-v1
- Superseded by: P2D-TRENDS-TITLE-CHASE-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

### P3B-TRENDS-FORM-DOTS-v1
- Superseded by: P2D-TRENDS-FORM-DOTS-v1
- Reason: Phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).

---

## Prompt Template

### <PHASE>-<AREA>-<SHORT_NAME>-v<version>
- Purpose: [one sentence]
- Scope: [files or modules affected]
- Notes: [optional — branch, PR refs, follow-up items, superseded IDs]
