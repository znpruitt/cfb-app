PROMPT_ID: PLATFORM-210-TEST-ISOLATION-GUARD-CLAUDE-v1
PURPOSE: Item 210 — `APP_STATE_TEST_ISOLATION` does not prevent database use, so an exported `DATABASE_URL` makes the whole suite read and write the live store, and one helper drops the only table. Make the flag mean what its name says.
SCOPE: `src/lib/server/appStateStore.ts` — the pool construction path and, if the receipt shows it necessary, the eleven `hasDatabaseConfig()` branch sites. Tests. NOT the per-suite delete idiom (Item 207, merged). NOT the per-run-unique path (Item 209).
CARRIES: NONE, having checked `item-87-INDEX.md` — this is an audit-spine item with no Item 87 surface.

Read `AGENTS.md` first. This is a destructive-action guard; **Core rules** and **Verification** both
bind and neither is restated.

## The defect, verified by planning before filing

**`/code-review` found the delete seam on the Item 207 branch. The delete is the symptom.**

`appStateStore.ts:1317-1325`:

    export async function __deleteAppStateFileForTests(): Promise<void> {
      if (hasDatabaseConfig()) {
        await ensureDatabase();
        await getPool().query('delete from app_state');
        return;
      }
      await fs.rm(appStateFilePath(), { force: true });
    }

**136 test files call that helper**, and `scripts/run-tests.mjs:89-91` spreads `...process.env` into
the child — setting `APP_STATE_TEST_ISOLATION: '1'` while passing any ambient `DATABASE_URL` straight
through. **`app_state` is the only table in the database.**

**But the flag never gated the database.** `APP_STATE_TEST_ISOLATION` appears in this file **exactly
once**, at `:95`, choosing a temp file path inside `appStateFilePath()` — which is only consulted in
the file-fallback branch that a configured `DATABASE_URL` prevents from running. Every read and write
branches on `hasDatabaseConfig()` alone, `Boolean(process.env.DATABASE_URL?.trim())` (`:101-103`), at
eleven sites; `getAppStateStorageStatus():114` reports `mode: 'postgres'` whenever a URL is present.

**So the quiet version of this bug is 5,105 tests writing production rows and reading real leagues
back.** The loud version is one `delete`.

**The environment makes it reachable, not hypothetical.** `.env.operator.local` carries a production
read-WRITE `DATABASE_URL` into every worktree by setup instruction, and `CLAUDE.md` already records
that the guardrail there is agent compliance rather than an absent credential.

## The likely shape — one choke point, not eleven

`getPool():207-215` constructs a real `pg.Pool` from `process.env.DATABASE_URL`, and **this file has no
pool-injection seam.** The suites that exercise the postgres path appear to mock the `pg` module itself
(`appStateKeyTransaction.test.ts:231`, `withFakePg`). **If that holds, a refusal at pool construction
covers all eleven branch sites and never reaches the mocking suites.**

**Verify it; do not assume it.** If any suite reaches the real `getPool()` under isolation, a throw
there breaks it, and the fix shape changes.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Confirm or refute that `APP_STATE_TEST_ISOLATION` gates nothing but the file path.** Quote every
   occurrence in `src/`, not just this file. **If it gates something elsewhere, that is the finding.**
3. **Prove whether any test reaches the real `getPool()` under isolation.** Make it throw
   unconditionally, run the full suite, and report which suites fail and how many. **That is the blast
   radius of the fix, measured rather than reasoned.**
4. **Say what a test run against a configured `DATABASE_URL` does today** — not what it would delete,
   but what it WRITES. Do this by reading the write paths, **not by running it.**
5. **Is `DATABASE_URL` reachable in a normal developer or agent shell?** Say how `.env.operator.local`
   is loaded, by what, and whether anything sources it automatically. **If nothing does, say that
   plainly — it bounds the severity and the queue entry should carry it.**
6. Anything that CONTRADICTS what you were handed. The single-occurrence claim, the eleven branch
   sites, the no-injection-seam claim and the `withFakePg` reading are all planning's and all checkable.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/210-test-isolation-guard` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`.

**Do NOT push `preview`.** Codex holds it.

<task>
1. **Make `APP_STATE_TEST_ISOLATION === '1'` prevent a real database connection**, at the narrowest
   point the receipt supports.
2. **Fail loudly.** A silent fallback to file mode would hide a misconfigured run; the point is that
   the operator learns immediately.
</task>

<gate>
**Do NOT break the suites that mock `pg`.** Receipt item 3 measures which they are. If the guard's
blast radius is more than a handful of files, STOP and report — that means the seam is wrong.

**Do NOT run the suite with a real `DATABASE_URL` set to prove the bug.** The bug's whole content is
that doing so is destructive. Read the paths; do not demonstrate them.

**Do NOT change production runtime behaviour.** Outside tests, `hasDatabaseConfig()` must keep meaning
what it means today.

**Do NOT touch the per-run-unique path or exit cleanup** — Item 209, which follows this.
</gate>

<completeness_contract>
- **Under isolation, a configured `DATABASE_URL` cannot open a real pool** — asserted directly, and
  proven by mutation: remove the guard and show a named test go red.
- **The delete helper cannot reach the database branch under isolation**, asserted separately from the
  pool guard. Two assertions, because one covering both proves neither.
- **Production behaviour is unchanged**, asserted with the flag absent.
- **Every suite that mocks `pg` still passes**, reported as a measured count against the receipt's
  enumeration.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation; the blast radius from receipt
item 3; and anything you deliberately did not do.

**Say plainly what a developer or agent now sees if they run `npm test` with `DATABASE_URL` set**, and
whether that message tells them what to do.

**Report the severity bound from receipt item 5** — whether anything sources the credential
automatically. That decides how this reads in the ledger.

Closeout is a separate pre-merge commit after review convergence: registry entry and Item 210 status.
`docs/next-tasks.md` stays with planning.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. **Verify the remote ref moved before reporting a push.**
</output_contract>
