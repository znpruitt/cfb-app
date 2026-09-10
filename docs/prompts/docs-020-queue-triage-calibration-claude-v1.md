PROMPT_ID: DOCS-020-QUEUE-TRIAGE-CALIBRATION-CLAUDE-v1
PURPOSE: The queue holds 148 unmarked items, 56 of them numbered below 100 and untouched for weeks. Triage TEN of them against the code, then STOP — this slice measures the job before anyone commits to the other 46.
SCOPE: READ `docs/next-tasks.md` and `src/`. WRITE only `docs/archive/audits/queue-triage-2026-09-10.md` (new). **Do NOT edit `docs/next-tasks.md`** — planning owns it and applies your verdicts.
CARRIES: NONE, having checked `item-87-INDEX.md` — this is a queue-hygiene item, not an Item 87 item.

Read `AGENTS.md` first. **This is a `docs/` slice in an implementation lane by exception** —
`CLAUDE.md` → *Worktrees and session roles* permits it when the work is a large read, precedent Item
144. **Planning stands off `docs/archive/audits/queue-triage-2026-09-10.md` for the duration.**

## Why this exists

`docs/next-tasks.md` is **7,370 lines, ~126,000 tokens.** Nobody reads it; everyone greps it, including
planning. **A queue reachable only by search has stopped being a queue.** 148 item headings carry no
DONE marker, and **56 are numbered below 100** — filed weeks ago, untouched since.

**The suspicion is that most of the sub-100 tail is dead**, superseded by work that shipped after it was
filed; the Item 87 campaign alone rewrote much of the surface those items describe. **That is a guess,
and this slice exists to replace it with a measurement.**

## THE ONE RULE THAT MATTERS

**Judge each item against the CODE, never against its own description.** An entry says what someone
believed when they wrote it. Only `src/` says what is true now. **An item that reads as obviously stale
may describe a defect that still reproduces, and an item that reads urgent may describe a function
deleted in August.**

This campaign has a filed rule for the failure this invites — `AGENTS.md`: a design says what was
DECIDED, only code says what EXISTS. **A triage done by reading is not a triage; it is a re-read.**

## The ten

Evenly spaced across the tail, so the sample says something about the whole range rather than about its
extremes: **Items 12, 19, 28, 37, 45, 51, 60, 71, 81, 95.**

**If one of those numbers has no entry or is already marked done, say so and take the next unmarked
item above it** — and report the substitution.

## Verdicts — exactly one per item, each with evidence that could contradict it

- **LIVE** — the defect or gap still exists. **Name the file and line where it exists**, and say what
  you did to confirm it. A LIVE verdict with no citation is a re-read wearing a badge.
- **SUPERSEDED** — real when filed, fixed since. **Name what fixed it** — the item, PR, or commit — and
  cite the code that now does the right thing.
- **STALE** — describes code that no longer exists. **Name the symbol and prove its absence properly:**
  a literal grep cannot prove "nothing does X" when the identifier is template-built. Grep the
  constructor or the setter, resolve every variable, and say which method you used.
- **UNCLEAR** — you cannot tell without work disproportionate to triage. **Say what specifically you
  could not establish.** This verdict is legitimate and expected; a triage with zero UNCLEARs is
  probably guessing.

**Do NOT issue a WONTFIX.** Whether a live item is worth doing is the owner's call, not triage's.

## STOP — post a READ RECEIPT before writing any verdicts

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **The ten item numbers, each with its heading quoted verbatim**, plus any substitution and why.
3. **Your per-item budget, and how you arrived at it.** This slice's output is a cost measurement as
   much as ten verdicts; a number you did not derive is useless for sizing the remaining 46.
4. **Do any two of the ten overlap?** Duplicates in the tail would change what the remaining 46 cost.
5. Anything that CONTRADICTS what you were handed — the 148 count, the 56 count, the claim that the
   sub-100 tail is untouched.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/docs-020-queue-triage` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`. **Do NOT push `preview`** — Codex holds it.

<task>
1. **Ten verdicts**, each with the evidence its verdict type requires.
2. **The measured cost per item**, and a projection for the remaining 46 with its assumptions stated.
3. **The verdict distribution** — how many LIVE, SUPERSEDED, STALE, UNCLEAR.
</task>

<gate>
**Do NOT edit `docs/next-tasks.md`.** Planning owns it and applies your verdicts. Editing it while
planning holds it is the merging-not-conflicting collision `CLAUDE.md` records from Item 110A: `ort`
merges two accounts of the same thing cleanly and nothing announces it.

**Do NOT fix anything you find.** A LIVE item is a finding, not a work order. If one turns out to be
urgent — a live production defect rather than a stale note — **STOP and report it immediately** rather
than continuing the batch.

**Do NOT triage more than ten.** The point is to size the job. Eleven verdicts is a worse outcome than
ten, because it means the budget question went unanswered.
</gate>

<completeness_contract>
- **Every verdict cites code**, by file and line, except UNCLEAR — which cites what it could not
  establish.
- **Every STALE verdict states the absence method used**, and why a literal grep would or would not
  have sufficed.
- **The cost measurement is a real number with its method**, not an estimate.
- **The distribution is reported even if it is lopsided** — ten SUPERSEDEDs is a valid and useful
  result, and so is ten LIVEs.
</completeness_contract>

<verification>
No `src/` changes, so `npm test` is not the gate here. Run `npm run lint:all` and report its exit code —
it is what the `pre-push` hook enforces on the new document.

**If you touched `src/` at all, that is a scope breach — say so.**
</verification>

<output_contract>
Everything lands in `docs/archive/audits/queue-triage-2026-09-10.md`: the ten verdicts with evidence,
the cost measurement and its method, the distribution, and any duplicates found.

**Say plainly whether the sub-100 tail looks mostly dead or mostly live**, and say it as a claim about
your sample of ten rather than about all 56 — `AGENTS.md` binds a measurement's coverage to its result.

**Recommend a batch size for the remaining 46**, with the reasoning your cost number supports.

No closeout registry entry — this ships no code and closes no item. Planning applies the verdicts to
`docs/next-tasks.md` and decides the GitHub-issue migration on the survivor count.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. **Verify the remote ref moved before reporting a push.**
</output_contract>
