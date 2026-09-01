'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { LeagueStatus } from '../../lib/league.ts';
import type {
  WeeklyRecapGameLine,
  WeeklyRecapLeaderLine,
  WeeklyRecapMovementLine,
  WeeklyRecapRecordChangeLine,
  WeeklyRecapTileHighlight,
  WeeklyRecapViewModel,
} from '../../lib/recap/composeWeeklyRecap.ts';
import type { AppGame } from '../../lib/schedule.ts';
import type { Insight } from '../../lib/selectors/insights.ts';
import { selectWeeklyRecapEligibilityBoundaryKey } from '../../lib/selectors/weeklyRecapFacts.ts';
import type { LifecycleState } from '../../lib/insights/types.ts';

const INACTIVE_RECAP: WeeklyRecapViewModel = { status: 'inactive' };
const UNAVAILABLE_RECAP: WeeklyRecapViewModel = { status: 'unavailable' };
const LIFECYCLE_STATES = new Set<LifecycleState>([
  'preseason',
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
]);

type InsightsPayload = {
  insights: Insight[];
  lifecycleState: LifecycleState | undefined;
  weeklyRecap: WeeklyRecapViewModel;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const WEEKLY_RECAP_LEADER_IDS = new Set<WeeklyRecapLeaderLine['id']>([
  'best-record',
  'high-score',
  'closest-game',
  'biggest-riser',
]);

function parseLeaderLines(value: unknown): WeeklyRecapLeaderLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.filter(
    (line): line is WeeklyRecapLeaderLine =>
      isRecord(line) &&
      typeof line.id === 'string' &&
      WEEKLY_RECAP_LEADER_IDS.has(line.id as WeeklyRecapLeaderLine['id']) &&
      typeof line.label === 'string' &&
      typeof line.value === 'string' &&
      typeof line.context === 'string' &&
      (line.tone === undefined || line.tone === 'positive')
  );
  return lines.length === value.length ? lines : null;
}

function parseMovementLines(value: unknown): WeeklyRecapMovementLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.filter(
    (line): line is WeeklyRecapMovementLine =>
      isRecord(line) &&
      typeof line.owner === 'string' &&
      (line.direction === 'up' || line.direction === 'down') &&
      typeof line.deltaLabel === 'string' &&
      typeof line.shiftLabel === 'string'
  );
  return lines.length === value.length ? lines : null;
}

function parseGameSide(
  value: unknown
): { team: string; owner: string | null; score: string } | null {
  return isRecord(value) &&
    typeof value.team === 'string' &&
    (typeof value.owner === 'string' || value.owner === null) &&
    typeof value.score === 'string'
    ? { team: value.team, owner: value.owner, score: value.score }
    : null;
}

function parseGameLine(value: unknown): WeeklyRecapGameLine | null {
  if (
    !isRecord(value) ||
    value.kind !== 'game' ||
    typeof value.id !== 'string' ||
    typeof value.gameKey !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.detail !== 'string'
  ) {
    return null;
  }
  const winner = parseGameSide(value.winner);
  const loser = parseGameSide(value.loser);
  return winner && loser
    ? {
        kind: 'game',
        id: value.id,
        gameKey: value.gameKey,
        label: value.label,
        detail: value.detail,
        winner,
        loser,
      }
    : null;
}

function parseGameLines(value: unknown): WeeklyRecapGameLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.map(parseGameLine);
  return lines.every((line): line is WeeklyRecapGameLine => line !== null) ? lines : null;
}

function parseRecordChangeLine(value: unknown): WeeklyRecapRecordChangeLine | null {
  return isRecord(value) &&
    value.kind === 'record-change' &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.value === 'string' &&
    typeof value.context === 'string'
    ? {
        kind: 'record-change',
        id: value.id,
        label: value.label,
        value: value.value,
        context: value.context,
      }
    : null;
}

function parseRecordChangeLines(value: unknown): WeeklyRecapRecordChangeLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.map(parseRecordChangeLine);
  return lines.every((line): line is WeeklyRecapRecordChangeLine => line !== null) ? lines : null;
}

function parseTileHighlights(value: unknown): WeeklyRecapTileHighlight[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.map((line) => parseRecordChangeLine(line) ?? parseGameLine(line));
  return lines.every((line): line is WeeklyRecapTileHighlight => line !== null) ? lines : null;
}

function parseWeeklyRecap(value: unknown): WeeklyRecapViewModel {
  if (!isRecord(value) || typeof value.status !== 'string') return UNAVAILABLE_RECAP;
  if (value.status === 'inactive' || value.status === 'absent' || value.status === 'unavailable') {
    return { status: value.status };
  }
  if (
    value.status !== 'available' ||
    typeof value.week !== 'number' ||
    typeof value.weekLabel !== 'string' ||
    typeof value.latestGameDate !== 'string' ||
    !(typeof value.headline === 'string' || value.headline === null) ||
    typeof value.isIncomplete !== 'boolean' ||
    !Array.isArray(value.ownerLines)
  ) {
    return UNAVAILABLE_RECAP;
  }

  const ownerLines = value.ownerLines.filter(
    (line): line is { owner: string; recordLabel: string; pointsLabel: string } =>
      isRecord(line) &&
      typeof line.owner === 'string' &&
      typeof line.recordLabel === 'string' &&
      typeof line.pointsLabel === 'string'
  );
  if (ownerLines.length !== value.ownerLines.length) return UNAVAILABLE_RECAP;
  // These recap detail fields are additive. During a rolling deploy, an older API
  // response remains a valid Slice 1 recap; malformed fields that are present
  // still fail the recap closed without affecting the standing Insights feed.
  const leaderLines = value.leaderLines === undefined ? [] : parseLeaderLines(value.leaderLines);
  const tileLeaderLines =
    value.tileLeaderLines === undefined ? [] : parseLeaderLines(value.tileLeaderLines);
  const movementLines =
    value.movementLines === undefined ? [] : parseMovementLines(value.movementLines);
  const recordChangeLines =
    value.recordChangeLines === undefined ? [] : parseRecordChangeLines(value.recordChangeLines);
  const headToHeadLines =
    value.headToHeadLines === undefined ? [] : parseGameLines(value.headToHeadLines);
  const notableResultLines =
    value.notableResultLines === undefined ? [] : parseGameLines(value.notableResultLines);
  const tileHighlights =
    value.tileHighlights === undefined ? [] : parseTileHighlights(value.tileHighlights);
  if (
    !leaderLines ||
    !tileLeaderLines ||
    !movementLines ||
    !recordChangeLines ||
    !headToHeadLines ||
    !notableResultLines ||
    !tileHighlights
  ) {
    return UNAVAILABLE_RECAP;
  }

  return {
    status: 'available',
    week: value.week,
    weekLabel: value.weekLabel,
    latestGameDate: value.latestGameDate,
    headline: value.headline,
    isIncomplete: value.isIncomplete,
    ownerLines,
    leaderLines,
    tileLeaderLines,
    movementLines,
    recordChangeLines,
    headToHeadLines,
    notableResultLines,
    tileHighlights,
  };
}

