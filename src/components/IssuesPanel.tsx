import React from 'react';

import type { AliasStaging, DiagEntry } from '../lib/diagnostics';
import { hasStagedAliasChanges, splitIssueDiagnostics } from '../lib/adminDiagnostics';

type IssuesPanelProps = {
  issues: string[];
  diag: DiagEntry[];
  aliasStaging: AliasStaging;
  aliasToast: string | null;
  pillClass: () => string;
  onCommitStagedAliases: () => void;
  onStageAlias: (providerName: string, csvName: string) => void;
};

export default function IssuesPanel({
  issues,
  diag,
  aliasStaging,
  aliasToast,
  pillClass,
  onCommitStagedAliases,
  onStageAlias,
}: IssuesPanelProps): React.ReactElement | null {
  const { actionableDiag, ignoredDebugDiag } = splitIssueDiagnostics(diag);
  const hasStagedAliases = hasStagedAliasChanges(aliasStaging);
  const hasPrimaryIssues = issues.length > 0 || actionableDiag.length > 0;

  if (!hasPrimaryIssues && !hasStagedAliases && ignoredDebugDiag.length === 0) return null;

  return (
    <div className="space-y-3">
      {hasPrimaryIssues || hasStagedAliases ? (
        <div className="rounded border border-l-4 border-gray-300 border-l-red-600 bg-red-50 p-3 text-sm text-gray-900 dark:border-zinc-700 dark:border-l-red-400 dark:bg-red-900/25 dark:text-zinc-100 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              {hasPrimaryIssues ? 'Issues' : 'Staged alias changes'}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                disabled={!hasStagedAliases}
                onClick={onCommitStagedAliases}
                title="Save staged aliases and refresh"
              >
                Save staged aliases
              </button>
              {aliasToast && <span className="text-xs">{aliasToast}</span>}
            </div>
          </div>

          {!hasPrimaryIssues && hasStagedAliases ? (
            <p className="text-xs text-gray-600 dark:text-zinc-300">
              Save staged alias mappings to preserve commissioner repairs discovered in debug tools.
            </p>
          ) : null}

          {issues.length > 0 && (
            <ul className="list-disc pl-5 space-y-1">
              {issues.map((e, index) => (
                <li key={`issue-${index}-${e}`}>{e}</li>
              ))}
            </ul>
          )}

          {actionableDiag.length > 0 && (
            <div className="overflow-x-auto rounded border border-gray-200 dark:border-zinc-700">
              <table className="min-w-full text-xs">
                <thead className="bg-white/60 dark:bg-zinc-800">
                  <tr>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Week</th>
                    <th className="text-left p-2">Provider Home</th>
                    <th className="text-left p-2">Provider Away</th>
                    <th className="text-left p-2">Candidates (CSV)</th>
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actionableDiag.map((d, i) => {
                    if (d.kind === 'scores_miss') {
                      return (
                        <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                          <td className="p-2">Scores miss</td>
                          <td className="p-2">{d.week}</td>
                          <td className="p-2">{d.providerHome}</td>
                          <td className="p-2">{d.providerAway}</td>
                          <td className="p-2 text-zinc-500">
                            <div>—</div>
                            {d.homeIdentity ? (
                              <div className="mt-1">
                                Home norm: <code>{d.homeIdentity.normalizedInput}</code> (
                                {d.homeIdentity.status})
                              </div>
                            ) : null}
                            {d.awayIdentity ? (
                              <div>
                                Away norm: <code>{d.awayIdentity.normalizedInput}</code> (
                                {d.awayIdentity.status})
                              </div>
                            ) : null}
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="px-2 py-1 rounded border"
                                onClick={() => onStageAlias(d.providerHome, d.providerHome)}
                                title='Map provider "home" label to its own canonical (fixes diacritics/case/spacing)'
                              >
                                Map Home→Home
                              </button>
                              <button
                                className="px-2 py-1 rounded border"
                                onClick={() => onStageAlias(d.providerAway, d.providerAway)}
                                title='Map provider "away" label to its own canonical'
                              >
                                Map Away→Away
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    if (d.kind === 'identity_resolution') {
                      return (
                        <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                          <td className="p-2">Identity ({d.flow})</td>
                          <td className="p-2">—</td>
                          <td className="p-2" colSpan={2}>
                            {d.rawInput}
                          </td>
                          <td className="p-2">
                            <div>
                              normalized: <code>{d.normalizedInput}</code>
                            </div>
                            <div>source: {d.resolutionSource}</div>
                            <div>status: {d.status}</div>
                            {d.candidates?.length ? (
                              <div>candidates: {d.candidates.join(', ')}</div>
                            ) : null}
                          </td>
                          <td className="p-2">Manual alias may be needed.</td>
                        </tr>
                      );
                    }
                    if (d.kind === 'week_mismatch') {
                      return (
                        <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                          <td className="p-2">Week mismatch</td>
                          <td className="p-2">{d.week}</td>
                          <td className="p-2">{d.providerHome}</td>
                          <td className="p-2">{d.providerAway}</td>
                          <td className="p-2">
                            {d.candidates?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {d.candidates.map((c, idx) => (
                                  <span key={idx} className={pillClass()}>
                                    wk {c.week}: “{c.csvAway}” @ “{c.csvHome}”
                                  </span>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-2">
                              {d.candidates?.slice(0, 4).map((c, idx) => (
                                <div key={idx} className="flex gap-1">
                                  <button
                                    className="px-2 py-1 rounded border"
                                    onClick={() => onStageAlias(d.providerHome, c.csvHome)}
                                    title={`Map provider home → ${c.csvHome}`}
                                  >
                                    Map Home→{c.csvHome}
                                  </button>
                                  <button
                                    className="px-2 py-1 rounded border"
                                    onClick={() => onStageAlias(d.providerAway, c.csvAway)}
                                    title={`Map provider away → ${c.csvAway}`}
                                  >
                                    Map Away→{c.csvAway}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    if (d.kind === 'ignored_score_row') {
                      return (
                        <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                          <td className="p-2">Score attachment</td>
                          <td className="p-2">{d.week ?? '—'}</td>
                          <td className="p-2">{d.providerHome}</td>
                          <td className="p-2">{d.providerAway}</td>
                          <td className="p-2">
                            <div>{d.diagnostic.userMessage}</div>
                            <div className="text-zinc-500">reason: {d.reason}</div>
                          </td>
                          <td className="p-2">
                            Review score attachment diagnostics in admin debug.
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                        <td className="p-2">Note</td>
                        <td className="p-2">—</td>
                        <td className="p-2" colSpan={4}>
                          —
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {ignoredDebugDiag.length > 0 ? (
        <details className="rounded border border-gray-200 bg-white p-3 text-xs text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <summary className="cursor-pointer font-medium">
            Ignored provider rows (informational) ({ignoredDebugDiag.length})
          </summary>
          <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">
            These rows are out-of-scope provider noise that was intentionally ignored and do not
            require league repair.
          </p>
          <div className="mt-3 overflow-x-auto rounded border border-gray-200 dark:border-zinc-700">
            <table className="min-w-full text-xs">
              <thead className="bg-white/60 dark:bg-zinc-800">
                <tr>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Week</th>
                  <th className="text-left p-2">Provider Home</th>
                  <th className="text-left p-2">Provider Away</th>
                  <th className="text-left p-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {ignoredDebugDiag.map((d, i) => (
                  <tr key={`ignored-${i}`} className="border-t dark:border-zinc-700">
                    <td className="p-2">Ignored score row</td>
                    <td className="p-2">{d.week ?? '—'}</td>
                    <td className="p-2">{d.providerHome}</td>
                    <td className="p-2">{d.providerAway}</td>
                    <td className="p-2">
                      <div>{d.diagnostic.userMessage}</div>
                      <div className="text-gray-500 dark:text-zinc-400">reason: {d.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}
