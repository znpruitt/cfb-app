'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchScoreAttachmentDebug,
  type ScoreAttachmentDebugResponse,
} from '@/lib/scoreAttachmentDebug';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import MaintenanceActionDetails from './MaintenanceActionDetails';

/**
 * PLATFORM-086F2D2 — the score-attachment tool, relocated from Diagnostics and
 * presented truthfully: this is a score REFRESH plus attachment trace, not a
 * read-only diagnostic. The route it calls propagates authorized `refresh=1`
 * score reads (durable score/status writes, standings invalidation on change)
 * and may rebuild cold schedule/conference context; a failed season-wide read
 * can fall back across provider weeks. Emergency-class: every invocation
 * requires an explicit, target-naming confirmation before any request.
 *
 * The backend route, its context loader, and the score-refresh fallback are
 * deliberately unchanged (their internal-HTTP/error-flattening limitations are
 * separately tracked in the server-fetch backlog).
 */

export type ScoreAttachmentSeasonType = '' | 'regular' | 'postseason';

/**
 * The ONE human-readable target description used for the disclosure, the
 * confirmation copy, the request construction, and the result label — so a
 * completed result can never display as belonging to different controls.
 */
export function describeScoreAttachmentTarget(
  year: number,
  week: number | null,
  seasonType: ScoreAttachmentSeasonType
): string {
  if (week === null) {
    if (seasonType === '') return `${year} full season (regular + postseason)`;
    return `${year} ${seasonType} full season`;
  }
  if (seasonType === '') return `${year} canonical week ${week} (all season types)`;
  return `${year} ${seasonType} canonical week ${week}`;
}

const ALIAS_REPAIR_REASONS = new Set([
  'unresolved_home_team',
  'unresolved_away_team',
  'unresolved_both_teams',
]);

const sectionClass =
  'rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900';
const buttonClass =
  'rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';
const inputClass =
  'rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500';

type CompletedTrace = {
  target: string;
  data: ScoreAttachmentDebugResponse;
};

