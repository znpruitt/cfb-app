# CLAUDE.md

Status: Current
Last verified: 2026-08-04
Owner: Project documentation
Canonical for: Claude-specific invocation guidance only — how to drive this repo's tooling. It states NO binding rules of its own.
Supersedes: docs/archive/governance/cfb-engineering-operating-instructions.md (Claude-workflow portion; jointly with AGENTS.md, which is canonical for the binding rules)

Claude Code companion to `AGENTS.md`. **Read `AGENTS.md` first.**

> **This file is not a source of truth.** DOCS-013 reduced it to invocation guidance. Every binding
> rule — scope and sizing, review and remediation limits, verification, reconstruction, lifecycle and
> standings and auth invariants, documentation closeout — lives in `AGENTS.md`. `DESIGN.md` is
> canonical for UI/UX. If anything here appears to state a rule, `AGENTS.md` wins and this file is
> the bug. [`docs/README.md`](docs/README.md) is the full documentation map.

---

## Where the rules live

| Need | Read |
| --- | --- |
| How big a PR may be; when a split is mandatory | `AGENTS.md` → **Scope and sizing** |
| How many remediation rounds; when to stop; when to reconstruct | `AGENTS.md` → **Review and remediation limits** |
| How to run gates and report results; test accounting | `AGENTS.md` → **Verification** |
| Lifecycle / standings / ownership / auth invariants | `AGENTS.md` → the **Invariants** sections |
| When documentation is finalized; which ledger owns what | `AGENTS.md` → **Documentation closeout timing** |
| UI and design decisions | `DESIGN.md` |
| What is queued next, and campaign status | `docs/next-tasks.md` |
| Which prompt IDs exist | `docs/prompt-registry.md` |
| Doc ownership map | `docs/README.md` |

---

## Role on this project

Roles are assigned **per task by the prompt**, not fixed by tool. Claude may plan, implement,
remediate, diagnose, or review; Codex commonly provides independent read-only review and can also
take scoped implementation. Whatever the assigned role, diagnose accurately, keep changes within the
prompt's stated scope, and report outcomes honestly — preserving known unresolved risks as
unresolved.

## Interaction preferences

- Concise, technically precise, professional, direct.
- No engagement bait or teasing. State insights and improvements immediately.
- Proactively recommend better approaches when visible; flag conflicts with `AGENTS.md` explicitly
  before proceeding rather than resolving them silently.

---

## Invoking the review tools

- `/code-review` is **user-invocable only** in this environment — Claude cannot call it. When a
  workflow requires it, run everything else, then stop and ask the user to invoke it against the
  exact commit. Report the limitation; never substitute a self-review and call it the same thing.
- `/codex:review` can be started by Claude in the background.
- Both reviews must run against the **same commit**, and both must be gathered before any
  remediation — see `AGENTS.md` → **Review and remediation limits**.

## Prompt headers

Every generated prompt begins with:

```text
PROMPT_ID: <CAMPAIGN>-<###>-<SHORT_NAME>-v<version>
PURPOSE: <1–2 sentences>
SCOPE: <files/modules + constraints>
```

Campaign prefixes: `INSIGHTS`, `DRAFT`, `PLATFORM`, `POLISH`, `DOCS`. Split work may use a lettered
sub-sequence (`PLATFORM-079a`/`079b`). Existing `P{n}` IDs are grandfathered — do not renumber.
Check `docs/prompt-registry.md` for collisions before assigning an ID; the registry entry itself is
written during the pre-merge documentation closeout, not before.

Before any UI work, read `DESIGN.md`.

---

## Commands

- `npm run dev` — Next.js dev server (localhost:3000)
- `npm run build` — production build
- `npm run lint` — fast scoped lint (skips tests/data); local iteration only
- `npm run lint:all` — **the pre-merge gate.** Full-project ESLint + Prettier + markdownlint; this
  is what Vercel runs, and `npm run lint` misses violations in test files
- `npx tsc --noEmit` — type-check
- `npm test` — full suite (`node:test` + `tsx`); tests live in `src/**/__tests__/`
- Single test file: `APP_STATE_TEST_ISOLATION=1 TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test <path>`
  — the env vars matter; `npm test` sets them, and omitting `APP_STATE_TEST_ISOLATION` lets suites
  share a durable store. For paths containing `[brackets]`, use a `**` traversal glob
  (`'src/app/admin/**/__tests__/*.test.ts'`) — a quoted bracketed path is read as a glob character
  class and silently matches nothing.
- `npm run fetch:teams` — regenerate `src/data/teams.json` from CFBD

No Vitest/Jest. No CI workflow is checked in; `npm run lint:all` is the intended pre-merge gate.

---

## Debugging order

Always diagnose upstream-first — never start at the UI when an upstream layer may be wrong:

```text
1. API response
2. normalization layer
3. canonical game model
4. attachment layers
5. UI
```

The architecture map lives in `AGENTS.md` → **Architecture overview** and
`docs/CFB_APP_ARCHITECTURE.md`.

---

## Preview branch

After completing an implementation and pushing the feature branch:

```bash
git push origin HEAD:preview --force
```

`preview` is a throwaway surface that always reflects the latest work in progress, so the force push
is intentional. Never open a PR from `preview`; never merge `preview` into `main`. Do not push
unreviewed work there.
