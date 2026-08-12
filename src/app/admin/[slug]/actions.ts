'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  beginPreseasonTransition,
  completePreseasonSetup,
  getLeague,
  updateLeague,
  resetTestLeagueLifecycle,
  setTestLeagueLifecycleState,
  type TestLeagueLifecycleState,
} from '@/lib/leagueRegistry';
import { preseasonOwnerScope, savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import {
  listAppStateKeys,
  deleteAppState,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import { draftScope, type DraftState, type DraftPick } from '@/lib/draft';
import { cleanOwnerNames, findOwnerListProblem } from '@/lib/selectors/confirmedRoster';
import { TEST_LEAGUE_SLUG, type LeagueStatus } from '@/lib/league';
import type { AutoCompleteDraftResult, TestControlResult } from '@/lib/testLeagueControl';
import { requireAdminAction } from '@/lib/auth/requireAdminAction';
import teamsData from '@/data/teams.json';

/** The admin path the demo controls revalidate. */
const TEST_LEAGUE_ADMIN_PATH = `/admin/${TEST_LEAGUE_SLUG}`;

/**
 * Clear the demo-scoped app-state records keyed by one season year.
 *
 * Scoped claim: this owns the year-keyed cleanup for the two LIFECYCLE controls
 * only. Other demo helpers in this file (`resetTestDraft`, `migrateTestOwnersCsv`,
 * `autoCompleteDraft`) still build their keys from the `'test'` literal, so the
 * slug is NOT yet centralized file-wide — completing that is follow-up work, not
 * a claim this function makes.
 */
async function clearTestLeagueYear(year: number): Promise<void> {
  await Promise.all([
    deleteAppState(preseasonOwnerScope(TEST_LEAGUE_SLUG), String(year)),
    deleteAppState(`owners:${TEST_LEAGUE_SLUG}:${year}`, 'csv'),
    deleteAppState(draftScope(TEST_LEAGUE_SLUG), String(year)),
  ]);
}

/**
 * Post-commit cache work: standings (optionally) and the admin path.
 *
 * Returns whether it fully succeeded. Both calls go through the same Next
 * revalidation store, so a store fault fails both — which is why they share one
 * guard rather than the standings call having its own. Nothing here can undo the
 * committed lifecycle write, so a failure degrades freshness only.
 */
function revalidateAfterCommit(invalidateStandingsToo: boolean): boolean {
  try {
    if (invalidateStandingsToo) invalidateStandings(TEST_LEAGUE_SLUG);
    revalidatePath(TEST_LEAGUE_ADMIN_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Did the LIFECYCLE actually move?
 *
 * Compared field by field rather than by identity, and `setupComplete` is part
 * of the comparison on purpose: `decideTestLeagueStatus` rebuilds a preseason
 * status WITHOUT it, so re-requesting `preseason` on a league whose setup was
 * complete genuinely clears that flag. Reporting "Already in Preseason 2026"
 * there would be false.
 *
 * A `false` result does NOT mean nothing was written — `applyLifecycleStatus`
 * may still heal a desynchronized `league.year`. It means the lifecycle is where
 * it already was, which is the only thing the copy claims.
 */
function lifecycleUnchanged(previous: LeagueStatus | null, next: LeagueStatus): boolean {
  if (previous === null || previous.state !== next.state) return false;
  if (previous.state === 'offseason') return true;
  if (previous.year !== (next as { year: number }).year) return false;
  if (previous.state === 'preseason') {
    return (
      (previous.setupComplete === true) ===
      ((next as { setupComplete?: boolean }).setupComplete === true)
    );
  }
  return true;
}

/**
 * Set the lifecycle status of the demo league.
 *
 * "Structurally demo-only" here describes TARGET REACH, not authentication: the
 * authority takes no slug, so whoever calls this cannot steer it at a production
 * league. Authorization is a separate concern, enforced by the
 * `requireAdminAction` guard on the first line (PLATFORM-086F2H1SB).
 *
 * The two boundaries are distinct and both apply. F2H1SA made the middleware
 * matcher actually cover every `/admin` path, including static-looking ones —
 * that is route defense in depth. F2H1SB authorizes inside the action itself,
 * because Next treats an exported Server Action as a public endpoint reachable
 * by its action id, so routing is never the action's authority.
 *
 * PLATFORM-086F2H1T1: the year is derived and validated INSIDE the registry
 * transaction. This action no longer reads the league first and submits a year
 * computed from that snapshot — `getLeague` is React-`cache`d, so the old
 * read-then-write could derive from a memoized record taken outside the lock.
 *
 * PLATFORM-086F2H3B1 returns a typed result instead of `void`. That changes
 * nothing about authorization: `requireAdminAction` is still the first statement
 * and still THROWS before any read or write. (It must also stay the literal
 * first line of the body — an invariant test reads this file's source, and even
 * a comment above the guard call reads as the first statement.)
 */
export async function setTestLeagueStatus(
  state: TestLeagueLifecycleState
): Promise<TestControlResult> {
  await requireAdminAction('setTestLeagueStatus');
  const result = await setTestLeagueLifecycleState(state);

  // PLATFORM-086F2H3B1 — the registry's closed outcomes are translated into the
  // smaller client contract instead of being thrown away. They used to become
  // generic Server Action rejections, and in production the message is REDACTED,
  // so the operator could not learn a corrupt stored year from an unsupported
  // state from a missing league.
  if (result.outcome === 'league-not-found') {
    return { kind: 'refused', reason: 'league-not-found' };
  }
  if (result.outcome !== 'applied') {
    // A structurally unusable stored/derived year is a data-integrity fault
    // requiring intervention; the reset control derives nothing and is the
    // recovery path. Only the public slug and the typed outcome are logged —
    // never a record, request body, or exception text.
    console.error(
      JSON.stringify({
        event: 'lifecycle-action-refused',
        action: 'set-test-league-status',
        leagueSlug: TEST_LEAGUE_SLUG,
        reason: result.outcome,
      })
    );
    return {
      kind: 'refused',
      reason: result.outcome === 'unsupported-state' ? 'unsupported-state' : 'unusable-lifecycle',
    };
  }

  // Clear the demo-scoped state for the year the AUTHORITY resolved, never a
  // locally recomputed one. Sequenced strictly after the confirmed commit: the
  // registry write and these deletes are separate scopes and are NOT atomic
  // together, so racing them in one `Promise.all` could clear a year the
  // lifecycle write then refused to install.
  let clearedYear = false;
  if (result.status.state === 'preseason') {
    await clearTestLeagueYear(result.status.year);
    clearedYear = true;
  }

  // PLATFORM-086F2H1T2 — this control is now the demo league's ONLY
  // preseason→season path, so it inherits the standings invalidation the
  // season-transition cron used to perform for it.
  //
  // Without this the demo serves a stale PRESEASON standings snapshot:
  // `resolveStandingsYear` returns `status.year` for both preseason and season,
  // so the cache key is unchanged across the flip, and the entry is tag-only
  // with `revalidate: false`.
  //
  // Precisely: registry-walking refreshes (`/api/scores`, `/api/schedule`) do
  // bust `standings:test` for every league, so the snapshot MAY eventually be
  // invalidated — but that is opportunistic, not a lifecycle guarantee, and it
  // is not something a lifecycle transition may depend on. Slug-wide, matching
  // what the cron did; the year is not recomputed here.
  //
  // PLATFORM-086F2H3B1 — a throw HERE is not a failed transition. The registry
  // write is already committed, so the lifecycle moved and only cached views are
  // stale. Reporting it as a refusal would tell the operator a change did not
  // happen when it did — the same misattribution F2H2B removed from the rollover
  // cron, one layer up.
  //
  // BOTH revalidation calls are inside the guard, and that is the whole point.
  // They share one Next revalidation store, so the realistic fault — the store
  // missing or invalid — fails both. Guarding only `invalidateStandings` left
  // the unguarded `revalidatePath` to throw immediately afterwards, so
  // `cacheStale` could never reach a real operator; it was reachable only under
  // an injected tag-specific failure that does not occur in production.
  const cacheStale = !revalidateAfterCommit(result.status.state === 'season');

  const year = result.status.state === 'offseason' ? null : result.status.year;
  // `no-change` requires BOTH an unmoved lifecycle and no cleanup. A repeated
  // preseason request deletes that year's demo owners, roster CSV, and draft
  // above; telling the operator "Already in Preseason 2026" after destroying it
  // is the same falsehood `resetTestLeague` is deliberately never allowed to
  // tell.
  return lifecycleUnchanged(result.previousStatus, result.status) && !clearedYear
    ? { kind: 'no-change', state, year }
    : { kind: 'applied', state, year, cacheStale };
}

/**
 * Clear all draft state for the test league. Only valid for slug='test'.
 * Deletes every year key under draft:test and the corresponding owner CSV
 * written by draft confirmation (owners:test:{year} / 'csv').
 */
export async function resetTestDraft(): Promise<void> {
  await requireAdminAction('resetTestDraft');
  const scope = draftScope('test');
  const years = await listAppStateKeys(scope);
  await Promise.all(
    years.map(async (year) => {
      await deleteAppState(scope, year);
      // Also clear the owner CSV written when the draft was confirmed
      await deleteAppState(`owners:test:${year}`, 'csv');
    })
  );
  revalidatePath(TEST_LEAGUE_ADMIN_PATH);
}

/**
 * Hard-reset the demo league's lifecycle to `TEST_LEAGUE_RESET_YEAR`. The
 * authority synchronizes `league.year` in the same write.
 *
 * Also clears the demo-scoped preseason/owners/draft state for the DERIVED
 * SUCCESSOR year — the preseason a fresh dry run will use — so the next run
 * starts clean. Both years are derived, never written as literals here: the
 * cleanup year must follow the reset year, not a hardcoded pair.
 */
export async function resetTestLeague(): Promise<TestControlResult> {
  await requireAdminAction('resetTestLeague');
  const result = await resetTestLeagueLifecycle();
  if (result.outcome === 'league-not-found') {
    return { kind: 'refused', reason: 'league-not-found' };
  }
  // No further outcome check is needed OR possible: `TestLeagueResetOutcome` is
  // narrowed to `applied | league-not-found`, so TypeScript has proven the
  // commit landed. If a future change gives the reset a refusal path, this
  // becomes a compile error rather than a silently skipped cleanup.

  // Demo-SCOPED state only, for the season AFTER the one the authority just
  // installed — the preseason a fresh dry run will use. Derived from the
  // returned status rather than a literal, so it cannot drift from
  // `TEST_LEAGUE_RESET_YEAR`.
  //
  // PLATFORM-086F2H1T1 removed a `deleteAppState('schedule-probe', <year>)`
  // from this list. `schedule-probe/<year>` is keyed by YEAR ALONE
  // (`src/lib/scheduleProbe.ts`) and is shared by every league, so resetting the
  // sandbox disarmed that year's probe for production leagues and forced the
  // year back from weekly maintenance to the daily season-transition cron. A
  // demo reset must never mutate schedule state real leagues depend on.
  // `resetTestLeagueLifecycle` always installs a season status, so this is a
  // narrowing assertion rather than a conditional: an unexpected shape throws
  // instead of silently skipping the cleanup the function promises.
  if (result.status.state !== 'season') {
    throw new Error('Unable to reset test league');
  }
  await clearTestLeagueYear(result.status.year + 1);

  // The reset installs `season(RESET_YEAR)` from ANY prior state, so it is the
  // same class of transition `setTestLeagueStatus` invalidates for — and it has
  // the same hazard: `resolveStandingsYear` returns `status.year` for preseason
  // AND season, so a reset from `preseason(2025)` leaves the cache key unchanged
  // and keeps serving the preseason snapshot. It previously invalidated nothing
  // while this action reported `cacheStale: false`, which asserted a freshness
  // it had not established.
  const cacheStale = !revalidateAfterCommit(true);

  // Always `applied`, never `no-change`: the reset ALSO clears demo-scoped
  // preseason/owners/draft state, so telling an operator "already in Season
  // 2025" when that cleanup just ran would be false. `TestLeagueResetOutcome`
  // deliberately carries no `previousStatus` for the same reason.
  return { kind: 'applied', state: 'season', year: result.status.year, cacheStale };
}

/** Transition a league from offseason to preseason and redirect to the setup page. */
export async function beginPreseason(slug: string): Promise<void> {
  await requireAdminAction('beginPreseason');
  const result = await beginPreseasonTransition(slug);
  if (result.outcome === 'league-not-found') throw new Error('League not found');
  if (result.outcome === 'not-in-offseason') throw new Error('League is not in offseason');
  if (result.outcome === 'unusable-stored-year' || result.outcome === 'unusable-next-year') {
    // An unusable year is a data-integrity fault requiring intervention, so it
    // is error-level. The public league slug is the only correlation field;
    // raw records, request bodies, and exception text never enter the event.
    console.error(
      JSON.stringify({
        event: 'lifecycle-action-refused',
        action: 'begin-preseason',
        leagueSlug: slug,
        reason: result.outcome,
      })
    );
    throw new Error('Unable to begin preseason');
  }
  // Offseason→preseason changes the league's standings surface (prior-season
  // final → preseason owner list). Bust its cached snapshots (umbrella, all
  // years) so the public page reflects the new lifecycle state. Before the
  // redirect, which throws.
  invalidateStandings(slug);
  redirect(`/admin/${slug}/preseason`);
}

/** Persist the commissioner's choice of how teams will be assigned this preseason. */
export async function setAssignmentMethod(slug: string, method: 'draft' | 'manual'): Promise<void> {
  await requireAdminAction('setAssignmentMethod');
  await updateLeague(slug, { assignmentMethod: method });
  revalidatePath(`/admin/${slug}/preseason`);
}

/** Persist the confirmed owner list for the preseason and redirect back to setup. */
export async function confirmPreseasonOwners(
  slug: string,
  year: number,
  owners: string[]
): Promise<void> {
  await requireAdminAction('confirmPreseasonOwners');
  // PLATFORM-092 — validate what the READER will see, and store names exactly as
  // typed. Owner identity is the raw string everywhere downstream, so nothing is
  // folded or de-duplicated on the commissioner's behalf: a repeated name is a
  // mistake to report, not something to quietly collapse into a shorter roster
  // than they entered.
  const problem = findOwnerListProblem(owners);
  if (problem) throw new Error(`Owners cannot be confirmed — ${problem}`);
  await savePreseasonOwners(slug, year, cleanOwnerNames(owners));
  // Preseason owners feed the preseason standings snapshot; bust this league's
  // cached standings so the confirmed roster shows without a hard refresh.
  // Before the redirect, which throws.
  invalidateStandings(slug, year);
  redirect(`/admin/${slug}/preseason`);
}

/** Mark preseason setup as complete. Season transition happens automatically via cron. */
export async function completeSetup(slug: string, year: number): Promise<void> {
  await requireAdminAction('completeSetup');
  const result = await completePreseasonSetup(slug, year);
  if (result.outcome === 'league-not-found') throw new Error('League not found');
  if (result.outcome === 'not-in-preseason') throw new Error('League is not in preseason');
  if (result.outcome === 'year-mismatch') {
    // A stale form is an expected concurrency refusal, so it is warning-level.
    console.warn(
      JSON.stringify({
        event: 'lifecycle-action-refused',
        action: 'complete-preseason-setup',
        leagueSlug: slug,
        reason: result.outcome,
      })
    );
  }
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/admin/${slug}`, 'layout');
  revalidatePath(`/admin/${slug}/preseason`);
  redirect(`/admin/${slug}`);
}

/**
 * Copy owners CSV from one year key to the next. Only valid for slug='test'.
 * Useful when draft was confirmed before the preseason year bump.
 */
export async function migrateTestOwnersCsv(fromYear: number, toYear: number): Promise<string> {
  await requireAdminAction('migrateTestOwnersCsv');
  const record = await getAppState<string>(`owners:test:${fromYear}`, 'csv');
  if (!record?.value) {
    return `No owners CSV found at owners:test:${fromYear}`;
  }
  await setAppState(`owners:test:${toYear}`, 'csv', record.value);
  revalidatePath(TEST_LEAGUE_ADMIN_PATH);
  return `Migrated owners CSV from ${fromYear} → ${toYear} (${record.value.length} chars)`;
}

/**
 * Auto-complete the test league draft by filling all remaining picks randomly,
 * then writing the owners CSV. Test league only.
 *
 * Returns the number of picks that were auto-filled.
 */
export async function autoCompleteDraft(): Promise<AutoCompleteDraftResult> {
  await requireAdminAction('autoCompleteDraft');
  const league = await getLeague('test');
  if (!league) return { kind: 'refused', reason: 'league-not-found' };

  const year =
    league.status?.state === 'preseason' || league.status?.state === 'season'
      ? league.status.year
      : league.year;

  const record = await getAppState<DraftState>(draftScope('test'), String(year));
  if (!record?.value) return { kind: 'refused', reason: 'no-draft' };

  const draft = record.value;
  if (draft.phase === 'complete') return { kind: 'refused', reason: 'already-complete' };
  if (!draft.settings.draftOrder.length) return { kind: 'refused', reason: 'no-draft-order' };

  // All FBS teams from the catalog (same filter as the main draft route)
  const allTeams = (teamsData as { items: { school: string }[] }).items
    .map((t) => t.school)
    .filter((s) => s !== 'NoClaim');

  const pickedTeams = new Set(draft.picks.map((p) => p.team.toLowerCase()));
  const available = allTeams.filter((t) => !pickedTeams.has(t.toLowerCase()));

  // Shuffle available teams (Fisher-Yates)
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j]!, available[i]!];
  }

  // Calculate total picks: totalRounds * ownerCount
  const n = draft.settings.draftOrder.length;
  const totalPicks = draft.settings.totalRounds * n;
  const remainingSlots = totalPicks - draft.picks.length;

  if (remainingSlots <= 0) return { kind: 'refused', reason: 'slots-filled' };
  if (available.length < remainingSlots) {
    return {
      kind: 'refused-not-enough-teams',
      available: available.length,
      needed: remainingSlots,
    };
  }

  // Fill remaining picks using snake draft order
  const newPicks: DraftPick[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < remainingSlots; i++) {
    const pickIndex = draft.currentPickIndex + i;
    const round = Math.floor(pickIndex / n);
    const posInRound = pickIndex % n;
    const ownerIdx = round % 2 === 0 ? posInRound : n - 1 - posInRound;
    const owner = draft.settings.draftOrder[ownerIdx]!;

    newPicks.push({
      pickNumber: pickIndex + 1,
      round,
      roundPick: posInRound,
      owner,
      team: available[i]!,
      pickedAt: now,
      autoSelected: true,
    });
  }

  const allPicks = [...draft.picks, ...newPicks];

  // Write completed draft state
  const completed: DraftState = {
    ...draft,
    picks: allPicks,
    currentPickIndex: totalPicks,
    phase: 'complete',
    timerState: 'off',
    timerExpiresAt: null,
    updatedAt: now,
  };
  await setAppState<DraftState>(draftScope('test'), String(year), completed);

  // Write owners CSV (same format as confirm route)
  const csvLines = ['team,owner'];
  for (const pick of allPicks) {
    const team =
      pick.team.includes(',') || pick.team.includes('"')
        ? `"${pick.team.replace(/"/g, '""')}"`
        : pick.team;
    const owner =
      pick.owner.includes(',') || pick.owner.includes('"')
        ? `"${pick.owner.replace(/"/g, '""')}"`
        : pick.owner;
    csvLines.push(`${team},${owner}`);
  }

  // Append NoClaim rows for undrafted teams
  const draftedLower = new Set(allPicks.map((p) => p.team.toLowerCase()));
  for (const teamName of allTeams) {
    if (!draftedLower.has(teamName.toLowerCase())) {
      const field =
        teamName.includes(',') || teamName.includes('"')
          ? `"${teamName.replace(/"/g, '""')}"`
          : teamName;
      csvLines.push(`${field},NoClaim`);
    }
  }

  await setAppState(`owners:test:${year}`, 'csv', csvLines.join('\n'));

  revalidatePath(TEST_LEAGUE_ADMIN_PATH);
  return { kind: 'completed', picks: newPicks.length };
}
