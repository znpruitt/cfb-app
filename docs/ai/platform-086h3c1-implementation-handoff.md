# PLATFORM-086H3C1 — Canonical Game-Stats Evidence Read Model

> **SIMPLIFIED — PLATFORM-086H3C1-SIMPLIFICATION-v1.** C1 is scoped to the
> evidence authority that is meaningful with today's persisted data. The **unique
> canonical CFBD game ID + partition agreement is the whole association
> authority**. **Numeric participant validation was removed** — schedule records
> do not yet persist the numeric participant ids (`homeId`/`awayId`) that would
> make it operational, so it is deferred as a **separate pre-activation
> prerequisite** (after schedule persistence captures those ids). This supersedes
> the participant-validation / integrity / quarantine / `reversed-warning` /
> numeric-id wording throughout the sections below:
>
> - Association is the game's own CFBD id + partition agreement. **Duplicate
>   canonical game ids are rejected as a canonical-build failure** (never an
>   ambiguous slate that reuses one row for two games).
> - A same-id unsupported / malformed / bad-fence schema **blocks weaker siblings
>   from its id alone**.
> - Every other schema-supported row is a usable candidate; the winner is chosen
>   by sufficiency (complete v2 > compatible legacy > sparse v2 > defective) and
>   fence freshness, deterministically. **CFBD `homeAway` is trusted — sides are
>   never swapped, and there is no `reorientRow`.** Two rows for the same id that
>   disagree on a side's stored `homeAway` are a `duplicate-conflict`.
> - There is **no participant validation, no `verified`/`unverified`/`contradicted`
>   integrity, no quarantine, no `identity-mismatch` state, and no reorientation**
>   in C1. Coverage states are `satisfied` / `incomplete` / `absent` / `blocked`
>   / `duplicate-conflict` / `manual-only` (historical defective).
> - Only diagnostics with a concrete consumer are surfaced and all are
>   deterministic: `pending`, `deferredPlaceholders`, `unmatchedStoredIds`,
>   `duplicateConflicts`. (`shadowed`, `unassociated`, `quarantined`, and
>   `integrityWarnings` were removed.)
> - Applicability defers only a **full placeholder shell**; a half-set matchup or
>   unresolved-name pair is an addressable expected game.
> - `identity-mismatch` and participant validation RETURN as a later
>   pre-activation prerequisite, once schedule persistence captures numeric
>   participant ids. C1's name-resolved `home`/`away` remain as the display
>   expectation, not validation authority.

## Final objective

Implement a dormant, schedule-authoritative game-stats evidence read model. The canonical schedule must define which games are expected, which participants belong to each game, and their canonical orientation. One shared evidence authority must then select durable rows for coverage, public projection, and analytics projection without deleting, rewriting, or activating production data.

C1 is complete when a caller can take cached canonical schedule inputs plus a durable weekly game-stats record and derive:

- the canonical weekly expectation;
- typed participant attachment outcomes;
- one deterministic evidence decision per expected game;
- participant-validated weekly coverage; and
- schema-safe public and analytics projections that consume the same evidence decision.

All C1 capabilities must remain production-disconnected.

## Architectural decisions

### Canonical schedule authority

- Read schedule wire items through `loadCachedScheduleItems(year)` so aggregate and partition-only cache layouts behave identically.
- Load teams through `getTeamDatabaseItems()` and league-agnostic effective aliases through `getScopedAliasMap('', year)`.
- Build games through `buildScheduleFromApi`; do not duplicate schedule eligibility, postseason-week, placeholder, or team-matching policy in game-stats code.
- Do not apply league-specific postseason overrides to league-agnostic game-stat evidence.
- Use `ScheduleItem.week` and canonical `AppGame.providerWeek` for the provider partition week, and use the schedule item's explicit season type for the partition.
- Use canonical `AppGame` membership and participant slots to define addressable games and participants.
- Use original schedule kickoff and status fields for applicability because `AppGame` status does not preserve every disrupted provider label.
- A game is expected when its kickoff is at least six hours old and it is not canceled, postponed, suspended, or delayed.
- Upcoming eligible games are pending. Placeholders and games excluded by the canonical schedule are not expected.
- Schedule, catalog, alias, or canonical-build failures are unavailable context, never valid absence.
- Provider attachment identity may be seeded from the catalog, aliases, and canonical schedule participants only. Arbitrary provider labels must not create identity authority.

