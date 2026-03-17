# Phase 1 Remaining Tasks (Execution Priority)

This file tracks only the **remaining** Phase 1 architecture-stabilization work.
Completed or superseded items were removed.

## P0 — Add shared retry/backoff + request pacing for upstream API calls

**Why this is next:** biggest remaining reliability gap for CFBD/Odds fetches.

**Scope**

- Extend `src/lib/api/fetchUpstream.ts` with optional retry policy (network/timeout/429/5xx).
- Add exponential backoff (+ jitter) and lightweight per-provider pacing/throttle.
- Wire policy into:
  - `src/app/api/schedule/route.ts`
  - `src/app/api/scores/route.ts`
  - `src/app/api/odds/route.ts`

**Done when**

- Routes use the shared wrapper (no duplicated retry loops).
- Retries are bounded and observable in error detail/logging.

---

## P1 — Tighten odds/scores adapter boundary to app-facing attached shapes

**Why this is next:** architecture still splits provider normalization (routes) and schedule attachment (client lib), which weakens adapter boundaries.

**Scope**

- Keep canonicalization + attachment in shared lib helpers under `src/lib/*`.
- Update route contracts to return stable app-facing attached data (keyed by schedule game identity), instead of provider-leaning rows/events.
- Preserve diagnostics metadata and cache metadata in route responses.

**Done when**

- `CFBScheduleApp` no longer needs provider-shape-specific attachment logic for odds/scores.
- Route responses are stable and provider-agnostic.

---

## P2 — Resolve legacy-compatibility scope and finish cleanup

**Why this is next:** legacy fallback behavior exists by design, but Phase 1 completion criteria need explicit close-out.

**Scope**

- Decide/document whether Phase 1 legacy removal means:
  - schedule CSV only (already done), or
  - schedule CSV + legacy storage-key fallback cleanup.
- If approved, remove/limit reads from `LEGACY_STORAGE_KEYS` in:
  - `src/lib/bootstrap.ts`
  - `src/components/CFBScheduleApp.tsx`
- Keep owners upload/caching and alias persistence behavior intact.

**Done when**

- Legacy boundary is explicit in docs and code behavior matches that boundary.

---

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
