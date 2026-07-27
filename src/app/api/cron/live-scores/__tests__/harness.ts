import assert from 'node:assert/strict';

import type { LiveScoresCronExecutionEvent } from '@/lib/liveScores/cronExecutionLog';
import type { CacheEntry } from '@/lib/scores/cache';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '@/lib/server/appStateStore';

import { GET } from '../route';

export const CRON_SECRET = 'test-cron-secret';
export const H = 60 * 60 * 1000;
export const YEAR = (() => {
  const d = new Date();
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
})();

export const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};
export const ORIGINAL_FETCH = globalThis.fetch;

export function cronRequest(secret: string | null = CRON_SECRET): Request {
  return new Request('https://example.com/api/cron/live-scores', {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

export type ScheduleSeed = {
  id: number;
  week: number;
  seasonType?: 'regular' | 'postseason';
  ageHours: number;
  status?: string;
  home?: string;
  away?: string;
  homeId?: number;
  awayId?: number;
};

function scheduleItem(seed: ScheduleSeed) {
  return {
    id: String(seed.id),
    week: seed.week,
    seasonType: seed.seasonType ?? 'regular',
    startDate: new Date(Date.now() - seed.ageHours * H).toISOString(),
    neutralSite: false,
    conferenceGame: true,
    homeTeam: seed.home ?? 'Alabama',
    awayTeam: seed.away ?? 'Georgia',
    homeId: seed.homeId ?? 333,
    awayId: seed.awayId ?? 61,
    homeConference: 'SEC',
    awayConference: 'SEC',
    status: seed.status ?? 'scheduled',
  };
}

export async function seedSchedule(seeds: ScheduleSeed[]): Promise<void> {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: seeds.map(scheduleItem),
  });
}

export async function seedScoreEntry(
  week: number,
  seasonType: 'regular' | 'postseason',
  entry: Partial<CacheEntry> & { items: CacheEntry['items'] }
): Promise<void> {
  await setAppState('scores', `${YEAR}-${week}-${seasonType}`, {
    at: Date.now(),
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    ...entry,
  });
}

/** Stub CFBD: `/info` usage, `/scoreboard`, `/games`; records requested URLs. */
export function stubProvider(opts: {
  scoreboard?: unknown;
  games?: unknown;
  remainingCalls?: number;
}): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    let body: unknown;
    if (url.includes('/info'))
      body = { patronLevel: 1, remainingCalls: opts.remainingCalls ?? 4000 };
    else if (url.includes('/scoreboard')) body = opts.scoreboard ?? [];
    else if (url.includes('/games')) body = opts.games ?? [];
    else throw new Error(`unexpected url ${url}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { urls };
}

export function installLogCapture(): { raw: string[]; restore: () => void } {
  const raw: string[] = [];
  const original = console.log;
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  return { raw, restore: () => void (console.log = original) };
}

export function parseCronEvents(raw: string[]): LiveScoresCronExecutionEvent[] {
  const out: LiveScoresCronExecutionEvent[] = [];
  for (const line of raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { event?: unknown }).event === 'live-scores-cron'
    ) {
      out.push(parsed as LiveScoresCronExecutionEvent);
    }
  }
  return out;
}

const APPROVED_KEYS = [
  'committedGames',
  'durationMs',
  'event',
  'mode',
  'providerCallAttempted',
  'quotaChecked',
  'reason',
  'result',
  'targetGames',
  'targetPartitions',
  'year',
].sort();

/** Run the cron once; parse events; tolerate a thrown handler (still one event). */
export async function runCron(req: Request = cronRequest()): Promise<{
  res: Response | null;
  event: LiveScoresCronExecutionEvent;
  threw: unknown;
  raw: string[];
}> {
  const cap = installLogCapture();
  let res: Response | null = null;
  let threw: unknown = null;
  try {
    res = await GET(req);
  } catch (error) {
    threw = error;
  } finally {
    cap.restore();
  }
  const events = parseCronEvents(cap.raw);
  assert.equal(
    events.length,
    1,
    `exactly one live-scores-cron event per invocation (got ${events.length})`
  );
  const event = events[0]!;
  assert.deepEqual(Object.keys(event).slice().sort(), APPROVED_KEYS);
  assert.equal(event.event, 'live-scores-cron');
  return { res, event, threw, raw: cap.raw };
}

export async function resetForTest(): Promise<void> {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  delete MUTABLE_ENV.DATABASE_URL;
  globalThis.fetch = ORIGINAL_FETCH;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
}

export function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
}
