# PLATFORM-723-725-715 — Matchups caller work

```text
PROMPT_ID: PLATFORM-723-725-715-MATCHUPS-CALLER-WORK-CODEX-v1
PURPOSE: Bring MatchupsWeekPanel's CompactGameScoreboard call site into conformance with the
         shared row contract on three points it currently misses — broadcast, the tag cap, and
         scheduled-row odds. Caller work in one file; no selector or component change.
SCOPE:   src/components/MatchupsWeekPanel.tsx and its tests. DESIGN.md only if a receipt finding
         requires it. DO NOT modify CompactGameScoreboard.tsx, matchups.ts, gameTags.ts, or any
         selector — if the work appears to need one, stop and report instead.
CARRIES: Item 87 INDEX row 3 (DISCHARGED, quoted because it is the contract being conformed to):
         "Record the `CompactGameScoreboard` contract widenings before any consumer is built —
         done in slice 5a (PR #570) and `DESIGN.md`; the prefix rule, broadcast on
         scheduled/live/awaiting, neutral site, and the non-reserving tier-2 slot."

         Item 87 INDEX row 29 (LIVE, governs #715, quoted verbatim in the part that binds):
         "Odds inline on Matchups — SCHEDULED ROWS ONLY. CORRECTED 2026-09-08 by owner ruling.
         This row previously read 'including live and final rows'; that phrase is in neither the
         design document nor the mockup. The document (`matchups-schedule-design.md:104`) says only
         'inline on Matchups, where nine games per card justify them' and names no state. The
         mockup names the states: all six `sb-odds` elements sit in SCHEDULED blocks — zero on
         live, zero on final — and gives the empty case an explicit `Line not posted`. The 'live
         and final' phrasing came from the 2026-09-08 discharge note below the widening, which
         inferred a requirement from a code constraint (the footer was gated to `scheduled`).
         A gate is not a requirement."

         Item 87 INDEX row 30 — RESOLVED 2026-09-14, and you should know it existed. It carried
         "decide whether Matchups rows carry broadcast" as an open owner question, on the premise
         that the mockup omits broadcast on every Matchups row. THE PREMISE WAS FALSE, measured:
         Matchups carries it on 1 of 10 rows, Schedule on 3 of 13, and each section has two live
         rows split one-and-one. DESIGN.md:201 decides it per state with no surface exception.
         #723 is therefore a conformance fix, not a decision. See the issue comment for the counts.
```

---

## Why this slice exists

The **#672 audit** compared Matchups and Schedule against the shared row contract on 2026-09-11 and
produced ten residue issues. Three of them are the same kind of thing in the same file: **decisions
already ruled on Overview that were never back-applied to the Matchups call site.** They are grouped
because the UI lane is strictly serial with itself, and two slices touching one component file cost
two reviews of the same diff.

Nothing here is a new design. Every answer already exists in `DESIGN.md`, in the component, or in
`OverviewPanel.tsx`.

---

## The three, each verified against the code at `main`

### 1. #723 — no `broadcast` is passed

`MatchupsWeekPanel.tsx` renders `CompactGameScoreboard` and passes no `broadcast` prop at all.
`DESIGN.md:201` binds the component: *"Broadcast renders for scheduled, live, and awaiting rows, but
not finals."*

**The caller does not gate by state, and this is the part most likely to be over-built.**
`CompactGameScoreboard`'s own `displayPolicy` already decides: `scheduled`, `live`, `awaiting` and
`unavailable` show it, `final` does not. **Note `unavailable` — #723's text says "scheduled, live and
awaiting" and omits it.** The component is right and the issue text is incomplete.

**Follow `OverviewPanel.tsx:777-797`.** It enumerates per state at the call site *anyway*, and its
comment is unusually honest about what that buys — read it before copying it. It says the component
also suppresses broadcast on finals, so deleting the caller's gate **changes no rendered output and
the two callers are indistinguishable at the DOM**; the gate exists so the surface satisfies
`DESIGN.md` → *List row width discipline* (enumerate per state, never define by negation) at the
layer it owns, and a structural pin is what fails if it is simplified away.

**Decide, and say which you chose and why:** enumerate at the Matchups call site the way Overview
does, or pass the label unconditionally and let the component's policy decide. Both render
identically today. One matches the sibling surface; the other is less code. This is a judgement
call and I am not pre-empting it — but a structural pin is required either way if you enumerate,
because no behavioural test can see the difference.

