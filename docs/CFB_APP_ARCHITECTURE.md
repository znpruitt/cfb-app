# CFB App Architecture — Pipeline Sketch

Status: Current (reference)
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: quick upstream→downstream pipeline reference only
Supersedes: (none)

> Reference sketch, not authority. `AGENTS.md` is canonical for architecture; [`docs/architecture/overview.md`](architecture/overview.md) is the fuller current map (this is its one-line version).

```text
CFBD API
   ↓
schedule normalization + identity resolution
   ↓
canonical AppGame model
   ↓
scores attachment
   ↓
odds attachment
   ↓
UI rendering
```
