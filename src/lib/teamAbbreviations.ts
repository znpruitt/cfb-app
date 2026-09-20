import artifact from '@/data/team-abbreviations.json';

type TeamAbbreviationArtifact = {
  year: number;
  sourceUrl: string;
  items: Array<{
    school: string;
    abbreviation: string | null;
  }>;
};

const data = artifact as TeamAbbreviationArtifact;
const abbreviationsBySchool = new Map(
  data.items.map((item) => [item.school, item.abbreviation] as const)
);

export const TEAM_ABBREVIATIONS_YEAR = data.year;
export const TEAM_ABBREVIATIONS_SOURCE_URL = data.sourceUrl;

/**
 * Return CFBD's abbreviation for an exact provider school name, or null when
 * CFBD supplied none / the school is outside the pinned artifact. This lookup
 * performs no team matching and never fabricates a short form.
 *
 * #831 intentionally ships this client-safe seam with no rendering consumer;
 * #832 consumes it in the shared scoreboard and recap renderers.
 */
export function getTeamAbbreviation(school: string): string | null {
  const providerSchool = school.trim();
  if (!providerSchool) return null;
  return abbreviationsBySchool.get(providerSchool) ?? null;
}
