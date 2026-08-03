import React from 'react';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import type { SystemHealthViewModel } from '@/lib/server/systemHealth';
import SystemHealthHeader from './SystemHealthHeader';
import SystemHealthStoplightPanel from './SystemHealthStoplightPanel';
import SystemHealthIssues from './SystemHealthIssues';
import AutomationSafetyControls from './AutomationSafetyControls';
import SchedulerHealthSection from './SchedulerHealthSection';
import ProviderHealthSection from './ProviderHealthSection';
import QuotaStorageSection from './QuotaStorageSection';

/**
 * PLATFORM-086F2G — the System Health dashboard. A pure renderer of the F2F
 * `SystemHealthViewModel`: it derives no health, freshness, scheduler, quota,
 * storage, or issue logic. Section order matches the required IA. The two
 * operational axes (scheduler jobs / provider datasets) stay distinct sections.
 */
export default function SystemHealthDashboard({
  model,
  nowMs,
  readOnly = false,
}: {
  model: SystemHealthViewModel;
  nowMs: number;
  /** DEV fixture only: render the automation controls non-interactive (no POST path). */
  readOnly?: boolean;
}): React.ReactElement {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <Breadcrumbs
          segments={[
            { label: 'Home', href: '/' },
            { label: 'Admin', href: '/admin' },
            { label: 'System Health' },
          ]}
        />
        <SystemHealthHeader model={model} nowMs={nowMs} />

        {/* 1. Stoplight overview — the primary, few-seconds-to-read signal. */}
        <SystemHealthStoplightPanel panels={model.panels} nowMs={nowMs} />

        {/* 2. Prioritized actionable issues. */}
        <hr className="border-gray-200 dark:border-zinc-800" />
        <SystemHealthIssues issues={model.issues} />

        {/* 3–5. Always-visible observational status (row-level disclosure only). */}
        <hr className="border-gray-200 dark:border-zinc-800" />
        <SchedulerHealthSection jobs={model.schedulerJobs} nowMs={nowMs} />
        <hr className="border-gray-200 dark:border-zinc-800" />
        <ProviderHealthSection
          datasets={model.datasets}
          automation={model.automation}
          year={model.year}
          nowMs={nowMs}
        />
        <hr className="border-gray-200 dark:border-zinc-800" />
        <QuotaStorageSection quota={model.quota} storage={model.storage} nowMs={nowMs} />

        {/* 6. Automation safety controls last — mutation surface below observation. */}
        <hr className="border-gray-200 dark:border-zinc-800" />
        <AutomationSafetyControls automation={model.automation} readOnly={readOnly} />
      </div>
    </main>
  );
}
