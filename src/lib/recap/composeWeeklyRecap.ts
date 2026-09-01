import type { LeagueStatus } from '../league.ts';
import {
  isWeeklyRecapActiveSeason,
  selectWeeklyRecapLeaders,
  selectWeeklyRecapFacts,
  type WeeklyOwnedGameResult,
  type WeeklyOwnerResult,
} from '../selectors/weeklyRecapFacts.ts';
import type { WeeklyOddsUpset } from '../selectors/weeklyOddsUpsets.ts';
import type { WeeklyRecordChange } from '../selectors/weeklyRecordChanges.ts';
import { buildWeekLabelMap, formatWeekLabel } from '../weekLabel.ts';
import type { WeeklyRecapContextResult } from './loadRecapContext.ts';

export type WeeklyRecapOwnerLine = {
  owner: string;
  recordLabel: string;
  pointsLabel: string;
};

export type WeeklyRecapLeaderLine = {
  id: 'best-record' | 'high-score' | 'closest-game' | 'biggest-riser';
  label: string;
  value: string;
  context: string;
  tone?: 'positive';
};

export type WeeklyRecapMovementLine = {
  owner: string;
  direction: 'up' | 'down';
  deltaLabel: string;
  shiftLabel: string;
};

export type WeeklyRecapGameLine = {
  kind: 'game';
  id: string;
  gameKey: string;
  label: string;
  detail: string;
  winner: { team: string; owner: string | null; score: string };
  loser: { team: string; owner: string | null; score: string };
};

export type WeeklyRecapRecordChangeLine = {
  kind: 'record-change';
  id: string;
  label: string;
  value: string;
  context: string;
};

export type WeeklyRecapTileHighlight = WeeklyRecapRecordChangeLine | WeeklyRecapGameLine;

export type WeeklyRecapViewModel =
  | { status: 'inactive' }
  | { status: 'absent' }
  | { status: 'unavailable' }
  | {
      status: 'available';
      week: number;
      weekLabel: string;
      latestGameDate: string;
      headline: string | null;
      isIncomplete: boolean;
      ownerLines: WeeklyRecapOwnerLine[];
      leaderLines: WeeklyRecapLeaderLine[];
      tileLeaderLines: WeeklyRecapLeaderLine[];
      movementLines: WeeklyRecapMovementLine[];
      recordChangeLines: WeeklyRecapRecordChangeLine[];
      headToHeadLines: WeeklyRecapGameLine[];
      notableResultLines: WeeklyRecapGameLine[];
      tileHighlights: WeeklyRecapTileHighlight[];
    };

export type AvailableWeeklyRecapViewModel = Extract<WeeklyRecapViewModel, { status: 'available' }>;

export type WeeklyRecapSeasonScope = {
  leagueStatus: LeagueStatus | undefined;
  seasonYear: number;
};

const SMALL_COUNT_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
] as const;

function weeklyHeadline(facts: ReturnType<typeof selectWeeklyRecapFacts>): string | null {
  if (!facts) return null;
  if (facts.unresolvedCount > 0 || facts.abandonedCount > 0 || facts.missingResultCount > 0) {
    return null;
  }

  const leaders = selectWeeklyRecapLeaders(facts.ownerResults);
  const first = leaders[0];
  if (!first) return null;
  const record = `${first.wins}–${first.losses}`;
  if (leaders.length === 1) return `${first.owner} takes the week at ${record}`;
  if (leaders.length === 2) {
    return `${leaders[0].owner} and ${leaders[1].owner} share the week at ${record}`;
  }

  const count = SMALL_COUNT_WORDS[leaders.length] ?? String(leaders.length);
  return `${count} owners share the week at ${record}`;
}

function ownerNames(results: WeeklyOwnerResult[]): string {
  return formatOwnerNames(results.map((result) => result.owner));
}

function formatOwnerNames(owners: string[]): string {
  if (owners.length === 1) return owners[0]!;
  if (owners.length === 2) return `${owners[0]} & ${owners[1]}`;
  return `${owners.length} owners tied`;
}

