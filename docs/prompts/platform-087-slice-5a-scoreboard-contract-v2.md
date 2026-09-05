PROMPT_ID: PLATFORM-087-SLICE-5A-SCOREBOARD-CONTRACT-v2
PURPOSE: Widen the shared `CompactGameScoreboard` contract so slice 5, Item 112, Item 117, Item 115, Item 119 and Item 118 build on ONE reviewed component change instead of each re-deriving it. Item 87 slice 5a only.
SCOPE: `src/components/CompactGameScoreboard.tsx` and `src/components/__tests__/CompactGameScoreboard.test.tsx`; `src/components/OverviewPanel.tsx` ONLY where the new props must be supplied; `src/components/__tests__/OverviewPanel.test.tsx`. No other consumer, no new dependency, no design token changes.

Read `AGENTS.md` first, then `DESIGN.md` — it is canonical for UI and this is UI work. Neither is
restated here. Queue context: `docs/next-tasks.md` → **Item 87 slice 5a** (run-order position 3).

## References — READ THESE BEFORE WRITING ANYTHING

**These were missing from the first dispatch, and that omission is why the FCS rule below needed
correcting after you had started.** The design was already settled in writing; the prompt paraphrased
it from a one-line queue summary instead of citing it.

**The settled design, canonical for the markers:**

- [`docs/campaigns/item-87-followon-matchups-schedule-design.md`](../campaigns/item-87-followon-matchups-schedule-design.md)
  — §"prefix slot" (around `:43-47`) settles the classification marker: _"rank if ranked, FCS if FCS,
  otherwise empty. No precedence logic, no ambiguous case to test."_ It also records WHY no precedence
  rule is needed: rankings derive from FBS poll data only, so an FCS team never carries a rank — the
  two markers are mutually exclusive by construction of the ingestion pipeline, not by display
  convention. **Where this document and the task list below disagree, this document wins.**
- [`docs/campaigns/item-87-live-watchlist-scoreboard.md`](../campaigns/item-87-live-watchlist-scoreboard.md)
  — the scoreboard family's state model, including the `awaiting` state, the green-dot/`Live`
  treatment, and which surfaces render this component.

**The visual target:**

- [`mockups/live-scoreboard-mockup.html`](../../mockups/live-scoreboard-mockup.html)
- [`mockups/matchups-schedule-mockup.html`](../../mockups/matchups-schedule-mockup.html)

Open both. They show the intended row composition — where the prefix marker sits, how the neutral-site
and broadcast metadata read, and what the tier-2 slot is for. Do not infer the layout from the prose.

### STOP — post a READ RECEIPT before writing any code

You have two sources: the short message pasted into your chat, and this document with its references.
**v1 was built from the pasted message.** It shipped a classification rule that appears nowhere in the
settled design, and neither mockup was opened. That is the failure this gate exists to catch, and it
is not caught by asking whether you read the references — v1 would have said yes.

**Report these, then STOP and wait. No branch, no code, no tests until the owner replies.**

1. The `PROMPT_ID:` line of THIS document, verbatim. (Not the campaign name from the chat message.)
2. From `item-87-followon-matchups-schedule-design.md` §1: the **italicised sentence** that closes the
   prefix-slot section, verbatim with its line number. It records something about an earlier draft
   that changes how you should read any precedence language you encounter.
3. From `mockups/live-scoreboard-mockup.html`: the **CSS class name** the mockup gives the
   classification marker, and the class name it gives the rank marker. Quote the comment above them.
4. From either mockup: **where the neutral-site marker sits** in the row composition — which line of
   the card, and what it sits beside.
5. **Anything in the references that CONTRADICTS, narrows, or is already settled differently from the
   message you were handed.** If you find nothing, say so explicitly — but note that the four
   additions in the task list below are described in the references in more detail than the task list
   gives, and at least one carries a constraint the task list does not state.

A receipt that summarises without quoting, or that could have been written from the chat message
alone, is not a receipt. If a reference is missing, unreadable, or contradicts another reference, say
that instead of resolving it yourself — flagging it is correct behaviour, not a failure.

## v2 is a RECONSTRUCTION. Read this before anything else.

v1 was built, reviewed twice, remediated twice, and **stopped at `b80004c9` without merging** because
review had not converged. Per `AGENTS.md` → **Review and remediation limits**, no third patch lands on
that branch. This is the correct call and it is not up for renegotiation.

