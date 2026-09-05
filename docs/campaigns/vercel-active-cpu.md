# Vercel Fluid Active CPU — finding, validation, and remediation

**Status:** Open. Diagnosis complete; the two-reader build filter and week-0 deletion shipped through
PR #551 on 2026-09-02. Both high-frequency QStash schedules are manually paused as of 2026-09-01
~18:00 UTC and will be resumed by hand for each game window until the planner (Item 102) lands.

**Owner decision, revised 2026-09-02 after the complete reader audit:** remediate with an
FBS-relevance filter at the live-score and game-stats canonical builds (Item 99) plus a
schedule-derived QStash planner (Item 102). The durable schedule remains complete because four
consumers use it as an expectation oracle and schedule-eligibility diagnostics require excluded
rows. A third option — a cheap in-route gate before the canonical context load — was proposed and
**dropped** once measurement showed it redundant against the selected changes.

This document carries the evidence. Item 99 is complete; Item 102 remains in `docs/next-tasks.md`.

---

## The finding

Vercel reports the Hobby plan's 4-hour Fluid Active CPU allowance exhausted, at roughly **7h 15m** in
the rolling 30-day window. The site is still serving; Vercel has warned but not paused it.

The originating analysis attributed this to high-frequency QStash schedules waking Vercel during
periods with no games, and proposed an outer scheduling layer as the primary fix. That conclusion is
**correct in direction and incomplete in mechanism** — see [Root cause](#root-cause).

---

## Validation of the original analysis against the code

Confirmed:

| Claim | Evidence |
| --- | --- |
| live-scores every 3 minutes (480/day) | `scripts/manage-live-scores-schedule.ts:65` — `*/3 * * * *` |
| game-stats every 15 minutes (96/day) | `scripts/manage-game-stats-schedule.ts:58` — `*/15 * * * *` |
| The "is there anything to do" guard runs inside the function | `api/cron/live-scores/route.ts:189` loads context; `:196` selects a plan; `:198` returns `no-polling-target` |
| Guard is schedule-driven; one global fetch, not per-game | `liveScores/pollingTarget.ts:129` — one `/scoreboard` covers every targeted partition |
| team-records hourly, odds hourly, schedule-refresh weekly | `0 * * * *`, `0 * * * *`, `0 12 * * 2` |

Corrected:

- **rankings is not "approximately every 3 hours".** `scripts/manage-rankings-schedule.ts:69` is
  `0 4,22 * * *` — twice daily. Two invocations a day, not eight.
- **The inventory omitted the two Vercel-native crons.** `vercel.json` schedules
  `/api/cron/season-transition` and `/api/cron/season-rollover`, both daily at 00:00 UTC.

---

## Root cause

The original analysis located the problem in the *number* of wakeups. The dominant term is the *cost
of each* wakeup.

Both high-frequency routes resolve a cache-only canonical context before anything decides whether
there is work to do:

- `api/cron/live-scores/route.ts:189` → `liveScores/canonicalContext.ts:146`
- `api/cron/game-stats/route.ts:130` → `gameStats/canonicalSlate.ts:407`

Both run `buildScheduleFromApi` over the **entire persisted season schedule** — 3,676 rows for 2026,
of which 2,788 can never be a polling target. `loadLiveScoreContext` additionally issues the same
season-wide `scores` prefix scan **twice per invocation** (`scoreCacheReader.ts:310` and
`canonicalContext.ts:126`), then attaches and re-walks the result.

The consequence that reorders the remediation: **an idle run and a working run pay the same context
load.** A planner that suppresses idle wakeups cannot touch the in-window cost; the row filter cuts
both.

---

## The two inventories, in full

These took three review rounds to assemble and are the reusable part of this campaign. Item 99's
original survey claimed "no consumer reads the other 2,788"; that was false, and building the filter
on it cost two abandoned implementations.

### Inventory 1 — what `buildScheduleFromApi` derives from the RAW row set

Season-level facts computed from every row regardless of eligibility. **This list is complete** — a
whole-file grep for `scheduleItems` in `schedule.ts`, plus the slate derivation, not a sample.

| Site | Derives | Behavior under a filter |
| --- | --- | --- |
| `schedule.ts:364` | `providerNames` → resolver seeding | Safe: the canonical registry only ADDS ids, and every retained row supplies its own names |
| `schedule.ts:384` | week-0 calendar | Deleted by Item 100a; the derivation no longer exists |
| `schedule.ts:399` | `maxRegularSeasonWeek` → postseason offset | **Moves postseason weeks.** Now reduced over FBS-relevant regular rows so it is invariant (Item 104 owns the real fix) |
| `schedule.ts:404` | the per-row loop | Eligibility applies to REGULAR rows only — `getRegularSeasonEligibilityDecision` is reached solely via `scheduleTracking.ts:118`, so postseason rows must never be filtered |
| `gameStats/canonicalSlate.ts:321` | `duplicateProviderScheduleIds` | **Blinds the id-collision guard.** The derivation now receives UNFILTERED rows while the build receives filtered ones |

**Non-FBS rows are excluded from the game LIST but still vote on these derived facts.** That single
sentence is why "they're discarded anyway, so removing them is a no-op" was wrong three times.

### Inventory 2 — consumers of `loadCachedScheduleItems`

Six are unaffected by dropping both-known non-FBS rows because they only feed
`buildScheduleFromApi`, which already excludes those rows via `exclude_both_non_fbs`:

| Safe consumer | Why |
| --- | --- |
| `liveScores/canonicalContext.ts:158` | build only; `pendingGames` derives from built games |
| `gameStats/canonicalSlate.ts:415` | build, plus an id index whose extra entries yield no canonical game |
| `odds/canonicalOddsContext.ts:88` | build, plus `rawStatusById` read only for canonical games |
| `selectors/leagueStandings.ts:867` | build, plus resolver name-seeding non-FBS labels cannot match |
| `insights/loadInsights.ts:281` | passes straight to the build |
| `schedule/nationalChampionshipRollover.ts:144` | the championship game is FBS by construction |

Four are affected, and all four break the same way:

| Affected consumer | What raw rows do there |
| --- | --- |
| `api/scores/route.ts:344` | `classifyEmptyScoresResponse` counts started, non-disrupted games |
| `api/admin/cache-historical-scores/route.ts:260` | the same classifier |
| `odds/oddsRefreshExecutor.ts:145` | `expectationEvidenceAvailable` — any kickoff inside the horizon? |
| `server/providerDataDiagnostics.ts:305` | `hasPollableOddsTarget`, `isSeasonActive` |

**Each uses the row set as an EXPECTATION ORACLE** — "was anything supposed to happen here?" — and
each becomes MORE PERMISSIVE as rows disappear: an empty provider response reads as valid absence
rather than something suspicious. Any filter that removes rows from that oracle loosens a
data-protection guard, at the write path or the read path. Add
`/api/debug/schedule-eligibility` (`route.ts:52`, sole input `/api/schedule`) to the list of readers
that need the excluded rows — `AGENTS.md` core rule 4 forbids removing diagnostic surfaces.

**Before changing what enters or leaves the schedule row set, re-run both greps.** They cost thirty
seconds and would have prevented every round of this campaign.

## Measured: production attribution

From Vercel Observability → Functions, 2026-09-01, 12-hour window. Active CPU totals are rounded by
the dashboard to whole minutes above 60s, so per-invocation figures carry that rounding.

| Route | Invocations | Active CPU | Per invocation |
| --- | --- | --- | --- |
| `/api/cron/live-scores` | 200 | 4m | **1.20 s** |
| `/api/cron/game-stats` | 41 | 39s | **0.95 s** |
| `/api/cron/odds` | 13 | 13s | 1.00 s |
| `/api/insights/[slug]` | 3 | 10s | **3.33 s** |
| `/league/[slug]` | 35 | 10s | 0.29 s |
| `/api/cron/team-records` | 13 | 2.2s | **0.17 s** |
| `/` | 16 | 2.37s | 0.15 s |
| `/api/schedule` | 8 | 1.47s | 0.18 s |
| `/api/odds` | 3 | 1.09s | 0.36 s |
| `/api/cron/rankings` | 1 | 793ms | 0.79 s |

**live-scores is 75% of all Active CPU in that window. live-scores plus game-stats is 87%.**

Projecting those rates to a full day gives ~6.2 CPU-hours/30d against the dashboard's observed 7h15m
— within ~15%, with the gap where it should be (weekend traffic, game-day work, and two further
pages of small routes). The bottom-up model reproduces the top-line number, so the attribution is
settled rather than inferred.

Two secondary readings from the same session:

- **Start Type: 66.7% cold, 16.7% hot, 16.7% prewarmed.** At a 3-minute cadence with no traffic,
  Fluid is not holding instances warm, so the per-invocation floor is paid nearly every time. This is
  why *removing* invocations beats making them cheap.
- **`/api/cron/team-records` costs 0.17 s** — a cron route that does not build the schedule. Treat
  that as the floor: of live-scores' 1.20 s, roughly 1.03 s is context load and ~0.17 s is baseline.

The pause landed cleanly: zero live-scores and game-stats rows in the 1-hour window, and 200
invocations over 12h against 240 expected places the cutover about two hours before the reading.

---

## Measured: what the context load is made of

`loadLiveScoreContext`'s phases, timed directly against the real production payload
(`/api/schedule?year=2026&seasonType=all`, 2,764,822 bytes, 3,676 rows) and the bundled 138-team
catalog, empty alias map, 3 runs after a warm-up, median:

| Phase | All 3,676 rows | Item 99 filtered (1,003 rows) |
| --- | --- | --- |
| `buildScheduleFromApi` | **6,645 ms** | **1,873 ms** |
| `deriveCanonicalGameStatsSlateFromBuild` | 34 ms | 51 ms |
| `createTeamIdentityResolver` | ~0 ms | ~0 ms |
| `buildScheduleIndex` + `attachScoresToSchedule` | 31 ms | 27 ms |
| per-game map + `derivePendingGame` | 27 ms | 1 ms |
| **total** | **6,737 ms** | **1,952 ms** |

**The schedule build is 98.6% of the context load.** Everything else is rounding error, and stays
that way when the scored-game count is raised to a full season (attachment tops out at 164–308 ms).

⚠️ **These absolute numbers are ~5x the figures recorded in Item 98** (6,645 ms vs 1,267 ms for the
same function on the same payload). That discrepancy is unexplained and is not asserted to be
environmental. What reproduces exactly is the ratio — **3.55x here against 3.59x there** — so the
ratio and the apportionment are the load-bearing results. Do not quote the milliseconds as
production figures.

---

## Measured: the Item 99 base predicate is lossless on both filterable seasons

Applying Item 99's exact predicate (drop only when both `homeClassification` and `awayClassification`
are present and neither is `fbs`) and building through `buildScheduleFromApi`, reading
`AppGame.canonicalWeek`:

