import React from 'react';
import Link from 'next/link';
import LeagueHeaderActions from './menu/LeagueHeaderActions';

type LeagueTab = 'overview' | 'standings' | 'matchups' | 'insights' | 'members' | 'history';

type LeaguePageShellProps = {
  leagueSlug: string;
  leagueDisplayName: string;
  leagueYear?: number;
  foundedYear?: number;
  isAdmin?: boolean;
  activeTab: LeagueTab;
  children: React.ReactNode;
};

const tabs: { key: LeagueTab; label: string; href: (slug: string) => string }[] = [
  { key: 'overview', label: 'Overview', href: (s) => `/league/${s}/` },
  { key: 'standings', label: 'Standings', href: (s) => `/league/${s}/standings` },
  { key: 'matchups', label: 'Matchups', href: (s) => `/league/${s}/matchups` },
  { key: 'insights', label: 'Insights', href: (s) => `/league/${s}/insights` },
  { key: 'members', label: 'Members', href: (s) => `/league/${s}/members` },
  { key: 'history', label: 'History', href: (s) => `/league/${s}/history/` },
];

const tabBase = 'pb-2.5 -mb-px text-sm font-medium transition-colors whitespace-nowrap border-b-2';
const tabActive = `${tabBase} border-gray-900 text-gray-900 dark:border-white dark:text-white`;
const tabInactive = `${tabBase} border-transparent text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200`;

export default function LeaguePageShell({
  leagueSlug,
  leagueDisplayName,
  leagueYear,
  foundedYear,
  isAdmin,
  activeTab,
  children,
}: LeaguePageShellProps): React.ReactElement {
  return (
    <div className="space-y-5 bg-white p-4 text-gray-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex flex-col gap-3">
        {/* Row 1: league name + icon cluster */}
        <div className="flex items-start justify-between gap-x-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-medium">{leagueDisplayName}</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-zinc-400">
              {activeTab === 'history'
                ? foundedYear != null
                  ? `Est. ${foundedYear}`
                  : null
                : leagueYear != null
                  ? `${leagueYear} season`
                  : null}
            </p>
          </div>
          <div className="shrink-0">
            <LeagueHeaderActions
              isAdmin={isAdmin}
              leagueSlug={leagueSlug}
              leagueDisplayName={leagueDisplayName}
            />
          </div>
        </div>

        {/* Row 2: tab nav */}
        <div
          style={
            {
              overflowX: 'auto',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            } as React.CSSProperties
          }
        >
          <div className="flex items-center gap-6 border-b border-gray-200 dark:border-zinc-700">
            {tabs.map((tab) => (
              <React.Fragment key={tab.key}>
                {tab.key === 'history' && (
                  <div
                    className="self-center bg-gray-300 dark:bg-zinc-600"
                    style={{ width: '0.5px', height: 16 }}
                    aria-hidden="true"
                  />
                )}
                <Link
                  href={tab.href(leagueSlug)}
                  className={activeTab === tab.key ? tabActive : tabInactive}
                >
                  {tab.label}
                </Link>
              </React.Fragment>
            ))}
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
