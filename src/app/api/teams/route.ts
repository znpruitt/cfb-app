import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getTeamDatabaseFile } from '@/lib/server/teamDatabaseStore';
import type { TeamCatalogItem } from '@/lib/teamIdentity';

type NormalizedLevel = 'FBS' | 'FCS' | 'D2' | 'D3' | 'NAIA' | 'OTHER';

function normalizeLevel(t: TeamCatalogItem): NormalizedLevel {
  const raw = (t.level ?? t.subdivision ?? t.classification ?? '').toString().trim().toUpperCase();

  if (raw === 'FBS') return 'FBS';
  if (raw === 'FCS') return 'FCS';
  if (raw === 'D2' || raw === 'DIVISION II' || raw === 'NCAA D2') return 'D2';
  if (raw === 'D3' || raw === 'DIVISION III' || raw === 'NCAA D3') return 'D3';
  if (raw === 'NAIA') return 'NAIA';

  if (raw.includes('FBS')) return 'FBS';
  if (raw.includes('FCS')) return 'FCS';
  if (raw.includes('II')) return 'D2';
  if (raw.includes('III')) return 'D3';

  return 'OTHER';
}

function levelMatches(t: TeamCatalogItem, want: NormalizedLevel | 'ALL'): boolean {
  if (want === 'ALL') return true;
  return normalizeLevel(t) === want;
}

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const levelParam = parseLevelParam(searchParams.get('level'));
    const catalog = await getTeamDatabaseFile();

    if (!Array.isArray(catalog.items) || catalog.items.length === 0) {
      return NextResponse.json(
        {
          error: 'No teams catalog found. Add src/data/teams.json or sync the team database.',
        },
        { status: 404 }
      );
    }

    const items = catalog.items
      .filter((t) => levelMatches(t, levelParam))
      .map((t) => ({
        id: t.id ?? null,
        providerId: t.providerId ?? null,
        school: t.school,
        displayName: t.displayName ?? t.school,
        shortDisplayName: t.shortDisplayName ?? null,
        abbreviation: t.abbreviation ?? null,
        mascot: t.mascot ?? null,
        conference: t.conference ?? null,
        classification: t.classification ?? null,
        level: normalizeLevel(t),
        color: t.color ?? null,
        altColor: t.altColor ?? null,
        logos: Array.isArray(t.logos) ? t.logos : [],
        alts: Array.isArray(t.alts) ? t.alts : [],
      }))
      .sort((a, b) => (a.school || '').localeCompare(b.school || ''));

    return NextResponse.json(
      {
        source: catalog.source,
        updatedAt: catalog.updatedAt,
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
