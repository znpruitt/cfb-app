'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LeagueStatus } from '../../lib/league.ts';
import type { WeeklyRecapViewModel } from '../../lib/recap/composeWeeklyRecap.ts';
import type { AppGame } from '../../lib/schedule.ts';
import type { Insight } from '../../lib/selectors/insights.ts';
import {
  isWeeklyRecapActiveSeason,
  selectWeeklyRecapTargetWeek,
} from '../../lib/selectors/weeklyRecapFacts.ts';
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

  return {
    status: 'available',
    week: value.week,
    weekLabel: value.weekLabel,
    latestGameDate: value.latestGameDate,
    headline: value.headline,
    isIncomplete: value.isIncomplete,
    ownerLines,
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
}): InsightsPayload & { refreshInsights: () => void } {
  const { leagueSlug, seasonYear, leagueStatus, games, scheduleLoaded, nowTick } = args;
  const [payload, setPayload] = useState<InsightsPayload>({
    insights: [],
    lifecycleState: undefined,
    weeklyRecap: INACTIVE_RECAP,
  });
  const [resolvedScopeKey, setResolvedScopeKey] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestSequenceRef = useRef(0);
  const observedTargetScopeRef = useRef<string | null>(null);
  const observedTargetKeyRef = useRef<string | null>(null);

  const refreshInsights = useCallback(() => {
    setRefreshRevision((revision) => revision + 1);
  }, []);

  const lifecycleKey = leagueStatus
    ? `${leagueStatus.state}:${'year' in leagueStatus ? leagueStatus.year : 'none'}`
    : 'missing';
  const requestScopeKey = leagueSlug ? `${leagueSlug}:${seasonYear}:${lifecycleKey}` : null;

  useEffect(() => {
    if (!leagueSlug) {
      requestSequenceRef.current += 1;
      setPayload({ insights: [], lifecycleState: undefined, weeklyRecap: INACTIVE_RECAP });
      setResolvedScopeKey(null);
      return;
    }

    const scopeKey = `${leagueSlug}:${seasonYear}:${lifecycleKey}`;
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
        setPayload(parseInsightsPayload(value));
        setResolvedScopeKey(scopeKey);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
        void error;
        setPayload({ insights: [], lifecycleState: undefined, weeklyRecap: UNAVAILABLE_RECAP });
        setResolvedScopeKey(scopeKey);
      });

    return () => controller.abort();
  }, [leagueSlug, lifecycleKey, refreshRevision, seasonYear]);

  const activeSeason = isWeeklyRecapActiveSeason({ leagueStatus, seasonYear });
  const targetWeek = useMemo(
    () =>
      activeSeason && scheduleLoaded && nowTick > 0
        ? (selectWeeklyRecapTargetWeek(games, new Date(nowTick))?.week ?? null)
        : null,
    [activeSeason, games, nowTick, scheduleLoaded]
  );
  const targetKey =
    activeSeason && scheduleLoaded && nowTick > 0
      ? `${leagueSlug ?? 'none'}:${seasonYear}:${targetWeek ?? 'none'}`
      : null;
  const targetScopeKey = targetKey === null ? null : requestScopeKey;
  const resolvedPayload = resolvedScopeKey === requestScopeKey ? payload : null;

  useEffect(() => {
    if (targetKey === null || targetScopeKey === null) {
      observedTargetScopeRef.current = null;
      observedTargetKeyRef.current = null;
      return;
    }
    if (observedTargetScopeRef.current !== targetScopeKey) {
      if (!resolvedPayload) return;
      observedTargetScopeRef.current = targetScopeKey;
      observedTargetKeyRef.current = targetKey;
      const responseWeek =
        resolvedPayload.weeklyRecap.status === 'available'
          ? resolvedPayload.weeklyRecap.week
          : null;
      if (targetWeek !== null && responseWeek !== targetWeek) refreshInsights();
      return;
    }
    if (observedTargetKeyRef.current === targetKey) return;

    observedTargetKeyRef.current = targetKey;
    refreshInsights();
  }, [refreshInsights, resolvedPayload, targetKey, targetScopeKey, targetWeek]);

  return {
    ...(resolvedPayload ?? {
      insights: [],
      lifecycleState: undefined,
      weeklyRecap: INACTIVE_RECAP,
    }),
    refreshInsights,
  };
}
