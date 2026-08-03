import React from 'react';

import type { SystemHealthPanel } from '@/lib/server/systemHealthPanels';
import { formatMoment, PANEL_DOT_CLASS, PANEL_STATE_LABEL_CLASS } from './systemHealthPresentation';

/**
 * PLATFORM-086F2G — the stoplight status grid: the primary, few-seconds-to-read
 * signal. Each tile shows a colored indicator + an accessible state label (never
 * color alone), one concise sentence, and an optional timestamp. Repair actions
 * live ONLY in Prioritized issues (the single canonical actionable surface), so
 * tiles carry no repair link. Status is server-derived (`model.panels`); this
 * component only maps status → visual treatment. Two columns from ~360px, three
 * at desktop; one column only at the narrowest widths.
 */
export default function SystemHealthStoplightPanel({
  panels,
  nowMs,
}: {
  panels: SystemHealthPanel[];
  nowMs: number;
}): React.ReactElement {
  return (
    <section
      aria-label="System status"
      className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3"
    >
      {panels.map((panel) => (
        <div
          key={panel.key}
          className="flex flex-col gap-1 rounded-md border border-gray-200 p-3 dark:border-zinc-800"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`text-sm leading-none ${PANEL_DOT_CLASS[panel.status]}`}
            >
              ●
            </span>
            <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">
              {panel.title}
            </span>
          </div>
          <div className={`text-sm font-semibold ${PANEL_STATE_LABEL_CLASS[panel.status]}`}>
            {panel.stateLabel}
          </div>
          <p className="text-xs text-gray-600 dark:text-zinc-400">{panel.detail}</p>
          {panel.timestamp && (
            <p className="text-[11px] text-gray-400 dark:text-zinc-500">
              {panel.timestampPrefix ? `${panel.timestampPrefix} ` : ''}
              {formatMoment(panel.timestamp, nowMs)}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
