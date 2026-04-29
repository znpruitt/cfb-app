'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SUBTABS = [
  { key: 'overview', label: 'Overview', suffix: '' },
  { key: 'stats', label: 'Stats', suffix: '/stats' },
  { key: 'rivalries', label: 'Rivalries', suffix: '/rivalries' },
  { key: 'archive', label: 'Archive', suffix: '/archive' },
] as const;

type SubtabKey = (typeof SUBTABS)[number]['key'];

export function getActiveSubtab(pathname: string, basePath: string): SubtabKey {
  if (pathname.startsWith(`${basePath}/stats`)) return 'stats';
  if (pathname.startsWith(`${basePath}/rivalries`)) return 'rivalries';
  if (pathname.startsWith(`${basePath}/archive`)) return 'archive';
  return 'overview';
}

type HistorySubNavProps = {
  slug: string;
};

const tabBase = 'pb-2.5 -mb-px text-sm font-medium transition-colors whitespace-nowrap border-b-2';
const tabActive = `${tabBase} border-gray-900 text-gray-900 dark:border-white dark:text-white`;
const tabInactive = `${tabBase} border-transparent text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200`;

export function HistorySubNav({ slug }: HistorySubNavProps): React.ReactElement {
  const pathname = usePathname();
  const basePath = `/league/${slug}/history`;
  const activeTab = getActiveSubtab(pathname, basePath);

  return (
    <nav aria-label="History sections" className="no-scrollbar overflow-x-auto">
      <div className="mb-6 flex items-center gap-6 border-b border-gray-200 dark:border-zinc-700">
        {SUBTABS.map((tab) => {
          const href = `${basePath}${tab.suffix}`;
          const isActive = activeTab === tab.key;
          return (
            <Link key={tab.key} href={href} className={isActive ? tabActive : tabInactive}>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
