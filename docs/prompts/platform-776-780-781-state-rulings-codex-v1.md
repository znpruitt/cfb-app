PROMPT_ID: PLATFORM-776-780-781-STATE-RULINGS-CODEX-v1
PURPOSE: Three owner rulings from 2026-09-14, delivered as one slice because two of them interact.
Drop a false claim on the history empty state; give disrupted games a truthful state; and make the
Members "Live games" list agree with the count above it.
SCOPE: `src/app/league/[slug]/history/[year]/page.tsx` (part A); the disruption path into
`projectGameScoreboardState` and the Members row authority (parts B and C); `src/lib/ownerView.ts`,
`src/components/OwnerPanel.tsx`, and their suites. NOT the 24h bound, NOT the `unavailable` eligibility
predicate, NOT the summary COUNT contract — all three are settled and this slice must not reopen them.
CARRIES: `docs/campaigns/item-87-INDEX.md` → **CARRY THIS**, LIVE standing rows 1, 6, 7, 8, 9, binding
on every Item 87 prompt. **Checked the by-owning-item table: no row is owned by #776, #780 or #781.**
Rows 8 and 9 bind hardest and are reproduced first; all five follow.

- **Row 8 (LIVE).** Selection and precedence stay selector-owned; the scoreboard **must not be forked**. There are **five direct renderers**: Overview `GameCardList` (serving Live AND Recent finals), Overview `WatchlistScoreboardList`, Overview `FeaturedGamesList`, `GameWeekPanel`, and Matchups `GameRow` — three importing modules, six rendered contexts. **And the recap is NOT a consumer**: `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.
- **Row 9 (LIVE).** **Never suppress individual finals against recap content**, and do not reintroduce a subtler version. Recent finals is complete; the recap is curated.
- **Row 7 (LIVE).** **Do not read campaign status from the canonical document**, and **re-derive every line-number citation** before putting it in a prompt.
- **Row 1 (LIVE).** A build with records absent or stale **will not match the mockup**, and a reviewer comparing them must read that as a **sequenced dependency, not a defect**. A missing record leaves the anchor **blank**, never the spread.
- **Row 6 (LIVE).** **Do not "restore" the mockup's tint inset.** The implementation ships `0 -8px` plus squared facing corners; **anyone reconciling the two changes the MOCKUP, not the code.**

Issues: [#776](https://github.com/znpruitt/cfb-app/issues/776),
[#781](https://github.com/znpruitt/cfb-app/issues/781),
[#780](https://github.com/znpruitt/cfb-app/issues/780). Each carries its ruling as a comment.

---

## Lane and branch

**UI lane, `/Users/zach/cfb-app-codex`.** Branch off current `origin/main` and **verify the SHA**.
`npm test` exits 0 on clean `main`; **the known-failure set is EMPTY**.

**`preview`: slice-scoped grant, on the same terms as the last one.** Parts B and C are user-visible.
The platform lane's push-`preview` instruction is suspended for its concurrent branch, which is what
preserves the single-writer property — **not lane idleness.** Push the branch and `preview` together;
the grant lapses at merge.

## Take them in this order, and the reason is a dependency

**A → B → C.** A is independent and can land first. **C must follow B**, because B changes what
`currentStatus` can hold and C is a predicate over exactly that vocabulary. Writing C first means
writing it against a set that is about to change.

## PART A — #776: drop the claim

`src/app/league/[slug]/history/[year]/page.tsx:77` renders, for a season with no archive:

> *"Historical data is available from the 2025 season onward."*

**`tsc` has an archive for 2018**, and for 2021–2025. So the sentence is false for the only league with
any history, shown exactly when someone went looking for an older season.

**Owner ruling: drop the sentence.** Say this season has no archived data and stop.

**Do NOT derive a year from the archive list.** `tsc` has real gaps at **2019 and 2020**, so "from 2018
onward" is false in the same way — any "from X onward" phrasing asserts a continuous range the data
does not have.

## PART B — #781: disrupted games get "No score reported"

A canceled, postponed or suspended game currently projects **`Scheduled`** and renders at its original
kickoff time. It will not be played then, and in the canceled case not at all.

**Owner ruling: disrupted games project `unavailable` — "No score reported."** No sixth state.

**The provider fact that makes this SAFE rather than merely least-wrong**, owner 2026-09-14:

> We have no provider status for these. If CFBD shows a reschedule, the dev has confirmed they just
> drop that GameID and generate the rescheduled game as a **new GameID**.

**Two consequences, and both belong in a CODE COMMENT, not only the closeout:**

1. **We cannot distinguish a cancellation from a postponement** — no provider status separates them.
   A label claiming either would invent information; "No score reported" claims only what is known.
2. **A disrupted GameID is TERMINAL BY CONSTRUCTION.** It is never reused; a rescheduled fixture
   arrives as a different game. **So the row can never later become a real game**, which is exactly
   what makes a terminal state safe here. **This is not discoverable from the data** — the next reader
   will otherwise assume a disrupted game might resolve in place.

**Where the disruption check goes is YOURS to determine — receipt item 2.** `isDisruptedStatusLabel`
lives at `gameStatus.ts:122`; `projectGameScoreboardState` (`gameScoreboardState.ts:12`) has **no
disruption branch at all**; and `overviewGameSections.ts:107` routes disrupted games to `scheduled`
with a disruption status of its own. **So disruption is handled in at least two places today and the
projector is not one of them.** Establish the real population before choosing.

## PART C — #780: list the awaiting rows

`OwnerPanel.tsx:492-496` renders `title="Live games"` from `snapshot.liveRows`, and
`ownerView.ts:315` computes them as `rosterRows.filter((row) => row.currentStatus === 'Live')`.

The **summary count** already treats awaiting as live — owner ruling 2026-09-13, and it stands. So a
game can be counted and not listed.

**Owner ruling: the list includes awaiting rows**, so the count and the list agree. **The count
contract does not change.**

**Overview is the precedent and the model** — its Live section already carries awaiting rows rendered
neutrally (`DESIGN.md` → *Cards and game results*). Match that treatment; do not invent one.

**And this is why C follows B:** after part B, `currentStatus` can hold "No score reported" for a
disrupted game. **That is terminal and must NOT enter the Live list.** A predicate written before B
would not know the value exists.

## RULINGS ON THE READ RECEIPT — 2026-09-14, binding. Part B is NARROWED; the premise did not cover the vocabulary.

**1. PART B APPLIES TO CANCELED AND POSTPONED ONLY. Delayed and suspended are EXCLUDED.** This is the
ruling your finding forced, and it corrects mine.

**The owner's terminal-by-construction fact is about RESCHEDULES** — CFBD drops the GameID and issues
a new one. That describes a game replayed on another date. **A delayed game (kickoff pushed, same day)
and a suspended game (halted mid-play, often resumed) resolve IN PLACE under the SAME GameID.** Calling
either "No score reported" would be false and corrected by the next poll.

**The codebase already says this and I wrote past it.** `gameStatus.ts:126-133`:

> A canceled/cancelled game is TERMINAL … **This is deliberately NARROWER than
> `isDisruptedStatusLabel`: postponed / suspended / delayed are also disrupted but are NOT terminal** —
> they are unresolved and should still be treated as missing a final result.

**Use `isCanceledOrPostponedStatusLabel` (`gameStatus.ts:142`) — do NOT invent a fourth predicate.**
Its docblock names exactly this distinction: *"Canceled/postponed are terminal for live polling: unlike
delayed/suspended, they must not keep a provider or browser polling window armed."* That is the same
terminality part B needs, and it already exists.

**So Part B's opening sentence is wrong** where it names canceled, postponed **and suspended**, and the
acceptance boundary's "every disrupted game" is wrong. Both are corrected by this ruling. **Delayed and
suspended keep their current behaviour** — whatever that is on each surface — and this slice does not
touch them.

**2. PRECEDENCE: usable final or live evidence WINS over a disrupted label.** Do not change it. A real
final means the game was played, and a stale disrupted label alongside it is the label being wrong.
The existing behaviour is correct and this slice preserves it.

**3. AUTHORITY: the shared projector, as you recommend, and reconcile Schedule's and Overview's
forks.** Two surfaces carrying their own disruption logic IS the divergence pattern this campaign
exists to remove, and leaving them would mean three answers to one question. **Reconciling them is in
scope by consequence** — measure what changes on each, do not discover it at review.

**4. CARDINALITY: your reading is right.** "Same population" means matching **state eligibility** —
Live plus Awaiting, excluding "No score reported" — **not equal counts.** A self-matchup gives the
summary one distinct game and the list one row per owned team, and the summary's distinct-game
contract is settled. Say so in the closeout so nobody later "fixes" the difference.

**5. ACCEPTED CORRECTIONS, all of them:** the projector is at `gameScoreboardState.ts:58`, not `:12`;
B changes which inputs produce an existing `currentStatus` value rather than adding one; Schedule
**suppresses** the kickoff for disrupted rows, so "renders at its original kickoff time" was true of
Matchups only; and part C's disrupted exclusion is **defensive contract coverage**, with the actual
regression fix being the addition of `Awaiting score`.

**6. STATE THE ZERO-OCCURRENCE MEASUREMENT PROMINENTLY IN THE CLOSEOUT.** Zero disrupted labels across
22,760 schedule rows and 20,424 score statuses means this change **cannot be validated against
production data and cannot regress anything observable in it.** Both halves matter. A reader must not
come away thinking the new behaviour was seen working.

## Acceptance boundary

- Part A: the false sentence is gone and no replacement asserts a range.
- Part B: a disrupted game reads "No score reported" on every surface that projects it; the provider
  fact is in a code comment at the check.
- Part C: the Live list and the summary count agree on the same population, and **"No score reported"
  is excluded from both**.
- **No change to the 24h bound, the `unavailable` eligibility predicate, or the summary count
  contract.** All three are settled; reopening any is out of scope.
- Untagged, unaffected rows are pixel-identical.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test`, plus `npm run test:clock-shift -- 0` and one
  non-zero shift — each its own command, each its own real exit code, never behind a pipe. **One
  complete run that itself exits 0.** Report the DELTA measured at both ends.
