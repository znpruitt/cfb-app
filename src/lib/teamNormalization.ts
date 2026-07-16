const INVALID_TEAM_LABEL_PATTERNS: RegExp[] = [
  /\bchampionship\b/i,
  /\bbowl\b/i,
  /\bkickoff\b/i,
  /\bclassic\b/i,
  /\btbd\b/i,
  /\b(?:am|pm)\b/i,
  /\b(?:et|ct|mt|pt)\b/i,
  /\b(?:abc|cbs|nbc|fox|espn|espn2|fs1|accn|secn)\b/i,
  /\b(?:charlotte|atlanta|orlando|las vegas|new orleans),?\s+[a-z]{2}\b/i,
  /\d{1,2}:\d{2}/,
];

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeAliasLookup(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

export function normalizeTeamName(name: string): string {
  const cleaned = stripDiacritics(name)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[()]/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-\s]+/g, ' ')
    .trim();

  return cleaned.replace(/\s+/g, '');
}

export function isLikelyInvalidTeamLabel(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed.length < 2) return true;
  if (/\d{4}/.test(trimmed) && /\b(et|ct|mt|pt)\b/i.test(trimmed)) return true;
  return INVALID_TEAM_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * A synthetic postseason slot label ("College Football Playoff Quarterfinal 1",
 * "SEC Championship 2", …): an event/round name with a slot number where a team
 * name belongs, produced by providers before the matchup is set.
 */
export function isSyntheticPostseasonSlotLabel(name: string): boolean {
  const trimmed = name.trim();
  return (
    /(college football playoff|\bcfp\b|quarterfinal|semifinal|championship|\bbowl\b)/i.test(
      trimmed
    ) && /\b\d+\b/.test(trimmed)
  );
}

/**
 * Whether a raw schedule team label denotes an UNRESOLVED participant rather than
 * a real team: empty, "TBD", a "Winner of …" derivation, a synthetic postseason
 * slot label, or any label {@link isLikelyInvalidTeamLabel} rejects. This is the
 * single label-level placeholder test shared by participant building
 * (`buildPlaceholderParticipant`) and game-stats expected-coverage derivation —
 * a game whose side is still a placeholder is not expected to produce stats yet.
 */
export function isPlaceholderTeamLabel(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return true;
  if (/^winner of /i.test(trimmed)) return true;
  if (isSyntheticPostseasonSlotLabel(trimmed)) return true;
  return /\btbd\b/i.test(trimmed) || isLikelyInvalidTeamLabel(trimmed);
}
