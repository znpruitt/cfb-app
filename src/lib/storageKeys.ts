export function seasonStorageKeys(season: number) {
  return {
    aliasMap: `cfb_name_map:${season}`,
    ownersCsv: `cfb_owners_csv:${season}`,
    postseasonOverrides: `cfb_postseason_overrides:${season}`,
  } as const;
}