**Rebuild from current `origin/main`. Do NOT cherry-pick, rebase, branch from, or copy files out of
`platform/087-slice-5a-scoreboard-contract`.** Use a NEW branch name:
`platform/087-slice-5a-scoreboard-contract-v2`. The stopped branch stays for reference only; reading
it to understand a decision is fine, lifting code out of it is not — the five corrections below are
the reason it stopped, and a copied file carries them back in.

Do not build on `platform/browser-poll-cadence` or `platform/browser-poll-interval` either — those are
merged or abandoned, and a stacked branch has twice produced a review against the wrong base here.

## Carried forward from v1's FIRST review round — do not rediscover these either

The five corrections below come from v1's SECOND round. Round ONE found three more, and those fixes
live only in the abandoned branch's code. **A rebuild from `main` discards them**, so they are
restated here as specification. This is the known weak point of reconstruct-don't-cherry-pick: the
accumulated corrections are lost unless they are extracted as spec.

1. **Header bullets are separators — each renders only when an earlier segment precedes it.** A
   scheduled row carrying only `neutralSite` (or only `broadcast`) otherwise opens with an orphan
   `•`. Latent today (`formatExpandedKickoff` never returns empty, so the sole scheduled caller
   always supplies a clock) but reachable by the later slices this contract exists to serve.
2. **The tier-2 wrapper must carry the spacing and overflow constraints its sibling slots already
   have.** It is the ONLY slot that can widen an `<article>` inside the `grid grid-cols-2` container
   — without them it breaks the two-column layout rather than scrolling inside its own box.
3. **The FCS marker is a bordered pill, not plain text like the rank marker**, matching
   `mockups/live-scoreboard-mockup.html:90-93` (`.sb-line .cls`): `rounded-[3px]`, a hairline border,
   `px-[3px]`, `text-[9.5px]`, `font-semibold`, `tracking-[0.06em]`. **It also needs an explicit
   `leading-[1.4]`** — without it the 9.5px marker changes the line height of the row it sits in,
   which is a render-identical violation that a colour-and-geometry review will not catch.

**Do NOT carry forward one round-1 fix:** commit `28820939` made the scheduled footer conditional on
`tier2Slot` to avoid an empty band. **That fix is what produced correction 2 below** — it traded an
empty band for a misaligned row. Correction 2 supersedes it; solve the empty band without making the
reservation conditional.

**The mockup is LAYOUT truth, not COLOUR truth.** Take the geometry above from it. Do NOT take colour
from it: its marker token is `--text-tertiary: #6b6b6b`, which measures **3.40:1** on the mockup's own
`#161616` and **3.72:1** on the app's `#0a0a0a` — both below the 4.5:1 floor. Colour is re-derived
against the shipping surface, per correction 5. Note the mockup gives `.rank` and `.cls` the SAME
token, which is independent confirmation that the two markers should not diverge in colour.

**Two v1 findings were REFUTED with measured evidence. Do not re-raise or re-litigate them:**

- The `'fcs'`-only marker vocabulary is complete. No rendered game lacks an FBS participant
  (`scheduleEligibility.ts:168`), and production carries **0 FBS-vs-D-II/D-III rows across 2025 and
  2026**, against 126/127 fbs/fcs pairings.
- The raw exact classification match stands **by owner decision**.

## The five corrections — these are SPECIFICATION, not findings to rediscover

All five were verified against the source before this prompt was written. Build to them from the
start; do not re-litigate them.

1. **Broadcast renders on `scheduled || live || awaiting` — everything except `final`. This finding
   was REJECTED by the owner; v1's behaviour here was correct and must be preserved.**

   The reviewer's objection was that `awaiting` can contain a game that is already over:
   `isAwaitingScoreGame` (`src/lib/selectors/gameDayConfidence.ts:36-50`) requires only that kickoff
   has passed and `classifyScorePackStatus(score) === 'scheduled'`, inside a window running to
   kickoff + 24h — so a game whose feed never delivered sits there for a day.

   **Owner ruling, 2026-09-05:** _"awaiting is a subset of live — it was supposed to start and is in
   an indeterminate state — it should show the broadcast info."_ The broadcast label names the channel
   the game is carried on; it is not a present-tense claim that the game is airing. Withholding it
   from precisely the rows where a member most wants to go look for themselves is the worse failure.

   **Do not re-raise this in review.** It is a settled product decision, not an oversight.

