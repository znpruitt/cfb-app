PROMPT_ID: POLISH-HISTORICAL-CACHE-FORCE-AFFORDANCE-v1
PURPOSE: The two historical-cache buttons on `/admin/data/cache` are silent no-ops for any year that is already cached, which is every year they are useful for. Give an operator a way to force a re-cache without a browser console, and keep the cost/mutation disclosure truthful once they can.
SCOPE: `src/components/admin/HistoricalCachePanel.tsx`, `src/lib/admin/maintenanceActions.ts` (the two historical descriptors), and tests under the nearest `__tests__/`. No route change — `cache-historical-schedule` and `cache-historical-scores` already accept `force` and already refuse active seasons regardless of it.

**PRE-DISPATCH GATE — do not start until the owner has ruled.** This slice has a user-visible
surface, which trips the review trigger recorded in `AGENTS.md` → **Preview branch**: the decision
that Codex never pushes `preview` is "due for review if Codex takes a slice with a user-visible
surface", because a deployed URL is how the owner has caught defects that reviews did not. Until the
owner rules, the no-preview rule in `<action_safety>` stands as written.

Read `AGENTS.md` first. It is canonical for scope/sizing, verification, review limits and reporting.
Queue context is `docs/next-tasks.md` → **Item 122**; the disclosure contract is
`docs/architecture/admin-control-plane.md` → *Data Maintenance & Recovery*.

<task>
On branch `polish/historical-cache-force-affordance`, let an operator re-cache an already-cached
historical year from `/admin/data/cache`.

**The defect.** `HistoricalCachePanel.tsx:47` and `:70` both hardcode `force: false`. Both routes
treat an already-cached year as a no-provider-call short-circuit unless `force` is set. So for any
year that already has a cache — every year the panel is useful for — the button returns
`{ alreadyCached: true }`, makes no provider call, and changes nothing. The panel looks functional
while being unable to do the thing a re-cache exists for. The only way to refresh a cached season
today is a hand-written authenticated `POST` from a browser console.

**The short-circuit is correct and must stay.** It exists so a repair does not re-spend a fetch on
data already held. The defect is that the UI never offers the other half.

**Two things constrain the design, and neither is yours to invent:**

1. **The safety case is already handled at the route.** `computeProtectedActiveYears` refuses the
   app-inferred current season and any preseason/season league year, and **`force` cannot bypass it**.
   The UI does not need to re-derive that rule, warn about it, or guard it a second time. Surface the
   route's error if it fires.
2. **The disclosure is owned by `maintenanceActions.ts`**, which
   `docs/architecture/admin-control-plane.md` names as "the presentation authority for exact action
   labels, nominal costs, durable mutations, automation owners, and action classes".
   `MaintenanceActionDetails` renders it. **Today both descriptors encode the current behaviour in
   their cost string** — `historical-schedule-repair` reads "Zero when the accepted cache
   short-circuits, otherwise two schedule partitions", and `historical-scores-repair` reads "Zero when
   cached, otherwise up to two score partitions". A forced re-cache is never zero, and it overwrites a
   durable season. If the disclosure is left as-is it becomes false the moment this ships.

**The interaction is the real decision.** A re-cache overwrites a durable season, so it must read as a
deliberate action rather than a second identical button. Choose the mechanism you can justify — a
checkbox that arms the force flag, a confirm step, a separate labelled control — and state in your
report why you chose it and what you rejected. Do not add a second button that looks the same as the
first.
</task>

<completeness_contract>
All of it, or stop and report which part you could not meet:

- An operator can force a re-cache of an already-cached historical year for BOTH datasets — schedule
  and scores — from `/admin/data/cache`, with no browser console.
- The idempotent path is still reachable and still the default. A plain click on an already-cached
  year must still short-circuit; forcing must be an explicit act.
- The cost/mutation disclosure is truthful in both states. Either the descriptors' cost strings stop
  asserting "zero when cached", or the forced path carries its own descriptor. Say which you chose.
  The overwrite of a durable season must appear in `durableMutations` for the forced path.
- Every touched surface carries a test. At minimum: the panel sends `force: true` only when the
  operator armed it, sends `force: false` otherwise, and the disclosure rendered for the forced path
  states a non-zero cost.
- At least one assertion is mutation-proven: revert the arming logic so the panel always sends
  `force: false`, run the file, and report the NAME of the assertion that fails. Report the observed
  failure, not the expectation.

OUT OF SCOPE — file as follow-ups, do not build:
- Any change to `cache-historical-schedule` or `cache-historical-scores` route logic, including the
  active-season protection.
- Any other maintenance action, panel, or descriptor.
- Item 120's question of whether historical caches need refreshing at all. That closed as no-action;
  this item is about the control, not about running it.
</completeness_contract>

<missing_context_gating>
Proceed by default. STOP and report instead of deciding on your own if any of these is true:

- Making the disclosure truthful requires a new `MaintenanceActionId`. That widens the presentation
  authority's public shape, and `maintenanceActionWiring.test.tsx` pins the wiring — report the
  proposed id and what it would disclose, rather than adding it.
- `computeProtectedActiveYears` turns out NOT to be force-proof. The premise above says it is; if a
  reading of the route contradicts that, the safety story changes and this prompt is wrong.
- An existing test pins `force: false` as intended behaviour rather than incidental. That would mean
  the current state was a decision, not an oversight.
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

Report test DELTAS (before/after counts), not a raw suite total, and name the risk each new test
protects.

**Do not claim the forced path works end to end.** You cannot exercise it: the route needs a Clerk
platform-admin session or `ADMIN_API_TOKEN`, and running it would spend CFBD quota against a durable
production cache. Verify the request the panel BUILDS, and state plainly that the live path is
unexercised.
</verification_loop>

<action_safety>
- Branch `polish/historical-cache-force-affordance` off current `main`. Do not commit to `main`.
- **Do NOT push `preview`, or any other preview branch**, unless the owner has ruled otherwise on the
  pre-dispatch gate above. `AGENTS.md` → Preview branch: `preview` belongs to Claude alone. Push your
  feature branch only (`git push origin HEAD`).
- If you run a dev server, **use port 3010** — both worktrees default to 3000, and killing a dev
  server can orphan the `next-server` child, which then serves stale code from that port.
- **Never invoke either historical-cache route against production**, forced or not, at any point in
  this task. This is a UI change; exercising it spends provider quota and overwrites durable data.
- Do not write the `docs/prompt-registry.md` entry or flip any ledger status. Closeout happens
  pre-merge under `AGENTS.md` → Documentation closeout timing.
</action_safety>

<compact_output_contract>
Report in this order, per `AGENTS.md` → Reporting expectations for Codex tasks:

1. What changed — behavior first: what an operator can now do that they could not.
2. The interaction you chose, why, and what you rejected. This is the part the owner will judge.
3. What you did to the disclosure, and why it is truthful in both the default and forced states.
4. Whether behavior changed, stated separately for: the default click path (must be unchanged), the
   forced path, the routes (must be none), and any other maintenance action (must be none).
5. Verification: each gate as its own line with its real exit code, the commit SHA, test deltas, and
   the named mutation failure. State explicitly that the live forced path is unexercised and why.
6. Risks and follow-ups you declined to fold in.
</compact_output_contract>
