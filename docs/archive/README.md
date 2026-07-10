# Documentation Archive

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: archive policy and index of historical audit/design/prompt artifacts
Supersedes: (none)

This directory preserves **historical** documentation artifacts — point-in-time audits, design specs, and prompt records — that are kept for context but are **not current implementation authority**. Nothing here should be read as describing how the app works today.

## Where current authority lives

If you need to know how the system works *now*, read these instead:

| Concern | Current authority |
|---------|-------------------|
| Binding engineering/architecture invariants + agent operating rules | [`AGENTS.md`](../../AGENTS.md) |
| Claude-specific workflow guidance | [`CLAUDE.md`](../../CLAUDE.md) |
| UI/UX and the design system | [`DESIGN.md`](../../DESIGN.md) |
| Current runtime architecture | [`docs/architecture/**`](../architecture/) |
| Deployment / diagnostics / operations | [`docs/operations/**`](../operations/) |
| Active queue + unresolved decisions/deferrals | [`docs/next-tasks.md`](../next-tasks.md) |
| Documentation source-of-truth map + lifecycle definitions | [`docs/README.md`](../README.md) |

The prompt ledger ([`docs/prompt-registry.md`](../prompt-registry.md)) and the completed-work log ([`docs/completed-work.md`](../completed-work.md)) remain in `docs/` — they are current, append-forward ledgers, not archive material.

## What belongs here

- **`audits/`** — point-in-time audit prompts and their findings (e.g. game-stats endpoint audit, Overview feature audit, the P2C foundation/standings-history audits). Superseded by whatever shipped afterward; retained to explain *why* a change was made.
- **`designs/`** — historical design specs and phase design docs (History redesign spec; the Phase 3–6 design docs). The behavior they describe has either shipped (see `docs/completed-work.md` and the current architecture docs) or been superseded.
- **`prompts/`** — standalone historical implementation-prompt artifacts (e.g. the Phase 2 Overview-revision prompt).

Each archived file carries an "Archived — historical reference only" banner at the top.

## How to interpret archived records

- Treat every claim as **accurate only as of the document's own time**, not as current guidance. Verify against the current-authority docs (and the code) before acting.
- A phase/spec/audit record describes an *intended* or *investigated* state at that moment; the shipped outcome is recorded in [`docs/completed-work.md`](../completed-work.md) and the [prompt ledger](../prompt-registry.md), and the *current* behavior is owned by [`docs/architecture/**`](../architecture/) / [`docs/operations/**`](../operations/).
- If an archived doc and a current-authority doc disagree, the current-authority doc wins — always.

## Related historical material kept elsewhere

- **Campaign retrospectives** live in [`docs/campaigns/**`](../campaigns/) — an intentionally-retained historical campaign-record area (not moved here), each documenting a shipped campaign's arc.
- **Older shipped work (Phases 1–3)** lives in [`docs/completed-work-archive.md`](../completed-work-archive.md).
- **The original prompt-governance model** lives in [`docs/cfb-engineering-operating-instructions.md`](../cfb-engineering-operating-instructions.md), retained in place and marked Historical/superseded (its binding successors are `AGENTS.md` + `CLAUDE.md`).
