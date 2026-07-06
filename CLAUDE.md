# CLAUDE.md

Claude Code-specific companion to `AGENTS.md`. Read `AGENTS.md` first — this file adds Claude-specific context only and does not restate shared project operating content.

> **Doc authority (source of truth):** `AGENTS.md` = code architecture + agent operating rules (canonical). `DESIGN.md` = UI/UX + design system (canonical). `CLAUDE.md` (this file) = Claude-specific working guidance, which **points to** those two rather than restating them. If anything here duplicates and drifts from `AGENTS.md`/`DESIGN.md`, those win — fix the pointer here.

---

## Role on this project

Roles are assigned **per task by the prompt**, not fixed by tool. Claude may plan, implement, remediate, diagnose, or review depending on what the prompt asks. Codex commonly provides independent read-only review of Claude's work (and can also take scoped implementation), but either system can receive scoped work of any kind.

Whatever the assigned role, Claude is expected to:
- diagnose accurately and flag architectural inconsistencies
- keep changes within the prompt's stated scope
- follow the prompt/response and commit conventions in the docs below
- report outcomes honestly, preserving known unresolved risks as unresolved

---

## Canonical doc pointers

| Doc | Purpose |
|-----|---------|
| `AGENTS.md` | Project operating instructions (shared across all AI coders) |
| `docs/cfb-engineering-operating-instructions.md` | Prompt governance, response structure, commit format |
| `docs/next-tasks.md` | Active task queue and current phase focus |
| `docs/prompt-registry.md` | Prompt ID registry — check before assigning new IDs |
| `docs/completed-work.md` | Append-only milestone log |
| `DESIGN.md` | UI/UX design principles — read before any UI work |
| `docs/roadmap.md` | Campaign definitions and development philosophy |
| `docs/deployment-runbook.md` | Hosted deployment checklist |

---

## Interaction preferences

From Section 1 of Engineering Operating Instructions:

- Concise, technically precise, professional but direct.
- No engagement bait, artificial hooks, or teasing.
- State insights and improvements immediately — do not withhold them.
- Proactively recommend better approaches when visible.

---

## Prompt generation responsibility

Every Codex prompt Claude produces must:

1. Begin with the standard header (Section 3.1 of Engineering Operating Instructions):
   ```
   PROMPT_ID: <CAMPAIGN>-<###>-<SHORT_NAME>-v<version>
   PURPOSE: <1–2 sentences>
   SCOPE: <files/modules + constraints>
   ```
   Campaign prefixes: `INSIGHTS`, `DRAFT`, `PLATFORM`, `POLISH`.
   Example: `INSIGHTS-001-OWNER-AGGREGATION-v1`, `DRAFT-001-SLOW-MODE-v1`.
   Existing `P{n}` prompt IDs (e.g. `P7B-GAME-STATS-PIPELINE-A`) are grandfathered — do not renumber them.
2. Include a **Final Response Requirement** section (Section 3.11) that restates the expected `PROMPT_ID` first-line and required response structure.
3. Be registered in `docs/prompt-registry.md` after execution.

Check `docs/prompt-registry.md` for related existing prompts before assigning a new ID.

---

## Design principles

Before implementing any UI work, read `DESIGN.md` at the project root. All UI decisions must be consistent with the established design principles.

---

## Architectural guardrails

The **binding, canonical** guardrails live in `AGENTS.md` — its **Core rules**, **Standings Ownership Invariants**, **Auth Architecture Invariants**, and **Season Launch Hardening Invariants**. Read the relevant sections there before generating or implementing prompts that touch schedule/identity, standings, ownership, the draft, auth, or the insights engine. Prefer pointing at `AGENTS.md` over re-deriving its rules here.

The list below is a **deliberate minimal echo** of the few invariants worth keeping in front of Claude for day-to-day implementation safety — not a second source of truth. `AGENTS.md` states each one authoritatively; if this echo and `AGENTS.md` ever disagree, `AGENTS.md` wins and this echo is the bug. Kept short precisely so it rarely needs to change; detail (e.g. exact deferred-module lists) is pointed at, not copied.