2. **The reserved odds band must be unconditional.** The band exists so an odds-less scheduled card
   stays flush with its odds-carrying neighbours in the same row. v1 made the footer conditional on
   `tier2Slot`, which reintroduced exactly the misalignment the band was added to prevent — a card
   with odds gained a row its neighbours lacked. **Invariant to hold and to test: two scheduled cards
   side by side occupy the same height whether or not either carries odds, with tier-2 content
   present and absent.** Assert it as that invariant, not as a class-string match.

3. **The light-theme guard must catch `bg-white`, `text-white`, and `text-black`.** v1's regex was
   `/(?:^|\s)(?:text|border|bg)-(?:gray|zinc|white|black|slate)-/` — the trailing `-` means it only
   ever matched numbered tokens, so it would have had to see `text-white-` to fire. The canonical
   unnumbered tokens walked straight through the guard that existed to stop them. Cover the numbered
   families AND the unnumbered `white`/`black`, and add a positive control: a deliberately bad class
   string the guard is shown to REJECT, so the guard cannot pass vacuously again.

4. **One presence predicate for both slots.** v1 used `footerSlot != null` (nullish) and `tier2Slot`
   (truthy) — an empty array is truthy but not null, so `tier2Slot={[]}` suppressed the footer band
   and rendered an empty tier-2 wrapper. Use ONE shared predicate for both slots and state in a
   comment what callers must pass to mean "nothing".

5. **BOTH prefix markers use `zinc-400`. The rank marker moves too — this is the one intentional
   visual change in the slice.**

   Measured against the `#0a0a0a` composition: `zinc-500` (`#71717a`) is **4.10:1** and FAILS the
   4.5:1 normal-text floor `DESIGN.md` requires; `zinc-400` (`#a1a1aa`) is **7.72:1** and passes.

   **Correction to an earlier draft of this prompt, which the read receipt surfaced.** That draft
   justified the FCS marker diverging from its neighbour by saying "the rank marker sits at a larger
   size". That is wrong. The shipped rank marker is `text-xs` (12px, `CompactGameScoreboard.tsx:131`,
   `dark:text-zinc-500`) and WCAG large text begins at 18.66px bold / 24px — **neither marker
   qualifies, so both are held to 4.5:1, and the shipped rank marker is the same 4.10:1 failure.**

   **AMENDED 2026-09-05, after the first v2 build.** Naming only the two markers was a PARTIAL
   application of the rule, and it let the slice ship a NEW element below the floor: the new
   `Neutral site` span carries no colour of its own and inherits the header row's
   `dark:text-zinc-500`. Three elements on this card remain at `zinc-500` — the header row
   (`:101`, `text-xs`, which the new marker inherits), and the record and owner spans (`:171`, `:179`,
   `text-[12.5px]`). All are 4.10:1. None is WCAG large text.

   **Owner decision: apply the rule COMPLETELY rather than adding a third exception.** The rule is
   **no `dark:text-zinc-500` anywhere in this component** — every one of them moves to `zinc-400`.
   This is one coherent repair, not a growing carve-out list: the findings were rhyming because the
   correction was scoped to symptoms instead of to the rule.

   Enforce it with ONE component-wide guard — `assert.doesNotMatch(html, /dark:text-zinc-500/)`,
   rendered across the card's states — rather than pinning each element's token separately. Update
   the existing header assertion that pins `text-xs dark:text-zinc-500`; it encodes the old value.

## Why this is its own slice

Split from slice 5 by owner decision 2026-09-03. Five later items consume this component. Widening it
once, under review, is the point: if slice 5 / 117 / 119 each widened it themselves, the contract
would be settled three times and reviewed three times.

<task>
Widen the contract with four additions. Each is a PROP the component accepts and renders; none may
change what an existing caller renders today.

1. **Classification marker in the prefix slot** — `rank | FCS | empty`, MUTUALLY EXCLUSIVE. A ranked
   team shows its rank; an unranked team **whose classification is exactly `fcs`** shows an FCS
   marker; everything else shows nothing.

   **CORRECTION 2026-09-05, after dispatch.** This originally said "an unranked NON-FBS team shows an
   FCS marker". That is wrong and would ship a defect: `ProviderClassification` is
   `'fbs' | 'fcs' | 'ii' | 'iii'` (`conferenceSubdivision.ts:89`), and Division II/III map to `OTHER`,
   not FCS — so a non-FBS test would label real D-II and D-III opponents as FCS. The settled design
   says "FCS if FCS, otherwise empty"
   (`docs/campaigns/item-87-followon-matchups-schedule-design.md:41-47`). Require
   `classification === 'fcs'`, and include NEGATIVE coverage for `'ii'` and `'iii'`.

   Rank comes from the existing `rank`/`rankSource` participant fields; classification from
   `homeClassification`/`awayClassification` on `AppGame` (`src/lib/schedule.ts:102`), matched EXACTLY
   as `rankings.ts` matches — no substring or case-insensitive widening.
