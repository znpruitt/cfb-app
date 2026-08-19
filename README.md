# CFB App

Status: Current
Last verified: 2026-07-26
Owner: Project documentation
Canonical for: repository onboarding — what this app is, how to run it, and where the authoritative docs live
Supersedes: (none — replaces the original create-next-app boilerplate)

A hosted, league-first dashboard for a college-football office pool, built with
[Next.js](https://nextjs.org) (App Router) and React. League members get a
stable place to check the current league picture, weekly matchups, standings,
owner insights, and live context without commissioner intervention.

The app is **API-first**: [CollegeFootballData (CFBD)](https://collegefootballdata.com)
is the source of truth for schedule and scores (and the sole normal production
score provider), and [The Odds API](https://the-odds-api.com) is the source of
truth for betting odds. The **schedule is the canonical game universe** — all
score, odds, ownership, standings, and analytics attachment respects
schedule-derived canonical games; nothing constructs a parallel game identity.

## Architecture & source of truth

Read the canonical docs before making changes — do not infer architecture from
this README:

- **[`AGENTS.md`](AGENTS.md)** — canonical for code architecture, the binding
  engineering/architecture invariants, and agent operating rules. **Start here.**
- **[`DESIGN.md`](DESIGN.md)** — canonical for UI/UX and the design system. Read
  before any UI work.
- **[`docs/README.md`](docs/README.md)** — the full documentation map: which doc
  owns what, plus lifecycle/status conventions.

Upstream → downstream flow: CFBD provider schedule → schedule normalization +
team-identity resolution (`src/lib/teamIdentity.ts`) → canonical game model
(`AppGame`) → score and odds attachment → durable game-stat evidence
evaluation/projection against canonical games → ownership / standings /
analytics → UI. Identity resolution happens _during_ canonical construction
(`buildScheduleFromApi`) through the centralized team-identity layer; the
schedule is the source of truth. Scores and odds attach onto the canonical
`AppGame`, whereas durable game-stat evidence is evaluated and projected against
canonical games (it is not stored inline on `AppGame`) and never creates a
parallel game identity. Diagnose upstream-first, in that order.

Source entrypoints: the App Router routes live under `src/app/` (the root page
is `src/app/page.tsx`, the root layout is `src/app/layout.tsx`); shared logic
lives under `src/lib/` (cross-surface derived view models in
`src/lib/selectors/`); UI components under `src/components/`.

## Getting started

Requires Node.js and npm. Set the provider/auth environment variables described
in the deployment docs (see below) before running against live data — no secrets
are reproduced here.

```bash
npm install        # install dependencies
npm run dev        # start the dev server at http://localhost:3000
```

## Common commands

All commands are defined in [`package.json`](package.json):

- `npm run dev` — start the Next.js dev server (localhost:3000).
- `npm run build` — production build.
- `npm start` — serve the production build.
- `npm test` — full test suite (Node's built-in test runner via the `tsx`
  loader). Executable tests live under the nearest `__tests__/`; the full glob
  is deliberately broader so a misplaced test cannot silently disappear.
- `npm run test:file -- <path-or-glob...>` — run one or more exact test files or
  globs with the same isolation, TypeScript config, and timeout as the full
  suite. Exact App Router paths containing `[brackets]` are handled literally.
- `npm run test:lib`, `npm run test:api`, and `npm run test:components` — focused
  subsystem slices for local iteration; they overlap with and do not partition
  the full suite.
- `npm run lint` — fast, scoped ESLint + Prettier + markdown lint for local
  iteration (skips test/data paths).
- `npm run lint:all` — full-project lint (includes test files). **Run this
  before pushing** — it is the intended pre-merge gate.
- `npm run lint:fix` — auto-fix on the fast scope.
- `npx tsc --noEmit` — type-check.
- `npm run fetch:teams` — regenerate `src/data/teams.json` from CFBD.

To run a single test file with the same environment as the full suite:

```bash
npm run test:file -- src/path/to/__tests__/file.test.ts
```

See `AGENTS.md` → "Verification and reference conventions" and
[`CLAUDE.md`](CLAUDE.md) for the full linting/testing workflow.

## Deployment & environment

The app deploys on Vercel. The high-level deploy/env/auth-secret/cron overview is
[`docs/operations/deployment.md`](docs/operations/deployment.md); the detailed
step-by-step operator checklist is
[`docs/deployment-runbook.md`](docs/deployment-runbook.md). Those docs enumerate
the required environment variables (CFBD/Odds API keys, Clerk auth, the league
password gate, and `CRON_SECRET`) and the operational procedures — configure the
actual secret values through your hosting provider, never in the repository.
