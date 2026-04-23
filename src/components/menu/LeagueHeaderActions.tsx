'use client';

import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useClerk, useUser } from '@clerk/nextjs';

type Props = {
  isAdmin?: boolean;
  leagueSlug: string;
  leagueDisplayName: string;
};

const iconButtonClass =
  'inline-flex items-center justify-center text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200';

const svgProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'h-4 w-4',
  'aria-hidden': true,
};

function HomeIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg {...svgProps} className="h-3.5 w-3.5">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg {...svgProps} className="h-3.5 w-3.5">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function LogInIcon() {
  return (
    <svg {...svgProps} className="h-3.5 w-3.5">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

const menuItemClass =
  'flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-gray-700 outline-none transition-colors hover:bg-gray-100 data-[highlighted]:bg-gray-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:data-[highlighted]:bg-zinc-800';

export default function LeagueHeaderActions({ isAdmin, leagueSlug, leagueDisplayName }: Props) {
  const clerk = useClerk();
  const { isSignedIn, isLoaded } = useUser();

  return (
    <div className="flex items-center gap-2">
      <Link href="/" title="Home" aria-label="Home" className={iconButtonClass}>
        <HomeIcon />
      </Link>
      {isAdmin && (
        <Link
          href={`/admin/${leagueSlug}`}
          title={`${leagueDisplayName} tools`}
          aria-label={`${leagueDisplayName} tools`}
          className={iconButtonClass}
        >
          <GearIcon />
        </Link>
      )}
      {isAdmin && (
        <Link
          href="/admin"
          title="Platform admin"
          aria-label="Platform admin"
          className={iconButtonClass}
        >
          <ShieldIcon />
        </Link>
      )}
      <div
        aria-hidden="true"
        className="mx-1 h-5 self-center bg-gray-300 dark:bg-zinc-700"
        style={{ width: '0.5px' }}
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className={`${iconButtonClass} outline-none focus-visible:text-gray-700 dark:focus-visible:text-zinc-200`}
          >
            <DotsIcon />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[180px] rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            {isLoaded && isSignedIn ? (
              <>
                <DropdownMenu.Item
                  className={menuItemClass}
                  onSelect={(event) => {
                    event.preventDefault();
                    clerk.openUserProfile();
                  }}
                >
                  <UserIcon />
                  Manage account
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={menuItemClass}
                  onSelect={(event) => {
                    event.preventDefault();
                    void clerk.signOut({ redirectUrl: '/' });
                  }}
                >
                  <LogOutIcon />
                  Sign out
                </DropdownMenu.Item>
              </>
            ) : (
              <DropdownMenu.Item asChild className={menuItemClass}>
                <Link href="/login">
                  <LogInIcon />
                  Sign in
                </Link>
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