- **Mutation-prove each part separately.** A test that goes red for part B must not be the test that
  covers part C, or you cannot tell which is wired.
- Part C needs a fixture with **both** an awaiting row and a disrupted one, so "includes awaiting"
  and "excludes No score reported" are discriminated rather than assumed from one case.
- Part A is copy: assert the absence of the claim **and** the presence of the replacement, so deleting
  the whole block does not pass.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge: `docs/prompt-registry.md` and the `docs/next-tasks.md` rows, **keyed by issue link**.
Record the provider GameID fact as the reason part B is safe. **`DESIGN.md` may need a line for the
disrupted case — that file is planning's; report the wording rather than editing it.**

**At merge, verify BOTH directions in the shared ledger files by reading them.** A clean `ort` result
is not the claim that both sides survived — PR #777 silently reverted a true correction that way.

## STOP — read receipt before writing any code

1. **Does part A's page have a test pinning that sentence?** If so it changes with the copy; if not,
   your assertion is the first thing holding it.
2. **Where is disruption actually handled?** Enumerate every path that reads `isDisruptedStatusLabel`
   or an equivalent, say what each does with the answer, and name the one that produces `Scheduled`
   today. **The projector has no disruption branch — so adding one there is a new behaviour on every
   consumer of that projector, not a local fix.** Cost that before choosing.
3. **What values can `currentStatus` hold after part B?** Enumerate them, with the producer of each.
   Part C's predicate is written against this list.
4. **Can a disrupted game currently reach the Members Live list at all?** If it cannot, part C's
   exclusion is defensive rather than a fix — say which, because it changes what the test proves.
5. **Does any surface other than Overview and Members render a disrupted game?** Schedule and Matchups
   both consume the projector. If part B changes them, that is in scope by consequence and must be
   measured, not discovered at review.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
