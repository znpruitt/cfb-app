import React from 'react';

import type { SystemHealthQuota, StorageHealthFact } from '@/lib/server/systemHealthIssues';
import type { PanelStatus } from '@/lib/server/systemHealthPanels';
import {
  formatCount,
  formatMoment,
  PANEL_DOT_CLASS,
  PANEL_STATE_LABEL_CLASS,
} from './systemHealthPresentation';

/**
 * PLATFORM-086F2G — quota & storage: three ALWAYS-VISIBLE compact rows (CFBD,
 * Odds, Durable storage), each with a stoplight + plain-language state + one
 * value line. Statuses map the model's already-derived quota classification /
 * storage fact to a color (presentation) — no new health policy here. Nothing is
 * claimed beyond what the model proves (unavailable / awaiting / misconfigured
 * remain truthful).
 */
export default function QuotaStorageSection({
  quota,
  storage,
  nowMs,
}: {
  quota: SystemHealthQuota;
  storage: StorageHealthFact;
  nowMs: number;
}): React.ReactElement {
  const rows = [cfbdRow(quota.cfbd), oddsRow(quota.odds, nowMs), storageRow(storage)];
  return (
    <section aria-labelledby="sh-quota-heading" className="space-y-1">
      <h2 id="sh-quota-heading" className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
        Quota &amp; storage
      </h2>
      <ul className="divide-y divide-gray-200 dark:divide-zinc-800">
        {rows.map((row) => (
          <li
            key={row.title}
            className="flex flex-col gap-x-4 gap-y-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`text-xs leading-none ${PANEL_DOT_CLASS[row.status]}`}
              >
                ●
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                {row.title}
              </span>
              <span className={`text-xs ${PANEL_STATE_LABEL_CLASS[row.status]}`}>
                {row.stateLabel}
              </span>
            </div>
            <span className="pl-5 text-xs text-gray-500 dark:text-zinc-400 sm:pl-0">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Row = { title: string; status: PanelStatus; stateLabel: string; value: string };

function cfbdRow(cfbd: SystemHealthQuota['cfbd']): Row {
  if (cfbd.state === 'unavailable') {
    return {
      title: 'CFBD quota',
      status: 'yellow',
      stateLabel: 'Unknown',
      value: 'Usage unavailable',
    };
  }
  if (cfbd.classification === 'untrustworthy') {
    return {
      title: 'CFBD quota',
      status: 'yellow',
      stateLabel: 'Attention needed',
      value: 'Usage untrustworthy',
    };
  }
  if (cfbd.classification === 'reserve-reached') {
    return {
      title: 'CFBD quota',
      status: 'yellow',
      stateLabel: 'Reserve reached',
      value: `${formatCount(cfbd.remaining)} remaining (reserve ${formatCount(cfbd.reserve)})`,
    };
  }
  return {
    title: 'CFBD quota',
    status: 'green',
    stateLabel: 'Healthy',
    value: `${formatCount(cfbd.remaining)} remaining`,
  };
}

function oddsRow(odds: SystemHealthQuota['odds'], nowMs: number): Row {
  if (odds.state === 'unavailable') {
    return {
      title: 'Odds quota',
      status: 'yellow',
      stateLabel: 'Unknown',
      value: 'Snapshot unavailable',
    };
  }
  if (odds.state === 'absent') {
    return {
      title: 'Odds quota',
      status: 'gray',
      stateLabel: 'Awaiting activity',
      value: 'No snapshot yet',
    };
  }
  if (odds.classification === 'reserve-reached') {
    return {
      title: 'Odds quota',
      status: 'yellow',
      stateLabel: 'Reserve reached',
      value: `${formatCount(odds.remaining)} remaining · snapshot ${formatMoment(odds.capturedAt, nowMs)}`,
    };
  }
  return {
    title: 'Odds quota',
    status: 'green',
    stateLabel: 'Healthy',
    value: `${formatCount(odds.remaining)} remaining · snapshot ${formatMoment(odds.capturedAt, nowMs)}`,
  };
}

function storageRow(storage: StorageHealthFact): Row {
  if (storage.state === 'unavailable') {
    return {
      title: 'Durable storage',
      status: 'yellow',
      stateLabel: 'Unknown',
      value: 'Status unavailable',
    };
  }
  if (storage.mode === 'production-misconfigured') {
    return {
      title: 'Durable storage',
      status: 'red',
      stateLabel: 'Action required',
      value: 'Production storage is misconfigured',
    };
  }
  // Configuration mode only — never asserted as database liveness.
  const value = storage.mode === 'postgres' ? 'Postgres configured' : 'File fallback';
  return { title: 'Durable storage', status: 'green', stateLabel: 'Operational', value };
}
