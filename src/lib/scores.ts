import type { DiagEntry } from './diagnostics';
import { normWithAliases, type AliasMap, variants } from './teamNames';

export type ScoreTeam = { team: string; score: number | null };
export type ScorePack = {
  status: string;
  home: ScoreTeam;
  away: ScoreTeam;
  time: string | null;
};

export type ScoresDiagEntry = Extract<DiagEntry, { kind: 'scores_miss' | 'week_mismatch' }>;

type GameLike = {
  key: string;
  week: number;
  canHome: string;
  canAway: string;
  csvHome: string;
  csvAway: string;
};

type WireFlat = {
  status: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  time: string | null;
};
type WireSide = { team?: string; score?: number | null } | null | undefined;
type WireObj = {
  status: string;
  time: string | null;
  home: WireSide;
  away: WireSide;
};

function extractRow(sg: WireFlat | WireObj) {
  if (typeof (sg as WireFlat).home === 'string') {
    const flat = sg as WireFlat;
    return {
      homeName: flat.home || '',
      awayName: flat.away || '',
      homeScore: flat.homeScore ?? null,
      awayScore: flat.awayScore ?? null,
      status: flat.status || '',
      time: flat.time ?? null,
    };
  }
  const obj = sg as WireObj;
  const h = obj.home ?? null;
  const a = obj.away ?? null;
  return {
    homeName: (h?.team ?? '') as string,
    awayName: (a?.team ?? '') as string,
    homeScore: (typeof h?.score === 'number' ? h?.score : (h?.score ?? null)) as number | null,
    awayScore: (typeof a?.score === 'number' ? a?.score : (a?.score ?? null)) as number | null,
    status: obj.status || '',
    time: obj.time ?? null,
  };
}

export async function fetchScoresByGame(params: {
  games: GameLike[];
  aliasMap: AliasMap;
  season: number;
}): Promise<{ scoresByKey: Record<string, ScorePack>; issues: string[]; diag: ScoresDiagEntry[] }> {
  const { games, aliasMap, season } = params;
  const issues: string[] = [];
  const diag: ScoresDiagEntry[] = [];

  const fbsNorm = new Set<string>();
  try {
    const rFbs = await fetch(`/api/teams?year=${season}&level=FBS`, { cache: 'no-store' });
    if (rFbs.ok) {
      const data = (await rFbs.json()) as {
        items: Array<{ school: string; mascot?: string | null }>;
      };
      for (const t of data.items) {
        for (const v of variants(t.school, aliasMap)) fbsNorm.add(v);
        if (t.mascot) fbsNorm.add(normWithAliases(`${t.school} ${t.mascot}`, aliasMap));
      }
    }
  } catch {
    // best-effort
  }

  const fbsFilterActive = fbsNorm.size > 0;
  const isFBSName = (name: string) => {
    if (!fbsFilterActive) return true;
    const vs = variants(name, aliasMap);
    return vs.some((v) => fbsNorm.has(v));
  };

  const weeksSet = new Set<number>(games.map((g) => g.week));
  const pairKey = (a: string, b: string) => {
    const x = normWithAliases(a, aliasMap);
    const y = normWithAliases(b, aliasMap);
    return [x, y].sort().join('__');
  };

  const globalIndex = new Map<string, Array<{ week: number; game: GameLike }>>();
  for (const g of games) {
    const involvesFbs = fbsFilterActive
      ? isFBSName(g.canHome) || isFBSName(g.canAway) || isFBSName(g.csvHome) || isFBSName(g.csvAway)
      : true;

    if (!involvesFbs) continue;

    const keys = new Set<string>();
    keys.add(pairKey(g.canHome, g.canAway));
    keys.add(pairKey(g.csvHome, g.csvAway));

    for (const k of keys) {
      const arr = globalIndex.get(k) ?? [];
      arr.push({ week: g.week, game: g });
      globalIndex.set(k, arr);
    }
  }

  const nextScores: Record<string, ScorePack> = {};
  let weekMismatchCount = 0;
  let hardMissCount = 0;
  const maxIssuesPerKind = 10;

  for (const w of weeksSet) {
    const r = await fetch(`/api/scores?week=${w}`, { cache: 'no-store' });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      issues.push(`Scores week ${w}: ${r.status} ${t}`);
      continue;
    }

    const raw = (await r.json()) as Array<WireFlat | WireObj>;

    for (const row of raw) {
      const { homeName, awayName, homeScore, awayScore, status, time } = extractRow(row);

      const rowInvolvesFbs = fbsFilterActive ? isFBSName(homeName) || isFBSName(awayName) : true;
      if (fbsFilterActive && !rowInvolvesFbs) {
        const kFcs = pairKey(homeName, awayName);
        const maybe = globalIndex.get(kFcs);
        if (!maybe || maybe.length === 0) continue;
      }

      const k = pairKey(homeName, awayName);
      const matchesAllWeeks = globalIndex.get(k) ?? [];
      if (matchesAllWeeks.length === 0) {
        if (rowInvolvesFbs && hardMissCount < maxIssuesPerKind) {
          issues.push(`Scores miss (week ${w}): "${homeName}" vs "${awayName}"`);
          diag.push({
            kind: 'scores_miss',
            week: w,
            providerHome: homeName,
            providerAway: awayName,
          });
        }
        if (rowInvolvesFbs) hardMissCount++;
        continue;
      }

      const sameWeek = matchesAllWeeks.find((m) => m.week === w);
      if (sameWeek) {
        const g = sameWeek.game;
        nextScores[g.key] = {
          status,
          time,
          home: { team: homeName, score: homeScore },
          away: { team: awayName, score: awayScore },
        };
        continue;
      }

      const otherWeeks = Array.from(new Set(matchesAllWeeks.map((m) => m.week))).sort(
        (a, b) => a - b
      );
      const isFinal = (status || '').toLowerCase().includes('final');
      const isPrevWeekCarryover = otherWeeks.includes(w - 1);
      if (isFinal && isPrevWeekCarryover) {
        continue;
      }

      const alreadyCaptured = matchesAllWeeks.some(({ game }) => Boolean(nextScores[game.key]));
      if (alreadyCaptured) {
        continue;
      }

      if (rowInvolvesFbs && weekMismatchCount < maxIssuesPerKind) {
        const candidates = matchesAllWeeks.map(({ week: wk, game }) => ({
          csvHome: game.csvHome,
          csvAway: game.csvAway,
          week: wk,
        }));
        const scheduledPairs = Array.from(
          new Map(
            matchesAllWeeks.map(({ week: wk, game }) => [
              `${wk}-${game.csvHome}-${game.csvAway}`,
              `wk ${wk}: "${game.csvAway}" vs "${game.csvHome}"`,
            ])
          ).values()
        ).join('; ');

        issues.push(
          `Scores week ${w}: provider reported "${homeName}" vs "${awayName}". Closest scheduled matchup(s): ${scheduledPairs}. Ignoring due to week mismatch.`
        );
        diag.push({
          kind: 'week_mismatch',
          week: w,
          providerHome: homeName,
          providerAway: awayName,
          candidates,
        });
      }
      if (rowInvolvesFbs) weekMismatchCount++;
    }
  }

  return { scoresByKey: nextScores, issues, diag };
}
