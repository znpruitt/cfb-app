function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function looksLikeLocation(value: string): boolean {
  return /^[A-Za-z .'-]+,\s*[A-Z]{2,3}$/.test(value);
}

function isDisplayable(value: string, matchupLabel: string): boolean {
  if (!value) return false;
  if (/^(tbd|n\/a|none)$/i.test(value)) return false;
  if (looksLikeLocation(value)) return false;
  if (
    matchupLabel &&
    value.localeCompare(matchupLabel, undefined, { sensitivity: 'accent' }) === 0
  ) {
    return false;
  }

  return true;
}

export function deriveDisplayEventName(
  label: string | null | undefined,
  notes: string | null | undefined,
  matchupLabel?: string | null
): string | null {
  const normalizedLabel = normalizeText(label);
  const normalizedNotes = normalizeText(notes);
  const normalizedMatchup = normalizeText(matchupLabel);

  if (isDisplayable(normalizedLabel, normalizedMatchup)) return normalizedLabel;
  if (isDisplayable(normalizedNotes, normalizedMatchup)) return normalizedNotes;

  return null;
}