export function parseInsightsPayload(value: unknown): InsightsPayload {
  if (!isRecord(value)) {
    return { insights: [], lifecycleState: undefined, weeklyRecap: UNAVAILABLE_RECAP };
  }

  const lifecycleState =
    typeof value.lifecycleState === 'string' &&
    LIFECYCLE_STATES.has(value.lifecycleState as LifecycleState)
      ? (value.lifecycleState as LifecycleState)
      : undefined;

  return {
    insights: Array.isArray(value.insights) ? (value.insights as Insight[]) : [],
    lifecycleState,
    weeklyRecap: parseWeeklyRecap(value.weeklyRecap),
  };
}

export function useInsightsFeed(args: {
  leagueSlug?: string;
  seasonYear: number;
  leagueStatus: LeagueStatus | undefined;
  games: AppGame[];
  scheduleLoaded: boolean;
  nowTick: number;
  enabled?: boolean;
}): InsightsPayload & { weeklyRecapResolved: boolean; refreshInsights: () => void } {
  const { leagueSlug, seasonYear, leagueStatus, nowTick, enabled = true } = args;
  const [payload, setPayload] = useState<InsightsPayload>({
    insights: [],
    lifecycleState: undefined,
    weeklyRecap: INACTIVE_RECAP,
  });
  const [resolvedRequestKey, setResolvedRequestKey] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestSequenceRef = useRef(0);
  const payloadScopeRef = useRef<string | null>(null);

  const refreshInsights = useCallback(() => {
    setRefreshRevision((revision) => revision + 1);
  }, []);

  const lifecycleKey = leagueStatus
    ? `${leagueStatus.state}:${'year' in leagueStatus ? leagueStatus.year : 'none'}`
    : 'missing';
  const requestScopeKey = leagueSlug ? `${leagueSlug}:${seasonYear}:${lifecycleKey}` : null;
  const eligibilityBoundaryKey =
    nowTick > 0 ? selectWeeklyRecapEligibilityBoundaryKey(new Date(nowTick)) : null;
  const requestResolutionKey =
    requestScopeKey && eligibilityBoundaryKey
      ? `${requestScopeKey}:${eligibilityBoundaryKey}:${refreshRevision}`
      : null;

  useEffect(() => {
    if (!enabled || !leagueSlug) {
      requestSequenceRef.current += 1;
      payloadScopeRef.current = null;
      setPayload({ insights: [], lifecycleState: undefined, weeklyRecap: INACTIVE_RECAP });
      setResolvedRequestKey(null);
      return;
    }
    // The mounted app arms its clock immediately after hydration. Waiting for
    // that value avoids a duplicate first request while keeping the boundary
    // decision independent from client schedule readiness.
    if (eligibilityBoundaryKey === null) return;

    const scopeKey = `${leagueSlug}:${seasonYear}:${lifecycleKey}`;
    const resolutionKey = `${scopeKey}:${eligibilityBoundaryKey}:${refreshRevision}`;
    const requestSequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    void fetch(`/api/insights/${encodeURIComponent(leagueSlug)}?year=${seasonYear}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Insights request failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((value) => {
        if (requestSequence !== requestSequenceRef.current) return;
        payloadScopeRef.current = scopeKey;
        setPayload(parseInsightsPayload(value));
        setResolvedRequestKey(resolutionKey);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
        void error;
        const canPreserveFeed = payloadScopeRef.current === scopeKey;
        setPayload((current) =>
          canPreserveFeed
            ? { ...current, weeklyRecap: UNAVAILABLE_RECAP }
            : { insights: [], lifecycleState: undefined, weeklyRecap: UNAVAILABLE_RECAP }
        );
        payloadScopeRef.current = scopeKey;
        setResolvedRequestKey(resolutionKey);
      });

    return () => controller.abort();
  }, [eligibilityBoundaryKey, enabled, leagueSlug, lifecycleKey, refreshRevision, seasonYear]);

  const scopedPayload = enabled && payloadScopeRef.current === requestScopeKey ? payload : null;
  const weeklyRecapResolved = scopedPayload !== null && resolvedRequestKey === requestResolutionKey;

  return {
    insights: scopedPayload?.insights ?? [],
    lifecycleState: scopedPayload?.lifecycleState,
    weeklyRecap: weeklyRecapResolved ? scopedPayload.weeklyRecap : INACTIVE_RECAP,
    weeklyRecapResolved,
    refreshInsights,
  };
}
