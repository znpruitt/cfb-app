import { clamp, parseCSV } from './csv';

export type ScheduleDraftGame = {
  week: number;
  csvAway: string;
  csvHome: string;
  neutral: boolean;
  awayConf: string;
  homeConf: string;
};

export type ParsedScheduleCsv = {
  draftGames: ScheduleDraftGame[];
  byeMap: Record<number, string[]>;
  conferences: string[];
};

function neutralKey(week: number, a: string, b: string): string {
  const pair = [a, b].sort((x, y) => x.localeCompare(y));
  return `${week}-${pair[0]}-${pair[1]}-N`;
}

export function parseScheduleCsv(
  text: string,
  options?: { onConflict?: (message: string) => void }
): ParsedScheduleCsv {
  const rows = parseCSV(text);
  if (!rows.length) {
    return { draftGames: [], byeMap: {}, conferences: ['ALL'] };
  }

  const onConflict = options?.onConflict;

  const header = rows[0] ?? [];
  const weekCols: Array<{ index: number; week: number }> = [];
  const weekFromHeader = (name: string): number | null => {
    const m = name.match(/week\s*(\d+)/i);
    return m ? Number.parseInt(m[1]!, 10) : null;
  };
  for (let idx = 2; idx < header.length && idx <= 18; idx++) {
    const wk = weekFromHeader(header[idx] || '');
    const w = Number.isFinite(wk) && wk !== null ? wk : idx - 2;
    weekCols.push({ index: idx, week: w });
  }

  const teamConf = new Map<string, string>();
  const confSet = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.length < 2) continue;
    const conference = clamp(row[0]);
    const team = clamp(row[1]);
    if (!team) continue;
    teamConf.set(team, conference);
    if (conference) confSet.add(conference);
  }

  type Site = 'HOME' | 'AWAY' | 'NEUTRAL';
  type SiteObserved = { type: Site; homeCSV?: string; awayCSV?: string };
  const conflictMap = new Map<string, SiteObserved>();
  const pairKey = (w: number, a: string, b: string): string => {
    const sorted = [a, b].sort((x, y) => x.localeCompare(y));
    return `${w}__${sorted[0]}__${sorted[1]}`;
  };

  const draftGames: ScheduleDraftGame[] = [];
  const seenMerge = new Map<string, { awayConf: string; homeConf: string }>();
  const byeMap: Record<number, string[]> = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.length < 2) continue;
    const team = clamp(row[1]);
    if (!team) continue;

    for (const col of weekCols) {
      const cell = clamp(row[col.index] ?? '');
      if (!cell) continue;
      const w = col.week;

      if (/^BYE$/i.test(cell)) {
        (byeMap[w] ||= []).push(team);
        continue;
      }

      let claim: SiteObserved;
      let csvHome = '';
      let csvAway = '';
      let neutral = false;

      if (/^@/i.test(cell)) {
        const opp = cell.replace(/^@\s*/i, '');
        csvHome = opp;
        csvAway = team;
        neutral = false;
        claim = { type: 'AWAY', homeCSV: opp, awayCSV: team };
      } else if (/^vs\s+/i.test(cell)) {
        const opp = cell.replace(/^vs\s+/i, '');
        csvHome = opp;
        csvAway = team;
        neutral = true;
        claim = { type: 'NEUTRAL', homeCSV: opp, awayCSV: team };
      } else {
        const opp = cell;
        csvHome = team;
        csvAway = opp;
        neutral = false;
        claim = { type: 'HOME', homeCSV: team, awayCSV: opp };
      }

      const pk = pairKey(w, csvHome, csvAway);
      const prev = conflictMap.get(pk);
      if (!prev) {
        conflictMap.set(pk, claim);
      } else {
        if (claim.type === 'NEUTRAL' && prev.type !== 'NEUTRAL') {
          onConflict?.(`Conflict: Week ${w} ${csvAway} vs ${csvHome} — neutral for one row only.`);
        } else if (prev.type === 'NEUTRAL' && claim.type !== 'NEUTRAL') {
          onConflict?.(`Conflict: Week ${w} ${csvAway} vs ${csvHome} — neutral for one row only.`);
        } else if (
          claim.type === 'HOME' &&
          prev.type === 'HOME' &&
          prev.homeCSV &&
          claim.homeCSV &&
          prev.homeCSV !== claim.homeCSV
        ) {
          onConflict?.(
            `Conflict: Week ${w} ${csvAway} vs ${csvHome} — both rows claim HOME (different teams).`
          );
        } else if (
          claim.type === 'AWAY' &&
          prev.type === 'AWAY' &&
          prev.awayCSV &&
          claim.awayCSV &&
          prev.awayCSV !== claim.awayCSV
        ) {
          onConflict?.(
            `Conflict: Week ${w} ${csvAway} vs ${csvHome} — both rows claim AWAY (different teams).`
          );
        }
      }

      const curHomeConf = teamConf.get(csvHome) ?? '';
      const curAwayConf = teamConf.get(csvAway) ?? '';
      const key = neutral ? neutralKey(w, csvHome, csvAway) : `${w}-${csvHome}-${csvAway}-H`;

      const stored = seenMerge.get(key);
      if (stored) {
        const mergedHome = stored.homeConf || curHomeConf;
        const mergedAway = stored.awayConf || curAwayConf;
        seenMerge.set(key, { homeConf: mergedHome, awayConf: mergedAway });
      } else {
        seenMerge.set(key, { homeConf: curHomeConf, awayConf: curAwayConf });
      }

      const exists = draftGames.find((g) =>
        neutral
          ? neutralKey(g.week, g.csvHome, g.csvAway) === key
          : `${g.week}-${g.csvHome}-${g.csvAway}-H` === key
      );
      if (!exists) {
        draftGames.push({
          week: w,
          csvAway,
          csvHome,
          neutral,
          awayConf: curAwayConf,
          homeConf: curHomeConf,
        });
      }
    }
  }

  for (let i = 0; i < draftGames.length; i++) {
    const g = draftGames[i]!;
    const k = g.neutral
      ? neutralKey(g.week, g.csvHome, g.csvAway)
      : `${g.week}-${g.csvHome}-${g.csvAway}-H`;
    const merged = seenMerge.get(k);
    if (merged) {
      draftGames[i] = {
        ...g,
        awayConf: g.awayConf || merged.awayConf,
        homeConf: g.homeConf || merged.homeConf,
      };
    }
  }

  return {
    draftGames,
    byeMap,
    conferences: ['ALL', ...Array.from(confSet).sort((a, b) => a.localeCompare(b))],
  };
}
