import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
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

  // PLATFORM-102 round 6 — Undo names the pick it is undoing.
  //
  // "Remove the last pick" is not idempotent: the same click submitted twice —
  // two tabs, or a retry after a lost response — removed TWO picks, both
  // reporting success. Serialization is what made them compound, because the
  // second request now reads the state the first one committed. Proven against a
  // running server.
  //
  // The caller sends the pick number it can SEE. If that is no longer the last
  // pick, the board has moved on and the request is refused rather than applied
  // to whatever happens to be on top. A duplicate therefore names a pick that is
  // already gone and is refused — the second press does nothing.
  //
  // A caller that sends nothing is refused too, deliberately: a stale tab must
  // reload before it can undo. That fails safe (Undo does not work until
  // refreshed) rather than silently eating an extra pick.
  let expectedPickNumber: unknown;
  try {
    const body = (await req.json()) as { expectedPickNumber?: unknown } | null;
    expectedPickNumber = body?.expectedPickNumber;
  } catch {
    expectedPickNumber = undefined;
  }
  if (typeof expectedPickNumber !== 'number' || !Number.isFinite(expectedPickNumber)) {
    return NextResponse.json(
      {
        error:
          'expectedPickNumber is required — reload the draft board if this control is out of date',
        field: 'expectedPickNumber',
      },
      { status: 400 }
    );
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

      const lastPick = draft.picks[draft.picks.length - 1]!;
      if (lastPick.pickNumber !== expectedPickNumber) {
        return {
          error: `The board has moved on — pick ${expectedPickNumber} is no longer the last pick (it is now ${lastPick.pickNumber}). Refresh and try again.`,
          status: 409,
        };
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

  // PUBLICATION CHANGED, so the Insights cache must be busted with the standings
  // one. INSIGHTS-025 made `isDraftPublished` an input to the cached insight
  // build — it is the evidence that licenses membership-change cards — and this
  // route retracts publication by moving `phase` off `complete`. Without this the
  // feed keeps serving joined/left cards for a roster that is no longer final,
  // for the full 300s TTL. The `confirm` and reopen paths already do this; these
  // two did not, because before INSIGHTS-025 a draft phase change altered no
  // cached public output.
  invalidateStandings(slug, year);

  return NextResponse.json({ draft: outcome.draft });
}
