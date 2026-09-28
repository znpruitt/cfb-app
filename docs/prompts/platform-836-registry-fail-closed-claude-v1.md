# PLATFORM-836 — a malformed league registry reads as empty, and one path WRITES OVER IT

```text
PROMPT_ID: PLATFORM-836-REGISTRY-FAIL-CLOSED-CLAUDE-v1
PURPOSE: A malformed registry is flattened to `[]` in TWO places, so league creation's duplicate-slug
         check passes vacuously and a new league adopts the previous occupant's stored data. Worse,
         the mutation path then WRITES over the corrupt value — turning a recoverable corruption
         into an unrecoverable registry that looks healthy. Fail closed in both.
SCOPE:   src/lib/leagueRegistry.ts — `mutateRegistry` (`:88-98`) and the callers that write through
         it — and src/app/api/admin/leagues/route.ts (`:67-70`), plus their tests. DO NOT change
         `readLeagueRegistry`, the lifecycle guards, the advisory-lock behaviour, or any other
         registry consumer's contract.
CARRIES: NONE from the Item 87 campaign index, having checked — this is registry read/write
         integrity, not a presentation surface.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - A removed or changed guard keeps its reason: the existing behaviour is wrong about HOW
           and right about WHAT MUST NOT HAPPEN — 69 modules depend on `getLeagues()` returning an
           array, and that is why the collapse was left in place. Do not break them to fix this.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
```

---

## The file contains both the guard and its violation, twenty lines apart

`readLeagueRegistry` (`:56-62`) exists precisely to keep `missing` and `malformed` apart, and its
docblock says why in terms this slice should quote back:

> Classifying it `missing` would let a caller proceed as though the registry were empty, **which is
> the collapse this reader exists to prevent.**

**`mutateRegistry` (`:92-93`) performs exactly that collapse**, inside the same file:

```ts
const record = await txn.read<League[]>();
const leagues = Array.isArray(record?.value) ? record.value : [];
```

And `getLeagues()` (`:70-73`) performs it again for readers. **That second one is deliberate and
documented** — 69 modules depend on the array shape — which is why this slice fixes the CALLERS that
need the distinction rather than changing `getLeagues()`.

## Two fail-opens, and the issue names only the first

**1. The duplicate check.** `src/app/api/admin/leagues/route.ts:67-70` calls `getLeagues()`, so a
malformed registry yields `[]` and `existing.some(...)` is vacuously false. The consequence is already
written in the comment immediately below it (`PLATFORM-086F2I`): rosters, drafts, archives and
suppression records all survive under a slug after a league is deleted, so **a new league taking that
slug adopts them — "showing one set of people's names to a commissioner with no relationship to
them."**

**2. THE ONE THE ISSUE DOES NOT MENTION, and it is worse.** `addLeague` (`:100-108`) runs through
`mutateRegistry`, which has its own collapse. So under a malformed registry:

- the in-transaction duplicate check `leagues.some(...)` **also** passes vacuously — a second
  fail-open the route-level fix does not reach;
- `const updated = [...leagues, league]` evaluates to `[league]`;
- and `txn.write(updated)` **overwrites the malformed value.**

**That converts a recoverable corruption into an unrecoverable one that reports healthy.** Before the
write, the corrupt value is still on disk and can be inspected or repaired; afterwards the registry is
a valid single-entry array, `readLeagueRegistry` returns `ok`, and nothing records that any other
league ever existed. Their stored data survives under their slugs and is unreachable.

**So fixing only the route leaves the destructive half in place**, reachable by any other caller of
`addLeague`.

## The precedent to follow

`src/lib/seasonArchive.ts:193-209` already does this correctly: it consumes `readLeagueRegistry()`
rather than `getLeague`, notes in a comment that *"`getLeague` would flatten `malformed`"*, and on
`malformed` **refuses** with a message that names the refusal rather than reading as though there were
no archives. Read it before writing; the shape is settled and this slice is applying it, not inventing
it.

**Fail closed means: unable to determine whether the slug is taken is NOT permission to create.** A
refusal here is recoverable — the owner repairs the registry and retries. A wrong creation is not.

## The destructive-operation boundary

**Do not run anything against production.** This is registry mutation code; the read-only rail
(`DATABASE_URL_RO`) is the only production access, and nothing in this slice needs it. If you believe
you need a production read to size the blast radius, stop and ask.

## Acceptance

1. **League creation refuses on a malformed registry**, with a message that distinguishes "cannot
   determine" from "already exists", pinned by a test that fails against today's code.
2. **`mutateRegistry` does not write over a malformed registry.** Its callers either refuse or are
   proven safe. **Enumerate every caller and state which of them can write under `malformed` today** —
   receipt item 1 — and pin the disposition of each. A caller that no-ops because it finds nothing is
   safe by accident; say so explicitly rather than leaving it undistinguished from one that refuses.
3. **`getLeagues()` is UNCHANGED.** 69 modules depend on its array contract and the collapse there is
   documented as deliberate. Pin that it still returns `[]` for both absent and malformed.
4. **A refusal is recoverable.** After a refusal the registry is untouched — the corrupt value is
   still readable — pinned by a test that asserts no write occurred.
5. **The `PLATFORM-086F2I` comment's claim is tested.** It states the adoption consequence in prose;
   per the standing rule, the comment names the test that asserts it.
6. **The advisory-lock behaviour is unchanged.** `withAppStateKeyTransaction` still serialises every
   read-modify-write on the registry key; this slice adds a refusal inside the transaction, not a new
   lock discipline.

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 2 is the likely false green.** A test that drives a malformed registry through
`addLeague` and asserts a throw may be satisfied by the pre-existing duplicate-check throw rather than
by a new refusal. **Assert that no write occurred**, not merely that something threw — and mutate the
refusal away to confirm the write assertion is what reddens.

**Acceptance 1's fixture must be genuinely malformed**, not absent. Those are the two states this
whole slice exists to separate, and a test using an absent registry proves the opposite of what it
claims.

---

## STOP — read receipt before writing any code

Answer from the FILES. Enumerate rather than counting.

1. **Every caller of `mutateRegistry`**, and for each: does it WRITE under a malformed registry, or
   does it no-op because it finds nothing? Name them; do not report a count.
2. **Every route or action that gates on `getLeagues()` or `getLeague()` before a write.** The
   duplicate-slug check is the one this issue names — say whether it is the only one.
3. **What does a malformed registry look like in practice?** The docblock says a present record whose
   value is not an array, including a stored JSON `null`. Is there any known instance, and what would
   produce one?
4. **Does refusing inside `mutateRegistry` change the advisory lock's behaviour** — a throw inside
   `withAppStateKeyTransaction`, does the lock release cleanly? Answer from the transaction code.
5. **The issue mentions lower-severity siblings** — `getLeague(slug)` returning `null` for both "not
   found" and "cannot tell". Enumerate the callers that act on that null, and say whether any of them
   writes.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
