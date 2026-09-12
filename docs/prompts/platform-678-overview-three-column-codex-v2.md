PROMPT_ID: PLATFORM-678-OVERVIEW-THREE-COLUMN-CODEX-v2
PURPOSE: Give Overview's game lists a three-column tier at wide widths, reconstructed from clean
`main`. v1 (PR #747) is STOPPED and superseded — see below.
SCOPE: `src/components/OverviewPanel.tsx`, `src/components/CompactGameScoreboard.tsx`,
`src/lib/teamLogos.ts` if the logo slot needs an explicit value, and their suites plus one browser
test. NOT Matchups, NOT Schedule, NOT Featured's cap, NOT the six-item section caps.
CARRIES: both Item 134 rows from `docs/campaigns/item-87-INDEX.md`, verbatim:

> **15 — DISCHARGED by PLATFORM-676 / remains Item 134.** Six-item caps remain count-based and
> deliberately ragged; any tier-dependent change belongs to #678/#726.

> **23 — Item 134.** **Confirm orphan rows sit on the right**, not centred.

**Row 23 reads as a contradiction of the spec below and is not one.** Its source
(`three-column-tier.md:43`) says: *"worth confirming the gap sits on the right rather than centring
the remainder — a centred orphan breaks the column alignment the grid exists to provide."* **The gap
on the right IS items left-aligned.** Two framings of one requirement. Do not "fix" one into the
other.

---

## v1 is STOPPED. Reconstruct; do not cherry-pick.

PR [#747](https://github.com/znpruitt/cfb-app/pull/747) (`codex/678-overview-three-column`, +600/−21)
did not converge and must not merge. **Branch fresh off clean `origin/main`.** Carrying commits,
files or test scaffolding across is how a reconstruction inherits the model that failed — the point
is to rebuild from the settled specification, not to repair the attempt.

**v1 ran without a prompt**, from a queue line and a campaign document. That is the process failure
this document exists to close, and it is mine: I identified the missing prompt, said so, and
dispatched a different lane instead. The `CARRIES:` block above is what was absent.

## The settled specification — from the v1 lane's own stop report, adopted verbatim

- **≤760.01px:** one column.
- **760.01–1347.99px:** two columns.
- **≥1348px:** three columns.
- **Arithmetic:** `400 − 16 existing reservation + 32 logo slot = 416px`;
  `3 × 416 + 2 × 40 + 20 headroom = 1348px`.
- **Name 416px as a TARGET, not a minimum.** It is the width the arithmetic is built on, not a floor
  the layout enforces.
- **Preserve:** row-major flow, left-aligned remainders, Featured's four-item cap, and deliberately
  ragged count-based caps.

The breakpoint must be re-derived against the permanent **32px logo slot**. The old headroom
calculation assumed the retired colour bar, and `next-tasks.md` says so — the `+ 32 logo slot` term
above is that re-derivation, and it is the reason this number is not the one in any older document.

## Verification requirements, also from the stop report

- **Browser verification covers 760/761, 1347/1348, and the 1392px reference container.** Both sides
  of each boundary, not one.
- **CDP operations need explicit timeouts and socket-close rejection**, with cleanup enclosing the
  entire fixture/browser lifecycle. A hung CDP call must fail, not hang.
- **Use a documented required-browser script. Ordinary green tests must not conceal a skipped pixel
  gate.** A suite that passes because the browser was unavailable is the vacuous-green failure this
  repo has shipped before; the gate must be visibly required or visibly absent.
- **Keep the logo slot as an explicit validated value**, not the unsafe parsing abstraction v1 used.

## Closeout, after clean reviews

`DESIGN.md`, the campaign references and index, and the prompt registry. **Record v1 as
superseded/unimplemented** with its PR number — a stopped attempt is history, not an absence.

---

## STOP — read receipt before writing any code

1. Quote the CURRENT column behaviour with `file:line` — what breakpoints exist today on Overview's
   game lists, and where are they expressed? If there is no explicit tier, say what produces the
   present layout.
2. Re-derive `416px` from the shipped row. Where do `400`, the `16` existing reservation and the `32`
   logo slot each come from in code? **If any term does not reproduce, stop and report the number you
   get** — a breakpoint whose arithmetic does not reproduce is Item 152's defect and this item must
   not repeat it.
3. `1348px` vs Schedule's `1320px` (`presentation-decisions.md`, arithmetic that does not reproduce,
   Item 152) and Matchups' `1372px` (the mockup's `.owner-grid` container query). Three tiers, three
   numbers. Are they independent by design, and does anything in code or `DESIGN.md` assert they
   should agree?
4. What renders the six-item sections today — a grid, flex, or a list? Name the mechanism that would
   place a remainder, and confirm whether left-alignment is already what it does or has to be made to.
5. Does a browser/pixel test already exist anywhere in this repo? If so, what makes it required, and
   what happens to the suite when the browser is unavailable? If not, say so — you are adding the
   first, and the "must not conceal a skip" requirement is on you to design.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
