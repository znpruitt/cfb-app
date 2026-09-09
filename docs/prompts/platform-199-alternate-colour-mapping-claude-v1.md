PROMPT_ID: PLATFORM-199-ALTERNATE-COLOUR-MAPPING-CLAUDE-v1
PURPOSE: Item 199 — the catalog ingest reads a provider field that does not exist, so all 138 alternate colours are discarded. Fix the mapping and refresh the catalog. Every missing team-colour bar on production follows from this one field name.
SCOPE: `src/lib/teamDatabase.ts` (the PROVIDER record type and its read), the catalog refresh, and tests. NOT `teamColors.ts`. NOT the stored field name. NOT Item 198's fallback rule.
CARRIES: NONE.

Read `AGENTS.md` first. Nothing in it is restated.

## Confirmed, with one CFBD call

`GET /teams/fbs`, HTTP 200, 138 rows, 2026-09-09. **The provider sends `alternateColor`.**
`teamDatabase.ts:233` reads **`record.altColor`**. Every row resolves `undefined`, which is why the
production catalog holds **138 primaries and 0 alternates**.

**The values that are being thrown away**, measured against `#0A0A0A`:

| team | primary | raw | alternate | raw |
| --- | --- | --- | --- | --- |
| California | `#041e42` | 1.20 | `#ffc72c` | **12.69:1** |
| Army | `#000000` | 1.06 | `#d3bc8d` | **10.70:1** |
| Iowa | `#000000` | 1.06 | `#ffcd00` | **13.18:1** |
| Vanderbilt | `#000000` | 1.06 | `#cfae70` | **9.37:1** |
| Nevada | `#041e42` | 1.20 | `#8a8d8f` | **5.93:1** |

**Every one clears the 3:1 floor raw, with no lift required.**

## THE RENDERING IS ALREADY CORRECT. DO NOT TOUCH IT.

`getSafeScoreboardTeamColor` (`teamColors.ts:274-284`) already tries **primary → alt → fallback**:

```ts
const primary = resolveTeamColorCandidate(normalizeHexColor(team?.color), 'primary');
if (primary) return primary;
const alt = resolveTeamColorCandidate(normalizeHexColor(team?.altColor), 'alt');
if (alt) return alt;
return buildTreatment(FALLBACK_BASE, 'fallback');
```

**The chain has always been right. It has never had an alternate to reach.** So this slice changes no
rendering logic and no fallback rule — **it makes an input available and the existing code does the
rest.**

## TWO FIELD NAMES, AND CONFLATING THEM BREAKS THE CATALOG

This is the one way to get this wrong.

- **The PROVIDER record** — `teamDatabase.ts:17` declares `altColor?: string | null`. **This is wrong.
  The provider sends `alternateColor`.** The type and the read at `:233` are what change.
- **The STORED catalog item** — `altColor` is the field this project persists and reads, in
  `types/teams.ts:14`, `teamIdentity.ts:25`, `server/teamDatabaseStore.ts:68` and `teamColors.ts:280`.
  **This name is correct and must not change.** Renaming it would touch every consumer for no reason
  and break the durable shape.

**So: `record.alternateColor` in, `altColor` stored. One mapping, not a rename.**

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote the provider record type and the read**, and say which of the seven `altColor` references
   are the provider shape and which are the stored shape. **Getting this wrong is the failure mode.**
3. **Say what the catalog refresh actually rewrites** — which durable key, how many rows, and what a
   consumer reading it mid-refresh sees. **This rewrites the catalog every surface reads from.**
4. **Say what `withAltColorCount` (`:263`) reports today and what it should report after.** It counts
   the STORED item, so it is a free signal that the fix worked — **and if it does not move, the fix did
   not land.**
5. Anything that CONTRADICTS what you were handed — including the claim that the rendering chain needs
   no change, which is mine and is checkable.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/199-alternate-colour-mapping` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`. **Do NOT push `preview`** — the Codex lane holds it for
Item 119.

<task>
1. **Fix the provider field name** — the type and the read.
2. **Refresh the catalog** so the durable store gains the alternates. **Report before/after counts.**
3. **Say what changes on screen**, per surface.
</task>

<gate>
**Do NOT rename the stored `altColor` field.** Seven references, six of them the stored shape. Only the
provider shape is wrong.

**Do NOT change `teamColors.ts`.** The primary → alt → fallback chain is correct and this slice is the
input it was always waiting for.

**THIS SLICE DOES CHANGE WHAT RENDERS — corrected 2026-09-09, and the earlier wording here was wrong.**
It said this item only makes the colour available and leaves the rule to Item 198. **The rule already
exists in code and fires the moment an alternate is present.** `resolveTeamColorCandidate` rejects a
primary whose raw luminance is below **0.015** — outright, before any lift is attempted — and the chain
then takes the alternate.

**Exactly 13 of 138 teams sit below that floor**, and every one renders no bar today: Akron, App State,
Army, California, Cincinnati, Florida International, Georgia Southern, Iowa, Nevada, Penn State, UCF,
UConn, Vanderbilt.

**All 13 gain a bar from this slice, in their ALTERNATE colour. For 7 of them that is the wrong
colour.** Their primaries are dark navies that OKLCH lifts to 3:1 composited with ~0.1° of hue drift —
**Penn State is navy, not its alternate.** Only the six pure blacks have nothing to lift and genuinely
want the alternate.

**So report the 13 and what each would render, and STOP before merging.** Whether seven teams should
show alternates for however long piece 2 takes is the owner's call, not a consequence to discover on
preview. **The `< 0.015` floor is an HSL-era guard that rejects colours OKLCH handles** — lowering it
belongs to piece 2, not here.

**Do NOT run the refresh against production without saying so first.** If the refresh is an operator
action rather than a test fixture, **report what it would do and stop** — the same shape as Item 110A.

**Do NOT add an OKLCH port.** Item 198, and it is now about the QUALITY of lifted navies rather than
rescuing anything.

STOP and report if the provider sends a field this codebase has no home for, or if the refresh would
rewrite more than the team catalog.
</gate>

<completeness_contract>
- **A provider row carrying `alternateColor` produces a stored `altColor`.** Assert on the normaliser,
  with a fixture using the real field name.
- **A provider row carrying the OLD `altColor` name produces nothing.** Assert it — that is the bug,
  and a test that only proves the new name works would pass before the fix if the fixture were wrong.
- **`withAltColorCount` moves from 0.** It is the sync summary's own witness.
- **No stored consumer changed.** Prove by mutation: rename the stored field and show the breakage is
  wide, which is why it must not move.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the before/after alternate count; and anything
you deliberately did not do.

**Say what a member sees, per surface.** California, Army, Iowa, Vanderbilt and Nevada currently render
no bar; name what they render after.

**Say plainly whether the rendering chain needed any change** — my claim is that it did not.

**Report new findings; do not file them.**

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 199 status, and
**Item 198 annotated** — its six-black-teams limit was never an OKLCH limitation, and the port's
remaining purpose is the quality of the lifted navies, not rescue.

Merge is delegated to this lane under `CLAUDE.md`, including the four conditions. **Running the catalog
refresh against production is NOT.** Promotion is not.
