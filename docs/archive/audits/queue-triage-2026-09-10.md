# Queue triage — calibration sample, 2026-09-10

Status: complete for its ten-item sample
Owner: planning session
Canonical for: the measured verdicts below and nothing else. `docs/next-tasks.md` remains canonical
for item state; this file is the evidence it is applied from.

**Ten items, evenly spaced across the sub-100 tail** — 12, 19, 28, 37, 45, 51, 60, 71, 81, 95 — judged
against `src/` rather than against their own descriptions. Run in the planning session rather than an
implementation lane: the context argument in `DOCS-020` applies to all 56, not to ten.

---

## THE HYPOTHESIS IS REFUTED

The premise behind this triage, written into the prompt, was that *"most of the sub-100 tail is dead,
superseded by work that shipped after it was filed."*

**Zero of ten are superseded. Not one.**

| verdict | count |
| --- | --- |
| LIVE — still reproducible in current code | **6** |
| PARTIALLY LIVE — one consumer fixed, authority not | **1** |
| CONDITIONAL — a note gated on a future trigger, not work | **1** |
| UNCLEAR — not cheaply determinable | **2** |
| **SUPERSEDED** | **0** |

**The tail is not sediment. It is unstarted work, and it is still true.**

---

## Verdicts

### Item 12 — LIVE

`src/app/api/owners/route.ts` contains no `withAppStateKeyLock` or equivalent serialization call — a
grep for lock acquisition in that file returns nothing. The roster-replacement writer named in the item
is still outside the authority the item asks it to join.

### Item 19 — LIVE symptom, and **its prescribed remedy is REFUTED**

**This is the most valuable finding in the sample.** The item asks to *"move nonessential reads behind
the cheap authoritative refusal checks."* `pick/route.ts:78-92` records why that is now known-harmful:
the draft transaction runs on a three-client pool, and a nested `getAppState` inside the callback
*"needs a fourth client that the waiters cannot release until the owner commits — a permanent deadlock
that starves DB access process-wide."* The handler deliberately resolves the alias map **before**
opening the transaction, and preserves refusal ORDER by splitting fetch from decision instead.

**So an implementer picking up Item 19 as written would reintroduce a process-wide deadlock.** The
symptom may persist — a store outage during the pre-transaction read still surfaces as a 500 — but the
remedy must not be the one recorded.

### Item 28 — UNCLEAR

Five product defects in one commissioner recovery flow. Items 92–96 plausibly resolved several, but
each is a UI-state claim that needs a walkthrough rather than a grep, and confirming one says nothing
about the other four. **Not determinable at triage cost.**

### Item 37 — PARTIALLY LIVE

The insights consumer is fixed: `insights/context.ts:417` re-checks the threshold after cleaning, and
`:405-416` documents exactly the failure the item predicted. **But the item asked to normalize the
authority ONCE, and that was explicitly declined** — `:408` states `selectConfirmedRoster` still counts
`NoClaim` toward `MIN_CONFIRMED_OWNERS` on the confirmation path, *"deliberately."* Draft creation still
consumes it (`api/draft/[slug]/[year]/route.ts:582`). **One consumer defends itself; the authority is
unchanged and other consumers are untested.**

### Item 45 — LIVE (first bullet, verified)

`preseasonBanner.ts:151` gates on `ownerCount > 0`; `confirmedRoster.ts:37` sets
`MIN_CONFIRMED_OWNERS = 2`. **A one-owner roster satisfies the banner and fails confirmed-roster
selection** — precisely the divergence the item describes. The other two bullets are
next-time-you-touch-it notes, not work.

### Item 51 — LIVE

`manualAssignmentComplete` has no production writer. Confirmed three ways: every non-test reference is
a read or a pass-through (`teamAssignmentStore.ts:40`, `teamAssignment.ts:81`, `league.ts:95` is the
type), and `admin/[slug]/preseason/page.tsx:287` says so in a comment. **The item's own claim is
documented in the code it describes.**

### Item 60 — LIVE

Two operator decisions, neither recorded as taken. Nothing in `src/` can show a decision was made, so
this is LIVE by default rather than by evidence — **stated as a limit of the method, not a finding.**

### Item 71 — UNCLEAR

A "re-measure, then choose" item. No code resolves it, and its subject — per-process test startup and
pid-scoped app state — now overlaps **Item 209**, which may change the measurement's basis. **Should be
re-read after 209 rather than triaged now.**

### Item 81 — CONDITIONAL, and the queue has no vocabulary for this

All three bullets are gated on triggers that have not occurred: *"if a second producer is added"*,
*"before deduplicating"*, *"only if real CFBD evidence shows a canceled game with `completed: true`"*.
**These are not work. They are notes to a future implementer, correctly parked** — and calling them
LIVE overstates them while calling them dead would lose them.

### Item 95 — LIVE

`selectors/liveDelta.ts:15` — `DEFAULT_LIVE_DELTA_STALE_THRESHOLD_MS = 7 * 60 * 1000`. Unchanged, and
the item asks for it to be retuned.

---

## What this changes

**The GitHub-issue question flips.** The case for migrating was partly *"most of it is dead, so
triage-then-migrate."* If the tail is live, **migration matters more, not less** — 56 real items
invisible in a 126,000-token file is a worse problem than 56 dead ones.

**The queue needs a fourth state.** Item 81 is not LIVE, not DONE, and not dead: it is a conditional
note whose trigger has not fired. Item 45's bullets two and three, and Item 60's implementation
follow-ups, are the same shape. **Filing those as issues alongside actionable work would produce a
backlog that never drains and cannot be prioritised.**

**Item 19 is a warning about the whole exercise.** An item can stay accurate about a defect while its
prescribed fix becomes actively dangerous. **Triage that only asks "is this still broken?" would have
marked it LIVE and moved on**, leaving a deadlock waiting for whoever picked it up.

---

## Coverage, stated as a limit

**Ten of 56.** The sample is evenly spaced, so it describes the range rather than its extremes — but
ten is ten. **Two verdicts are UNCLEAR and one (Item 60) is LIVE by default rather than by evidence**,
so the strongest honest claim is: **in this sample, nothing was superseded, and six items were verified
still true against current code.**

Verification depth varied. Items 45, 51 and 95 are settled by a single line each and are solid. Item 12
rests on an absence — a grep for lock acquisition in one file — which is the weaker kind of evidence
this project has a standing rule about, and it would tighten with a mutation.
