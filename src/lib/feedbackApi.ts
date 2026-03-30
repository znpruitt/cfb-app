import { requireAdminAuthHeaders } from './adminAuth.ts';

export type FeedbackCategory =
  | 'wrong_score'
  | 'missing_game'
  | 'wrong_odds'
  | 'data_mismatch'
  | 'other';

export type FeedbackReport = {
  id: string;
  category: FeedbackCategory;
  note: string;
  submittedAt: string;
  resolved: boolean;
};

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'wrong_score', label: 'Wrong score' },
  { value: 'missing_game', label: 'Missing game' },
  { value: 'wrong_odds', label: 'Wrong odds' },
  { value: 'data_mismatch', label: 'Data mismatch' },
  { value: 'other', label: 'Other' },
];

export async function submitFeedbackReport(
  category: FeedbackCategory,
  note: string
): Promise<FeedbackReport> {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category, note }),
  });
  if (!res.ok) throw new Error(`feedback POST ${res.status}`);
  return (await res.json()) as FeedbackReport;
}

export async function fetchFeedbackReports(): Promise<{
  reports: FeedbackReport[];
  openCount: number;
}> {
  const res = await fetch('/api/feedback', {
    cache: 'no-store',
    headers: requireAdminAuthHeaders(),
  });
  if (!res.ok) throw new Error(`feedback GET ${res.status}`);
  return (await res.json()) as { reports: FeedbackReport[]; openCount: number };
}

export async function dismissFeedbackReport(id: string): Promise<void> {
  const res = await fetch(`/api/feedback/${id}`, {
    method: 'DELETE',
    headers: requireAdminAuthHeaders(),
  });
  if (!res.ok) throw new Error(`feedback DELETE ${res.status}`);
}
