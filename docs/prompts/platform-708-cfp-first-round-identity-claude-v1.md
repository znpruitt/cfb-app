# PLATFORM-708 — CFP first-round event identity

```text
PROMPT_ID: PLATFORM-708-CFP-FIRST-ROUND-IDENTITY-CLAUDE-v1
PURPOSE: Give each CFP first-round game its own eventId before the 2026 first round is ingested in
         December. Today all four share one, so one admin label override lands on all four slots.
SCOPE:   src/lib/schedule/cfbdSchedule.ts (playoffEventKey and its two call sites), the postseason
         AppGame construction in src/lib/schedule.ts, and their tests. Override MATCHING in
         src/lib/schedulePostseasonHelpers.ts only if receipt item 4 shows it must change.
         DO NOT modify any file under src/components/ — the UI lane is editing GameWeekPanel.tsx now,
         and nothing here should need it; if it does, stop and report. DO NOT touch postseason round
         grouping (Item 87 INDEX rows 32-35), the React-key disambiguation in
         buildAuthoritativeGameCollection, the season selector in CFBScheduleApp, or any durable
         stored data.
CARRIES: NONE, having checked. Item 87 INDEX rows 32-35 name this area but belong to the unfiled
         round-grouping work, and #708 itself records that grouping keys on playoffRound and
         playoffCompetition rather than eventId, so the two are separable. Row 35's type widening
         (`AppGame.playoffRound` at schedule.ts:124 still omits 'first-round') is NOT in this scope;
         if the fix cannot be written without it, that is a receipt finding.
```

---

## What planning measured on 2026-09-16, before writing this

**On the read-only replica**, from `app_state` scope `schedule`:

| season | postseason rows | first-round rows | their `eventKey` | provider `id`s |
| --- | --- | --- | --- | --- |
| 2024 | 54 | 4 | `cfp-first-round` (all four) | 4 distinct |
| 2025 | 86 | 4 | `cfp-first-round` (all four) | 4 distinct |
| 2026 | 0 | 0 | — | — |

**Postseason override records in production: zero**, across every league and year
(`scope like 'postseason-overrides:%'` returned no rows). No stored override has to be migrated.

**Then through the real build.** Running `buildScheduleFromApi` on those rows (local `teams.json`, empty
alias map) gives, in both seasons, **4 first-round games, 4 distinct `key`s, 1 distinct `eventId`.**

## Where #708 is now out of date

**The issue's headline consumer does not reproduce.** #708 says four first-round games render
"four identical React keys in one list." **They don't:** `buildAuthoritativeGameCollection`
(`schedulePostseasonHelpers.ts:448-496`) gives every contested base key a
`::stage::w<week>::<providerGameId>` suffix, and has since `353f2132` (2026-07-25), six weeks before
the issue was filed. Output from 2025: `2025-cfp-first-round`, then
`2025-cfp-first-round::playoff::w1::401779841`, and so on. The issue quoted the construction site
(`key: eventId`) and never measured the rendered key. **Don't rebuild a fix for this. Do test it**
(acceptance 2), because today nothing pins it.

**The line numbers in #708 are stale.** `playoffEventKey` is at `src/lib/schedule/cfbdSchedule.ts:366`
(the issue omits the `schedule/` directory). The postseason construction starts at `schedule.ts:497`,
not `:485-503`. The override button is at `GameWeekPanel.tsx:223-238`, not `:340`.

## What the shared `eventId` still breaks

| consumer | where | effect |
| --- | --- | --- |
| override save | `GameWeekPanel.tsx:231` → `onSavePostseasonOverride(g.eventId, …)` | the override is stored under a key all four games share |
| override apply, authoritative | `schedulePostseasonHelpers.ts:437-445` — `candidate.eventId === eventId` | **one label edit rewrites all four games** |
| override apply, optimistic | `CFBScheduleApp.tsx:1269` — the same equality | the same, client-side, before the rebuild |
| placeholder participant slots | `schedule.ts:505`, `:511` — `${eventId}-home` / `-away`; `sourceEventId` strips the suffix (`schedulePostseasonHelpers.ts:120`) | four TBD games share two slot ids |
| merge grouping | `schedulePostseasonHelpers.ts:251-252` — `[eventId, stage, week, date]` | three of 2025's four games share a date, so they share a merge group. They survive as separate games only because their numeric provider ids are "incompatible"; the output is right, but for an unstated reason |
| sort tiebreaks | `PostseasonPanel.tsx:35`, `weekPresentation.ts:157` | ties fall through to input order |
| diagnostics | `scheduleTracking.ts:56`, `:67` — `diagnosticsGameId` | four games report under one id |

