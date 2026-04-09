import React from 'react';
import Link from 'next/link';

type LeagueTab = 'overview' | 'standings' | 'matchups' | 'members' | 'history';

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
  { key: 'members', label: 'Members', href: (s) => `/league/${s}/members` },
  { key: 'history', label: 'History', href: (s) => `/league/${s}/history/` },
];

const tabBase =
  'pb-2.5 -mb-px text-sm font-medium transition-colors whitespace-nowrap border-b-2';
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
  console.log('[DIAG] LeaguePageShell foundedYear:', foundedYear, 'activeTab:', activeTab);
  return (
    <div className="space-y-5 bg-white p-4 text-gray-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap">
          {/* League name + season subtitle */}
          <div className="min-w-0 flex-1 md:flex-none">
            <h1 className="text-xl font-medium">{leagueDisplayName}</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-zinc-400">
              {activeTab === 'history' ? (foundedYear != null ? `Est. ${foundedYear}` : null) : leagueYear != null ? `${leagueYear} season` : null}
            </p>
          </div>

          {/* Gear icon — right of name on mobile, far right on desktop */}
          {isAdmin && (
            <div className="flex shrink-0 items-center gap-3 md:order-last">
              <Link
                href={`/admin/${leagueSlug}`}
                title="League settings"
                className="text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </Link>
            </div>
          )}

          {/* Tab nav — full width on mobile (wraps to next row), fills middle on desktop */}
          <div className="w-full md:flex md:w-auto md:flex-1 md:flex-col md:items-end">
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
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
