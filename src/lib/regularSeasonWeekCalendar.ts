import type { ScheduleWireItem } from './schedule.ts';

const REGULAR_SEASON_CLUSTER_GAP_DAYS = 3;
const CLUSTER_DATE_TIME_ZONE = 'America/New_York';

export type WeekCorrectionReason = 'derived_week_0_from_opening_cluster';

export type RegularSeasonDateBucket = {
  dateKey: string;
  games: ScheduleWireItem[];
};

export type RegularSeasonDateCluster = {
  clusterId: string;
  startDateKey: string;
  endDateKey: string;
  dateKeys: string[];
  gameCount: number;
  providerWeeks: number[];
};

export type RegularSeasonWeekCalendar = {
  week0DateKeys: Set<string>;
  week1DateKeys: Set<string>;
  openingWeek0Cluster: RegularSeasonDateCluster | null;
  openingWeek1Cluster: RegularSeasonDateCluster | null;
};

function normalizeRegularSeasonDateKey(startDate: string | null): string | null {
  if (!startDate) return null;
  const kickoff = new Date(startDate);
  if (Number.isNaN(kickoff.getTime())) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUSTER_DATE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(kickoff);
}

function diffDays(left: string, right: string): number {
  const leftMs = Date.parse(`${left}T00:00:00Z`);
  const rightMs = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return Number.POSITIVE_INFINITY;
  return Math.round((rightMs - leftMs) / (24 * 60 * 60 * 1000));
}

export function buildRegularSeasonDateBuckets(
  games: ScheduleWireItem[]
): RegularSeasonDateBucket[] {
  const byDate = new Map<string, ScheduleWireItem[]>();

  for (const game of games) {
    if (game.seasonType === 'postseason') continue;
    const dateKey = normalizeRegularSeasonDateKey(game.startDate);
    if (!dateKey) continue;
    const bucket = byDate.get(dateKey) ?? [];
    bucket.push(game);
    byDate.set(dateKey, bucket);
  }

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, bucketGames]) => ({ dateKey, games: bucketGames }));
}

export function buildRegularSeasonDateClusters(
  games: ScheduleWireItem[]
): RegularSeasonDateCluster[] {
  const buckets = buildRegularSeasonDateBuckets(games);
  if (!buckets.length) return [];

  const clusters: RegularSeasonDateCluster[] = [];
  let current: RegularSeasonDateCluster | null = null;

  for (const bucket of buckets) {
    if (!current) {
      current = {
        clusterId: bucket.dateKey,
        startDateKey: bucket.dateKey,
        endDateKey: bucket.dateKey,
        dateKeys: [bucket.dateKey],
        gameCount: bucket.games.length,
        providerWeeks: Array.from(new Set(bucket.games.map((game) => game.week))).sort(
          (a, b) => a - b
        ),
      };
      continue;
    }

    const gapDays = diffDays(current.endDateKey, bucket.dateKey);
    if (gapDays <= REGULAR_SEASON_CLUSTER_GAP_DAYS) {
      current.endDateKey = bucket.dateKey;
      current.dateKeys.push(bucket.dateKey);
      current.gameCount += bucket.games.length;
      current.providerWeeks = Array.from(
        new Set([...current.providerWeeks, ...bucket.games.map((game) => game.week)])
      ).sort((a, b) => a - b);
      continue;
    }

    clusters.push(current);
    current = {
      clusterId: bucket.dateKey,
      startDateKey: bucket.dateKey,
      endDateKey: bucket.dateKey,
      dateKeys: [bucket.dateKey],
      gameCount: bucket.games.length,
      providerWeeks: Array.from(new Set(bucket.games.map((game) => game.week))).sort(
        (a, b) => a - b
      ),
    };
  }

  if (current) clusters.push(current);
  return clusters;
}