### One evidence authority

- Add one schedule-aware, row-level evidence authority shared by committed coverage, public projection, and analytics projection.
- The authority must return the selected row (as stored — sides are never swapped), its provenance, and typed conflicts or blockers.
- Coverage and projections must not compose fields from multiple rows.
- Component-level evidence composition remains exclusively owned by the existing durable merge service; C1 does not activate or call that service.
- Refactor the existing analytics duplicate selector so analytics becomes projection-only behind the shared authority. Do not retain a second callable duplicate authority.
- Extract or reuse one strict RFC 3339 observation-fence parser shared with the existing merge implementation; do not implement a second freshness parser.

### Coverage and projections

- Evaluate coverage from the supplied committed durable weekly record, not from a provider response or unconfirmed write result.
- Each expected game must resolve to exactly one typed state: `satisfied`, `absent`, `incomplete`, `duplicate-conflict`, `blocked-unsupported-schema`, or `manual-only` where historical compatibility policy requires it. (`identity-mismatch` returns with participant validation, a later pre-activation prerequisite.)
- Partition states are `not-applicable`, `complete`, `partial`, `absent`, `blocked`, or `manual-only`.
- Report only diagnostics with a concrete consumer, all deterministic: pending games, deferred placeholders (full shells only), unmatched stored IDs, and duplicate conflicts.
- Complete v2 and compatible legacy evidence may satisfy coverage. Sparse v2 evidence is incomplete.
- Public projection may publish complete v2, compatible legacy, and structurally valid sparse v2 rows, but sparse rows must remain visibly incomplete in availability.
- Analytics projection accepts only complete v2 or compatible legacy evidence and must strictly reparse required raw evidence and points.
- Public output must be built from explicit envelope, game, team, and recognized-raw-category allowlists. Never spread persisted objects onto the wire.
- Envelope validation must distinguish genuine absence, durable-read failure, malformed envelope, partition mismatch, invalid `fetchedAt`, and a non-array games payload.

## C1 scope

- Add a focused canonical slate/context module.
- Add a focused evidence-authority module.
- Add a focused partition-coverage module.
- Add a focused public-projection module.
- Adapt H1 analytics projection to consume an already-selected row rather than selecting duplicates.
- Extract a shared strict observation-fence parser if required.
- Extend the recursive dormant-boundary tests so only the named dormant modules may use C1/H1 capabilities and no live production consumer can import them.
- Add focused unit tests for canonical expectations, association (id + partition, duplicate-id rejection), evidence selection, coverage, projection, and dormancy.
- Keep each new library module below approximately 500 lines; do not append substantial new logic to the existing large `contract.ts`.
- Keep all reads cache-only and provider-free.

Expected review surface:

- four new focused production modules;
- two or three small production modifications;
- approximately 800–1,100 production lines;
- approximately 1,000–1,400 test lines; and
- approximately 10–12 changed files before final documentation closeout.

This remains one cohesive PR because canonical expectation, evidence selection, coverage, and projection are four views of the same pure authority. Splitting them would temporarily create multiple participant or duplicate authorities.

## Explicit exclusions

- No provider payload ingestion or payload orchestration.
- No durable merge activation or game-stats writes.
- No live route, cron, diagnostics, cache-state, Insights, debug, or UI integration.
- No writer-control transitions or legacy-writer retirement.
- No recovery claims, leases, backoff, quota policy, candidate rotation, or missing-week orchestration.
- No provider-refresh status publication or finalization.
- No public `/api/game-stats` response change.
- No durable key, scope, or weekly-envelope migration.
- No bulk legacy-row migration.
- No league-specific postseason overrides.
- No provider calls from read or coverage paths.
- No lineage, revision, ledger, high-water, repair, or irreversible-witness machinery.
- No completion claims in governance documentation while review findings remain open.

