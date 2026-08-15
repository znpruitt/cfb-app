import { NextResponse } from 'next/server';

import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState, withAppStateKeyTransaction } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { getConfirmedRoster } from '@/lib/server/confirmedRosterStore';
import {
  draftOwnersMatchRoster,
  selectConfirmedRoster,
  type ConfirmedRoster,
} from '@/lib/selectors/confirmedRoster';
import { preseasonOwnerScope } from '@/lib/preseasonOwnerStore';
import {
  type DraftState,
  type DraftSettings,
  type DraftPhase,
  type DraftPick,
  defaultDraftSettings,
  draftScope,
  getDraftEligibleTeams,
} from '@/lib/draft';
import teamsData from '@/data/teams.json';
import type { TeamCatalogItem } from '@/lib/teamIdentity';

type TeamsJson = { items: TeamCatalogItem[] };

/** Derive which owner picks at a given 0-based pickIndex in a snake draft. */
function getPickOwner(draftOrder: string[], pickIndex: number): string {
  const n = draftOrder.length;
  const round = Math.floor(pickIndex / n);
  const posInRound = pickIndex % n;
  const ownerIdx = round % 2 === 0 ? posInRound : n - 1 - posInRound;
  return draftOrder[ownerIdx]!;
}

/**
 * A valid draftOrder is a one-to-one permutation of the owner set: same length,
 * no duplicates, every owner present, and no extra/foreign names. A `Set`-only
 * "same unique names" check is insufficient — `['Alice','Bob','Alice']` would
 * pass it, but the longer array desyncs `draftOrder.length` (used to derive the
 * picker) from `owners.length` (used for total picks/rounds), corrupting pick
 * ownership and leaving the draft unconfirmable.
 */
function isDraftOrderPermutationOfOwners(draftOrder: string[], owners: string[]): boolean {
  if (draftOrder.length !== owners.length) return false;
  const orderSet = new Set(draftOrder);
  if (orderSet.size !== draftOrder.length) return false; // duplicates
  return owners.every((o) => orderSet.has(o));
}

export const dynamic = 'force-dynamic';

/** A refusal decided inside a transaction — see `applyTimerAction`. */
type ExpiryRefusal = { error: string; status: number };

/**
 * The PUT handler's refusal shape. Not every body is `{ error }` — several carry
 * a `field` or `reason` — so the whole body travels, not just a message.
 *
 * Returned rather than thrown, so the transaction commits nothing and finishes
 * cleanly. `NextResponse` cannot be returned from inside the callback, which is
 * why every validation in the handler yields one of these and the caller maps it
 * back to a response.
 */
type PutRefusal = { body: Record<string, unknown>; status: number };
type PutOutcome = PutRefusal | { ok: true; draft: DraftState };

/**
 * PLATFORM-102 — the timer state machine, named and lifted out of the handler.
 *
 * Covers every action, not just `expire`. It was extracted while there were two
 * call sites (a serialized fast path and a legacy one) to stop them drifting; the
 * whole handler is serialized now, so there is a single call site and this exists
 * for readability — the state machine is worth naming on its own.
 *
 * Pure: takes a draft, returns either a refusal or the next draft. It does not
 * stamp `updatedAt` — the caller does that immediately before its write, as
 * before.
 */