export default function ScoreAttachmentRecoveryPanel({
  defaultYear,
}: { defaultYear?: number } = {}): React.ReactElement {
  const [year, setYear] = useState(defaultYear ?? seasonYearForToday());
  const [weekInput, setWeekInput] = useState<string>('');
  const [seasonType, setSeasonType] = useState<ScoreAttachmentSeasonType>('');

  const [validationError, setValidationError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<CompletedTrace | null>(null);

  // Only the latest attempt may write feedback; an aborted/superseded/unmounted
  // response is dropped. Changing any target control clears prior feedback so a
  // previous target's trace never renders beneath new controls.
  const attemptSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Abort any in-flight attempt on unmount so its response is dropped by the
  // signal guard rather than resolving into a dead component.
  useEffect(() => () => abortRef.current?.abort(), []);

  function clearFeedback() {
    setValidationError('');
    setError('');
    setResult(null);
  }

  // A digit string beyond a plausible week bound is INVALID, not a broad run:
  // huge values serialize exponentially (`1e+22`), which the route's own week
  // parser rejects — silently broadening a "week-scoped" run to the full
  // season. Bounding here keeps the captured target and the server scope
  // identical.
  const trimmedWeek = weekInput.trim();
  const parsedWeek: number | null | 'invalid' = (() => {
    if (trimmedWeek === '') return null;
    if (!/^\d+$/.test(trimmedWeek)) return 'invalid';
    const n = Number.parseInt(trimmedWeek, 10);
    return Number.isSafeInteger(n) && n <= 99 ? n : 'invalid';
  })();

  // Year matches the provider routes' supported range (2000 .. current UTC
  // year + 1, the schedule/scores bound): a farther-future year would pass a
  // loose client check, be rejected upstream into an empty context, and render
  // a misleading "Trace loaded" with no refresh executed (Codex r3). The bound
  // also blocks exponent-sized values that would serialize as `1e+22` and be
  // parsed as year 1 server-side.
  const maxSupportedYear = new Date().getUTCFullYear() + 1;
  const yearInvalid = !Number.isInteger(year) || year < 2000 || year > maxSupportedYear;
  const targetInvalid = parsedWeek === 'invalid' || yearInvalid;
  const currentTarget = useMemo(
    () =>
      targetInvalid
        ? 'invalid target — correct the controls before running'
        : describeScoreAttachmentTarget(year, parsedWeek, seasonType),
    [targetInvalid, year, parsedWeek, seasonType]
  );

  async function handleRun() {
    // Validate the exact target BEFORE any confirmation or request. An invalid
    // week or year must never silently reach a broader or different scope.
    if (yearInvalid) {
      setValidationError(
        `Year must be a whole number between 2000 and ${maxSupportedYear} (the provider routes' supported range).`
      );
      return;
    }
    if (parsedWeek === 'invalid') {
      setValidationError('Week must be blank (all weeks) or a whole number between 0 and 99.');
      return;
    }
    setValidationError('');

    // Capture the target NOW — the disclosure, confirmation, request, and
    // result label all use this exact capture.
    const target = {
      year,
      week: parsedWeek,
      seasonType,
      description: describeScoreAttachmentTarget(year, parsedWeek, seasonType),
    };

    // A selected week scopes the TRACE only — the route derives the refresh
    // partitions from the season types actually present among that week's
    // scheduled games and then refreshes those partitions SEASON-WIDE (a week
    // with no matching games performs no refresh at all). The confirmation
    // must state that derivation, never a fixed partition promise (Codex r2).
    const weekScopeNote =
      target.week === null
        ? ''
        : '\n\nNote: the week selection scopes the trace only. The underlying score refresh runs ' +
          `season-wide for each season type that has games in week ${target.week} of ${target.year}` +
          (target.seasonType === '' ? '' : ` (limited to ${target.seasonType})`) +
          ' — not just that week; a week with no matching games performs no refresh.';

    const confirmed = window.confirm(
      `Refresh CFBD-backed score data and run the attachment trace for ${target.description}?\n\n` +
        'This can update score caches and provider-refresh status, invalidate standings when ' +
        'scores change, and refresh schedule or conference context when those caches are cold. ' +
        'A broad run can fall back to provider-week requests and consume substantially more quota.' +
        weekScopeNote +
        '\n\nContinue?'
    );
    if (!confirmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const attemptSeq = ++attemptSeqRef.current;

    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await fetchScoreAttachmentDebug(
        {
          year: target.year,
          week: target.week,
          seasonType: target.seasonType || null,
        },
        { signal: controller.signal }
      );
      if (controller.signal.aborted || attemptSeq !== attemptSeqRef.current) return;
      setResult({ target: target.description, data });
    } catch (err) {
      if (
        controller.signal.aborted ||
        attemptSeq !== attemptSeqRef.current ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        return;
      }
      // Generic feedback only — the client helper already collapses non-2xx to
      // a status-only message; never surface bodies/URLs/credentials.
      setError((err as Error).message);
    } finally {
      if (attemptSeq === attemptSeqRef.current) setLoading(false);
    }
  }

  const sortedActionableReasons = result
    ? Object.entries(result.data.summary.actionableReasons).sort((a, b) => b[1] - a[1])
    : [];
  const sortedIgnoredReasons = result
    ? Object.entries(result.data.summary.ignoredReasons).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <section className={sectionClass}>
      <div>
        <h3 className="text-base font-medium text-gray-900 dark:text-zinc-100">
          Score attachment recovery
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Refreshes CFBD-backed score data for the selected target and traces how each provider row
          attaches to the canonical schedule. This is a mutating recovery action — not a read-only
          diagnostic. A week selection scopes the trace only: the underlying refresh runs
          season-wide for each season type with games in that week — a week with no matching games
          performs no refresh.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Year
          <input
            type="number"
            value={year}
            min={2000}
            step={1}
            disabled={loading}
            onChange={(e) => {
              setYear(Number(e.target.value));
              clearFeedback();
            }}
            className={`w-24 ${inputClass}`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Week
          <input
            value={weekInput}
            placeholder="all"
            disabled={loading}
            onChange={(e) => {
              setWeekInput(e.target.value);
              clearFeedback();
            }}
            className={`w-20 ${inputClass}`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
          Season type
          <select
            value={seasonType}
            disabled={loading}
            onChange={(e) => {
              setSeasonType(e.target.value as ScoreAttachmentSeasonType);
              clearFeedback();
            }}
            className={inputClass}
          >
            <option value="">all</option>
            <option value="regular">regular</option>
            <option value="postseason">postseason</option>
          </select>
        </label>
        <span className="text-xs text-gray-500 dark:text-zinc-400">
          Target: <span className="font-medium">{currentTarget}</span>
        </span>
      </div>

      {validationError && (
        <p className="text-xs text-red-600 dark:text-red-400">{validationError}</p>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => void handleRun()} disabled={loading} className={buttonClass}>
          Refresh scores and run attachment trace
        </button>
        {loading && (
          <span className="text-xs text-gray-500 dark:text-zinc-400">
            Refreshing scores and building the attachment trace…
          </span>
        )}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>

      <MaintenanceActionDetails action="score-attachment-recovery" targetScope={currentTarget} />

      {result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-800 dark:text-zinc-200">
            Trace loaded — {result.target}
          </p>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            This trace reports attachment output from the rows returned to it. It does not
            independently prove that every upstream refresh or context load succeeded.
          </p>

          <div className="grid gap-2 md:grid-cols-5">
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              Provider rows: {result.data.summary.providerRowCount}
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              Attached: {result.data.summary.attachedCount}
            </div>
            <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
              Actionable: {result.data.summary.actionableCount}
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              Ignored: {result.data.summary.ignoredCount}
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              Indexed games: {result.data.schedule.indexedGameCount}
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

          {result.data.diagnostics.actionable.length > 0 ? (
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
                  {result.data.diagnostics.actionable.slice(0, 100).map((item, idx) => (
                    <tr key={`${item.reason}-${idx}`} className="border-t dark:border-zinc-700">
                      <td className="p-2">
                        <div>{item.reason}</div>
                        <div className="text-xs text-red-700 dark:text-red-300">
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
                          <span className="text-xs text-gray-600 dark:text-zinc-400">
                            Stage alias repairs on the Team Identity page (/admin/aliases).
                          </span>
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
            <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
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
                  {result.data.diagnostics.ignored.slice(0, 100).map((item, idx) => (
                    <tr
                      key={`${item.reason}-ignored-${idx}`}
                      className="border-t dark:border-zinc-700"
                    >
                      <td className="p-2">
                        <div>{item.reason}</div>
                        <div className="text-xs text-gray-500 dark:text-zinc-400">
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
        </div>
      )}
    </section>
  );
}