export function buildRegularSeasonWeekCalendar(
  games: ScheduleWireItem[]
): RegularSeasonWeekCalendar {
  const clusters = buildRegularSeasonDateClusters(games);
  const firstCluster = clusters[0] ?? null;
  const secondCluster = clusters[1] ?? null;

  const hasDuplicateWeekOneEvidence =
    firstCluster?.providerWeeks.length === 1 &&
    secondCluster?.providerWeeks.length === 1 &&
    firstCluster.providerWeeks[0] === 1 &&
    secondCluster.providerWeeks[0] === 1;

  const hasDerivedWeek0 =
    hasDuplicateWeekOneEvidence &&
    firstCluster != null &&
    secondCluster != null &&
    firstCluster.gameCount < secondCluster.gameCount;

  const openingWeek0Cluster = hasDerivedWeek0 ? firstCluster : null;
  const openingWeek1Cluster = hasDerivedWeek0 ? secondCluster : firstCluster;

  return {
    week0DateKeys: new Set(openingWeek0Cluster?.dateKeys ?? []),
    week1DateKeys: new Set(openingWeek1Cluster?.dateKeys ?? []),
    openingWeek0Cluster,
    openingWeek1Cluster,
  };
}

export function deriveCanonicalRegularSeasonWeek(
  game: ScheduleWireItem,
  weekCalendar: RegularSeasonWeekCalendar
): {
  providerWeek: number;
  canonicalWeek: number;
  weekCorrectionReason: WeekCorrectionReason | null;
} {
  const providerWeek = game.week;
  if (game.seasonType === 'postseason') {
    return { providerWeek, canonicalWeek: providerWeek, weekCorrectionReason: null };
  }

  const dateKey = normalizeRegularSeasonDateKey(game.startDate);
  if (
    dateKey &&
    weekCalendar.week0DateKeys.has(dateKey) &&
    weekCalendar.openingWeek1Cluster != null &&
    providerWeek === 1
  ) {
    return {
      providerWeek,
      canonicalWeek: 0,
      weekCorrectionReason: 'derived_week_0_from_opening_cluster',
    };
  }

  return { providerWeek, canonicalWeek: providerWeek, weekCorrectionReason: null };
}

type CanonicalWeekAnnotatedItem<T extends ScheduleWireItem> = T & {
  providerWeek: number;
  canonicalWeek: number;
  weekCorrectionReason: WeekCorrectionReason | null;
};

function hasCanonicalWeekAnnotation(game: ScheduleWireItem): boolean {
  return (
    Number.isInteger(game.providerWeek) &&
    game.providerWeek! >= 0 &&
    Number.isInteger(game.canonicalWeek) &&
    game.canonicalWeek! >= 0
  );
}

/**
 * Attach the canonical/provider week pair while the complete schedule is still
 * available. A response projection can then remove known lower-division rows
 * without changing the opening-cluster or postseason-offset inputs that shaped
 * the surviving games.
 *
 * Existing annotations are preserved. This lets a projected API response carry
 * the full-schedule result into `buildScheduleFromApi`; durable cache rows that
 * predate the annotation are derived from their complete input as before.
 */
export function annotateCanonicalScheduleWeeks<T extends ScheduleWireItem>(
  games: T[]
): Array<CanonicalWeekAnnotatedItem<T>> {
  const weekCalendar = buildRegularSeasonWeekCalendar(games);
  const regularSeasonItems = games.filter((game) => game.seasonType !== 'postseason');
  const hasRegularSeasonContext = regularSeasonItems.length > 0;
  const maxRegularSeasonWeek = regularSeasonItems.reduce(
    (max, game) => Math.max(max, typeof game.week === 'number' ? game.week : 0),
    0
  );

  return games.map((game) => {
    if (hasCanonicalWeekAnnotation(game)) {
      return {
        ...game,
        providerWeek: game.providerWeek!,
        canonicalWeek: game.canonicalWeek!,
        weekCorrectionReason:
          game.weekCorrectionReason === 'derived_week_0_from_opening_cluster'
            ? game.weekCorrectionReason
            : null,
      };
    }

    const derived = deriveCanonicalRegularSeasonWeek(game, weekCalendar);
    const canonicalWeek =
      game.seasonType === 'postseason' && hasRegularSeasonContext && maxRegularSeasonWeek > 0
        ? maxRegularSeasonWeek + derived.providerWeek
        : derived.canonicalWeek;

    return {
      ...game,
      providerWeek: derived.providerWeek,
      canonicalWeek,
      weekCorrectionReason: derived.weekCorrectionReason,
    };
  });
}
