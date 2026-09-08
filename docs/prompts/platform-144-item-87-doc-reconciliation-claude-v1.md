PROMPT_ID: PLATFORM-144-ITEM-87-DOC-RECONCILIATION-CLAUDE-v1
PURPOSE: Read the Item 87 document set end to end and mark every claim in place — current, superseded, or discharged — so the next prompt author reads a corrected source instead of trusting a summary of one.
SCOPE: `docs/campaigns/item-87-*.md` and `mockups/matchups-schedule-mockup.html`. Verdicts are EDITS to those files plus the index. NOT `src/`. NOT `docs/prompts/`. NOT Item 87's entries in `docs/next-tasks.md` — the planning lane holds those and is standing off your files in exchange.
CARRIES: obligations 1, 2 and 6 from `docs/campaigns/item-87-INDEX.md`, quoted verbatim in the task block below. Obligation 6 is the one that bites this slice directly.

Read `AGENTS.md` first. Nothing in it is restated.

## THIS IS A SESSION'S WORK, IT SHIPS NOTHING, AND IT UNBLOCKS FOUR ITEMS

**Say that plainly to yourself before starting, because the pressure to shortcut it is the reason it
has not happened.** A full read costs a large chunk of context and produces no commit anyone can
click through and no shipped fix. Meanwhile every individual question along the way is answerable by
grepping the one claim in front of you. **Each grep looks like the efficient choice.** The cost only
appeared in aggregate — three wrong statements and one wrong implementation in two days.

**2,273 lines across 16 documents. Perhaps 350 have ever been read.** This is not a document set with
some stale entries. **It is a document set that has never been read.**

It blocks Items **115, 119, 134 and 118** — the entire remaining UI spine.

## Why an implementation lane has this, when `CLAUDE.md` gives `docs/` to planning

**Deliberate exception, owner decision 2026-09-08.** The table's rule exists because two sessions
sharing a checkout collide; the real requirement is **file disjointness, not file ownership**. Two
reasons it sits here:

- **Context.** The planning session holds the queue and the cross-item rulings. A 2,273-line read is
  the wrong use of the scarcer resource.
- **Position.** Half this work is checking claims against the CODE. That is your natural mode, and it
  is how a `discharged` verdict gets earned rather than assumed.

**The planning lane is standing off `docs/campaigns/item-87-*` and Item 87's `next-tasks.md` entries
for the duration.** Do not edit `docs/prompts/` or `next-tasks.md`; those stay with planning.

## READ ORDER — owner decision, and the first choice was corrected

1. **`item-87-live-watchlist-scoreboard.md` — 651 lines — FIRST.** It is canonical. **Until it is read
   end to end, every claim about what is canonical is unverified — including the ones the index rests
   on.** Three of its lines have been read. Every "canonical for X" statement made in the last two
   days about placement or the record rule rests on those three spots.
2. **`item-87-followon-team-highlight.md` — 90 lines.** Its status mark was already wrong once.
3. The remaining thirteen, plus the mockup.

## THREE VERDICTS. The third is the one that saves time and nobody had named.

| verdict | meaning |
| --- | --- |
| **CURRENT** | Authoritative. Nothing overrides it. |
| **SUPERSEDED** | A later document overrode it. Name which, and where. |
| **DISCHARGED** | It was an OBLIGATION, the work was DONE, and nothing marked it. |

**Discharge is why the known count overstates the rot.** Of the ten known claims in
`matchups-schedule-design.md`, **at least five are discharged rather than stale** — verified
2026-09-08: `rank` AND `rankSource` both exist on `CompactGameScoreboard`; `neutralSite` is at `:23`,
`:85`, `:151`; the contract widenings are implemented and in `DESIGN.md`; the recommended sequence has
shipped. **An obligation satisfied and unmarked gets re-litigated as an error by the next reader**, and
one already was — a reviewer reported the discharged widenings section as a stale claim.

**DO NOT transfer that ratio to the unread 1,900 lines.** It was measured on a sample of already-
identified claims and says nothing about the population nobody has read. The owner sized this item on
that arithmetic and withdrew it; do not repeat the error in the other direction either.

## STOP — post a READ RECEIPT before editing anything

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Read `live-watchlist-scoreboard.md` end to end FIRST**, then report: its total line count, and
   **every section that any other document or `DESIGN.md` claims is "canonical"** — with your verdict
   on whether it actually is. This is the item's central question and the receipt is where you show
   the read happened.
3. **Quote `item-87-followon-team-highlight.md:23` and `item-87-followon-presentation-decisions.md:90`.**
   Say whether they conflict, and on what axis each operates. **Two readers marked this document
   SUPERSEDED without opening it and were wrong**; say what the correct mark is and why.
4. **Count the documents that contain an OBLIGATION** — an instruction addressed to an implementer,
   prompt author or future slice, as opposed to a decision. For each, give its line number as a
   percentage of the file, and its verdict. **Obligations below the first screen are the failure this
   item exists to fix**; the count is the measurement of it.
5. Anything that CONTRADICTS what you were handed. **The claim that at least five of ten are
   discharged is mine and is checkable — check it**, and say if the number is wrong.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/144-item-87-doc-reconciliation` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all` and refuses a failing push.

