# CLAUDE.md

Status: Current
Last verified: 2026-08-04
Owner: Project documentation
Canonical for: Claude-specific invocation guidance only — how to drive this repo's tooling. It states NO binding rules of its own.
Supersedes: docs/archive/governance/cfb-engineering-operating-instructions.md (Claude-workflow portion; jointly with AGENTS.md, which is canonical for the binding rules)

Claude Code companion to `AGENTS.md`. **Read `AGENTS.md` first.**

> **This file is not a source of truth.** DOCS-013 reduced it to invocation guidance. Every binding
> rule — scope and sizing, review and remediation limits, verification, reconstruction, lifecycle and
> standings and auth invariants, documentation closeout — lives in `AGENTS.md`. `DESIGN.md` is
> canonical for UI/UX. If anything here appears to state a rule, `AGENTS.md` wins and this file is
> the bug. [`docs/README.md`](docs/README.md) is the full documentation map.

---

## Where the rules live

| Need | Read |
| --- | --- |
| How big a PR may be; when a split is mandatory | `AGENTS.md` → **Scope and sizing** |
| How many remediation rounds; when to stop; when to reconstruct | `AGENTS.md` → **Review and remediation limits** |
| How to run gates and report results; test accounting | `AGENTS.md` → **Verification** |
| Lifecycle / standings / ownership / auth invariants | `AGENTS.md` → the **Invariants** sections |
| When documentation is finalized; which ledger owns what | `AGENTS.md` → **Documentation closeout timing** |
| Who pushes `preview`, and on what cadence | `AGENTS.md` → **Preview branch** |
| UI and design decisions | `DESIGN.md` |
| What is queued next, and campaign status | `docs/next-tasks.md` |
| **An individual work item — its ask, state and evidence** | **GitHub Issues** (owner decision 2026-09-10) |
| Which prompt IDs exist | `docs/prompt-registry.md` |
| Doc ownership map | `docs/README.md` |

---

## Role on this project

Roles are assigned **per task by the prompt**, not fixed by tool. Claude may plan, implement,
remediate, diagnose, or review; Codex commonly provides independent read-only review and can also
take scoped implementation. Whatever the assigned role, diagnose accurately, keep changes within the
prompt's stated scope, and report outcomes honestly — preserving known unresolved risks as
unresolved.

## Worktrees and session roles

Owner decision 2026-09-05: planning and implementation run in SEPARATE Claude sessions, in separate
worktrees. Two sessions sharing one checkout share one index and one branch — a `git add -A` in
either sweeps the other's half-finished edits into a commit, and a branch switch in either relocates
the other's next commit. Check `git worktree list` and `git rev-parse --abbrev-ref HEAD` before your
first commit; if you are not where this table says you should be, stop and say so.

| Worktree | Branch | Session | May commit to `main` | Touches |
| --- | --- | --- | --- | --- |
| `/Users/zach/cfb-app` | `main` | **Planning Claude** | Yes | `docs/`, `AGENTS.md`, `CLAUDE.md`, `DESIGN.md` — never `src/` |
| `/Users/zach/cfb-app-claude` | `claude/<task>` off `main` | **Implementation Claude** | **No** | `src/`, tests, and its branch's closeout |
| `/Users/zach/cfb-app-codex` | the Codex branch | Codex | **No** | its own branch only |

- **Implementation Claude branches per implementation set, off current `origin/main`.** It never
  commits to `main` directly.
  **`claude/base` is a RESTING POINTER, not a base with content** — clarified 2026-09-13 after this
  line was found naming two bases in one sentence while they had diverged by **51 commits** (the lane
  flagged it; `claude/base` was still at `2bd76544`). *"Off current `origin/main`, from `claude/base`"*
  is only unambiguous while the two are equal, and nothing was keeping them equal.
  **So: fast-forward `claude/base` to `origin/main` on returning to it after every merge.** It is
  always zero-ahead and fast-forwardable, so this is housekeeping, not a decision — and it removes the
  trap where `git checkout -b <new>` from a resting worktree silently inherits a stale base. If it is
  ever NOT zero-ahead, stop and report: something was committed to the resting branch, which nothing
  should do.
