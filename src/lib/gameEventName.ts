function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function looksLikeLocation(value: string): boolean {
  return /^[A-Za-z .'-]+,\s*[A-Z]{2,3}$/.test(value);
}

export function deriveDisplayEventName(
  notes: string | null | undefined,
  matchupLabel?: string | null
): string | null {
  const normalizedNotes = normalizeText(notes);
  const normalizedMatchup = normalizeText(matchupLabel);

  if (!normalizedNotes) return null;
  if (/^(tbd|n\/a|none)$/i.test(normalizedNotes)) return null;
  if (
    normalizedMatchup &&
    normalizedNotes.localeCompare(normalizedMatchup, undefined, { sensitivity: 'accent' }) === 0
  ) {
    return null;
  }
  if (looksLikeLocation(normalizedNotes)) return null;

  return normalizedNotes;
}
