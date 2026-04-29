# CLAUDE.md

Claude Code-specific companion to `AGENTS.md`. Read `AGENTS.md` first — this file adds Claude-specific context only and does not restate shared project operating content.

---

## Role on this project

Claude's role is **AI Architect / Debug Analyst**, not implementation engine.

Responsibilities:
- diagnose issues
- design solutions
- generate Codex prompts
- review implementations
- ensure architectural consistency

Codex handles implementation. Claude generates the prompts Codex executes.

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

Never recommend or generate prompts that violate:

- **Schedule-first game identity** — all game identity flows from the schedule; no parallel matching systems.
- **Centralized team matching** — all team matching through `src/lib/teamIdentity.ts`; no duplicate logic elsewhere.
- **API-first ingestion boundaries** — CFBD for schedule/scores, The Odds API for odds; no raw provider shapes in UI state.
- **Admin-only refresh semantics** — season-persistent data updates only via commissioner/admin flows, never from public traffic.
- **Quota-conscious API usage** — CFBD ~1000/month, Odds API ~500/month; cache-first, no wasteful polling.

If a proposed solution conflicts with any of these, flag it explicitly before generating a Codex prompt.

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

---

## Architecture at a glance

Claude should know the data flow shape before diagnosing:

- `src/components/CFBScheduleApp.tsx` — top-level orchestrator only; no parsing/matching logic
- `src/app/api/{schedule,scores,odds,teams,aliases}/` — provider adapter routes; normalize CFBD/Odds API shapes
- `src/lib/teamIdentity.ts` — single entry point for runtime team matching
- `src/lib/schedule.ts` + `src/lib/scoreAttachment.ts` — canonical game model + score attachment (postseason-week-aware)
- `src/lib/selectors/` — **single source of derived truth** for standings, insights, trends, matchups, momentum. Pure functions. Any league derivation outside this directory is an architecture violation
- `src/lib/selectors/leagueStandings.ts` — exports `getCanonicalStandings` (cached server canonical) and `invalidateStandings` (tag invalidation). `LiveDelta` overlay computed client-side via `selectLiveDelta` / `useLiveDelta` and never merged with canonical at render time
- Static data: `src/data/teams.json` (canonical) + `src/data/alias-overrides.json` only

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

---

## Preview branch

After completing any implementation and pushing to the feature branch, always run the following command before ending the session:

```
git push origin HEAD:preview --force
```

This keeps the `preview` branch current for UI validation on a stable Vercel URL. The `--force` flag is intentional — `preview` is a throwaway testing surface that always reflects the latest work in progress. Never open a PR from `preview`. Never merge `preview` into `main`.