```text
2026 all       rows=3676  games=888   WEEK 0: absent
2026 filtered  rows=1003  games=888   WEEK 0: absent
2025 all       rows=3831  games=934   WEEK 0: absent
2025 filtered  rows= 996  games=934   WEEK 0: absent
```

This experiment applied the base predicate to every row. The shipped build predicate additionally
retains every postseason row, so these filtered row totals are not the final build-input totals when
a season contains a both-known-non-FBS postseason row. The canonical-count conclusion is unchanged;
the final predicate and postseason weeks were separately swept across all seven cached seasons.

Two results:

1. **The filter removes 2,673 rows from 2026 and 2,835 from 2025 and changes zero canonical games.**
2. **No canonical week 0 appears in any of the four builds.** `buildScheduleFromApi:384` does invoke
   `buildRegularSeasonWeekCalendar` on the rows passed, so the check reaches the claim.

This resolves the week-0 concern raised against Item 99, and corrects how it was raised. Item 100's
table records "2025 fbs → week 0 DETECTED", but that experiment used a **strict FBS-only** row set.
Item 99's predicate deliberately retains rows whose classification is absent, and those retained rows
are what keep the heuristic dormant. The two filters are not the same filter.

This no-week-0 result was emergent before implementation — it depended on which rows happened to lack
classification. PLATFORM-120 therefore deleted the derivation rather than pinning today's data: week
1 is now provider-authoritative for every season, while Item 100b separately owns any future internal
opening-slate marker.

