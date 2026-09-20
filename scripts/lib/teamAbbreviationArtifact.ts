import { parseSeasonArg } from '../../src/lib/cli/seasonArg.ts';

export const CFBD_TEAM_ABBREVIATIONS_ENDPOINT =
  'https://api.collegefootballdata.com/teams' as const;

export type CfbdTeamAbbreviationRow = {
  school?: string | null;
  abbreviation?: string | null;
};

export type TeamAbbreviationArtifact = {
  year: number;
  sourceUrl: string;
  generatedAt: string;
  items: Array<{
    school: string;
    abbreviation: string | null;
  }>;
};

/**
 * A committed seasonal lookup must name the provider season it represents.
 * `parseSeasonArg` remains the shared syntax/range authority, while this
 * generator deliberately refuses that parser's unpinned `current` result.
 *
 * Asserted by `teamAbbreviations.test.ts`:
 * "the generator requires an explicit season pin".
 */
export function requirePinnedTeamAbbreviationSeason(argv: readonly string[]): number {
  const parsed = parseSeasonArg(argv);
  if (parsed.kind === 'invalid') throw new Error(parsed.message);
  if (parsed.kind === 'current') {
    throw new Error(
      "fetch-cfbd-team-abbreviations requires --year YYYY; the committed lookup may not use CFBD's implicit current season"
    );
  }
  return parsed.year;
}

export function buildCfbdTeamAbbreviationsUrl(year: number): URL {
  const url = new URL(CFBD_TEAM_ABBREVIATIONS_ENDPOINT);
  url.searchParams.set('year', String(year));
  return url;
}

/**
 * Fetch and build one pinned artifact with one provider request and no retry
 * path. The injected fetch seam lets the call count and exact target be tested
 * without spending quota.
 */
export async function fetchTeamAbbreviationArtifact(params: {
  year: number;
  apiKey: string;
  fetchImpl?: typeof fetch;
  generatedAt?: string;
}): Promise<TeamAbbreviationArtifact> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(buildCfbdTeamAbbreviationsUrl(params.year), {
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`CFBD team abbreviations fetch failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('CFBD team abbreviations payload must be an array');
  }
  return buildTeamAbbreviationArtifact({
    rows: payload as CfbdTeamAbbreviationRow[],
    year: params.year,
    generatedAt: params.generatedAt,
  });
}

/**
 * Preserve one output row per provider row. Missing/blank abbreviations become
 * explicit nulls; malformed schools, malformed abbreviation values, and
 * duplicate school keys reject the whole artifact instead of silently shrinking
 * or conflating the provider population.
 */
export function buildTeamAbbreviationArtifact(params: {
  rows: readonly CfbdTeamAbbreviationRow[];
  year: number;
  generatedAt?: string;
}): TeamAbbreviationArtifact {
  const seenSchools = new Set<string>();
  const items = params.rows.map((row, index) => {
    const school = typeof row?.school === 'string' ? row.school.trim() : '';
    if (!school) {
      throw new Error(`CFBD team abbreviation row ${index} is missing school`);
    }
    if (seenSchools.has(school)) {
      throw new Error(`CFBD team abbreviation payload contains duplicate school: ${school}`);
    }
    seenSchools.add(school);

    if (
      row.abbreviation !== undefined &&
      row.abbreviation !== null &&
      typeof row.abbreviation !== 'string'
    ) {
      throw new Error(`CFBD team abbreviation row for ${school} has a non-string abbreviation`);
    }
    const abbreviation = row.abbreviation?.trim() || null;
    return { school, abbreviation };
  });

  items.sort((left, right) => left.school.localeCompare(right.school));
  return {
    year: params.year,
    sourceUrl: buildCfbdTeamAbbreviationsUrl(params.year).toString(),
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    items,
  };
}
