# PLATFORM-831 — an abbreviation for every renderable team

```text
PROMPT_ID: PLATFORM-831-ABBREVIATION-LOOKUP-CODEX-v1
PURPOSE: Give the app a provider abbreviation for every team that can render on a league surface —
         including the FCS opponents the 138-team catalog omits — WITHOUT changing what the team
         catalog contains.
SCOPE:   a new lookup (store + fetch script + reader) and its tests. src/lib/server/teamDatabaseStore.ts
         and src/lib/teamIdentity.ts only if the receipt proves the chosen shape needs them.
         DO NOT add rows to the `team-database` catalog, change `scripts/fetch-cfbd-teams.ts`'s
         `/teams/fbs` endpoint, touch any draft surface, or render anything — the fallback is #832,
         and this slice ships no UI.
CARRIES: NONE from the Item 87 campaign index, having checked — this is a data-source slice and
         touches no scoreboard row, tag slot or row anatomy.

         One standing obligation binds, from PLATFORM-086F2J: **asserting narrowness is not enforcing
         it.** This slice's whole safety argument is "no existing consumer changes". A sentence
         saying so is not evidence; a test that fails when it stops being true is.
```

---

## Why this exists

**Owner ruling on [#821](https://github.com/znpruitt/cfb-app/issues/821), 2026-09-20:** a team name is
never truncated; when a column cannot hold it, the row renders that team's abbreviation. `DESIGN.md`
carries the rule. **[#832](https://github.com/znpruitt/cfb-app/issues/832) implements the fallback and
is blocked on this slice** — without a lookup, 100 of the 238 renderable names have nothing to fall
back to.

## What planning measured on 2026-09-20

**At the provider**, `GET /teams?year=2026` returns **682 teams**: 138 fbs, 128 fcs, 170 ii, 246 iii,
each with an `abbreviation`. **127 of 128 FCS teams have one** — `Chicago State` is the exception and
never appears opposite a rostered team.

**Against the rendered population:** of the **238** names that can appear on a league surface in 2026,
**238 have an abbreviation**, 2-4 characters, zero gaps. The four that matter:

| name | abbreviation |
| --- | --- |
| Southeast Missouri State | `SEMO` |
| Mississippi Valley State | `MVSU` |
| Long Island University | `LIU` |
| North Carolina Central | `NCCU` |

**In this app:** `scripts/fetch-cfbd-teams.ts:203` fetches `https://api.collegefootballdata.com/teams/fbs`,
so `team-database` / `current` holds **138 FBS teams**. `TeamCatalogItem.abbreviation` already exists as
a field (`teamIdentity.ts:18`) and is populated for all 138 — the gap is FCS rows, not the shape.

## THE HAZARD — this is the reason the slice exists in this form

`getTeamDatabaseItems(` is called at **19 sites across 17 files** (imports excluded — planning first
reported 41 by counting import lines, corrected on the issue). **Three are draft surfaces:**

- `src/app/league/[slug]/draft/page.tsx:64`
- `src/app/league/[slug]/draft/board/page.tsx:56`
- `src/app/league/[slug]/draft/summary/page.tsx:163`

**Adding 128 FCS schools to that catalog would make them draftable**, and would feed them to the
identity resolver, classification labels, owner validation (`api/owners/validate/route.ts:60`), the
archives and Insights. The catalog's 138-team shape is load-bearing in ways no single call site
declares. **That is a draft-night discovery, not a review-time one.**

## Shapes to weigh — none chosen here

State the trade-offs in the receipt; the ruling picks.

- **A separate durable store** keyed by school name, written by its own fetch script. Clean isolation;
  a second provider-derived store to keep fresh.
- **A static build-time map** committed to `src/data/`. No runtime store, no staleness path, changes at
  most once a season; needs a regeneration story and review of a generated file.
- **An additive collection inside the existing record** that the 19 consumers do not read. Smallest
  fetch change; highest risk of a consumer picking it up by accident later.

**Whichever is chosen, the season pin matters:** `fetch-cfbd-teams.ts:50-54` documents that a pinned
`--year` is how the checked-in seed and the durable catalog are kept in agreement. Say how this lookup
stays consistent with that.

## Acceptance

1. **Every name that can render has an abbreviation available**, proven against the real 2026 rendered
   population rather than a fixture — the 238-name set, from the stored schedule joined to the rosters.
2. **Nothing the catalog feeds changes.** The draft board's team count, owner validation, the resolver
   and the classification labels behave identically. **Prove it with a test that fails if the catalog's
   population changes**, not with a sentence.
3. **A missing abbreviation is a first-class case**, not a crash and not a fabricated short form. Say
   what a consumer gets for `Chicago State`.
4. **The fetch is one provider call** and is quota-aware: `/teams` is a single request; record it in the
   closeout. CFBD quota at the time of writing: 4,423 of 5,000 remaining.
5. **No UI renders anything from this slice.** #832 owns the rendering.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.**

**Acceptance 2 needs a real observer.** A test asserting "the draft still sees 138 teams" passes
whether or not your lookup exists — make it fail by adding an FCS row to the catalog in the test, and
show which assertion catches it.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **Re-measure the provider and the rendered population.** Confirm or correct planning's 682/138/128
   split, the 238-of-238 coverage, and the four abbreviations above. Use the read-only replica for the
   stored side (`DATABASE_URL_RO`; never print the connection string) and one CFBD call for the
   provider side.
2. **Enumerate every consumer of `getTeamDatabaseItems`** — 19 sites is planning's count; say whether
   it holds — and for each, **what it would do if the catalog gained 128 FCS rows.** This is the
   receipt's most important answer; the three draft sites are known, the other sixteen are not.
3. **Which shape, and why?** With the rejected ones and what each would cost.
4. **How does the lookup stay in step with the season pin** that governs the catalog?
5. **Who consumes the lookup, and through what seam?** #832 will need it at render time on four
   surfaces. Say what it will call, without building it.
6. **Does anything already carry an FCS abbreviation** — the alias map, a seed file, `alts`? Check
   before adding a source.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
