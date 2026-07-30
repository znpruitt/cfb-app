import React from 'react';

import { MAINTENANCE_ACTIONS, type MaintenanceActionId } from '@/lib/admin/maintenanceActions';

/**
 * PLATFORM-086F2C — the compact per-action cost/scope disclosure rendered
 * adjacent to every Data Maintenance & Recovery action. A native `<details>`
 * disclosure: keyboard-accessible by default, nothing hidden behind hover, and
 * collapsed at rest so the page stays dense. Neutral typography/borders only —
 * action classes are identified by text, never by decorative color.
 */
export default function MaintenanceActionDetails({
  action,
  targetScope,
}: {
  action: MaintenanceActionId;
  /** Human-readable current target from the panel's live controls. */
  targetScope: string;
}): React.ReactElement {
  const descriptor = MAINTENANCE_ACTIONS[action];
  const emergency = descriptor.actionClass === 'emergency';

  return (
    <details className="rounded border border-gray-200 bg-gray-50 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
      <summary className="cursor-pointer select-none px-2 py-1 font-medium text-gray-600 dark:text-zinc-300">
        Cost and scope{emergency ? ' (emergency — high provider cost)' : ''}
      </summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-2 pb-2 pt-1">
        <dt className="font-medium text-gray-500 dark:text-zinc-500">Class</dt>
        <dd>
          {descriptor.actionClass}
          {emergency ? ' — high provider cost; operator recovery only' : ''}
        </dd>
        <dt className="font-medium text-gray-500 dark:text-zinc-500">Provider</dt>
        <dd>{descriptor.provider}</dd>
        <dt className="font-medium text-gray-500 dark:text-zinc-500">Nominal cost</dt>
        <dd>{descriptor.nominalCost}</dd>
        <dt className="font-medium text-gray-500 dark:text-zinc-500">Current target</dt>
        <dd>{targetScope}</dd>
        <dt className="font-medium text-gray-500 dark:text-zinc-500">Durable mutations</dt>
        <dd>{descriptor.durableMutations.join('; ')}</dd>
        <dt className="font-medium text-gray-500 dark:text-zinc-500">Automation owner</dt>
        <dd>{descriptor.automationOwner}</dd>
      </dl>
    </details>
  );
}
