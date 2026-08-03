import { cache } from 'react';

import { getAppState, withAppStateKeyTransaction } from './server/appStateStore.ts';
import { TEST_LEAGUE_SLUG, type League, type LeagueStatus } from './league.ts';

const REGISTRY_SCOPE = 'leagues';
const REGISTRY_KEY = 'registry';

/**
 * The accepted range for any stored or derived lifecycle year (PLATFORM-086F2H1).
 * It exists to reject corrupt/legacy garbage (`NaN`, a float, `1e21`, a string
 * year) before it can be written back or incremented into a nonsense season —
 * not to encode product policy about which seasons the app supports.
 */
const MIN_LIFECYCLE_YEAR = 2000;
// A sanity ceiling, chosen to line up with the other server-side season-year
// bounds (`systemHealth.ts` → `validateYear`; `systemHealthYear.ts` → `MIN_YEAR`
// + its `currentUTCYear + 1` clamp). NOTE: this is alignment, not a dependency —
// the health page clamps the year BEFORE `validateYear` sees it, so a wider
// registry bound could not actually make the dashboard throw (an earlier comment
// here claimed it could; corrected at F2H review). Extracting one shared
// season-year predicate across the three modules remains a follow-up.
const MAX_LIFECYCLE_YEAR = 2100;

function isValidLifecycleYear(year: unknown): year is number {
  return (
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= MIN_LIFECYCLE_YEAR &&
    year <= MAX_LIFECYCLE_YEAR
  );
}

/**
 * Whether a stored `status` value is a structurally valid `LeagueStatus` — i.e.
 * genuinely assignable to the union in `league.ts`, not merely
 * discriminant-shaped. Used only by the missing-status recovery authority to
 * tell "this league already has a lifecycle status" from "this league has a
 * malformed status object" — the latter is refused, never silently repaired.
 *
 * `setupComplete` is declared ONLY on the `preseason` variant (`?: boolean`), so
 * a non-boolean value there makes the record unassignable and must classify as
 * malformed. On `season`/`offseason` the property is not part of the variant at
 * all, so an extra key is still structurally valid and must NOT be rejected.
 *
 * The year check here is STRUCTURAL (`year: number`), deliberately NOT the
 * narrower `isValidLifecycleYear` range: the question this predicate answers is
 * "does this league already have a lifecycle status?", and a legacy
 * `{ state: 'season', year: 1999 }` plainly does. Reporting it as malformed
 * would tell an operator their well-formed record is corrupt (F2H review). The
 * range bound belongs on WRITES, which is where `isValidLifecycleYear` is used.
 */
function isStructurallyValidYear(year: unknown): year is number {
  return typeof year === 'number' && Number.isInteger(year);
}

function isValidLeagueStatus(status: unknown): status is LeagueStatus {
  if (!status || typeof status !== 'object') return false;
  const candidate = status as { state?: unknown; year?: unknown; setupComplete?: unknown };
  if (candidate.state === 'offseason') return true;
  if (candidate.state === 'season') return isStructurallyValidYear(candidate.year);
  if (candidate.state === 'preseason') {
    return (
      isStructurallyValidYear(candidate.year) &&
      (candidate.setupComplete === undefined || typeof candidate.setupComplete === 'boolean')
    );
  }
  return false;
}

/** Slug must be lowercase alphanumeric words separated by single hyphens */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export async function getLeagues(): Promise<League[]> {
  const record = await getAppState<League[]>(REGISTRY_SCOPE, REGISTRY_KEY);
  const value = record?.value;
  return Array.isArray(value) ? value : [];
}

export const getLeague = cache(async (slug: string): Promise<League | null> => {
  const leagues = await getLeagues();
  return leagues.find((l) => l.slug === slug) ?? null;
});

