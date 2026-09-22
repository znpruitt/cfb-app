# PLATFORM-813 v3 — use the channel that already exists

```text
PROMPT_ID: PLATFORM-813-ROW-VALIDATION-CLAUDE-v3
PURPOSE: v2's boundary coercion is right and stays. Its REPORTING is wrong: it invented a parallel
         count for a fact `buildScheduleFromApi` already records with reasons, and routed corruption
         into a silent discard in the durable path. Delete the parallel channel, read the existing
         one, and cover the consumer that bypasses the boundary entirely.
SCOPE:   src/lib/server/canonicalScheduleCache.ts, src/lib/seasonBuild.ts,
         src/app/league/[slug]/draft/board/boardData.ts and src/app/league/[slug]/draft/page.tsx
         (the row-consuming bypasses, ruled in scope 2026-09-21), the durable writers the receipt
         identifies, and their tests. DO NOT re-litigate WHERE validation happens — the
         boundary is settled and uncontested by both reviewers across two rounds. DO NOT change the
         aggregate-only contract, AGENTS.md or DESIGN.md (planning owns both; report what your diff
         falsifies).
CARRIES: NONE from the Item 87 campaign index, having checked — store-layer work, no row anatomy.

         Three standing obligations bind, and the first is why v3 exists:

         "Audit seams BEFORE writing": enumerate a shared fact's WRITERS, its readers' MEANINGS, and
         the controls live in each state. **Planning ruled a parallel count into existence without
         checking whether the codebase already recorded the same fact. It did.**

         AGENTS.md invariant 8: "cache valid absence, never cache uncertainty."

         "When your change kills a test, separate its intent from its mechanism" (added 2026-09-21,
         from this slice's own v2).
```

---

## What v2 got right, and keeps

**Coercion at the boundary is settled.** Non-string → `''`, wired into every construction path of
`loadCanonicalScheduleEntry`. Both reviewers across two rounds contested the *reporting*, never the
*location*. Keep it. `565f7fba` stays on the branch; v3 is a deletion on top of it.

Also keep: `null`/`undefined` left uncoerced so absence stays distinguishable from empty, the
all-dropped throw, and the per-field tests.

## The defect v3 exists to remove

**Coercion routes corruption into a silent discard, in the durable path.** A coerced participant
field leaves the row in `items`; `classifyScheduleRow` discards it as `invalid_row`;
`assembleSeasonScoredBuild` destructures only `{ games }` (`seasonBuild.ts:124`) and never sees the
loss. Both reviewers found this independently. **On `main` that row threw and the archive cron failed
loudly** — so v2 converted a loud failure into silent data loss, which is strictly worse than the
status quo for the surface that matters most.

It violates **invariant 8**, and `leagueStandings`' cache is tag-only (`revalidate: false`), so a
snapshot built from an incomplete schedule **persists indefinitely**.

## The channel already exists — this is the whole slice

Verified on `main` 2026-09-21:

| fact | site |
| --- | --- |
| `issues: string[]` on the return type | `schedule.ts:227` |
| `issues.push(\`invalid-schedule-row: ${classified.reason}\`)` | `schedule.ts:648` |
| `issues` returned | `schedule.ts:896` |
| the consumer that throws it away | `seasonBuild.ts:124`, `const { games } = buildScheduleFromApi({...})` |

**`droppedRowCount` and `coercedFieldCount` are a second, weaker record of a fact the codebase
already computes with reasons attached.** Two sources of truth about one thing is the pattern this
repo keeps paying for. **Delete them.** If a durable writer needs to know rows were discarded, it
reads `issues`, which tells it *why* as well as *how many*.

Planning ruled those counts into existence on 2026-09-21 without auditing for an existing channel.
That ruling is withdrawn.

## The 14th consumer — the premise was wrong

v2's prompt said *"validating once here covers all thirteen."* It does not.
**`boardData.ts:23` reads `getAppState<{ items: unknown[] }>('schedule', \`${year}-all-all\`)`
directly** and feeds the raw items into `buildScheduleFromApi` at `:26`, bypassing
`loadCachedScheduleItems` entirely. It is the spectator **draft board** — member-facing, and a
corrupted row renders a wrong board during a live draft.

**Owner decision 2026-09-21: it moves onto the canonical reader.** This touches a draft surface, so
state in the receipt what else that file's behaviour depends on before changing it — `:7-14`'s
comment explains why it reads the way it does, and the v3 receipt established that the reason is
about ALIAS RESOLUTION, not about the read, so it survives the move. **Two behaviours do change: the
partition-pair fallback becomes available to the board, and "returns `[]` when no schedule is
cached" becomes conditional.** Both belong in the closeout.

**This paragraph originally said the boundary would then cover "14 of 14". It does not — see the
ruling below.**

`scheduleDisappearanceBaseline.ts` stays out, as in v2 — it bypasses deliberately and says why at
`:28-45` (the prompt previously cited `:53-54`, which are the partition reads, not the justification).

