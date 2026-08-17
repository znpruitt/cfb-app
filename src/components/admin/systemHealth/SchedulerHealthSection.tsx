import React from 'react';

import type { SchedulerDeliveryHealthRow } from '@/lib/server/schedulerDeliveryHealth';
import {
  deliveryRowStatus,
  deliveryStateDisplay,
  executionResultDisplay,
  formatMoment,
  PANEL_DOT_CLASS,
  schedulerJobLabel,
  schedulerSourceLabel,
  summarizeReceiptTarget,
  TONE_TEXT_CLASS,
} from './systemHealthPresentation';

// The whole compact row is the <summary>; the forensic <dl> renders full-width
// BELOW it, so opening a row never shifts the trigger or reflows the row grid.
const summaryClass =
  'grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-3 rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden';
const detailTriggerClass =
  'shrink-0 whitespace-nowrap text-[11px] text-gray-400 group-open:text-gray-600 dark:text-zinc-500 dark:group-open:text-zinc-300';

/**
 * PLATFORM-086F2G — scheduler delivery + execution: seven ALWAYS-VISIBLE compact
 * rows. Each row is a <details> whose <summary> IS the compact status line
 * (delivery stoplight + label, execution result, latest invocation time) and a
 * fixed right-aligned "Details" trigger; the forensic <dl> opens as a full-width
 * block beneath without moving the trigger. Delivery and execution stay separate.
 */
export default function SchedulerHealthSection({
  jobs,
  nowMs,
}: {
  jobs: SchedulerDeliveryHealthRow[];
  nowMs: number;
}): React.ReactElement {
  return (
    <section aria-labelledby="sh-scheduler-heading" className="space-y-1">
      <h2
        id="sh-scheduler-heading"
        className="text-sm font-semibold text-gray-900 dark:text-zinc-100"
      >
        Scheduler delivery
      </h2>
      <ul className="divide-y divide-gray-200 dark:divide-zinc-800">
        {jobs.map((row) => {
          const delivery = deliveryStateDisplay(row.deliveryState);
          const deliveryStatus = deliveryRowStatus(row.deliveryState);
          const receipt = row.receipt;
          const execution = receipt ? executionResultDisplay(receipt.result) : null;
          return (
            <li key={row.job}>
              <details className="group">
                <summary className={summaryClass}>
                  <div className="flex min-w-0 flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                    {/* Line 1 (mobile): identity + delivery stoplight. */}
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`text-xs leading-none ${PANEL_DOT_CLASS[deliveryStatus]}`}
                      >
                        ●
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                        {schedulerJobLabel(row.job)}
                      </span>
                      <span className={`text-xs ${TONE_TEXT_CLASS[delivery.tone]}`}>
                        {delivery.label}
                      </span>
                    </div>
                    {/* Line 2 (mobile): execution + time. */}
                    <div className="flex items-center gap-3 pl-5 text-xs sm:pl-0">
                      {execution ? (
                        <span className={TONE_TEXT_CLASS[execution.tone]}>{execution.label}</span>
                      ) : (
                        // A null receipt is not always "no receipt": distinguish a
                        // genuinely missing delivery from a malformed (invalid) or
                        // unreadable (unavailable) receipt (they are distinct states).
                        <span className="text-gray-400 dark:text-zinc-500">
                          {noReceiptExecutionLabel(row.deliveryState)}
                        </span>
                      )}
                      <span className="text-gray-400 dark:text-zinc-500">
                        {formatMoment(receipt?.startedAt, nowMs)}
                      </span>
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
                  <Detail label="Source" value={schedulerSourceLabel(row.source)} />
                  <Detail label="Cadence" value={row.cadenceLabel} />
                  <Detail
                    label="Required slot"
                    value={formatMoment(row.requiredStartedAt, nowMs)}
                  />
                  {receipt && <Detail label="Reason" value={receipt.reason} />}
                  {receipt && (
                    <Detail
                      label="Provider request"
                      value={receipt.providerCallAttempted ? 'attempted' : 'not attempted'}
                    />
                  )}
                  {receipt && (
                    <Detail label="Completed" value={formatMoment(receipt.completedAt, nowMs)} />
                  )}
                  {receipt && <Detail label="Invocation id" value={receipt.invocationId} />}
                  {/* WHICH BUILD executed this run. Since production promotion
                      became manual (deployment-runbook §6b), "merged" and
                      "running" are different facts — and these two lifecycle jobs
                      perform season-state writes, so an operator needs to see the
                      commit that actually ran rather than assume it is `main`. */}
                  {receipt && (
                    <Detail
                      label="Built from"
                      value={receipt.buildCommitSha ?? 'not reported by the runtime'}
                    />
                  )}
                  {receipt && (
                    <Detail label="Target" value={summarizeReceiptTarget(receipt.target)} />
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

/** Execution-column text when there is no parsed receipt — reserving "no receipt"
 *  for a genuinely missing delivery, distinct from a malformed or unreadable one. */
function noReceiptExecutionLabel(
  deliveryState: SchedulerDeliveryHealthRow['deliveryState']
): string {
  switch (deliveryState) {
    case 'invalid':
      return 'receipt unparseable';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'no receipt';
  }
}

function Detail({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex gap-1">
      <dt className="shrink-0 text-gray-400 dark:text-zinc-500">{label}:</dt>
      <dd className="min-w-0 break-words text-gray-600 dark:text-zinc-300">{value}</dd>
    </div>
  );
}