/**
 * Serialize every registry read-modify-write on the ONE registry key
 * (PLATFORM-086F2B, Codex review). The registry is a whole-array record, so two
 * concurrent mutators reading the same snapshot would drop one another's update
 * on the final write (e.g. independent per-year rollovers, or a rollover racing
 * a preseason action). `withAppStateKeyTransaction` holds the per-key advisory
 * lock across the read → mutate → write cycle on both store backends.
 */
async function mutateRegistry<T>(
  fn: (leagues: League[]) => { next?: League[]; result: T }
): Promise<T> {
  return withAppStateKeyTransaction(REGISTRY_SCOPE, REGISTRY_KEY, async (txn) => {
    const record = await txn.read<League[]>();
    const leagues = Array.isArray(record?.value) ? record.value : [];
    const { next, result } = fn(leagues);
    if (next) await txn.write(next);
    return result;
  });
}

export async function addLeague(league: League): Promise<League[]> {
  return mutateRegistry((leagues) => {
    if (leagues.some((l) => l.slug === league.slug)) {
      throw new Error(`League with slug '${league.slug}' already exists`);
    }
    const updated = [...leagues, league];
    return { next: updated, result: updated };
  });
}

/**
 * Generic league CONFIGURATION update (display name, founded year, password
 * material, assignment configuration). The lifecycle fields — `year` and
 * `status` — are reserved for the lifecycle operations below (PLATFORM-086F2B,
 * PLATFORM-086F2H1): `league.status` is the lifecycle source of truth and the
 * top-level `league.year` is only its synchronized compatibility projection, so
 * no generic caller may write either field. The type excludes them and the
 * runtime guard rejects untyped callers.
 */
export async function updateLeague(
  slug: string,
  updates: Partial<Omit<League, 'slug' | 'createdAt' | 'year' | 'status'>>
): Promise<League | null> {
  if ('year' in updates || 'status' in updates) {
    throw new Error(
      'updateLeague cannot mutate lifecycle fields (year/status) — use a guarded lifecycle operation (beginPreseasonTransition / completePreseasonSetup / completeSeasonTransition / completeSeasonRollover / initializeMissingLifecycleStatus)'
    );
  }
  return mutateRegistry((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: null };
    const updated = leagues.map((l, i) => (i === idx ? { ...l, ...updates } : l));
    return { next: updated, result: updated[idx]! };
  });
}

/**
 * The last authoritative season year of a record — the year its lifecycle
 * status carries when one exists (season/preseason), else the stored top-level
 * projection. Entering offseason writes THIS year into `league.year`, so a
 * previously desynchronized top-level year (possible on legacy records) is
 * healed rather than carried forward into the next `beginPreseason` increment.
 */
function lastAuthoritativeYear(league: League): number {
  return league.status && league.status.state !== 'offseason' ? league.status.year : league.year;
}

/**
 * The ONE lifecycle status projection (PLATFORM-086F2B): applying a status to a
 * record always derives the synchronized top-level `league.year` in the same
 * value, so no call site can write `status` without its projection.
 *
 *   - `season` / `preseason` → `league.year = status.year`;
 *   - `offseason` → `league.year` = the last authoritative season year (the
 *     outgoing `status.year` when present) — the archived-season projection.
 */
function applyLifecycleStatus(current: League, status: LeagueStatus): League {
  return status.state === 'offseason'
    ? { ...current, status, year: lastAuthoritativeYear(current) }
    : { ...current, status, year: status.year };
}

/**
 * A guarded lifecycle decision, made against the record read UNDER the registry
 * lock: either commit exactly one status (projecting the written record into the
 * caller's typed outcome) or refuse and write nothing.
 */
type LifecycleWriteDecision<T> =
  | { commit: LeagueStatus; onWritten: (written: League) => T }
  | { commit: null; refusal: T };

