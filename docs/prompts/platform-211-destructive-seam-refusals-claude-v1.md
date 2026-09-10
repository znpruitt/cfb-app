PROMPT_ID: PLATFORM-211-DESTRUCTIVE-SEAM-REFUSALS-CLAUDE-v1
PURPOSE: Item 211 — three destructive test-only seams outside `appStateStore.ts` still execute with isolation off, deleting real rows for their scope. Give them Item 210's refusal.
SCOPE: `durableOddsStore`, `oddsUsageStore`, `teamDatabaseStore` — their delete seams and tests. NOT `appStateStore.ts` (Item 210, shipped `421fab9c`). NOT the corrupting seam, which shipped with it. NOT the per-run-unique path (Item 209).
CARRIES: NONE, having checked `item-87-INDEX.md` — audit-spine item with no Item 87 surface.

Read `AGENTS.md` first — **Verification (binding)** now carries the one-sided-mutation rule this item
will need, and it came from the Item 210 lane catching itself.

## The three seams

`durableOddsStore.__deleteDurableOddsStoreFileForTests(season)`,
`oddsUsageStore.__deleteOddsUsageStoreFileForTests()`,
`teamDatabaseStore.__deleteTeamDatabaseStoreFileForTests()`.

**All route through `deleteAppState()`**, which with a configured `DATABASE_URL` runs
`delete from app_state where scope = $1 and key = $2` against real rows. **Item 210's guard 1 covers
them whenever isolation is ON.** In the bare `node --test src/...` case the flag is unset, guard 1 is
silent by construction, and these delete production rows for their scope.

**Reuse, do not reinvent.** Item 210 exports `appStateTestSeamRefusal(seam, damage)` and
`assertTestSeamAllowed`, and its suite in `appStateStore.test.ts` is the test shape. **Three new
message vocabularies would be the drift Item 210's finding 5 was about.**

## MUTATION SAFETY IS THE DESIGN PROBLEM, AND IT HAS ALREADY FIRED TWICE

**A test for a refusal must run the unguarded path to prove the guard works, so its failure mode IS the
damage.** On the Item 210 branch this happened twice: the guard-2 mutation ran with the flag unset and
lost nothing only because no dev store existed, and **the corrupt-seam mutation actually wrote
`{not-valid-json` to `data/app-state.json`** before it was sandboxed.

**The mitigation differs by seam shape.** Pinning `DATABASE_URL` to an unreachable port (Item 210 used
`127.0.0.1:1`; Codex reached the same technique independently) works for a seam with a database branch —
the call fails at connect, before touching anything. **A seam whose write is unconditional has no such
branch and needs a relocated `cwd` instead.**

**All three here route through `deleteAppState()`, which has a database branch, so pinning should
suffice. Verify it; do not assume it.** If any of the three can reach a file write with the flag unset
and no `DATABASE_URL`, pinning does nothing for that one.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **For each of the three seams, trace what it does with the flag unset — in BOTH environments:**
   `DATABASE_URL` set, and unset. **Quote the branch.** If any reaches a file write in the unset case,
   say so — that one needs a relocated `cwd`, not a pinned URL.
3. **Name the mitigation you will use per seam, and why**, before writing a test that could destroy
   something.
4. **Confirm Item 210's exports are reusable as-is**, or say what they need. A fourth message vocabulary
   is a finding, not a solution.
5. **Are these three the complete set?** Item 210 enumerated 34 seams and called 4 destructive. **Re-run
   that enumeration against current `main`** — 210 shipped two of them, and the count should now be two
   remaining plus these three, or your number, stated as measured.
6. Anything that CONTRADICTS what you were handed.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/211-destructive-seam-refusals` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`. **Do NOT push `preview`** — Codex holds it.

<task>
1. **Refuse each of the three seams when `APP_STATE_TEST_ISOLATION !== '1'`**, using Item 210's exports.
2. **Sandbox every mutation before running it**, per the mitigation named in receipt item 3.
</task>

<gate>
**Do NOT run an unguarded destructive path without the sandbox in place.** This has already cost a dev
store once on the Item 210 branch. **The sandbox precedes the mutation, not the other way round.**

**Do NOT invent a new refusal message shape.** Item 210's exports are the vocabulary.

**Do NOT change what these seams do under isolation.** Only the refusal outside it is new.
</gate>

<completeness_contract>
- **Each seam refuses independently**, asserted per seam — one test covering all three proves none of
  them.
- **Each refusal is proven by mutation, and the report says WHICH SIDE STAYED GREEN** — `AGENTS.md`
  now binds this: a mutation reddening both the old and new assertion discriminates nothing.
- **Under isolation each seam still works**, asserted separately from the refusal.
- **`data/app-state.json` is absent after the suite**, asserted — the direct check for the damage that
  already happened once.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the per-seam mutations with the green side
named; the enumeration from receipt item 5; and anything you deliberately did not do.

**State explicitly that no mutation ran unsandboxed**, and what the sandbox was per seam.

Closeout is a separate pre-merge commit after review convergence: registry entry and Item 211 status.
`docs/next-tasks.md` stays with planning.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. **Verify the remote ref moved before reporting a push.**
</output_contract>