function formatAllOwnerNames(owners: string[]): string {
  if (owners.length <= 2) return formatOwnerNames(owners);
  return `${owners.slice(0, -1).join(', ')} & ${owners.at(-1)}`;
}

function gameResultContext(result: WeeklyOwnedGameResult): string {
  const sameOwner = result.winnerOwner != null && result.winnerOwner === result.loserOwner;
  const winner = sameOwner ? result.winnerTeam : (result.winnerOwner ?? result.winnerTeam);
  const loser = sameOwner ? result.loserTeam : (result.loserOwner ?? result.loserTeam);
  const margin = `${result.margin}-point margin`;
  return `${winner} over ${loser} · ${margin}`;
}

function ownerContext(owners: string[]): string {
  return owners.length > 0 ? formatAllOwnerNames(owners) : 'League record';
}

function recordSubject(
  change: WeeklyRecordChange,
  record: NonNullable<WeeklyRecordChange['current']>
): string {
  if (
    change.id === 'lopsided_rivalry' ||
    change.id === 'even_rivalry' ||
    change.id === 'dominance_streak'
  ) {
    return (
      record.contextString ??
      (record.constituentKeys ? `${record.constituentKeys.length} rivalries tied` : null) ??
      'Multiple rivalries tied'
    );
  }
  return ownerContext(record.holders);
}

function sameRecordHolders(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((holder, index) => holder === right[index]);
}

function rivalryConstituentLabel(change: WeeklyRecordChange, key: string): string | null {
  try {
    const pair: unknown = JSON.parse(key);
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string'
    ) {
      return null;
    }
    return change.id === 'even_rivalry' ? `${pair[0]} & ${pair[1]}` : `${pair[0]} over ${pair[1]}`;
  } catch {
    return null;
  }
}

function rivalryConstituentDelta(change: WeeklyRecordChange): string | null {
  if (!change.previous || !change.current) return null;
  if (change.previous.contextString && change.current.contextString) return null;
  const previous = new Set(change.previous.constituentKeys ?? []);
  const current = new Set(change.current.constituentKeys ?? []);
  const joined = [...current]
    .filter((key) => !previous.has(key))
    .map((key) => rivalryConstituentLabel(change, key))
    .filter((label): label is string => label !== null);
  const dropped = [...previous]
    .filter((key) => !current.has(key))
    .map((key) => rivalryConstituentLabel(change, key))
    .filter((label): label is string => label !== null);
  const details = [
    joined.length > 0 ? `${joined.join('; ')} joined` : null,
    dropped.length > 0 ? `${dropped.join('; ')} dropped out` : null,
  ].filter((detail): detail is string => detail !== null);
  return details.length > 0 ? details.join(' · ') : null;
}

