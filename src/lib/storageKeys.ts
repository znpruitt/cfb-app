export const LEGACY_STORAGE_KEYS = {
  aliasMap: 'cfb_name_map',
  scheduleCsv: 'cfb_schedule_csv',
  ownersCsv: 'cfb_owners_csv',
  postseasonOverrides: 'cfb_postseason_overrides',
} as const;

export function seasonStorageKeys(season: number) {
  return {
    aliasMap: `cfb_name_map:${season}`,
    scheduleCsv: `cfb_schedule_csv:${season}`,
    ownersCsv: `cfb_owners_csv:${season}`,
    postseasonOverrides: `cfb_postseason_overrides:${season}`,
  } as const;
}
