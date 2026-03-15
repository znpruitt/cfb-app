import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyScheduleRow } from '../postseason-classify';

test('classifyScheduleRow prefers normalized playoff metadata for CFP quarterfinal bowls', () => {
  const classified = classifyScheduleRow(
    {
      id: 'g1',
      week: 17,
      startDate: '2025-12-31T01:00:00Z',
      neutralSite: true,
      neutralSiteDisplay: 'vs',
      conferenceGame: false,
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      seasonType: 'postseason',
      gamePhase: 'postseason',
      postseasonSubtype: 'playoff',
      playoffRound: 'quarterfinal',
      bowlName: 'Rose Bowl',
      eventKey: 'cfp-quarterfinal-rose-bowl',
      label: 'CFP Quarterfinal at Rose Bowl',
    },
    2025
  );

  assert.equal(classified.kind, 'postseason_placeholder');
  if (classified.kind === 'postseason_placeholder') {
    assert.equal(classified.stage, 'playoff');
    assert.equal(classified.playoffRound, 'quarterfinal');
    assert.equal(classified.eventId, '2025-cfp-quarterfinal-rose-bowl');
  }
});

test('classifyScheduleRow keeps conference championship metadata in regular-week context', () => {
  const classified = classifyScheduleRow(
    {
      id: 'g2',
      week: 15,
      startDate: '2025-12-06T20:00:00Z',
      neutralSite: true,
      conferenceGame: true,
      homeTeam: 'Texas',
      awayTeam: 'Georgia',
      homeConference: 'SEC',
      awayConference: 'SEC',
      status: 'scheduled',
      seasonType: 'regular',
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      conferenceChampionshipConference: 'SEC',
      eventKey: 'sec-championship',
      label: 'SEC Championship',
    },
    2025
  );

  assert.deepEqual(classified, { kind: 'regular_game' });
});