function composeRecordChangeLine(
  change: WeeklyRecordChange,
  weekLabel: string
): WeeklyRecapRecordChangeLine | null {
  const label = change.current?.label ?? change.previous?.label;
  if (!label) return null;

  if (!change.current) {
    const previous = change.previous;
    const suppressed = change.suppressedCurrent;
    if (suppressed) {
      return {
        kind: 'record-change',
        id: `record-${change.id}`,
        label,
        value: 'Broad tie',
        context: `${suppressed.formattedValue} · Through ${weekLabel}${previous ? ` · Previous: ${previous.formattedValue} · ${recordSubject(change, previous)}` : ''}`,
      };
    }
    return previous
      ? {
          kind: 'record-change',
          id: `record-${change.id}`,
          label,
          value: 'No longer current',
          context: `Previous: ${previous.formattedValue} · ${recordSubject(change, previous)}`,
        }
      : null;
  }

  const holder = recordSubject(change, change.current);
  const previous = change.previous;
  const previousSubject = previous ? recordSubject(change, previous) : null;
  if (
    previous &&
    change.current.formattedValue === previous.formattedValue &&
    holder === previousSubject &&
    sameRecordHolders(change.current.holders, previous.holders) &&
    sameRecordHolders(change.current.constituentKeys ?? [], previous.constituentKeys ?? [])
  ) {
    // The selector also observes latest-game context changes. If that detail is
    // not safe to attribute in this compact line, do not manufacture a visible
    // change from identical value/subject copy.
    return null;
  }
  const constituentDelta = rivalryConstituentDelta(change);
  const previousContext = previous
    ? `Previous: ${previous.formattedValue} · ${previousSubject}`
    : change.suppressedPrevious
      ? `Previous: ${change.suppressedPrevious.formattedValue} · Broad tie`
      : 'New league record';
  const previousAddsInformation =
    !previous ||
    !constituentDelta ||
    change.current.formattedValue !== previous.formattedValue ||
    holder !== previousSubject;
  return {
    kind: 'record-change',
    id: `record-${change.id}`,
    label,
    value: change.current.formattedValue,
    context: `${holder}${constituentDelta ? ` · ${constituentDelta}` : ''} · Through ${weekLabel}${previousAddsInformation ? ` · ${previousContext}` : ''}`,
  };
}

type MutableGameLine = {
  gameKey: string;
  qualifiers: Map<string, string>;
  winner: WeeklyRecapGameLine['winner'];
  loser: WeeklyRecapGameLine['loser'];
};

const GAME_QUALIFIER_ORDER = new Map([
  ['Odds upset', 0],
  ['Closest game', 1],
  ['Biggest margin', 2],
  ['Head-to-head', 3],
]);

function ownedGameSides(result: WeeklyOwnedGameResult): Pick<MutableGameLine, 'winner' | 'loser'> {
  return {
    winner: {
      team: result.winnerTeam,
      owner: result.winnerOwner,
      score: String(result.winnerScore),
    },
    loser: {
      team: result.loserTeam,
      owner: result.loserOwner,
      score: String(result.loserScore),
    },
  };
}

function oddsUpsetSides(result: WeeklyOddsUpset): Pick<MutableGameLine, 'winner' | 'loser'> {
  return {
    winner: {
      team: result.winnerTeam,
      owner: result.winnerOwner,
      score: String(result.winnerScore),
    },
    loser: {
      team: result.favoriteTeam,
      owner: result.favoriteOwner,
      score: String(result.loserScore),
    },
  };
}

function addGameQualifier(
  lines: Map<string, MutableGameLine>,
  gameKey: string,
  sides: Pick<MutableGameLine, 'winner' | 'loser'>,
  label: string,
  detail: string
): void {
  const current = lines.get(gameKey) ?? {
    gameKey,
    qualifiers: new Map<string, string>(),
    ...sides,
  };
  current.qualifiers.set(label, detail);
  lines.set(gameKey, current);
}

