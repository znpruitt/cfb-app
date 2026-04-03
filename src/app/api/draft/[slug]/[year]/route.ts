import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import {
  type DraftState,
  type DraftSettings,
  type DraftPhase,
  defaultDraftSettings,
  draftScope,
} from '@/lib/draft';

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
  _req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
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
  return NextResponse.json({ draft: record?.value ?? null });
}

// ---------------------------------------------------------------------------
// POST — create new draft (admin-gated)
// ---------------------------------------------------------------------------
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const authFailure = requireAdminRequest(req);
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

  const { owners } = body as { owners?: unknown };

  if (!Array.isArray(owners) || owners.length < 2) {
    return NextResponse.json(
      { error: 'owners must be an array of at least 2 owner names', field: 'owners' },
      { status: 400 }
    );
  }

  const ownerNames = owners.filter((o): o is string => typeof o === 'string' && o.trim().length > 0);
  if (ownerNames.length < 2) {
    return NextResponse.json(
      { error: 'owners must contain at least 2 non-empty strings', field: 'owners' },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const draft: DraftState = {
    leagueSlug: slug,
    year,
    phase: 'setup',
    owners: ownerNames,
    settings: defaultDraftSettings(ownerNames),
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
  const authFailure = requireAdminRequest(req);
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
    return NextResponse.json(
      { error: `No draft found for ${slug} ${year}` },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const { owners, settings, phase } = body as {
    owners?: unknown;
    settings?: unknown;
    phase?: unknown;
  };

  let draft: DraftState = { ...record.value };

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
    draft = { ...draft, owners: ownerNames };
  }

  // Update settings (merge)
  if (settings !== undefined && typeof settings === 'object' && settings !== null) {
    const incoming = settings as Partial<DraftSettings>;
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
      return NextResponse.json({ error: 'phase must be a string', field: 'phase' }, { status: 400 });
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

  draft = { ...draft, updatedAt: new Date().toISOString() };
  await setAppState<DraftState>(draftScope(slug), String(year), draft);

  return NextResponse.json({ draft });
}
