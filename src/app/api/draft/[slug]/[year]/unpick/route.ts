import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, draftScope } from '@/lib/draft';

export const dynamic = 'force-dynamic';

/** A refusal decided inside the transaction; see the pick route for the shape. */
type UnpickOutcome = { error: string; status: number } | { ok: true; draft: DraftState };

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

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

  // PLATFORM-102 round 3 — Undo reads and writes inside one key transaction.
  //
  // It was scoped out of rounds 1 and 2 on the reasoning that Undo is pressed
  // deliberately, when nothing else is in flight. Review disagreed and was right:
  // `DraftBoardClient.handleUndo` is a button on the draft board DURING the
  // draft, so a pick landing as it is pressed hit exactly the failure this slice
  // exists to close — the pick erased, its caller told it succeeded. No pooled
  // I/O runs inside the callback.
  const outcome = await withAppStateKeyTransaction<UnpickOutcome>(
    draftScope(slug),
    String(year),
    async (txn): Promise<UnpickOutcome> => {
      const record = await txn.read<DraftState>();
      if (!record?.value) {
        return { error: `No draft found for ${slug} ${year}`, status: 404 };
      }

      const draft = { ...record.value };

      if (draft.phase !== 'live' && draft.phase !== 'paused' && draft.phase !== 'complete') {
        return { error: `Cannot unpick in phase: ${draft.phase}`, status: 422 };
      }

      if (draft.picks.length === 0) {
        return { error: 'No picks to undo', status: 422 };
      }

      const newPicks = draft.picks.slice(0, -1);
      const newPickIndex = draft.currentPickIndex - 1;
      const { pickTimerSeconds } = draft.settings;

      const updated: DraftState = {
        ...draft,
        picks: newPicks,
        currentPickIndex: newPickIndex,
        phase: 'live',
        timerState: pickTimerSeconds ? 'running' : 'off',
        timerExpiresAt: pickTimerSeconds
          ? new Date(Date.now() + pickTimerSeconds * 1000).toISOString()
          : null,
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
