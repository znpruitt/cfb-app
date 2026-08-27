# When a week is played, and when a season is over

Status: Current
Last verified: 2026-08-21
Owner: Standings / lifecycle
Canonical for: the predicate that decides a week has been played, and the predicate that decides a
season has ended
Supersedes: (none)

Written for `PLATFORM-105`, before the fix, because the defect it replaces was a single predicate
answering two different questions and nobody could see that from the code.

## The defect this replaces

`isResolvedWeek` asked "is this week's coverage complete?", and coverage at the time meant _no game
the schedule calls final is missing a score_. **A week with nothing played has no final games, so
nothing is missing, so it is complete.** "Nothing played" and "everything present" were the same
value.

Every unplayed week therefore counted as resolved, `selectSeasonContext` saw no unresolved week, and
the season reported itself `final` — from the first Saturday.

**Reproduced against production data (2026-08-19).** Production's real 2026 schedule (3,610 games,
weeks 1–15) and a real 136-team roster, with only week 1 marked final, served
`lifecycleState: postseason` and cards reading `How 2026 finished`, `Who owns the porcelain throne in
2026? — Shambaugh spent 14 weeks of 2026 in last place`, and `Crowded finish`. After one Saturday,
naming real owners. Cumulative standings carry forward through unplayed weeks, which is why one week
of football read as fourteen.

It also made every in-season card unreachable for the entire season: `movement`, `surge`, `race` and
the `season_climb`/`season_slide` cards never fire, because their lifecycles are gated out.

## What counts as a game (owner ruling, 2026-08-20)

**A REAL game is one with both teams known.** A playoff or conference-championship
shell — "winner of A vs winner of B" — is not a game to wait on. It becomes one
once the season plays out and the bracket resolves, and then it gets a result
like anything else.

**A PLANNED game is a real game with a determined start date AND time.** Only a
planned game can be said not to have happened: _a game can only "not happen" if
it was ever planned to occur._ A bowl matchup announced without a kickoff time is
not stuck — it is an incomplete dataset that the weekly schedule refresh will
resolve. Until it has a result the season is genuinely not over, which is the
correct answer rather than a defect.

This replaces two guards written against the wrong premise. Earlier rounds
excluded bracket shells from the population (which then made an all-shell week
unable to resolve) and distrusted `startTimeTBD` as an unreliable timestamp
(which pinned such weeks forever). Both were generalising the rare
never-resolves case — one hurricane in six seasons — into the norm, then
guarding against the generalisation.

## Two questions, not one

| Question                   | Consumer                                              | What it means                                     |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Has this week been played? | the standings series — movement, surge, climb, slide  | there is a usable, settled snapshot for this week |
| Is the season over?        | `selectSeasonContext` → recap, champion, throne, race | no football remains                               |

Coverage answers a third, separate question — _are we missing scores for games that were played?_ —
and remains independent from progress. `PLATFORM-105A` made both questions consume the same positive
conclusion evidence: a final score, `completed: true`, or a final schedule status means standings
coverage now requires a final row with both numeric scores; cancellation is a distinct scoreless
terminal outcome. Coverage is still a data-health signal, not a progress signal, and related gaps
are also reported through System Health (`scores-terminal-coverage-missing`/`-partial`).

Under the normal automatic cadence, weekend games are eligible for live-score polling every three
minutes through kickoff + 24 hours. `PLATFORM-107` adds a weekly backstop for a provider final that
was never saved inside that window: the schedule-refresh cron extracts finals from the whole-season
CFBD payload it already downloads, matches coverage by exact `seasonType:providerGameId`, and sends
only missing finals through the existing score-merge authority. The pre-merge filter and the
transaction-fresh guard both preserve an existing final; a conflicting provider score is measured
and logged, never rewritten. A blank provider id on either side is `cannot-tell`, refuses the write,
and is counted in the cron event and receipt. Other full-season schedule-refresh callers remain
schedule-only unless they explicitly opt into the sweep.

This is recovery for **"the final was never saved," not every identity gap**. A row with a unique
provider id can still repair and attach when participant identity prevented live polling, because
score attachment has an independent provider-id path. Without a provider id the sweep refuses to
create a duplicate, and attachment can still report `ignored_score_row`; that case needs a separate
identity repair. The weekly cadence means the backstop may take up to seven days. `PLATFORM-107`
changes neither that cadence, the live polling window, nor the cumulative standings coverage gate.
`PLATFORM-112` closes the former slate-granular System Health gap: every expected canonical game in
a completed provider partition is checked against its own attached terminal score, so one final row
cannot hide a missing sibling. This diagnostic remains cache-only and routes the operator to the
existing score-recovery action; it does not change polling or repair cadence.

