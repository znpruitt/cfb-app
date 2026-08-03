import React from 'react';

import type { SystemHealthViewModel } from '@/lib/server/systemHealth';
import { formatMoment } from './systemHealthPresentation';
import RefreshViewButton from './RefreshViewButton';

/**
 * PLATFORM-086F2G — compact operational header (no decorative health hero, no
 * duplicated verdict). This is a CURRENT-status surface: the header carries only
 * the title, generated time, and Refresh view. The at-a-glance verdict is owned
 * by the Overall stoplight tile; the detailed problems/actions by Prioritized
 * issues. There is no year selector — the operational season is resolved
 * server-side; the refresh control rebuilds the server model.
 */
export default function SystemHealthHeader({
  model,
  nowMs,
}: {
  model: SystemHealthViewModel;
  nowMs: number;
}): React.ReactElement {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-zinc-100">System Health</h1>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Current platform status · generated {formatMoment(model.generatedAt, nowMs)}
        </p>
      </div>
      <RefreshViewButton />
    </header>
  );
}
