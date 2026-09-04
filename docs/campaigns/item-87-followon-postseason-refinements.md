# Item 87 — Follow-on input: postseason grouping, refinements

> **Status:** input for review, not applied.

Child of `item-87-followon-postseason-grouping-notes.md`. Records three refinements from the provider-string verification.

---

## 1. Key the generic group on `playoffCompetition`, not on parse failure

The parent document's §3 rule was: *a playoff row whose round cannot be resolved falls into a generic College Football Playoff group.* That is a **negative** condition — it fires when parsing fails.

The verification found `playoffCompetition: "cfp"` present on the text-inferred rows, provider-supplied rather than parsed, and reaching `AppGame` at `schedule.ts:171`. So the rule should be **positive**:

> **CFP group membership is `playoffCompetition === 'cfp'`.** Round determines which CFP subgroup a game lands in; competition determines that it is a CFP game at all.

Two consequences:

- **A round parse failure can no longer misfile a game.** It loses its subgroup, not its bracket — it lands in the generic CFP group by the same positive test as every other playoff row.
- **Falling into non-CFP Bowls becomes structurally impossible**, rather than prevented by a rule someone has to remember. The degradation path is now a data guarantee.

Better than what the parent proposed. `text-inferred` classifies these rows only because provenance requires structured *round and* competition; the competition is structured and only the round is inferred.

---

## 2. The parse is stable, and has already survived a wording change

Provider `notes` strings, verbatim:

| Season | String |
|---|---|
| 2025 first round | `College Football Playoff First Round Game` |
| 2025 championship | `College Football Playoff National Championship Presented by AT&T` |
| 2021 | `CFP Semifinal at the Goodyear Cotton Bowl Classic` |
| 2022 | `CFP Semifinal at the Vrbo Fiesta Bowl` |
| 2023 | `CFP Semifinal at the Rose Bowl Game Pres. by Prudential` |
| 2021–23 | `CFP National Championship pres./Pres. by AT&T` |

Today's `playoffRoundFromText` regexes (`cfbdSchedule.ts:358-364`) classify all seven correctly, spanning both the short `CFP …` and long `College Football Playoff …` forms and three capitalisations of "presented by" — because every pattern is a case-insensitive substring on the round word alone.

**Answering the original question:** a stable phrase, not something incidental. And the provider wording *did* change between 2023 and 2025, which the parser absorbed. The generic-CFP fallback is a safety net rather than an expectation, but it earns its place precisely because the wording has changed once already.

---

## 3. `eventKey` collides on first-round games — file it

All four 2025 first-round rows share `eventKey: "cfp-first-round"`, and therefore `eventId: "2025-cfp-first-round"` (`schedule.ts:485-486`), because `playoffEventKey` returns `cfp-${round}` with no bowl name to disambiguate. Quarterfinals and semifinals are safe — bowl names suffix their keys — and the championship is singular.

**First round is the one round the scheme cannot separate, and the 12-team format made it four games.**

**File it.** It is a data-identity defect rather than a presentation one, which is the worse class; it is dormant until December but live exactly when the postseason tab matters most; and the round-grouping work touches this area, so whoever picks that up should know. Filing an unconfirmed collision is fine — the measured duplicate is enough to warrant an item, and end-to-end confirmation can be its first step.

**Answered — yes, it is the React key, but the timing does not move.** `schedule.ts:503` sets `key: eventId` when it builds a postseason `AppGame`, and `GameWeekPanel.tsx:213` renders `key={g.key}`. Four first-round games therefore render with four identical React keys in one list, which is the worse of the two consumers. The placeholder participant slot ids collide identically (`schedule.ts:492`, `:498` — `${eventId}-home` / `-away`).

**It is still not reachable today.** `CFBScheduleApp.tsx:313` fixes the season with `useState` and no setter exists anywhere in `src/`, so a member sees only their league's league-resolved season. The 2026 cache holds zero postseason rows, so nothing renders these keys yet. Severity rises; the December timing stands, and the defect goes live the moment the 2026 first round is ingested.

**Filed as Item 121** (`PLATFORM-CFP-EVENT-KEY-COLLISION-v1`), with the 2024 stale cache as **Item 120** (`PLATFORM-2024-SCHEDULE-CACHE-STALE-v1`).

**Separable from round grouping.** Grouping keys on `playoffRound` and `playoffCompetition`, not `eventId`, so the collision does not block it.

---

## Also found — the 2024 cache is a stale partial snapshot

54 postseason rows, all `postseasonSubtype: 'bowl'` with `playoffRound: null`, **zero CFP rows**, every one still `status: 'scheduled'` against December dates, and predating the provenance fields entirely. Cached before the playoff was populated and never refreshed.

**Anything reading the 2024 postseason sees bowls and no bracket**, and no completed statuses. Members cannot reach it — season selection is league-resolved and fixed — so it is an archive-integrity and operator-read problem rather than a member-facing one. Filed as **Item 120**, with one thing to settle before scoping: whether the other historical caches are equally stale. 2021–2023 do carry CFP rows, so 2024 may be singular and the fix may be one refresh rather than a mechanism.
