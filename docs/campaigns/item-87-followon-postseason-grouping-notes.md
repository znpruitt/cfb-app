# Item 87 — Follow-on input: postseason round grouping, implementation notes

> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.

Child of `item-87-followon-postseason-context.md`. That document proposed grouping the postseason tab by round with the bowl name as a row eyebrow, and flagged a data dependency. **The dependency is confirmed satisfied** — this records the verification and four implementation constraints that came out of it.

---

## Verified against the replica (2025 season)

- 86 postseason rows, 46 involving an FBS team.
- `postseasonSubtype` splits those into **35 `bowl` / 11 `playoff`** — the non-CFP bowls group exists ready-made.
- `playoffRound` is populated on all 11 playoff rows: 4 `first-round`, 4 `quarterfinal`, 2 `semifinal`, 1 `national_championship`. The complete bracket.
- `bowlName` is a **separate, co-populated field**, and the proposed table holds on real data: first-round rows carry no bowl name, quarterfinals are Cotton / Orange / Rose / Sugar, semifinals are Fiesta / Peach, the championship carries none.

**The date fallback is not needed.** It stays on the record as the rejected alternative rather than being deleted.

*Caveat: the 2026 cache holds zero postseason rows today, so 2025 is the only live evidence.*

---

## 1. Group from `playoffRound`, order from `startDate` — never from `week`

Postseason `week` values are `{1: 54, 13: 24, 14: 8}`. **Week 1 alone spans first-round games, non-CFP bowls and the national championship.** An earlier draft suggested postseason week numbers might map to rounds; they do not, and a grouping built on them would scramble the bracket.

`slotOrder` is unpopulated on every postseason row, so it is not an alternative.

**Rule:** group membership from `playoffRound` and `postseasonSubtype`; group order and within-group order from `startDate`.

---

## 2. Reuse `deriveFeaturedGameBadge` — do not re-derive the labels

`OverviewPanel.tsx:158` already renders "CFP First Round", "CFP Quarterfinal", "CFP Semifinal" and "CFP Championship" from `playoffRound`, including a documented fallback that resolves the generic `playoff` value via `!game.neutral`.

It returns `null` for non-CFP bowls — which independently confirms the row-eyebrow decision: the bowl name is not a round badge and should not be rendered as one.

**This makes the item smaller than the parent document's scope note assumes.** The work is grouping and ordering, not label derivation.

---

## 3. Text-inferred rounds must degrade to a generic group, not vanish

`playoffRoundSource` is `cfbd-structured` for the six bowl-named rounds and `text-inferred` for the five without one. **First Round and Championship headings therefore rest on parsing CFBD `notes` strings.**

That is sanctioned — `cfbdSchedule.ts:23-31` permits text-inferred rounds to inform presentation, reserving `cfbd-structured` for rollover — but it means a wording change in a future season can break exactly those two headings.

**Rule:** a game with `postseasonSubtype: 'playoff'` whose round cannot be resolved falls into a generic **College Football Playoff** group, ordered by `startDate` alongside the others. It must not vanish, and it must not fall through into the non-CFP Bowls group, which would be a false statement about the game.

Same principle as the `unknown` game state: an unresolvable value gets a truthful home rather than being dropped or guessed into a wrong one.

---

## 4. Typing trap — `first-round` is missing from the named union

`schedule.ts:124` types `playoffRound` as `'quarterfinal' | 'semifinal' | 'national_championship' | 'playoff' | string`. It **omits `'first-round'`**, which the wire type at `cfbdSchedule.ts:14` does include.

The value survives at runtime through the `| string` arm, so nothing fails loudly — but a grouping `switch` written against the named union **silently drops every first-round game**.

**Acceptance criteria:** widen the union to include `'first-round'`, and include a first-round game in the grouping tests specifically. A test suite built from the named union would pass while the bracket loses four games.

---

## The two requested checks, run

### 1. The text-inferred strings — and they are not blind text parses

The two cases, verbatim from the 2025 cache:

- **First round**, all four rows identical: `"College Football Playoff First Round Game"`
- **Championship**: `"College Football Playoff National Championship Presented by AT&T"`

