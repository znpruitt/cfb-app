# Item 87 — Follow-on input: postseason temporal context

> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.

Answers the residual added to §3 of `item-87-followon-section-ordering-resolutions.md`: the postseason tab is not week-scoped (`CFBScheduleApp.tsx:1896` passes `postseasonGames` unfiltered), so a postseason final carries no date, no time and no week, and nothing on the surface says when it was played.

---

## The rule was never "finals carry no date"

It is **"finals carry no date because the container supplies temporal context."** Regular-season Matchups satisfies that through week tabs; Schedule satisfies it through date-group headings. The postseason tab satisfies it through nothing, so the rule does not fail there — its precondition is simply absent.

That points at the fix. Give the postseason tab a container, rather than exempting it from the rule.

---

## Recommendation — group by round, label the bowl on the row

**Round and bowl are two attributes, not one taxonomy.** Under the 12-team format the quarterfinals and semifinals *are* bowl games — the Rose Bowl may be a quarterfinal — so "Bowls" and "CFP rounds" are not disjoint categories and cannot both be group headings. An earlier draft of this document proposed exactly that and was wrong.

**Group by round.** Round is the structural progression and every postseason game has exactly one:

| Group | Bowl names present? |
|---|---|
| CFP First Round | no — campus sites |
| Bowls (non-CFP) | yes |
| CFP Quarterfinals | yes — the game *is* a bowl |
| CFP Semifinals | yes |
| National Championship | no — not a bowl |

Groups run in calendar order, which interleaves naturally: First Round, then the non-CFP bowls, then Quarterfinals, Semifinals, Championship.

**The bowl name is a per-game label, not a group.** It belongs on the row as an eyebrow, in the same slot "Ranked spotlight" occupies — so a row reads *Rose Bowl* under a *CFP Quarterfinals* heading. Games without a bowl identity simply omit it, exactly as untagged games do elsewhere.

**Why this is better than restoring dates:**

- **Round is the more meaningful label.** "CFP Semifinal" says more about a game than "Jan 9", and it is how people refer to these games. The date is the weaker fact here, not the stronger one.
- **Both facts survive.** Grouping by round and labelling the bowl on the row keeps the two attributes separate instead of forcing one to stand in for the other.
- **It preserves one rule across every surface.** No per-surface exception, and no reader wondering why postseason finals look different.
- **These are the games people return to**, so this is the surface least well served by an exception and best served by proper structure.

**Data confirmed — the structure is viable, and the app already has both attributes.** Measured against the read-only replica, `app_state` `scope='schedule'`, `key='2025-all-all'` (the last completed postseason; the 2026 cache holds 0 postseason rows on 2026-09-03, so 2025 is the only live evidence available):

- 86 postseason rows, 46 involving an FBS team.
- `postseasonSubtype` splits those 46 into **35 `bowl`** and **11 `playoff`** — the non-CFP bowls group, ready-made.
- `playoffRound` is populated on all 11 playoff rows: **4 `first-round`, 4 `quarterfinal`, 2 `semifinal`, 1 `national_championship`** — the complete 12-team bracket.
- `bowlName` is a **separate, co-populated field**. The table above holds exactly as written: the four first-round rows carry no bowl name, the quarterfinals are Cotton / Orange / Rose / Sugar, the semifinals are Fiesta / Peach, and the championship carries none.

Round is therefore derivable independently of bowl name, on real data, and both already reach the component layer — `AppGame` carries `bowlName` (`schedule.ts:163`) and `playoffRound` (`:164`) as distinct fields.

**Three things the implementer needs, all measured:**

- **Week does not encode the round.** Postseason `week` values in that cache are `{1: 54, 13: 24, 14: 8}` — week 1 alone holds 54 rows spanning first-round games, non-CFP bowls and the championship. The guess that postseason week numbers map to CFP rounds is wrong; group from `playoffRound`, order from `startDate`. `slotOrder` is unpopulated on every one of these rows and cannot be used either.
- **The labels already exist.** `deriveFeaturedGameBadge` (`OverviewPanel.tsx:158`) already renders "CFP First Round", "CFP Quarterfinal", "CFP Semifinal" and "CFP Championship" from `playoffRound`, with a documented fallback that resolves the generic `playoff` value through `!game.neutral`. Group headings should reuse that function rather than re-derive it; it returns `null` for non-CFP bowls, which is what makes the bowl name the row eyebrow rather than a badge.
- **Provenance splits along the bowl-name line.** `playoffRoundSource` is `cfbd-structured` for the 6 bowl-named rounds (quarterfinals and semifinals) and `text-inferred` for the 5 without one (first round and championship), which are read out of CFBD `notes` strings like "College Football Playoff First Round Game". Presentation may rely on that — `cfbdSchedule.ts:23-31` states text-inferred rounds "may still inform presentation/diagnostics" and only rollover requires `cfbd-structured` — but the First Round and Championship headings do rest on text inference, and should degrade to the generic CFP group rather than vanish if a season's notes change.

**One typing trap.** `schedule.ts:124` types `playoffRound` as `'quarterfinal' | 'semifinal' | 'national_championship' | 'playoff' | string` — it omits `'first-round'`, which the wire type (`cfbdSchedule.ts:14`) does include. The value survives at runtime through the `| string` arm, so a grouping `switch` written against the named union will silently drop every first-round game. Widen the union or match on the string.

## Fallback — postseason finals keep a date — NOT NEEDED

Retained as the record of the alternative, not as a live option: the data check above confirms round grouping is viable, so this fallback does not apply.

If round grouping had not been viable, postseason final rows would carry a date, recorded as an **explicit, reasoned exception** rather than left as drift: *the postseason tab has no temporal container, so its rows supply their own.*

Less good, because a surface-specific exception to a universal rule is what rots first — but honest, and better than a postseason final with no temporal information at all.

---

## Scope

Round grouping is additive to the postseason tab and does not touch the scoreboard component or any other consumer. It is not part of the Matchups or Schedule transitions and should carry its own item.

---

## Correction acknowledged

The `ESPN2` broadcast removed from the owner-card live row was an error on my part, not a decision — it left the mockup internally inconsistent, since the Schedule section's live row in the same file still carried broadcast, and Item 87 slice 5a explicitly widens the contract to put broadcast on live rows. The CLI's restoration is correct and should stand.
