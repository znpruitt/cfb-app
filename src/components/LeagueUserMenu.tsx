'use client';

import { UserButton } from '@clerk/nextjs';

function HomeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: '1em', height: '1em' }}
      aria-hidden="true"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: '1em', height: '1em' }}
      aria-hidden="true"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: '1em', height: '1em' }}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

type Props = {
  isAdmin?: boolean;
  leagueSlug: string;
  leagueDisplayName: string;
};

export default function LeagueUserMenu({ isAdmin, leagueSlug, leagueDisplayName }: Props) {
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link label="Home" labelIcon={<HomeIcon />} href="/" />
        {isAdmin && (
          <>
            <UserButton.Link
              label={`${leagueDisplayName} Tools`}
              labelIcon={<WrenchIcon />}
              href={`/admin/${leagueSlug}`}
            />
            <UserButton.Link label="Admin" labelIcon={<ShieldIcon />} href="/admin" />
          </>
        )}
      </UserButton.MenuItems>
    </UserButton>
  );
}
