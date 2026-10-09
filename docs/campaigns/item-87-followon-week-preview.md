# Item 87 — Follow-on input: Week Preview card redesign

> **Status:** input for review, not applied. Check `item-87-INDEX.md` before deciding from this document.
>
> **Reference mockup:** `mockups/week-preview-mockup.html`.
>
> **Surfaces:** Overview only. The rows consume the shared scoreboard contract; §4 records the one deviation and the argument for it.

Redesign of the card shipped as **Forward look**. Verbosity was the trigger; the rename and the recap pairing came out of it.

---

## 1. The name

**`Week 6 Preview`**, replacing `Forward look · Week 6`.

*Forward look* is analyst register. The app elsewhere says GB Race and toilet bowl.

**Rename the recap card to `Week 5 Recap`** at the same time. It currently reads *Weekly Recap*, and recap/preview is the standard sports pairing — numbering both makes the relationship legible without explaining it.

**It does not collide with `Upcoming watchlist`.** A preview is a weekly editorial summary; a watchlist is a running list of games. Different kinds of object, so no reader confusion — which is why names in the *what to watch* family were rejected.

**Settled, not open.** `DESIGN.md` → *Elevated timely-content zone*, owner decision 2026-10-06: Forward Look is the zone's third occupant and **replaces the recap in the same slot** rather than adding a section. One tile holds the slot all week and changes what it shows. The rename follows.

The argument against the alternative is worth keeping on record: a second card would leave the page carrying a preview card **and** a recap tile that becomes a preview — the duplication the one-tile rule exists to prevent.

---

## 2. What was cut, and why

The shipped card states one fact up to four times per item.

| Removed | Why |
|---|---|
| **The headline** | Restated item one verbatim. The card label already names the card. |
| **Row titles** | *"BHooper and Chamness can break their wins tie"* says nothing the tag, the two owner names and the stake do not say together. |
| **The rule explanation** | *"The winner gains a win on the other owner"* is how the league works, not a fact about this game — identical on every tie row. |
| **The duplicated stake** | `+15.5 / −15.5` on two lines is one fact twice. |

**The matchup becomes the row** rather than being buried mid-sentence. It is the thing a member acts on.

Net: five items now occupy less space than three did.

---

## 3. Row anatomy

Each item is a **scoreboard row on the shared contract** — status row, two team lines, right anchor.

```text
TIEBREAKER  Tied at 29 wins              Sat 3:30 PM · ABC
▍ UCLA      BHooper                                    4–1
▍ Oregon    Chamness                                   5–0
```

**The anchor holds the team record**, exactly as the contract specifies for a scheduled row. An earlier draft put the stake there — `29 / 29`, `+15.5 / −15.5` — which read as a score on a game that has not been played, and stated a game-level fact twice. **The stake is a property of the game, not of each team**, so it appears once, in the status row.

**Both owners always render.** The shipped copy drops the second one; with 15 owners over ~130 FBS teams most games have an owner on each side — measured collisions are 50–52 per week, and a league app omitting one is surprising. Ownership is the row's job.

Team colour bar, rank/FCS prefix, owner suffix and `NoClaim` suppression all follow the shared contract unchanged.

---

## 4. The reason leads the row — a deliberate contract deviation

Status-row order on this card is **tag, stake, then logistics right-aligned and demoted** — the inverse of Schedule and Matchups, where metadata is left and the tag is pinned right.

**The argument:** a Schedule row's primary content is the game, and the tag is a note about it. A preview row's primary content **is** the reason — the game is the vehicle. The inversion is the row saying what it is for.

**The precedent already exists.** `DESIGN.md:573` — *"A weekly-recap mini scoreboard is compact evidence, not a game card."* Forward Look is the recap's mirror, so the same reading extends: the game is **evidence for the claim**, not the subject. This is an extension of an existing rule rather than a new exception, and belongs recorded as a per-surface variation the way the owner tint is Matchups-only. If the deviation is rejected, the fallback is *promoted in place*: keep the contract and lift the stake text from tertiary to primary weight. That is cheaper and weaker — the reason ends up split between a pill at the far right and text at the left, so neither half reads as the headline.

The mockup carries both behind a toggle.

---

## 5. Tag vocabulary

**`Tiebreaker` · `Long shot` · `Rivalry`.**

All three are nouns naming **what kind of game this is**, leaving the stake text to state the particulars. An earlier draft used *Upside*, which named a benefit to one owner rather than a property of the game, and *Wins tie*, which is an assembled noun phrase rather than a thing a game can be.

Stake text, stated once in the status row: `Tied at 29 wins` · `Kansas +15.5` · `Series even 5–5`.

**Tags are capped at two**, per `DESIGN.md:293`, applied in the selector.

---

## 6. Games in play — the recap analog

A strip above the rows: games per owner this week, sorted, with the tail dimmed.

**It is the direct analog to the recap's week-records grid**, and the one fact a member opens a preview to get: how many of my teams play.

**It is also the movement ceiling, with no modelling.** The recap's *movement* section has no honest forward analog — predicting standings change needs outcome modelling, which this campaign already ruled would mislead. Games in play bounds the same question truthfully: two wins back with eleven games against the leader's nine is arithmetic the member can do.

**Corrected against measured data (weeks 7 and 8).**

**All fifteen owners, standings order.** Every owner has games every week; counts sit in a 5–9 band. Sorting by count read as a leaderboard when the spread is a bye-week artifact — standings order makes the count a column rather than a rank. The cut at six hid nine owners for no reason the data supports.

**The owner-vs-owner count is dropped.** An earlier draft proposed it as a zero-sum fact with no recap analog. Measured collisions are **52 and 50 per week** — nearly every game. A count that is the default is not a fact, and it tells a member nothing they can act on. If anything is notable it is the inverse: how few games are *not*.

---

## 7. Not built, deliberately

**A superlative strip** (most games, biggest favourite, biggest underdog) would mirror the recap's leaders strip, but biggest underdog is already visible in the rows below. A leaders strip restating what sits beneath it is the redundancy this redesign exists to remove.

**An aggregate headline.** The previous version's headline was removed for restating item one; an aggregate replacement is the hardest copy in the card to generate well, and nothing currently depends on it.

---

## 8. Two selection questions this surfaces

Neither is a presentation issue, and neither is answered here.

**Categories overlap — merge, do not pick a primary.** UCLA–Oregon qualifies as both tiebreaker and long shot and currently renders twice, because `composeForwardLook` has no cross-family dedup on `gameKey`. That is a shipped defect, not a design choice.

`DESIGN.md:620` already governs it: when one game proves several facts, **merge the true category labels into one** row keyed by canonical game identity. A game that is both is *more* notable; picking a primary discards what makes it interesting. Every line already carries `gameKey`.

Note the interaction with §5's two-tag cap: a merged row carrying three true categories still shows two.

**The long-shot framing is restored to the stake text.** Reads `Leader +15.5`, not `Kansas +15.5`. Without the standing position the row says a team is an underdog — a national fact the watchlist already ranks on. With it, it is a league-stakes claim, which is what this card exists to make. The owner name is on the row, so *Leader* needs no further qualification.
