PROMPT_ID: PLATFORM-627-INSIGHTS-BYPASS-AUTHORIZATION-CLAUDE-v1
PURPOSE: `?bypassSuppression=1` on the Insights API is gated by LEAGUE ACCESS, not by administrative
authorization. On a passwordless league that includes anonymous callers, so any visitor can lift
editorial suppression and force the uncached build that produces it.
SCOPE: `src/app/api/insights/[slug]/route.ts` and its suites. `src/lib/insights/loadInsights.ts` or
`engine.ts` ONLY if the receipt shows the route cannot hold the guard alone. NOT the suppression
RULES, NOT the generator set, NOT caching (#714), NOT the `ADMIN_API_TOKEN` fallback's existence
(`AGENTS.md` invariant 5 forbids removing it here).
CARRIES: `AGENTS.md` → **Invariants**, rules 1 and 8, verbatim in the parts that bind. **Rule 1 names
the exact confusion this defect embodies; rule 8 names a trap that can make the fix a no-op.**

> **Clerk is the user-identity and app-role provider** […] This is distinct from the per-league
> **password access gate** (`src/lib/leagueAuth.ts`, keyed by `LEAGUE_AUTH_SECRET`): the league
> password only unlocks a passworded league's pages via a signed `league_auth_<slug>` cookie — it is
> **not** Clerk authentication and **not** admin authorization, and it grants no elevated role.
>
> ---
>
> The guard calls `resolvePlatformAdminDecision()` — the CLOSED shared decision in
> `src/lib/server/adminAuth.ts`, not the `isPlatformAdminSession()` boolean wrapper, which cannot
> supply the refusal reason — with NO argument, because **passing a `Request` would reach the
> `ADMIN_API_TOKEN` branch whose no-token path authorizes any caller outside production.**

Issue: [#627](https://github.com/znpruitt/cfb-app/issues/627). Audit finding **S1**, prerequisite 6
of 6 in #610. Spine position 4 — taken ahead of #20, which is blocked on owner-set timeout values.

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** Return to `claude/base`, then branch off current
`origin/main` — **verify the SHA**, do not trust one written here. `npm test` exits 0 on clean `main`
and **the known-failure set is EMPTY**.

**`CLAUDE.md`'s push-`preview` instruction is SUSPENDED for this branch.** A slice-scoped grant is in
force for the UI lane; `AGENTS.md:856` makes it conditional on **one writer to `preview`**. This slice
has no user-visible surface. Verify locally; if you think you need `preview`, stop and ask.

## The defect

`src/app/api/insights/[slug]/route.ts`:

- **`:29`** gates on `isAuthorizedForLeague(slug, req)` (`leagueAuth.ts:215`) — **league access**.
- **`:35`** `const bypassSuppression = url.searchParams.get('bypassSuppression') === '1';`
- **`:41`** passes it straight into `loadInsightsForLeague`.

**On a passwordless league `isAuthorizedForLeague` includes anonymous callers**, so the parameter is
effectively public. The code already knows: `engine.ts:110-114` says `bypassSuppression` *"is
reachable by any caller on a passwordless league, so the generator carries its own non-bypassable
copy of this check"* — and records that for one round `?bypassSuppression=1` published the withheld
membership card publicly.

**Two consequences, and the second is not in the issue title.** It lifts editorial suppression; and
`loadInsights.ts:447` takes an uncached path that *"compute[s] directly rather than maintaining a
second cache key"*, so an anonymous caller can force a full league insight build per request.

**Scope it honestly.** This exposes **withheld editorial output and extra computation**. It is **not**
a data-exfiltration path to another league's private records, the issue says so explicitly, and that
framing must survive into the closeout. Do not argue it up.

## The trap — read this before choosing a guard

`requireAdminAuth(req)` (`adminAuth.ts:198`) is the API-route helper and passing `req` is its normal
shape. **But CARRIES rule 8 says passing a `Request` reaches the `ADMIN_API_TOKEN` branch whose
no-token path authorizes any caller OUTSIDE PRODUCTION.**

**Preview is outside production.** A guard that authorizes anonymous callers wherever
`ADMIN_API_TOKEN` is unset is a fix that passes every test and protects nothing on the surface the
owner actually clicks through. **Measure this before choosing — it is receipt item 1.**

## The decision this item owns

**What does an unauthorized `?bypassSuppression=1` do?** Three shapes, and the issue does not decide:

1. **Ignore the parameter** — serve exactly the feed the caller would get without it.
2. **401** via `requireAdminAuth`.
3. **404**, matching `:29`'s existing blend-in, whose comment says unauthorized access returns the
   same shape as an unknown league *"so API callers can't distinguish passworded from missing."*

**My lean, to test rather than adopt:** (1). It adds no discriminable signal and changes nothing for
any legitimate caller. **The argument against it is real** — an admin whose session has expired gets
a normal feed and believes the bypass worked, which is a proxy that argues for itself. If you take
(1), say what makes the failure visible to an admin.

## Acceptance boundary

- `bypassSuppression` takes effect **only** for a platform admin. League access alone never lifts it.
- **The uncached build at `loadInsights.ts:447` is unreachable by an unauthorized caller** — the
  compute half must close with the disclosure half, or half the defect ships.
- **Behaviour for every caller NOT passing the parameter is byte-identical.** This is an
  authorization change, not an insights change.
- **`generators/membership.ts`'s own non-bypassable check STAYS.** Do not delete it because the route
  is now guarded — that is defence in depth, and rule 8's reasoning (route protection is never the
  authority) applies to the same shape here. If you believe it is now redundant, say so and leave it.
- No new dependency on `ADMIN_API_TOKEN` beyond what the shared helper already does.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. Report the test DELTA, measured at both ends against `main`.
- **Reproduce first.** An anonymous request to a passwordless league with `?bypassSuppression=1` must
  currently return suppressed content and must not after. A test that does not go red against `main`
  is not a regression test for this.
- **Mutation-prove the guard can SEE an unauthorized caller.** A test asserting "anonymous gets no
  bypass" passes trivially if the fixture never had bypass content to begin with — so pair it with a
  positive control proving the SAME fixture yields bypassed content for an admin.
- Cover the environment axis explicitly: the unset-`ADMIN_API_TOKEN` case from receipt item 1.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge, on the branch: a `docs/prompt-registry.md` entry and the `docs/next-tasks.md` spine row.
**The row is keyed by the issue link — new work gets no legacy item number** (recorded in the queue's
how-to-use section). Record the unauthorized-request shape as DECIDED, and whether the membership
generator's duplicate check was kept and why.

## STOP — read receipt before writing any code

1. **The trap, measured.** With `ADMIN_API_TOKEN` unset and `NODE_ENV` not production, what does
   `resolvePlatformAdminDecision(req)` return for an anonymous request? **Run it.** If it authorizes,
   say so plainly — that decides which guard this route may use, and a fix built on the wrong one is
   green and inert.
2. **Reproduce the defect.** Anonymous request, passwordless league, `?bypassSuppression=1`. Report
   what came back that would not have without the parameter. **If nothing differs, the issue is wrong
   and I need to know before you build.**
3. **Enumerate every caller of `loadInsightsForLeague` that passes `bypassSuppression: true`.** Give
   the count. Is the API route the only one, or does a page/diagnostic surface also set it? A guard on
   one entry point is not a guard on the capability.
4. **What does the admin Insights diagnostic surface use today** — this route, or a server-side call?
   If it goes through this route, the fix must not break it, and you need to say how an admin's
   request is distinguished.
5. **Cost of the uncached path**: roughly what does one bypassed build do that a cached serve does
   not? A rough magnitude is enough. It decides whether the compute half is a footnote or the larger
   half, and #714 is adjacent.
6. **Is `generators/membership.ts`'s duplicate check reachable any other way** once the route is
   guarded? Say whether anything else could lift suppression, and name it.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
