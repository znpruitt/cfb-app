// src/app/api/teams/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** One team record in your catalog JSON. */
type TeamItem = {
  school: string;
  mascot?: string | null;
  conference?: string | null;

  /** Some catalogs use `level`, others use `subdivision`; we normalize either. */
  level?: string | null; // e.g. "FBS" | "FCS" | "D2" | ...
  subdivision?: string | null; // e.g. "FBS" | "FCS" | "D2" | ...

  /** Optional list of alternative names (aliases) if present in your file. */
  alts?: string[];
};

/** The overall teams catalog file shape. */
type TeamsCatalog = {
  year: number;
  items: TeamItem[];
};

type NormalizedLevel = 'FBS' | 'FCS' | 'D2' | 'D3' | 'NAIA' | 'OTHER';

/** Which file(s) to try for a given year. */
function candidateFiles(year: number | null): string[] {
  const dataDir = path.join(process.cwd(), 'data');
  const out: string[] = [];
  if (year !== null) out.push(path.join(dataDir, `teams-${year}.json`));
  out.push(path.join(dataDir, 'teams-latest.json'));
  return out;
}

/** Load the first existing catalog file from candidates. */
async function loadCatalog(year: number | null): Promise<TeamsCatalog | null> {
  for (const file of candidateFiles(year)) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as TeamsCatalog;
      if (parsed && Array.isArray(parsed.items)) return parsed;
    } catch {
      // try next
    }
  }
  return null;
}

/** Normalize a team record's level/subdivision into one of our enums. */
function normalizeLevel(t: TeamItem): NormalizedLevel {
  const raw = (t.level ?? t.subdivision ?? '').toString().trim().toUpperCase();

  if (raw === 'FBS') return 'FBS';
  if (raw === 'FCS') return 'FCS';
  if (raw === 'D2' || raw === 'DIVISION II' || raw === 'NCAA D2') return 'D2';
  if (raw === 'D3' || raw === 'DIVISION III' || raw === 'NCAA D3') return 'D3';
  if (raw === 'NAIA') return 'NAIA';

  // Some catalogs might use odd strings; map a few common ones:
  if (raw.includes('FBS')) return 'FBS';
  if (raw.includes('FCS')) return 'FCS';
  if (raw.includes('II')) return 'D2';
  if (raw.includes('III')) return 'D3';

  return 'OTHER';
}

/** Does a team match the requested level? */
function levelMatches(t: TeamItem, want: NormalizedLevel | 'ALL'): boolean {
  if (want === 'ALL') return true;
  return normalizeLevel(t) === want;
}

/** Parse `level` query into our allowed set. */
function parseLevelParam(q: string | null): NormalizedLevel | 'ALL' {
  const v = (q ?? 'ALL').toString().trim().toUpperCase();
  if (v === 'ALL') return 'ALL';
  if (v === 'FBS') return 'FBS';
  if (v === 'FCS') return 'FCS';
  if (v === 'D2') return 'D2';
  if (v === 'D3') return 'D3';
  if (v === 'NAIA') return 'NAIA';
  if (v === 'OTHER') return 'OTHER';
  return 'ALL';
}

/** GET /api/teams?year=2025&level=FBS|FCS|D2|D3|NAIA|OTHER|ALL */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get('year');
    const levelParam = parseLevelParam(searchParams.get('level'));

    const year = yearParam ? Number.parseInt(yearParam, 10) : null;
    const wantYear = Number.isFinite(year as number) ? (year as number) : null;

    const catalog = await loadCatalog(wantYear);
    if (!catalog) {
      return NextResponse.json(
        {
          error:
            'No teams catalog found. Add data/teams-<year>.json or data/teams-latest.json (via your fetch script) and restart.',
        },
        { status: 404 }
      );
    }

    const items = catalog.items
      .filter((t) => levelMatches(t, levelParam))
      .map((t) => ({
        school: t.school,
        mascot: t.mascot ?? null,
        conference: t.conference ?? null,
        level: normalizeLevel(t),
        alts: Array.isArray(t.alts) ? t.alts : [],
      }))
      .sort((a, b) => (a.school || '').localeCompare(b.school || ''));

    return NextResponse.json(
      {
        year: catalog.year,
        level: levelParam,
        count: items.length,
        items,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
