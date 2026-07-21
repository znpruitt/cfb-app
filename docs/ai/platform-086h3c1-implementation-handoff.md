# PLATFORM-086H3C1 — Canonical Game-Stats Evidence Read Model

> **REVISED — CFBD-ID ATTACHMENT AUTHORITY (PLATFORM-086H3C1-CFBD-ID-AUTHORITY-REVISION-v1).**
> A **unique canonical CFBD game ID** establishes which scheduled game a durable
> row belongs to (association). **Participant data determines orientation and
> integrity; it is not a coequal attachment authority.** The consequences, which
> supersede the participant-as-coequal wording throughout the sections below:
>
> - Association is by the game's own CFBD id + partition agreement — not by
>   participant resolution.
> - A supported row whose participants cannot be **fully** resolved stays
>   attached and can satisfy/publish, marked `unverified` (id authority).
> - Only a **known** contradiction — BOTH canonical and BOTH row participants
>   fully resolved and matching neither the direct nor reversed pair — is
>   **quarantined** (`contradicted`): it can never satisfy coverage, publish, or
>   shadow/replace prior-good evidence, and yields an `identity-mismatch` gap.
> - An **exact reversed pair** is safely reoriented for **neutral OR non-neutral**
>   games; non-neutral reversal keeps a retained `reversed-warning` integrity flag.
> - A same-id unsupported / malformed / bad-fence schema **blocks weaker siblings
>   from its id alone**, with no participant resolution required.
> - The evidence decision distinguishes three axes: **association** (by id),
>   **orientation** (direct/reversed), and **usability/integrity** (verified /
>   unverified / reversed-warning / contradicted).
> - Applicability no longer defers a game merely because a canonical participant
>   slot is unsettled: only a **full placeholder shell** (no known team on either
>   side) defers; a half-set matchup or unresolved-but-present pair is an
>   addressable expected game whose rows attach `unverified`.

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
- The authority must return the selected canonically oriented row, its provenance, typed conflicts or blockers, and any shadowed candidates.
- Coverage and projections must not compose fields from multiple rows.
- Component-level evidence composition remains exclusively owned by the existing durable merge service; C1 does not activate or call that service.
- Refactor the existing analytics duplicate selector so analytics becomes projection-only behind the shared authority. Do not retain a second callable duplicate authority.
- Extract or reuse one strict RFC 3339 observation-fence parser shared with the existing merge implementation; do not implement a second freshness parser.

### Coverage and projections

- Evaluate coverage from the supplied committed durable weekly record, not from a provider response or unconfirmed write result.
- Each expected game must resolve to exactly one typed state: `satisfied`, `absent`, `incomplete`, `identity-mismatch`, `duplicate-conflict`, `blocked-unsupported-schema`, or `manual-only` where historical compatibility policy requires it.
- Partition states are `not-applicable`, `complete`, `partial`, `absent`, `blocked`, or `manual-only`.
- Report pending games, deferred placeholders (full shells only), unmatched stored IDs, quarantined participant contradictions, unassociated (partition-disagreeing) rows, integrity warnings (unverified / reversed-warning winners), shadowed lower-precedence evidence, and duplicate conflicts separately.
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
- Add focused unit tests for canonical expectations, attachment, orientation, evidence selection, coverage, projection, and dormancy.
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

- Association is by the unique canonical CFBD game ID plus partition agreement. Provider game ID alone still never authorizes _persistence_, and a row must carry _usable, non-contradicted_ evidence to satisfy coverage or publish — but a matching id (not participant agreement) is what associates a row with a scheduled game, and a matching-id unsupported/malformed schema blocks by id alone.
- Canonical schedule membership associates a row; participant agreement governs its orientation and integrity, and only a **known contradiction** (fully-resolved wrong pair) bars it from affecting the game.
- All team matching goes through `teamIdentity.ts`.
- Postseason provider week and canonical week remain distinct; C1 must not bypass the established canonical-week calculation.
- Schema blocking is evaluated from id + schema without participant resolution; participant validation (orientation/integrity/contradiction) is assessed for supported, non-blocking rows before duplicate selection.
- Evidence selection is row-level; read-time field composition is forbidden.
- Coverage, public projection, and analytics projection consume the same evidence decision, including its association/orientation/integrity axes.
- Projection-specific field eligibility may differ, but evidence winner and conflict classification may not.
- Every coverage-satisfied game must produce a public row.
- Compatible legacy rows remain valid evidence and do not trigger automatic migration.
- Sparse v2 evidence cannot displace complete valid evidence.
- Unsupported or malformed authoritative schema is never silently laundered through a weaker sibling.
- Unscheduled stored rows (unmatched id), quarantined participant contradictions, and rows whose own partition disagrees are retained as separate reports and never count as coverage.
- A row whose participants cannot be fully verified stays attached as `unverified` (it may satisfy/publish with the caveat surfaced); a fully-resolved participant contradiction is quarantined and never satisfies, publishes, or shadows prior-good evidence.
- Public output never exposes schema, fence, transaction, recovery, or other internal persistence metadata; integrity/quarantine are surfaced only as availability counts, never as per-row internal metadata.
- C1 remains dormant until a later activation change explicitly connects production consumers.

## Evidence precedence and freshness

### Selection order

