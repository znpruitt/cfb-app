import { clamp, parseCSV } from './csv.ts';

export type OwnerRow = { team: string; owner: string };

export function parseOwnersCsv(text: string): OwnerRow[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const header = rows[0]!.map((h) => h.toLowerCase());
  const teamIdx = header.findIndex((h) => h.includes('team'));
  const ownerIdx = header.findIndex((h) => h.includes('owner'));

  return rows
    .slice(1)
    .map((r) => {
      const team = clamp(teamIdx >= 0 ? r[teamIdx] : r[0]);
      const owner = clamp(ownerIdx >= 0 ? r[ownerIdx] : r[1]);
      return { team, owner };
    })
    .filter((x) => x.team && x.owner);
}