2. **Neutral-site marker.**
3. **Broadcast on live AND awaiting rows.** `CompactGameScoreboard.tsx:16-19` accepts `broadcast`
   today but renders it on scheduled rows only. It must render on `scheduled`, `live` and `awaiting`,
   and NOT on `final` — see correction 1, which is a settled owner decision.
4. **A tier-2 expansion slot** — a render slot the later slices fill. Empty by default.
</task>

<completeness_contract>
- **Overview must render IDENTICALLY before and after, with EXACTLY ONE named exception: every
  `dark:text-zinc-500` in `CompactGameScoreboard.tsx` becomes `dark:text-zinc-400`.** That is a
  COLOUR-TOKEN change only — no element changes size, weight, position, `title`, or structure. Any
  other render difference is a defect, not a judgement call: if you find yourself wanting a second
  exception, STOP and ask.
- **Prove the rest by MUTATION, not by inspection**: break each new branch in turn and show a SPECIFIC
  named test going red, then restore. A screenshot, a visual check, or "I verified the markup is
  unchanged" is not evidence.
- **Pin both tokens in a test.** The contrast fix is invisible to a render-identical check by
  construction, so it needs its own assertion or the next refactor silently reverts it.
- Every new prop is exercised by a test that fails when the prop is ignored.
- The rank/FCS exclusivity is asserted in BOTH directions: a ranked FCS team shows the rank and NOT
  the FCS marker, and an unranked FCS team shows the marker. **Label the first case for what it is** —
  your read receipt had this right: the collision cannot occur in real data (rankings are FBS-only),
  so that test guards an UPSTREAM DATA DEFECT and is not a product case. Name it that way so a later
  reader does not mistake it for a supported input.
- NEGATIVE coverage for `'ii'` and `'iii'`: neither may render an FCS marker.
- The classification match is EXACT. A test must pin that a near-miss value does not produce a marker.
- Test count delta reported as a measured number.
</completeness_contract>

<gate>
Stop and report, without coding around it, if: the classification data is not reachable from what
`OverviewPanel` already passes (do NOT add a data fetch or widen a server payload to get it); the
neutral-site fact is not already on `AppGame`; or the tier-2 slot cannot be added without changing an
existing caller's output. Any of those means the slice boundary is wrong, and that is the owner's
call.

Do NOT touch `MatchupsWeekPanel`, `GameWeekPanel`, or the Schedule surfaces — those are slice 5,
Item 117 and Item 118, each with owner decisions still parked. The amber `upset` border and the
card-owner treatment are explicitly NOT in this slice.
</gate>

## Closeout — required before merge, not after

Both land in the SAME pre-merge closeout commit (`AGENTS.md` → **Documentation closeout timing**):

- **`DESIGN.md`** — the widened contract: the prefix-slot marker rule, the neutral-site metadata, the
  broadcast state set including the `awaiting` ruling above, and the tier-2 slot.
- **`docs/next-tasks.md`** — slice 5a status.

**Also document this KNOWN LIMITATION** rather than leaving it implicit: provider classifications are
**absent from 2018-2024 data**, so the FCS marker is inert on every historical season and renders only
for current-season rows. That is expected, not a bug — but an undocumented inert marker reads as a
broken one to the next person who looks at an archive page. State it where the marker rule is stated.

<verification>
Run each separately and report its own exit code — never chained behind `&&` or a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; which mutation proved each new branch; and
anything you deliberately did not do.

Push the BRANCH ONLY. **Do not push `preview`, or any preview branch** — that is Claude's alone
(`AGENTS.md` → Preview branch). This slice has a USER-VISIBLE surface, and the owner has been asked
separately whether Claude should push preview on your behalf so it can be clicked through; that
decision is not yours to make inside this task.

The Codex worktree's dev server is port **3010**, not 3000.
</output_contract>
