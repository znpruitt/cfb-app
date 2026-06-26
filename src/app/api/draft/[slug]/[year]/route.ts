import { NextResponse } from 'next/server';

import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
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

  const { owners, settings: rawSettings } = body as { owners?: unknown; settings?: unknown };

  if (!Array.isArray(owners) || owners.length < 2) {
    return NextResponse.json(
      { error: 'owners must be an array of at least 2 owner names', field: 'owners' },
      { status: 400 }
    );
  }

  const ownerNames = owners.filter(
    (o): o is string => typeof o === 'string' && o.trim().length > 0
  );
  if (ownerNames.length < 2) {
    return NextResponse.json(
      { error: 'owners must contain at least 2 non-empty strings', field: 'owners' },
      { status: 400 }
    );
  }

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

  const record = await getAppState<DraftState>(draftScope(slug), String(year));
  if (!record?.value) {
    return NextResponse.json({ error: `No draft found for ${slug} ${year}` }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const { owners, settings, phase, timerAction } = body as {
    owners?: unknown;
    settings?: unknown;
    phase?: unknown;
    timerAction?: unknown;
  };

  const original = record.value;

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
  if (owners !== undefined) {
    if (!Array.isArray(owners) || owners.length < 2) {
      return NextResponse.json(
        { error: 'owners must be an array of at least 2 owner names', field: 'owners' },
        { status: 400 }
      );
    }
    const ownerNames = owners.filter(
      (o): o is string => typeof o === 'string' && o.trim().length > 0
    );
    if (ownerNames.length < 2) {
      return NextResponse.json(
        { error: 'owners must contain at least 2 non-empty strings', field: 'owners' },
        { status: 400 }
      );
    }
    const ownersChanged =
      ownerNames.length !== original.owners.length ||
      ownerNames.some((name, i) => name !== original.owners[i]);
    if (draftStarted && ownersChanged) {
      return NextResponse.json(
        {
          error:
            'owners cannot be changed after the draft has started. Reset or reopen the draft to change the owner set or order.',
          field: 'owners',
        },
        { status: 409 }
      );
    }
    draft = { ...draft, owners: ownerNames };
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
        return NextResponse.json(
          { error: 'settings.draftOrder must be an array', field: 'settings.draftOrder' },
          { status: 400 }
        );
      }
      const incomingOrder = incoming.draftOrder;
      const originalOrder = original.settings.draftOrder;
      const orderChanged =
        incomingOrder.length !== originalOrder.length ||
        incomingOrder.some((name, i) => name !== originalOrder[i]);
      if (draftStarted && orderChanged) {
        return NextResponse.json(
          {
            error:
              'draftOrder cannot be changed after the draft has started. Reset or reopen the draft to change the draft order.',
            field: 'settings.draftOrder',
          },
          { status: 409 }
        );
      }
      // Effective owner set: owners may have just been updated above for a
      // not-yet-started draft; draft.owners reflects that.
      if (!isDraftOrderPermutationOfOwners(incomingOrder, draft.owners)) {
        return NextResponse.json(
          {
            error: 'draftOrder must contain exactly the same owners as the owners array',
            field: 'settings.draftOrder',
          },
          { status: 400 }
        );
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
        return NextResponse.json(
          {
            error: 'settings.totalRounds must be a positive integer',
            field: 'settings.totalRounds',
          },
          { status: 400 }
        );
      }
      if (draftStarted && incoming.totalRounds !== original.settings.totalRounds) {
        return NextResponse.json(
          {
            error:
              'totalRounds cannot be changed after the draft has started. Reset or reopen the draft to change the round count.',
            field: 'settings.totalRounds',
          },
          { status: 409 }
        );
      }
      const { items } = teamsData as TeamsJson;
      const fbsCount = getDraftEligibleTeams(items).length;
      const ownerCount = draft.owners.length;
      if (ownerCount > 0) {
        const maxRounds = Math.floor(fbsCount / ownerCount);
        if (incoming.totalRounds > maxRounds) {
          return NextResponse.json(
            {
              error: `totalRounds cannot exceed ${maxRounds} (${fbsCount} FBS teams ÷ ${ownerCount} owners)`,
              field: 'settings.totalRounds',
            },
            { status: 400 }
          );
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
      return NextResponse.json(
        { error: 'phase must be a string', field: 'phase' },
        { status: 400 }
      );
    }
    const targetPhase = phase as DraftPhase;
    if (!isValidTransition(draft.phase, targetPhase)) {
      return NextResponse.json(
        { error: `Cannot transition from '${draft.phase}' to '${targetPhase}'`, field: 'phase' },
        { status: 422 }
      );
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
      return NextResponse.json({ error: 'timerAction must be a string' }, { status: 400 });
    }
    const action = timerAction as 'start' | 'pause' | 'resume' | 'expire';

    if (action === 'start' || action === 'resume') {
      if (draft.phase !== 'live') {
        return NextResponse.json(
          { error: 'Timer can only be started/resumed when draft is live' },
          { status: 422 }
        );
      }
      const { pickTimerSeconds } = draft.settings;
      if (!pickTimerSeconds) {
        return NextResponse.json({ error: 'No pick timer configured' }, { status: 422 });
      }
      draft = {
        ...draft,
        timerState: 'running',
        timerExpiresAt: new Date(Date.now() + pickTimerSeconds * 1000).toISOString(),
      };
    } else if (action === 'pause') {
      draft = {
        ...draft,
        timerState: 'paused',
        timerExpiresAt: null,
      };
    } else if (action === 'expire') {
      // Accept expire from live phase (normal expiry) or paused+expired phase (commissioner
      // clicked auto-pick in the pause-and-prompt overlay)
      const isLiveExpire = draft.phase === 'live';
      const isPausedExpire = draft.phase === 'paused' && draft.timerState === 'expired';

      if (!isLiveExpire && !isPausedExpire) {
        return NextResponse.json(
          {
            error: `Timer expire only valid when draft is live or paused-expired (phase: ${draft.phase})`,
          },
          { status: 422 }
        );
      }

      // For live phase, validate the timer was actually running and has elapsed
      if (isLiveExpire) {
        if (!draft.timerExpiresAt) {
          return NextResponse.json(
            { error: 'No active timer — timerExpiresAt is null' },
            { status: 422 }
          );
        }
        if (new Date(draft.timerExpiresAt) > new Date()) {
          return NextResponse.json({ error: 'Timer has not expired yet' }, { status: 422 });
        }
      }

      // Paused-expired phase means the commissioner is explicitly requesting auto-pick
      // from the pause-and-prompt overlay. Live phase means the timer expired naturally.
      // Natural expiry always pauses and prompts — no automatic auto-pick.

      if (isLiveExpire) {
        // Timer expired naturally — always pause and prompt the commissioner
        draft = {
          ...draft,
          phase: 'paused',
          timerState: 'expired',
          timerExpiresAt: null,
        };
      } else {
        // isPausedExpire — commissioner clicked "Auto-pick" from prompt overlay
        // Select a random available team
        const { items } = teamsData as TeamsJson;
        const fbsTeams = getDraftEligibleTeams(items);
        const pickedLower = new Set(draft.picks.map((p) => p.team.toLowerCase()));

        const available = fbsTeams.filter((t) => !pickedLower.has(t.school.toLowerCase()));

        const bestTeam =
          available.length > 0
            ? available[Math.floor(Math.random() * available.length)]
            : undefined;
        if (!bestTeam) {
          return NextResponse.json({ error: 'No teams available for auto-pick' }, { status: 422 });
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
          draft = {
            ...draft,
            picks: [...draft.picks, pick],
            currentPickIndex: newPickIndex,
            phase: 'complete',
            timerState: 'off',
            timerExpiresAt: null,
          };
        } else if (atRoundBoundary) {
          draft = {
            ...draft,
            picks: [...draft.picks, pick],
            currentPickIndex: newPickIndex,
            phase: 'paused',
            timerState: pickTimerSeconds ? 'paused' : 'off',
            timerExpiresAt: null,
          };
        } else {
          draft = {
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
      }
    } else {
      return NextResponse.json({ error: `Unknown timerAction: "${action}"` }, { status: 400 });
    }
  }

  draft = { ...draft, updatedAt: new Date().toISOString() };
  await setAppState<DraftState>(draftScope(slug), String(year), draft);

  return NextResponse.json({ draft });
}