For each expected canonical game (candidates are the rows sharing the game's CFBD id):

1. Associate by the game's id + partition agreement (a row whose own partition disagrees is unassociated).
2. Apply matching unsupported/malformed/bad-fence schema blockers **from id + schema alone** — no participant resolution.
3. For supported, non-blocking rows, orient and assess integrity (verified / unverified / reversed-warning); quarantine known contradictions.
4. Rank usable (non-quarantined) candidates by evidence sufficiency:
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

Compare canonically oriented, explicitly publishable row content while excluding only observation-order and internal metadata.

The comparison includes:

- provider game ID;
- canonical participant orientation;
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

The unsupported row does **not** block, and is treated as unassociated, only when:

- its provider ID is unscheduled (matches no expected canonical game); or
- its row-level partition fields contradict the requested partition.

Participant absence, malformedness, or non-resolution does **not** exempt an unsupported row from blocking — the id is sufficient. If schedule or identity context is unavailable, report coverage as unavailable rather than treating the row as unmatched. Other supported-but-incomplete rows (sparse v2 with a valid fence) remain recoverable.

## Neutral-site rules

### Attachment decision

- Prefer direct orientation when both fully-resolved sides match the canonical home and away participants (integrity `verified`).
- An exact reversed pair (both sides fully resolved, matching the reversed canonical pair) is reoriented for **neutral or non-neutral** games; neutral reversal is `verified`, non-neutral reversal retains a `reversed-warning` integrity flag.
- When a canonical or row participant does not fully resolve, the id still associates the row: it attaches in its stored orientation, marked `unverified`, and no reorientation is guessed from partial information.
- A **fully-resolved** pair matching neither the direct nor the reversed canonical pair (including a same-identity row pair) is a known contradiction: quarantine it (`contradicted`); it never satisfies, publishes, or shadows prior-good evidence.

### Reorientation behavior

Move each complete team-side object atomically. The following fields travel with their team:

- `school`, `schoolId`, `conference`;
- `points`, `pointsProvided`;
- `totalYards`, `rushingYards`, `passingYards`;
- `rushingAttempts`, `passingAttempts`, `passingCompletions`;
- `rushingTDs`, `passingTDs`, `firstDowns`;
- `turnovers`, `fumblesLost`, `interceptionsThrown`;
- `passesIntercepted`, `fumblesRecovered`;
- `thirdDownAttempts`, `thirdDownConversions`, `thirdDownPct`;
- `fourthDownAttempts`, `fourthDownConversions`;
- `penaltyCount`, `penaltyYards`, `possessionSeconds`;
- `interceptionReturnYards`, `interceptionReturnTDs`;
- `kickReturnYards`, `kickReturnTDs`;
- `puntReturnYards`, `puntReturnTDs`; and
- the complete `raw` category map.

After swapping, rewrite only the orientation marker:

- canonical home receives `homeAway: 'home'`;
- canonical away receives `homeAway: 'away'`.

Do not change game-level `providerGameId`, `week`, `seasonType`, `schemaVersion`, or `fetchStartedAt`. Do not overwrite provider school, school ID, or conference values with schedule values. Do not negate, invert, or recompute statistics during orientation.

Incoming observations must be oriented before duplicate comparison. Existing reversed legacy rows receive a non-mutating oriented read view; C1 must not eagerly rewrite durable bytes.

## Acceptance criteria

### Canonical expectations

- Aggregate and partition-only schedule layouts produce identical expectations.
- Regular and postseason provider weeks map correctly without bypassing canonical week construction.
- Completed, pending, disrupted, placeholder, and excluded games classify correctly.
- FCS-versus-FCS games are not expected.
- Schedule, catalog, alias, and canonical-build failures remain unavailable rather than absence.
- Arbitrary provider labels cannot create identity authority.

### Association, orientation, and integrity

- Matching provider ID with fully-resolved matching participants attaches, `verified`.
- Alias-resolved participants attach through `teamIdentity.ts`.
- Unscheduled IDs do not associate; a row whose own partition disagrees is unassociated.
- Correct provider ID with a fully-resolved WRONG pair is quarantined (`contradicted`) → identity-mismatch, never coverage.
- An unresolved row or canonical participant stays attached, marked `unverified`, and may satisfy/publish with the caveat surfaced.
- Reversed non-neutral observations are reoriented with a `reversed-warning`; reversed neutral observations are reoriented, `verified`.
- Reorientation happens only for an exact reversed pair; every listed team-side field moves with its team and every game-level field remains unchanged.
- Existing reversed legacy rows can be oriented without durable mutation.

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

- A same-id unsupported row blocks a valid supported sibling.
- The same provider ID blocks regardless of participant resolution — mismatched OR unresolved participants still block (id authority).
- An unsupported row in the wrong partition (or with an unscheduled id) does not block and is unassociated.
- Identity-context failure makes coverage unavailable.
- A schema-2 row with a missing/invalid observation fence blocks.

### Coverage and projection

- Missing expected games are absent.
- Mixed satisfied and missing games produce partial coverage.
- A fully-resolved participant contradiction produces an identity-mismatch gap and is quarantined.
- An unresolved-participant row still satisfies (id authority) and is flagged `unverified` in the coverage/availability report.
- Divergent authoritative duplicates produce a duplicate-conflict gap.
- Matching unsupported schema produces a blocked gap.
- Pending games do not produce gaps.
- Unmatched stored rows never count as coverage.
- A canonical participant change to a fully-resolved conflicting pair invalidates stale stored coverage (quarantined).
- Every coverage-satisfied game appears in the public projection.
- Sparse public rows remain marked incomplete and are excluded from analytics.
- Public projection removes internal metadata and unrecognized raw categories; integrity/quarantine surface only as availability counts.
- Malformed envelopes, read failures, partition mismatches, and genuine absence remain distinct.

### Dormancy and verification

- Recursive guards prove that no live route, cron, diagnostics, cache-state, Insights, debug, or UI consumer imports C1.
- Focused contract, evidence, coverage, projection, and dormant-boundary suites pass.
- `npx tsc --noEmit` passes.
- `npm run lint:all` passes.
- `npm test` passes.
- `git diff --check` passes.