**Do NOT push `preview`.** Codex holds it, and `CLAUDE.md`'s standing push-every-commit instruction is
suspended for this branch.

<task>
**Output is EDITS, not a report. This is the whole design.** A report would be a seventeenth document
describing sixteen others, and it would go stale the same way. **Mark each claim in place** — in the
document that makes it — and **promote the index entries from "the owner's best knowledge" to
verified**. That is what makes this something the next person inherits rather than redoes.

1. **Every document gets a verified status mark** in `item-87-INDEX.md`, replacing the current marks,
   which were written from partial reads and second-hand accounts. `PARTLY SUPERSEDED` entries **name
   which sections are which** — most documents are mixed, and marking a mixed document wholly
   superseded loses the part still governing.
2. **Mark claims in the documents themselves.** A superseded claim says what overrides it. A
   discharged obligation says it is done and where the work landed. **Do not delete anything** —
   history is preserved by marking what a document no longer governs, not by removing it.
3. **Every obligation you find goes in the index's CARRY block**, with its state. Obligations are
   what a prompt author must carry; the reasoning stays in the document that worked it out.
4. **Fix the register of conditional rules.** `records.md:37` — *"live and final rows omit the inline
   parenthetical"* — is a DEGRADATION rule for when records are unavailable, written in the same
   voice as the primary rule three sections earlier and read as a contradiction. **Make conditional
   rules visibly conditional.** One clause each; it is not a status question.
5. **The mockup is in scope.** Its prose contradicts its own CSS on Matchups column count — prose says
   two, CSS ships a three-column tier at 1372px with the arithmetic derived. Reconcile it.

**CARRIED OBLIGATIONS — verbatim from the index, and 6 governs your own edits:**

> **6 — LIVE. Do not "restore" the mockup's tint inset.** The mockup specifies `inset: -1px -8px`; the
> implementation ships `0 -8px` plus squared facing corners. **Anyone reconciling the two changes the
> MOCKUP, not the code** — the mockup's value predates the both-rows-tint rule and produces a darker
> stripe at the seam. (`team-highlight.md:59-62`, owner decision 2026-09-06)

> **1 — LIVE.** A build with records absent or stale **will not match the mockup**, and a reviewer
> comparing them must read that as a **sequenced dependency, not a defect**.
> (`live-watchlist-scoreboard.md:236`, `records.md:42`)

> **2 — LIVE.** Item 92 refreshes in the **live-scores cron**. Never hook `handleGamesFinalized` — a
> per-browser client callback, which inverts the cron-spends / client-reads split of PLATFORM-086B2B
> and PLATFORM-075. (`records.md:51`)
</task>

<gate>
**Do NOT touch `src/`.** If a document is wrong about the code, the DOCUMENT is wrong — mark it. If
the CODE is wrong against a canonical document, that is a FINDING for the queue, not a fix here.

**Do NOT delete or rewrite history.** Mark, do not erase. The additive approach was chosen to preserve
history and the conclusion drawn from it was wrong, but the premise was sound.

**Do NOT edit `docs/next-tasks.md` or `docs/prompts/`.** Planning holds those and is standing off your
files in exchange. Report queue findings; do not file them.

**Do NOT resolve a contradiction by picking the newer document by default.** `team-highlight.md` and
`presentation-decisions.md` look contradictory and are not — they operate on different axes. **A real
conflict needs both claims quoted and the axis named** before either is marked.

STOP and report if the canonical document turns out to contradict `DESIGN.md`, or if resolving a
contradiction needs an owner decision rather than a reading.
</gate>

<completeness_contract>
- **All 16 documents read end to end**, in the stated order. Report the order you actually read them
  in; a skipped document is a hole in the result and cannot be inferred from the others.
- **Every index entry is verified**, and says so — none may remain at "best knowledge".
- **Every obligation found is in the CARRY block** with its state, and its depth as a percentage.
- **The five claimed-discharged items are each confirmed against the code**, or corrected.
- **No claim is marked from another document's account of it.** That error has now been made twice; a
  mark requires the file open.
- Report the count of claims marked, split by verdict.
</completeness_contract>

<verification>
`npm run lint:all` — the only gate that applies, and note that `lint:all` does NOT prettier-check
`docs/`; markdownlint only. **MD049 emphasis style has bitten five times in one session**: a single
inserted asterisk in an underscore file flips every underscore below it. Match the file you are
editing.

`npx tsc --noEmit` and `npm test` should be unchanged — if either moves, you have touched `src/`.
</verification>

<output_contract>
Report: which documents changed and how many claims each gained a mark; the split by verdict; every
obligation promoted, with its depth; and every place a document was found wrong about the code.

**Report separately, as queue findings for planning to file:** anywhere the CODE is wrong against a
canonical document. `DESIGN.md:95` — the right-edge anchor rule against Matchups' scheduled rows — is
one already known; expect more.

**Say plainly whether the canonical document says what everyone has been assuming it says.** That is
the question this item exists to answer, and a report that does not address it directly has not
delivered.

Closeout: registry entry, and the index's own maintenance note updated to say the set is verified as
of this pass and what that verification covered.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the
four conditions. **Push the branch only — not `preview`.**
</output_contract>
