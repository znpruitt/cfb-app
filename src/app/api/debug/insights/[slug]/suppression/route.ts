import { NextResponse } from 'next/server';

import {
  isSuppressionRecordExpired,
  loadSuppressionRecords,
  SUPPRESSION_RECORD_TTL_DAYS,
  type SuppressionRecord,
} from '@/lib/insights/suppression';
import { getLeague } from '@/lib/leagueRegistry';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import type { InsightType } from '@/lib/selectors/insights';

export const dynamic = 'force-dynamic';

// InsightId-prefix → InsightType. Sorted longest-first so the most specific
// match wins (e.g. 'career-points-leader-' beats a generic 'career-' if one
// were ever introduced). Used only for the debug endpoint's byType tally —
// the suppression record itself doesn't carry the type, so this is a
// best-effort parser. Unrecognized IDs land in the 'unknown' bucket.
const INSIGHT_TYPE_PREFIXES: ReadonlyArray<readonly [InsightType, string]> = (
  [
    ['career_points_leader', 'career-points-leader-'],
    ['career_turnover_margin', 'career-turnover-margin-'],
    ['dominance_streak', 'dominance-streak-'],
    ['lopsided_rivalry', 'lopsided-rivalry-'],
    ['rookie_benchmark', 'rookie-benchmark-'],
    ['even_rivalry', 'even-rivalry-'],
    ['greatest_season', 'greatest-season-'],
    ['perfect_against', 'perfect-against-'],
    ['team_identity', 'team-identity-'],
    ['ball_security', 'ball-security-'],
    ['failed_chase', 'failed-chase-'],
    ['champion_margin', 'champion-margin-'],
    ['takeaway_king', 'takeaway-king-'],
    ['tight_cluster', 'tight-cluster-'],
    ['title_chaser', 'title-chaser-'],
    ['toilet_bowl', 'toilet-bowl-'],
    ['trending_down', 'trending-down-'],
    ['trending_up', 'trending-up-'],
    ['yards_per_win', 'yards-per-win-'],
    ['clock_crusher', 'clock-crusher-'],
    ['consistency', 'consistency-'],
    ['improvement', 'improvement-'],
    ['never_last', 'never-last-'],
    ['third_down', 'third-down-'],
    ['volatility', 'volatility-'],
    ['collapse', 'collapse-'],
    ['drought', 'drought-'],
    ['dynasty', 'dynasty-'],
    ['movement', 'movement-'],
    ['surge', 'surge-'],
    ['race', 'race-'],
    // milestone_watch IDs are 'milestone-${kind}-${milestone}-...' — there is
    // no 'milestone-watch-' prefix in practice, so match on 'milestone-'.
    ['milestone_watch', 'milestone-'],
  ] as const
)
  .slice()
  .sort((a, b) => b[1].length - a[1].length);

function classifyType(insightId: string): InsightType | 'unknown' {
  for (const [type, prefix] of INSIGHT_TYPE_PREFIXES) {
    if (insightId.startsWith(prefix)) return type;
  }
  return 'unknown';
}

function parseSeasonParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : undefined;
}

function ageDays(record: SuppressionRecord, now: number): number {
  const firedAtMs = new Date(record.firedAt).getTime();
  if (!Number.isFinite(firedAtMs)) return 0;
  return Math.max(0, Math.floor((now - firedAtMs) / (24 * 60 * 60 * 1000)));
}

type DebugRecord = {
  insightId: string;
  hook: string;
  owner: string;
  firedAt: string;
  statValue: number;
  type: InsightType | 'unknown';
  ageDays: number;
  expired: boolean;
};

type DebugResponse = {
  slug: string;
  season: number;
  totalRecords: number;
  ttlDays: number;
  expiredCount: number;
  byType: Record<string, number>;
  byHook: Record<string, number>;
  records: DebugRecord[];
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const { slug } = await params;
  const league = await getLeague(slug);
  if (!league) {
    return NextResponse.json(
      { error: 'league-not-found', slug },
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const url = new URL(req.url);
  const seasonOverride = parseSeasonParam(url.searchParams.get('season'));
  const season = seasonOverride ?? league.year;

  const records = await loadSuppressionRecords(slug, season);

  const now = Date.now();
  const byType: Record<string, number> = {};
  const byHook: Record<string, number> = {};
  const debugRecords: DebugRecord[] = [];
  let expiredCount = 0;

  for (const record of records.values()) {
    const type = classifyType(record.insightId);
    const expired = isSuppressionRecordExpired(record, now);
    if (expired) expiredCount += 1;

    byType[type] = (byType[type] ?? 0) + 1;
    byHook[record.hook] = (byHook[record.hook] ?? 0) + 1;

    debugRecords.push({
      insightId: record.insightId,
      hook: record.hook,
      owner: record.owner,
      firedAt: record.firedAt,
      statValue: record.statValue,
      type,
      ageDays: ageDays(record, now),
      expired,
    });
  }

  debugRecords.sort((a, b) => b.firedAt.localeCompare(a.firedAt));

  const response: DebugResponse = {
    slug,
    season,
    totalRecords: debugRecords.length,
    ttlDays: SUPPRESSION_RECORD_TTL_DAYS,
    expiredCount,
    byType,
    byHook,
    records: debugRecords,
  };

  return NextResponse.json(response, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
