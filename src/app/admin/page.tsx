import CFBScheduleApp from 'components/CFBScheduleApp';
import RolloverPanel from '@/components/RolloverPanel';
import RosterUploadPanel from '@/components/RosterUploadPanel';

export default function AdminPage() {
  return (
    <main>
      <RolloverPanel />
      <RosterUploadPanel />
      <CFBScheduleApp surface="admin" />
    </main>
  );
}