function finalizeGameLine(line: MutableGameLine): WeeklyRecapGameLine {
  const qualifiers = Array.from(line.qualifiers.entries()).sort(
    ([left], [right]) =>
      (GAME_QUALIFIER_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (GAME_QUALIFIER_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right)
  );
  return {
    kind: 'game',
    id: `game-${line.gameKey}`,
    gameKey: line.gameKey,
    label: qualifiers.map(([label]) => label).join(' · '),
    detail: [...new Set(qualifiers.map(([, detail]) => detail))].join(' · '),
    winner: line.winner,
    loser: line.loser,
  };
}

function composeGameLines(facts: NonNullable<ReturnType<typeof selectWeeklyRecapFacts>>): {
  headToHeadLines: WeeklyRecapGameLine[];
  notableResultLines: WeeklyRecapGameLine[];
  prioritizedNotableLines: WeeklyRecapGameLine[];
} {
  const lines = new Map<string, MutableGameLine>();
  const headToHeadKeys = new Set(facts.ownerMatchups.map((result) => result.gameKey));

  for (const result of facts.ownerMatchups) {
    addGameQualifier(
      lines,
      result.gameKey,
      ownedGameSides(result),
      'Head-to-head',
      `${result.margin}-point margin`
    );
  }
  for (const result of facts.oddsUpsets) {
    addGameQualifier(
      lines,
      result.gameKey,
      oddsUpsetSides(result),
      'Odds upset',
      `Beat a ${result.spreadMagnitude}-point favorite`
    );
  }
  for (const result of facts.accolades.closestGames) {
    addGameQualifier(
      lines,
      result.gameKey,
      ownedGameSides(result),
      'Closest game',
      `${result.margin}-point margin`
    );
  }
  for (const result of facts.accolades.biggestBlowouts) {
    addGameQualifier(
      lines,
      result.gameKey,
      ownedGameSides(result),
      'Biggest margin',
      `${result.margin}-point margin`
    );
  }

  const finalized = new Map(
    Array.from(lines.entries()).map(([gameKey, line]) => [gameKey, finalizeGameLine(line)] as const)
  );
  const orderedUnique = (gameKeys: string[]): WeeklyRecapGameLine[] => {
    const seen = new Set<string>();
    return gameKeys.flatMap((gameKey) => {
      if (seen.has(gameKey)) return [];
      seen.add(gameKey);
      const line = finalized.get(gameKey);
      return line ? [line] : [];
    });
  };
  const notableKeys = [
    ...facts.oddsUpsets.map((result) => result.gameKey),
    ...facts.accolades.closestGames.map((result) => result.gameKey),
    ...facts.accolades.biggestBlowouts.map((result) => result.gameKey),
  ];

  return {
    headToHeadLines: orderedUnique(facts.ownerMatchups.map((result) => result.gameKey)),
    notableResultLines: orderedUnique(notableKeys).filter(
      (line) => !headToHeadKeys.has(line.id.slice('game-'.length))
    ),
    prioritizedNotableLines: orderedUnique(notableKeys),
  };
}

function composeLeaderLines(
  facts: NonNullable<ReturnType<typeof selectWeeklyRecapFacts>>
): WeeklyRecapLeaderLine[] {
  const lines: WeeklyRecapLeaderLine[] = [];
  const recordLeaders = selectWeeklyRecapLeaders(facts.ownerResults);
  const firstRecordLeader = recordLeaders[0];
  if (firstRecordLeader) {
    lines.push({
      id: 'best-record',
      label: 'Best record',
      value: `${firstRecordLeader.wins}–${firstRecordLeader.losses}`,
      context:
        recordLeaders.length === 1
          ? `${firstRecordLeader.owner} · ${firstRecordLeader.pointsFor} PF`
          : ownerNames(recordLeaders),
    });
  }

  const highScores = facts.accolades.highScores;
  const highScore = highScores[0];
  if (highScore) {
    lines.push({
      id: 'high-score',
      label: 'High score',
      value: String(highScore.pointsFor),
      context:
        highScores.length === 1
          ? `${highScore.owner} · ${highScore.wins}–${highScore.losses} on the week`
          : ownerNames(highScores),
    });
  }

  const closestGame = facts.accolades.closestGames[0];
  if (closestGame) {
    lines.push({
      id: 'closest-game',
      label: 'Closest game',
      value: `${closestGame.winnerScore}–${closestGame.loserScore}`,
      context: gameResultContext(closestGame),
    });
  }

  return lines;
}

export function composeWeeklyRecap(
  contextResult: WeeklyRecapContextResult,
  now: Date,
  scope: WeeklyRecapSeasonScope
): WeeklyRecapViewModel {
  if (!isWeeklyRecapActiveSeason(scope)) return { status: 'inactive' };
  if (contextResult.status === 'unavailable') return { status: 'unavailable' };
  if (contextResult.status === 'absent') return { status: 'absent' };
  if (contextResult.context.seasonYear !== scope.seasonYear) return { status: 'unavailable' };

  const facts = selectWeeklyRecapFacts({
    games: contextResult.context.games,
    rosterByTeam: contextResult.context.rosterByTeam,
    scoresByKey: contextResult.context.scoresByKey,
    oddsByGameKey:
      contextResult.context.odds.status === 'available' ? contextResult.context.odds.byGameKey : {},
    archives:
      contextResult.context.records.status === 'available'
        ? contextResult.context.records.archives
        : [],
    historicalRosters:
      contextResult.context.records.status === 'available'
        ? contextResult.context.records.historicalRosters
        : {},
    seasonYear: contextResult.context.seasonYear,
    now,
  });
  if (!facts) return { status: 'absent' };

  const weekLabelMap = buildWeekLabelMap(contextResult.context.games);
  const compactWeekLabel = formatWeekLabel(facts.targetWeek.week, weekLabelMap);
  const weekLabel = weekLabelMap.has(facts.targetWeek.week)
    ? compactWeekLabel
    : `Week ${facts.targetWeek.week}`;
  const ownerLines = facts.ownerResults.map((result) => ({
    owner: result.owner,
    recordLabel: `${result.wins}–${result.losses}`,
    pointsLabel: `${result.pointsFor} PF · ${result.pointsAgainst} PA`,
  }));
  const isIncomplete =
    facts.unresolvedCount > 0 || facts.abandonedCount > 0 || facts.missingResultCount > 0;
  const leaderLines = composeLeaderLines(facts);
  const movementLines: WeeklyRecapMovementLine[] = facts.rankMovement.map((movement) => ({
    owner: movement.owner,
    direction: movement.rankDelta > 0 ? 'up' : 'down',
    deltaLabel: `${movement.rankDelta > 0 ? '▲' : '▼'} ${Math.abs(movement.rankDelta)}`,
    shiftLabel: `#${movement.previousRank} → #${movement.currentRank}`,
  }));
  const biggestRiser = facts.rankMovement.find((movement) => movement.rankDelta > 0);
  const biggestRisers = biggestRiser
    ? facts.rankMovement.filter((movement) => movement.rankDelta === biggestRiser.rankDelta)
    : [];
  const hasTiedBiggestRisers = biggestRisers.length > 1;
  const tileLeaderLines = biggestRiser
    ? [
        ...leaderLines,
        {
          id: 'biggest-riser' as const,
          label: hasTiedBiggestRisers ? 'Biggest risers' : biggestRiser.owner,
          value: `▲ ${biggestRiser.rankDelta}`,
          context: hasTiedBiggestRisers
            ? formatAllOwnerNames(biggestRisers.map((movement) => movement.owner))
            : `Biggest riser · #${biggestRiser.previousRank} → #${biggestRiser.currentRank}`,
          tone: 'positive' as const,
        },
      ]
    : leaderLines;
  const recordChangeLines =
    contextResult.context.records.status === 'available'
      ? facts.recordChanges.flatMap((change) => {
          const line = composeRecordChangeLine(change, weekLabel);
          return line ? [line] : [];
        })
      : [];
  const gameLines = composeGameLines({
    ...facts,
    oddsUpsets: contextResult.context.odds.status === 'available' ? facts.oddsUpsets : [],
  });
  const tileHighlights: WeeklyRecapTileHighlight[] = [
    ...recordChangeLines,
    ...gameLines.prioritizedNotableLines,
  ].slice(0, 3);

  return {
    status: 'available',
    week: facts.targetWeek.week,
    weekLabel,
    latestGameDate: facts.targetWeek.latestGameDate,
    headline: weeklyHeadline(facts) ?? (ownerLines.length > 0 ? `${weekLabel} results` : null),
    isIncomplete,
    ownerLines,
    leaderLines,
    tileLeaderLines,
    movementLines,
    recordChangeLines,
    headToHeadLines: gameLines.headToHeadLines,
    notableResultLines: gameLines.notableResultLines,
    tileHighlights,
  };
}
