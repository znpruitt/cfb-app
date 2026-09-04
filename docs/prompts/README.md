# Live prompt kickoffs

Status: Current
Last verified: 2026-09-04
Owner: Project documentation
Canonical for: where a dispatched prompt's full text lives while it is being worked.
Supersedes: (none)

Full kickoff text for prompts that are dispatched to another agent — usually Codex working in the
`cfb-app-codex` worktree. One file per `PROMPT_ID`, named for it in lowercase.

**Why this exists.** Kickoffs used to be written to a session scratchpad, which the other worktree
cannot read and which does not survive the session. Git worktrees share one object database and one
set of refs, so a file committed here on `main` is readable from any worktree immediately — no
fetch, no pull, no branch change:

```bash
git -C /Users/zach/cfb-app-codex show main:docs/prompts/<prompt-id>.md
```

That works even when the other worktree sits on an unrelated or stale branch, which is the normal
case while it is mid-task.

## What belongs here

- The full dispatched prompt: the `PROMPT_ID` / `PURPOSE` / `SCOPE` header required by `CLAUDE.md`,
  plus the task, completeness contract, gating, verification loop, and output contract.
- Nothing else. This is not a ledger.

## Rules a kickoff must not re-derive

Two get written wrong from first principles because they look like ordinary practice. Both are in
`AGENTS.md` → **Preview branch**; read it rather than inferring:

- **`preview` belongs to Claude alone. Codex does not push it, or any other preview branch.** Decided
  2026-08-18, when parallel worktrees made a single force-pushed branch ambiguous — it shows whichever
  agent committed last and changes under the owner mid-review. A dispatched prompt must say this
  explicitly, because the repo's normal cadence rule ("push the branch and `preview` together on
  every commit") is Claude's, and copying it into a Codex prompt inverts a decision.
- **The Codex worktree's dev server runs on port 3010**, not 3000. Both worktrees default to 3000, and
  killing a dev server can orphan the `next-server` child, which then serves stale code from that port.

That section also records a live trigger: **the no-preview decision is due for review if Codex takes
a slice with a user-visible surface**, since a deployed URL is how the owner has caught defects that
reviews did not. Check that trigger before dispatching UI work, and raise it rather than deciding it
inside a prompt.

## What does NOT belong here

`docs/prompt-registry.md` remains canonical for **which prompt IDs exist** and their outcomes, and
its entry is still written during the pre-merge documentation closeout — not when the kickoff is
dispatched. `docs/next-tasks.md` remains the only place that says what is NEXT (DOCS-012). A file
here is the text of a job, not a claim that the job is queued, running, or done.

## Lint

Prompt payloads are excluded from markdownlint via `"#docs/prompts/*-v*.md"` in the `lint:markdown`
script — the `<task>` / `<completeness_contract>` structure these prompts use trips `MD033`
(no-inline-html), and reformatting around it would damage the format the receiving agent reads. The
exclusion is deliberately narrow: it matches the `-v<n>` suffix every `PROMPT_ID` carries, so this
README and any future prose in this directory are still linted. `docs/archive/**` is excluded for
the same reason.

## Lifecycle

A kickoff stays here while its work is open. Once the prompt merges and its registry entry is
written, move the file to `docs/archive/prompts/` in the same closeout commit — the registry entry
is the durable record, and this directory should only ever show live work.