**RULED 2026-09-21 from the v3 receipt — and "14 of 14" was wrong, which is the SECOND premise error
in this prompt family. Both were mine, and both were a count of what I had looked at presented as a
count of what exists.**

1. **`draft/page.tsx:69` and `:105` are IN SCOPE.** Both read the durable key directly and feed
   `resolveDraftScheduleGames`, so they are row consumers on the **same member-facing draft surface**
   as `boardData`. Fixing the board and leaving the page beside it is fixing one instance of a class,
   which is precisely what failed in v1 and again in v2. **`:105` reads `year - 1`, so the fix covers
   two years** — state what an unreadable prior season does to the page.
2. **`providerDataDiagnostics:391`/`:483` are FILED, not fixed, and the reason is a real design
   question rather than scope management.** That module exists to REPORT on provider data health. A
   diagnostic reading through a sanitizing boundary may hide the very corruption it was built to
   surface. Decide it on its own terms, with its own measurement; do not fold it in here.
3. **Do not restate a coverage count you have not enumerated.** The closeout states the final
   enumeration with its own derivation. Planning has now published a wrong one twice in this family
   ("13 consumers, validating once covers all", then "14 of 14"), both times by counting the reads
   in hand rather than the reads that exist.

**Per-writer dispositions, ruled:**

- **Archive — REFUSE**, as the receipt proposes. The cron's existing `catch` records a per-league
  error and skips the write, the loop continues, and the archive has nowhere to carry "except the
  ones we dropped". No new plumbing.
- **`leagueStandings` — REFUSE, by propagating.** Invariant 8 is binding and `revalidate: false` is
  exactly its subject: a swallowed error caches a lie that persists until a tag bust, while a
  propagated one is never persisted and the next request recomputes. **The decisive practical point
  is that this state is unreachable in production**, so strictness costs approximately nothing and
  silence costs correctness permanently. **If the standings surface has no shaped error state, stop
  and report before building one** — that is UI work under `DESIGN.md`, which planning owns.
- **Recap and `analyticsProvenance` — RECORD, do not refuse**, as proposed.
- **Draft board and draft page — PROPAGATE.** An empty board with no notice asserts "no games",
  which is false and is the collapse this slice exists to remove. A notice is a better answer and it
  is `DESIGN.md` UI work on a draft surface; it is filed, not built here.

  **CORRECTED 2026-09-21 at v3 round 1 — this ruling was made without reading the page callers, and
  it is moot.** `draft/board/page.tsx:61-65` and `draft/page.tsx:84` wrap the load in a bare `catch`
  that renders empty, and both date from `336050f99` (2026-04-03), long before this slice. So on
  `main` a corrupted schedule ALREADY rendered as an empty board, the loader's throw never reaches a
  member, and this slice did not regress the draft pages. Making the pages propagate would change
  `main`'s behaviour on a draft surface; that is #844's decision, not this slice's. **Fourth time on
  this slice planning ruled from the fact in hand without checking the one beside it.**

**`/api/schedule` — shaped 503**, matching `route.ts:360`. An opaque Next 500 with no body is
inconsistent with every other failure this route returns and tells a caller nothing about whether to
retry.

## ROUND 1, ruled 2026-09-21 — four findings, and the premise of this prompt covered one loss site in three

**"The channel already exists — this is the whole slice" was wrong, and it was planning's.** Planning
verified that `issues` exists and that one path writes `invalid-schedule-row`, and concluded it was
THE record of row loss. It records one of three places a row is lost:

| loss site | writes an issue? | seen by v3's gate |
| --- | --- | --- |
| regular-season row, blanked participant → `classifyScheduleRow` | yes | yes |
| non-object row dropped at the boundary (`durableScheduleRow.ts:197`) | no | **no — F1** |
| postseason / conference-championship row, blanked participant → placeholder | no | **no — F2** |

v2's count caught the second and missed the first; v3 has the opposite gap. **Both versions were
built from a list of loss sites, and both lists were incomplete.**

**F1 was hidden by a comment.** The `continue` at `durableScheduleRow.ts:197` carries a comment saying
the dropped row is *"counted separately, because a discarded row changes the season's content."*
**Nothing counts it** — that comment describes `droppedRowCount`, which v3 deleted, and it survived
the deletion still asserting the loss is recorded. A diff that falsifies a comment owns it.

**Ruled on F1 + F2: the boundary reports what it destroys, and the durable writers refuse on it.**
This is NOT the parallel counts returning. v3 deleted those because they were a second record of a
fact the codebase already computed. **These are facts the codebase computes nowhere else**: an F1 row
never reaches `classifyScheduleRow`, an F2 row bypasses it, and after the build a coerced postseason
participant is **indistinguishable from a legitimate TBD slot**. The boundary is the only code that
knows a non-string was coerced rather than an empty string sent by the provider. Discarding that fact
at the boundary is the defect. Planning's preference, not a requirement: normalise the boundary's
reports into the same list the writers already read, so a durable writer's refusal checks ONE thing
and the next loss site has one place to report to.

