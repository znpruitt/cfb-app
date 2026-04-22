import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import DraftSequencingPanel from '@/components/admin/DraftSequencingPanel';

export const dynamic = 'force-dynamic';

export default function AdminDraftPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Breadcrumbs
            segments={[
              { label: 'Home', href: '/' },
              { label: 'Admin', href: '/admin' },
              { label: 'Draft Sequencing' },
            ]}
          />
          <h1 className="text-2xl font-semibold text-zinc-100">Draft Sequencing</h1>
        </div>

        <DraftSequencingPanel />
      </div>
    </main>
  );
}