**Both rows also carry `playoffCompetition: "cfp"` — a structured field, not text.** They are classed `text-inferred` only because the provenance function (`cfbdSchedule.ts:410-455`) requires a structured round *and* a structured competition for `cfbd-structured`; here the competition is structured and only the round is inferred. CFBD is confirming these games are CFP; the parse decides which round.

**That strengthens §3's rule from a policy to a data guarantee.** A playoff row whose round fails to parse still carries `postseasonSubtype: 'playoff'` and `playoffCompetition: 'cfp'`, so it cannot fall through into non-CFP Bowls even by accident. `playoffCompetition` reaches the component layer (`schedule.ts:171`), so the generic-CFP group can be keyed on it rather than on a parse failure.

### 2. 2024 cannot answer the question — but 2021–2023 can, and answer it better

**The 2024 cache is a stale partial snapshot, not a second season of evidence.** It holds 54 postseason rows, **all** `postseasonSubtype: 'bowl'` with `playoffRound: null` — **zero CFP rows** — every one still `status: 'scheduled'` against December dates, and it predates the provenance work entirely: `playoffRoundSource`, `playoffCompetition` and `homeClassification` are absent as fields. It was cached before the playoff was populated and never refreshed. That absence is itself worth knowing: an operator reading the 2024 postseason tab today would see bowls and no bracket at all.

**2021, 2022 and 2023 do carry CFP rows** — three each, the four-team era's two semifinals plus the championship — and they use a **different phrasing** from 2025:

| Season | `notes` | `bowlName` |
|---|---|---|
| 2021 | `CFP Semifinal at the Goodyear Cotton Bowl Classic` | Goodyear Cotton Bowl |
| 2022 | `CFP Semifinal at the Vrbo Fiesta Bowl` | Vrbo Fiesta Bowl |
| 2023 | `CFP Semifinal at the Rose Bowl Game Pres. by Prudential` | Rose Bowl |
| 2021–23 | `CFP National Championship pres./Pres. by AT&T` | none |
| 2025 | `College Football Playoff First Round Game` | none |
| 2025 | `College Football Playoff National Championship Presented by AT&T` | none |

Running today's `playoffRoundFromText` regexes (`cfbdSchedule.ts:358-364`) against all seven strings classifies all seven correctly. **The parser already handles both the short `CFP …` form and the long `College Football Playoff …` form**, across three capitalisations of "presented by", because every pattern is a case-insensitive substring on the round word alone.

**Answer to the question behind the ask:** the inference is matching a stable phrase, not something incidental — and it has already survived one provider wording change, between 2023 and 2025. The generic-CFP fallback is a safety net rather than something to expect in practice, but it earns its place precisely because the wording did change once. *Caveat: the 2021–2023 caches predate `playoffRoundSource`, so their stored round values were written by an older normalizer; the check above is today's regexes against the provider's own `notes` strings, which is the test that matters.*

---

## Found while checking — `eventKey` collides across first-round games

Not this item's subject; recorded so it is not lost.

All four 2025 first-round rows carry the identical `eventKey: "cfp-first-round"`, because `playoffEventKey` (`cfbdSchedule.ts:366-370`) returns `cfp-${round}` when there is no bowl name to disambiguate. `schedule.ts:485-486` then builds `eventId = ${season}-${eventKey}`, so all four become `2025-cfp-first-round`. Quarterfinals and semifinals are safe — the bowl name suffixes their keys — and the championship is singular by definition. **First round is the one round the scheme cannot separate, and the 12-team format made it four games.**

The reachable consumer is the operator label override: `GameWeekPanel.tsx:340` saves by `g.eventId`, and `schedulePostseasonHelpers.ts:372-377` applies it to every candidate where `candidate.eventId === eventId`. On that path one label edit would apply to all four games. Stated as the code path plus the measured key collision — **not** traced end-to-end through a running app, so it needs its own investigation before it is called a confirmed defect.

---

## Scope, revised

Smaller than the parent estimated. Grouping and ordering on the postseason tab, reusing existing label derivation, plus the union widening. Still its own item, still additive, still touching no other consumer.
