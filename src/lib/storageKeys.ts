export const LEGACY_STORAGE_KEYS = {
  ownersCsv: 'cfb_owners_csv',
  postseasonOverrides: 'cfb_postseason_overrides',
} as const;

export function seasonStorageKeys(season: number, leagueSlug?: string) {
  const scope = leagueSlug ? `${leagueSlug}:${season}` : `${season}`;
  return {
    aliasMap: `cfb_name_map:${scope}`,
    ownersCsv: `cfb_owners_csv:${scope}`,
    postseasonOverrides: `cfb_postseason_overrides:${scope}`,
  } as const;
}
