# PLATFORM-827 — Overview live records closeout

Status: Implemented and reviewed; pre-merge closeout, not a deployment claim.
Prompt: `PLATFORM-827-OVERVIEW-LIVE-RECORDS-CODEX-v1`.
Branch: `codex/platform-827-overview-live-records`.
Base: `46bb075d4a09394bdb62a32d40911a15edffd0a8`.
Implementation: `7ddf528ac127957c354d00f02704e675d2464aa1`.
Remediation: `4cba1014ffdec3b9020a4f2f03ab1fb0210799df`.

The owner's dispatch/receipt amendments govern acceptance below: the in-season podium
path, fallback Insights only, the exact movement caption, and acceptance 6. The kickoff
file at the base still contains five acceptance items and its older broader wording.

## Acceptance 1 — live values and ordering

Passed. `standingsTopN` and `standingsHasMore` consume live canonical rows. The shared
partial-week fixture has W1/W2 resolved and W3 unfinished, with changed records and leader
order. It renders the actual in-season podium path (`OverviewPanel.tsx:628`, choosing
`standingsLeaders.slice(0, 3)`), and explicitly asserts `heroMode === 'leader'` and empty
`podiumLeaders`. The completed-season selector is not used to establish this acceptance.

Before production edits, `827: partial-week table and in-season podium share live records
and ordering` failed **`partial-week table matches the rendered in-season podium`**:
the table began BHooper 15–4; the podium began Chamness 17–6. Restoring the resolved table
source after the fixture was refined to supply canonical props failed that assertion
again. The fixed test passes. Separate zero-value mutations failed **`table Win% and Diff
stay live`** (each metric) and **`table GB stays live`**. Restoring resolved overflow failed
**`overflow comes from live population`**. This is not the old completed-week false pass.

## Acceptance 2 — resolved movement and truthful labels

Passed under the owner ruling. The arrow reads `selectPositionDeltas` by owner, independent
of displayed live rank. The fixture deliberately renders live leader Chamness with a
resolved W1-to-W2 drop. The caption is **Movement · through W2**; before any week resolves,
it is **Movement · awaiting first resolved week**. One resolved week names W1 but shows no
arrow; a pair is required. Accessible names state both ends, for example **Moved down 2
places from W1 to W2**.

Indexing delta maps by displayed position failed **`arrows compare W1 to W2 by owner even
when live rank reverses movement`**. Replacing the boundary caption failed **`movement
names latest resolved boundary`**; a false W0 label failed **`sparse history label is
truthful`**; removing pair/null suppression failed **`two resolved snapshots are required
for arrows`**.

The accessibility remediation has a discriminating positive control: **the old
attribute-inspection test stayed green while the new role-and-name query caught the
defect**. Before `role="img"`, **`down arrow exposes its full comparison as an accessible
image name`** failed with 0 matches instead of 1. With the role, it finds one down-arrow
image and two up-arrow images by their complete names. The old observer could not see
what it claimed to check; a label attribute alone did not prove an accessible name.