/**
 * The ONE guarded lifecycle-write path (PLATFORM-086F2H1). Every typed
 * transition below routes its expected-state validation, its year derivation,
 * and its write through here, so a single `withAppStateKeyTransaction` callback
 * covers registry read → expected-state validation → state derivation → write.
 *
 * Consequences that hold for every operation built on it, by construction:
 *
 *   - a caller can never derive a lifecycle year from a snapshot read outside
 *     the lock (`decide` only ever sees the locked record);
 *   - a stale caller can never overwrite a newer lifecycle state — its
 *     expected-state predicate re-runs against the locked record and refuses;
 *   - a refusal writes NOTHING (no `next`), so it is a typed outcome rather
 *     than a silent overwrite;
 *   - `status` and `league.year` land in one written record via
 *     `applyLifecycleStatus`, so a failed write cannot partially update them.
 *
 * `notFound` is returned when the slug has no record; `decide` therefore only
 * ever runs against a real league, which is what keeps the commit path free of
 * a "found?" assertion.
 */
async function guardedLifecycleWrite<T>(
  slug: string,
  notFound: T,
  decide: (current: League) => LifecycleWriteDecision<T>
): Promise<T> {
  return mutateRegistry<T>((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: notFound };
    const current = leagues[idx]!;
    const decision = decide(current);
    if (decision.commit === null) return { result: decision.refusal };
    const written = applyLifecycleStatus(current, decision.commit);
    return {
      next: leagues.map((l, i) => (i === idx ? written : l)),
      result: decision.onWritten(written),
    };
  });
}

/**
 * The state-UNGUARDED lifecycle mutation, restricted to the `test` league
 * (PLATFORM-086F2B; runtime restriction added at PLATFORM-086F2H1 review).
 * Performs ONE serialized registry write per call, synchronizing `status` and
 * the top-level `league.year` through `applyLifecycleStatus` — so a failed
 * registry write can never leave the two partially synchronized.
 *
 * It applies no expected-state precondition, which is why it exists ONLY for the
 * test league's independent lifecycle controls (`src/app/admin/[slug]/actions.ts`),
 * whose whole purpose is to set an arbitrary state. Every PRODUCTION transition
 * goes through a guarded operation instead — `beginPreseasonTransition`,
 * `completePreseasonSetup`, `completeSeasonTransition`, `completeSeasonRollover`,
 * or `initializeMissingLifecycleStatus`.
 *
 * That restriction is enforced HERE, at runtime, and rejects before any
 * transaction is opened or any registry read/write occurs — so no non-test slug
 * can reach a lifecycle write through this path regardless of how the call is
 * constructed (an aliased import, a barrel re-export, a dynamic `import()`, or an
 * indirect reference). `leagueRegistry.lifecycleCallers.test.ts` additionally
 * pins the caller allowlist by source scan; that scan is defense-in-depth, not
 * the enforcement mechanism.
 */
export async function updateLeagueStatus(
  slug: string,
  status: LeagueStatus
): Promise<League | null> {
  if (slug !== TEST_LEAGUE_SLUG) {
    throw new Error(
      `updateLeagueStatus is restricted to the '${TEST_LEAGUE_SLUG}' league — use a guarded lifecycle operation (beginPreseasonTransition / completePreseasonSetup / completeSeasonTransition / completeSeasonRollover / initializeMissingLifecycleStatus)`
    );
  }
  return guardedLifecycleWrite<League | null>(slug, null, () => ({
    commit: status,
    onWritten: (written) => written,
  }));
}

export type BeginPreseasonTransition =
  | { outcome: 'transitioned'; league: League }
  | { outcome: 'league-not-found' }
  | { outcome: 'not-in-offseason'; league: League }
  | { outcome: 'invalid-year'; league: League };

/**
 * The GUARDED offseason→preseason transition (PLATFORM-086F2H1). The next
 * preseason year is computed INSIDE the transaction from the record read under
 * the lock, so a double invocation, a stale tab, or a concurrent lifecycle actor
 * can never increment twice or overwrite a league that has already advanced:
 * the second attempt observes `preseason`/`season` and refuses.
 */
