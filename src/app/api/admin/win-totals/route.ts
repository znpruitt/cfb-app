import { NextResponse } from 'next/server';

import teamsData from '@/data/teams.json';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';

export const dynamic = 'force-dynamic';

export type WinTotalEntry = {
  school: string;
  winTotalLow: number;
  winTotalHigh: number;
};

type TeamsJson = {
  items: Array<{ school: string; alts?: string[] }>;
};

function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 2000) return null;
  return n;
}

function parseWinTotalsCsv(
  csv: string,
  teamItems: Array<{ school: string; alts?: string[] }>
): { resolved: WinTotalEntry[]; unresolved: string[] } {
  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { resolved: [], unresolved: [] };

  // Skip header row
  const dataLines = lines.slice(1);

  const resolved: WinTotalEntry[] = [];
  const unresolved: string[] = [];

  for (const line of dataLines) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3) continue;

    const [rawTeam, rawLow, rawHigh] = parts;
    const winTotalLow = Number.parseFloat(rawLow ?? '');
    const winTotalHigh = Number.parseFloat(rawHigh ?? '');

    if (!rawTeam || !Number.isFinite(winTotalLow) || !Number.isFinite(winTotalHigh)) continue;

    const input = rawTeam.toLowerCase();
    const match = teamItems.find(
      (t) => t.school.toLowerCase() === input || (t.alts ?? []).includes(input)
    );

    if (!match) {
      unresolved.push(rawTeam);
      continue;
    }

    resolved.push({ school: match.school, winTotalLow, winTotalHigh });
  }

  return { resolved, unresolved };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = parseYear(url.searchParams.get('year'));
  if (!year) {
    return NextResponse.json(
      { error: 'year must be an integer >= 2000', field: 'year' },
      { status: 400 }
    );
  }

  const record = await getAppState<WinTotalEntry[]>('win-totals', String(year));
  return NextResponse.json({ year, entries: record?.value ?? [] });
}

export async function POST(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const year = parseYear(url.searchParams.get('year'));
  if (!year) {
    return NextResponse.json(
      { error: 'year must be an integer >= 2000', field: 'year' },
      { status: 400 }
    );
  }

  let csvText: string;
  try {
    csvText = await req.text();
  } catch {
    return NextResponse.json({ error: 'failed to read request body' }, { status: 400 });
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: 'request body must be non-empty CSV' }, { status: 400 });
  }

  const { items } = teamsData as TeamsJson;
  const { resolved, unresolved } = parseWinTotalsCsv(csvText, items);

  if (resolved.length > 0) {
    await setAppState('win-totals', String(year), resolved);
  }

  return NextResponse.json({
    success: true,
    year,
    resolvedCount: resolved.length,
    unresolvedTeams: unresolved,
  });
}
