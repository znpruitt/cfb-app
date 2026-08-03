import React from 'react';
import Link from 'next/link';

import type { SystemHealthIssue } from '@/lib/server/systemHealthIssues';
import { severityDisplay, TONE_GLYPH, TONE_TEXT_CLASS } from './systemHealthPresentation';

/**
 * PLATFORM-086F2G — prioritized issue list. Renders `model.issues` in its
 * existing model order (never re-sorted or reclassified in the UI). A repair link
 * appears only for a non-null `issue.repair`, using the repair object verbatim;
 * a null repair produces no fake or disabled action.
 */
export default function SystemHealthIssues({
  issues,
}: {
  issues: SystemHealthIssue[];
}): React.ReactElement {
  return (
    <section aria-labelledby="sh-issues-heading" className="space-y-2">
      <h2 id="sh-issues-heading" className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
        Prioritized issues
      </h2>
      {issues.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-zinc-400">No current issues reported.</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-zinc-800">
          {issues.map((issue) => {
            const sev = severityDisplay(issue.severity);
            return (
              <li
                key={`${issue.code}:${issue.subject.axis}:${issue.subject.id}`}
                className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                {/* Title + explanation take the full width; the repair never squeezes them. */}
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${TONE_TEXT_CLASS[sev.tone]}`}>
                      <span aria-hidden="true">{TONE_GLYPH[sev.tone]}</span> {sev.label}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-zinc-500">
                      {issue.subject.axis} · {issue.subject.id}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-zinc-100">{issue.title}</p>
                  <p className="text-xs text-gray-500 dark:text-zinc-400">{issue.explanation}</p>
                </div>
                {/* Repair stacks beneath the content on mobile (start-aligned); returns to a
                    right-anchored inline position at ≥sm. */}
                {issue.repair && (
                  <Link
                    href={issue.repair.href}
                    className="shrink-0 self-start whitespace-nowrap text-xs text-blue-700 underline-offset-2 hover:underline focus-visible:underline sm:self-center dark:text-blue-400"
                  >
                    {issue.repair.label} →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