**THE TEST IS BUILT FROM THE INPUT SPACE, NOT FROM A LIST OF LOSS SITES.** This is the requirement
that matters most, because it is what both versions lacked. `AGENTS.md` already states it: *"An
invariant over a space must be tested over the space, not over chosen representatives."* The
invariant: **no corrupted durable row produces an archive or a standings snapshot that reads as
complete.** The space: every row kind (regular, conference championship, postseason) × every
required field made non-string, plus a non-object row. The oracle: the durable output's game set
against the uncorrupted baseline's — if they differ and the writer did not refuse, the test fails.
**A matrix finds a loss site nobody listed; a list of tests inherits the list's gaps.** The four tests
the round-1 report proposes are representatives; keep them, and add the matrix.

**Which fields trigger refusal is DETERMINED by the matrix, not declared up front.** The round-1 report
scopes refusal to coerced *participant* fields. Include every required field in the space and let the
outcome decide. A candidate the participant scoping would miss: **`id`.** Postseason games take
`key: id, eventId: id` (`schedule.ts:693`) and the `eventKey` fallback is `${week}-${id}` (`:413`), so
two rows with a coerced `id` may share a key. **Planning did not trace whether anything downstream
merges games by key — this is unverified, which is exactly why the matrix and not planning decides
it.**

**F3 — move the refusal to the archive writer.** That is what this prompt ruled (*"Recap and
`analyticsProvenance` — RECORD, do not refuse"*); the implementation put it in the shared build,
which made recap and provenance refuse too, contradicting both the ruling and its own commit message.
Standings keeps its own refusal under invariant 8. **Provenance must report the actual cause, not
`build-failed`.**

**F4 — fix the comment, not the behaviour.** See the correction under the draft ruling above: the
pages have caught and rendered empty since 2026-04-03, so the comment's "throws rather than rendering
as 'no games'" is true of the loader and false of every page a member sees. Say what is true. The
notice is #844.

**Round accounting.** This is v3's one cohesive remediation round (`AGENTS.md` step 4). Then both
reviewers run against the remediated commit. A second remediation round requires explicit owner
approval, and only for a narrow defect directly caused by this one (step 6).

## Acceptance

1. **A durable writer never records a season as complete when rows were discarded.** It reads
   `issues` from the build it actually performed. Pinned by a test that fails against `ff79e1a6`.
2. **`droppedRowCount` and `coercedFieldCount` no longer exist**, and nothing reintroduces a second
   record of row loss. A test or structural assertion pins their absence.
3. **A non-array `items` is unreadable, not empty.** `0/0` reporting is what recreated the collapse
   in round 2; the value must be distinguishable from a season with no rows.
4. **The draft board reads through the canonical reader**, and a corrupted row cannot render a wrong
   board. Pinned.
5. **All ten fields keep their per-field tests** from v2, still mutation-proven.
6. **The all-dropped throw survives**, with `/api/schedule` handling it — round 2 found no handler.
7. **Every consumer claim in the closeout is an enumeration, not a substring sweep.** Round 2's
   acceptance-3 sweep passed `providerDataDiagnostics` while it read aggregate rows directly.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which
assertion fired.**

**The false greens that beat v2, named so they cannot repeat:**

- **A sweep shaped to pass.** State what each sweep ENUMERATES, not what string it matched. A
  substring sweep over consumer names is a measurement of the names.
- **A count that reaches no consumer.** If nothing reads a value, a test asserting its value proves
  nothing about behaviour.
- **A fix that recreates the thing it fixed** — `Array.isArray` reporting `0/0` did exactly that.
  After each fix, ask what the new path reports in the case the fix was for.
- **A recount done by eye.** v2's field count was wrong twice, once after being corrected. Derive
  counts from the committed artifact, in a script, and print them.

**Pair every mechanism comment with the test that asserts the same behaviour**, and re-derive every
line-number citation against `main` before the closeout — v2's report cited branch-relative lines
for files whose branch state is being deleted.

---

## STOP — read receipt before writing any code

1. **Which consumers write DURABLE records** from a schedule build — archives, receipts, standings
   snapshots — and what does each do today when rows were discarded? This is the list acceptance 1
   binds; enumerate it, do not sweep for it.
2. **What does each durable writer DO with `issues`** — refuse to write, write with the loss
   recorded, or something else? Recommend per writer; a blanket answer is the thing that produced
   v2's silent discard.
3. **What survives deletion?** Name every symbol, test and doc block that exists only to serve
   `droppedRowCount`/`coercedFieldCount`, so the deletion is complete rather than partial.
4. **`boardData.ts`** — read `:7-14`'s comment and say whether its stated reason for the direct read
   survives the move, what else changes for the draft board, and what test proves the board is
   unaffected in the healthy case.
5. **What does `/api/schedule` do with the all-dropped throw**, and what status does a caller see?
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
