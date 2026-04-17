#!/usr/bin/env node
/* eslint-disable */
// Self-contained audit tool. No deps beyond Node built-ins.
// Usage: node scripts/audit-archive-integrity.mjs <path-to-json>
// Input: the raw JSON body of GET /api/debug/archive-integrity

import { readFileSync } from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/audit-archive-integrity.mjs <path-to-json>');
  process.exit(1);
}

const data = JSON.parse(readFileSync(inputPath, 'utf8'));

// -- teamRecords aggregation -------------------------------------------------
/** @type {Record<string, { name: string, wins: number, losses: number, ties: number, pointsFor: number, pointsAgainst: number, games: number }>} */
const teamRecords = {};

for (const [owner, games] of Object.entries(data.gameLogsByOwner)) {
  for (const g of games) {
    const id = g.ownerTeamId;
    if (!teamRecords[id]) {
      teamRecords[id] = {
        name: g.ownerTeamName,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        games: 0,
      };
    }
    const rec = teamRecords[id];
    rec.games += 1;
    if (g.result === 'W') rec.wins += 1;
    else if (g.result === 'L') rec.losses += 1;
    else rec.ties += 1;
    rec.pointsFor += g.ownerScore;
    rec.pointsAgainst += g.opponentScore;
  }
}

// -- ownerTotals rollup ------------------------------------------------------
/** @type {Record<string, { wins: number, losses: number, ties: number, pointsFor: number, pointsAgainst: number, games: number, diff: number }>} */
const ownerTotals = {};

for (const [owner, roster] of Object.entries(data.roster)) {
  const agg = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, games: 0, diff: 0 };
  for (const t of roster) {
    const rec = teamRecords[t.canonicalTeamId];
    if (!rec) continue;
    agg.wins += rec.wins;
    agg.losses += rec.losses;
    agg.ties += rec.ties;
    agg.pointsFor += rec.pointsFor;
    agg.pointsAgainst += rec.pointsAgainst;
    agg.games += rec.games;
  }
  agg.diff = agg.pointsFor - agg.pointsAgainst;
  ownerTotals[owner] = agg;
}

// -- intra-roster game counts ------------------------------------------------
/** @type {Record<string, number>} */
const intraRosterCounts = {};

for (const [owner, games] of Object.entries(data.gameLogsByOwner)) {
  const rosterIds = new Set((data.roster[owner] ?? []).map((t) => t.canonicalTeamId));
  // Count games where BOTH teams are in this owner's roster.
  // Such games appear twice in this owner's log (once per side).
  // Divide the dup count by 2 to get distinct games.
  let dupHalves = 0;
  for (const g of games) {
    if (rosterIds.has(g.ownerTeamId) && rosterIds.has(g.opponentTeamId)) {
      dupHalves += 1;
    }
  }
  intraRosterCounts[owner] = dupHalves / 2;
}