function applyTimerAction(
  draft: DraftState,
  action: 'start' | 'pause' | 'resume' | 'expire'
): ExpiryRefusal | DraftState {
  if (action === 'start' || action === 'resume') {
    if (draft.phase !== 'live') {
      return { error: 'Timer can only be started/resumed when draft is live', status: 422 };
    }
    const { pickTimerSeconds } = draft.settings;
    if (!pickTimerSeconds) {
      return { error: 'No pick timer configured', status: 422 };
    }
    return {
      ...draft,
      timerState: 'running',
      timerExpiresAt: new Date(Date.now() + pickTimerSeconds * 1000).toISOString(),
    };
  }

  if (action === 'pause') {
    return { ...draft, timerState: 'paused', timerExpiresAt: null };
  }

  if (action !== 'expire') {
    return { error: `Unknown timerAction: "${action}"`, status: 400 };
  }

  // Accept expire from live phase (normal expiry) or paused+expired phase (commissioner
  // clicked auto-pick in the pause-and-prompt overlay)
  const isLiveExpire = draft.phase === 'live';
  const isPausedExpire = draft.phase === 'paused' && draft.timerState === 'expired';

  if (!isLiveExpire && !isPausedExpire) {
    return {
      error: `Timer expire only valid when draft is live or paused-expired (phase: ${draft.phase})`,
      status: 422,
    };
  }

  // For live phase, validate the timer was actually running and has elapsed.
  //
  // Under the transaction this is also what makes a buzzer-beater pick win
  // correctly: a manual pick that commits first refreshes `timerExpiresAt`, so
  // this read (now taken under the lock) sees a future expiry and refuses with
  // "Timer has not expired yet" instead of overwriting the pick.
  if (isLiveExpire) {
    if (!draft.timerExpiresAt) {
      return { error: 'No active timer — timerExpiresAt is null', status: 422 };
    }
    if (new Date(draft.timerExpiresAt) > new Date()) {
      return { error: 'Timer has not expired yet', status: 422 };
    }
  }

  // Paused-expired phase means the commissioner is explicitly requesting auto-pick
  // from the pause-and-prompt overlay. Live phase means the timer expired naturally.
  // Natural expiry always pauses and prompts — no automatic auto-pick.
  if (isLiveExpire) {
    // Timer expired naturally — always pause and prompt the commissioner
    return {
      ...draft,
      phase: 'paused',
      timerState: 'expired',
      timerExpiresAt: null,
    };
  }

  // isPausedExpire — commissioner clicked "Auto-pick" from prompt overlay.
  // Select a random available team.
  const { items } = teamsData as TeamsJson;
  const fbsTeams = getDraftEligibleTeams(items);
  const pickedLower = new Set(draft.picks.flatMap((p) => (p.team ? [p.team.toLowerCase()] : [])));

  const available = fbsTeams.filter((t) => !pickedLower.has(t.school.toLowerCase()));

  const bestTeam =
    available.length > 0 ? available[Math.floor(Math.random() * available.length)] : undefined;
  if (!bestTeam) {
    return { error: 'No teams available for auto-pick', status: 422 };
  }

  const totalPicks = draft.settings.totalRounds * draft.owners.length;
  const n = draft.owners.length;
  const round = Math.floor(draft.currentPickIndex / n);
  const roundPick = draft.currentPickIndex % n;
  const owner = getPickOwner(draft.settings.draftOrder, draft.currentPickIndex);

  const pick: DraftPick = {
    pickNumber: draft.currentPickIndex + 1,
    round,
    roundPick,
    owner,
    team: bestTeam.school,
    pickedAt: new Date().toISOString(),
    autoSelected: true,
  };

  const newPickIndex = draft.currentPickIndex + 1;
  const isComplete = newPickIndex >= totalPicks;
  const { pickTimerSeconds } = draft.settings;

  // Honor the same server-authoritative round-boundary pause as the manual
  // pick route: an auto-pick that completes a round pauses for the next one.
  const atRoundBoundary = !isComplete && newPickIndex > 0 && newPickIndex % n === 0;

  if (isComplete) {
    return {
      ...draft,
      picks: [...draft.picks, pick],
      currentPickIndex: newPickIndex,
      phase: 'complete',
      timerState: 'off',
      timerExpiresAt: null,
    };
  }
  if (atRoundBoundary) {
    return {
      ...draft,
      picks: [...draft.picks, pick],
      currentPickIndex: newPickIndex,
      phase: 'paused',
      timerState: pickTimerSeconds ? 'paused' : 'off',
      timerExpiresAt: null,
    };
  }
  return {
    ...draft,
    picks: [...draft.picks, pick],
    currentPickIndex: newPickIndex,
    phase: 'live',
    timerState: pickTimerSeconds ? 'running' : 'off',
    timerExpiresAt: pickTimerSeconds
      ? new Date(Date.now() + pickTimerSeconds * 1000).toISOString()
      : null,
  };
}

const VALID_PHASE_TRANSITIONS: Partial<Record<DraftPhase, DraftPhase[]>> = {
  setup: ['settings'],
  settings: ['preview', 'live', 'setup'],
  preview: ['live', 'settings'],
  live: ['paused', 'complete', 'setup'],
  paused: ['live', 'complete', 'setup'],
};

