# When a week is played, and when a season is over

Status: Current
Last verified: 2026-08-19
Owner: Standings / lifecycle
Canonical for: the predicate that decides a week has been played, and the predicate that decides a
season has ended
Supersedes: (none)

Written for `PLATFORM-105`, before the fix, because the defect it replaces was a single predicate
answering two different questions and nobody could see that from the code.

## The defect this replaces

`isResolvedWeek` asked "is this week's coverage complete?", and coverage means *no game the schedule
calls final is missing a score*. **A week with nothing played has no final games, so nothing is
missing, so it is complete.** "Nothing played" and "everything present" were the same value.

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

## Two questions, not one

| Question | Consumer | What it means |
| --- | --- | --- |
| Has this week been played? | the standings series — movement, surge, climb, slide | there is a usable, settled snapshot for this week |
| Is the season over? | `selectSeasonContext` → recap, champion, throne, race | no football remains |

Coverage answers a third, separate question — *are we missing scores for games that were played?* —
and is unchanged by this work. It is a data-health signal, not a progress signal, and it is already
reported through System Health (`scores-terminal-coverage-missing`/`-partial`).

## The predicate

```text
concluded(game)  = status === 'final'
                 || (game.date != null && now - game.date > GAME_MAX_DURATION)
weekPlayed(week) = the week has ≥1 canonical FBS game
                   && every canonical FBS game in the week is concluded
seasonOver       = every week in the schedule is played
```

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

| | `completed` | `startDate` |
| --- | --- | --- |
| Not yet played | `false` | **future** |
| Cancelled / abandoned | `false` | **past** |
| Played | `true` | past |

The inference is ours to make because the provider cannot make it for us.

### Population: canonical FBS games

Owner ruling, 2026-08-19. Measured over six cached seasons, **twelve games never resolved**, and
eleven are non-FBS provider noise — six of them Alderson-Broaddus, a school that shut down its
programme mid-2023, plus NESCAC Division III fixtures. Scoping to the canonical catalogue excludes
all eleven before any inference is needed.

The twelfth is `Liberty @ App State`. It is a real FBS game between two rostered teams, and it is the
entire reason the elapsed-time clause exists: without it, one hurricane freezes a season forever and
the champion card never fires.

## Surfacing what was inferred

Any game concluded by elapsed time rather than by `completed` is reported, not silently absorbed.
**One such game is a hurricane; twenty is a broken feed**, and the difference must be visible. This is
observation only — it never changes what the predicate decides.

## What this does NOT change

- **Coverage.** Still "were we missing scores for games that were played", still a data-health
  signal, still surfaced the same way. A week can be played and have incomplete coverage; those are
  different facts and this work stops them sharing a value.
- **The recap's authority.** `season_wrap` trusts the LIFECYCLE — rollover fired, so the season is
  over — not this derived signal, and that stays true. Item 52 records why gating it on coverage was
  considered and rejected.
- **Per-consumer patches.** The four surfaces that inherit the confusion are fixed here, at the
  source. None of them grows a workaround.
