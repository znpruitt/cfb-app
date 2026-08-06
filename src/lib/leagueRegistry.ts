import { cache } from 'react';

import { getAppState, withAppStateKeyTransaction } from './server/appStateStore.ts';
import {
  isStructurallyValidSeasonYear,
  TEST_LEAGUE_SLUG,
  type League,
  type LeagueStatus,
} from './league.ts';

const REGISTRY_SCOPE = 'leagues';
const REGISTRY_KEY = 'registry';

/** Slug must be lowercase alphanumeric words separated by single hyphens */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * PLATFORM-086F2H1R1 — the closed outcome of reading the registry CONTAINER.
 *
 * `getLeagues()` maps every non-`ok` outcome to `[]`, which makes a MALFORMED
 * registry indistinguishable from an empty one. That collapse is why a cron
 * facing a corrupt registry reports a zero-target reason asserting no league
 * exists — the exact falsehood class F2H1T2/T3/T4 each refused to ship. This
 * reader keeps the distinction available to callers that can act on it.
 *
 * This is a CONTAINER-level classification only. It does not validate individual
 * league records; per-record lifecycle validity is each consumer's own concern
 * (and, for the remaining target selectors, the R2–R5 slices').
 */
export type LeagueRegistryReadResult =
  | { kind: 'ok'; leagues: League[] }
  | { kind: 'missing' }
  | { kind: 'malformed' };

/**
 * Read the registry container and classify it. A store failure still THROWS —
 * `getAppState` returns `null` only for a genuinely absent record, so a returned
 * value always means the read itself succeeded, and unavailability stays
 * distinct from corruption.
 *
 * A PRESENT record whose value is not an array is `malformed`, including a
 * stored JSON `null`. This deliberately diverges from `readScheduleItems`
 * (`rankings/automaticContext.ts`), which treats a null-valued record as known
 * ABSENCE: for a schedule, "no data" is an ordinary state, whereas a registry
 * record that exists but holds no league array is corruption. Classifying it
 * `missing` would let a caller proceed as though the registry were empty, which
 * is the collapse this reader exists to prevent.
 *
 * Read-only: no write, migration, or repair, and the malformed value is never
 * returned or logged.
 */
export async function readLeagueRegistry(): Promise<LeagueRegistryReadResult> {
  const record = await getAppState<League[]>(REGISTRY_SCOPE, REGISTRY_KEY);
  if (record === null) return { kind: 'missing' };
  return Array.isArray(record.value)
    ? { kind: 'ok', leagues: record.value }
    : { kind: 'malformed' };
}

/**
 * Every league, or `[]` when the registry is absent OR malformed. Behavior is
 * unchanged from before the typed reader existed — 69 modules depend on it, so
 * callers that need the distinction consume `readLeagueRegistry()` directly
 * rather than having it forced on them here.
 */
export async function getLeagues(): Promise<League[]> {
  const read = await readLeagueRegistry();
  return read.kind === 'ok' ? read.leagues : [];
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
 * `status` — are reserved for the guarded lifecycle operations in this module
 * (PLATFORM-086F2B, F2H1B, F2H1T1): `league.status` is the lifecycle
 * source of truth and the top-level `league.year` is only its synchronized
 * compatibility projection, so no generic caller may write either field. The
 * type excludes them and the runtime guard rejects untyped callers.
 */
export async function updateLeague(
  slug: string,
  updates: Partial<Omit<League, 'slug' | 'createdAt' | 'year' | 'status'>>
): Promise<League | null> {
  if ('year' in updates || 'status' in updates) {
    throw new Error(
      'updateLeague cannot mutate lifecycle fields (year/status) — use a guarded lifecycle operation in leagueRegistry.ts'
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

/** Apply the authoritative lifecycle status and its compatibility projection. */
function applyLifecycleStatus(current: League, status: LeagueStatus): League {
  return status.state === 'offseason'
    ? { ...current, status, year: lastAuthoritativeYear(current) }
    : { ...current, status, year: status.year };
}

type GuardedLifecycleDecision<T> =
  | { status: LeagueStatus; project: (written: League) => T }
  | { status: null; result: T };

/**
 * The single lifecycle write authority. It runs a decision against the record
 * read under the registry lock; a refusal writes nothing, while an accepted
 * status and its year projection share one registry commit. Both guarded
 * transitions and the fixed-target demo-league control delegate here, so adding
 * an expected-state check never creates a second write path.
 */
async function guardedLifecycleWrite<T>(
  slug: string,
  notFound: T,
  decide: (current: League) => GuardedLifecycleDecision<T>
): Promise<T> {
  return mutateRegistry((leagues) => {
    const idx = leagues.findIndex((league) => league.slug === slug);
    if (idx === -1) return { result: notFound };

    const current = leagues[idx]!;
    const decision = decide(current);
    if (decision.status === null) return { result: decision.result };

    const next = applyLifecycleStatus(current, decision.status);
    return {
      next: leagues.map((league, index) => (index === idx ? next : league)),
      result: decision.project(next),
    };
  });
}

/** The lifecycle states the demo controls may request. */
export type TestLeagueLifecycleState = 'season' | 'offseason' | 'preseason';

/** The fixed season a demo hard-reset returns the league to. */
export const TEST_LEAGUE_RESET_YEAR = 2025;

export type TestLeagueLifecycleOutcome =
  // Committed. `status` is the CLOSED `LeagueStatus` union — scalars only, no
  // league record — and carries the year the authority resolved under the lock,
  // so a caller never re-derives it from a pre-transaction read.
  | { outcome: 'applied'; status: LeagueStatus }
  // Absent from the registry. Same spelling as the sibling commissioner
  // authorities, so a consumer switching across them needs no alias table.
  | { outcome: 'league-not-found' }
  // The stored year cannot participate in lifecycle arithmetic.
  | { outcome: 'unusable-stored-year' }
  // The stored year is usable but its successor is not representable.
  | { outcome: 'unusable-derived-year' }
  // The requested state is not one this authority recognizes. Reachable
  // because the caller is a Server Action: its argument crosses HTTP and is
  // never runtime-validated, so an unknown value must produce a typed refusal
  // rather than a crash.
  | { outcome: 'unsupported-state' };

/** The refusal shape shared by `setTestLeagueLifecycleState`'s decision. */
type TestLeagueRefusal = Exclude<TestLeagueLifecycleOutcome, { outcome: 'applied' }>;

/** Narrower outcome for the reset, which derives nothing and cannot refuse on a year. */
export type TestLeagueResetOutcome =
  | { outcome: 'applied'; status: LeagueStatus }
  | { outcome: 'league-not-found' };

/**
 * Resolve the requested demo-league status from the record read under the
 * registry lock. Exhaustive over the closed state union — a future variant
 * fails to compile rather than being silently reinterpreted.
 */
function decideTestLeagueStatus(
  current: League,
  state: TestLeagueLifecycleState
): { status: LeagueStatus } | { refusal: TestLeagueRefusal } {
  const stored = current.status;

  switch (state) {
    case 'offseason':
      // `applyLifecycleStatus` projects the last authoritative season year into
      // `league.year`, so that value must itself be usable — an offseason write
      // is the one path that carries a stored year forward untouched.
      return isStructurallyValidSeasonYear(lastAuthoritativeYear(current))
        ? { status: { state: 'offseason' } }
        : { refusal: { outcome: 'unusable-stored-year' } };

    case 'season': {
      // `lastAuthoritativeYear` already returns `status.year` for a preseason
      // record, so this carries the increment set by 'Set: Pre-Season' forward
      // without a special case.
      const year = lastAuthoritativeYear(current);
      return isStructurallyValidSeasonYear(year)
        ? { status: { state: 'season', year } }
        : { refusal: { outcome: 'unusable-stored-year' } };
    }

    case 'preseason': {
      // preseason(N) stays at N — re-requesting must not double-increment.
      if (stored?.state === 'preseason') {
        return isStructurallyValidSeasonYear(stored.year)
          ? { status: { state: 'preseason', year: stored.year } }
          : { refusal: { outcome: 'unusable-stored-year' } };
      }
      // season(N) → N+1; offseason/missing → authoritative year + 1.
      const base = lastAuthoritativeYear(current);
      if (!isStructurallyValidSeasonYear(base)) {
        return { refusal: { outcome: 'unusable-stored-year' } };
      }
      const next = base + 1;
      // The predicate requires a SAFE integer, so a boundary predecessor whose
      // successor cannot be represented exactly refuses instead of persisting a
      // silently-rounded year. No new arbitrary ceiling is introduced.
      return isStructurallyValidSeasonYear(next)
        ? { status: { state: 'preseason', year: next } }
        : { refusal: { outcome: 'unusable-derived-year' } };
    }

    default:
      // Unreachable for a well-typed caller; reachable across the Server Action
      // boundary, where the argument is untrusted. Refuse with a typed outcome
      // instead of returning `undefined` and crashing the caller.
      return { refusal: { outcome: 'unsupported-state' } };
  }
}

/**
 * Set the DEMO league's lifecycle status (PLATFORM-086F2H1T1).
 *
 * Structurally restricted: it accepts NO slug and always targets
 * `TEST_LEAGUE_SLUG`, so no production league is reachable through it. Every
 * read, derivation, validation, and write happens inside the serialized
 * registry transaction — a caller cannot read the league, compute a year, and
 * submit it against a record that has since moved. That matters because
 * `getLeague` is React-`cache`d, so a pre-lock read can be a memoized snapshot.
 *
 * This replaces the arbitrary-slug compatibility setter, which took a caller's
 * year on trust. Forcing a state is still what the sandbox controls exist to
 * do, so there is no expected-state predicate; what IS enforced is that the
 * year can safely participate in lifecycle arithmetic.
 */
export async function setTestLeagueLifecycleState(
  state: TestLeagueLifecycleState
): Promise<TestLeagueLifecycleOutcome> {
  return guardedLifecycleWrite<TestLeagueLifecycleOutcome>(
    TEST_LEAGUE_SLUG,
    { outcome: 'league-not-found' },
    (current) => {
      const decision = decideTestLeagueStatus(current, state);
      if ('refusal' in decision) return { status: null, result: decision.refusal };
      return {
        status: decision.status,
        project: () => ({ outcome: 'applied', status: decision.status }),
      };
    }
  );
}

/**
 * Hard-reset the demo league's lifecycle to a known-good state. Deliberately
 * derives NOTHING from the stored record, so it recovers a league whose
 * persisted year is structurally unusable — the one path that always works.
 *
 * Builds a fresh status per call: the value is both written into the registry
 * record and returned to the caller, so a shared module-level object would give
 * every reset in the process one mutable identity.
 */
export async function resetTestLeagueLifecycle(): Promise<TestLeagueResetOutcome> {
  return guardedLifecycleWrite<TestLeagueResetOutcome>(
    TEST_LEAGUE_SLUG,
    { outcome: 'league-not-found' },
    () => {
      const status: LeagueStatus = { state: 'season', year: TEST_LEAGUE_RESET_YEAR };
      return { status, project: () => ({ outcome: 'applied', status }) };
    }
  );
}

export type SeasonTransitionOutcome =
  | { outcome: 'transitioned'; year: number }
  // Already in the requested season year — the desired end state, reached by a
  // prior or overlapping delivery. Benign and idempotent, never an anomaly.
  // `healed` distinguishes the variant that DID write (repairing a stale
  // top-level projection) from the untouched one, so a run that durably changed
  // data is never reported as a pure no-op.
  | { outcome: 'already-in-target-season'; year: number; healed: boolean }
  // The league no longer exists: an operator removed it after the caller
  // selected its targets. A normal admin action, kept distinct from staleness.
  | { outcome: 'league-removed' }
  // Genuinely stale: some other state, or a different lifecycle year.
  | { outcome: 'not-in-target-preseason' };

/**
 * The GUARDED preseason→season transition (PLATFORM-086F2H1B), consumed by the
 * daily season-transition cron.
 *
 * The cron reads its target snapshot once and then performs lengthy provider and
 * probe work, so by write time a league may have been rolled over, moved to a
 * different preseason year, transitioned by an overlapping delivery, or deleted.
 * The expected state and exact year are therefore re-checked INSIDE the
 * serialized registry transaction; every disposition is a closed scalar outcome
 * carrying no league record, credential field, or exception text.
 *
 * `already-in-target-season` additionally HEALS a stale top-level `league.year`
 * projection through the same projection authority, so an idempotent delivery
 * repairs a record whose status committed with a desynchronized year. That heal
 * is gated by the same structural year validation as the transition itself — an
 * unsupported year is refused outright rather than written into the projection.
 */
export async function completeSeasonTransition(
  slug: string,
  targetYear: number
): Promise<SeasonTransitionOutcome> {
  return guardedLifecycleWrite<SeasonTransitionOutcome>(
    slug,
    { outcome: 'league-removed' },
    (current) => {
      const status = current.status;

      // A structurally unsupported year must never reach a lifecycle write —
      // including through the idempotent heal below, which would otherwise sync
      // `league.year` to the stored bad value and report it `healed`. Validated
      // ONCE here rather than per branch: every branch that writes uses
      // `targetYear`, and the preseason branch requires `status.year` to equal
      // it, so this single check covers both write paths. (`NaN` also fails the
      // equality checks below; this covers the rest.)
      if (!isStructurallyValidSeasonYear(targetYear)) {
        return { status: null, result: { outcome: 'not-in-target-preseason' } };
      }

      if (status?.state === 'season' && status.year === targetYear) {
        // Idempotent redelivery. Write only when the projection is stale.
        if (current.year === targetYear) {
          return {
            status: null,
            result: { outcome: 'already-in-target-season', year: targetYear, healed: false },
          };
        }
        return {
          status: { state: 'season', year: targetYear },
          project: () => ({ outcome: 'already-in-target-season', year: targetYear, healed: true }),
        };
      }

      if (status?.state !== 'preseason' || status.year !== targetYear) {
        return { status: null, result: { outcome: 'not-in-target-preseason' } };
      }

      return {
        status: { state: 'season', year: targetYear },
        project: () => ({ outcome: 'transitioned', year: targetYear }),
      };
    }
  );
}

export type BeginPreseasonOutcome =
  | { outcome: 'transitioned'; year: number }
  | { outcome: 'league-not-found' }
  | { outcome: 'not-in-offseason' }
  | { outcome: 'unusable-stored-year' }
  | { outcome: 'unusable-next-year' };

/** Guarded offseason → preseason transition with year derivation under lock. */
export async function beginPreseasonTransition(slug: string): Promise<BeginPreseasonOutcome> {
  return guardedLifecycleWrite<BeginPreseasonOutcome>(
    slug,
    { outcome: 'league-not-found' },
    (current) => {
      if (current.status?.state !== 'offseason') {
        return { status: null, result: { outcome: 'not-in-offseason' } };
      }
      if (!isStructurallyValidSeasonYear(current.year)) {
        return { status: null, result: { outcome: 'unusable-stored-year' } };
      }

      const nextYear = current.year + 1;
      if (!isStructurallyValidSeasonYear(nextYear)) {
        return { status: null, result: { outcome: 'unusable-next-year' } };
      }

      return {
        status: { state: 'preseason', year: nextYear },
        project: () => ({ outcome: 'transitioned', year: nextYear }),
      };
    }
  );
}

export type CompletePreseasonSetupOutcome =
  | { outcome: 'completed'; year: number }
  | { outcome: 'already-complete'; year: number }
  | { outcome: 'league-not-found' }
  | { outcome: 'not-in-preseason' }
  | { outcome: 'year-mismatch' };

/** Guarded setup completion for the exact preseason year submitted. */
export async function completePreseasonSetup(
  slug: string,
  year: number
): Promise<CompletePreseasonSetupOutcome> {
  return guardedLifecycleWrite<CompletePreseasonSetupOutcome>(
    slug,
    { outcome: 'league-not-found' },
    (current) => {
      const status = current.status;
      if (status?.state !== 'preseason') {
        return { status: null, result: { outcome: 'not-in-preseason' } };
      }
      if (status.year !== year) {
        return { status: null, result: { outcome: 'year-mismatch' } };
      }

      const completedStatus: LeagueStatus = {
        state: 'preseason',
        year: status.year,
        setupComplete: true,
      };
      if (status.setupComplete === true && current.year === status.year) {
        return {
          status: null,
          result: { outcome: 'already-complete', year: status.year },
        };
      }
      return {
        status: completedStatus,
        project: () => ({
          outcome: status.setupComplete === true ? 'already-complete' : 'completed',
          year: status.year,
        }),
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
  return mutateRegistry<SeasonRolloverTransition>((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: { outcome: 'not-in-target-season', league: null } };
    const current = leagues[idx]!;
    if (current.status?.state !== 'season' || current.status.year !== year) {
      return { result: { outcome: 'not-in-target-season', league: current } };
    }
    const next: League = { ...current, status: { state: 'offseason' }, year };
    const updated = leagues.map((l, i) => (i === idx ? next : l));
    return { next: updated, result: { outcome: 'transitioned', league: next } };
  });
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
