'use client';

import React, { useCallback, useEffect, useState } from 'react';

import {
  FEEDBACK_CATEGORIES,
  dismissFeedbackReport,
  fetchFeedbackReports,
  type FeedbackReport,
} from '../lib/feedbackApi.ts';

const CATEGORY_LABELS = Object.fromEntries(
  FEEDBACK_CATEGORIES.map(({ value, label }) => [value, label])
) as Record<string, string>;

type Props = {
  className?: string;
};

export default function FeedbackPanel({ className }: Props): React.ReactElement {
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchFeedbackReports();
      setReports(data.reports);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDismiss(id: string): Promise<void> {
    setDismissing((prev) => new Set(prev).add(id));
    try {
      await dismissFeedbackReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const openReports = reports.filter((r) => !r.resolved);
  const openCount = openReports.length;

  return (
    <details className={className}>
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-zinc-300">
        Member reports {openCount > 0 ? `(${openCount} open)` : '(none open)'}
      </summary>
      <div className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <button
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>

        {error && <p className="text-xs text-red-700 dark:text-red-400">Error: {error}</p>}

        {!loading && openReports.length === 0 ? (
          <p className="text-xs text-gray-600 dark:text-zinc-400">No open reports.</p>
        ) : (
          <ul className="space-y-2">
            {openReports.map((report) => (
              <li
                key={report.id}
                className="rounded border border-gray-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <p className="text-xs font-semibold text-gray-900 dark:text-zinc-100">
                  {CATEGORY_LABELS[report.category] ?? report.category}
                </p>
                {report.note && (
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-zinc-400">{report.note}</p>
                )}
                <p className="mt-0.5 text-xs text-gray-400 dark:text-zinc-500">
                  {new Date(report.submittedAt).toLocaleString()}
                </p>
                <button
                  className="mt-1.5 rounded border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  onClick={() => void handleDismiss(report.id)}
                  disabled={dismissing.has(report.id)}
                >
                  {dismissing.has(report.id) ? 'Dismissing…' : 'Dismiss'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
