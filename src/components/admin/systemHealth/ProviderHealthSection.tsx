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
                  <Detail label="Scope" value={scopeKeyOf(summaryFact) ?? row.canonicalScopeKey} />
                  <Detail label="Last success" value={lastSuccessDetail(summaryFact, nowMs)} />
                  {summaryFact !== row.canonicalStatus && (
                    <Detail
                      label="Canonical outcome"
                      value={canonicalOutcomeDetail(row.canonicalStatus, row.canonicalScopeKey)}
                    />
                  )}
                  <Detail label="Latest activity" value={latestActivityDetail(row, nowMs)} />
                  {summaryFact.state === 'available' && (
                    <>
                      {(summaryFact.status.errorCode || summaryFact.status.errorStatus != null) && (
                        <Detail label="Error" value={errorDetail(summaryFact.status)} />
                      )}
                      {summaryFact.status.partialFailure && (
                        <Detail
                          label="Failed partitions"
                          value={summaryFact.status.failedPartitions.join(', ') || 'yes'}
                        />
                      )}
                      {summaryFact.status.rowsCommitted != null && (
                        <Detail
                          label="Rows committed"
                          value={String(summaryFact.status.rowsCommitted)}
                        />
                      )}
                      {summaryFact.status.durationMs != null && (
                        <Detail label="Duration" value={`${summaryFact.status.durationMs} ms`} />
                      )}
                    </>
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
 * Which fact the SUMMARY LINE describes (Item 88). Nothing else changes.
 *
 * `scores` and `game-stats` refresh per week partition, so the canonical record
 * this line read is usually never written — producing "No refresh history" on a
 * dataset that refreshed minutes earlier, beside a freshness dot reading
 * "Current".
 *
 * DELIBERATELY THIS SMALL. An earlier version also restructured the detail
 * disclosure to show both records under per-scope labels. That broke three things
 * in rows this item never touched: it hid "Latest activity" for Schedule and Odds,
 * whose targeted refreshes live there; it labelled the canonical scope "Year
 * rollup" for Odds (an `odds-target`) and Conferences (`global`), where that is
 * simply false; and it dropped each record's explicit outcome. The disclosure
 * already did this job correctly — `latestActivityDetail` prints
 * `outcome · time · scopeKey` — so the fix was one line above it, not a rewrite.
 */
/**
 * The scope of the record these details DESCRIBE, which for a partition-scoped
 * dataset is not the canonical one. Printing "Canonical scope: scores:year:2026"
 * above an error read from a week record would send an operator to repair the
 * whole season.
 */
function scopeKeyOf(fact: CanonicalRefreshFact): string | null {
  return fact.state === 'available' ? fact.status.scopeKey : null;
}

/**
 * The canonical record's own outcome, kept on the row whenever the summary
 * describes something else. A canonical attempt left `in-progress`, or failed
 * without a sanitized code, raises a warning through `providerAttemptIssues`
 * that would otherwise have no explanation anywhere on the row it names.
 */
function canonicalOutcomeDetail(fact: CanonicalRefreshFact, scopeKey: string): string {
  if (fact.state === 'invalid') return `malformed · ${scopeKey}`;
  if (fact.state === 'unavailable') return 'unavailable';
  if (fact.state === 'absent') return `none · ${scopeKey}`;
  const outcome = attemptOutcomeDisplay(fact.status.latestAttemptOutcome).label;
  // The CODE too, not just the word. A canonical failure whose forensic detail is
  // only reachable through the fault block would be invisible once the summary
  // describes a newer scoped record — which is the gap this line exists to close.
  const code =
    fact.status.errorCode || fact.status.errorStatus != null ? errorDetail(fact.status) : null;
  return [outcome, code, scopeKey].filter(Boolean).join(' · ');
}

function summaryFactFor(row: ProviderDatasetHealthRow): CanonicalRefreshFact {
  if (!isPartitionScopedDataset(row.dataset)) return row.canonicalStatus;
  // A malformed canonical record is a fact worth showing rather than skipping.
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

function latestActivityDetail(row: ProviderDatasetHealthRow, nowMs: number): string {
  const fact = row.latestScopedActivity;
  if (fact.state !== 'available') return fact.state === 'unavailable' ? 'unavailable' : 'none';
  const outcome = attemptOutcomeDisplay(fact.status.latestAttemptOutcome).label;
  const when = fact.status.lastAttemptAt ? formatMoment(fact.status.lastAttemptAt, nowMs) : '—';
  // Include the scope so a noncanonical target (a specific scores week, a
  // filtered Odds request) is identifiable (exact-target invariant).
  return `${outcome} · ${when} · ${fact.status.scopeKey}`;
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
