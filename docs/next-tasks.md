# Phase 1 Remaining Tasks (Execution Priority)

This file tracks only the **remaining** Phase 1 architecture-stabilization work.
Completed or superseded items were removed.

## P3 — Reduce oversized orchestration/core modules (no behavior changes)

**Why this is next:** maintainability risk remains from large files.

**Scope**

- Keep `CFBScheduleApp.tsx` as orchestrator; extract non-trivial logic to focused `src/lib/*` helpers.
- Prioritize decomposition of:
  - `src/components/CFBScheduleApp.tsx`
  - `src/lib/schedule.ts`
  - `src/lib/scoreAttachment.ts` (if it grows further)
- No architecture redesign; behavior-preserving refactor only.

**Done when**

- Module sizes and responsibilities align better with `AGENTS.md` guardrails.
- Runtime flow remains unchanged.

---

## P4 — Keep Phase 1 docs synchronized with code after each task

**Why this is next:** prevents plan drift.

**Scope**

- After each Phase 1 task, update:
  - `docs/next-tasks.md` (remaining work only)
  - `docs/roadmap.md` (status/completion criteria notes)

**Done when**

- Task docs consistently reference real current modules and contracts.