## Key invariants

- Association is the unique canonical CFBD game ID plus partition agreement — a matching id (not participant identity) is what associates a row with a scheduled game, and a matching-id unsupported/malformed schema blocks by id alone. Provider game ID alone still never authorizes _persistence_.
- Duplicate canonical game ids are rejected as a canonical-build failure — never an ambiguous slate that reuses one durable row for two games.
- All team matching (for the schedule-authoritative expectation) goes through `teamIdentity.ts`.
- Postseason provider week and canonical week remain distinct; C1 must not bypass the established canonical-week calculation.
- Schema blocking is evaluated from id + schema. C1 performs NO participant validation; every schema-supported, partition-agreeing row is a usable candidate.
- Evidence selection is row-level; read-time field composition is forbidden.
- CFBD `homeAway` is trusted — sides are never swapped — and two same-id rows disagreeing on a stored `homeAway` designation are a `duplicate-conflict`.
- Coverage, public projection, and analytics projection consume the same evidence decision.
- Projection-specific field eligibility may differ, but evidence winner and conflict classification may not.
- Every coverage-satisfied game must produce a public row.
- Compatible legacy rows remain valid evidence and do not trigger automatic migration.
- Sparse v2 evidence cannot displace complete valid evidence.
- Unsupported or malformed authoritative schema is never silently laundered through a weaker sibling.
- Stored rows whose id matches no scheduled game are reported as unmatched and never count as coverage.
- Public output never exposes schema, fence, transaction, recovery, or other internal persistence metadata.
- C1 remains dormant until a later activation change explicitly connects production consumers.

## Evidence precedence and freshness

### Selection order

