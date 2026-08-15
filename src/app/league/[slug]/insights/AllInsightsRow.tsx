'use client';

import React from 'react';
import Link from 'next/link';

import { getCategoryConfig } from '../../../../lib/insightCategories';
import type { Insight } from '../../../../lib/selectors/insights';
import { insightHref } from '../../../../components/OverviewPanel';
import { prefersDarkMode } from '../../../../lib/ownerColors';

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = React.useState<boolean>(() => prefersDarkMode());
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent): void => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDark;
}

export default function AllInsightsRow({
  insight,
  leagueSlug,
  panelYear,
}: {
  insight: Insight;
  leagueSlug: string;
  panelYear?: number;
}): React.ReactElement {
  const isDark = useIsDarkMode();
  const href = insightHref(insight.navigationTarget, leagueSlug, insight, panelYear);
  const config = getCategoryConfig(insight.category);
  const categoryColor = isDark ? config.darkColor : config.lightColor;

  const body = (
    <div className="flex min-h-[44px] items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p
          className="text-[10px] font-semibold uppercase"
          style={{ letterSpacing: '0.08em', color: categoryColor }}
        >
          {config.label}
          {/* INSIGHTS-018 — the same ringed badge as the Overview row. Review
              found this page had none: it is the destination of "See all" and the
              only surface rendering the full feed, so the feature's headline
              label was missing from the one place the whole feed is visible. */}
          {insight.isNew ? (
            <span className="ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium normal-case tracking-wide text-gray-500 ring-1 ring-gray-300 dark:text-zinc-400 dark:ring-zinc-600">
              New
            </span>
          ) : null}
        </p>
        <p className="text-[15px] font-medium text-gray-950 dark:text-zinc-50">{insight.title}</p>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-zinc-400">{insight.description}</p>
      </div>
      {href ? (
        <span
          aria-hidden="true"
          className="shrink-0 pt-1 text-[13px] text-gray-500 dark:text-zinc-500"
        >
          →
        </span>
      ) : null}
    </div>
  );

  const rowClasses = 'block border-b border-gray-200 last:border-b-0 dark:border-zinc-800';

  if (href) {
    return (
      <Link href={href} className={`${rowClasses} hover:bg-gray-50/60 dark:hover:bg-zinc-800/40`}>
        {body}
      </Link>
    );
  }
  return <div className={rowClasses}>{body}</div>;
}