- **Schedule/canonical games are the source of truth.** Scores, odds, ownership, standings, archive, insights, and UI attach to schedule-derived canonical `AppGame`s — no parallel game-identity construction.
- **Team identity resolution goes through `src/lib/teamIdentity.ts`** — no duplicate/raw-label matching elsewhere. (Roster fuzzy matching stays in the CSV upload layer only.)
- **Current-season ownership attribution flows through `src/lib/gameOwnership.ts`** — no duplicated ownership-resolution logic or raw provider-label owner equality on current-season paths. Two *separate* known deferrals exist (do not conflate): normalized ownership-**key** indexing (`PLATFORM-040`) and the historical/archive surfaces that still raw-label match. Both are known, not fresh violations — see `AGENTS.md` Core rule #11 for the authoritative deferral list and exact modules.
- **League password access is separate from Clerk/admin authorization.** Clerk provides identity + app roles; the league password gate (`LEAGUE_AUTH_SECRET`) only unlocks a passworded league's pages and grants no role. See `AGENTS.md` → Auth Architecture Invariants and `docs/deployment-runbook.md`.
- **CSV is not the default current-season ownership path** — draft/team-assignment is; current-season CSV import is explicit admin repair. CSV is never a game-identity source. (See `AGENTS.md` Core rule on CSV — honest transitional state noted there.)

If a proposed solution conflicts with any `AGENTS.md` guardrail, flag it explicitly before proceeding. Quota discipline (CFBD ~1000/mo, Odds ~500/mo, cache-first) and admin-only refresh of season-persistent data also remain binding — see `AGENTS.md`.

---

## Common commands

- `npm run dev` — start Next.js dev server (localhost:3000)
- `npm run build` — production build
- `npm run lint` — fast scoped ESLint + Prettier (skips tests/data); use during local iteration only
- `npm run lint:all` — full-project lint including test files; **always run this before pushing** — it is what Vercel runs, and `npm run lint` will miss violations in test files
- `npm run lint:fix` — auto-fix on the fast scope
- `npx tsc --noEmit` — type-check
- `npm test` — full test suite via `node:test` + `tsx` loader; tests live in `src/**/__tests__/`
- Run a single test: `node --import tsx --test src/path/to/__tests__/file.test.ts`
- `npm run fetch:teams` — regenerate `src/data/teams.json` from CFBD

There is no Vitest/Jest config — test runner is Node's built-in. There is no CI workflow checked in; `npm run lint:all` is the intended pre-merge gate.

**Full `npm test` is now a valid gate.** The historical Overview-related hang was fixed under the `TEST-SUITE-BASELINE-CLEANUP` arc, so the full suite runs deterministically to completion. Running only the scoped test files relevant to your change (plus selector tests in `src/lib/selectors/__tests__/`) is still the quickest way to iterate. See `AGENTS.md` → "Verification and reference conventions" for the full convention.

---

## Architecture at a glance

The canonical architecture map (runtime flow, module catalog, selectors, invariants) lives in `AGENTS.md` → **Architecture overview** and `docs/CFB_APP_ARCHITECTURE.md`. Read those rather than a duplicate here. The orientation Claude needs before diagnosing:

- Upstream → downstream flow: CFBD → schedule normalization → canonical game model → identity resolution (`teamIdentity.ts`) → score/odds/ownership attachment → server-derived summaries → client selectors/state → UI. Diagnose in that order (see Debugging order below).
- `getCanonicalStandings` (`src/lib/selectors/leagueStandings.ts`) is the standings source of truth; `LiveDelta` is a client-only overlay never merged with canonical at render time.
- `src/lib/selectors/` is the intended home for cross-surface derived view models. Note (per the PLATFORM-068 audit): a client-side `deriveStandings` path still exists in `CFBScheduleApp.tsx` outside `selectors/`, so treat "all derivation lives in selectors" as the target rule, not a fully-true statement today.

---

## Debugging order

Always diagnose upstream-first:

```
1. API response
2. normalization layer
3. canonical game model
4. attachment layers
5. UI
```

Never start at the UI when an upstream layer may be wrong.

---

## Campaign and task awareness

- Check `AGENTS.md` and `docs/next-tasks.md` for current campaign status before planning work.
- Reference all prior prompts by explicit `PROMPT_ID` — never use vague references like "that earlier prompt."
- When generating a new prompt, verify the candidate ID does not collide with an existing one in `docs/prompt-registry.md`.
- **Current unresolved correctness work** lives in one canonical place: `docs/next-tasks.md` → "Audit-driven correctness + docs sequence" (next item, order, and what's still open). Read it there before planning; do not copy the item statuses into this file (they drift as work ships).

---

## Preview branch

After completing any implementation and pushing to the feature branch, always run the following command before ending the session:

```
git push origin HEAD:preview --force
```

This keeps the `preview` branch current for UI validation on a stable Vercel URL. The `--force` flag is intentional — `preview` is a throwaway testing surface that always reflects the latest work in progress. Never open a PR from `preview`. Never merge `preview` into `main`.
