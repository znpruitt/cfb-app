# Item 87 — Follow-on input: team records across scoreboard states

**Supersedes nothing.** This is additive to `item-87-live-watchlist-scoreboard.md`. Apply into that document where it fits; the mockup at `mockups/live-scoreboard-mockup.html` already reflects everything below.

> **APPLIED 2026-08-31.** Folded into `item-87-live-watchlist-scoreboard.md` → *Records across scoreboard states — resolved*, which is now canonical. This file is retained as the input record. Two adjustments were made when applying: **Item 92 shipped as PLATFORM-117** (PR #543, `9376521e`), so the records dependency is wiring rather than a blocker; and the freshness gaps this design makes user-visible were filed as **Item 97** and subsequently implemented by `PLATFORM-118-TEAM-RECORDS-FRESHNESS-v2` (PR #546 open).

---

## Decision — records appear in every state, in one of two positions

| State | Anchor | Record position |
|---|---|---|
| Scheduled | **team record** | the anchor itself |
| Live | score | **inline**, parenthetical after the team name |
| Final | score | **inline**, parenthetical after the team name |

On scheduled rows no score exists, so the record takes the anchor and spread plus O/U sit on the odds footer. On live and final rows the anchor is occupied by the score, so the record moves inline — `#14 USC (7–1) · Chamness · 21` — which is standard CFB scoreboard placement.

**Finals carry the post-game record**, including the result being read. A stale record on a final is bad data handling, and it is conventional everywhere in the sport.

**One rule, not two.** The record shown is always the team's *current* record — not "entering" versus "after". A scheduled row shows the current record, which is pre-game by definition; a final shows the current record, which includes the result. No state-dependent branching in the data layer.

### The position shift is accepted

The record sits in the anchor on scheduled rows and inline on live and final rows, so its position varies by state. This was weighed and accepted: the watchlist is legitimately a different layout, and the anchor consistently holds whatever number matters most in that state.

**Rejected alternative:** record inline in every state, with the scheduled anchor given back to the per-team spread and O/U alone on the footer. That buys a stable record position at the cost of an anchor that no longer holds the most relevant number, and it reverses the earlier decision to put spread and O/U together on the odds line.

---

## Consequence — Item 92 is more load-bearing than when it was split out

When the CFBD records integration was separated from Item 87, records appeared only on the watchlist, so the fallback was contained to one section. They now appear in every scoreboard state.

**Degradation remains clean in both directions:**

- Live and final rows omit the inline parenthetical.
- Scheduled rows anchor on the per-team spread, with O/U alone on the footer.

No redesign is required either way, and no row loses its right-edge anchor.

**But Item 87's shipped appearance will differ from the mockup until Item 92 lands.** The implementation prompt must state this explicitly, or a reviewer comparing the build against the reference will read the absent records as a defect rather than a sequenced dependency.

Update to the blocker list: *Item 92 → records in all scoreboard states* (previously scoped as *Item 92 → watchlist anchor*).

---

## Carried forward unchanged

- **A record belongs to the line's primary identifier.** Team-primary line (this scoreboard, any state) → team record. Owner-primary line (recap week records, standings, movement) → owner record. Context disambiguates; no label needed.
- **Item 92 cadence.** Refresh in the live-scores cron, which already observes non-final → final transitions and spends quota under a reserve check. Do **not** hook `handleGamesFinalized` — it is a client callback firing per browser, and doing so would invert the cron-spends / client-reads split established by PLATFORM-086B2B and preserved by PLATFORM-075. Record the refresh under a scope the Provider data panel reads, or records join scores and game-stats showing `No refresh history` while working correctly (Item 88).
- **Recap notable results** remain deferred on records — additive later, no reason to couple that work to Item 92.
