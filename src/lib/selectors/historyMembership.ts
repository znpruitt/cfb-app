import { parseOwnersCsv } from '../parseOwnersCsv.ts';
import type { SeasonArchive } from '../seasonArchive.ts';
import { NO_CLAIM_OWNER } from '../standings.ts';

type HistoryActiveOwnersInput = {
  archives: SeasonArchive[];
  confirmedOwners: readonly string[];
};

/**
 * Resolves the owner set used by History's "Active only" record filter.
 *
 * Current confirmed membership is authoritative. During the rollover window,
 * before the new season has a confirmed roster, the most recent archive is the
 * best available answer: owners remain active until a later roster says they
 * left. Falling back to the union of every archive would mark every former
 * owner active and make the filter a visible no-op.
 */
export function selectHistoryActiveOwners({
  archives,
  confirmedOwners,
}: HistoryActiveOwnersInput): Set<string> {
  const confirmed = cleanOwners(confirmedOwners);
  if (confirmed.size > 0) return confirmed;

  const latestArchive = archives.reduce<SeasonArchive | null>(
    (latest, archive) => (latest === null || archive.year > latest.year ? archive : latest),
    null
  );
  if (!latestArchive) return new Set<string>();

  const snapshotOwners = cleanOwners(
    parseOwnersCsv(latestArchive.ownerRosterSnapshot).map((row) => row.owner)
  );
  if (snapshotOwners.size > 0) return snapshotOwners;

  return cleanOwners(latestArchive.finalStandings.map((row) => row.owner));
}

function cleanOwners(owners: readonly string[]): Set<string> {
  return new Set(
    owners.map((owner) => owner.trim()).filter((owner) => owner !== '' && owner !== NO_CLAIM_OWNER)
  );
}
