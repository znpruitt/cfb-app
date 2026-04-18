import type { Insight } from '../selectors/insights';
import type { InsightType } from '../selectors/insights';
import {
  deleteAppState,
  getAppState,
  listAppStateKeys,
  setAppState,
} from '../server/appStateStore';
import type { NewsHook } from './types';

const SCOPE = 'insights-suppression';

export type SuppressionRecord = {
  insightId: string;
  hook: NewsHook;
  owner: string;
  firedAt: string;
  statValue: number;
};

// Insight types that are always newsworthy and never suppressed.
const NEVER_SUPPRESS_TYPES: ReadonlySet<InsightType> = new Set<InsightType>([
  'milestone_watch',
  'perfect_against',
  'rookie_benchmark',
]);

// Per-type threshold metadata. Matches the semantics in the campaign spec.
// 'abs': suppress if |curr - prev| <= threshold
// 'pct': suppress if |curr - prev| / |prev| <= threshold (e.g. 0.05 = 5%)
// 'unchanged': suppress if statValue is identical
// 'snapshot': suppress after first fire (used for pure current-state insights)
type ThresholdRule =
  | { kind: 'abs'; value: number }
  | { kind: 'pct'; value: number }
  | { kind: 'unchanged' }
  | { kind: 'snapshot' };

const TYPE_THRESHOLDS: Partial<Record<InsightType, ThresholdRule>> = {
  career_points_leader: { kind: 'pct', value: 0.05 },
  career_turnover_margin: { kind: 'abs', value: 10 },
  lopsided_rivalry: { kind: 'unchanged' },
  dominance_streak: { kind: 'unchanged' },
  dynasty: { kind: 'unchanged' },
  drought: { kind: 'unchanged' },
  even_rivalry: { kind: 'unchanged' },
  consistency: { kind: 'unchanged' },
  improvement: { kind: 'unchanged' },
  title_chaser: { kind: 'unchanged' },
  volatility: { kind: 'unchanged' },
  never_last: { kind: 'unchanged' },
  trending_up: { kind: 'unchanged' },
  trending_down: { kind: 'unchanged' },
  greatest_season: { kind: 'unchanged' },
};

function buildKey(insightId: string, hook: NewsHook): string {
  return `${insightId}:${hook}`;
}

function primaryOwner(insight: Insight): string {
  return insight.owner ?? insight.owners?.[0] ?? '';
}

export async function loadSuppressionRecords(): Promise<Map<string, SuppressionRecord>> {
  try {
    const keys = await listAppStateKeys(SCOPE);
    const records = new Map<string, SuppressionRecord>();
    await Promise.all(
      keys.map(async (key) => {
        const record = await getAppState<SuppressionRecord>(SCOPE, key).catch(() => null);
        if (record?.value) records.set(key, record.value);
      })
    );
    return records;
  } catch {
    return new Map();
  }
}

export async function saveSuppressionRecord(record: SuppressionRecord): Promise<void> {
  try {
    await setAppState(SCOPE, buildKey(record.insightId, record.hook), record);
  } catch {
    // Non-blocking: storage failure does not prevent insights from serving.
  }
}

export async function clearAllSuppressionRecords(): Promise<number> {
  try {
    const keys = await listAppStateKeys(SCOPE);
    await Promise.all(keys.map((key) => deleteAppState(SCOPE, key).catch(() => undefined)));
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Determines whether an insight should be suppressed given previously-fired
 * records. Pure function — no I/O. Threshold lookup is internal so callers
 * don't need to maintain their own table.
 *
 * Rules:
 *   - NEVER_SUPPRESS_TYPES: always fire
 *   - snapshot hook: suppress on any repeat fire
 *   - prior record missing or different owner: don't suppress (treat as new)
 *   - otherwise: apply per-type threshold rule
 */
export function isSuppressed(insight: Insight, records: Map<string, SuppressionRecord>): boolean {
  if (NEVER_SUPPRESS_TYPES.has(insight.type)) return false;

  const key = buildKey(insight.id, insight.newsHook);
  const prior = records.get(key);
  if (!prior) return false;

  if (prior.owner !== primaryOwner(insight)) return false;

  if (insight.newsHook === 'snapshot') return true;

  const rule = TYPE_THRESHOLDS[insight.type];
  if (!rule) return false;

  const diff = Math.abs(insight.statValue - prior.statValue);

  switch (rule.kind) {
    case 'abs':
      return diff <= rule.value;
    case 'pct': {
      const base = Math.abs(prior.statValue);
      if (base === 0) return diff === 0;
      return diff / base < rule.value;
    }
    case 'unchanged':
      return diff === 0;
    case 'snapshot':
      return true;
    default:
      return false;
  }
}

export function toSuppressionRecord(insight: Insight): SuppressionRecord {
  return {
    insightId: insight.id,
    hook: insight.newsHook,
    owner: primaryOwner(insight),
    firedAt: new Date().toISOString(),
    statValue: insight.statValue,
  };
}
