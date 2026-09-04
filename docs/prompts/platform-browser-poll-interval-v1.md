PROMPT_ID: PLATFORM-BROWSER-POLL-INTERVAL-v1
PURPOSE: Halve the browser live-score poll cadence from 180s to 90s. One exported constant, zero provider cost, a measured latency win. This is Item 95 **portion 1 only**.
SCOPE: `src/lib/liveScores/browserPolling.ts` (the constant and the two comments that state its value) and `src/lib/liveScores/__tests__/browserPolling.test.ts`. No change to `useLiveRefresh.ts`, no change to any cron cadence, no change to the client's cache-only boundary.

Read `AGENTS.md` first. It is canonical for scope/sizing, verification, review limits and reporting;
this prompt does not restate or override those rules. Queue context and the measurement are in
`docs/next-tasks.md` → **Item 95**, *Portion 1 — browser interval, free, no gate*.

<task>
On branch `platform/browser-poll-interval`, change `LIVE_SCORE_POLL_INTERVAL_MS`
(`src/lib/liveScores/browserPolling.ts:19`) from `3 * 60 * 1000` to `90 * 1000`.

**Why it is free.** Two unsynchronized 3-minute cycles compound today — the `*/3` cron and the
browser poll — so a tab that reads the cache just before the cron refreshes it shows a score up to
~6 minutes stale, averaging ~4.5. Halving the browser half takes worst case to ~4.5 and average to
~3.75 for **zero CFBD calls**: the client is cache-only by architecture (PLATFORM-086B2B,
PLATFORM-075) and this does not weaken that boundary.

**Two comments state the old value and must move with it.** The module JSDoc at `:7-16` says
`useLiveRefresh` "can re-evaluate it on every 3-minute tick", and the constant's own doc comment at
`:18` says "every 3 minutes while a tab is visible". A constant whose neighbouring prose contradicts
it is the defect this repo keeps finding; update both.
</task>

<completeness_contract>
All of it, or stop and report which part you could not meet:

- `LIVE_SCORE_POLL_INTERVAL_MS` is `90 * 1000`, and both comments that state a 3-minute cadence read
  90 seconds instead.
- `src/lib/liveScores/__tests__/browserPolling.test.ts:216` asserts the constant's value
  (`assert.equal(LIVE_SCORE_POLL_INTERVAL_MS, 3 * 60 * 1000)`). Update it to the new value. This is a
  contract pin, not a regression test — say so in your report rather than calling it a regression.
- The two consumers in `src/components/hooks/useLiveRefresh.ts` (`:585` throttle guard, `:615`
  interval) read the constant and need no edit. Confirm by inspection that neither hardcodes 180000
  or `3 * 60 * 1000` independently, and report what you found.
- No cron cadence changes anywhere. `*/3` in `schedulerDeliveryHealth.ts` and the QStash schedules are
  Item 95 **portion 2**, which is gated on Item 94 and explicitly NOT this task.
</completeness_contract>

<missing_context_gating>
Proceed by default. STOP and report instead of deciding on your own if any of these is true:

- A consumer hardcodes the interval rather than importing the constant. That is a second source of
  truth and changes the shape of this task.
- Any test asserts a 3-minute browser cadence indirectly — a fake timer advanced by 180000, a
  comment-driven expectation — rather than through the constant. Report it; do not silently retune a
  timing test to make it pass.
- Changing the constant makes an unrelated test fail. That would mean something depends on the
  cadence that this prompt has not accounted for.
</missing_context_gating>

<verification_loop>
Follow `AGENTS.md` → Verification. Every gate is its own shell command with its own real exit code,
reported as such — never behind a pipe, `grep`, or `tail`, and never chained with `&&` onto the
command that reports the code. Report the exact commit SHA the gates ran against and that the tree
was clean and HEAD unchanged at that moment.

Required gates:
1. `npx tsc --noEmit`
2. `npm run lint:all`
3. `npm test`

Report test DELTAS (before/after counts). The expected delta is zero — one existing assertion changes
value. Say that explicitly.

**Do not claim a latency improvement you did not measure.** The ~6→~4.5 minute figure is the item's
arithmetic over two cadences, not an observation. Cite it as the item's projection, not as a result.
</verification_loop>

<action_safety>
- Branch `platform/browser-poll-interval` off current `main`. Do not commit to `main`.
- **Do NOT push `preview`, or any other preview branch.** `AGENTS.md` → Preview branch: `preview`
  belongs to Claude alone, decided 2026-08-18 because parallel worktrees made a single force-pushed
  branch ambiguous. Push your feature branch only (`git push origin HEAD`). Your work reaches the
  owner as a branch to pull and run, not as a URL.
- If you run a dev server, **use port 3010** — both worktrees default to 3000, and killing a dev
  server can orphan the `next-server` child, which then serves stale code from that port.
- No opportunistic refactoring. `useLiveRefresh.ts` is a large hook and is out of scope even if
  something in it looks improvable.
- Do not write the `docs/prompt-registry.md` entry or flip any ledger status. Closeout happens
  pre-merge under `AGENTS.md` → Documentation closeout timing.
</action_safety>

<compact_output_contract>
Report in this order, per `AGENTS.md` → Reporting expectations for Codex tasks:

1. What changed — the constant, and the two comments.
2. The consumer inventory for `LIVE_SCORE_POLL_INTERVAL_MS`: every reader you found, and whether any
   hardcodes the value instead.
3. Whether behaviour changed, stated for: browser poll cadence (yes), provider calls (must be none),
   cron cadence (must be none), the client's cache-only boundary (must be unchanged).
4. Verification: each gate as its own line with its real exit code, the commit SHA, and the test delta.
5. Anything that contradicts this prompt's premise, stated as unresolved rather than fixed.
</compact_output_contract>