Caption policy for absent history is filed as [#855](https://github.com/znpruitt/cfb-app/issues/855).
The proposed `deltaWeeks != null` gate would hide both absent-history and zero-resolved-week
cases, so this closeout does not silently remove the accepted waiting caption.

## Acceptance 3 — resolved fallback Insights

Passed. The actual read is `OverviewPanel.tsx:1778`: `deriveResolvedMovementStandings`
supplies the latest resolved rows, with the existing live-row fallback only when no
resolved snapshot exists. `engineInsights` rank first and are supplemented by this
fallback; the whole feed is not claimed to be resolved-only.

Feeding live rows to the fallback failed **`fallback race describes the resolved leader`**.
Removing engine entries initially exposed a weakness in an index-order assertion; adding
an explicit presence check made the same mutation fail **`engine insight remains present`**.

## Acceptance 4 — preserved surfaces

Passed within scope. Reversing the in-season podium failed **`in-season podium stays live`**.
Removing GB chart weeks failed **`chart observer sees plotted paths`**. Substituting resolved
GB for the companion's live total failed **`GB companion uses live BHooper total`**.
Reversing rows supplied to Standings movement failed **`Standings keeps W1 to live W3
movement`**. These surfaces retain their previous inputs.

GB Race deliberately combines resolved chart/history values with live companion totals.
The pending chip also remains separate: it describes in-progress games while base records
count finals. The live-rank/resolved-arrow adjacency is ruled, not a defect cleared by
silence. Overview/Standings endpoint divergence remains [#851](https://github.com/znpruitt/cfb-app/issues/851);
the reported production upward-three magnitude has not been reconstructed from stored history.
The arrow/cell palette mismatch is filed as [#856](https://github.com/znpruitt/cfb-app/issues/856).
Neither follow-up is claimed to violate an explicit DESIGN.md prescription: its right-edge
numeric-delta green/red rule already describes the cells, not the left-side arrow's shades.

## Acceptance 5 — comments match their consumers

Passed. The live-records note names the partial-week rendering test and now sits beside
`standingsTopN`/`standingsHasMore`. Moving it corrects the orphan caused by `4cba1014`.
The earlier false claim that the GB chart uses live rows was removed during implementation.

The helper docblock loses only its rank-arrow clause. Attribution: at the base, the helper
fed the table's resolved rows and previous-row arrow input. `7ddf528a` moved the arrow to
`selectPositionDeltas`, and `4cba1014` removed the remaining dead field/call. This branch
made the guidance stale; it owns the correction. The helper remains live for fallback
Insights. These are owner-authorized closeout comment corrections, not a second behavioral
remediation round. DESIGN.md itself was not edited; its shipped-status annotation remains
owned by planning.

## Acceptance 6 — store failure never becomes empty standings

Passed. Canonical store handling is unchanged. The existing test **`getCanonicalStandings
rejects on a store read failure instead of returning an empty snapshot`** rejects, and
**`after a failed standings read, a recovered store computes real standings`** proves recovery.
Mutating the canonical league-store read to `.catch(() => null)` failed both rejection
assertions with **Missing expected rejection.** Ordinary null history still preserves
available rows; it is not treated as a store failure or a reason to manufacture empty rows.

## Review provenance and the blocked attempt

The implementation receipt's statement that no confirming Claude review had run was true
when written. It became stale after the owner ran reviews in another session. A confirming
`/code-review high 4cba1014ffdec3b9020a4f2f03ab1fb0210799df` **did run later**: dispatched
2026-09-22 19:57:56 UTC, completed 20:03:43 UTC, with four low findings. Both reviewers
returned substantive results against `4cba1014` before these closeout edits.

Claude evidence is in local session `f6177bef-f933-4f06-b2bd-d35c055eba19`, task
`a442d4884c4e91de4`. The parent transcript records dispatch at line 112 and completed
result at line 116. Its subagent transcript records HEAD `4cba1014` and clean status at
lines 12–13, and the actual review command at line 21:

```text
git diff main...HEAD -- src/lib/selectors/overview.ts src/components/OverviewPanel.tsx src/lib/__tests__/selectors-overview.test.ts
```

**Exit status distinction:** this Claude review was an agent task, not a shell review
process. Its recorded status is `completed`; no numeric review exit code exists in that
artifact. The diff tool result is `is_error: false`. There is no literal `46bb075d` in
that reviewer command. Neither datum is invented to match the Codex runner's format.
Closeout independently reproduced its returned diff with this explicit command (exit 0):

```text
git diff 46bb075d4a09394bdb62a32d40911a15edffd0a8 4cba1014ffdec3b9020a4f2f03ab1fb0210799df -- src/lib/selectors/overview.ts src/components/OverviewPanel.tsx src/lib/__tests__/selectors-overview.test.ts
```

The output matches the review's returned diff byte-for-byte after trimming trailing
whitespace at EOF. SHA-256 of both normalized texts:
`a1b38d5dba819fb6bdac962888aaa51d8c7291b054944fe5fa666cc20d2ce498`.
This is explicit-base reproduction evidence, not a fabricated reviewer transcript line.

Codex round 2 is task `br9qygmha`, completed 20:49:20 UTC, **exit 0**, clean verdict with
focused tests executed at `4cba1014`. Its transcript contains:

```text
[codex] Running command: /bin/zsh -lc "git diff --stat 46bb075d4a09394bdb62a32d40911a15edffd0a8; find .. -name AGENTS....
[codex] Command failed: /bin/zsh -lc "git diff 46bb075d4a09394bdb62a32d40911a15edffd0a8; find src -name 'AGENTS*'; wc... (exit 1)
[exited with code 0]
```

Four transcript diff lines carry the base prefix. The compound full-diff command's exit 1
is retained as a coverage caveat; the review then read targeted files and executed tests.
Its clean verdict is not coverage of every caption/palette line or of #851 outside the diff.
Round 1 targeted `7ddf528a`: Claude returned one medium/three low; Codex exited 0 with a
clean verdict and tests inspected, not executed. Its three diff lines carried the same base.

**A separate attempted review was blocked, not clean.** This implementation session's
Claude CLI first reported `Not logged in`. The subsequent authenticated invocation was
rejected by automatic approval review because it could transmit private source/diff to
an external service without explicit authorization. That rejected invocation never ran;
no exit-0 or clean-review credit is assigned to it. The later owner-invoked completed
review above is a different run. No workaround of the rejection was attempted.

## Verification and remaining boundary

At clean, unchanged `4cba1014`: `npm test` exit 0 (5,490 passed, zero failures/cancellations/skips),
`npm run lint:all` exit 0, `npx tsc --noEmit` exit 0, and `npm run test:browser:required`
exit 0 (seven passed, zero skips). The combined review record's claimed lint gap was wrong:
the implementation run covered test files too. The accessibility test is the eighth new
test case; no existing test case was removed or weakened to permit the fix.

The closeout changes only the two comments and documentation. Its new exact commit is
re-gated separately; those exit codes and SHA belong in the accompanying final handoff,
not carried forward from `4cba1014`. Nothing here claims merge, deployment, or a fresh
independent review of the closeout commit.