## The predicate

```text
concluded(game, score) =
  1. the cached score is FINAL                     ← we have the result
  2. game.completed === true                       ← CFBD's own flag
  3. game.status === 'final'                       ← wire status, when supplied
  4. CANCELLED, on the score OR the schedule       ← terminal, never resolves
  5. POSTPONED / SUSPENDED, either source → NOT concluded, it is still coming
  5b. startTimeTBD                        → NOT concluded, the kickoff is a placeholder
  6. now - kickoff > GAME_MAX_DURATION             ← last resort: abandoned

weekPlayed(week) = the week has ≥1 REAL game
                   && every real game in it is concluded
seasonOver       = every REAL game in the season is concluded

conclusionKind(game, score) =
  score-required       when steps 1, 2, or 3 hold
  scoreless-terminal   when cancellation alone holds
  unresolved           otherwise

standingsCoverage(week N) = complete only when every score-required
                             OWNED game through week N has a final row
                             with both numeric scores

resolvedWeek(week N) = weekPlayed(week N)
                       && standingsCoverage(week N) is complete
                       && the cumulative standings are nonempty
```

**Score-bearing evidence wins over cancellation when provider fields conflict.** That ordering is
deliberately fail-closed: a result-bearing signal cannot be discarded merely because another field
says canceled. A cancellation is scoreless-terminal only when no stronger evidence says the game
produced a standings result.

**Coverage is cumulative on purpose.** Each weekly snapshot contains standings through that week,
so its coverage is derived over `cumulativeGames`, not only the games played during that week. If an
owned week-1 result is missing, the week-2 and later standings omit it too; those later snapshots are
not correct merely because their own games have scores. The partial verdict therefore propagates
until the missing result attaches. Removing coverage from `resolvedWeek` would republish standings
known to be incomplete and is not an acceptable recovery strategy.

**Season-over is a question about GAMES, not weeks** (owner ruling, 2026-08-20).
Asking it week-by-week is what let an all-shell week block a season that had
finished, and it fused two questions that this document exists to separate.
Week-level `played` remains, but only for the standings SERIES — which weeks have
a usable snapshot to chart and to measure movement from. It no longer decides
whether the season ended, which is where every failure of this kind landed.

**Step 6 applies only to PLANNED games.** A real game with no determined kickoff
has nothing to measure elapsed time against, and by the ruling above it cannot be
said not to have happened.

**Steps 4 and 5 ask the SCORE, not just the schedule.** Every one of the 22,691 cached schedule items
carries `status: 'scheduled'`, so `game.rawStatus` never says anything — the first version of this
guard asked only the schedule and was unreachable. `toStatus` preserves an unrecognized provider
label verbatim, so a postponed game arrives as `ScorePack.status === 'Postponed'`.

**Placeholder rows are excluded from the population.** A postseason bracket shell has
`startDate: null` and can never be final, so one of them would pin its week to `played: false`
permanently and stop a live season ever reaching `final`.

**Evidence is consulted in order of authority, and elapsed time is LAST.** The
first implementation of this slice tested only `status === 'final'` and fell
through to the clock for everything else. Both reviewers found that unreachable:
CFBD supplies no status string, `cfbdSchedule` defaults it to `scheduled`, and
`mapStatus` therefore never yields `final` — so every week was decided purely by
the wall clock. A Saturday's games could all be final and cached by 11:30pm while
the week stayed unplayed until 4am, and a week whose games merely kicked off
eight hours ago counted as played with no scores at all. The authoritative
signals were already in hand: `scoresByKey` is a parameter, `AppGame.completed`
carries CFBD's flag, and `rawStatus` carries the provider label.

**Step 5 must precede step 6.** A postponed game's cached kickoff is the one it
no longer has, so falling through to elapsed time closes its week the next day.
The repo already draws this line — `isCanceledStatusLabel` is deliberately
narrower than `isDisruptedStatusLabel` for exactly this reason.

**`GAME_MAX_DURATION` is eight hours, and it is not a tuning knob.** It is how long a game can
last — regulation plus overtime, weather delay, and a wide margin. Its only job is to stop a game
that kicked off ninety minutes ago from being mistaken for one that will never be played. Nothing
legitimate sits unfinished for eight hours.

