# Phase 1 Remaining Tasks (Execution Priority)

This file tracks only the **remaining** Phase 1 architecture-stabilization work.
Completed or superseded items were removed.

## P3 — Reduce oversized orchestration/core modules (no behavior changes)

**Why this is next:** maintainability risk remains from large files.

**Scope (remaining)**

- Keep `CFBScheduleApp.tsx` as orchestrator; extract non-trivial logic to focused `src/lib/*` helpers.
- Continue decomposition of:
  - `src/components/CFBScheduleApp.tsx`
  - `src/lib/scoreAttachment.ts` (if it grows further)
- Preserve the recent schedule decomposition boundary:
  - `src/lib/schedule.ts` should stay focused on orchestration/build flow
  - `src/lib/scheduleEligibility.ts`, `src/lib/scheduleTracking.ts`, and `src/lib/schedulePostseasonHelpers.ts` should own extracted pure/helper logic
- No architecture redesign; behavior-preserving refactor only.

**Done when**

- Remaining oversized modules align better with `AGENTS.md` guardrails.
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
