import { NextResponse } from 'next/server';

import { getLeagues, updateLeagueStatus } from '@/lib/leagueRegistry';
import { saveSeasonArchive } from '@/lib/seasonArchive';
import { buildSeasonArchive, findNationalChampionshipGameDate } from '@/lib/seasonRollover';

export const dynamic = 'force-dynamic';

const TEST_LEAGUE_SLUG = 'test';
const ROLLOVER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

type RolloverError = { leagueSlug: string; error: string };

type CronResult = {
  skipped?: boolean;
  reason?: string;
  rolloverDate?: string | null;
  year?: number;
  success?: boolean;
  leaguesRolledOver?: string[];
  errors?: RolloverError[];
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

export async function GET(req: Request): Promise<NextResponse<CronResult>> {
  const authResult = verifyCronSecret(req);
  if (authResult !== 'ok') {
    const reason =
      authResult === 'not-configured'
        ? 'CRON_SECRET is not configured on the server — set it in Vercel environment variables'
        : 'unauthorized: Bearer token did not match CRON_SECRET';
    return NextResponse.json({ skipped: true, reason }, { status: 401 });
  }

  try {
    const allLeagues = await getLeagues();
    const seasonLeagues = allLeagues.filter(
      (l) => l.slug !== TEST_LEAGUE_SLUG && l.status?.state === 'season'
    );

    if (seasonLeagues.length === 0) {
      return NextResponse.json({ skipped: true, reason: 'no leagues in season state' });
    }

    // All non-test leagues are assumed to be on the same year (global rollover model)
    const year = (seasonLeagues[0]!.status as { state: 'season'; year: number }).year;

    const championshipDate = await findNationalChampionshipGameDate(year);
    if (!championshipDate) {
      return NextResponse.json({
        skipped: true,
        reason: 'national championship game not found in schedule cache',
        year,
      });
    }

    const championshipMs = new Date(championshipDate).getTime();
    const rolloverMs = championshipMs + ROLLOVER_DELAY_MS;
    const rolloverDate = new Date(rolloverMs).toISOString();

    if (Date.now() < rolloverMs) {
      return NextResponse.json({
        skipped: true,
        reason: 'championship + 7 days not reached',
        rolloverDate,
        year,
      });
    }

    const leaguesRolledOver: string[] = [];
    const errors: RolloverError[] = [];

    for (const league of seasonLeagues) {
      try {
        const archive = await buildSeasonArchive(league.slug, year);
        await saveSeasonArchive(archive);
      } catch (err) {
        errors.push({
          leagueSlug: league.slug,
          error: err instanceof Error ? err.message : 'unknown error',
        });
        continue;
      }

      try {
        await updateLeagueStatus(league.slug, { state: 'offseason' });
        leaguesRolledOver.push(league.slug);
      } catch (err) {
        errors.push({
          leagueSlug: league.slug,
          error: `status write failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      year,
      rolloverDate,
      leaguesRolledOver,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      {
        skipped: true,
        reason: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    );
  }
}
