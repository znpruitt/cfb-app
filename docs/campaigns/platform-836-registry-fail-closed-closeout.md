# PLATFORM-836 — a malformed registry read as empty, and one path wrote over it (closeout)

Status: **MERGED `46962b3e`** ([PR #885](https://github.com/znpruitt/cfb-app/pull/885)) 2026-10-05; #836 closed. **NOT LIVE until promoted** — auto-promotion is off. Tree-hash verified identical to the gated commit (`aa988599`), so the tree that landed is the one every gate ran against.
Issue: [#836](https://github.com/znpruitt/cfb-app/issues/836).
Prompt: `docs/prompts/platform-836-registry-fail-closed-claude-v1.md`
(`PROMPT_ID: PLATFORM-836-REGISTRY-FAIL-CLOSED-CLAUDE-v1`).
Branch: `claude/836-registry-fail-closed`, cut off `origin/main` at `2ed2d883`; `origin/main` merged
in at `52a31b2b`, which is the merge-base every review used.

**No deployment claimed.** Auto-promotion is off. `preview` was deliberately not taken: the UI lane
held it for #669, and this branch has no rendered change to click through.

Follow-ups filed, none of them closed by this branch: [#881](https://github.com/znpruitt/cfb-app/issues/881),
[#882](https://github.com/znpruitt/cfb-app/issues/882), [#883](https://github.com/znpruitt/cfb-app/issues/883),
[#884](https://github.com/znpruitt/cfb-app/issues/884).

---

## What shipped

Two enforcement points for one rule, because the registry contained both the guard and its
violation twenty lines apart.

`mutateRegistry` repeated the exact collapse `readLeagueRegistry`'s own docblock calls *"the
collapse this reader exists to prevent"*:

```ts
const leagues = Array.isArray(record?.value) ? record.value : [];
```

Under a corrupt registry every mutator therefore ran against a fabricated empty array, and
`addLeague` was the one that then **wrote**: its in-transaction duplicate check passed vacuously,
`[...leagues, league]` evaluated to `[league]`, and `txn.write` replaced the corrupt value with a
valid single-entry array. That converts a recoverable corruption — the bad bytes still on disk,
inspectable and repairable — into an unrecoverable registry that `readLeagueRegistry` reports `ok`,
with every other league's rosters, drafts and archives surviving under their slugs and unreachable.

| change | file |
| --- | --- |
| Classify the container and throw `LeagueRegistryMalformedError` on a present non-array | `src/lib/leagueRegistry.ts` |
| Read the classified container before the duplicate-slug check; refuse with a message that distinguishes "cannot determine" from "already exists" | `src/app/api/admin/leagues/route.ts` |
| Return a typed refusal instead of letting the throw reach the redaction boundary | `src/app/admin/[slug]/actions.ts` |

`getLeagues()` is **untouched**. 69 modules depend on its array contract, and its contract pin
already existed — `leagueRegistry.readRegistry.test.ts` → `'R1 contract pin: getLeagues() still
returns [] for absent AND malformed registries'`. Cited, not duplicated, by owner ruling.

## 1. Absent is not malformed, and that is the whole fix

The guard is keyed on `record !== null && !Array.isArray(record.value)` — the same classification
`readLeagueRegistry` performs, so one rule has two enforcement points rather than two rules.

A `null` record is a genuine first-run absence and still yields `[]`. Without that split the guard
would refuse the first league in a fresh store and break roughly thirty test files that seed through
`addLeague`. Two positive controls pin it: `'an ABSENT registry still creates the first league'` and
`'a stored empty array still creates a league'`.

## 2. Why the guard sits in `mutateRegistry` and not in `addLeague`

F2H1SB's principle, already applied in this repo to authorization: routing is never the authority,
and neither is one call site. `addLeague` is the only writer **today** — its sole production caller
is `POST /api/admin/leagues` — so a guard there would be sufficient and would silently stop being
sufficient at the next mutator added.

**The prompt's stated reason for this was wrong and the owner accepted the correction before any code
was written.** It said the destructive half was *"reachable by any other caller of `addLeague`"*.
There is no other production caller; the ~30 other call sites are all tests. The argument is the
structural one above, not an existing second caller. Recording it because a closeout repeating the
prompt's version would have put a false claim in a ledger.

## 3. The five other mutators were safe by accident

`updateLeague`, `guardedLifecycleWrite`, `completeSeasonRollover`, `clearLeaguePassword` and
`removeLeague` all reached `findIndex(...) === -1` on the fabricated array and returned their
league-not-found result. They wrote nothing — but they found nothing in an array that was not the
registry, and they answered a corrupt registry with a confident *"that league does not exist"*.
They now refuse.

`removeLeague` additionally handed its caller `[]` **as the registry contents**, which
`admin/leagues/[slug]/route.ts` serialized back to the operator as the post-delete league list.

Where the throw is reachable is carried by three tests and by no count in any comment — see §6.

## 4. The masking interaction the prompt did not have

Raised in the read receipt, accepted as binding.

`findResidualLeagueScopes` scans durable scopes independently of the registry, so under a malformed
container **it fires anyway** for any slug whose previous occupant left data, and the 409 residue
refusal masks the fail-open before `addLeague` is reached. It does **not** mask the
`adoptExistingData` path — and that is the path this route's own refusal text instructs the operator
to take: *"If this is the SAME league being restored, re-submit with 'adopt existing data' to
proceed."*

So the realistic sequence is: operator creates a slug, hits the residue refusal, follows its
instruction, and the create proceeds against a registry nobody could read — where the destructive
registry overwrite is not masked at all.

Two consequences, both discharged:

- That is the case to fix, so the container check sits **before** the residue survey and the adopt
  decision rather than merely replacing the duplicate check in place.
- **A test asserting "creation succeeds under malformed" proves nothing unless it controls residual
  state.** The prompt's false-green warning pointed one layer shallower than the real one. The two
  route tests are therefore deliberately separate: `'creation refuses a malformed registry instead of
  treating every slug as free'` uses a clean slug so the residue guard cannot be what refuses, and
  `'adoption cannot walk through the malformed-registry refusal'` seeds residue and sends the
  acknowledgement.

## 5. The advisory lock is unchanged

The refusal throws **inside** `withAppStateKeyTransaction`, which is the path `addLeague`'s
pre-existing duplicate-slug throw has always taken. Read from the transaction code on both backends:

- **Postgres** — callback throw → `drainLocks()` → `tryRollback()` → `releaseHealthy()`. The lock is
  `pg_advisory_xact_lock`, released at ROLLBACK, and `combineCallbackAndLockFailure(err, null)`
  returns the original error unchanged. Nothing commits.
- **File fallback** — throw → `drainLocks()` → staged writes discarded by not committing → `finally`
  releases every held slot; the primary slot releases when `invoke` settles.

Pinned observably rather than by assertion about internals: `'a refusal releases the registry lock,
so the next mutation proceeds'` repairs the registry after a refusal and mutates again. A leaked lock
would hang or fail that second mutation.

## 6. Review — five passes, and every defect was in prose

| pass | target | result |
| --- | --- | --- |
| `/code-review high` | `6c2d5fa3` | 3 findings |
| `/codex:review --base 52a31b2b` | `6c2d5fa3` | clean |
| `/code-review high` | `bd4c2ce4` | 5 findings |
| `/codex:review --base 52a31b2b --scope branch` | `1d1955d3` | clean |
| `/code-review high` | `1d1955d3` | 2 findings, both already adjudicated |

Ten findings raised, five distinct underlying issues. **Zero correctness defects in the runtime
logic across all five passes.** The guard itself was never challenged. Every finding was either a
false claim in prose I wrote, or a pre-existing gap my prose overclaimed about.

**Both Codex passes are recorded as reading-level.** Each disclosed that it did not run the suite
("the environment is read-only"), so neither verdict rests on execution. Each was verified by exit
code first, then by the transcript's own `git diff` lines carrying the base — not by the banner,
which can name a base the review never used. Execution evidence is the lane's: `npm test` exit 0.

### Finding A — the docblock carried a false claim twice, and the form was the defect

The one worth reading. Round 1 found the reachability enumeration said *"exactly three"* places when
it was five, missing `setAssignmentMethod` — whose guard is `if (league && …)`, so `getLeague`'s
malformed→`null` collapse **skips** it and falls through to the write — and `beginPreseason`, which
reads no registry at all.

Round 1's fix corrected the facts and **kept the form**. Round 2 then found:

- `setAssignmentMethod` listed as a site with "no upstream container check" **in the very commit that
  gave it one**, contradicted by the name of the test cited one line below it. Reachable sites: four.
- "eleven production call sites" — twelve.
- Three of five bare line numbers resolving to a prose line, a `requireAdminAction` call, and a
  different function's `savePreseasonOwners`.

So the third fix was not a third correction of the sentence. **A count, a line number, or an
exhaustive list in a docblock is a claim with no test and an expiry date**: every edit moves the
lines, every new caller falsifies the count. The paragraph now states the class, names the three
tests that carry which site has which disposition, and asserts no number. Measured after: zero bare
line-number references in that file's docblocks.

The detail that makes this worth a ledger entry: round 1's text claimed the enumeration was *"now
carried by the tests rather than by this sentence"* **while the sentence still carried a count**.
That is how the second falsehood survived writing a paragraph about the first.

### Finding B — the refusal arrived as a redacted digest

Next.js redacts errors thrown in a Server Action before they reach the client in production, so the
new throw reached the commissioner as an opaque digest — bypassing the typed result contracts
F2H3B1 introduced for exactly that reason.

Fixed for `setAssignmentMethod`, which already carries `{ ok: false; error }` and so needed **no new
type** — and where the throw replaced a genuine defect rather than a working path: before 836 that
function returned `{ ok: true }` while writing nothing.

The line held, and it is the reason the rest was deferred: **no new type needed = in scope; a new
outcome variant an operator surface must learn to render = its own slice.** `beginPreseason` and
`completeSetup` return `void` and have always thrown every refusal; the demo controls would need a
new `TestControlResult` variant. Tracked as **#882**, with the rough edge pinned where it ships —
`'the demo controls refuse a malformed registry'`.

### Finding C — the silent success is only half closed

`setAssignmentMethod` discards `updateLeague`'s `League | null` return, so with a **missing**
registry, or an `ok` one holding no entry for the slug (deleted from another tab, stale admin page),
the draft guard is skipped, the write matches nothing, and the action still answers `{ ok: true }`.

Not fixed here. Different precondition — absence, not corruption — so a different subject, by owner
ruling under `AGENTS.md` step 6. The in-code comment now states exactly what ships rather than
implying the defect is closed; round 1's comment had overclaimed it. Tracked as **#884**.

### Finding D — GET still reports a corrupt registry as "no leagues exist"

`GET /api/admin/leagues` still uses `getLeagues()`, so a malformed container is served as an empty
list and `admin/leagues/page.tsx` renders *"No leagues configured yet. Use the form below to create
your first league."* The operator's only read surface asserts the exact falsehood POST now refuses to
act on, and the corruption is discoverable only by attempting a create.

The "69 modules depend on the array contract" argument does **not** excuse this single admin call
site. Not fixed here because the fix is not the route line: the page needs a state to render for an
unreadable registry, which is a UI surface `DESIGN.md` governs. The comment now says it is a
deferral rather than implying the asymmetry is correct. Tracked as **#883**.

### Finding E — the aliases latch, found before implementation and escalated after

Surfaced in this slice's read receipt, verified independently by the owner, filed as **#881**, and
ruled out of scope before any code was written. Round 3 re-found it.

`GET /api/aliases?scope=global` passes `getLeagues().map(…)` into
`migrateYearScopedAliasesToGlobal`, so a malformed container builds a candidate-scope list with no
`aliases:{slug}:{y}` entries at all, promotes nothing from them, and then unconditionally writes
`setAppState(GLOBAL_SCOPE, MIGRATION_DONE_KEY, true)`. The sentinel short-circuits every later call,
so the one-time promotion of league-scoped manual alias repairs is closed **permanently**.

Round 3 added one fact the receipt did not have, verified here: **that GET has no
`requireAdminRequest`** — the call is at `:98`, inside `PUT` — and `src/middleware.ts` gates only the
`/admin/*` and `/debug/*` page families, its own comment stating that API routes are gated at the
route boundary instead. So the write is reachable **unauthenticated**. Relayed to #881, which now
also asks whether an unauthenticated GET should trigger a durable one-way migration on any registry
state at all.

Round 3 also read this branch's prose as claiming `addLeague` was the only writer **anywhere**. The
claim is scoped to `mutateRegistry` callers and is true as scoped. But a careful high-effort reader
misreading it is itself a defect when the branch's entire finding set is prose defects, so one
sentence now states the scope and points at #881. Owner authorized that narrowly, as the last change
on the branch, overriding step 7 explicitly rather than silently.

## 7. Mutations — six, each reddening its own named assertion

| mutation | assertion that fired |
| --- | --- |
| Collapse restored in `mutateRegistry` | **First attempt fired the wrong one.** `'…refuses a malformed registry and leaks no stored value'` reddened on the error-TYPE check, short-circuiting before the write assertion — the exact false green the prompt warned about, in the test written to prevent it. Assertions reordered so the write check runs first. |
| Collapse restored, after reordering | `'the malformed registry is byte-for-byte unchanged, so the corruption stays recoverable'` — and the diff is the defect: `{alpha:1, nested:{passwordHash:'HASH-CANARY'}}` replaced by `[{slug:'alpha'…}]`. |
| Route refusal deleted | Both route tests redden, but **via the `mutateRegistry` exception** — proving sensitivity, not the message claim. Recorded as insufficient on its own. |
| Route refusal shaped as a 409 duplicate conflict | `409 !== 500`. |
| Route refusal keeping 500 but carrying "already exists" | `/^league-registry-malformed:/` — acceptance 1's actual requirement, which is the message distinction. |
| Typed refusal removed from `setAssignmentMethod` | `'a malformed registry is a typed refusal, not a redacted Server Action throw'` fails **by the throw escaping**, which is the condition it exists to forbid. |
| Collapse restored, against the action tests | `'the void-returning Server Actions refuse a malformed registry by throwing'` fails with `got Error: League not found`; `'the demo controls refuse a malformed registry'` with `got null`. The old defect verbatim. |

The first row is the one to carry forward: a mutation can redden the right test for the wrong reason,
and assertion **order** decides whether the load-bearing claim is ever evaluated.

## 8. Verification

Each gate its own command with its own exit code, never behind a pipe. The first `npm test` run was
re-executed to a file because `${PIPESTATUS[0]}` after `tail` returned empty — a green summary whose
exit code was not actually read.

| gate | result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm test` | exit 0 — 5618 pass, 0 fail |
| `npm run lint:all` | exit 0 |

Round 3 re-ran all three independently and agreed, and additionally confirmed that **all nine test
citations across the new comments exist and are correctly attributed** — the direct check on the
defect class this branch failed twice.

Two things round 3 verified that the lane had **not** checked, recorded because the lane asserted the
first was safe without checking the ordering:

- **No partial-destruction window.** Both demo controls sequence the registry mutation **before**
  `clearTestLeagueYear` and the demo-scope cleanup, so a refusal cannot leave the demo league
  half-wiped. `completePreseasonSetup` and `completeSetup` likewise perform no non-registry write
  ahead of the mutator.
- **The refusal text actually reaches the operator.** `admin/leagues/page.tsx:265` renders
  `res.text()` verbatim, so the plain-text 500 body is not swallowed in favour of a generic message.

Also confirmed by round 3: `mutateRegistry` is the only writer of `leagues/registry` anywhere in
`src/` or `scripts/`; `LeagueRegistryMalformedError` carries no part of the stored value and
`instanceof` is sound at the configured ES2017 target; `TestLeagueControls.tsx` try/catches both demo
actions so the new throw degrades to generic operator copy rather than crashing.

## 9. Residuals

- **#881** — the aliases `migration-done` latch, now known to be reachable unauthenticated.
- **#882** — `void`-returning actions and the demo controls still refuse by throwing into a surface
  that redacts the message.
- **#883** — `GET /api/admin/leagues` still collapses malformed to `[]`, so the admin list asserts
  "no leagues" for a state POST refuses.
- **#884** — `setAssignmentMethod` answers `{ ok: true }` with nothing written, for absence rather
  than corruption.
- The admin `[slug]` routes (PATCH, DELETE, password) refuse under a malformed registry **only
  because `getLeague` collapses it to `null` and they 404 on it** — the right outcome through the
  very defect this slice removes, so each tells the operator the league does not exist when the truth
  is that the registry is unreadable. Correct by accident, recorded in the docblock, and not filed:
  replacing `getLeague` there is a larger change than any of the above.
- **No known malformed registry instance.** Production was not queried, and sizing this needed no
  production read. The answer is *unknown*, not *zero*.
