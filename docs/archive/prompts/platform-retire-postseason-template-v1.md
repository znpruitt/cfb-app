PROMPT_ID: PLATFORM-RETIRE-POSTSEASON-TEMPLATE-v1
PURPOSE: Delete `src/lib/postseason-template.ts`, a 183-line module with zero callers whose hardcoded provider week numbers are already wrong for 2026. Removal only; nothing replaces it.
SCOPE: `src/lib/postseason-template.ts` (delete) and any import or test that fails once it is gone. No behaviour change, no new module, no edit to `postseason-classify.ts` or any live postseason path.

Read `AGENTS.md` first. It is canonical for scope/sizing, verification, review limits and reporting;
this prompt does not restate or override those rules. Queue context and the full evidence are in
`docs/next-tasks.md` → **Item 123**.

<task>
Delete `src/lib/postseason-template.ts` on branch `platform/retire-postseason-template`.

`buildPostseasonTemplate` appears exactly once in the repository — its own definition. Verified: no
consumer in `src/`, none in `scripts/`, and no test file references it. It exists to mint postseason
placeholders (one conference-championship slot per conference, four bowl slots, and a playoff
bracket) for a surface that was never built.

Three things make it wrong to revive rather than delete, all recorded in Item 123:

1. It hardcodes provider week numbers — conference championships pinned to `week: 15`, bowls and
   playoff to `week: 17`. That matched 2024 and 2025, where CFBD filed the nine championship games at
   week 15 and Army–Navy at 16. **2026 has already shifted:** CFBD places Army–Navy at week 15
   (Dec 12, MetLife), so the championships will land at 14.
2. It has no first-round slots — four quarterfinals, two semifinals, one championship, i.e. the
   12-team bracket missing its first round entirely.
3. Its bowl set is four (Rose, Sugar, Orange, Cotton), a fragment the 12-team format made ambiguous
   since a quarterfinal *is* a bowl.

The live classifier (`postseason-classify.ts`) is provider-driven and handles placeholders today.
This module is a second, unmaintained model of the same structure.
</task>

<completeness_contract>
All of it, or stop and report which part you could not meet:

- `src/lib/postseason-template.ts` is deleted, along with its test file if one exists.
- No other file changes, unless a compile or lint failure forces it. If one does, report the file and
  the exact error rather than working around it — an importer would contradict this prompt's premise
  and is a stop condition, not a task.
- `grep -rn "postseason-template\|buildPostseasonTemplate\|TemplateEvent" src scripts` returns
  nothing after the deletion. Report the command and its output.
</completeness_contract>

<missing_context_gating>
Proceed by default. STOP and report instead of deciding on your own if any of these is true:

- Anything imports the module, or references `buildPostseasonTemplate`, `TemplateEvent`, or
  `BOWL_TEMPLATES`. The premise of this item is that nothing does; a hit means the item is wrong and
  needs re-scoping, not that you should rewire the caller.
- `npm run build` fails for any reason connected to the deletion.
- You find a second module doing the same job. Report it; do not also delete it.
</missing_context_gating>

<verification_loop>
Follow `AGENTS.md` → Verification. Every gate is its own shell command with its own real exit code,
reported as such — never behind a pipe, `grep`, or `tail`. Report the exact commit SHA the gates ran
against and that the tree was clean and HEAD unchanged at that moment.

Required gates:
1. `npx tsc --noEmit`
2. `npm run lint:all`
3. `npm test`
4. `npm run build` — **required, not optional.** This is a module deletion, and the build is the gate
   that catches a stale import a type-check can miss. A previous retirement in this repo shipped a
   claim of deletion that this gate would have caught.

Report test DELTAS (before/after counts), not just a passing total. A deletion with no test change is
the expected result here; say so explicitly rather than leaving it unstated.
</verification_loop>

<action_safety>
- Branch `platform/retire-postseason-template` off current `main`. Do not commit to `main`.
- **Do NOT push `preview`, or any other preview branch.** `AGENTS.md` → Preview branch: `preview`
  belongs to Claude alone, decided 2026-08-18 precisely because parallel worktrees made a single
  force-pushed branch ambiguous — it shows whichever agent committed last and changes under the owner
  mid-review with no indication of which branch is on screen. Push your feature branch only
  (`git push origin HEAD`). Your work reaches the owner as a branch to pull and run, not as a URL.
- Verify locally instead. If you run a dev server, **use port 3010** — both worktrees default to 3000,
  and killing a dev server can orphan the `next-server` child, which then serves stale code from that
  port.
- No opportunistic refactoring. Item 121 (the CFP first-round `eventKey` collision) is adjacent and
  explicitly NOT in scope, even though this module's slot-numbered keys are the convention that fixes
  it. Leave that observation to Item 121.
- Do not write the `docs/prompt-registry.md` entry or flip any ledger status. Closeout happens
  pre-merge under `AGENTS.md` → Documentation closeout timing, not during implementation.
</action_safety>

<compact_output_contract>
Report in this order, per `AGENTS.md` → Reporting expectations for Codex tasks:

1. What changed — one line; this is a deletion.
2. The grep output proving no references survive, as run.
3. Whether behaviour changed (expected: none) and whether any other file had to change.
4. Verification: each gate as its own line with its real exit code, the commit SHA, and the test delta.
5. Anything you found that contradicts this prompt's premise, stated as unresolved rather than fixed.
</compact_output_contract>
