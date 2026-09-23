# PLATFORM-797 — compact header wrap

The compact header now uses two full-width lines below `sm` whenever a tag slot exists, across
scheduled, live, awaiting, unavailable and final states. The second line keeps the existing
`justify-end`, so tags align consistently on the right. At and above 640px the single-line contract
remains. The fourth scheduled condition, choosing record versus score anchors, is unchanged.

## Why all three conditions changed

The read receipt refuted the original prompt: widening the header condition alone DOES remove the
measured clipping. Its `flex-auto` metadata grows after the tag wraps away. But the second line keeps
an intrinsic-width tag slot at the left edge. Applying the child width classes in every state matches
the existing scheduled layout. The reason is cross-state alignment consistency, not necessity to
create a split. The accepted correction is in
[the amended kickoff](../prompts/platform-797-header-wrap-codex-v1.md).

`unavailable` is included because DESIGN.md's exemption follows layout, not status. No unavailable
broadcast defect is claimed: Matchups suppresses that broadcast. No tag selector, panel production
code, metadata order, or broadcast policy changes.

## Measurement population and result

Controlled reachable fixtures, not observed production games. Chrome 153 on macOS, production CSS
and system UI font, the actual Schedule panel and tag selector, non-neutral games, 16px shell gutters
and 10px block padding. Both rows have ESPN2 and the selector-produced Upset watch + Top 25 Matchup;
live carries Q4 12:34 and awaiting has no clock. The observer measures the text Range against the
broadcast's own `truncate` box and every clipping ancestor.

Before measurements were taken at `26c0e1e4`; `62d20b89` changed only docs. After measurements use
`CompactGameScoreboard.browser.test.tsx`, added to `npm run test:browser:required`.

| Viewport | Live overflow before → after | Awaiting overflow before → after |
| --- | --- | --- |
| 360px | 26.563 → 0px | 64.969 → 0px |
| 375px | 20.313 → 0px | 49.969 → 0px |
| 390px | 14.063 → 0px | 34.969 → 0px |
| 414px | 4.063 → 0px | 10.969 → 0px |
| 430px | 0 → 0px | 0 → 0px |

At 390px the header is 338px wide. Header-only wrapping leaves the tag slot at 203.75px; the completed
change gives both lines all 338px and right-aligns the tags. The per-state phone tests cover
360/375/390/414/430/639px. The desktop test covers 640/820/1280px and measures neighbouring fixture
cards at the latter two widths.

There is no content-width threshold. The receipt's 203.75px league-tag pair and 288.438px CFP
Championship + both Overview highlights are examples, not caps; the conference badge interpolates an
uncapped string. This change does not promise that arbitrary tag or broadcast text fits, and #795
remains separate. Desktop constrained content can still clip under the unchanged single-line rule.

## Tests and mutation evidence

Nine new browser tests: five state-specific geometry tests, one desktop test, two Schedule broadcast
tests and one tag-visibility/metadata-order test. Existing JSDOM coverage retains untagged behavior.
The phone `unavailable` fixture deliberately has no broadcast.

Every mutation below was temporary, restored, and returned exit 1 through the browser test runner.
The named assertion, not a class-presence proxy, was inspected in each failure.

| Mutation | Named assertion that failed |
| --- | --- |
| Restore original component | Each non-scheduled state's `metadata takes a full line`; both Schedule `broadcast text fits every clipping boundary` assertions |
| Widen header condition alone | Each non-scheduled state's `tag slot takes a full line`; both broadcast tests stayed green |
| Remove `max-sm:` scoping | `scheduled at 640px: metadata and tags share one line` |
| Replace `justify-end` with `justify-start` | Each state's `tags align to the right edge` |
| Hide tag slot on phones | `scheduled: every supplied tag remains visible` |
| Cap broadcast span at 1px | Both Schedule `broadcast text fits every clipping boundary` assertions |
| Move neutral-site metadata before broadcast | `scheduled: metadata order is preserved` |

## Review and remediation

Both independent reviews targeted `2f5c78c4`: Codex and the local `/code-review` plugin. Both found only
the stale Schedule tests forbidding the newly approved wrap. The full suite independently failed
those same two tests (5579 passed, 2 failed, zero skipped); this was a change-attributable failure,
not an accepted baseline.

One remediation, `0b7318cb`, changes only `GameWeekPanel.test.tsx`: the live and non-scheduled
expectations now admit phone wrapping, retaining scheduled-positive and untagged-negative coverage.
Restoring the original component made both updated tests fail: `a tagged live Schedule row shares
the phone-width wrap exception` and `tagged live rows permit wrapping at phone width`.

Both confirming reviews found no remaining issues at exact commit
`0b7318cbc475464d599a003a9466cf32bdbf71e2`. No second remediation was taken.

At that clean, unchanged commit: `npm test` exited 0 (5581 passed, zero failed/skipped),
`npm run test:browser:required` exited 0 (16 passed, zero failed/skipped), `npx tsc --noEmit`
exited 0, and pre-push `npm run lint:all` exited 0. The final docs-only commit receives its own gate
run, recorded on [PR #864](https://github.com/znpruitt/cfb-app/pull/864), rather than inheriting these
results.

Implementation is reviewed and awaiting merge. Every commit is pushed to the feature branch and
`preview` under the owner's slice-scoped grant. Preview succeeded at `0b7318cb`; a docs-only push
may skip a new deployment. No merge or production promotion is claimed.
