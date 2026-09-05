import React from 'react';

import { getProviderDatasetDescriptor, isPartitionScopedDataset } from '@/lib/providerDatasets';
import type { AutomationHealth } from '@/lib/server/systemHealthIssues';
import type {
  CanonicalRefreshFact,
  SafeProviderRefreshStatus,
} from '@/lib/server/providerRefreshHealth';
import type { ProviderDatasetHealthRow } from '@/lib/server/systemHealth';
import {
  attemptOutcomeDisplay,
  formatMoment,
  PANEL_DOT_CLASS,
  PANEL_STATE_LABEL_CLASS,
  TONE_TEXT_CLASS,
  type StateTone,
} from './systemHealthPresentation';

const summaryClass =
  'grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-3 rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden';
const detailTriggerClass =
  'shrink-0 whitespace-nowrap text-[11px] text-gray-400 group-open:text-gray-600 dark:text-zinc-500 dark:group-open:text-zinc-300';

/**
 * PLATFORM-086F2G — provider data: six ALWAYS-VISIBLE compact rows. Each row is a
 * <details> whose <summary> IS the compact status line (freshness stoplight,
 * latest refresh OUTCOME, automation state, timestamp — all SEPARATE facts) plus
 * a fixed right-aligned "Details" trigger; the forensic <dl> opens full-width
 * beneath without moving the trigger. Rows are factual status surfaces only —
 * repair actions live solely in Prioritized issues (the canonical action surface).
 */
