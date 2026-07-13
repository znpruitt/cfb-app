import { NextResponse } from 'next/server';

import { requireAdminAuth } from '@/lib/server/adminAuth';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import {
  PROVIDER_DATASETS,
  getProviderDatasetDescriptor,
  isProviderDataset,
  type ProviderDataset,
} from '@/lib/providerDatasets';
import {
  getProviderRefreshStatus,
  type ProviderRefreshStatus,
} from '@/lib/server/providerRefreshStatus';
import {
  getProviderRefreshSettings,
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '@/lib/server/providerRefreshSettings';
import {
  getProviderDataDiagnostics,
  type ProviderDiagnostic,
} from '@/lib/server/providerDataDiagnostics';
import {
  getProviderCacheStates,
  unknownProviderCacheStates,
} from '@/lib/server/providerCacheState';
import { getLatestKnownOddsUsage } from '@/lib/server/oddsUsageStore';

export const dynamic = 'force-dynamic';

type DatasetRow = {
  dataset: ProviderDataset;
  descriptor: ReturnType<typeof getProviderDatasetDescriptor>;
  status: ProviderRefreshStatus;
  setting: { enabled: boolean };
  diagnostics: ProviderDiagnostic[];
};

/**
 * Unified provider-data status feed for the platform-admin panel (PLATFORM-086A).
 *
 * This GET is deliberately CACHE-ONLY: it reads durable refresh status, settings,
 * the durable odds-usage snapshot, and cache-derived missing-data diagnostics.
 * It never contacts a provider (determining status must not spend quota). The
 * panel fetches authoritative live CFBD usage separately via /api/admin/usage.
 */
export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const parsedYear = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
  const year = parsedYear ?? seasonYearForToday();

  try {
    // Read durable odds usage ONCE per status request, forcing through to durable
    // storage: the process-local memo can be indefinitely stale in a multi-instance
    // deployment. This is the operational QUOTA display only — it is deliberately
    // NOT passed to the diagnostics odds-freshness check, which now derives
    // freshness from the season-scoped odds cache instead of this global quota
    // timestamp (4th-review finding #4).
    const oddsUsage = await getLatestKnownOddsUsage({ forceRefresh: true }).catch(() => null);

    const [settings, diagnosticsResult, statuses, cacheStates] = await Promise.all([
      getProviderRefreshSettings(),
      getProviderDataDiagnostics(year),
      Promise.all(PROVIDER_DATASETS.map((dataset) => getProviderRefreshStatus(dataset))),
      // Cache-only availability, so the panel can distinguish "no refresh history"
      // from "no data". A failure of the whole pass degrades to all-unknown rather
      // than sinking the status feed.
      getProviderCacheStates(year).catch(() => unknownProviderCacheStates()),
    ]);

    const rows: DatasetRow[] = PROVIDER_DATASETS.map((dataset, index) => ({
      dataset,
      descriptor: getProviderDatasetDescriptor(dataset),
      status: statuses[index],
      setting: settings.datasets[dataset],
      diagnostics: diagnosticsResult.diagnostics.filter((d) => d.dataset === dataset),
    }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      year,
      globalPause: settings.globalPause,
      datasets: rows,
      diagnostics: diagnosticsResult.diagnostics,
      // Applicable score partitions for manual refresh (rereview finding #1): the
      // panel skips a doomed postseason score request before bowls are scheduled.
      scoreSeasonTypes: diagnosticsResult.scoreSeasonTypes,
      // Cache-only per-dataset availability, keyed by dataset (hotfix requirement 6).
      cacheStates,
      oddsUsage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'provider-status-unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

type PostBody =
  | { action: 'set-global-pause'; paused: boolean }
  | { action: 'set-dataset-enabled'; dataset: string; enabled: boolean };

/**
 * Mutate operational auto-refresh settings (PLATFORM-086A). Only the global
 * pause and per-dataset enable flags are settable — NOT cron expressions or
 * arbitrary cadence/quota fields.
 */
export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid-json-body' }, { status: 400 });
  }

  try {
    if (body?.action === 'set-global-pause') {
      if (typeof body.paused !== 'boolean') {
        return NextResponse.json({ error: 'paused must be a boolean' }, { status: 400 });
      }
      const settings = await setGlobalPause(body.paused);
      return NextResponse.json({ settings });
    }

    if (body?.action === 'set-dataset-enabled') {
      if (!isProviderDataset(body.dataset)) {
        return NextResponse.json(
          { error: 'unknown dataset', value: body.dataset },
          { status: 400 }
        );
      }
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
      }
      // Honest controls (PLATFORM-086A remediation): only a dataset whose
      // auto-refresh setting is actually CONSUMED by a live job today can be
      // toggled. Datasets with no active automation (planned 086B–086E) or the
      // lifecycle-critical/exempt season-transition schedule cannot be flipped
      // into a misleading "disabled" state that has no runtime effect. When those
      // jobs ship, their descriptor flips `autoRefreshSettingConsumed` and the
      // control activates.
      const descriptor = getProviderDatasetDescriptor(body.dataset);
      if (!descriptor.autoRefreshSettingConsumed) {
        return NextResponse.json(
          {
            error: 'dataset-auto-refresh-not-active',
            detail: descriptor.lifecycleCritical
              ? `${descriptor.label} automation is lifecycle-critical and exempt from provider polling controls.`
              : `${descriptor.label} has no active automatic refresh yet — its cadence is planned, so this control is not active.`,
            dataset: body.dataset,
          },
          { status: 400 }
        );
      }
      const settings = await setDatasetAutoRefreshEnabled(body.dataset, body.enabled);
      return NextResponse.json({ settings });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'settings-write-failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
