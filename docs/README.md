# Documentation Index

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: documentation source-of-truth map and doc lifecycle/status definitions
Supersedes: (none)

This is the **source-of-truth map** for the project's documentation. Start here to find which document owns a given concern, rather than searching across files. Each doc owns one thing; when two docs disagree, the authority hierarchy below decides.

> Scope note: this index was established by **DOCS-002A** (governance + documentation index); **DOCS-002B** completed the planning/history cleanup; **DOCS-002C** added the dedicated architecture/operations doc layer; **DOCS-004** reconciled the known `DESIGN.md` contradictions; **DOCS-005** rolled lifecycle metadata onto the active/canonical docs. The `archive/` path decision is the one remaining deferred follow-up — see [Planned documentation work](#planned-documentation-work) at the bottom.

## Source-of-truth map

| Document | Owns (source of truth for) | Status |
|----------|----------------------------|--------|
| [`AGENTS.md`](../AGENTS.md) | Code architecture + **binding engineering/architecture invariants** + agent operating rules | Current (canonical) |
| [`DESIGN.md`](../DESIGN.md) | UI/UX and the design system — layout, tables, cards, color, typography, component presentation | Current (canonical; the previously-tracked rank-number and game-card-border contradictions were reconciled in DOCS-004) |
| [`CLAUDE.md`](../CLAUDE.md) | Claude-specific working guidance only; points back at `AGENTS.md`/`DESIGN.md` | Current |
| [`docs/README.md`](README.md) | This documentation map + doc-ownership boundaries + the documentation-system's own maintenance roadmap | Current |
| [`docs/next-tasks.md`](next-tasks.md) | Active queue + unresolved product decisions/deferrals ("what's next / still open") | Current |
| [`docs/roadmap.md`](roadmap.md) | Higher-level product/platform roadmap + development philosophy | Current |
| [`docs/prompt-registry.md`](prompt-registry.md) | Historical ledger of implementation/audit prompts (IDs, scope, outcomes) — **not a backlog** | Current (ledger) |
| [`docs/completed-work.md`](completed-work.md) | Append-only record of shipped milestones | Historical (append-only) |
| [`docs/completed-work-archive.md`](completed-work-archive.md) | Older shipped work (Phases 1–3) | Archived |
| [`docs/cfb-engineering-operating-instructions.md`](cfb-engineering-operating-instructions.md) | Original engineering/prompt-governance model — **superseded** by `AGENTS.md` (binding rules) + `CLAUDE.md` (Claude workflow); retained for context/section references, does not override them | Historical / superseded |
| [`docs/architecture/overview.md`](architecture/overview.md) | High-level runtime architecture, canonical data-flow overview, source-of-truth hierarchy, architecture-doc index | Current |
| [`docs/architecture/game-data-flow.md`](architecture/game-data-flow.md) | Schedule → canonical games, score/odds attachment, public cache-reader + authorized-refresh policy, provider quota | Current |
| [`docs/architecture/identity-and-ownership.md`](architecture/identity-and-ownership.md) | Team-name canonicalization boundary, alias precedence, current-season ownership attribution, CSV's role | Current |
| [`docs/architecture/standings.md`](architecture/standings.md) | Canonical standings authority, selector/LiveDelta boundaries, NoClaim, standings cache invalidation, lifecycle states | Current |
| [`docs/architecture/auth-and-privacy.md`](architecture/auth-and-privacy.md) | Clerk identity/roles, platform-admin route/API gating, ADMIN_API_TOKEN fallback, league-password privacy gate, cron auth | Current |
| [`docs/architecture/storage-and-caching.md`](architecture/storage-and-caching.md) | App-state store, alias/app-state storage, provider caches, standings cache keys/tags, legacy-alias cleanup status | Current |
| [`docs/operations/deployment.md`](operations/deployment.md) | High-level deploy/env/auth-secret/cron overview and operational checks (points at the runbook for step-by-step) | Current |
| [`docs/operations/diagnostics.md`](operations/diagnostics.md) | Diagnostic endpoints, debug-surface auth, upstream-first debugging order | Current |
| [`docs/deployment-runbook.md`](deployment-runbook.md) | Hosted deployment / operator checklist (detailed step-by-step; companion to `operations/deployment.md`) | Current |
| [`docs/vision.md`](vision.md) | Product vision + canonical production data policy | Current |
| [`docs/CFB_APP_ARCHITECTURE.md`](CFB_APP_ARCHITECTURE.md) | Quick upstream→downstream pipeline sketch (reference; `AGENTS.md` is canonical for architecture) | Current (reference) |
| [`docs/campaigns/`](campaigns/) | Per-campaign historical detail and shipped-behavior notes | Historical |
| Phase/spec/audit records — `docs/phase-3…6-*-design.md`, `docs/HISTORY_REDESIGN_SPEC.md`, `docs/PHASE_2_REVISION_PROMPT.md`, `docs/overview-feature-audit.md`, `docs/game-stats-audit.md` | Point-in-time design specs, audits, and prompt records | Historical |

## Documentation lifecycle statuses

Use these labels when describing or adding a doc, so readers know how much to trust it going forward:

- **Current** — actively maintained; describes present behavior or active guidance. Safe to act on.
- **Historical** — an accurate record of past work *as of its time*; not maintained forward. Read for context, verify against code before acting.
- **Superseded** — replaced by a newer doc or decision; kept for context. Should name its successor.
- **Archived** — retained for reference only; outside active navigation.

A **ledger** (e.g. `prompt-registry.md`) is a special case: individual entries are historical records, but the file itself is current and appended forward.

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

These are **documentation-system maintenance** follow-ups (meta-work on the docs themselves), deferred out of DOCS-002A so each pass stays small and reviewable. They live here in the doc index by design — not in `docs/next-tasks.md`, which owns the product/engineering queue. When one of these becomes active implementation work, promote it to `docs/next-tasks.md`.

- **DOCS-002B — planning/history cleanup. ✅ Done.** Collapsed the completed PLATFORM-068 audit sequence in `docs/next-tasks.md` to a one-line ledger + an explicit "Unresolved decisions & known deferrals" subsection; removed shipped items (STANDINGS-PRESEASON-STATE, INSIGHTS-LIFECYCLE-AWARENESS) from the planned backlogs; reconciled the `roadmap.md` completed-work table ("Standings Page — Preseason State" → ✅ Complete). `docs/prompt-registry.md` already reads as a ledger (DOCS-002A); `docs/completed-work.md` left as the historical record. Unresolved product decisions and historical campaign detail preserved.
- **DOCS-002C — architecture/operations docs. ✅ Done.** Added a dedicated current-architecture doc layer under `docs/architecture/` (`overview`, `game-data-flow`, `identity-and-ownership`, `standings`, `auth-and-privacy`, `storage-and-caching`) and an operations layer under `docs/operations/` (`deployment`, `diagnostics`), each carrying the lifecycle metadata header and linked from the source-of-truth map above. `AGENTS.md` remains canonical for binding invariants; these docs describe present runtime architecture and point back to it. The `deployment-runbook.md` stays the detailed operator checklist (now companioned by `operations/deployment.md`). Deciding whether `docs/campaigns/**` and the phase/spec records move under an explicit `archive/` path was **not** taken up here — still open.
- **Design-contradiction cleanup (DOCS-004). ✅ Done.** Reconciled the two known `DESIGN.md` self-contradictions against verified current implementation: (1) standings rank numbers — the full Standings page owner-colors them (`StandingsPanel`), while the Overview condensed snapshot and History tables use muted text and podiums use the tier accent; the doc now states this single rule instead of the false "all standings tables … never colored" absolute; (2) game cards — individual cards **are** bordered discrete objects (`GameWeekPanel`), so the stale "no border, defined by background only" bullet was corrected to agree with the Containerization rule. Docs-only; no runtime UI change.
- **Doc lifecycle metadata rollout (DOCS-005). ✅ Done.** Rolled the per-doc metadata header onto the active/canonical governance and reference docs — `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `docs/README.md`, `docs/next-tasks.md`, `docs/roadmap.md`, `docs/prompt-registry.md` (as `Status: Current ledger`), `docs/deployment-runbook.md`, `docs/vision.md`, and `docs/completed-work.md` (as `Status: Historical (append-only ledger)`) — matching the block first adopted by the DOCS-002C architecture/operations docs. Historical campaign/phase/spec/audit records were intentionally left unlabeled (they remain historical; labeling them is not required and no `archive/` move was performed). Each active doc now carries:

  ```md
  Status:
  Last verified:
  Owner:
  Canonical for:
  Supersedes:
  ```
- **`archive/` path decision (deferred).** The one remaining follow-up: decide whether `docs/campaigns/**` and the phase/spec/audit records should move under an explicit `archive/` path (vs. staying in place and marked Historical). No file moves have been performed. Promote to `docs/next-tasks.md` when taken up.
