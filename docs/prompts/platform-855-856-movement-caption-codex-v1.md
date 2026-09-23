# PLATFORM-855/856 — the movement caption is a label, and the arrow joins the delta palette

```text
PROMPT_ID: PLATFORM-855-856-MOVEMENT-CAPTION-CODEX-v1
PURPOSE: Overview's condensed-standings movement caption restates the last week column header
         (`Movement · through W3`), which by construction it can never contradict, and the inline
         rank arrow paints the same movement value in a different palette from the delta cells
         beside it. Make the caption a constant label and the arrow use the cells' palette.
SCOPE:   src/components/OverviewPanel.tsx — the caption at `:686-690` and the inline rank arrow at
         `:723-748` — plus src/components/__tests__/OverviewLiveRecords.test.tsx. DO NOT touch the
         delta cells (`:788-804`), `deltaTextColor` (`:186-190`), `deltaLabel` (`:192-196`), the
         Standings page, any selector, or DESIGN.md (planning owns it; both rules are already
         written).
CARRIES: NONE from the Item 87 campaign index, having checked — this is an Overview section's own
         caption and colour, not scoreboard row anatomy.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - When your change kills a test, separate its INTENT from its MECHANISM and preserve the
           intent. This slice kills one assertion by design — see acceptance 4.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
```

---

## Two issues, one file, one review

