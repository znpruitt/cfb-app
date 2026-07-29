import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNationalChampionshipRollover } from '../nationalChampionshipRollover.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../../server/teamDatabaseStore.ts';

const YEAR = 2031;
const CHAMP_DATE = '2032-01-13T00:00:00.000Z';
const CHAMP_MS = Date.parse(CHAMP_DATE);
const AFTER_7_DAYS = CHAMP_MS + 8 * 24 * 60 * 60 * 1000;

type SeedOptions = {
  /** 'structured' → cfbd-structured CFP national championship; 'text' → text-inferred; 'bowl' → non-championship postseason game. */
  kind: 'structured' | 'text' | 'bowl';
  /** 'final' → complete final; 'live' → in progress; 'none' → no score cached. */
  score: 'final' | 'live' | 'none';
  champDate?: string;
};

async function seed(options: SeedOptions): Promise<void> {
  const champDate = options.champDate ?? CHAMP_DATE;
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2031-01-01T00:00:00.000Z',
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });

  const base = {
    id: '401752',
    week: 15,
    startDate: champDate,
    neutralSite: true,
    conferenceGame: false,
    homeTeam: 'Alpha U',
    awayTeam: 'Beta U',
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    status: 'final',
    seasonType: 'postseason',
    gamePhase: 'postseason',
    postseasonSubtype: 'playoff',
  };

  const item =
    options.kind === 'structured'
      ? {
          ...base,
          playoffRound: 'national_championship',
          playoffCompetition: 'College Football Playoff',
          playoffRoundSource: 'cfbd-structured',
        }
      : options.kind === 'text'
        ? {
            ...base,
            playoffRound: 'national_championship',
            playoffRoundSource: 'text-inferred',
          }
        : {
            // A postseason BOWL game — the "latest postseason game" the removed
            // fallback would have rolled off, but which is NOT a championship.
            ...base,
            postseasonSubtype: 'bowl',
            bowlName: 'Sugar Bowl',
          };

  await setAppState('schedule', `${YEAR}-all-all`, { items: [item] });

  if (options.score !== 'none') {
    await setAppState('scores', `${YEAR}-all-postseason`, {
      at: Date.parse('2032-01-14T00:00:00.000Z'),
      source: 'cfbd',
      cfbdFallbackReason: 'none',
      items: [
        {
          id: '401752',
          seasonType: 'postseason',
          startDate: champDate,
          week: 15,
          status: options.score === 'final' ? 'final' : 'in progress',
          home: { team: 'Alpha U', score: options.score === 'final' ? 34 : 14 },
          away: { team: 'Beta U', score: options.score === 'final' ? 21 : 10 },
          time: null,
        },
      ],
    });
  }
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
});

test.after(() => {
  __setAppStateReadFailureForTests(null);
});

// 24 — structured championship + confirmed final + seven days permits rollover.
test('structured championship plus confirmed final plus seven days permits rollover', async () => {
  await seed({ kind: 'structured', score: 'final' });
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  assert.equal(decision.kind, 'eligible');
  if (decision.kind === 'eligible') {
    assert.equal(decision.championshipDate, CHAMP_DATE);
  }
});

// 24b — structured + final but WITHIN the seven-day window does not roll.
test('a structured, final championship still waits out the seven-day window', async () => {
  await seed({ kind: 'structured', score: 'final' });
  const decision = await resolveNationalChampionshipRollover(YEAR, CHAMP_MS + 1000);
  assert.equal(decision.kind, 'skip');
  if (decision.kind === 'skip') assert.equal(decision.reason, 'waiting-period');
});

// 25 — structured championship without a final does not roll.
test('a structured championship without a confirmed final does not roll', async () => {
  await seed({ kind: 'structured', score: 'live' });
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  assert.equal(decision.kind, 'skip');
  if (decision.kind === 'skip') assert.equal(decision.reason, 'not-final');
});

// 25b — a structured championship with no score at all does not roll.
test('a structured championship with no cached score does not roll', async () => {
  await seed({ kind: 'structured', score: 'none' });
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  assert.equal(decision.kind, 'skip');
  if (decision.kind === 'skip') assert.equal(decision.reason, 'score-missing');
});

// 26 — a text-inferred championship does not roll.
test('a text-inferred championship does not roll', async () => {
  await seed({ kind: 'text', score: 'final' });
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  assert.equal(decision.kind, 'skip');
  if (decision.kind === 'skip') assert.equal(decision.reason, 'no-structured-championship');
});

// 27 — the latest-postseason fallback does not roll (a non-championship bowl game).
test('a latest-postseason bowl game (no structured championship) does not roll', async () => {
  await seed({ kind: 'bowl', score: 'final' });
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  assert.equal(decision.kind, 'skip');
  if (decision.kind === 'skip') assert.equal(decision.reason, 'no-structured-championship');
});

// 28 — an attachment-context read failure does not roll and surfaces as a failure.
test('a score-attachment read failure surfaces as read-failed, not an ordinary absence', async () => {
  await seed({ kind: 'structured', score: 'final' });
  // Fail the alias read used to build the score-attachment resolver; the schedule
  // read (a different scope) still succeeds, so the championship IS resolved — then
  // the attachment context read fails.
  __setAppStateReadFailureForTests(new Error('alias store down'), 'aliases:global');
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  __setAppStateReadFailureForTests(null);
  assert.equal(decision.kind, 'read-failed');
});

// 28b — a schedule-read failure surfaces as read-failed, not an empty absence.
test('a schedule-read failure surfaces as read-failed, not an empty absence', async () => {
  await seed({ kind: 'structured', score: 'final' });
  __setAppStateReadFailureForTests(new Error('schedule store down'), 'schedule');
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  __setAppStateReadFailureForTests(null);
  assert.equal(decision.kind, 'read-failed');
});

// absence — a year with no schedule cache is an ordinary skip, not a failure.
test('a year with no cached schedule is an ordinary no-season-schedule skip', async () => {
  const decision = await resolveNationalChampionshipRollover(YEAR, AFTER_7_DAYS);
  assert.equal(decision.kind, 'skip');
  if (decision.kind === 'skip') assert.equal(decision.reason, 'no-season-schedule');
});