export default function ProviderHealthSection({
  datasets,
  automation,
  year,
  nowMs,
}: {
  datasets: ProviderDatasetHealthRow[];
  automation: AutomationHealth;
  year: number;
  nowMs: number;
}): React.ReactElement {
  return (
    <section aria-labelledby="sh-provider-heading" className="space-y-1">
      <div>
        <h2
          id="sh-provider-heading"
          className="text-sm font-semibold text-gray-900 dark:text-zinc-100"
        >
          Provider data
        </h2>
        {/* Only the provider-data axis is season-scoped; name the operational season. */}
        <p className="text-xs text-gray-500 dark:text-zinc-400">{year} operational season</p>
      </div>
      <ul className="divide-y divide-gray-200 dark:divide-zinc-800">
        {datasets.map((row) => {
          const descriptor = getProviderDatasetDescriptor(row.dataset);
          const summaryFact = summaryFactFor(row);
          const outcome = refreshOutcomeDisplay(summaryFact);
          const timestamp = canonicalTimestamp(summaryFact);
          return (
            <li key={row.dataset}>
              <details className="group">
                <summary className={summaryClass}>
                  <div className="flex min-w-0 flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                    {/* Line 1 (mobile): identity + freshness stoplight. */}
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`text-xs leading-none ${PANEL_DOT_CLASS[row.freshness.status]}`}
                      >
                        ●
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                        {descriptor.label}
                      </span>
                      <span className={`text-xs ${PANEL_STATE_LABEL_CLASS[row.freshness.status]}`}>
                        {row.freshness.label}
                      </span>
                    </div>
                    {/* Line 2 (mobile): refresh outcome + automation + time. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-xs sm:pl-0">
                      <span className={TONE_TEXT_CLASS[outcome.tone]}>{outcome.label}</span>
                      <span className="text-gray-400 dark:text-zinc-500">
                        {datasetAutomationLabel(automation, row.dataset)}
                      </span>
                      {timestamp && (
                        <span className="text-gray-400 dark:text-zinc-500">
                          {formatMoment(timestamp, nowMs)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={detailTriggerClass}>
                    Details{' '}
                    <span className="inline-block transition-transform group-open:rotate-90">
                      ›
                    </span>
                  </span>
                </summary>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 pb-2 pl-5 text-[11px] text-gray-500 dark:text-zinc-400 sm:grid-cols-2">
                  <Detail label="Provider" value={descriptor.provider} />
                  <Detail label="Cache" value={row.cacheState} />
                  {/* BOTH records, each named by its scope. An earlier version
                      printed "Canonical scope: scores:year:2026" directly above an
                      Error read from a WEEK record, so an operator diagnosing a
                      failed week would reasonably have repaired the whole
                      season. */}
                  <ScopedRecordDetails
                    label="Year rollup"
                    scopeKey={row.canonicalScopeKey}
                    fact={row.canonicalStatus}
                    nowMs={nowMs}
                  />
                  {isPartitionScopedDataset(row.dataset) && (
                    <ScopedRecordDetails
                      label="Latest partition"
                      scopeKey={
                        row.latestScopedActivity.state === 'available'
                          ? row.latestScopedActivity.status.scopeKey
                          : null
                      }
                      fact={
                        row.latestScopedActivity.state === 'available'
                          ? { state: 'available', status: row.latestScopedActivity.status }
                          : { state: 'absent' }
                      }
                      nowMs={nowMs}
                    />
                  )}
                  {row.diagnostics.length > 0 && (
                    <Detail
                      label="Diagnostics"
                      value={row.diagnostics.map((d) => d.code).join(', ')}
                    />
                  )}
                </dl>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Which fact this row's outcome line should describe (Item 88).
 *
 * For `scores` and `game-stats` the canonical YEAR record is never written —
 * they refresh per week partition — so reading it produced "No refresh history"
 * on a dataset that had refreshed minutes earlier, printed directly beside a
 * freshness dot reading "Current". That contradiction is the defect the item was
 * filed about; the truth was already on the row in `latestScopedActivity`.
 *
 * Deliberately narrow: only when the canonical record is genuinely ABSENT. An
 * `invalid` or `unavailable` canonical status still surfaces as itself, because
 * a malformed record is a fact worth showing rather than papering over with a
 * partition read.
 */
/**
 * Which fact the SUMMARY line describes (Item 88).
 *
 * For `scores` and `game-stats` the canonical YEAR record is usually not written
 * at all — they refresh per week partition — so reading it produced "No refresh
 * history" on a dataset that refreshed minutes earlier, printed beside a
 * freshness dot reading "Current".
 *
 * NO FAULT CLASSIFICATION HAPPENS HERE, deliberately. An earlier version decided
 * whether the canonical record "carried a fault" and kept it when so. Both
 * reviewers found that wrong in opposite directions: it missed an `in-progress`
 * attempt past the interrupted threshold, and it fired on a stale `hasError`
 * that `beginProviderRefreshAttempt` deliberately preserves through a re-run. It
 * was a second implementation of `attemptFaultIssue`'s judgement — the same
 * re-derivation that got this branch's freshness model reverted. The disclosure
 * shows BOTH records instead, each labelled by scope, so nothing is hidden and
 * nothing has to be classified.
 */
/**
 * One record's details, always named by the scope it came from. Both the year
 * rollup and the latest partition are shown for a partition-scoped dataset, so a
 * fault in either is visible and neither can be mistaken for the other.
 */
function ScopedRecordDetails(props: {
  label: string;
  scopeKey: string | null;
  fact: CanonicalRefreshFact;
  nowMs: number;
}): React.ReactElement {
  const { label, scopeKey, fact, nowMs } = props;
  return (
    <>
      <Detail label={`${label} scope`} value={scopeKey ?? 'none'} />
      <Detail label={`${label} · last success`} value={lastSuccessDetail(fact, nowMs)} />
      {fact.state === 'available' && (
        <>
          {(fact.status.errorCode || fact.status.errorStatus != null) && (
            <Detail label={`${label} · error`} value={errorDetail(fact.status)} />
          )}
          {fact.status.partialFailure && (
            <Detail
              label={`${label} · failed partitions`}
              value={fact.status.failedPartitions.join(', ') || 'yes'}
            />
          )}
          {fact.status.rowsCommitted != null && (
            <Detail label={`${label} · rows committed`} value={String(fact.status.rowsCommitted)} />
          )}
          {fact.status.durationMs != null && (
            <Detail label={`${label} · duration`} value={`${fact.status.durationMs} ms`} />
          )}
        </>
      )}
    </>
  );
}

function summaryFactFor(row: ProviderDatasetHealthRow): CanonicalRefreshFact {
  if (!isPartitionScopedDataset(row.dataset)) return row.canonicalStatus;
  // A malformed canonical record is a fact worth showing rather than skipping past.
  if (row.canonicalStatus.state === 'invalid') return row.canonicalStatus;
  const latest = row.latestScopedActivity;
  return latest.state === 'available'
    ? { state: 'available', status: latest.status }
    : row.canonicalStatus;
}

function refreshOutcomeDisplay(fact: CanonicalRefreshFact): { label: string; tone: StateTone } {
  switch (fact.state) {
    case 'available':
      return attemptOutcomeDisplay(fact.status.latestAttemptOutcome);
    case 'invalid':
      return { label: 'Status malformed', tone: 'warn' };
    case 'absent':
      return { label: 'No refresh history', tone: 'muted' };
    case 'unavailable':
      return { label: 'Status unavailable', tone: 'muted' };
  }
}

// The primary-line timestamp reflects WHEN THE SHOWN OUTCOME happened — the
// latest attempt's resolution/start — NOT a preserved prior `lastSuccessAt`
// (which stays put on a failed/partial/no-op attempt). Historical success is
// exposed separately in the detail disclosure.
function canonicalTimestamp(fact: CanonicalRefreshFact): string | null {
  if (fact.state !== 'available') return null;
  return fact.status.latestAttemptResolvedAt ?? fact.status.lastAttemptAt;
}

function lastSuccessDetail(fact: CanonicalRefreshFact, nowMs: number): string {
  if (fact.state !== 'available' || !fact.status.lastSuccessAt) return '—';
  return formatMoment(fact.status.lastSuccessAt, nowMs);
}

// Sanitized failure detail (validated code/status only — never a raw message).
function errorDetail(status: SafeProviderRefreshStatus): string {
  const code = status.errorCode ?? 'error';
  return status.errorStatus != null ? `${code} (${status.errorStatus})` : code;
}

/** Read-only automation state for a dataset row (toggles live in Automation safety). */
function datasetAutomationLabel(
  automation: AutomationHealth,
  dataset: ProviderDatasetHealthRow['dataset']
): string {
  const descriptor = getProviderDatasetDescriptor(dataset);
  if (!descriptor.autoRefreshSettingConsumed) return 'Manual only';
  if (automation.state === 'unavailable') return 'Automation unknown';
  // A lifecycle-critical dataset's ORDINARY maintenance is what a pause/disable
  // affects; its lifecycle-critical operations keep running (exempt), so say so.
  const lifecycle = descriptor.lifecycleCritical;
  if (automation.globalPause) return lifecycle ? 'Ordinary paused · lifecycle exempt' : 'Paused';
  if (!automation.datasets[dataset]?.enabled) {
    return lifecycle ? 'Ordinary off · lifecycle exempt' : 'Disabled';
  }
  return 'Automatic';
}

function Detail({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex gap-1">
      <dt className="shrink-0 text-gray-400 dark:text-zinc-500">{label}:</dt>
      <dd className="min-w-0 break-words text-gray-600 dark:text-zinc-300">{value}</dd>
    </div>
  );
}