[#855](https://github.com/znpruitt/cfb-app/issues/855) and
[#856](https://github.com/znpruitt/cfb-app/issues/856) are both #827 residue, both in
`OverviewPanel.tsx`, and their edits sit fifty lines apart. They are one slice because the UI lane is
serial with itself and two slices in one component file cost two reviews of the same diff.

**Both are fully ruled. Nothing here is a design question.**

---

## Part 1 — the caption (#855)

### What renders today

`src/components/OverviewPanel.tsx:686-690`:

```tsx
<p className="mb-1 px-2 text-xs text-gray-500 dark:text-zinc-400">
  {latestWeek == null
    ? 'Movement · awaiting first resolved week'
    : `Movement · through ${labelFn(latestWeek)}`}
</p>
```

### Why `· through W3` carries nothing

**The caption's week and the last column header are the same value, by construction.** Both come from
`positionDeltaData` through the same label function:

- `:1885-1886` — `deltaWeeks={positionDeltaData?.weeks}` and `deltasByOwner={positionDeltaData?.byOwner}`
- `:678` — `latestWeek = deltaWeeks?.at(-1)`
- `:699-706` — the header row renders `labelFn(w)` for every `w` in `deltaWeeks`

And `positionDeltaData` (`:1810-1825`) is `null` or carries a non-empty `weeks`: `:1811` returns
`null` when history is absent, `:1817` returns `null` when `weeks.length === 0`, and `byOwner` is
built unconditionally at `:1818-1824`. **So `hasDeltaCols` (`:676`) and `latestWeek != null` (`:678`)
are equivalent at the only call site** — there is no reachable render where the caption names a week
the headers do not.

The per-row arrow already states the boundary, and states it better: its accessible name (`:744`)
names **both** ends (`from W2 to W3`) where the caption named one.

### The ruling

**Owner, 2026-09-22 — the caption is the constant string `Movement`, in every state.** The
`latestWeek == null` branch goes with it, retiring `Movement · awaiting first resolved week`. In the
owner's words: *"Movement describes what the tile is — it shows movement week to week even if it
doesn't have the latest info yet."*

So the whole caption becomes:

```tsx
<p className="mb-1 px-2 text-xs text-gray-500 dark:text-zinc-400">Movement</p>
```

**Written into `DESIGN.md`** under *Overview standings row hierarchy*, as two bullets: the
column-group-label rule, and the unconditional rule. `DESIGN.md` is canonical and planning owns it —
read it, do not edit it.

**The general rule it states, because it will come up again:** a column-group label says what the
values MEAN; it does not restate what the headers already show. `Movement` earns its place because
three 1.75rem numeric columns headed `W1 W2 W3` do not say the values are rank deltas rather than
wins or points.

### `latestWeek` and `previousWeek` both stay

They feed the arrow (`:726`, `:744`). Only the caption's use of `latestWeek` goes. Removing either
binding breaks the arrow, and the existing accessible-name tests at
`OverviewLiveRecords.test.tsx:190-202` must pass **unchanged** — that is how you know you cut the
right thing.

---

## Part 2 — the arrow palette (#856)

### The divergence

Two elements render the same owner-keyed latest-resolved delta in different colours:

| element | citation | classes |
| --- | --- | --- |
| delta cells | `:794` → `deltaTextColor` (`:186-190`) | `text-emerald-600 dark:text-emerald-400` / `text-red-500 dark:text-red-400` |
| inline rank arrow | `:738-741` | `text-emerald-700 dark:text-emerald-300` / `text-amber-700 dark:text-amber-300` |

**`DESIGN.md:101` settles which is right:** the right-edge anchor rule specifies *"a colored numeric
value (delta in green/red, score, count in amber)"*. **Green/red is the delta palette; amber is for
counts.** The cells comply. The arrow does not — it differs in hue on the down case and in shade on
both.

### The fix

The arrow consumes `deltaTextColor(delta)` rather than its own literal pair, so one function owns the
movement palette.

### The dark variant is the only one that renders — check this before reasoning about colour

`src/app/globals.css:41` redefines the variant as `@custom-variant dark (&)`, so **`dark:` matches
unconditionally** and those classes always win. The non-`dark:` classes in both tables above are
inert. What actually changes on screen:

- up: `emerald-300` → `emerald-400`
- down: `amber-300` → `red-400`

State this in your report as the visible effect. Do not describe a light-mode difference; there is no
light mode (`DESIGN.md:829` — *"the whole app is dark-only"*).

---

## Acceptance

1. **The caption element's text is exactly `Movement`** — asserted as an equality on that element's
   `textContent`, not an `includes` on the document. An `includes('Movement')` assertion passes
   against today's code and proves nothing. Your test must fail before the change.
2. **The caption is state-independent**: the same exact text with zero resolved weeks, one resolved
   week, and two or more. Note while writing the fixture that **one resolved week still renders a
   `W1` column** (`hasDeltaCols` is true when `weeks.length === 1`) and only the arrow is absent.
3. **The arrow and the latest delta cell resolve to the same colour class for the same owner and the
   same delta**, proven by reading both elements in one render rather than by two assertions of
   literals. A test that hardcodes `emerald-400` in two places passes if both are wrong together.
4. **`OverviewLiveRecords.test.tsx:204-229` keeps its INTENT and loses only one MECHANISM.** That test
   (*"827: zero or one resolved snapshot shows the boundary but no arrow"*) carries **four** separate
   claims, and only the first is affected:

   | lines | claim | after this slice |
   | --- | --- | --- |
   | `:208-213` | the caption is truthful for sparse history | **cannot fail any more** — both branches become one string |
   | `:214-217` | two resolved snapshots are required for arrows | survives unchanged |
   | `:218-222` | history absence never erases live records | survives unchanged |
   | `:224-228` | null history preserves row population | survives unchanged |

   **The last three are #827's store-failure guarantees. Do not rewrite them while you are in the
   test.** Replacing the whole test is how they get lost.

   For the caption claim, `includes('Movement')` would leave a vacuous assertion in the suite. Assert
   something that can still fail: that no week label appears in the caption element in any of those
   states. The test's NAME also stops being accurate — it no longer "shows the boundary" — so rename
   it to what it now proves.
5. **The arrow's accessible name is untouched** — `OverviewLiveRecords.test.tsx:190-202` passes with no
   edit. #856 is a palette change only; the resolved-week description the owner approved on #827 stays
   exactly as it is.
6. **Nothing outside the two edits changes.** `deltaTextColor`, `deltaLabel`, the delta cells, the
   column headers and every selector are untouched, each pinned. **`StandingsPanel.tsx:120`
   (`deriveMovementPresentation`) has its own movement presentation and is OUT OF SCOPE** — the
   Overview/Standings divergence is [#851](https://github.com/znpruitt/cfb-app/issues/851) and needs
   an owner ruling before any code.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 3 is the likely false green.** If you assert the literal `emerald-400` on both elements,
the test passes when both are wrong and fails only when they diverge in that one direction. Read the
class off both elements in the same render and compare them to each other.

**Acceptance 1 is the second.** `textContent.includes('Movement')` is true today. Equality on the
caption element is what discriminates, and you should show it red against current code before the fix.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

Answer from the FILES, not from this prompt. Enumerate rather than counting — do not report "N
consumers", list them.

1. **Every reader of `latestWeek` and `previousWeek`.** For each, say whether this slice removes it or
   preserves it, and what breaks if you remove the binding instead of just the caption's use.
2. **Every test, snapshot or fixture anywhere in the repo that asserts either caption string.** This
   prompt names one file; say whether that is the whole set.
3. **`deltaTextColor` returns a GREY for `delta == null || delta === 0` (`:187`).** Is that branch
   reachable from the arrow? Cite the guard that decides it, and say what the arrow would look like if
   the guard were ever relaxed.
4. **The arrow is `text-xs font-semibold` (`:738`) and the cells are `text-[11px] font-medium`
   (`:794`).** After the change they share a colour at different sizes and weights. Does
   `red-400` at the arrow's size clear the contrast floor this repo uses? [#711](https://github.com/znpruitt/cfb-app/issues/711)
   is open about small type failing it — say whether this change is inside that issue's population or
   outside it, with the measurement.
5. **Does any other element on Overview render movement in a third palette?** The arrow and the cells
   are the known pair; check the rest of the file before aligning two.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
