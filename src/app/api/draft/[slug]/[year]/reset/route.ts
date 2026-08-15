import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, draftScope } from '@/lib/draft';

export const dynamic = 'force-dynamic';

/** A refusal decided inside the transaction; see the pick route for the shape. */
type ResetOutcome = { error: string; status: number } | { ok: true; draft: DraftState };

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

/** POST /api/draft/[slug]/[year]/reset — clear all picks, return to setup phase */
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

  // PLATFORM-102 round 3 — Reset reads and writes inside one key transaction, for
  // the same reason as Undo. A confirmation or a pick committing inside the old
  // read-then-write window was silently undone by this write (and, in the other
  // direction, a pick landing mid-reset restored the picks the reset had just
  // cleared). No pooled I/O runs inside the callback.
  const outcome = await withAppStateKeyTransaction<ResetOutcome>(
    draftScope(slug),
    String(year),
    async (txn): Promise<ResetOutcome> => {
      const record = await txn.read<DraftState>();
      if (!record?.value) {
        return { error: `No draft found for ${slug} ${year}`, status: 404 };
      }

      const draft = record.value;

      if (
        draft.phase !== 'live' &&
        draft.phase !== 'paused' &&
        draft.phase !== 'complete' &&
        draft.phase !== 'preview'
      ) {
        return { error: `Cannot reset draft in phase: ${draft.phase}`, status: 422 };
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

      await txn.write<DraftState>(updated);

      return { ok: true, draft: updated };
    }
  );

  if (!('ok' in outcome)) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json({ draft: outcome.draft });
}
