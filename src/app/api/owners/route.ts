import { deleteAppState, getAppState, setAppState } from '../../../lib/server/appStateStore.ts';
import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';

function clampYearMaybe(s: string | null): number {
  const fallback = new Date().getFullYear();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ownersScope(year: number): string {
  return `owners:${year}`;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const record = await getAppState<string>(ownersScope(year), 'csv');
  return Response.json({ year, csvText: typeof record?.value === 'string' ? record.value : null });
}

export async function PUT(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const csvText =
    body && typeof body === 'object' && 'csvText' in (body as Record<string, unknown>)
      ? (body as { csvText?: unknown }).csvText
      : undefined;

  if (csvText !== null && csvText !== undefined && typeof csvText !== 'string') {
    return new Response('csvText must be a string or null', { status: 400 });
  }

  if (typeof csvText === 'string' && csvText.trim()) {
    await setAppState(ownersScope(year), 'csv', csvText);
    return Response.json({ year, csvText });
  }

  await deleteAppState(ownersScope(year), 'csv');
  return Response.json({ year, csvText: null });
}