function isValidTransition(from: DraftPhase, to: DraftPhase): boolean {
  return VALID_PHASE_TRANSITIONS[from]?.includes(to) ?? false;
}

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

// ---------------------------------------------------------------------------
// GET — read current draft state (public)
// ---------------------------------------------------------------------------
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const { slug, year: yearParam } = await params;

  // Password-gate: blend unauthorized access into the same 404 shape unknown
  // leagues return, so API callers can't distinguish "passworded" from "missing".
  // Pass req so the gate honors ADMIN_API_TOKEN in addition to Clerk session.
  if (!(await isAuthorizedForLeague(slug, req))) {
    return new Response(null, { status: 404 });
  }

  const year = parseYear(yearParam);
  if (!year) {
    return NextResponse.json({ error: 'year must be an integer >= 2000' }, { status: 400 });
  }

  const league = await getLeague(slug);
  if (!league) {
    return NextResponse.json({ error: `League "${slug}" not found` }, { status: 404 });
  }

  const record = await getAppState<DraftState>(draftScope(slug), String(year));
  if (!record?.value) {
    return NextResponse.json(
      { error: `No draft found for ${slug} season ${year}` },
      { status: 404 }
    );
  }
  return NextResponse.json({ draft: record.value });
}

// ---------------------------------------------------------------------------
// POST — create new draft (admin-gated)
// ---------------------------------------------------------------------------
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug, year: yearParam } = await params;

  const year = parseYear(yearParam);
  if (!year) {
    return NextResponse.json({ error: 'year must be an integer >= 2000' }, { status: 400 });
  }

  const league = await getLeague(slug);
  if (!league) {
    return NextResponse.json({ error: `League "${slug}" not found` }, { status: 404 });
  }

  const existing = await getAppState<DraftState>(draftScope(slug), String(year));
  if (existing?.value) {
    return NextResponse.json(
      { error: `Draft for ${slug} ${year} already exists`, alreadyExists: true },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const { settings: rawSettings } = body as { settings?: unknown };

  // PLATFORM-092 — owners must be confirmed before a draft can occur, and the
  // draft TAKES them from the confirmed roster rather than accepting them from
  // the request.
  //
  // The body used to supply them, checked only for "two non-empty strings". That
  // is what let `/league/[slug]/draft/setup` seed a draft from the PRIOR
  // season's archive owners, and it is why the draft record could hold a list
  // nothing else in the app agreed with. Reading the roster here makes that
  // unrepresentable instead of merely detected: there is no submitted list to
  // disagree with.
  const roster = await getConfirmedRoster(slug, year);
  if (!roster.isConfirmed) {
    return NextResponse.json(
      {
        error: `Confirm the ${year} owners for "${slug}" before creating a draft`,
        reason: 'owners-not-confirmed',
      },
      // 422, not 409: the request is well-formed and no conflicting resource
      // exists — a precondition on league state is unmet. `DraftSetupShell`
      // treats 409 as "already exists, carry on", so a 409 here would send it
      // into a PUT against a draft that does not exist.
      { status: 422 }
    );
  }
  const ownerNames = roster.owners;

  // Validate and merge provided settings
  let settings: DraftSettings = defaultDraftSettings(ownerNames);
  if (rawSettings !== undefined) {
    if (typeof rawSettings !== 'object' || rawSettings === null) {
      return NextResponse.json(
        { error: 'settings must be an object', field: 'settings' },
        { status: 400 }
      );
    }
    const s = rawSettings as Partial<DraftSettings>;

    if (s.style !== undefined && s.style !== 'snake') {
      return NextResponse.json(
        { error: "settings.style must be 'snake'", field: 'settings.style' },
        { status: 400 }
      );
    }
    if (
      s.pickTimerSeconds !== undefined &&
      s.pickTimerSeconds !== null &&
      (typeof s.pickTimerSeconds !== 'number' || s.pickTimerSeconds <= 0)
    ) {
      return NextResponse.json(
        {
          error: 'settings.pickTimerSeconds must be null or a positive number',
          field: 'settings.pickTimerSeconds',
        },
        { status: 400 }
      );
    }
    if (
      s.totalRounds !== undefined &&
      (typeof s.totalRounds !== 'number' || !Number.isInteger(s.totalRounds) || s.totalRounds < 1)
    ) {
      return NextResponse.json(
        { error: 'settings.totalRounds must be a positive integer', field: 'settings.totalRounds' },
        { status: 400 }
      );
    }
    if (s.totalRounds !== undefined && s.totalRounds >= 1) {
      const { items } = teamsData as TeamsJson;
      const fbsCount = getDraftEligibleTeams(items).length;
      const maxRounds = Math.floor(fbsCount / ownerNames.length);
      if (s.totalRounds > maxRounds) {
        return NextResponse.json(
          {
            error: `totalRounds cannot exceed ${maxRounds} (${fbsCount} FBS teams ÷ ${ownerNames.length} owners)`,
            field: 'settings.totalRounds',
          },
          { status: 400 }
        );
      }
    }
    // Validate draftOrder is a one-to-one permutation of owners when provided.
    if (s.draftOrder !== undefined) {
      if (!Array.isArray(s.draftOrder)) {
        return NextResponse.json(
          { error: 'settings.draftOrder must be an array', field: 'settings.draftOrder' },
          { status: 400 }
        );
      }
      if (!isDraftOrderPermutationOfOwners(s.draftOrder, ownerNames)) {
        return NextResponse.json(
          {
            error: 'draftOrder must contain exactly the same owners as the owners array',
            field: 'settings.draftOrder',
          },
          { status: 400 }
        );
      }
    }

    settings = { ...settings, ...s, style: 'snake' };
  }

  // Determine initial phase — promote to 'preview' if scheduledAt is a future date
  const scheduledAt = settings.scheduledAt;
  const initialPhase: DraftPhase =
    scheduledAt && new Date(scheduledAt) > new Date() ? 'preview' : 'setup';

  const now = new Date().toISOString();
  const draft: DraftState = {
    leagueSlug: slug,
    year,
    phase: initialPhase,
    owners: ownerNames,
    settings,
    picks: [],
    currentPickIndex: 0,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await setAppState<DraftState>(draftScope(slug), String(year), draft);

  return NextResponse.json({ draft }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update draft state (admin-gated)
// ---------------------------------------------------------------------------
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug, year: yearParam } = await params;

  const year = parseYear(yearParam);
  if (!year) {
    return NextResponse.json({ error: 'year must be an integer >= 2000' }, { status: 400 });
  }

  const league = await getLeague(slug);
  if (!league) {
    return NextResponse.json({ error: `League "${slug}" not found` }, { status: 404 });
  }

  // PLATFORM-102 — the WHOLE handler runs inside one key transaction.
  //
  // Earlier versions serialized only a narrow slice (first `expire`, then any
  // timer-only request) and left the rest on an unlocked read-then-write. Each
  // carve-out required correctly predicting which field COMBINATIONS real clients
  // send, and that prediction was wrong three times running. The last miss
  // mattered: `DraftBoardClient` sends `{ phase: 'live', timerAction: 'start' }`
  // together from the round-boundary resume, from Resume, and from Start round —
  // so "Start round" still overwrote any pick that committed while it worked,
  // which is the exact failure this slice exists to close, on the hottest path of
  // draft night.
  //
  // Serializing the whole handler deletes the prediction. There is no remaining
  // combination to be wrong about.
  //
  // NOTHING POOL-BACKED MAY RUN INSIDE THE CALLBACK. The transaction holds one of
  // only three pooled clients (`appStateStore.ts` -> `max: 3`, no
  // `connectionTimeoutMillis`) for its whole duration, while same-key waiters hold
  // one each blocked on the advisory lock — so a nested pooled read needs a client
  // that can never be freed, deadlocking database access process-wide. The body
  // and the confirmed roster are therefore read BEFORE the lock.
  let body: unknown;
  let bodyParseFailed = false;
  try {
    body = await req.json();
  } catch {
    bodyParseFailed = true;
  }
  if (bodyParseFailed) {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  // `JSON.parse('null')` succeeds, so a literal `null` body arrives here as null
  // and would throw on destructuring — a 500 where the draft-state guards should
  // answer 404/422. Normalise it.
  const { owners, settings, phase, timerAction } = (body ?? {}) as {
    owners?: unknown;
    settings?: unknown;
    phase?: unknown;
    timerAction?: unknown;
  };

  const outcome = await withAppStateKeyTransaction<PutOutcome>(
    draftScope(slug),
    String(year),
    async (txn): Promise<PutOutcome> => {
      const record = await txn.read<DraftState>();
      if (!record?.value) {
        return { body: { error: `No draft found for ${slug} ${year}` }, status: 404 };
      }

      const original = record.value;

      // PLATFORM-102 round 3 — the confirmed roster is read INSIDE the lock.
      //
      // Round 2 hoisted this above the transaction on the belief that any read
      // there would need a second pooled connection and deadlock. That was wrong:
      // `txn.readKey` runs on the transaction's OWN client and takes no extra
      // connection, which is exactly what `confirm/route.ts` already relies on.
      // The hoist widened a real window — the roster was read BEFORE an unbounded
      // wait for the lock, and this handler both writes that owner set into the
      // draft and freezes it at go-live, while the staleness gate compared stale
      // against stale and therefore passed.
      //
      // Locking both roster keys closes it. Order is ascending as the store
      // requires (`draft:` < `owners:` < `preseason-owners:`), so no cycle.
      //
      // PLATFORM-092 — still ONE read per request, shared by the owners branch and
      // the start transition; reading twice let a confirmation landing between them
      // 422 a draft the same request had just reconciled. Lazy, so a PUT touching
      // neither branch pays nothing — and unlike the round-2 version there is no
      // "which branches might need it" prediction to get wrong.
      let rosterMemo: ConfirmedRoster | null = null;
      const loadRoster = async (): Promise<ConfirmedRoster> => {
        if (rosterMemo) return rosterMemo;
        await txn.lockKey(`owners:${slug}:${year}`, 'csv');
        await txn.lockKey(preseasonOwnerScope(slug), String(year));
        const confirmedRecord = await txn.readKey<unknown>(preseasonOwnerScope(slug), String(year));
        const ownersCsvRecord = await txn.readKey<unknown>(`owners:${slug}:${year}`, 'csv');
        rosterMemo = selectConfirmedRoster({
          confirmedOwnersRecord: confirmedRecord?.value ?? null,
          ownersCsvRecord: ownersCsvRecord?.value ?? null,
        });
        return rosterMemo;
      };

      // Once the draft has started, the owner set/order and configured round count are
      // locked: confirmation derives its expected pick count and per-owner counts from
      // these, so a post-start mutation could make a finished roster unconfirmable.
      const draftStarted =
        original.picks.length > 0 ||
        original.phase === 'live' ||
        original.phase === 'paused' ||
        original.phase === 'complete';

      let draft: DraftState = { ...original };

      // Update owners
      //
      // PLATFORM-092 — the body's `owners` is IGNORED. Pre-start, a draft's owners
      // are the confirmed roster; the request cannot propose a different set,
      // because the only screen that changes owners is the confirmation page and
      // this record is a copy of what it wrote. Callers still send the field (the
      // setup shell does), so it stays accepted and simply does not decide anything.
      if (owners !== undefined) {
        if (!Array.isArray(owners) || owners.length < 2) {
          return {
            body: { error: 'owners must be an array of at least 2 owner names', field: 'owners' },
            status: 400,
          };
        }
        const proposed = owners.filter(
          (o): o is string => typeof o === 'string' && o.trim().length > 0
        );
        if (proposed.length < 2) {
          return {
            body: { error: 'owners must contain at least 2 non-empty strings', field: 'owners' },
            status: 400,
          };
        }

        // A started draft keeps its pre-existing contract exactly: the owner set is
        // frozen, and an attempt to change it is refused with 409. This precedes the
        // roster read deliberately — that refusal is the more specific one, callers
        // depend on its status, and a running draft's owners are frozen regardless of
        // what the roster now says.
        const attemptsChange =
          proposed.length !== original.owners.length ||
          proposed.some((name, i) => name !== original.owners[i]);
        if (draftStarted) {
          if (attemptsChange) {
            return {
              body: {
                error:
                  'owners cannot be changed after the draft has started. Reset or reopen the draft to change the owner set or order.',
                field: 'owners',
              },
              status: 409,
            };
          }
          // Identical to what is stored — nothing to do.
        } else {
          const roster = await loadRoster();
          if (!roster.isConfirmed) {
            return {
              body: {
                error: `Confirm the ${year} owners for "${slug}" before editing this draft`,
                reason: 'owners-not-confirmed',
              },
              status: 422,
            };
          }
          const ownerNames = roster.owners;
          const ownersChanged = !draftOwnersMatchRoster(original.owners, ownerNames);
          draft = { ...draft, owners: ownerNames };

          // PLATFORM-092 — `owners` and `settings.draftOrder` are the two arrays the
          // engine derives from: `getPickOwner` indexes the order while total picks are
          // sized from the owner set. Resizing one without the other yields a draft
          // that can never be confirmed ("Pick counts are uneven"), and an owners-only
          // request carries no `settings` to fix it. Re-derive the order here; a
          // request that also supplies `draftOrder` overwrites this below, validated
          // against the set we just stored.
          if (ownersChanged) {
            draft = { ...draft, settings: { ...draft.settings, draftOrder: [...ownerNames] } };
          }
        }
      }

      // Update settings — validate every provided field BEFORE merging so a malformed
      // or rejected request never mutates the persisted draft.
      if (settings !== undefined && typeof settings === 'object' && settings !== null) {
        const incoming = settings as Partial<DraftSettings>;

        // draftOrder validation (parity with POST):
        //  1. must be an array — malformed values 400, never crash;
        //  2. locked once the draft has started (see draftStarted above) — snake
        //     pick-owner assignment derives from settings.draftOrder, so a mid-draft
        //     change reassigns remaining picks to the wrong owners;
        //  3. must contain exactly the owner set (same rule POST enforces).
        if (incoming.draftOrder !== undefined) {
          if (!Array.isArray(incoming.draftOrder)) {
            return {
              body: { error: 'settings.draftOrder must be an array', field: 'settings.draftOrder' },
              status: 400,
            };
          }
          const incomingOrder = incoming.draftOrder;
          const originalOrder = original.settings.draftOrder;
          const orderChanged =
            incomingOrder.length !== originalOrder.length ||
            incomingOrder.some((name, i) => name !== originalOrder[i]);
          if (draftStarted && orderChanged) {
            return {
              body: {
                error:
                  'draftOrder cannot be changed after the draft has started. Reset or reopen the draft to change the draft order.',
                field: 'settings.draftOrder',
              },
              status: 409,
            };
          }
          // Effective owner set: owners may have just been updated above for a
          // not-yet-started draft; draft.owners reflects that.
          if (!isDraftOrderPermutationOfOwners(incomingOrder, draft.owners)) {
            return {
              body: {
                error: 'draftOrder must contain exactly the same owners as the owners array',
                field: 'settings.draftOrder',
              },
              status: 400,
            };
          }
        }

        // totalRounds validation (parity with POST):
        //  1. must be a positive integer — strings/zero/negative/non-integers 400;
        //  2. locked once the draft has started;
        //  3. capped at the catalog maximum full rounds.
        if (incoming.totalRounds !== undefined) {
          if (
            typeof incoming.totalRounds !== 'number' ||
            !Number.isInteger(incoming.totalRounds) ||
            incoming.totalRounds < 1
          ) {
            return {
              body: {
                error: 'settings.totalRounds must be a positive integer',
                field: 'settings.totalRounds',
              },
              status: 400,
            };
          }
          if (draftStarted && incoming.totalRounds !== original.settings.totalRounds) {
            return {
              body: {
                error:
                  'totalRounds cannot be changed after the draft has started. Reset or reopen the draft to change the round count.',
                field: 'settings.totalRounds',
              },
              status: 409,
            };
          }
          const { items } = teamsData as TeamsJson;
          const fbsCount = getDraftEligibleTeams(items).length;
          const ownerCount = draft.owners.length;
          if (ownerCount > 0) {
            const maxRounds = Math.floor(fbsCount / ownerCount);
            if (incoming.totalRounds > maxRounds) {
              return {
                body: {
                  error: `totalRounds cannot exceed ${maxRounds} (${fbsCount} FBS teams ÷ ${ownerCount} owners)`,
                  field: 'settings.totalRounds',
                },
                status: 400,
              };
            }
          }
        }

        draft = {
          ...draft,
          settings: {
            ...draft.settings,
            ...incoming,
            // Ensure style is always 'snake'
            style: 'snake',
          },
        };
      }

      // Phase transition
      if (phase !== undefined) {
        if (typeof phase !== 'string') {
          return { body: { error: 'phase must be a string', field: 'phase' }, status: 400 };
        }
        const targetPhase = phase as DraftPhase;

        if (!isValidTransition(draft.phase, targetPhase)) {
          return {
            body: {
              error: `Cannot transition from '${draft.phase}' to '${targetPhase}'`,
              field: 'phase',
            },
            status: 422,
          };
        }

        // PLATFORM-092 — the draft that RUNS must be for the confirmed roster.
        //
        // Below `isValidTransition` deliberately: a `complete` draft asked to go
        // live is an illegal transition, and answering it with "the roster has
        // changed — reopen draft settings" sends the operator to a screen that
        // cannot help. The specific diagnosis belongs only on requests the
        // transition itself permits, and this ordering also skips the store read on
        // every rejected path.
        //
        // Every write above takes owners from the roster, so a draft only goes stale
        // when the roster changes AFTER the last settings save — and
        // `DraftSetupShell.handleStartDraft` sends `{ phase: 'live' }` alone, so
        // nothing re-reads it on the way in.
        //
        // This REFUSES rather than silently re-seeding: starting is the moment the
        // owner set and pick order freeze, and quietly regenerating both under the
        // commissioner is a worse surprise than being told to reopen settings. The
        // remedy works — the setup page shows the current roster, and saving there
        // updates the draft.
        //
        // `paused → live` is exempt: that draft is already running with picks against
        // a frozen owner set, and re-checking would strand it mid-draft.
        if (targetPhase === 'live' && draft.phase !== 'paused') {
          const roster = await loadRoster();
          // Two different causes, two different remedies. An unconfirmed roster is
          // not a roster that CHANGED — telling the operator to go pick up a change
          // that never happened points them at the wrong screen. This ordering also
          // keeps the comparison from being asked a question it answers badly:
          // `draftOwnersMatchRoster([], [])` is true, so an unconfirmed league would
          // otherwise pass the gate outright.
          if (!roster.isConfirmed) {
            return {
              body: {
                error: `Confirm the ${year} owners for "${slug}" before starting this draft`,
                field: 'phase',
                reason: 'owners-not-confirmed',
              },
              status: 422,
            };
          }
          if (!draftOwnersMatchRoster(draft.owners, roster.owners)) {
            return {
              body: {
                error: `the ${year} roster for "${slug}" has changed since this draft was set up — reopen draft settings to pick it up, then start`,
                field: 'phase',
                reason: 'draft-owners-stale',
              },
              status: 422,
            };
          }
        }

        // On transition to setup (reset), clear picks
        if (targetPhase === 'setup') {
          draft = {
            ...draft,
            phase: 'setup',
            picks: [],
            currentPickIndex: 0,
            timerState: 'off',
            timerExpiresAt: null,
          };
        } else {
          draft = { ...draft, phase: targetPhase };
        }
      }

      // Timer action
      if (timerAction !== undefined) {
        if (typeof timerAction !== 'string') {
          return { body: { error: 'timerAction must be a string' }, status: 400 };
        }
        const action = timerAction as 'start' | 'pause' | 'resume' | 'expire';

        // PLATFORM-102 — this runs INSIDE the handler's transaction, like every
        // other branch. An earlier version of this comment claimed a bundled
        // request took a separate unserialized route; that was the v2 design and
        // it was wrong — `DraftBoardClient` sends `{ phase: 'live', timerAction:
        // 'start' }` from three call sites. There is no second path now.
        const next = applyTimerAction(draft, action);
        if ('error' in next) {
          return { body: { error: next.error }, status: next.status };
        }
        draft = next;
      }

      draft = { ...draft, updatedAt: new Date().toISOString() };
      await txn.write<DraftState>(draft);

      return { ok: true, draft };
    }
  );

  if (!('ok' in outcome)) {
    return NextResponse.json(outcome.body, { status: outcome.status });
  }

  return NextResponse.json({ draft: outcome.draft });
}
