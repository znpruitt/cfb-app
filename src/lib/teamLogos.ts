import type { AppGame } from './schedule';
import { toTeamIdentityKey, type TeamCatalogItem } from './teamIdentity';

export type ScoreboardTeamLogo = Readonly<{
  lightUrl: string;
  darkUrl: string;
  displaySize: ScoreboardTeamLogoDisplaySize;
}>;

export type ScoreboardTeamLogosById = ReadonlyMap<string, ScoreboardTeamLogo>;
export type ScoreboardTeamLogoDisplaySize = 14 | 18 | 20;

export const EMPTY_SCOREBOARD_TEAM_LOGOS_BY_ID: ScoreboardTeamLogosById = new Map();

const CFBD_LOGO_HOST = 'cdn.collegefootballdata.com';

function providerAssetSize(displaySize: ScoreboardTeamLogoDisplaySize): '32' | '48' {
  return displaySize === 14 ? '32' : '48';
}

function logoPairForProviderTeamId(
  providerTeamId: number,
  displaySize: ScoreboardTeamLogoDisplaySize
): ScoreboardTeamLogo | null {
  if (!Number.isSafeInteger(providerTeamId) || providerTeamId <= 0) return null;
  const assetSize = providerAssetSize(displaySize);

  return {
    lightUrl: `https://${CFBD_LOGO_HOST}/logos/${assetSize}/${providerTeamId}.png`,
    darkUrl: `https://${CFBD_LOGO_HOST}/logos-dark/${assetSize}/${providerTeamId}.png`,
    displaySize,
  };
}

function selectCfbdLogo(
  logos: readonly string[] | null | undefined,
  family: 'logos' | 'logos-dark',
  assetSize: '32' | '48'
): string | null {
  for (const candidate of logos ?? []) {
    try {
      const url = new URL(candidate);
      const [pathFamily, size, filename, ...extra] = url.pathname.split('/').filter(Boolean);
      if (
        url.protocol === 'https:' &&
        url.hostname === CFBD_LOGO_HOST &&
        pathFamily === family &&
        size === assetSize &&
        filename?.endsWith('.png') &&
        extra.length === 0
      ) {
        return candidate;
      }
    } catch {
      // Ignore malformed provider values; the adjacent team name remains canonical identity.
    }
  }
  return null;
}

export function buildScoreboardTeamLogosById(
  teams: readonly TeamCatalogItem[],
  games: readonly AppGame[] = [],
  displaySize: ScoreboardTeamLogoDisplaySize = 14
): ScoreboardTeamLogosById {
  const logosById = new Map<string, ScoreboardTeamLogo>();
  const assetSize = providerAssetSize(displaySize);

  for (const team of teams) {
    const teamId = toTeamIdentityKey(team.school);
    if (!teamId) continue;

    const lightUrl = selectCfbdLogo(team.logos, 'logos', assetSize);
    const darkUrl = selectCfbdLogo(team.logos, 'logos-dark', assetSize);
    const fallbackUrl = lightUrl ?? darkUrl;
    if (!fallbackUrl) continue;

    logosById.set(teamId, {
      lightUrl: lightUrl ?? fallbackUrl,
      darkUrl: darkUrl ?? fallbackUrl,
      displaySize,
    });
  }

  // The canonical team catalog intentionally remains FBS-only. Schedule rows
  // retain CFBD's numeric participant ids, though, so an FBS-vs-FCS opponent can
  // use the same provider-owned CDN asset without widening the ownable catalog.
  // Catalog metadata wins when present; this path fills only missing identities.
  for (const game of games) {
    for (const side of ['away', 'home'] as const) {
      const participant = game.participants[side];
      if (participant.kind !== 'team' || logosById.has(participant.teamId)) continue;

      const providerTeamId = side === 'home' ? game.homeProviderTeamId : game.awayProviderTeamId;
      if (typeof providerTeamId !== 'number') continue;

      const logo = logoPairForProviderTeamId(providerTeamId, displaySize);
      if (logo) logosById.set(participant.teamId, logo);
    }
  }

  return logosById;
}
