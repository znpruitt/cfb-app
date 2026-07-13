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
    const [settings, diagnosticsResult, oddsUsage] = await Promise.all([
      getProviderRefreshSettings(),
      getProviderDataDiagnostics(year),
      getLatestKnownOddsUsage().catch(() => null),
    ]);

    const statuses = await Promise.all(
      PROVIDER_DATASETS.map((dataset) => getProviderRefreshStatus(dataset))
    );

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
