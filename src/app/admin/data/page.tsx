import Link from 'next/link';

import CFBScheduleApp from '@/components/CFBScheduleApp';

export const dynamic = 'force-dynamic';

export default function AdminDataPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-lg font-bold text-zinc-100">Data Management</h1>
        <Link href="/admin" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
          ← Admin
        </Link>
      </div>
      <CFBScheduleApp surface="admin" />
    </div>
  );
}
