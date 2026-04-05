import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminLeagueWinTotalsPage() {
  redirect('/admin/data/cache');
}