`hydrateEvents` (`postseason-hydrate.ts`, keyed by `eventId`) has **no production caller**; only its
test imports it. Say whether that holds, then leave it alone.

## The fact that changes the design question

**An override can only be saved against a placeholder.** The "Save label override" button renders only
when `card.isPlaceholder && onSavePostseasonOverride` (`GameWeekPanel.tsx:223`), and only admins get
the callback (`CFBScheduleApp.tsx:1881`, `:1931`). So the transition #708 worries about is not an edge
case: a label override is saved on a TBD slot, and the slot later resolves into a real game. **That is
the only way an override comes to exist at all.**

**#708's design rests on a premise nobody has measured:** that a placeholder "has no provider id to key
on", so a resolved game would change key when its teams are assigned. That's true of the placeholders
`postseason-classify.ts` **synthesizes** (`:304-343`). It may not be true of a **CFBD** row that still says
TBD: `ScheduleWireItem.id` is a required `string` (`schedule.ts:74`), and those rows go through
`schedule.ts:497` with `providerGameId: item.id`.

**If CFBD issues the same `id` for a first-round game before and after its teams are known, keying
identity on that id removes the mid-lifecycle key change entirely**, rather than requiring every holder
of the old key to survive it. If it doesn't, #708's transition requirement stands exactly as written.
The stored caches show only the resolved state, so this is receipt item 2 — answer it with evidence or
say plainly that it can't be established.

---

## Acceptance

1. First-round games get **distinct `eventId`s** in both 2024 and 2025. Quarterfinal, semifinal,
   championship, bowl and conference-championship `eventId`s are **byte-identical to today's**, since
   only the first round is broken. Prove that second claim over the real 2024 and 2025 rows, not a
   fixture.
2. A test builds more than one first-round game into one collection and asserts distinct `key`s **and**
   distinct `eventId`s. Show a mutation that reddens the key assertion; none pins it today.
3. **One override touches one game.** An override saved against one first-round game changes that game
   and none of the other three, on the authoritative path.
4. **The transition test**, required whichever way receipt item 2 comes out: a TBD first-round slot
   carrying a saved override resolves to a real game and still carries the override. If identity is
   provider-id-based and the id is stable, the test proves the id holds across resolution. If it isn't,
   the test proves the migration.
5. The synthesized-placeholder path (`postseason-classify.ts`) still resolves a TBD slot to its game.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**A test built from a fixture needs a positive control proving the fixture can fail.** Acceptance 3 is
the test most likely to pass for the wrong reason: a fixture whose four games already have distinct
`eventId`s passes it with the defect in place. Run it against today's code first and show it fail.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **Re-run planning's measurement yourself** on the read-only replica (via `DATABASE_URL_RO`; never
   print the connection string). Report the counts. A zero override count is the claim that makes
   migration unnecessary, so it needs a second reading.
2. **Is a CFBD first-round row's `id` stable across the TBD → resolved transition?** Give the
   evidence: a stored snapshot from before resolution, CFBD's own documentation, a test fixture captured
   from the provider, or anything else that actually answers it. If nothing does, say so, and say which
   design survives both answers.
3. **Which path builds a TBD first-round game today**: `schedule.ts:497` (CFBD `gamePhase: 'postseason'`)
   or the `classifyScheduleRow` path at `:565`? Trace a 2025 row, and say whether both paths can produce
   a first-round game in the same build.
4. **Does override matching need to change**, or does a distinct `eventId` fix it by itself? Consider
   `schedulePostseasonHelpers.ts:437-445` and `CFBScheduleApp.tsx:1269`. The second is a component file
   and out of SCOPE, so say whether a correct `eventId` makes it correct without editing it.
5. **Does any durable store persist a first-round `eventId` or `key`**: season archives, game-stats
   partitions, score attachment, standings caches? Scores attach by `key`. A stored 2024 or 2025 record
   holding today's first-round key would stop joining if the key changes. Name each store, and say
   whether it holds such a key, measured.
6. **What exactly does the merge group at `:251-252` do** when three first-round games share a date,
   and does your change alter which games end up in which group?
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
