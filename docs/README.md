# Documentation Index

Status: Current
Last verified: 2026-07-30
Owner: Project documentation
Canonical for: documentation source-of-truth map and doc lifecycle/status definitions
Supersedes: (none)

This is the **source-of-truth map** for the project's documentation. Start here to find which document owns a given concern, rather than searching across files. Each doc owns one thing; when two docs disagree, the authority hierarchy below decides.

> Scope note: this index was established by **DOCS-002A** (governance + documentation index); **DOCS-002B** completed the planning/history cleanup; **DOCS-002C** added the dedicated architecture/operations doc layer; **DOCS-004** reconciled the known `DESIGN.md` contradictions; **DOCS-005** rolled lifecycle metadata onto the active/canonical docs; **DOCS-006** implemented the `archive/` path decision (standalone historical audits/design-specs/prompts moved under `docs/archive/**`); **DOCS-007** finished root-doc hygiene (moved the remaining historical/superseded root docs under `docs/archive/{governance,history}/`). **The DOCS-002x documentation-consolidation sequence is complete** — its planned follow-ups are all done. That does not freeze the docs: later drift-remediation passes still occur as the code changes (e.g. **DOCS-010**, the post-PLATFORM-086H3E-activation reconciliation), tracked in `docs/prompt-registry.md` and `docs/next-tasks.md`. See [Planned documentation work](#planned-documentation-work) at the bottom for the finished consolidation record.

## Source-of-truth map

| Document | Owns (source of truth for) | Status |
|----------|----------------------------|--------|
| [`AGENTS.md`](../AGENTS.md) | Code architecture + **binding engineering/architecture invariants** + agent operating rules | Current (canonical) |
| [`DESIGN.md`](../DESIGN.md) | UI/UX and the design system — layout, tables, cards, color, typography, component presentation | Current (canonical; the previously-tracked rank-number and game-card-border contradictions were reconciled in DOCS-004) |
| [`CLAUDE.md`](../CLAUDE.md) | Claude-specific working guidance only; points back at `AGENTS.md`/`DESIGN.md` | Current |
| [`README.md`](../README.md) | Repository onboarding — what the app is, how to run it, and where the authoritative docs live | Current (onboarding) |
| [`docs/README.md`](README.md) | This documentation map + doc-ownership boundaries + the documentation-system's own maintenance roadmap | Current |
| [`docs/next-tasks.md`](next-tasks.md) | Current execution order, planned/parked work, blockers, and the ONE canonical list of unresolved decisions/deferrals; the only doc that may mark work `NEXT`/`CURRENT` | Current |
| [`docs/roadmap.md`](roadmap.md) | Campaign definitions, goals, dependencies, coarse future sequencing, and development philosophy — direction, not PR internals | Current |
| [`docs/prompt-registry.md`](prompt-registry.md) | Historical ledger of formal prompts and their execution outcomes (IDs, scope, outcomes, merge state) — **not a backlog**, never a `NEXT` pointer | Current (ledger) |
| [`docs/completed-work.md`](completed-work.md) | Append-only, outcome-focused record of merged/shipped milestones; entry status text is point-in-time history | Historical (append-only) |
| [`docs/architecture/overview.md`](architecture/overview.md) | High-level runtime architecture, canonical data-flow overview, source-of-truth hierarchy, architecture-doc index | Current |
| [`docs/architecture/game-data-flow.md`](architecture/game-data-flow.md) | Schedule → canonical games, score/odds attachment, game-stats ingestion/evidence flow, public cache-reader + authorized-refresh policy, provider quota | Current |
| [`docs/architecture/identity-and-ownership.md`](architecture/identity-and-ownership.md) | Team-name canonicalization boundary, alias precedence, current-season ownership attribution, CSV's role | Current |
| [`docs/architecture/standings.md`](architecture/standings.md) | Canonical standings authority, selector/LiveDelta boundaries, NoClaim, standings cache invalidation, lifecycle states | Current |
| [`docs/architecture/auth-and-privacy.md`](architecture/auth-and-privacy.md) | Clerk identity/roles, platform-admin route/API gating, ADMIN_API_TOKEN fallback, league-password privacy gate, cron auth | Current |
| [`docs/architecture/storage-and-caching.md`](architecture/storage-and-caching.md) | App-state store, alias/app-state storage, provider caches, standings cache keys/tags, legacy-alias cleanup status | Current |
| [`docs/operations/deployment.md`](operations/deployment.md) | High-level deploy/env/auth-secret/cron overview and operational checks (points at the runbook for step-by-step) | Current |
| [`docs/operations/diagnostics.md`](operations/diagnostics.md) | Diagnostic endpoints, debug-surface auth, upstream-first debugging order | Current |
| [`docs/deployment-runbook.md`](deployment-runbook.md) | Hosted deployment / operator checklist (detailed step-by-step; companion to `operations/deployment.md`) | Current |
| [`docs/vision.md`](vision.md) | Product vision + canonical production data policy | Current |
| [`docs/CFB_APP_ARCHITECTURE.md`](CFB_APP_ARCHITECTURE.md) | Quick upstream→downstream pipeline sketch (reference; `AGENTS.md` is canonical for architecture) | Current (reference) |
| [`docs/ai/game-stats-writer-fence.md`](ai/game-stats-writer-fence.md) | The game-stats activation / writer-control architecture record (PLATFORM-086H3 fence → C/D/E → PLATFORM-086H3E activation) | Current (architecture) |
| [`docs/ai/platform-086h3-contract.md`](ai/platform-086h3-contract.md) | The original PLATFORM-086H3 lifecycle contract — **frozen, superseded in part** (its revision/lineage design was dropped); point-in-time technical history, not current authority (see the writer-fence doc) | Superseded (frozen) |
| [`docs/ai/platform-086h3c1-implementation-handoff.md`](ai/platform-086h3c1-implementation-handoff.md) | The C1 evidence-read-model implementation handoff — point-in-time technical history of a shipped slice, not current authority | Historical (point-in-time) |
| [`docs/campaigns/`](campaigns/) | Per-campaign historical detail and shipped-behavior notes — intentionally retained historical campaign record (not archived) | Historical |
| [`docs/archive/`](archive/) | Archived historical artifacts — audits (`archive/audits/`), design specs (`archive/designs/`), prompt records (`archive/prompts/`), the original prompt-governance model (`archive/governance/`), and older shipped-work logs (`archive/history/`) — historical reference only, not current authority. See [`docs/archive/README.md`](archive/README.md) | Archived |

## Documentation lifecycle statuses

Use these labels when describing or adding a doc, so readers know how much to trust it going forward:

- **Current** — actively maintained; describes present behavior or active guidance. Safe to act on.
- **Historical** — an accurate record of past work *as of its time*; not maintained forward. Read for context, verify against code before acting.
- **Superseded** — replaced by a newer doc or decision; kept for context. Should name its successor.
- **Archived** — retained for reference only; outside active navigation.

A **ledger** (e.g. `prompt-registry.md`) is a special case: individual entries are historical records, but the file itself is current and appended forward.

## Current vs historical ledger ownership (DOCS-012)

The binding closeout rules live in `AGENTS.md` → "Documentation closeout timing" → **"Ledger
ownership during closeout"**; this index summarizes the model rather than duplicating it:

| Document | Required responsibility |
|---|---|
| `next-tasks.md` | Current execution order, planned work, parked work, blockers, and the one canonical list of unresolved decisions/deferrals |
| `roadmap.md` | Campaign definitions, goals, dependencies, and coarse future sequencing |
| `prompt-registry.md` | Historical ledger of formal prompts and their execution outcomes |
| `completed-work.md` | Append-only, outcome-focused record of merged/shipped milestones |

Working rules:

- Only `next-tasks.md` may designate an item `NEXT` or `CURRENT`.
- Unresolved decisions and known deferrals are canonical only in `next-tasks.md`; other documents
  link to that section instead of maintaining duplicate descriptions.
- Historical status text (an old `NEXT`, `PENDING`, or dormant-planning phrase inside a ledger
  entry) is point-in-time evidence, not current planning authority.
- New prompt-registry and completed-work entries must not embed live queue pointers that will
  become stale.

### Status vocabulary

Current planning documents use: `NEXT` · `In progress` · `Planned` · `Parked` · `Blocked` ·
`✅ Complete`. Deployment qualifiers are separate and composable: `Merged` · `Dormant` ·
`Active in production` · `Unprovisioned` · `Observation pending`. Existing historical entries are
grandfathered — do not mechanically rewrite old entries merely to change capitalization; correct a
historical phrase only when it actively misleads current-state guidance.

### `Last verified` policy

- In **current** planning/reference documents, `Last verified` means the entire current-authority
  content was audited for present-state accuracy on that date.
- In **historical ledgers**, it means the ledger structure, newest entries, ordering, cross-links,
  and file-level guidance were verified — NOT that every historical implementation claim was
  re-proven against the runtime.

## Authority boundaries

When documents disagree, this ownership hierarchy decides:

- **`AGENTS.md`** — binding engineering and architecture invariants. Canonical for anything about how the code is structured or how agents must operate. Wins on architecture/rules.
- **`DESIGN.md`** — durable UI principles and the design system. Canonical for anything visual/layout. Wins on UI.
- **`CLAUDE.md`** — Claude-specific workflow guidance only. Points at `AGENTS.md`/`DESIGN.md`; never restates or overrides them.
- **`docs/README.md`** (this file) — the documentation map and source-of-truth ownership. It does not carry architecture, design, or **product/engineering** planning content — it points at the doc that owns each. The one exception is the **documentation-system's own maintenance roadmap** (the DOCS-002x consolidation follow-ups below), which this index owns because they are meta-work on the docs themselves; each graduates to `docs/next-tasks.md` when it becomes active implementation work.
- **`docs/next-tasks.md`** — the active product/engineering queue and the single home for unresolved **product** decisions/deferrals.
- **`docs/prompt-registry.md`** — the historical prompt ledger.
- **`docs/roadmap.md`** — the product/platform roadmap.

## Planned documentation work

These were **documentation-system maintenance** follow-ups (meta-work on the docs themselves), sequenced out of DOCS-002A so each pass stayed small and reviewable. **The DOCS-002x consolidation sequence is complete (DOCS-002A → 002B → 002C → 004 → 005 → 006 → 007); none of its planned follow-ups remain deferred.** The finished record is kept below for traceability. This does not mean documentation is frozen: later drift-remediation passes (e.g. **DOCS-010**, the post-PLATFORM-086H3E-activation reconciliation) still run as the code evolves — those go through `docs/prompt-registry.md` and `docs/next-tasks.md`, not this consolidation ledger.

- **DOCS-002B — planning/history cleanup. ✅ Done.** Collapsed the completed PLATFORM-068 audit sequence in `docs/next-tasks.md` to a one-line ledger + an explicit "Unresolved decisions & known deferrals" subsection; removed shipped items (STANDINGS-PRESEASON-STATE, INSIGHTS-LIFECYCLE-AWARENESS) from the planned backlogs; reconciled the `roadmap.md` completed-work table ("Standings Page — Preseason State" → ✅ Complete). `docs/prompt-registry.md` already reads as a ledger (DOCS-002A); `docs/completed-work.md` left as the historical record. Unresolved product decisions and historical campaign detail preserved.
- **DOCS-002C — architecture/operations docs. ✅ Done.** Added a dedicated current-architecture doc layer under `docs/architecture/` (`overview`, `game-data-flow`, `identity-and-ownership`, `standings`, `auth-and-privacy`, `storage-and-caching`) and an operations layer under `docs/operations/` (`deployment`, `diagnostics`), each carrying the lifecycle metadata header and linked from the source-of-truth map above. `AGENTS.md` remains canonical for binding invariants; these docs describe present runtime architecture and point back to it. The `deployment-runbook.md` stays the detailed operator checklist (now companioned by `operations/deployment.md`). The `archive/` path decision it flagged was taken up separately in DOCS-006 (below).
- **Design-contradiction cleanup (DOCS-004). ✅ Done.** Reconciled the two known `DESIGN.md` self-contradictions against verified current implementation: (1) standings rank numbers — the full Standings page owner-colors them (`StandingsPanel`), while the Overview condensed snapshot and History tables use muted text and podiums use the tier accent; the doc now states this single rule instead of the false "all standings tables … never colored" absolute; (2) game cards — individual cards **are** bordered discrete objects (`GameWeekPanel`), so the stale "no border, defined by background only" bullet was corrected to agree with the Containerization rule. Docs-only; no runtime UI change.
- **Doc lifecycle metadata rollout (DOCS-005). ✅ Done.** Rolled the per-doc metadata header onto the active/canonical governance and reference docs — `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `docs/README.md`, `docs/next-tasks.md`, `docs/roadmap.md`, `docs/prompt-registry.md` (as `Status: Current ledger`), `docs/deployment-runbook.md`, `docs/vision.md`, and `docs/completed-work.md` (as `Status: Historical (append-only ledger)`) — matching the block first adopted by the DOCS-002C architecture/operations docs. Historical campaign/phase/spec/audit records were intentionally left unlabeled (they remain historical; labeling them is not required and no `archive/` move was performed). Each active doc now carries:

  ```md
  Status:
  Last verified:
  Owner:
  Canonical for:
  Supersedes:
  ```

- **`archive/` path decision (DOCS-006). ✅ Done.** Decision: **standardize `docs/archive/`** for standalone historical artifacts while **leaving `docs/campaigns/**` in place** as an intentionally-retained campaign-retrospective area. `git mv`'d the standalone point-in-time audits, design specs, and prompt records under `docs/archive/{audits,designs,prompts}/` (kebab-case filenames), added an "Archived — historical reference only" banner to each moved file, and created [`docs/archive/README.md`](archive/README.md) explaining the archive policy and where current authority lives. Updated all in-repo references to the new paths (the historical prompt-ledger scope lines were left as point-in-time records). `docs/cfb-engineering-operating-instructions.md` and `docs/completed-work-archive.md` were left in place at the time (already clearly labeled; subsequently moved under `docs/archive/{governance,history}/` by DOCS-007). No campaign retrospectives were moved or rewritten.
- **Root-doc archive hygiene (DOCS-007). ✅ Done.** Audited the three remaining legacy-looking `docs/` root files: kept `docs/CFB_APP_ARCHITECTURE.md` in place (genuinely `Current (reference)`; added a lifecycle metadata header since it only *looked* legacy as a bare ASCII sketch), and `git mv`'d `cfb-engineering-operating-instructions.md` → `docs/archive/governance/` and `completed-work-archive.md` → `docs/archive/history/` (each labeled), adding those two archive categories to [`docs/archive/README.md`](archive/README.md). Updated all live references (`AGENTS.md`, `CLAUDE.md`, `architecture/overview.md`, `roadmap.md`, this map). Root `docs/` now holds only current/current-ledger docs plus the labeled reference sketch.
- **Final docs-consistency cleanup (DOCS-008). ✅ Done.** Post-closeout consistency pass: relabeled provisional `Prompt ID to assign` slugs in `next-tasks.md`/`roadmap.md` as `Backlog slug (provisional)` (formal `PROMPT_ID`s assigned at activation per `AGENTS.md`); corrected the deployment-runbook member-access checklist (public vs passworded leagues; `/admin` Clerk-gated) and its "commissioner" → "platform admin/operator" wording; added DOCS-007 to the completed-sequence sentence (this record); and fixed the `CFB_APP_ARCHITECTURE.md` sketch ordering (identity resolution is part of canonical `AppGame` construction). Markdown formatting left non-enforced.
