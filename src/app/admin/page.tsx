import CFBScheduleApp from 'components/CFBScheduleApp';
import RolloverPanel from '@/components/RolloverPanel';
import RosterUploadPanel from '@/components/RosterUploadPanel';
import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import WinTotalsUploadPanel from '@/components/WinTotalsUploadPanel';

export default function AdminPage() {
  return (
    <main>
      <RolloverPanel />
      <RosterUploadPanel />
      <SpRatingsCachePanel />
      <WinTotalsUploadPanel />
      <CFBScheduleApp surface="admin" />
    </main>
  );
}
