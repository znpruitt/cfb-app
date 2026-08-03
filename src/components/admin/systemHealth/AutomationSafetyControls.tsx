'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import {
  getProviderDatasetDescriptor,
  PROVIDER_DATASETS,
  type ProviderDataset,
} from '@/lib/providerDatasets';
import { datasetControlMode } from '@/components/admin/manualRefresh';
import type { AutomationHealth } from '@/lib/server/systemHealthIssues';

/**
 * PLATFORM-086F2G — the ONLY mutation surface on System Health: global provider
 * pause and per-dataset automation toggles. Data comes from the server model
 * (`model.automation`); this client component only mutates via the unchanged
 * `POST /api/admin/provider-status` actions and, on success, refreshes the server
 * model. It never optimistically claims a setting changed, disables the specific
 * control while pending, preserves prior-good visible state on failure, and keeps
 * PLATFORM-086I feedback (attempt-scoped, `role="alert"`, control-linked
 * `aria-describedby`, no stale result from a superseded attempt).
 */

type ActionState = { status: 'idle' | 'loading' | 'success' | 'error'; message?: string };

const GLOBAL_PAUSE_ERROR_ID = 'sh-global-pause-error';
const datasetToggleErrorId = (dataset: ProviderDataset): string => `sh-toggle-${dataset}-error`;

const buttonClass =
  'rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

export default function AutomationSafetyControls({
  automation,
  readOnly = false,
}: {
  automation: AutomationHealth;
  /** DEV fixture only: render controls non-interactive; the POST path is never wired. */
  readOnly?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  // Per-control attempt sequence: a superseded attempt's result never overwrites
  // a newer one's (PLATFORM-086I "no stale result from a superseded attempt").
  const seqRef = useRef<Record<string, number>>({});

  const mutate = useCallback(
    async (body: Record<string, unknown>, key: string) => {
      const seq = (seqRef.current[key] ?? 0) + 1;
      seqRef.current[key] = seq;
      setActions((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      try {
        const res = await fetch('/api/admin/provider-status', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            ...(requireAdminAuthHeaders() as Record<string, string>),
          },
          body: JSON.stringify(body),
        });
        if (seqRef.current[key] !== seq) return; // superseded
        if (!res.ok) {
          // Stable, status-based message only — never the response body, so an
          // arbitrary error payload can never render to the operator.
          setActions((prev) => ({
            ...prev,
            [key]: { status: 'error', message: `Update failed (HTTP ${res.status})` },
          }));
          return;
        }
        setActions((prev) => ({ ...prev, [key]: { status: 'success' } }));
        // Rebuild the server model so the confirmed state renders from the source.
        router.refresh();
      } catch {
        if (seqRef.current[key] !== seq) return; // superseded
        setActions((prev) => ({
          ...prev,
          [key]: { status: 'error', message: 'Update failed (network error)' },
        }));
      }
    },
    [router]
  );

  if (automation.state === 'unavailable') {
    return (
      <section aria-labelledby="sh-automation-heading" className="space-y-2">
        <h2
          id="sh-automation-heading"
          className="text-sm font-semibold text-gray-900 dark:text-zinc-100"
        >
          Automation safety
        </h2>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Automation settings are unavailable; pause/enable state is unknown and is not assumed to
          be open.
        </p>
      </section>
    );
  }

  const globalPause = automation.globalPause;
  const pauseAction = actions['global-pause'];
  const consumedDatasets = PROVIDER_DATASETS.filter(
    (dataset) => datasetControlMode(getProviderDatasetDescriptor(dataset)) === 'interactive'
  );

  return (
    <section aria-labelledby="sh-automation-heading" className="space-y-2">
      <h2
        id="sh-automation-heading"
        className="text-sm font-semibold text-gray-900 dark:text-zinc-100"
      >
        Automation safety
      </h2>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm text-gray-800 dark:text-zinc-200">Global automatic refresh</span>{' '}
          <span
            className={
              globalPause
                ? 'text-xs font-medium text-gray-500 dark:text-zinc-400'
                : 'text-xs font-medium text-green-700 dark:text-green-400'
            }
          >
            {globalPause ? 'Paused' : 'On'}
          </span>
        </div>
        <button
          className={buttonClass}
          disabled={readOnly || pauseAction?.status === 'loading'}
          aria-describedby={pauseAction?.status === 'error' ? GLOBAL_PAUSE_ERROR_ID : undefined}
          // readOnly (fixture): no handler is attached, so the POST path is
          // unreachable — not merely visually disabled.
          onClick={
            readOnly
              ? undefined
              : () =>
                  void mutate({ action: 'set-global-pause', paused: !globalPause }, 'global-pause')
          }
        >
          {globalPause ? 'Resume automation' : 'Pause automation'}
        </button>
        {pauseAction?.status === 'error' && (
          <p
            id={GLOBAL_PAUSE_ERROR_ID}
            role="alert"
            className="w-full text-[11px] text-red-700 dark:text-red-400"
          >
            Pause update failed: {pauseAction.message}
          </p>
        )}
      </div>

      <ul className="space-y-1">
        {consumedDatasets.map((dataset) => {
          const descriptor = getProviderDatasetDescriptor(dataset);
          const enabled = automation.datasets[dataset]?.enabled ?? false;
          const key = `toggle:${dataset}`;
          const action = actions[key];
          return (
            <li key={dataset} className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2 text-gray-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={readOnly || action?.status === 'loading'}
                  readOnly={readOnly}
                  aria-describedby={
                    action?.status === 'error' ? datasetToggleErrorId(dataset) : undefined
                  }
                  // readOnly (fixture): no handler is attached, so the POST path is
                  // unreachable — not merely visually disabled.
                  onChange={
                    readOnly
                      ? undefined
                      : (e) =>
                          void mutate(
                            { action: 'set-dataset-enabled', dataset, enabled: e.target.checked },
                            key
                          )
                  }
                />
                {descriptor.label} automatic refresh
              </label>
              {action?.status === 'error' && (
                <p
                  id={datasetToggleErrorId(dataset)}
                  role="alert"
                  className="w-full text-[11px] text-red-700 dark:text-red-400"
                >
                  Auto-refresh update failed: {action.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-gray-400 dark:text-zinc-500">
        Pausing halts noncritical automatic provider polling; manual admin refresh and
        lifecycle-critical operations (season transition/rollover, postseason-boundary schedule
        maintenance) stay exempt. Cadence is fixed in code and not editable here.
      </p>
    </section>
  );
}