export async function beginPreseasonTransition(slug: string): Promise<BeginPreseasonTransition> {
  return guardedLifecycleWrite<BeginPreseasonTransition>(
    slug,
    { outcome: 'league-not-found' },
    (current) => {
      if (current.status?.state !== 'offseason') {
        return { commit: null, refusal: { outcome: 'not-in-offseason', league: current } };
      }
      // Derived under the lock — never from a pre-transaction read. Both the
      // stored year and the derived one must be usable.
      if (!isValidLifecycleYear(current.year)) {
        return { commit: null, refusal: { outcome: 'invalid-year', league: current } };
      }
      const nextYear = current.year + 1;
      if (!isValidLifecycleYear(nextYear)) {
        return { commit: null, refusal: { outcome: 'invalid-year', league: current } };
      }
      return {
        commit: { state: 'preseason', year: nextYear },
        onWritten: (league) => ({ outcome: 'transitioned', league }),
      };
    }
  );
}

export type PreseasonSetupCompletion =
  | { outcome: 'completed'; league: League }
  | { outcome: 'already-complete'; league: League }
  | { outcome: 'league-not-found' }
  | { outcome: 'not-in-preseason'; league: League }
  | { outcome: 'year-mismatch'; league: League }
  // The submitted year MATCHES the record, but the stored year is unusable —
  // a corrupt record, not a stale form. Kept distinct so the caller cannot tell
  // the operator "no longer in preseason for X" about a league that is, right
  // now, in preseason for exactly X (F2H review).
  | { outcome: 'invalid-year'; league: League };

/**
 * The GUARDED preseason setup completion (PLATFORM-086F2H1). Requires, inside
 * the transaction, that the league is STILL in `preseason` for EXACTLY the
 * submitted year — a stale setup form (submitted for a year the league has since
 * left, or from a league that has already transitioned) writes nothing and
 * cannot move the lifecycle year forward or backward. An already-complete
 * matching setup is a typed no-op rather than a redundant rewrite.
 */
export async function completePreseasonSetup(
  slug: string,
  year: number
): Promise<PreseasonSetupCompletion> {
  return guardedLifecycleWrite<PreseasonSetupCompletion>(
    slug,
    { outcome: 'league-not-found' },
    (current) => {
      const status = current.status;
      if (status?.state !== 'preseason') {
        return { commit: null, refusal: { outcome: 'not-in-preseason', league: current } };
      }
      if (status.year !== year) {
        return { commit: null, refusal: { outcome: 'year-mismatch', league: current } };
      }
      // A corrupt stored year must not be laundered forward by a matching
      // submission, so validate it as well as match it — the same guard the
      // deriving operations apply, reported as its own cause.
      if (!isValidLifecycleYear(status.year)) {
        return { commit: null, refusal: { outcome: 'invalid-year', league: current } };
      }
      if (status.setupComplete === true) {
        // Pre-F2H1 this path rewrote the status unconditionally, which also
        // HEALED a desynchronized legacy `league.year` as a side effect. Keep
        // that healing (F2H1 review) — commit only when the projection is
        // actually stale, so the common repeat stays a true no-op.
        if (current.year === status.year) {
          return { commit: null, refusal: { outcome: 'already-complete', league: current } };
        }
        return {
          commit: { state: 'preseason', year: status.year, setupComplete: true },
          onWritten: (league) => ({ outcome: 'already-complete', league }),
        };
      }
      return {
        // Commit the year narrowed from the record, not the caller's parameter —
        // they are equal here, and this makes the guard's purpose explicit.
        commit: { state: 'preseason', year: status.year, setupComplete: true },
        onWritten: (league) => ({ outcome: 'completed', league }),
      };
    }
  );
}

