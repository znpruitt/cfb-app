# PLATFORM-669 — Overview watchlist shared header (closeout)

Status: Implemented, reviews adjudicated and owner approved closeout/merge; pre-merge record.
Issue: [#669](https://github.com/znpruitt/cfb-app/issues/669).
PR: [#877](https://github.com/znpruitt/cfb-app/pull/877).
Prompt: [PLATFORM-669-OVERVIEW-SHARED-ROW-CODEX-v1](../prompts/platform-669-overview-shared-row-codex-v1.md).
Branch: `codex/platform-669-shared-row`.
Main was fetched and merged at `82538993` before this record was written.

## Final behavior

Watchlist reason labels and category tags render together in the shared header's `tagSlot`.
The unconditional 22px context band and its 6px margin are removed from every card; the odds-footer
reservation remains. Above phone width, only headers containing a reason label may wrap, and only
when their contents cannot fit beside each other. Pills remain pinned right on either line.
The existing shared phone exception is preserved. Overview's 1341px container tier is unchanged.

Three CSS utilities in `OverviewPanel.tsx` implement the exception; the shared scoreboard's runtime
behavior, tag selector and pill treatment are unchanged. Its data attributes now carry a definition-site
note identifying the cross-file selector contract. The accepted cost is a 20px lower team-row position
on the wrapped reason card. CSS subgrid, tracked separately in [#879](https://github.com/znpruitt/cfb-app/issues/879),
is not implemented here.

| Shared-row decision | Disposition |
| --- | --- |
| Chips inside the shared header | Applied through `tagSlot` |
| Metadata and chips share the header | Applied, with the owner-ruled demand-driven watchlist exception |
| Tags pinned right with growing metadata | Preserved inline; auto margin retains the right-pin after wrapping |
| One vocabulary and pill treatment | Already landed; retained |
| Team identity slot | Already landed as 28px logos, superseding the retired bars; retained |
| Third-column tier | Already landed; Overview's 1341px tier retained |

## Why the implementation changed

| Commit | What it established |
| --- | --- |
| `7ba43ce9` | Moved pills into the shared header and removed the unconditional band. Initial tests missed metadata truncation. |
| `7a373df0` (main ruling), `e9cafa20` (implementation) | Measurements invalidated the old phone-only justification. The owner retained `Game of the Week` and allowed only a constrained reason card to wrap in multi-column layouts. |
| `014e7a62` | Added a synthetic control that can witness removal of the reason-label gate, registered the watchlist in the required-browser command, and documented the measured outlet population. |
| `09acdb38` | Corrected the radio reachability claim, tested two-digit-day kickoff strings, and added a positive control for the actual pill-clipping observer. |
| `82538993` (main ruling) | Corrected the scope claim, retained the narrow exception, and assigned provider-drift detection to #880. No additional layout change. |

Supporting commits: `378038a1` adjudicated the receipt, `47894e29` corrected the stale test docblock,
and `46ef835c` made browser expectation types explicit. The original story of three header lines and
reproducible wrap misalignment was withdrawn: there were two bands, and the old wrapper clipped
rather than wrapped. Scheduled `Close` is guarded out; the ordinary widest slot is one reason plus
one category tag. Three pills are a labelled synthetic fixture. Kickoff formatting always produces
text, so a metadata-free watchlist fixture was not introduced.

## Measurements and their limits

Browser measurements use Chrome/macOS, production-rendered Overview fixtures, and Tailwind compiled
from the production sources. They are not a deployed-data survey. The initial card height was 161px.
A single-line card is now 133px (28px saved); a wrapped card is 153px (8px saved).
Existing grid stretch makes peer card boxes equally tall within that grid row, but their headers
remain single-line and their team rows do not move. Rows without wrapping retain the full saving.

At 809px viewport, the two-column transition shrinks cards from 760px at viewport 808 to 360.5px.
With `Game of the Week` and `Top 25 Matchup`, short metadata (`Sat, Sep 5, 7:30 PM` / `ESPN`)
needed wrapping through 902px on the measured host. Long metadata (`Sat, Sep 5 · Time TBD` /
`ACC Network`) needed wrapping throughout the multi-column tiers, whose card cap is about 420.33px.
Before remediation, that long case lost 63.4px of kickoff and 38.6px of broadcast at 809px, and
26.2/16.0px at 1389px. Both spans are whole after the reason header wraps.

The tests derive fit from actual glyph widths rather than encoding that host's clearance breakpoint.
They cover 26 viewport widths from 320 to 1920px, wrapper/child scroll overflow, subpixel text bounds,
pill clipping, right-pin, header height, team-row offset, and grid tiers. A fitting reason-only
control stays inline. No-reason cards stay single-line above the pre-existing 640px phone boundary,
including a deliberately oversized synthetic outlet that must truncate rather than gain permission
to wrap.

### Radio residual — owner ruled, #880 remains open

The 2026-09-28 replica measurement joined `schedule-media/2026-all` to `schedule/2026-all-all`:
888 games had an FBS participant, 509 carried media, and tv-first per-game selection yielded
21 distinct labels, with maximum length 11 characters (`SEC Network` and `ACC Network`).
The store's longer non-FBS outlets were not the rendered population. Character count is not a
pixel-width guarantee; twelve `W` glyphs already exceeded the measured budget.

The radio guard is supported even though that measurement found zero radio-only games of any
classification. All six FBS games with radio rows also carried a higher-priority outlet. Calling
radio impossible was wrong and was corrected in `09acdb38`.

At viewport 809px, a no-reason card with `Wed, Sep 16 · Time TBD` and one tag has a 243.875px
metadata box. `SEC Network` takes 233.97px naturally, leaving about 9.9px; `Radio · ERADM` takes
244.33px, exceeding it by about 0.45px. Integer scroll measurements do not register overflow in
that radio fixture and no visible ellipsis was reported, but this is not positive layout headroom.

The owner explicitly declined widening the exception. The accepted residual is provider drift,
tracked in [#880](https://github.com/znpruitt/cfb-app/issues/880). No fixture detects a provider
changing a string the fixture itself hardcodes; a live detector is not delivered by this slice.
DESIGN.md's corrected scope clause in `82538993` is the authority for this decision.

## Review record

- Initial self-review and a separate Codex subagent pass on `7ba43ce9` found no defects. The browser
  fixture checked pills but did not measure metadata; this was a false green.
- Formal `/code-review` at high effort on `7ba43ce9` found metadata truncation (HIGH), the missing
  overflow probe (MEDIUM), and a stale docblock (LOW). Formal Codex review against `378038a1` was
  clean but explicitly did not run browser layout tests. The docblock was fixed at `47894e29`;
  layout and overflow assertions waited for the owner ruling, then landed in the remediation.
- The `46ef835c` review produced six findings. `014e7a62` added the gate's synthetic boundary,
  completed the required-browser script, added geometric tolerance and definition-site notes.
  The measured longer-outlet scenario was not present in the dated rendered population; the
  disrupted-route LOW remained as rated and documented-unreachable. This remediation preceded
  Codex's report: the owner accepted that path, but it did not satisfy the original pair-before-edit
  sequence. The record does not retroactively claim otherwise.
- Both reviewers then targeted `014e7a62`, with Codex's branch scope using verified merge-base
  `7a373df0` (5 files, 688 insertions, 45 deletions). Codex was clean, ran OverviewPanel tests, and
  explicitly did not run browser tests. Claude ran the four gates with real Chrome and a production
  build; all three arbitrary-variant rules were found in the generated CSS. Its three findings
  produced the radio-bound correction, stale-comment fix, and clipping-observer control at
  `09acdb38`. These were tests/comments only. Codex's clean verdict is not browser verification.
- Both findings sets are dispositioned. The owner ruled the remaining radio question in `82538993`
  and explicitly authorized closeout and merge without another layout change. No independent review
  of `09acdb38` is claimed.

## Proof and verification

The original band/placement, footer, pill-treatment, grid-tier and unchanged-section controls remain
in the branch. Later controls address the mechanisms earlier green runs missed:

| Mutation | Named observation that failed |
| --- | --- |
| Disable reason-header wrapping | Kickoff `has no scroll overflow` at 809px |
| Remove wrapped-slot auto margin | `last pill pins to the header right edge` |
| Force a fitting reason header onto two lines | `only a constrained reason header or the existing phone rule adds a line` |
| Strip the `:has()` gate | Synthetic tags-only header: `a tags-only header stays on one line above phone width`, 36 versus 16 |
| Force the shared clipping observer to return zero | `the observer detects clipping when the header cannot hold the pills (after=[0,0])`; the other four browser tests still passed |

Reported gates on `09acdb38`: TypeScript, full lint, full tests (5,607 passed), and required-browser
checks (31 passed, zero skipped), each exit 0. The watchlist file is now explicitly included in
`test:browser:required`. The earlier production-build observation belongs to `014e7a62`.
Final closeout-commit gate results and exact SHA are recorded on PR #877; no result is silently
carried across a changed commit.

Preview was not advanced for the later test/comment-only commits and is not evidence for the final
layout. No production promotion is claimed. Only #669 is closed by this PR: #673's reason-inclusive
cap is not implemented; #718's overflow question now concerns the shared header rather than the
removed band. Their dispositions remain with planning. Overview's tier reassessment remains #873.