### Why elapsed time is the discriminator, and why that is sound

CFBD's `/games` endpoint **has no status field at all**. The only completion signal is the boolean
`completed`, and a cancelled game keeps `completed: false` with null scores permanently — verified by
querying CFBD directly on 2026-08-19 for `Liberty @ App State` (week 5, 2024, cancelled after
Hurricane Helene), which still returns `completed: false` nearly two years later. Across 22,000+
cached score rows spanning six seasons, the only status values our normalizer ever wrote are `final`
and `scheduled`.

So the provider will never tell us a game was cancelled. But cancelled and not-yet-played are **not**
indistinguishable (owner, 2026-08-19):

|                       | `completed` | `startDate` |
| --------------------- | ----------- | ----------- |
| Not yet played        | `false`     | **future**  |
| Cancelled / abandoned | `false`     | **past**    |
| Played                | `true`      | past        |

The inference is ours to make because the provider cannot make it for us.

### Population: every tracked game, and no extra filter

Owner ruling was "all canonical FBS games", and `games` **already is** that set —
`isTrackedGame` excludes both-non-FBS fixtures upstream, so the eleven noise
games below never reach this code.

The first implementation added a filter requiring BOTH participants in the FBS
catalogue, and `/code-review` showed it was net-harmful: it excluded nothing that
was not already excluded, and its only live effect was dropping **FBS-vs-FCS**
games, which `buildScheduleFromApi` deliberately keeps and which move the
standings. A week could then read as played on Sunday while an owned team's
Labor Day game against an FCS opponent was still to come — and Monday's result
would silently rewrite a week already treated as settled. The filter is gone.

Measured over six cached seasons, **twelve games never resolved**, and eleven are
non-FBS provider noise — six of them Alderson-Broaddus, a school that shut down
its programme mid-2023, plus NESCAC Division III fixtures. The twelfth is
`Liberty @ App State`: a real FBS game between two rostered teams, and the entire
reason step 6 exists.

## Surfacing what was inferred — NOT IMPLEMENTED

The rationale stands and the wiring does not exist. When `selectSeasonContext`
accepts a season as over because every pending kickoff is more than eight hours
past, it keeps no record of which games it accepted without a result. **One such
game is a hurricane; twenty is a broken score feed**, and today those look
identical to an operator.

Two earlier versions of this section asserted the opposite — first that such
games "are reported, not silently absorbed", then that `deriveStandingsHistory`
returns an `inferredConclusions` array. The first was intent stated as fact; the
second described a design that was replaced by `PendingGame[]` and no longer
exists anywhere in the code. Both reviewers flagged the section each time. It is
queued as a follow-up, and stated here as absent rather than described as
present.

## A cached-clock residual, still open

`selectSeasonContext` reads the clock to apply the abandonment allowance, and it
is called from inside two cached paths — `computeLifecycle` within
`dataCachedCanonicalStandings`, and `buildLeagueInsightContext` within
`dataCachedRawInsights`. Neither passes the `currentDate` it was handed. So the
season verdict can be frozen at whatever moment warmed the cache, which is what
`AGENTS.md` invariant 3 forbids.

An earlier version of this section claimed the residual was "step 6 alone" inside
a cached `played`. That is no longer where it lives — `played` is evidence-only
now — and the claim that the derivation had become time-invariant was wrong: the
clock moved one function along rather than out. Both reviewers confirmed it
independently. **Queued, not fixed.**

## What this does NOT change

- **Coverage/progress separation.** Coverage is still "were we missing scores for games that were
  played", still a data-health signal, and still surfaced the same way. A week can be played and
  have incomplete coverage; those remain different facts. `PLATFORM-105A` tightened only the shared
  conclusion evidence feeding them so a scoreless `completed` game cannot publish a resolved
  standings snapshot.
- **The recap's authority.** `season_wrap` trusts the LIFECYCLE — rollover fired, so the season is
  over — not this derived signal, and that stays true. Gating the recap on coverage was considered
  and rejected because one unresolved score would otherwise blank a truthful completed-season recap
  for the entire offseason; coverage remains a separately surfaced data-health fact.
- **Per-consumer patches.** The four surfaces that inherit the confusion are fixed here, at the
  source. None of them grows a workaround.