export type SeasonTransition =
  | { outcome: 'transitioned'; league: League }
  // The league is ALREADY in the requested season year — the desired end state,
  // reached by a prior (or overlapping) run. Benign and idempotent: distinct
  // from a genuinely stale target so a duplicate at-least-once delivery is not
  // reported as an anomaly.
  | { outcome: 'already-in-target-season'; league: League }
  | { outcome: 'not-in-target-preseason'; league: League | null };

/**
 * The GUARDED preseason→season transition (PLATFORM-086F2H1), consumed by the
 * daily season-transition cron. Inside the transaction the league must STILL be
 * in `preseason` for the exact target year — the cron's registry snapshot is
 * read once at the top of a run that then performs lengthy schedule work, so by
 * write time another actor may have rolled the league over, moved it to a
 * different preseason year, or transitioned it already. A refusal is a typed
 * outcome the cron reports truthfully, never a silent overwrite and never a
 * counted transition.
 */
export async function completeSeasonTransition(
  slug: string,
  year: number
): Promise<SeasonTransition> {
  return guardedLifecycleWrite<SeasonTransition>(
    slug,
    { outcome: 'not-in-target-preseason', league: null },
    (current) => {
      const status = current.status;
      // Idempotent re-delivery: the league is already exactly where this call
      // wanted to put it. Reported as its own benign outcome so the caller does
      // not mistake an overlapping duplicate invocation — the schedulers deliver
      // at-least-once — for a stale target set (F2H1 review).
      if (status?.state === 'season' && status.year === year) {
        return { commit: null, refusal: { outcome: 'already-in-target-season', league: current } };
      }
      // A corrupt stored preseason year must not be promoted into a season
      // status (and projected onto `league.year`) just because the caller
      // grouped by it — validate as well as match (F2H1 review).
      if (
        status?.state !== 'preseason' ||
        status.year !== year ||
        !isValidLifecycleYear(status.year)
      ) {
        return { commit: null, refusal: { outcome: 'not-in-target-preseason', league: current } };
      }
      return {
        commit: { state: 'season', year: status.year },
        onWritten: (league) => ({ outcome: 'transitioned', league }),
      };
    }
  );
}

export type SeasonRolloverTransition =
  | { outcome: 'transitioned'; league: League }
  | { outcome: 'not-in-target-season'; league: League | null };

/**
 * The GUARDED season→offseason rollover transition (PLATFORM-086F2B, Codex
 * review): inside the serialized registry transaction, the league must STILL be
 * in `season` for the exact requested year — a rollover request that captured
 * its target group before lengthy archive work can never clobber a league that
 * another actor has since rolled over and advanced to preseason. A refusal is a
 * typed outcome (the caller reports it as a status-stage failure), never a
 * silent overwrite.
 */
export async function completeSeasonRollover(
  slug: string,
  year: number
): Promise<SeasonRolloverTransition> {
  // PLATFORM-086F2H1: the guard, the ordering, and the outcomes are UNCHANGED —
  // only the write now shares `guardedLifecycleWrite` with its sibling
  // transitions. The written record is byte-identical: the guard has already
  // established `status.state === 'season' && status.year === year`, so the
  // offseason projection (`lastAuthoritativeYear` → the outgoing `status.year`)
  // is exactly the `year: year` this previously wrote inline.
  return guardedLifecycleWrite<SeasonRolloverTransition>(
    slug,
    { outcome: 'not-in-target-season', league: null },
    (current) => {
      if (current.status?.state !== 'season' || current.status.year !== year) {
        return { commit: null, refusal: { outcome: 'not-in-target-season', league: current } };
      }
      return {
        commit: { state: 'offseason' },
        onWritten: (league) => ({ outcome: 'transitioned', league }),
      };
    }
  );
}