For each expected canonical game (candidates are the rows sharing the game's CFBD id):

1. Associate by the game's id + partition agreement (a row whose own partition disagrees is not evidence for this game).
2. Apply matching unsupported/malformed/bad-fence schema blockers **from id + schema alone**.
3. Every other schema-supported row is a usable candidate (no participant validation; sides are never swapped).
4. Rank usable candidates by evidence sufficiency:
   1. complete v2;
   2. compatible legacy;
   3. sparse v2;
   4. defective or ineligible evidence.
5. Apply freshness only among v2 candidates in the same sufficiency class.

### Freshness rules

- A newer lower-sufficiency row never displaces higher-sufficiency valid evidence.
- Within the same v2 sufficiency class, the candidate with the newest valid strict-RFC-3339 `fetchStartedAt` wins.
- Equal-fence equivalent v2 candidates collapse.
- Equal-fence divergent v2 candidates create a duplicate conflict.
- A missing or malformed v2 fence is blocked because the row cannot be ordered or safely overwritten.
- Legacy candidates have no row-level freshness.
- Partition `fetchedAt` must never order duplicate legacy rows.
- Equivalent legacy candidates collapse; divergent legacy candidates conflict.
- Array order must never affect selection.

### Evidence equivalence

Compare the as-stored, explicitly publishable row content (sides are never swapped) while excluding only observation-order and internal metadata.

The comparison includes:

- provider game ID;
- each side's `homeAway` designation as stored;
- provider participant labels and school IDs;
- public conference fields;
- points and points-evidence state;
- every explicit public normalized field; and
- recognized raw categories.

The comparison excludes:

- `fetchStartedAt`;
- transaction, recovery, or persistence metadata; and
- unrecognized raw categories that carry no contract authority.

This conservative comparison prevents analytics equivalence from hiding a disagreement that would alter public output.

## Unsupported-schema rules

An unsupported or malformed stamped schema blocks supported siblings from the **canonical CFBD game id alone** — the row associates by id and its statistical fields are never interpreted, so blocking does **not** require participant resolution.

Blocking requires:

- agreement with the requested weekly partition; and
- a positive provider ID matching the expected canonical game (unsupported-version / malformed-v2 / a schema-2 row whose observation fence is missing or invalid).

When these hold:

- classify the game as `blocked-unsupported-schema`;
- do not fall back to a legacy or supported-v2 sibling; and
- do not classify the game as automatically recoverable.

The unsupported row does **not** block only when:

- its provider ID is unscheduled (matches no expected canonical game); or
- its row-level partition fields contradict the requested partition.

The id is sufficient for blocking — participant identity is not consulted. If schedule or identity context is unavailable, report coverage as unavailable rather than treating the row as unmatched. Other supported-but-incomplete rows (sparse v2 with a valid fence) remain recoverable.

## Participant validation (DEFERRED)

C1 performs **no participant validation**. CFBD `homeAway` is trusted — sides are
never swapped, there is no reorientation, and neutral-site status is irrelevant.
A schema-supported, partition-agreeing row for an expected game id is a usable
candidate regardless of its stored participant labels.

Numeric participant validation (validating a stored row's `schoolId`s against the
schedule's numeric `homeId`/`awayId`, and the `identity-mismatch` gap it produces)
is a **separate pre-activation prerequisite**, gated on schedule persistence first
capturing numeric participant ids — the current schedule cache-write path does not
persist them. Adding that persistence, and re-introducing validation, is out of
scope for C1. C1's name-resolved `home`/`away` participants remain only as the
schedule-authoritative display expectation, not a validation authority.

## Acceptance criteria

### Canonical expectations

- Aggregate and partition-only schedule layouts produce identical expectations.
- Regular and postseason provider weeks map correctly without bypassing canonical week construction.
- Completed, pending, disrupted, placeholder, and excluded games classify correctly.
- FCS-versus-FCS games are not expected.
- Schedule, catalog, alias, and canonical-build failures remain unavailable rather than absence.
- Arbitrary provider labels cannot create identity authority.

### Association (id + partition)

- A matching game ID + partition selects a schema-usable row as-stored (no swap, no participant validation).
- Duplicate canonical game ids are rejected as a canonical-build failure (the pure builder throws; the loader reports `canonical-build-failed`).
- A row whose own partition fields disagree is not evidence for the game.
- Unscheduled stored ids are reported as unmatched, never coverage.
- Two same-id rows disagreeing on a stored `homeAway` designation produce `duplicate-conflict`.
- No C1 result exposes `reversed`, `reversed-warning`, `reversedWarning`, `integrity`, `quarantined`, `unassociated`, or `shadowed`, and no reorientation helper remains callable.

### Evidence authority

- Complete v2 outranks compatible legacy.
- Compatible legacy outranks sparse v2.
- Newer sparse evidence cannot displace complete evidence.
- Same-class newer v2 evidence wins.
- Equal-fence equivalent v2 candidates collapse.
- Equal-fence divergent v2 candidates conflict.
- Missing or invalid v2 fences block.
- Equivalent legacy duplicates collapse and divergent legacy duplicates conflict.
- Selection is invariant to candidate order.
- A difference in any explicit public field cannot be hidden by analytics-only equivalence.

### Unsupported schema

- A same-id, same-partition unsupported row blocks a valid supported sibling — by id alone.
- An unsupported row in the wrong partition (or with an unscheduled id) does not block.
- Identity-context failure makes coverage unavailable.
- A schema-2 row with a missing/invalid observation fence blocks.

### Coverage and projection

- Missing expected games are absent.
- Mixed satisfied and missing games produce partial coverage.
- A schema-usable row for an expected game id satisfies (participant validation deferred).
- Divergent authoritative duplicates produce a duplicate-conflict gap.
- Matching unsupported schema produces a blocked gap.
- Pending games do not produce gaps.
- Unmatched stored rows never count as coverage.
- Every coverage-satisfied game appears in the public projection.
- Sparse public rows remain marked incomplete and are excluded from analytics.
- Public projection removes internal metadata and unrecognized raw categories.
- Malformed envelopes, read failures, partition mismatches, and genuine absence remain distinct.

### Dormancy and verification

- Recursive guards prove that no live route, cron, diagnostics, cache-state, Insights, debug, or UI consumer imports C1.
- Focused contract, evidence, coverage, projection, and dormant-boundary suites pass.
- `npx tsc --noEmit` passes.
- `npm run lint:all` passes.
- `npm test` passes.
- `git diff --check` passes.
