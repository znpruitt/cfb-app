export type ConferenceChampionshipSlot = {
  title: string;
  slug: string;
  aliases: string[];
};

export const CONFERENCE_CHAMPIONSHIP_SLOTS: ConferenceChampionshipSlot[] = [
  { title: 'ACC', slug: 'acc', aliases: ['acc', 'atlantic coast', 'atlantic coast conference'] },
  { title: 'SEC', slug: 'sec', aliases: ['sec', 'southeastern', 'southeastern conference'] },
  { title: 'Big Ten', slug: 'big-ten', aliases: ['big ten', 'b1g', 'bigten'] },
  { title: 'Big 12', slug: 'big-12', aliases: ['big 12', 'big12'] },
  {
    title: 'AAC',
    slug: 'aac',
    aliases: [
      'aac',
      'american athletic',
      'american athletic conference',
      'the american',
      'american',
    ],
  },
  {
    title: 'C-USA',
    slug: 'c-usa',
    aliases: ['c-usa', 'cusa', 'conference usa', 'conference u s a'],
  },
  {
    title: 'MAC',
    slug: 'mac',
    aliases: ['mac', 'mid-american', 'mid american', 'mid-american conference'],
  },
  { title: 'MWC', slug: 'mwc', aliases: ['mwc', 'mountain west', 'mountain west conference'] },
  { title: 'Sun Belt', slug: 'sun-belt', aliases: ['sun belt', 'sun belt conference'] },
];

export function normalizeConferenceIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchConferenceChampionshipSlotByConference(
  conference: string | null | undefined
): ConferenceChampionshipSlot | null {
  const normalizedConference = normalizeConferenceIdentity(conference);
  if (!normalizedConference) return null;

  return (
    CONFERENCE_CHAMPIONSHIP_SLOTS.find((slot) =>
      slot.aliases.some((alias) => normalizeConferenceIdentity(alias) === normalizedConference)
    ) ?? null
  );
}

export function matchConferenceChampionshipSlotByText(
  text: string | null | undefined
): ConferenceChampionshipSlot | null {
  const normalizedText = normalizeConferenceIdentity(text);
  if (!normalizedText) return null;

  // Aliases match COMPLETE normalized tokens or token phrases, never arbitrary
  // substrings: normalization collapses every non-alphanumeric run to a single
  // space, so padding both sides with spaces makes `includes` a whole-token
  // phrase test. The 2024 archive corruption came from the bare-substring
  // predecessor here reading the `sec` inside "Second Round" as the SEC alias
  // (PLATFORM-086H3E4). Slot iteration order is unchanged — first match wins,
  // exactly as before.
  const paddedText = ` ${normalizedText} `;
  return (
    CONFERENCE_CHAMPIONSHIP_SLOTS.find((slot) =>
      slot.aliases.some((alias) => paddedText.includes(` ${normalizeConferenceIdentity(alias)} `))
    ) ?? null
  );
}
