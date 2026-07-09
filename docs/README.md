# Documentation Index

This is the **source-of-truth map** for the project's documentation. Start here to find which document owns a given concern, rather than searching across files. Each doc owns one thing; when two docs disagree, the authority hierarchy below decides.

> Scope note: this index was established by **DOCS-002A** (governance + documentation index). The deeper cleanup of the planning/history and architecture docs is deliberately deferred — see [Planned documentation work](#planned-documentation-work) at the bottom.

## Source-of-truth map

| Document | Owns (source of truth for) | Status |
|----------|----------------------------|--------|
| [`AGENTS.md`](../AGENTS.md) | Code architecture + **binding engineering/architecture invariants** + agent operating rules | Current (canonical) |
| [`DESIGN.md`](../DESIGN.md) | UI/UX and the design system — layout, tables, cards, color, typography, component presentation | Current (canonical; a few known open contradictions tracked below — not yet fully reconciled) |
| [`CLAUDE.md`](../CLAUDE.md) | Claude-specific working guidance only; points back at `AGENTS.md`/`DESIGN.md` | Current |
| [`docs/README.md`](README.md) | This documentation map + doc-ownership boundaries + the documentation-system's own maintenance roadmap | Current |
| [`docs/next-tasks.md`](next-tasks.md) | Active queue + unresolved product decisions/deferrals ("what's next / still open") | Current |
| [`docs/roadmap.md`](roadmap.md) | Higher-level product/platform roadmap + development philosophy | Current |
| [`docs/prompt-registry.md`](prompt-registry.md) | Historical ledger of implementation/audit prompts (IDs, scope, outcomes) — **not a backlog** | Current (ledger) |
| [`docs/completed-work.md`](completed-work.md) | Append-only record of shipped milestones | Historical (append-only) |
| [`docs/completed-work-archive.md`](completed-work-archive.md) | Older shipped work (Phases 1–3) | Archived |
| [`docs/cfb-engineering-operating-instructions.md`](cfb-engineering-operating-instructions.md) | Original engineering/prompt-governance model — **superseded** by `AGENTS.md` (binding rules) + `CLAUDE.md` (Claude workflow); retained for context/section references, does not override them | Historical / superseded |
| [`docs/deployment-runbook.md`](deployment-runbook.md) | Hosted deployment / operator checklist | Current |
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
- **`docs/next-tasks.md`** — the active product/engineering queue and the single home for unresolved **product** decisions/deferrals. *(Scoped for a deliberate split under DOCS-002B; treat as current for now.)*
- **`docs/prompt-registry.md`** — the historical prompt ledger. *(Scoped for a cleanup pass under DOCS-002B; treat as current for now.)*
- **`docs/roadmap.md`** — the product/platform roadmap. *(Scoped for reduction under DOCS-002B; treat as current for now.)*

## Planned documentation work

These are **documentation-system maintenance** follow-ups (meta-work on the docs themselves), deferred out of DOCS-002A so each pass stays small and reviewable. They live here in the doc index by design — not in `docs/next-tasks.md`, which owns the product/engineering queue. When one of these becomes active implementation work, promote it to `docs/next-tasks.md`.

- **DOCS-002B — planning/history cleanup.** Reduce `docs/next-tasks.md` to a concise active queue + unresolved-decisions section (the completed PLATFORM-068 audit sequence collapses to a ledger pointer); reconcile stale "planned" status where behavior has shipped (e.g. the `roadmap.md` completed-work table); trim `docs/prompt-registry.md` so it reads strictly as a ledger; consolidate `docs/roadmap.md` so it does not duplicate `next-tasks` item status. Preserve all unresolved product decisions and historical campaign detail.
- **DOCS-002C — architecture/operations docs.** Extract the durable architecture map and operations references into dedicated docs (today architecture lives in `AGENTS.md` + the `CFB_APP_ARCHITECTURE.md` sketch, and operations in `deployment-runbook.md`). Decide whether `docs/campaigns/**` and the phase/spec records should move under an explicit `archive/` path. No file moves are performed yet.
- **Design-contradiction cleanup (deferred).** `DESIGN.md` is canonical but not fully reconciled — resolve these known open contradictions against the current intended UI (fold into DOCS-002B or a dedicated design-cleanup prompt): (1) standings rank numbers owner-colored vs muted/plain; (2) game cards no border vs retain borders. Tracked here rather than resolved in DOCS-002A because the correct choice isn't unambiguously established by the current docs.
- **Doc lifecycle metadata block (deferred).** Rolling a per-doc metadata header onto active/canonical docs is deferred (not done in DOCS-002A). When adopted, each active doc should carry:

  ```md
  Status:
  Last verified:
  Owner:
  Canonical for:
  Supersedes:
  ```
