import { requireAdminRequest } from '../../../lib/server/adminAuth.ts';
import {
  addFeedbackReport,
  getFeedbackReports,
  getOpenFeedbackCount,
  type FeedbackCategory,
  type FeedbackReport,
} from '../../../lib/server/feedbackStore.ts';

const VALID_CATEGORIES = new Set<FeedbackCategory>([
  'wrong_score',
  'missing_game',
  'wrong_odds',
  'data_mismatch',
  'other',
]);

// Simple in-memory rate limiter: max 5 submissions per IP per 10 minutes.
type RateEntry = { count: number; windowStart: number };
const rateLimitMap = new Map<string, RateEntry>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count += 1;
  return true;
}

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return Response.json(
      { error: 'rate-limited', detail: 'Too many reports. Try again later.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const { category, note } = (body ?? {}) as { category?: unknown; note?: unknown };

  if (
    !category ||
    typeof category !== 'string' ||
    !VALID_CATEGORIES.has(category as FeedbackCategory)
  ) {
    return Response.json(
      {
        error: 'invalid-category',
        detail: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}`,
      },
      { status: 400 }
    );
  }

  const noteStr = typeof note === 'string' ? note.slice(0, 500) : '';

  const report: FeedbackReport = {
    id: `fb_${Date.now().toString()}_${Math.random().toString(16).slice(2, 6)}`,
    category: category as FeedbackCategory,
    note: noteStr,
    submittedAt: new Date().toISOString(),
    resolved: false,
  };

  await addFeedbackReport(report);
  return Response.json(report, { status: 201 });
}

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const [reports, openCount] = await Promise.all([getFeedbackReports(), getOpenFeedbackCount()]);
  return Response.json({ reports, openCount });
}