export type LifecycleStatusInitialization =
  // `status` is the value ACTUALLY installed, so a caller reporting the outcome
  // never has to re-derive (and thus never drifts from) the authority's decision.
  | { outcome: 'initialized'; league: League; status: LeagueStatus }
  | { outcome: 'league-not-found' }
  | { outcome: 'status-already-present'; league: League }
  | { outcome: 'invalid-existing-status'; league: League }
  | { outcome: 'invalid-legacy-year'; league: League }
  | { outcome: 'test-league-managed-separately' };

/**
 * Explicit recovery for a LEGACY record whose `status` property is genuinely
 * absent (PLATFORM-086F2H1 — the repair path F2B deliberately deferred).
 *
 * It installs exactly the read-only compatibility interpretation those records
 * already render under (`{ state: 'season', year: league.year }`) and nothing
 * else. Deliberately NOT a generic lifecycle setter:
 *
 *   - it refuses any record that already carries a `status`, valid
 *     (`status-already-present`) or malformed (`invalid-existing-status`) — it
 *     never alters a valid lifecycle status and never repairs an arbitrary
 *     malformed one;
 *   - it offers no season/preseason/offseason choice, never increments the year,
 *     never archives, and never substitutes for rollover;
 *   - it refuses the `test` league, whose lifecycle stays owned by its own test
 *     controls;
 *   - it refuses an unusable stored year rather than inventing one;
 *   - it runs entirely inside the registry transaction, so a concurrent actor
 *     that installs a status first wins and this call refuses.
 *
 * Nothing infers or writes during page rendering — the read-only inference on
 * admin pages is unchanged (`AGENTS.md` → Lifecycle Authority Invariants #3).
 */
export async function initializeMissingLifecycleStatus(
  slug: string
): Promise<LifecycleStatusInitialization> {
  return guardedLifecycleWrite<LifecycleStatusInitialization>(
    slug,
    { outcome: 'league-not-found' },
    (current) => {
      if (current.slug === TEST_LEAGUE_SLUG) {
        return { commit: null, refusal: { outcome: 'test-league-managed-separately' } };
      }
      // "Genuinely absent" means absent TO EVERY READER: both `undefined` and a
      // persisted `null` render under the read-only compatibility inference
      // (`leagueStandings.ts` uses `league.status ?? …`; `rolloverTargeting.ts`
      // uses `!status`), so a `null` record is exactly the class this operation
      // exists to repair and must not be refused as malformed (F2H1 review).
      if (current.status != null) {
        return {
          commit: null,
          refusal: isValidLeagueStatus(current.status)
            ? { outcome: 'status-already-present', league: current }
            : { outcome: 'invalid-existing-status', league: current },
        };
      }
      if (!isValidLifecycleYear(current.year)) {
        return { commit: null, refusal: { outcome: 'invalid-legacy-year', league: current } };
      }
      const installed: LeagueStatus = { state: 'season', year: current.year };
      return {
        // The top-level year is preserved, not recomputed: the season projection
        // writes `league.year = status.year = current.year`.
        commit: installed,
        onWritten: (league) => ({ outcome: 'initialized', league, status: installed }),
      };
    }
  );
}

/**
 * Remove the password credentials from a league, reverting it to public. Uses
 * explicit rest-destructuring so the persisted record no longer carries the
 * `passwordHash` / `passwordSalt` keys at all (rather than setting them to
 * `undefined`, which leaves the keys present in memory even though JSON
 * serialization would drop them).
 */
export async function clearLeaguePassword(slug: string): Promise<League | null> {
  return mutateRegistry((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: null };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, passwordSalt, ...rest } = leagues[idx]!;
    const cleared = rest as League;
    const updated = leagues.map((l, i) => (i === idx ? cleared : l));
    return { next: updated, result: cleared };
  });
}

export async function removeLeague(slug: string): Promise<{ removed: boolean; leagues: League[] }> {
  return mutateRegistry<{ removed: boolean; leagues: League[] }>((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: { removed: false, leagues } };
    const updated = leagues.filter((l) => l.slug !== slug);
    return { next: updated, result: { removed: true, leagues: updated } };
  });
}