Also corrected: **Item 99's predicate keeps 1,003 rows for 2026, not 888.** The 888 figure is the
FBS-involving count; the filter retains 115 more rows where one side's classification is absent. The
saving is real but slightly smaller than the ledger projects.

---

## Remediation

Two changes, both justified by the measurements above.

### 1. Item 99 — filter the two hot canonical builds

Cuts the term that is 98.6% of each live-score and game-stats context load by 3.55x — idle runs and
working runs alike. Those two readers account for 87% of the measured Active CPU. The full raw
snapshot remains durable and visible to expectation-oracle and diagnostic consumers; game-stats
also retains it for per-id metadata and duplicate-id rejection after the filtered canonical build.

### 2. Item 102 — schedule-derived QStash polling planner

Once a day, read the canonical schedule, derive the polling windows, and rewrite the QStash cron
expressions for live-scores and game-stats so they do not fire outside those windows. Removes the
idle invocations outright, including their cold-start floor.

Chosen over the originating analysis's pause/resume design: one idempotent mutation per day instead
of two timed control actions per window, and the resulting cron is human-readable in the QStash
console — worth something in a system whose scheduler state has been invisible before.

### Dropped: an in-route gate before the context load

Proposed as the smallest first step: a small durable "next relevant kickoff" record, single-writer,
read before `loadLiveScoreContext` and fail-open to current behaviour. Measurement retired it. It
only makes *idle* invocations cheap; the planner deletes them, and Item 99 already discounts every
remaining one by 3.55x. Recorded here so it is not re-derived.

