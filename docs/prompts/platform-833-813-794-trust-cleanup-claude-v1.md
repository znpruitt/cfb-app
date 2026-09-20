# PLATFORM-833/813/794 — the code trusts what it never validated

```text
PROMPT_ID: PLATFORM-833-813-794-TRUST-CLEANUP-CLAUDE-v1
PURPOSE: Three bounded cleanups that share one root: a reader consuming a value it never validated,
         or a symbol surviving the thing that used it. Remove the dead schedule machinery #663 left
         (#833), guard the unvalidated durable reads (#813), and stop a malformed registry silently
         narrowing a safety refusal (#794).
SCOPE:   src/lib/scheduleSeasonFetch.ts, src/lib/providerRefreshScope.ts, src/lib/schedule.ts,
         src/components/admin/LeagueStatusPanel.tsx,
         src/app/api/admin/cache-historical-schedule/route.ts, src/lib/schedule/cfbdSchedule.ts,
         and their tests. DO NOT change the aggregate-only schedule contract #663 established, the
         canonical precedence helper, any member-facing surface, or AGENTS.md / DESIGN.md (planning
         owns both — report anything that needs amending).
CARRIES: NONE from the Item 87 campaign index, having checked — no scoreboard row, tag slot or row
         anatomy is touched. `LeagueStatusPanel` is an ADMIN surface.

         One standing obligation binds throughout, from AGENTS.md: **a module left with no production
         consumer must say why in the code and name the item that will consume it.** Deleting is the
         default; keeping requires a named future consumer, not a hope.
```

---

## Why these three together

Each is a reader trusting something it never checked: a docstring that outlived its policy, a
`Partial<AppGame>` cast with no runtime validation, a wrapper that flattens "absent" and "malformed"
into one empty list. **One theme, one closeout, one review cycle.** They are otherwise unrelated and
may be fixed in any order.

**None is reachable in production today**, measured. That is why they were filed rather than
dispatched, and it is also why the tests matter more than usual: nothing in the data will fail if a
fix is wrong.

## 1. [#833](https://github.com/znpruitt/cfb-app/issues/833) — what #663 left behind

**Five symbols with no production caller.** Three are already gone from `src/`;
`hasRequiredSeasonTypeFailure` (`scheduleSeasonFetch.ts`) and `scheduleRefreshScope`
(`providerRefreshScope.ts`) survive as definitions nothing calls.

- **`scheduleSeasonFetch.ts`'s docstring claims to be the single source of truth for a policy it no
  longer implements.** That is worse than dead code: it is a false claim a reader will act on.
- **`scheduleRefreshScope` deserves a moment rather than a reflex deletion.** Its `throw` for
  `week` + `all` was independent evidence that the partition-plus-aggregate model was never coherent
  — `AGENTS.md`'s amendment (`91aa30a3`) records that argument, and the closeout should point at it.
- **The live defect in this issue:** `LeagueStatusPanel.tsx:91` — `hasSchedule = Boolean(scheduleRecord)`
  is RECORD presence, not ROW presence, so a zero-row record renders a green dot and an age
  (`:163-167`). `hasScores` on the next line has the same shape. **Route both through the shared
  predicate `canonicalScheduleAggregateServes` (`canonicalScheduleCache.ts:70`)** rather than adding a
  fourth spelling — that helper's own docstring warns about exactly this divergence.
- Also in the issue: the four out-of-scope precedence call sites and `fullSeasonScheduleRefresh.ts:63`'s
  local key spelling. **Fix what the shared predicate can absorb; report the rest** rather than
  widening.

## 2. [#813](https://github.com/znpruitt/cfb-app/issues/813) — unguarded durable reads

`seasonBuild.ts:97` casts stored rows to `ScheduleWireItem[]` with **no runtime validation**, and
`schedule.ts:498` then calls a string method on one of their fields:

```ts
const eventKey = item.eventKey?.trim() || `${item.week}-${item.id}`;
```

A stored row whose `eventKey` is a JSON number throws inside `buildScheduleFromApi`, so **the blast
radius is the whole build** — season build, draft board, odds, live scores — not one row. #708 guarded
the sibling `id` read; this one was left.

**The issue names two shapes and the receipt picks one:** guard the field read the way `id` is
guarded, or validate durable rows once at the `seasonBuild.ts:97` boundary. The second is better if the
same cast feeds other readers — establish whether it does.

**Second half:** `NON_FBS_PROVIDER_CLASSIFICATIONS` in `schedule.ts` duplicates the unexported
`NON_FBS_CLASSIFICATIONS` at `cfbdSchedule.ts:304`. Two copies of one provider vocabulary drift
silently, and the guard that misses a new division fails open.

## 3. [#794](https://github.com/znpruitt/cfb-app/issues/794) — a malformed registry narrows a refusal

`computeProtectedActiveYears` (`cache-historical-schedule/route.ts:19-28`) reads the registry through
`getLeagues()`, which maps **both an absent and a malformed registry to `[]`**. A corrupt registry
therefore contributes no protected years, and the route's own refusal — that an active-season or
preseason year must go through the schedule route rather than the historical repair — **silently stops
covering those years.**

`readLeagueRegistry()` exists for this distinction and its docblock names the consequence. **Use it.**
The refusal must fail closed on a malformed registry: unable to determine the protected set is not the
same as the set being empty.

## Acceptance

1. **Every deletion is proven unreferenced** — by a rename or an import-graph check, not a grep.
   Where a symbol is kept, the comment names the item that will consume it.
2. **The admin panel uses the shared predicate**, and a test renders a zero-row schedule record and
   asserts the status is NOT presented as healthy.
3. **A durable row with a non-string `eventKey` no longer takes down the build**, pinned by a test that
   fails against today's code.
4. **A malformed registry makes the historical-repair refusal fire, not relax**, pinned by a test that
   distinguishes malformed from absent.
5. **One provider vocabulary, one definition**, with a test that fails if a second copy reappears — or
   a stated reason the two must stay independent.
6. **The aggregate-only contract is untouched.** No week-partition machinery returns.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.**

**All three defects are unreachable in production, so the tests are the only evidence.** A test whose
fixture cannot exhibit the defect is the likely false green here — construct the malformed row and the
malformed registry deliberately, and show each test failing against today's code before the fix.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **Confirm the five symbols are unreferenced** on current `main`, by a method stronger than a
   single-line grep — PLATFORM-663 was caught out by exactly that, and four sites hid behind wrapped
   formatting.
2. **Does `scheduleRefreshScope` have a keeper?** Say whether anything outside schedule would consume
   it, and if not, where its `week` + `all` argument should be preserved.
3. **#813's two shapes:** does the `seasonBuild.ts:97` cast feed readers other than `schedule.ts:498`?
   That answer picks field-guard versus boundary-validation.
4. **What else does `LeagueStatusPanel` derive by presence rather than content?** `hasScores` is named;
   check its siblings before fixing one line.
5. **Does anything else consume `getLeagues()` where the absent/malformed distinction matters?** #794
   is one instance of a wrapper that discards it.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
