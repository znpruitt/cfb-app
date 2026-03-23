import { requireAdminAuthHeaders } from '../adminAuth.ts';
import type { TeamDatabaseSyncSummary } from '../teamDatabase';

export type TeamDatabaseSyncResponse = {
  ok: boolean;
  source: 'cfbd';
  updatedAt: string;
  summary: TeamDatabaseSyncSummary;
};

export async function syncTeamDatabase(): Promise<TeamDatabaseSyncResponse> {
  const response = await fetch('/api/admin/team-database', {
    method: 'POST',
    headers: { Accept: 'application/json', ...requireAdminAuthHeaders() },
  });

  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const errorPayload = payload as { error?: string; detail?: string };
    throw new Error(
      errorPayload.detail || errorPayload.error || `team database sync ${response.status}`
    );
  }

  return payload as TeamDatabaseSyncResponse;
}
