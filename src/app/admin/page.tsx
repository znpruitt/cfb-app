import CFBScheduleApp from 'components/CFBScheduleApp';
import RolloverPanel from '@/components/RolloverPanel';

export default function AdminPage() {
  return (
    <main>
      <RolloverPanel />
      <CFBScheduleApp surface="admin" />
    </main>
  );
}