// -- formatting helpers ------------------------------------------------------
function padRight(s, w) {
  const str = String(s);
  return str.length >= w ? str : str + ' '.repeat(w - str.length);
}
function padLeft(s, w) {
  const str = String(s);
  return str.length >= w ? str : ' '.repeat(w - str.length) + str;
}
function fmtDiff(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

// -- Section 1: Summary ------------------------------------------------------
console.log('='.repeat(80));
console.log('SECTION 1: SUMMARY');
console.log('='.repeat(80));
console.log(JSON.stringify(data.summary, null, 2));

let leagueWins = 0;
let leagueLosses = 0;
let leagueTies = 0;
for (const t of Object.values(teamRecords)) {
  leagueWins += t.wins;
  leagueLosses += t.losses;
  leagueTies += t.ties;
}
console.log('');
console.log(`Computed league totals from per-team records:`);
console.log(`  sum(wins)   = ${leagueWins}`);
console.log(`  sum(losses) = ${leagueLosses}`);
console.log(`  sum(ties)   = ${leagueTies}`);
console.log(
  `  wins == losses (expected for a closed game universe)? ${leagueWins === leagueLosses ? 'YES' : 'NO'}`
);

// -- Section 2: Per-Team Record Table ---------------------------------------
console.log('');
console.log('='.repeat(80));
console.log('SECTION 2: PER-TEAM RECORD TABLE (all 130 rostered teams)');
console.log('='.repeat(80));

const teams = Object.entries(teamRecords)
  .map(([id, rec]) => ({ id, ...rec }))
  .sort((a, b) => a.name.localeCompare(b.name));

const COL_TEAM = 22;
const COL_WL = 8;
const COL_PTS = 5;
const COL_DIFF = 6;
console.log(
  padRight('team', COL_TEAM) +
    padRight('W-L', COL_WL) +
    padLeft('PF', COL_PTS) +
    '  ' +
    padLeft('PA', COL_PTS) +
    '  ' +
    padLeft('diff', COL_DIFF) +
    '  games'
);
console.log('-'.repeat(COL_TEAM + COL_WL + COL_PTS * 2 + COL_DIFF + 6 + 7));
for (const t of teams) {
  const wl = `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}`;
  const diff = t.pointsFor - t.pointsAgainst;
  console.log(
    padRight(t.name, COL_TEAM) +
      padRight(wl, COL_WL) +
      padLeft(t.pointsFor, COL_PTS) +
      '  ' +
      padLeft(t.pointsAgainst, COL_PTS) +
      '  ' +
      padLeft(fmtDiff(diff), COL_DIFF) +
      '  ' +
      padLeft(t.games, 5)
  );
}

// -- Section 3: Owner Rollup Table ------------------------------------------
console.log('');
console.log('='.repeat(80));
console.log('SECTION 3: OWNER ROLLUP (sum of team records from gameLogsByOwner)');
console.log('='.repeat(80));

const owners = Object.entries(ownerTotals)
  .map(([name, rec]) => ({ name, ...rec }))
  .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

const COL_OWNER = 14;
const COL_OWL = 10;
const COL_OPTS = 6;
const COL_ODIFF = 7;
console.log(
  padRight('owner', COL_OWNER) +
    padRight('W-L', COL_OWL) +
    padLeft('PF', COL_OPTS) +
    '  ' +
    padLeft('PA', COL_OPTS) +
    '  ' +
    padLeft('diff', COL_ODIFF) +
    '  games'
);
console.log('-'.repeat(COL_OWNER + COL_OWL + COL_OPTS * 2 + COL_ODIFF + 6 + 7));
for (const o of owners) {
  const wl = `${o.wins}-${o.losses}${o.ties > 0 ? `-${o.ties}` : ''}`;
  console.log(
    padRight(o.name, COL_OWNER) +
      padRight(wl, COL_OWL) +
      padLeft(o.pointsFor, COL_OPTS) +
      '  ' +
      padLeft(o.pointsAgainst, COL_OPTS) +
      '  ' +
      padLeft(fmtDiff(o.diff), COL_ODIFF) +
      '  ' +
      padLeft(o.games, 5)
  );
}

// -- Section 4: Intra-Roster Game Count --------------------------------------
console.log('');
console.log('='.repeat(80));
console.log('SECTION 4: INTRA-ROSTER GAME COUNT');
console.log('='.repeat(80));
console.log(padRight('owner', COL_OWNER) + padLeft('intraRosterGames', 20));
console.log('-'.repeat(COL_OWNER + 20));
for (const [owner, count] of Object.entries(intraRosterCounts).sort(([a], [b]) =>
  a.localeCompare(b)
)) {
  console.log(padRight(owner, COL_OWNER) + padLeft(count, 20));
}

// -- Validation warnings -----------------------------------------------------
console.log('');
console.log('='.repeat(80));
console.log('VALIDATION WARNINGS');
console.log('='.repeat(80));
let warnings = 0;
for (const t of teams) {
  if (t.games < 12 || t.games > 15) {
    console.log(`WARN: team ${t.name} has ${t.games} games (expected 12–15)`);
    warnings += 1;
  }
  if (t.ties > 0) {
    console.log(`WARN: team ${t.name} has ${t.ties} tie(s)`);
    warnings += 1;
  }
}
for (const o of owners) {
  const roster = data.roster[o.name] ?? [];
  let sumTeamGames = 0;
  for (const t of roster) {
    const rec = teamRecords[t.canonicalTeamId];
    if (rec) sumTeamGames += rec.games;
  }
  const ownerTotalGames = o.wins + o.losses + o.ties;
  if (ownerTotalGames !== sumTeamGames) {
    console.log(
      `WARN: owner ${o.name} total games (${ownerTotalGames}) != sum of rostered teams' games (${sumTeamGames})`
    );
    warnings += 1;
  }
}
if (warnings === 0) {
  console.log('No warnings.');
}