### 2. #725 — a responsive `hidden` is a second, invisible tag cap

At the `tagSlot`, secondary tags render with `className={`hidden sm:inline-flex ...`}` while the
primary does not. **The selector may supply two tags and the viewport silently drops one.**

`DESIGN.md` puts the two-tag cap in the SELECTOR and uses mobile wrapping, so selected tag content
survives at every width. This is the direct one-surface-over instance of **#671's ruling**, which
shipped on Overview: the cap that ships here is not the cap that was ruled.

**Drop the responsive `hidden`.** The wrapper is already `inline-flex flex-wrap gap-1`, so wrapping
is what should happen at narrow widths.

**One thing to check rather than assume:** #758 is an open, unsequenced finding about phone-width
tag relief on *scheduled* rows. If removing the `hidden` here makes a row overflow at phone width,
that is #758's territory — **report it, do not fix it in this slice**, and do not reintroduce a cap
to avoid it.

### 3. #715 — no odds on scheduled rows

`MatchupsWeekPanel` already receives `oddsByKey` and reads the row's entry, but passes it only to
`computeGameTags`. It never passes `footerSlot`. The seam is open — Item 155 made the footer
content-gated, so any state may carry one.

**Scheduled rows only. Zero on live, zero on final.** That is row 29's owner ruling and it was
corrected once already; do not widen it.

**The empty state is content, not a spacer.** `Line not posted` renders as a real string on
scheduled rows with no line. Item 155 removed a reserved empty BAND from Matchups and that stays
removed: a vertical list has no peer to align with, so it reserves no height. Rows are uniform
because they all carry content, not because one is padded. **Do not reintroduce a reserved band.**

**The format, from the mockup:** `Georgia Tech −7.5 · O/U 48.5`. Note the characters — the mockup
uses `&minus;` (U+2212), not a hyphen, and `&middot;` (U+00B7) as the separator.

**THIS IS THE PART MOST LIKELY TO EXCEED "CALLER WORK", AND #715 SAYS IT IS CALLER WORK ONLY.**
That claim rests on the data being present and the seam being open, both true. But **there is no
display formatter for `CombinedOdds` anywhere in `src/`** — I grepped and found none. The type
carries `favorite`, `spread`, `homeSpread`, `awaySpread`, `total`, prices and provenance; the
mockup shows one rendering of three of those fields. Somebody has to write that function and decide
the cases the mockup does not show.

---

## STOP — read receipt before writing any code

Answer these from the files. Several are written so the answer can contradict me.

1. **Does `MatchupsWeekPanel` pass `broadcast` today, and what is the exact field the label would
   come from?** Name the accessor Overview uses and say whether the Matchups row has the same data
   available. If it does not, that is a finding and this slice changes shape.
2. **Enumerate the `displayPolicy` states that show broadcast**, from the component, and confirm or
   correct my claim that it includes `unavailable`. Then say whether the Matchups scoreboard can
   ever *be* `unavailable` — it constructs a `displayByState` map with an `unavailable` entry, so
   answer from whether that state is reachable here, not from the map's existence.
3. **`statusLabel="SCH"` is hardcoded at this call site.** Is that correct for every state this row
   can render, or is it a fourth defect nobody filed? Answer from the component's use of
   `statusLabel`. **If it is a defect, report it — do not fix it in this slice.**
4. **How many tags can the selector actually supply here?** Give the number and the function that
   bounds it, not "two". Then say whether removing the `hidden` can ever produce more than that
   number on screen.
5. **What does `CombinedOdds.favorite` contain** — a team name, an id, or an abbreviation — and does
   its form match the team names rendered on the row? Say what happens when it is `null` but
   `spread` is not.
6. **Enumerate the cases the mockup does not show:** spread present with no total, total present
   with no spread, a pick'em (spread 0). For each, say what you propose to render. **If you think
   any of these needs an owner ruling rather than a default, say so — that is a legitimate answer
   and I would rather have it now than at review.**
7. **Does writing the odds formatter keep this inside "caller work"?** Count the lines and name
   where the function would live. `docs/next-tasks.md` says #715 splits out of this slice if it
   grows beyond passing `footerSlot`. **Recommend split or keep, and I will rule.**
8. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
