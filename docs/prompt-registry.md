# Prompt Registry

## Purpose

Track important Codex prompts used in this project so they can be referenced, revised, and reused cleanly.

## Header format (required)

Every new Codex prompt for this project should begin with:

```text
PROMPT_ID: <PHASE>-<AREA>-<SHORT_NAME>-v<version>
PURPOSE: <one-line objective>
SCOPE: <explicit boundaries for files/features>
```

Example:

```text
PROMPT_ID: P2B-LEAGUE-INTELLIGENCE-v1
PURPOSE: Add league intelligence layer with compact insights and ranked-game highlighting
SCOPE: OverviewPanel + leagueInsights.ts only (no API changes)
```

## ID format

`<PHASE>-<AREA>-<SHORT_NAME>-v<version>`

Examples:

- `P2A-CLOSEOUT-HARDENING-v1`
- `P2B-OVERVIEW-UI-UPGRADE-v1`
- `P2B-LEAGUE-SUMMARY-HERO-v1`
- `P2B-LEAGUE-INTELLIGENCE-v1`
- `DOCS-PROMPT-GOVERNANCE-v1`

## Rules

- IDs should be human-readable, stable, and easy to reference later.
- Bump the version when behavior or scope changes materially.
- Minor wording-only edits may keep the same version if task intent does not materially change.
- In later discussion, reference prompts by explicit `PROMPT_ID` (avoid vague references like “that earlier prompt”).

Preferred examples:

- `Update P2B-LEAGUE-INTELLIGENCE-v1 to refine badge priority.`
- `Use P2A-CLOSEOUT-HARDENING-v1 as the baseline.`

## Registry

- `P2A-CLOSEOUT-HARDENING-v1`
- `P2B-OVERVIEW-UI-UPGRADE-v1`
- `P2B-LEAGUE-SUMMARY-HERO-v1`
- `P2B-LEAGUE-INTELLIGENCE-v1`
- `DOCS-PROMPT-GOVERNANCE-v1`
