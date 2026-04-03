import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, draftScope } from '@/lib/draft';

export const dynamic = 'force-dynamic';

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

/** POST /api/draft/[slug]/[year]/reset — clear all picks, return to setup phase */
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

  const record = await getAppState<DraftState>(draftScope(slug), String(year));
  if (!record?.value) {
    return NextResponse.json({ error: `No draft found for ${slug} ${year}` }, { status: 404 });
  }

  const draft = record.value;

  if (
    draft.phase !== 'live' &&
    draft.phase !== 'paused' &&
    draft.phase !== 'complete' &&
    draft.phase !== 'preview'
  ) {
    return NextResponse.json(
      { error: `Cannot reset draft in phase: ${draft.phase}` },
      { status: 422 }
    );
  }

  const updated: DraftState = {
    ...draft,
    phase: 'setup',
    picks: [],
    currentPickIndex: 0,
    timerState: 'off',
    timerExpiresAt: null,
    updatedAt: new Date().toISOString(),
  };

  await setAppState<DraftState>(draftScope(slug), String(year), updated);

  return NextResponse.json({ draft: updated });
}