It remains a viable fallback if Item 102 stalls — gate plus Item 99 lands in a similar range to
planner plus Item 99, at materially less machinery, but it keeps paying the cold-start floor 576
times a day.

### Projected effect

Projections, not measurements — built on the one measured ratio and a 12-hour sample.

| Scenario | Projected CPU / 30d | Headroom vs 4h |
| --- | --- | --- |
| Today, both crons live | ~6.2–7.2 h | over |
| Item 99 hot-reader filter only | ~2.8 h | ~30% |
| Item 99 + Item 102 (~20% duty cycle) | ~1.1 h | ~72% |
| Both crons paused (today's residual) | ~0.7 h | — |

**Item 99 alone is projected under the line, thinly; production measurement after merge must confirm
that projection. Both changes together give a season's margin.** Seasonal Vercel Pro (~$20/month)
remains an operational option for headroom, not a substitute for either change.

### The 20% duty cycle is an ANNUAL average, and the allowance is monthly

Measured 2026-09-05 against the real `schedule / 2026-all-all` record (3,679 games, all with
parseable UTC kickoffs), replaying the planner's own rule — a UTC hour is armed if any game's
`[kickoff − 15m, kickoff + 24h]` window overlaps it, which is `pollingTarget.ts`'s window:

| | Sep | Oct | Nov | Dec | Jan–Aug | Full year |
| --- | --- | --- | --- | --- | --- | --- |
| Hours armed | 49% | **74%** | 66% | 3% | 0–13% | **17%** |

**The full-year 17% confirms the ~20% duty cycle the projection assumed. October's 74% is the
problem**: the Vercel allowance is measured per 30 days, so the binding month is the one that
matters, and in it the planner removes roughly **26%** of live-scores wakeups, not ~72%. Applied to
the ~2.8 h post-Item-99 figure that lands near **~2.25 h**, not ~1.1 h. The projection is right about
the year and wrong about the month.

**The cause is the 24-hour tail, not the schedule.** Sensitivity at the same measurement, October:

| Tail | 24h | 12h | 6h | 3h |
| --- | --- | --- | --- | --- |
| Hours armed (Oct) | 74% | 50% | 33% | 24% |

One Saturday game arms all of Sunday, so in-season the tail — not kickoff density — holds the cron
open. **Restricting to FBS games does not help**: 888 of the 3,679 involve an FBS team, and planning
from only those gives 74% in October and 16% for the year, within a point of the full slate. The FBS
slate alone is dense enough to cover the same clock.

**The tail cannot simply be shortened.** `kickoff + 24h` is the final-reconciliation guarantee, and
PLATFORM-105A already found that boundary giving up on late-arriving finals. Shortening it trades a
correctness property for CPU.

**What this does NOT change:** Item 102 remains clearly worth building — ~83% of annual wakeups is a
large real saving, and it retires the manual pause that can strand a final. What changes is the
claim: it is an annual and offseason win that buys headroom, **not** the fix for in-season pressure.
Anything that depends on being under the line in October needs a second lever.

### The second lever, measured 2026-09-05 — Items 130 and 131

Owner design: bound the dense cadence by live STATE rather than by a fixed tail. Poll densely from
`kickoff − 15m` until the last game of a CLUSTER reports final, then a ~2-hour slow reconciliation
poll, then off. A cluster is a contiguous run of games — the 2026-09-03 weekend is five (Thu, Fri,
Sat, Sun, Mon), not one four-day window. The route already computes the switch: `pollingTarget.ts`'s
three modes ARE the three cadences.

Same measurement basis as the table above. 60 clusters across 2026, median 10h, max 17h:

| Wakeups / month | Sep | Oct | Nov | Year |
| --- | --- | --- | --- | --- |
| live-scores today | 14,400 | 14,880 | 14,400 | 175,200 |
| Item 130 | 3,072 | 4,149 | 4,127 | 12,209 |
| game-stats today | 2,880 | 2,976 | 2,880 | 35,040 |
| Item 131 | 56 | 92 | 76 | 240 |

**Projected CPU, applying this document's measured 75% / 12% share to the October column: ~0.96 h/30d
in the BINDING month** — below the ~1.1 h this table projected as an annual average. Projection, not
measurement: it assumes per-invocation cost is unchanged and that the share holds.

**Why state beats a fixed tail:** Item 108 measured five games reconciling at `kickoff + 3.40h..4.75h`
and one still live at **6.4h** behind a weather delay. Any fixed window slows polling on that game
while it is on the clock; delayed and suspended games stay eligible in `pollingTarget`, so a
state-driven cluster holds itself open.

---

## What the planner must deal with

Four collisions, all located in the source:

1. **The cron is a fixed contract constant.** `scripts/lib/qstashSchedule.ts:342` compares the live
   cron against `ScheduleContract.cron` and reports divergence. The moment a planner rewrites it,
   `npm run manage:live-scores-schedule -- inspect` refuses (exit 2) permanently. For these two jobs
   the cron must become planner-owned, with `inspect` validating everything else.
2. **Delivery health hardcodes the cadence.** `src/lib/server/schedulerDeliveryHealth.ts:82,88` pins
   live-scores to `*/3` with a 6-minute grace and game-stats to `*/15` with 30 minutes. Narrow the
   cron and both jobs read `late` on System Health whenever they are outside the window — training
   the operator to ignore the two rows that matter most on a game day. Delivery expectations must
   derive from the planner's current window.
3. **`QSTASH_TOKEN` is operator-CLI-only today.** It is read from `.env.local` by the manage scripts
   (`qstashSchedule.ts:644`); nothing in `src/` talks to the QStash management API. A runtime planner
   needs it in the Vercel environment. `CRON_SECRET`, which upsert forwards, is already there.
4. **One QStash schedule holds one cron expression.** Windows must be over-approximated as hour
   ranges. That is safe — the handler guards still block the CFBD call — and it means the planner can
   be coarse and conservative rather than precise.

Existing handler guards stay. They are the defence for kickoff changes, postponements, stale QStash
state, planner mistakes, and duplicated control messages, and the planner must not become the only
correctness or quota protection.

---

## Failure and edge cases the planner must answer

Carried forward from the originating analysis; still open.

- Planner fails to run — decide whether "safe" is remaining on yesterday's window or falling back to
  a conservative always-on. Yesterday's window is close to right, since slates are weekly-periodic.
- A QStash control request fails — retriable and observable; never silently leave a schedule wrong
  for days.
- Duplicate planner execution must be idempotent.
- Kickoff time changes after planning; games running late; games crossing midnight.
- Postponed and cancelled games, per canonical schedule/status logic.
- Postseason — conference championships, bowls, and CFP follow the same canonical model, and bowl
  season puts midday games on weekdays.
- Stale QStash state — needs a way to compare expected against actual schedule state.

Test scenarios to cover: no-game day; a normal Saturday slate; a weekday game; overlapping windows;
games spanning midnight; early kickoff plus late-night game; kickoff change; postponed; cancelled;
postseason; planner called twice; delayed or duplicated control message; failed pause; failed resume;
stale-active on a no-game day; stale-paused on a game day; handler guard still blocking the external
call.

---

## Operator notes while the schedules are manually managed

Pause and resume need only `QSTASH_TOKEN` in `.env.local`; `CRON_SECRET` is required for `upsert`
only.

```bash
npm run manage:live-scores-schedule -- inspect            # read-only, no --apply
npm run manage:live-scores-schedule -- resume --apply
npm run manage:game-stats-schedule  -- resume --apply
```

Exit codes: `0` confirmed, `2` refused (nothing mutated), `3` credential missing or management
unreachable (fail closed), `4` **indeterminate — inspect read-only before any retry, never retry
blindly**.

**The two windows are different shapes, so the switches are not thrown together.**

- `live-scores` — `[kickoff − 15m, kickoff + 24h]` (`liveScores/pollingTarget.ts:25`), and a game
  leaves the window early once its final is confirmed. Resume ~20 minutes before first kickoff. The
  15-minute margin is confirmed sufficient (owner, 2026-09-01).
- `game-stats` — `[kickoff + 3h, kickoff + 24h)` (`gameStats/pollingTarget.ts:41`). Useless until
  three hours after first kickoff and still needed well after the last game ends. At a fifth of
  live-scores' invocation count, the safe habit is to resume it alongside live-scores and pause it
  last, the morning after the slate.

⚠️ **Pausing across a game's 24-hour mark can strand it permanently.** Live-score reconciliation gives
up at `kickoff + 24h`; past that the game leaves the window and `final-reconciliation` can never run
for it again. A game whose scoreboard final was never confirmed by `/games` is stranded if the
schedule is paused across that boundary. Confirm the slate's finals are actually confirmed before
pausing. This is the same reconciliation gap PLATFORM-105A landed on, and manual pausing is the one
operating mode that can trip it.

**Expected while paused:** System Health reports live-scores and game-stats delivery as `late` and
provider data as stale. Correct, not a regression.

---

## Recorded, not actioned

- **`/api/insights/[slug]` costs 3.33 s per invocation** — the most expensive route in the app,
  roughly 3x a live-scores run. Three hits in 12 hours, so ~10 seconds total and not a problem today.
  Same disease, but PLATFORM-120 deliberately left this lower-volume reader unfiltered. Revisit if
  insights usage grows.
- **`loadLiveScoreContext` issues the same season-wide `scores` prefix scan twice per invocation**
  (`scoreCacheReader.ts:310`, `canonicalContext.ts:126`). Small against the schedule build, and
  provably duplicate work. Fold into whichever slice touches that file.
- **Every authenticated invocation schedules a durable receipt write** via `after()`
  (`live-scores/route.ts:280`), including runs that resolve `skipped / no-polling-target`. Receipts
  must keep flowing or delivery health goes blind, so this is a cost to accept, not remove.
- **Item 96** (offseason QStash pause, for Neon rather than Vercel cost) is the same lever at a
  coarser grain. A working planner subsumes its manual half automatically.

## Unverified

- Vercel's per-invocation cold-start Active CPU is not separately measurable on Hobby. The 0.17 s
  `team-records` figure is used as a floor proxy.
- The 30-day rolling figure will not fall immediately; historical usage must age out. The next useful
  observation is daily Active CPU across a full paused day.
