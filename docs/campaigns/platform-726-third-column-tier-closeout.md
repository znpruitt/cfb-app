# PLATFORM-726 — third-column tier measurements

Status: Implementation and review complete; pre-merge closeout
Branch: `codex/platform-726-third-column-tier`
PR: [#874](https://github.com/znpruitt/cfb-app/pull/874)
Implementation: `00ec4e99`; first remediation: `0ce3f88d`; approved proof-only second round: `68312b5a` (2026-09-25)

## Decision and derivation

Each surface gains a third column without making its cards narrower than at its first whole-pixel
two-column container width. Content fit is a separate measured constraint; neither the longest full
name among abbreviatable teams nor the historical 219px viewport fixture floor chooses the tier.

| Surface | First two-column sample | Measured track | Gap | Third-column container |
| --- | --- | --- | --- | --- |
| Schedule | 761px | 360.5px | 40px | `ceil(3 × 360.5 + 2 × 40) = 1162px` |
| Matchups | 976px | 483px | 10px | `3 × 483 + 2 × 10 = 1469px` |

Schedule preserves its `<760.01px` one-column rule. Matchups converts from viewport `lg:` to a 976px
container threshold: the unchanged app shell measures 975px at a 1023px viewport and 976px at 1024px.
That viewport equivalence is measured at a 16px browser default with zero scrollbar gutter.
The proof fixture explicitly sets `html { font-size: 16px; scrollbar-width: none; }`; the boundary
test asserts the computed root size, scrollbar policy, `innerWidth - documentElement.clientWidth = 0`,
and the legacy `64rem` query on each side of 1024px. It logs the computed team font and browser UA.
This reproduces overlay-scrollbar geometry even on a host that normally uses classic scrollbars. Classic
scrollbars and changed browser-default fonts alter it: the approved fixed **976px container** target
is retained, not a claim of universal equivalence to the old 64rem viewport query.

The new three-column rows measure 340.65625px and 439px respectively. The population sweep reads
`getBoundingClientRect().width` for EVERY actual row, not the assigned wrapper width: all 238 Schedule
rows measure 340.65625px and all 237 Matchups rows measure 439px (tolerance 0.02px for layout rounding). Schedule's total card-to-row
inset is 20px. Matchups' is **44px**, including the 34px owner-card border/padding **and** 10px from its
inner game-list styling; the receipt measured only the outer wrapper.

Overview and its other column rules are untouched. Its fit derivation is a separate question in
[#873](https://github.com/znpruitt/cfb-app/issues/873), as ruled by the owner.

## Population, including the no-abbreviation exclusion

Measured 2026-09-24 from the cache-only production `GET /api/schedule?year=2026`, normalized with
`buildScheduleFromApi`, the canonical team catalog, and an empty alias map. The raw response SHA-256
was `4428585774087973219135b171813bd1e660aaeaeed08c3bb2ab6339c1d6750c`.

The dated API snapshot contains only `seasonType: regular`: **3,679 games / 716 distinct names**.
This is a current regular-season measurement, not a census of future postseason placeholders. That is not the population passed to either
panel: the existing regular-season eligibility and tracked-game gates require an FBS participant.
Normalization yields **888 games / 238 names**. All **50** raw names without an abbreviation fall
out there. Westgate Christian University's three raw opponents are Missouri S&T, Centenary (LA), and
McMurry, classified II/III; none of those pairings can reach these grids. Apprentice School also falls
out. This is the stated exclusion permitted by the adjudicated kickoff, not a new eligibility rule.

The 716 API names were enumerated before excluding 478 absent from the normalized panels.
The **47 absent artifact entries**, all excluded by that same existing eligibility path, are:

`Andrew`, `Arkansas Baptist`, `BLUEFIELD`, `Bethel University Tennessee`, `Central Methodist`, `Cetys University`, `Dakota State University`, `Eastern Oregon`, `Elgin`, `Florida Memorial University`, `Georgetown College Kentucky`, `Keiser (Fl)`, `Kentucky Christian`, `Lackawanna`, `Langston`, `Lawrence Tech`, `Lewis-Clark Valley College`, `Louisiana Christian`, `Madonna`, `Marian (IN)`, `Mayville State`, `Monroe`, `Mount Mercy`, `Nelson (TX)`, `New England College`, `Northwestern (IA)`, `Oklahoma Panhandle`, `Phoenix`, `Point University`, `Reinhardt`, `Roanoke College`, `Rocky Mountain`, `Saint Xavier`, `Simpson (CA)`, `Southern Oregon`, `St. Francis (IL)`, `Texas Wesleyan`, `Thomas`, `UFTL`, `University of Rio Grande`, `Valley City State`, `Virginia Lynchburg`, `Warner`, `Wayland Baptist`, `Webber International`, `Westgate Christian University`, `William Woods`.

The **three explicit nulls**, also excluded, are `Chicago State`, `Ohio Dominican`, `Schreiner`.

Both stored 2026 owner CSVs were read through `DATABASE_URL_RO`. The shared `deriveOwnerWeekSlates`
selector, excluding hidden NoClaim owner cards, yields 771 games for one roster and 884 for the other;
the union covers **887 games** and reaches **237 participant names**, including **undrafted opponents**. North Carolina A&T is
the one normalized Schedule name not reached by those owner slates. Tests commit the enumerated
snapshot in `fixtures/thirdColumnPopulation.ts`; no database connection or production CSV is used by
the test runner. The snapshot metadata now records the 887-game union rather than the larger individual-roster count.

The hydrated browser population sweep uses each name and classification, rank #25 and the full owner
`Shambaugh` on owned rows, a winning score of 100, and record 12–0 on Matchups only. These are bounded
final-state stress rows, not a claim about arbitrary future owners, records, or system fonts. In Chrome
153 on macOS using the production system font stack (team text 14px/600), Washington/WASH governs both:
**217.609375px Schedule**, **263.890625px Matchups**, well inside the tier's row budgets. The shared fallback measures full names against their own available box and retains its
never-wider exception when an abbreviation is wider than the full name. No short fixed
abbreviation length is assumed.

The browser panel fixture additionally pairs the 29-character **Westgate Christian University** with
an FBS opponent, so the actual missing-abbreviation path is exercised even though its current pairings
are ineligible. At both new tiers its full name fits one line. The existing Schedule browser
suite continues to prove wrapping, intact full text, and the fixed score anchor at narrow widths.
The new eligibility test has a positive FBS-opponent control: it excludes the current pairing, not the
absence of an abbreviation itself.

## Verification and mutations

At clean `68312b5a`, the proof review target, each command ran separately and exited 0:

- `npm run lint:all`
- `npx tsc --noEmit`
- `npm test`: 5,597 passed, zero failed/skipped
- `npm run test:browser:required`: 26 passed, zero failed/skipped

**Delta from base: eight top-level tests plus two population subtests added (10 counted cases); no existing tests removed or weakened.** `ThirdColumnTier.browser.test.tsx` adds two
boundary sweeps, two independently measured track/gap/inset derivations, the Matchups coordinate
conversion, Schedule and Matchups population subtests sharing one browser, explicit poisoned-observer controls,
and the eligibility/no-abbreviation control. The required browser command now includes this file. Population widths come from the rendered
third-tier grids, and the browser additionally verifies real abbreviation rendering at 230px
(Schedule, 109 rows abbreviated) and 280px (Matchups, 101 rows abbreviated).

Each mutation was isolated and restored before the next. All exited 1 at the named assertions:

| Mutation | Assertion that failed |
| --- | --- |
| Restore Schedule's actual `d425bba5` source | `schedule columns at 1162px` |
| Restore Matchups' actual `d425bba5` source | `matchups columns at 1469px`; also `Matchups constrained container overrides a wide viewport` |
| Schedule old threshold → 762px | `schedule columns at 761px` |
| Matchups old threshold → 977px | `matchups columns at 976px`; also the 1024px viewport assertion |
| Schedule gap-x-10 → gap-x-12 | `schedule breakpoint equals the measured three-track requirement` |
| Matchups gap-2.5 → gap-3 | `matchups breakpoint equals the measured three-track requirement` |
| Schedule block padding → px-3 | `schedule measured card inset` |
| Matchups desktop padding → sm:p-5 | `matchups measured card inset` |
| Population owner repeated twenty times | Both `schedule fallback, record, full owner and score fit` and `matchups fallback, record, full owner and score fit` |

An initial pre-fix Matchups probe failed at a new marker rather than a behavioral assertion. It was
corrected before commit to locate the grid through existing owner-card markup, then re-run against
the actual pre-fix source. The reported mutation evidence above is from that corrected run.

Agent-browser visual checks at 1517px and 390px viewports showed both three-column desktop surfaces
and the preserved one-column phone layout, with zero browser errors. The fixture renders the actual
panels with CSS sourced from the listed component files; logos are stubbed with their reserved slots intact.
The source list omits `gameUi.ts`, so these visual checks establish grid/row geometry, not complete
production header/tag styling. That styling limitation does not affect the measured row widths. The preview ref was
claimed with the first implementation commit, `00ec4e99`, and its Vercel build succeeded. The deployed
URL redirects this unauthenticated browser to Vercel login; no deployed league-flow verification is
claimed.

The first remediation added three differential proofs, each isolated and restored. Unlike the
initial checks, these compare the original commit's observer with the new observer under the SAME
mutation:

| Mutation | Remediated assertion | Original `00ec4e99` tests |
| --- | --- | --- |
| Visible team span constrained to 1px | Both surfaces' `untruncated names` and visible-population assertions fail | Green |
| Unowned record suffix constrained to 1px | `matchups visible name, full owner, record and score fit at 439px` fails | Green |
| Actual CFBScheduleApp shell changed to sm:p-8 | `Matchups container at 1023px viewport` fails | Green |

## Independent review and authorized second round

The owner authorized exactly one initial remediation, then explicitly authorized a second,
**proof-only** round under AGENTS.md step 6 on 2026-09-25. No third round is authorized. Production
layout remains byte-for-byte unchanged from `0ce3f88d`. Binding stop rule: a measurement contradicting
a shipped breakpoint stops the lane; it cannot be resolved by changing layout in this round.
No unmutated measurement contradicted either shipped tier.

Codex's initial review and first confirming review were clean. Its independent Chrome launches were
sandbox-blocked; the implementation session ran the required browser gate successfully. The first
`/code-review` accepted the layout arithmetic but identified proof defects. First remediation fixed
hidden-name measurement, record clipping, static row budgets, the missing Matchups no-fallback check,
copied shell classes, repeated sweeps and comment placement. The first confirming `/code-review`
identified the two remaining proof gaps authorized for round 2: population widths were echoed rather
than observed, and the boundary conditions were assumed. Both are now directly observed/asserted.

Round-2 mutation evidence (each isolated and restored):

| Mutation | New named assertion | Previous `0ce3f88d` proof |
| --- | --- | --- |
| Add 1px padding on each population wrapper side | Both surfaces' `every rendered population row matches its assigned budget` (338.65625/437px observed) | Green under the same mutation |
| Fixture root font 16px → 20px | `boundary measurement uses a 16px root font` | Not a differential claim |
| Fixture scrollbar policy none → auto, stable gutter | `boundary measurement disables scrollbar gutters on every host` | Not a differential claim |

An initial 8px padding mutation also failed the old narrow content-fit assertion, so it was rejected
as a differential proof; the 1px mutation above is the discriminating evidence. On this macOS host,
changing scrollbar policy alone still reserves zero width; that mutation therefore proves the
explicit policy guard, not a simulated classic-scrollbar measurement.

Other first-confirmation findings were adjudicated rather than patched opportunistically:

- The visible-glyph observer proves untruncated displayed text, not every #832 variant-selection
  rule. The proposed always-full mutation is caught by the explicit narrow-control abbreviation
  assertion; shared fallback rules also have their own required browser suite. No universal
  one-line claim is made for every name at every width. Westgate's tier one-line claim is pinned.
- Font fit is bounded to the reported host/system stack and stress rows. It is not a universal
  owner/font guarantee. In that host, measured headroom is 123.046875px Schedule and 175.109375px
  Matchups. The geometric invariant also proves new rows are no narrower than the old two-column
  entry rows. Broader cross-platform font sampling is a follow-up, not a layout change here.
- The shared ancestor-clipping observer is poisoned through the record suffix; the separate name
  control poisons its own box. An additional name-specific ancestor poison is optional proof
  coverage, not evidence of a production defect.
- Explicit `grid-cols-1` uses a zero-minimum track whereas the old implicit track was `auto`.
  At very narrow widths or unbounded owner labels, intrinsic overflow can differ. The approved
  conversion and measured existing threshold behavior are retained; no universal min-content
  equivalence is claimed. Broader extreme-width overflow behavior is a follow-up.
- The population's missing-abbreviation pre-assert runs before browser evaluation. A null probe
  crash requires bypassing that guard; the reachable null case is explicitly tested with Westgate.
- The owner-card fallback selector deliberately supports behavioral tests against the actual
  pre-fix Matchups source, which lacks the new marker. It is not dead scaffolding. Abbreviation is
  not truncation. The redundant lexical block is cosmetic and needs no patch.
- Documentation citations are finalized after reviews, as required. DESIGN.md is expressly outside
  the slice; planning owns that update. The superseded arithmetic note is retained with a link to
  this derivation.

Second-round Codex review at `68312b5a`: no actionable defects; TypeScript passed, independent Chrome launch sandbox-blocked. Second-round `/code-review` reviewed the SAME `68312b5a` and returned eight findings. It agreed
that the shipped breakpoint arithmetic is consistent. Findings were evaluated against their actual
reachability and the bounded claims, rather than treating the absence of a literal clean verdict
as a reason for a third patch round. No credible current in-scope P0/P1/P2 remains:

| Finding | Disposition and evidence |
| --- | --- |
| Population sweep is outside the parent grids | The sweep renders the real shared scoreboard for every included name and now measures each actual row. Its budget comes from a real grid row. It is expressly a bounded stress fixture, not every state/owner combination. Every current `ownerOutcomeRowClasses` branch uses the same `border-l-2 pl-2` inset (`MatchupsWeekPanel.tsx:108-119`). A proposed future loss-only padding change is additional state-specific regression coverage, retained as a follow-up, not a current mismatch. |
| Scrollbar condition is imposed | Correct and intentional: this round was authorized to establish reproducible conditions. The fixture enforces AND observes zero gutter. Production classic-scrollbar equivalence is expressly not claimed; the fixed 976px container conversion was owner-approved. The draft never claimed classic gutters cannot be simulated; its mutation reported only the actual host result. |
| 20px root changes the preservation arithmetic | The controlled root-font poison is outside the declared 16px measurement and fails the new precondition assertion. At 20px, the corresponding arithmetic is 1167/1471, and Westgate can wrap. The comments record measured tracks, not an all-font invariant. This closeout explicitly scopes BOTH track derivation and content fit to the measured font conditions; no universal preservation or one-line guarantee is claimed. The frozen pixel thresholds are retained. |
| Derivation/population sweeps inherit the browser viewport | Measured independently with the unchanged harness: Chrome 153/macOS opens at **756 × 469 CSS px**, not the review's assumed 800px. Those two sweeps explicitly size their containers inside that viewport. It is above `sm` (640px), so the current Matchups inset is the same 44px as at a full desktop viewport. The threshold sweep separately uses `container + 48px` viewports. Pinning all sweeps to explicit viewports is a portability follow-up; no current measurement discrepancy was demonstrated. |
| Future postseason placeholders are absent | Accepted documentation scope correction: the snapshot is regular-season 2026 as of 09-24. Future derived participants may be longer and wrap without truncation; they are not included in the population claim. Postseason reuses the grid. Additional placeholder sampling is a follow-up. |
| Missing `gameUi.ts` CSS source | Accepted visual-evidence limitation, recorded above. Current row geometry is unaffected; no header-height/tag-style fidelity claim remains. Complete header styling in this fixture is a follow-up. |
| No green run of frozen source | Refuted. `68312b5a-browser.log` contains the committed zero-gutter title and `scrollbarPolicy` diagnostic, and exits 0 with 26 passes. The separate full-suite log has 5,597 passes. The reviewer inspected the earlier exploratory `round2-browser.log`, not the final exact-commit gate logs. |
| Population mounted in unrelated tests | Low-priority harness performance follow-up. The required browser gate completed in approximately 21 seconds on this host, with zero failures/skips. No additional conditional mounting mechanism was added. |

All four required gates exited 0 at clean `68312b5a`; 5,597 tests and 26 required browser checks
passed with zero failures/skips. GitHub Vercel and Vercel Preview Comments checks passed. The docs-only
closeout commit receives a fresh run of all four gates; that exact SHA and results are recorded in
PR #874 before merge. The table above and the earlier adjudications retain follow-ups for planning;
this implementation lane did not file unrelated issues or perform a third remediation round.

Preview was initially claimed by `00ec4e99`; another lane overwrote it with `b0b85c10`.
The owner explicitly restored this lane's claim, and `0ce3f88d` was pushed and verified remotely.
Preview ownership ends when this slice merges. No production promotion is claimed.