- **The implementation lane opens its own PR and merges it — owner decision 2026-09-05**, amending the
  earlier rule that the owner merged. By the time both reviewers have converged the decision is
  already made, and the owner's merge step was mechanical: every catch in practice happened at REPORT
  time, not at merge time. **Promotion is NOT delegated** — it stays with the owner, because that is
  the step with production consequences and the one where "what ships together" is a judgement call.
  Four conditions, all binding:
  1. **The closeout commit lands first, on the branch.** `AGENTS.md` → **Documentation closeout
     timing** requires it pre-merge. Record what actually SHIPPED, not what was specified — a model
     that changed mid-branch is exactly what a ledger written from the prompt gets wrong.
  2. **`git pull` immediately before merging**, and report any conflict resolved. Three writers share
     `main` — both implementation lanes and the planning session.
     **CONDITION 2 CANNOT CLOSE THE RACE, AND THE TREE-HASH CHECK IS WHAT ACTUALLY GATES THE MERGE.**
     Added 2026-09-24 after the #866 lane hit it and reported it instead of burying it. Its pull said
     *"Already up to date"* at `40ab8485`; `dd69113f` landed seconds later from the planning session;
     GitHub merged into THAT. **Condition 2 passed and was stale before the merge button resolved** —
     the window is between your pull and GitHub's merge, and nothing a lane runs locally can shrink it
     to zero. So `git pull` is necessary and is NOT the guarantee. **Compare the gated tree hash with
     the merged tree hash every time; that comparison is the guarantee.**
     **When they differ, the response is to RE-GATE, not to inspect.** Identify the delta precisely
     (`git diff --stat <gated> origin/main` against the suspected commit's own stat — byte-identical
     stats is the check), then reproduce `main`'s exact tree locally, confirm the tree hash now
     matches `origin/main`, and re-run the gates against it. **"Benign by inspection" is not gated**,
     and a docs-only delta is exactly the shape that makes inspection feel sufficient.
  3. **Never tolerate an unknown failure. THE KNOWN SET IS EMPTY** — Item 137 (#696) removed the last
     two on 2026-09-11 (PR #742, merged `a8593d9f`), so `npm test` on clean `main` exits 0 and the
     merge condition is simply zero failures. The rule is unchanged in substance: merge only when the
     failures are EXACTLY the known set, and one more, or one elsewhere, means stop and report — it is
     just that the set is empty, so ANY failure stops the merge. A "tolerate failures" rule would swallow
     the next real regression. **Keep this condition written as a SET, not as a count**: if `main`
     ever carries a known failure again it is recorded beside the two-lane table in
     `docs/next-tasks.md`, and a count would hide the second one.
  1b. **PULL `main` BEFORE WRITING THE CLOSEOUT, NOT ONLY BEFORE MERGING.** Added 2026-09-15 after
     the UI lane avoided this by instinct rather than by rule. Condition 2's `git pull` fires
     immediately before the MERGE — by which time the closeout is already written, because
     condition 1 requires it to land first. So a branch cut before a `main` docs correction writes
     its ledger against the STALE document. The live near-miss: `claude/723-725-715` predated
     `7dcb31e9`, which reverted a wrong `DESIGN.md` sentence, and a closeout written on the branch
     as it stood **would have quoted the reverted sentence as canonical, in a ledger** — a false
     claim propagating from a transient artifact into a durable one, which is precisely how #693's
     original comment defect worked. Nothing in conditions 1-5 would have caught it.
  4. **Report the merge SHA and stop.** Anything ambiguous at merge time — a conflict that needed
     thought, an unexpected diff, a ledger wording you were unsure of — is a stop-and-report, not a
     decision. The merge is delegated; the judgement is not.
  5. **NEVER WRITE A CLOSING KEYWORD YOU DO NOT MEAN — IN A PR BODY *OR* A COMMIT MESSAGE, INCLUDING A NEGATED OR QUOTED ONE.**
     Added 2026-09-14 after exactly that. PR #784's body said it did **not** close two issues, naming
     them — the verb sat directly against the first issue number. **GitHub parsed that adjacency and closed
     it on merge.** Its keyword parser has no notion of negation; "not" in front changes nothing.
     **#781 survived only by accident of phrasing** — the keyword binds to the first issue number, so
     `or #781` carried none of its own. **Write "Leaves #780 and #781 open" — avoid the keyword rather
     than negating it.** The close then reads as `COMPLETED` by the PR author, which is indistinguishable
     from a deliberate ruling: it cost a reopen, a corrected issue comment, and a wrong accusation that
     the owner had ruled something they had not.
     **WIDENED 2026-09-14, within the hour, because the commit that first recorded this rule fired
     it again.** That commit quoted the offending sentence verbatim to explain the trap, so its
     message carried the verb adjacent to the issue number and GitHub closed it a second time — with a
     `commit_id`, from the commit documenting why not to. **The parser reads commit messages on the
     default branch exactly as it reads PR bodies, and QUOTING the mistake reproduces it.** When
     writing about a closing keyword, break it so the parser cannot match — spell it out, or keep
     the verb away from the issue number.
- **Planning Claude never edits `src/`.** Queue, prompts, governance and closeout documents only.
- **`docs/` work MAY go to an implementation lane, by exception, when it is a large read.** Owner
  decision 2026-09-08, first taken for **Item 144** (2,273 lines across 16 campaign documents). The
  table's rule exists because two sessions sharing a checkout collide — **the real requirement is file
  DISJOINTNESS, not file ownership.** Two reasons an implementation lane is the better home for one of
  these: the planning session's context holds the queue and the cross-item rulings, which a full read
  would consume; and verifying a documented claim against the code is an implementation lane's natural
  mode. **The exception is conditional on the planning lane standing off the same files for the
  duration, and saying so in the prompt.** `docs/prompts/` and `docs/next-tasks.md` stay with planning
  regardless — that is what keeps the two disjoint.
- **FILE DISJOINTNESS CATCHES CONFLICTING EDITS. IT DOES NOT CATCH MERGING ONES.** Added 2026-09-09,
  after exactly that. Item 110A's prompt assigned the audit evidence file to the implementation lane;
  the planning session then wrote a recovery record into the same section while the branch was open.
  **`ort` merged both cleanly — no conflict, nothing to review** — and produced one section carrying
  two overlapping accounts of the same event. The lane found it by reading, not by any gate.
  **The failure mode is silence:** a conflict announces itself, a clean merge of two true-but-duplicate
  narratives does not. So when a prompt assigns a document to a lane, **planning stands off it for the
  duration including its own closeout notes** — and if planning has something that belongs there, it
  goes in the relay message for the lane to write, not into the file.
- **THE THREE WORKTREES SHARE ONE OBJECT DATABASE, SO A PLANNING-SESSION `git cat-file` SEES UNPUSHED
  LANE COMMITS.** Added 2026-09-09 after I used exactly that to reach a wrong conclusion. All three
  worktrees resolve to `/Users/zach/cfb-app/.git`. When the Item 204 lane reported pushing a merge
  commit that was not on `origin`, I found the object present locally and inferred "it was pushed and
  the branch moved back." **It was never pushed; I was reading the lane's own local object through the
  shared store.** The lane's reflog check gave the right answer. **To ask whether something is on the
  remote, query the remote** — `git ls-remote origin <ref>`, or `git branch -r --contains` — never
  `cat-file`, which cannot distinguish "fetched" from "another worktree wrote it."
- **A LANE MAKING A POST-MERGE FLIP USES A TEMPORARY DETACHED WORKTREE, NEVER THE PLANNING CHECKOUT.**
  Added 2026-09-10, after the Item 620 lane hit a gap this file did not address and solved it correctly.
  Post-merge status flips go straight to `main` (no PR), but `main` is checked out in the PLANNING
  worktree — so a lane has nowhere to make one. **The answer is a temporary worktree in the scratchpad,
  used and then removed**, leaving `git worktree list` back at the three lanes. **Never `cd` into
  `/Users/zach/cfb-app` to do it**: two sessions in one checkout share an index and a branch, which is
  the whole reason the lanes are separate.
- **Prefer explicit paths over `git add -A`** in every session. `-A` is what makes a shared or
  mistaken checkout destructive rather than merely confusing.
- A new worktree needs what git does not carry: `npm ci`, plus `.env.local` and `.env.operator.local`
  copied from the primary worktree. Without them the gates cannot run.
  **NEVER copy `.env.operator.write.local`.** Updated 2026-09-10 — **this instruction is what created
  the exposure #703 closed.** Copying the operator file into every worktree put a production
  read-WRITE credential in all three by instruction. The write credential now lives in its own file,
  and **that file stays in the primary worktree only.** A lane that needs `recover-game-stats --apply`
  is a lane doing an owner action, and it should stop and ask rather than copy a secret to reach it.

## Interaction preferences

- Concise, technically precise, professional, direct.
- No engagement bait or teasing. State insights and improvements immediately.
- Proactively recommend better approaches when visible; flag conflicts with `AGENTS.md` explicitly
  before proceeding rather than resolving them silently.

---

## Invoking the review tools

- `/code-review` is **user-invocable only** in this environment — Claude cannot call it. When a
  workflow requires it, run everything else, then stop and ask the user to invoke it against the
  exact commit. Report the limitation; never substitute a self-review and call it the same thing.
- **`/codex:review` is ALSO user-invocable only.** Corrected 2026-09-09: this line used to say Claude
  could start it in the background. Both `commands/review.md` and `commands/adversarial-review.md`
  carry `disable-model-invocation: true`, so the model cannot invoke either. **Calling the underlying
  `codex-companion.mjs` script directly is reaching around that flag — do not.** Ask the owner, the
  same as `/code-review`. Found by the Item 204 lane, which flagged the stale instruction instead of
  working around it.
- **`/codex:review` TAKES NO POSITIONAL ARGUMENT — BUT IT DOES TAKE FLAGS — AND IT REVIEWS THE
  INVOKING SESSION'S WORKTREE.** Added 2026-09-15 after two failed rounds on #693, **and corrected
  the same day: the first version of this line said "takes no argument", which is wrong and hid the
  option that solves the base problem below.** Passing it a bare SHA fails outright — *"does not
  support custom focus text"*, exit 1, because `review` accepts no positionals (`adversarial-review`
  does). It DOES accept `[--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>]`
  and `--model`.
- **PASS `--base <merge-base>` WHENEVER `main` HAS MOVED SINCE THE BRANCH LAST MERGED IT.** The
  default `--base main` resolves to a **two-dot** `git diff`, so every commit added to `main` after
  the branch's last merge renders as a **DELETION in the branch's diff** — the reviewer then reports
  that the branch removes files it never touched. **A false finding generated by the base, not by
  the code**, and it costs a round to run down. `git merge-base HEAD origin/main` is the value to
  pass; with it, two-dot and three-dot agree. **DERIVE IT ONCE AND REUSE IT: the merge-base does not
  move while the branch holds** — only a fresh merge into the branch, or a rewrite of `main`'s
  history, moves it, and `main` advancing linearly does not. **`main` drifts and the merge-base does
  not, which is the whole argument**: every commit landing on `main` while a branch waits for review
  WIDENS the phantom-deletion set, so the longer the wait the worse `--base main` gets. Measured
  live on 2026-09-15: two docs commits landed on `main` while `claude/723-725-715` held, and a
  two-dot review would have reported that the branch **deleted an entire reconstruction prompt and
  reverted this file's corrections** — findings a reviewer would rate high, against a branch that
  touched neither file. `/code-review <sha>` takes the commit directly and has
  no such exposure.
- **`--base` HAS TWO USES AND THEY LOOK IDENTICAL AT THE CALL SITE. PASS A REAL MERGE-BASE, NEVER A
  BRANCH COMMIT.** Added 2026-09-15 after a lane passed its own previous branch tip as `--base`,
  believing it was applying the drift fix above. **Passing a branch commit ALSO avoids the phantom
  deletions, so it looks like it is doing the drift-protection job while silently narrowing what the
  reviewer sees.** One is a correctness fix for a two-dot artefact; the other is a judgement about
  review scope, and it rides along invisibly. **Measured on #693:** the real merge-base gave 25
  files / 2,625 insertions; the branch commit gave 13 / 576 — **less than a quarter of the branch**.
  Verify with `git merge-base --is-ancestor <base> origin/main`; a true merge-base IS an ancestor of
  `origin/main` and a branch commit is not.
- **A DELTA REVIEW CANNOT SEE AN INTEGRATION DEFECT, WHICH IS THE CLASS THIS REPO ACTUALLY SHIPS.**
  Every serious finding on #693 was correct in its own diff and wrong in where it LANDED: a helper
  nothing called; an issue code no panel claimed; a registration whose entire risk is the tile it
  files under. **Review against the merge-base even when a narrower range is defensible** — the cost
  is re-reported findings, which an adjudication record dismisses in a line, and per the standing
  rule a repeat you believe is wrong gets a TEST, not a rebuttal. It reviews `main...HEAD`, and `resolveCommandCwd` in the companion is
  `options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd()`, so **the workspace comes
  from the invoking process's cwd.** Invoke it from the session whose worktree holds the branch.
  From the PLANNING worktree, which sits on `main`, the range is empty. `main...HEAD` is therefore
  per-worktree, NOT a shared quantity — two lanes are independent on the git axis, and any claim
  that they cannot be reviewed concurrently must rest on the codex runtime, not on the diff.
- **`/code-review` and `/codex:review` MUST BE SENT AS SEPARATE MESSAGES**, the second only after the
  first agent has returned. Typed in one message, the second line is absorbed into the first agent's
  description and **no process starts and no output file is written** — it does not fail, it simply
  never runs. Cost two full rounds on #693 before the mechanism was identified.
- **VERIFY A CODEX REPORT'S DIFF BASE BEFORE TREATING IT AS GATHERED — the report BODY cannot tell
  you.** Its header reads only `Target: branch diff against main`, which is byte-identical for a
  real review and for a review of nothing. The range is in the TRANSCRIPT above the `# Codex Review`
  header, where the companion logs its own `git diff` invocations — confirm that base is the branch
  point. **MATCH THE BASE'S FIRST 12 HEX CHARACTERS ON ANY `git diff` LINE. DO NOT REQUIRE A FULL
  40-HEX SHA, AND DO NOT KEY ON ANY PARTICULAR DIFF FORM.** The log truncates each form at a
  different width — observed on one run: `--check` at 28 characters, `--numstat` at 38, `--stat`
  shorter still — and a run may issue **no `--unified` diff at all**. Twelve hex characters is
  unambiguous in this repo and survives every truncation seen.
  **THIS RULE HAS NOW CRIED WOLF TWICE, BOTH TIMES FOR THE SAME STRUCTURAL REASON, AND THE REASON IS
  THE LESSON.** v1 keyed on the `--stat` line; v2 keyed on a full SHA and assumed `--unified` would
  always be present. **Both keyed on a RENDERING DETAIL of the log rather than on the quantity the
  check cares about — "did a diff against the intended base happen."** A prefix match on any diff
  line asks that question directly, so it does not decay when the reviewer changes which diff forms
  it issues. **If you find yourself correcting this rule a third time, check first whether the new
  version is keyed on the question or on the output.**
  **THIRD INSTANCE, 2026-09-16 — AND IT WAS IN THE CHECK, NOT IN THIS TEXT.** A lane's grep capped the
  gap between `git diff` and the prefix at 40 characters; the Codex run for #802 issued
  `--find-renames --find-copies --unified=80`, 43 characters, and a real review was flagged empty.
  **This rule sets no distance. Require only that `git diff` and the 12-hex prefix appear on the same
  line.** A length bound anywhere in the pattern is another rendering detail.
  All three failures produced the same dangerous shape: **a CLEAN report declared a review of nothing**,
  which is when a clean verdict most needs to be trusted or rejected correctly. **A check that
  rejects good reviews gets skipped, and then the variant it exists to catch walks through.** **A transcript with no diff command, or a base equal to HEAD, is a review of nothing
  wearing a clean report's shape.** This is the mutation-harness failure in a second place: "did not
  run" and "ran and found nothing" are different results that render identically, and the fix is the
  same — find the quantity that separates them and read it every time.
- **READ THE EXIT CODE. IT IS THE CHEAPEST DISCRIMINATOR AND IT CATCHES THE SHAPE BOTH OTHER CHECKS
  MISS.** Added 2026-09-15, fourth variant. A capacity failure emitted a `# Codex Review` header AND
  the correct `Target:` line, **16 `git diff` invocations into a real investigation of the right
  files** — so the banner check passes and the transcript check passes. Only the body sentence
  (*"Reviewer failed to output a response"*, *"Selected model is at capacity"*) and **exit code 1**
  distinguish it; a good run exits 0. **Check the exit code first, then the diff base, then the
  body.** Cheapest to most expensive, and the cheapest is the one that catches a run which did real
  work and produced no findings.
- **THE BANNER CAN NAME A BASE THE REVIEW NEVER USED. A THIRD VARIANT, AND THE MOST DANGEROUS.**
  Added 2026-09-15. A run invoked with `--base <802's merge-base>` printed
  `Reviewer started: changes against '262708ff…'` — **and that was the only place the value appeared
  in the entire log.** All sixteen `git diff` invocations used `a1421035`, the merge-base of the
  branch that happened to be CHECKED OUT, and it reviewed that branch's files and commits. The
  requested branch was checked out in no worktree at all, so the companion resolved HEAD from cwd
  (`resolveCommandCwd`), derived its own base, and accepted the passed `--base` into the banner only.
  **A review of NOTHING wears a clean report's shape; this is a review of the WRONG THING wearing the
  RIGHT banner — so a header check confirms exactly the wrong conclusion.** The diff commands in the
  transcript are the only quantity that separates them, which is why they are what you read.
- **SO: THE BRANCH YOU WANT REVIEWED MUST BE CHECKED OUT IN THE INVOKING WORKTREE.** `--base` does not
  select a branch and cannot; it only narrows the range within whatever HEAD resolves to. Check
  `git worktree list` before invoking, and never switch branches in a worktree while a review is
  reading it. `/code-review <sha>` is immune — it takes the commit directly.
- Both reviews must run against the **same commit**, and both must be gathered before any
  remediation — see `AGENTS.md` → **Review and remediation limits**.

## Prompt headers

Every generated prompt begins with:

```text
PROMPT_ID: <CAMPAIGN>-<###>-<SHORT_NAME>-v<version>
PURPOSE: <1–2 sentences>
SCOPE: <files/modules + constraints>
CARRIES: <every LIVE obligation from the campaign index, verbatim — or NONE, having checked>
```

**`CARRIES:` is required and `NONE` is a claim, not a default.** Added 2026-09-08. A campaign index's
obligations are useless if the prompt author never scrolls to them, and that is not hypothetical: the
Item 87 sequenced-dependency warning sits in the canonical document, in bold, addressed to the prompt
author by name, **and in a second document besides** — and was carried into no prompt. The owner then
compared a build to the mockup and read absent records as a defect, which is the sequence it predicts
verbatim.

**Prominence is not the variable. Position relative to where prompt-writing reads from is.** A header
field is the only place that cannot be scrolled past, because its absence is visible in the artifact
and the read receipt can ask about it. Copy the obligations **verbatim** — a paraphrase is a second
lossy copy and the implementer cannot tell it from the original.

Campaign prefixes: `INSIGHTS`, `DRAFT`, `PLATFORM`, `POLISH`, `DOCS`. Split work may use a lettered
sub-sequence (`PLATFORM-079a`/`079b`). Existing `P{n}` IDs are grandfathered — do not renumber.
Check `docs/prompt-registry.md` for collisions before assigning an ID; the registry entry itself is
written during the pre-merge documentation closeout, not before.

Before any UI work, read `DESIGN.md`.

---

## Commands

- `npm run dev` — Next.js dev server (localhost:3000)
- `npm run build` — production build
- `npm run lint` — fast scoped lint (skips tests/data); local iteration only
- `npm run lint:all` — **the pre-merge gate.** Full-project ESLint + Prettier + markdownlint; this
  is what Vercel runs, and `npm run lint` misses violations in test files
- `npx tsc --noEmit` — type-check
- `npm run test:clock-shift -- <days> [file...]` — the full suite under a clock shifted `<days>`
  forward: the time-bomb detector (Item 137/#696). `-- 0` is the control and must be fully green;
  every non-zero shift expects exactly one failure (`testStoreLifecycle.test.ts` sweeps real file
  mtimes against a shifted now and pins no date) and **any other failure is a real expiry**, naming
  the date it starts. A bisect cannot find this class — an older commit is not an older clock.
- `npm test` — full suite (`node:test` + `tsx`); executable tests live under the nearest
  `__tests__/`, while the full glob scans every `src/**/*.test.ts[x]` file so a misplaced test still
  enters the gate and then fails the layout audit.
- `npm run test:file -- <path-or-glob...>` — exact files or globs with the full suite's isolation,
  TypeScript config, and timeout. Exact App Router paths containing `[brackets]` are escaped as
  literals by the wrapper rather than silently matching zero tests.
  **`npm test -- <path>` does NOT narrow the run** — the path is appended to the full-suite globs,
  so the whole suite executes and a green result says nothing about the file you meant to focus on.
  `test:file` is the only focused form.
- `npm run test:lib`, `npm run test:api`, and `npm run test:components` — focused, overlapping
  subsystem slices for local iteration; they do not partition the full suite.
- `npm run fetch:teams` — regenerate `src/data/teams.json` from CFBD

No Vitest/Jest. No CI workflow is checked in; `npm run lint:all` is the intended pre-merge gate.

## Reading production data

**Use the read-only replica. Do not `vercel env pull`.** Read-only production queries go through
`DATABASE_URL_RO` in `.env.operator.local` (gitignored) — an `audit_ro` role limited to
CONNECT/USAGE/SELECT on a read-only endpoint, using the DIRECT host rather than `-pooler`.

```bash
# the connection string is never printed; read it from the file
node -e "…new pg.Client({ connectionString: env.DATABASE_URL_RO })…"
```

There is deliberately **no `DATABASE_URL` in `.env.local`**: Next.js auto-loads that file, so one
there would point `npm run dev` at production. The rail exists so an agent does not need the
production secret to answer a question about live data — reaching for `vercel env pull` instead
puts every credential on disk to do a job a `SELECT` already does.

> **CORRECTED 2026-09-09, and the correction matters more than the wording.** This section used to say
> the rail exists so an agent **never needs the production secret set**. **That is not the state of the
> machine: `.env.operator.local` contains BOTH `DATABASE_URL_RO` and a production read-WRITE
> `DATABASE_URL`** (`neondb_owner` on the primary endpoint). Found by the Item 110A lane while
> discharging a receipt, not by any gate.
>
> **Two consequences worth stating plainly.** The write credential is present in every worktree,
> because the setup instruction above tells you to copy that file into each new one. And the guardrail
> against an unauthorized production write is therefore **agent compliance, not an absent credential** —
> which is a materially weaker guarantee than the sentence implied, and the reason it is being corrected
> rather than softened.
>
> **The rail still stands and is still the rule: read through `DATABASE_URL_RO`.** Never open a
> connection with `DATABASE_URL` from a worktree.
>
> **RESOLVED IN CODE 2026-09-10 — [#703](https://github.com/znpruitt/cfb-app/issues/703), merged
> `85d5912d`.** `recover-game-stats` now reads the write credential from `.env.operator.write.local`
> and **only in `--apply`**; its `capture` mode runs on the read-only rail and cannot write even by
> accident. The refusal names the file, the key, the source, and says **not** to run `vercel env pull`.
>
> **THE CREDENTIAL MOVE IS NOW DONE, AND THIS PARAGRAPH USED TO SAY IT WAS NOT.** It read: *"Until
> `DATABASE_URL` is deleted from `.env.operator.local` in every worktree, the exposure is exactly what it
> was."* **Verified 2026-09-12 on this machine, key names only:** all three worktrees
> (`cfb-app`, `cfb-app-claude`, `cfb-app-codex`) carry `DATABASE_URL_RO` and nothing else, and
> `.env.operator.write.local` exists in the primary worktree ALONE. That is exactly the end state #703
> specified.
>
> **Scope of that check, stated because the claim decays:** one machine, one moment, filenames and key
> names — not values, not any other machine, and not tomorrow. The setup instruction above still says to
> copy `.env.operator.local` into each new worktree, so **the exposure remains recreatable by following
> the documented setup**, which is why the detector still matters rather than being obviated.
>
> **[#721](https://github.com/znpruitt/cfb-app/issues/721) is therefore UNBLOCKED.** It was deliberately
> gated on this deletion — a check that cannot pass on any machine is a line people learn to skip — and
> it can now ship green. It is a detector, not a fix: it warns when `DATABASE_URL` reappears in
> `.env.operator.local`, and #721 itself rules that it must not be fatal.

`docs/deployment-runbook.md` is canonical for the contract, the autosuspend behaviour, and the
privilege probe. The application must never read through this rail; `src/` contains no reference to
it and must not gain one.

---

## Debugging order

Always diagnose upstream-first — never start at the UI when an upstream layer may be wrong:

```text
1. API response
2. normalization layer
3. canonical game model
4. attachment layers
5. UI
```

The architecture map lives in `AGENTS.md` → **Architecture overview** and
`docs/CFB_APP_ARCHITECTURE.md`.

---

## Preview branch

**Push `preview` with EVERY commit on a feature branch — not once at the end, and never after a
merge.** Owner rule, 2026-08-17.

```bash
git push origin HEAD                 # the branch
git push origin HEAD:preview --force # and preview, same breath
```

Who pushes `preview`, on what cadence, and what a docs-only push does and does not redeploy are
stated in `AGENTS.md` → **Preview branch**, which is the file Codex reads and the file binding rules
belong in. `docs/deployment-runbook.md` §6d is canonical for the build gate itself. Do not restate
either here; the duplicate is how these files drifted apart in the first place.

`preview` exists so the owner can click through whatever the branch currently is, at any point. That
only works if it tracks the branch continuously, so the two pushes go together — including for
docs-only and closeout commits, which otherwise leave preview a commit behind.

**After a merge, do nothing.** `main` is production, so pushing `main:preview` makes preview a
duplicate of what is already live: no new information and a wasted deployment. The one exception is
clearing genuinely stale work — if `preview` still holds an abandoned branch, resetting it to `main`
is housekeeping, not verification, and should be described as such.

**Preview reads its own database.** Vercel/Neon spins off a child branch so preview testing cannot
mutate production data, which means preview's durable state is a point-in-time copy and NOTHING
writes scheduler receipts there. System Health on preview always reports scheduler delivery as late
and provider data as stale — correct about its snapshot, and silent about production. Diagnose
platform health on production only; `docs/deployment-runbook.md` §6c has the detail.

**THE PLANNING SESSION NEVER PUSHES `preview`.** Added 2026-09-07 after violating it about ten times
in one session. The rule above says "every commit on a FEATURE BRANCH", and the planning worktree is
on `main` — so a planning `git push origin HEAD:preview` publishes production to preview AND silently
clobbers whichever implementation branch was there, leaving the owner nothing to click through and no
error to notice. `preview` belongs to the implementation lane that currently holds it. If it needs
restoring, push that lane's branch to it explicitly, never `HEAD`.

**A BRANCH WITH NO RENDERED CHANGE MUST NOT TAKE `preview`. SKIP IT, DO NOT CLAIM IT.** Added
2026-09-24 after the #872 lane — a test-only branch, zero user-visible change — force-pushed over
the #726 branch that the owner was mid-review on. **It followed the "push preview with every branch
commit" rule mechanically, and the rule as written told it to.** The purpose clause two paragraphs up
is the discriminator: `preview` exists **so the owner can click through whatever the branch currently
is**, and a branch with nothing to click through has nothing to offer that surface. Tests, comments,
ledgers and tooling do not earn it.

**And the "check before you take it" instinct cannot close the race.** That lane DID check, found
preview at an ancestor of `main`, and reasonably read it as stale — the other lane took it between
that check and the push. **The check cannot see a claim that lands in the window**, exactly as merge
condition 2's `git pull` cannot see a commit landing before GitHub's merge. **So the defence is not
checking harder; it is not competing for the branch when you have nothing to show.**

**Restoring it is the HOLDING lane's job, not the clobbering lane's and never planning's.** A
restore push from the wrong worktree is refused (`Modify Shared Resources`), which is the guard
working. Relay it; do not route around it.

**Only one lane can hold `preview` at a time.** Two implementation worktrees run concurrently; the
branch on `preview` is whichever the owner is currently reviewing. Say which one it is when it
changes.

`preview` is a throwaway surface, so the force push is intentional. Never open a PR from `preview`;
never merge `preview` into `main`. Do not push unreviewed work there.
