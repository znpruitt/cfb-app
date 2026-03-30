'use client';

import React, { useCallback, useMemo, useState } from 'react';

import {
  fetchScoreAttachmentDebug,
  type ScoreAttachmentDebugResponse,
} from '../lib/scoreAttachmentDebug';

const ALIAS_REPAIR_REASONS = new Set([
  'unresolved_home_team',
  'unresolved_away_team',
  'unresolved_both_teams',
]);

type Props = {
  className?: string;
  season: number;
  onStageAlias: (providerName: string, csvName: string) => void;
};

export default function ScoreAttachmentDebugPanel({
  className,
  season,
  onStageAlias,
}: Props): React.ReactElement {
  const [data, setData] = useState<ScoreAttachmentDebugResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [weekInput, setWeekInput] = useState<string>('');
  const [seasonType, setSeasonType] = useState<string>('');

  const loadDebug = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const parsedWeek = /^\d+$/.test(weekInput) ? Number.parseInt(weekInput, 10) : null;
      const resp = await fetchScoreAttachmentDebug({
        year: season,
        week: parsedWeek,
        seasonType: seasonType || null,
      });
      setData(resp);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [season, seasonType, weekInput]);

  const sortedActionableReasons = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.summary.actionableReasons).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const sortedIgnoredReasons = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.summary.ignoredReasons).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <details className={className}>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        Admin diagnostics: score attachment
      </summary>

      <div className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600 dark:text-zinc-400">
            Week
            <input
              className="ml-1 w-20 rounded border border-gray-300 bg-white px-1 py-0.5 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              value={weekInput}
              onChange={(event) => setWeekInput(event.target.value)}
              placeholder="all"
            />
          </label>

          <label className="text-xs text-gray-600 dark:text-zinc-400">
            Season type
            <select
              className="ml-1 rounded border border-gray-300 bg-white px-1 py-0.5 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              value={seasonType}
              onChange={(event) => setSeasonType(event.target.value)}
            >
              <option value="">all</option>
              <option value="regular">regular</option>
              <option value="postseason">postseason</option>
            </select>
          </label>

          <button
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={() => void loadDebug()}
            disabled={loading}
          >
            {loading ? 'Loading debug trace…' : 'Load score attachment trace'}
          </button>
        </div>

        {error && <p className="text-xs text-red-700 dark:text-red-400">Debug error: {error}</p>}

        {data && (
          <>
            <div className="grid gap-2 md:grid-cols-5">
              <div className="rounded border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                Provider rows: {data.summary.providerRowCount}
              </div>
              <div className="rounded border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                Attached: {data.summary.attachedCount}
              </div>
              <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
                Actionable: {data.summary.actionableCount}
              </div>
              <div className="rounded border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                Ignored: {data.summary.ignoredCount}
              </div>
              <div className="rounded border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                Indexed games: {data.schedule.indexedGameCount}
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <div className="mb-1 text-xs font-medium text-red-800 dark:text-red-300">
                  Actionable reasons
                </div>
                <div className="flex flex-wrap gap-2">
                  {sortedActionableReasons.length === 0 ? (
                    <span className="text-xs text-gray-500">No actionable attachment issues.</span>
                  ) : (
                    sortedActionableReasons.map(([reason, count]) => (
                      <span
                        key={reason}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
                      >
                        {reason}: {count}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <details>
                <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-zinc-300">
                  Ignored provider rows (debug)
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sortedIgnoredReasons.length === 0 ? (
                    <span className="text-xs text-gray-500">No ignored provider rows.</span>
                  ) : (
                    sortedIgnoredReasons.map(([reason, count]) => (
                      <span
                        key={reason}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                      >
                        {reason}: {count}
                      </span>
                    ))
                  )}
                </div>
              </details>
            </div>

            {data.diagnostics.actionable.length > 0 ? (
              <div className="overflow-x-auto rounded border border-red-200 dark:border-red-900/50">
                <table className="min-w-full text-xs">
                  <thead className="bg-red-50 dark:bg-red-950/40">
                    <tr>
                      <th className="p-2 text-left">Reason</th>
                      <th className="p-2 text-left">Week</th>
                      <th className="p-2 text-left">Provider Home / Away</th>
                      <th className="p-2 text-left">Canonical</th>
                      <th className="p-2 text-left">Trace</th>
                      <th className="p-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.diagnostics.actionable.slice(0, 100).map((item, idx) => (
                      <tr key={`${item.reason}-${idx}`} className="border-t dark:border-zinc-700">
                        <td className="p-2">
                          <div>{item.reason}</div>
                          <div className="text-[11px] text-red-700 dark:text-red-300">
                            {item.userMessage}
                          </div>
                        </td>
                        <td className="p-2">{item.provider.week ?? '—'}</td>
                        <td className="p-2">
                          <div>{item.provider.homeTeamRaw ?? '—'}</div>
                          <div>{item.provider.awayTeamRaw ?? '—'}</div>
                        </td>
                        <td className="p-2">
                          <div>home: {item.resolution.homeCanonical ?? 'unresolved'}</div>
                          <div>away: {item.resolution.awayCanonical ?? 'unresolved'}</div>
                        </td>
                        <td className="p-2">
                          <div>candidates: {item.trace.candidateCount}</div>
                          {item.trace.plausibleScheduledGameCount != null ? (
                            <div>plausible scheduled: {item.trace.plausibleScheduledGameCount}</div>
                          ) : null}
                          {item.trace.finalNote ? <div>{item.trace.finalNote}</div> : null}
                        </td>
                        <td className="p-2">
                          {ALIAS_REPAIR_REASONS.has(item.reason) ? (
                            <div className="flex flex-wrap gap-1">
                              {item.provider.homeTeamRaw ? (
                                <button
                                  className="rounded border px-3 py-1.5"
                                  onClick={() =>
                                    onStageAlias(
                                      item.provider.homeTeamRaw!,
                                      item.provider.homeTeamRaw!
                                    )
                                  }
                                >
                                  Map Home→Home
                                </button>
                              ) : null}
                              {item.provider.awayTeamRaw ? (
                                <button
                                  className="rounded border px-3 py-1.5"
                                  onClick={() =>
                                    onStageAlias(
                                      item.provider.awayTeamRaw!,
                                      item.provider.awayTeamRaw!
                                    )
                                  }
                                >
                                  Map Away→Away
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded border border-gray-200 bg-white p-3 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                No actionable score-attachment issues in the current scope.
              </div>
            )}

            <details>
              <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-zinc-300">
                Ignored provider row samples (debug)
              </summary>
              <div className="mt-2 overflow-x-auto rounded border border-gray-200 dark:border-zinc-700">
                <table className="min-w-full text-xs">
                  <thead className="bg-white/60 dark:bg-zinc-800">
                    <tr>
                      <th className="p-2 text-left">Reason</th>
                      <th className="p-2 text-left">Week</th>
                      <th className="p-2 text-left">Provider Home / Away</th>
                      <th className="p-2 text-left">Canonical</th>
                      <th className="p-2 text-left">Trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.diagnostics.ignored.slice(0, 100).map((item, idx) => (
                      <tr
                        key={`${item.reason}-ignored-${idx}`}
                        className="border-t dark:border-zinc-700"
                      >
                        <td className="p-2">
                          <div>{item.reason}</div>
                          <div className="text-[11px] text-gray-500 dark:text-zinc-400">
                            {item.userMessage}
                          </div>
                        </td>
                        <td className="p-2">{item.provider.week ?? '—'}</td>
                        <td className="p-2">
                          <div>{item.provider.homeTeamRaw ?? '—'}</div>
                          <div>{item.provider.awayTeamRaw ?? '—'}</div>
                        </td>
                        <td className="p-2">
                          <div>home: {item.resolution.homeCanonical ?? 'unresolved'}</div>
                          <div>away: {item.resolution.awayCanonical ?? 'unresolved'}</div>
                        </td>
                        <td className="p-2">
                          <div>candidates: {item.trace.candidateCount}</div>
                          {item.trace.plausibleScheduledGameCount != null ? (
                            <div>plausible scheduled: {item.trace.plausibleScheduledGameCount}</div>
                          ) : null}
                          {item.trace.finalNote ? <div>{item.trace.finalNote}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
    </details>
  );
}
