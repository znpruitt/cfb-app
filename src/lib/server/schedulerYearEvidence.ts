import { upstreamFaultLabel, type UpstreamFaultClass } from '@/lib/api/upstreamFaultClass';

/**
 * PLATFORM-126B — the bounded rendering of ONE year's failure evidence, shared by
 * the System Health issue explanation and the receipt-target summary so the two
 * surfaces cannot drift into two vocabularies.
 *
 * Returns `''` for a year that did not fail, and for a LEGACY receipt whose
 * entries carry no outcome — so a clean run and a pre-widening record both
 * render exactly as they did before, which is the same restraint the refusal and
 * sweep counters already use. Never renders an error message, URL, or payload:
 * the reason is a closed token and the class is `kind` plus an optional status.
 */
export function formatYearFailureEvidence(entry: {
  result: string | null;
  reason: string | null;
  failedPartitions: ReadonlyArray<{ seasonType: string; upstream: UpstreamFaultClass | null }>;
}): string {
  if (entry.result !== 'failure' && entry.result !== 'partial') return '';
  const partitions = entry.failedPartitions
    .map((partition) =>
      // A partition with no class did not fail in transport — render it bare
      // rather than implying its transport evidence was lost.
      partition.upstream === null
        ? partition.seasonType
        : `${partition.seasonType} ${upstreamFaultLabel(partition.upstream)}`
    )
    .join(', ');
  const reason = entry.reason === null ? entry.result : `${entry.result} / ${entry.reason}`;
  return partitions.length > 0 ? `${reason} · ${partitions}` : reason;
}
