import { requireAdminRequest } from '../../../../lib/server/adminAuth.ts';
import {
  resolveFeedbackReport,
  deleteFeedbackReport,
} from '../../../../lib/server/feedbackStore.ts';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { id } = await params;
  const found = await resolveFeedbackReport(id);
  if (!found) return Response.json({ error: 'not-found' }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { id } = await params;
  const found = await deleteFeedbackReport(id);
  if (!found) return Response.json({ error: 'not-found' }, { status: 404 });
  return Response.json({ ok: true });
}
