# CFB App Architecture — Pipeline Sketch

Status: Current (reference)
Last verified: 2026-08-26
Owner: Project documentation
Canonical for: compact provider-cache→canonical-model→UI pipeline reference only
Supersedes: (none)

> Reference sketch, not authority. `AGENTS.md` is canonical for architecture;
> [`docs/architecture/overview.md`](architecture/overview.md) is the fuller current map.

```text
AUTHORIZED REFRESHES (admin / cron; durable-first)

CFBD schedule → schedule adapter → durable schedule cache
                                           ↓
                        normalization + identity resolution
                                           ↓
                                  canonical AppGame
                                           │
       ┌───────────────────────────────────┼───────────────────────────────────┐
       │                                   │                                   │
CFBD scores                         The Odds API                     draft / roster
       ↓                                   ↓                                   ↓
score adapter/cache                  odds adapter/cache                  gameOwnership
       │                                   │                                   │
       └────────────────────── attach as overlays ─────────────────────────────┘
                                           │
                     schedule media / venue presentation overlay
                                           ↓
                            selectors / focused components
                                           ↓
                                           UI
```

The CFBD schedule defines the game universe. Scores, odds, current-season ownership, and
presentation data attach to those schedule-derived games; none creates a parallel game identity.
Member/public API reads are cache-only. Only authorized admin and cron refreshes contact providers,
and provider data is committed durably before process-local caches are updated.

Game stats attach to the same canonical model (PLATFORM-086H3E, active):

```text
CFBD /games/teams
   ↓
strict parse → H2 durable merge (under `active` writer control)
   ↓
evidence projection keyed to the canonical schedule (never a new game identity)
   ↓
owner analytics / Insights → UI
```
