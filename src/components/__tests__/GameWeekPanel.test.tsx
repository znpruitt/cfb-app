import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppGame } from '../../lib/schedule';
import type { VenueInfo } from '../../lib/schedule/cfbdSchedule';
import { EYEBROW_TAG_CLASSES } from '../../lib/gameUi';

/**
 * Counting the MARKER alone would keep these assertions green if the shared bronze
 * treatment were changed to anything at all, including blue. Count only spans that
 * carry the marker AND the treatment, so the count itself carries the styling signal.
 */
function eyebrowClasses(html: string): string[] {
  return Array.from(
    html.matchAll(/<span(?=[^>]*data-eyebrow-tag)[^>]*class="([^"]*)"[^>]*>/g),
    (match) => match[1] ?? ''
  );
}

function bronzeEyebrows(html: string): string[] {
  return eyebrowClasses(html).filter((classAttr) => classAttr.includes(EYEBROW_TAG_CLASSES));
}

/** No eyebrow renders without the shared treatment — the invariant, not a count. */
function assertEveryEyebrowIsBronze(html: string): void {
  const all = eyebrowClasses(html);
  assert.ok(all.length > 0, 'expected at least one eyebrow to render');
  assert.deepEqual(
    all.filter((classAttr) => !classAttr.includes(EYEBROW_TAG_CLASSES)),
    [],
    'every rendered eyebrow must carry the shared bronze treatment'
  );
}
import GameWeekPanel from '../GameWeekPanel';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? overrides.key ?? 'g',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? null,
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'g',
    label: overrides.label ?? null,
    notes: overrides.notes ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: (overrides.venue ?? null) as VenueInfo | string | null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.canAway ?? overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'IND',
    homeConf: overrides.homeConf ?? 'IND',
    awayClassification: overrides.awayClassification,
    homeClassification: overrides.homeClassification,
    sources: overrides.sources,
    startTimeTBD: overrides.startTimeTBD,
    media: overrides.media,
  };
}

test('each date group stays sorted by kickoff across mixed game states', () => {
  const kickoffByKey = new Map([
    ['late', Date.parse('2025-08-30T20:00:00.000Z')],
    ['early-final', Date.parse('2025-08-30T15:00:00.000Z')],
    ['middle-live', Date.parse('2025-08-30T17:00:00.000Z')],
  ]);
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'late', csvAway: 'B', csvHome: 'A', date: '2025-08-30T20:00:00.000Z' }),
        game({ key: 'tbd', csvAway: 'D', csvHome: 'C', date: null }),
        game({
          key: 'early-final',
          csvAway: 'F',
          csvHome: 'E',
          date: '2025-08-30T15:00:00.000Z',
        }),
        game({
          key: 'middle-live',
          csvAway: 'J',
          csvHome: 'I',
          date: '2025-08-30T17:00:00.000Z',
        }),
        game({ key: 'next-day', csvAway: 'H', csvHome: 'G', date: '2025-08-31T15:00:00.000Z' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'early-final': {
          away: { team: 'F', score: 24 },
          home: { team: 'E', score: 17 },
          status: 'Final',
          time: null,
        },
        'middle-live': {
          away: { team: 'J', score: 14 },
          home: { team: 'I', score: 10 },
          status: '3rd Quarter',
          time: '02:14',
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="America/Los_Angeles"
    />
  );

  const saturdayIndex = html.indexOf('Saturday, Aug 30');
  const sundayIndex = html.indexOf('Sunday, Aug 31');
  const tbdHeaderIndex = html.indexOf('Date TBD');
  const firstGroupHtml = html.slice(saturdayIndex, sundayIndex);
  const orderedKeys = [...firstGroupHtml.matchAll(/data-game-card-id="([^"]+)"/g)].map(
    ([, key]) => key
  );
  const orderedKickoffs = orderedKeys.map(
    (key) => kickoffByKey.get(key) ?? Number.POSITIVE_INFINITY
  );

  assert.ok(saturdayIndex >= 0);
  assert.ok(sundayIndex > saturdayIndex);
  assert.ok(tbdHeaderIndex > sundayIndex);
  assert.deepEqual(orderedKeys, ['early-final', 'middle-live', 'late']);
  orderedKickoffs.forEach((kickoff, index) => {
    if (index === 0) return;
    assert.ok(kickoff >= orderedKickoffs[index - 1]);
  });
});

test('every date heading carries the full-width rule that explains an unmatched grid cell', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'thursday', date: '2025-09-04T23:00:00.000Z' }),
        game({ key: 'friday', date: '2025-09-05T23:00:00.000Z' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="America/Chicago"
    />
  );
  const dateHeadingClasses = Array.from(
    html.matchAll(/<div class="([^"]*)" data-date-header=/g),
    (match) => match[1] ?? ''
  );

  assert.equal(dateHeadingClasses.length, 2);
  for (const classes of dateHeadingClasses) {
    assert.match(classes, /\bborder-b-2\b/);
    assert.match(classes, /\bdark:border-zinc-800\/80\b/);
    assert.match(classes, /\bpb-2\b/);
  }
});

test('late-night kickoff header matches kickoff text timezone', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'late-night',
          csvAway: 'Visitor',
          csvHome: 'Home',
          date: '2025-09-07T04:30:00.000Z',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="America/Los_Angeles"
    />
  );

  assert.ok(html.includes('Saturday, Sep 6'));
  assert.ok(html.includes('9:30 PM'));
  assert.doesNotMatch(html, /Kickoff:/);
});

test('selected week panel stays aligned with week metadata date basis for the same timezone', () => {
  const games = [
    game({
      key: 'late-night',
      csvAway: 'Visitor',
      csvHome: 'Home',
      date: '2025-09-07T04:30:00.000Z',
    }),
    game({ key: 'daytime', csvAway: 'Guest', csvHome: 'Host', date: '2025-09-07T19:00:00.000Z' }),
  ];
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={games}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="America/Los_Angeles"
    />
  );

  assert.ok(html.includes('Saturday, Sep 6'));
  assert.ok(html.includes('Sunday, Sep 7'));
  assert.ok(html.includes('9:30 PM'));
  assert.ok(html.includes('12:00 PM'));
  assert.doesNotMatch(html, /Kickoff:/);
});

test('postseason placeholders with TBD kickoff render stable date fallback', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'placeholder-bowl',
          stage: 'bowl',
          postseasonRole: 'bowl',
          isPlaceholder: true,
          label: 'Placeholder Bowl',
          date: null,
          csvAway: 'Team TBD',
          csvHome: 'Team TBD',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="Pacific/Honolulu"
    />
  );

  assert.ok(html.includes('Date TBD'));
  assert.ok(html.includes('TBD'));
  assert.doesNotMatch(html, /Kickoff:/);
  assert.ok(html.includes('Placeholder Bowl'));
});

test('shared scoreboard preserves canonical schedule status when score data is missing', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'status-in-progress',
          csvAway: 'Texas',
          csvHome: 'Kansas State',
          status: 'in_progress',
        }),
        game({
          key: 'status-final',
          csvAway: 'TCU',
          csvHome: 'Baylor',
          status: 'final',
        }),
        game({
          key: 'status-matchup-set',
          csvAway: 'Team TBD',
          csvHome: 'Team TBD',
          stage: 'bowl',
          status: 'matchup_set',
          isPlaceholder: true,
          label: 'Fiesta Bowl',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-scoreboard-state="awaiting"/);
  assert.match(html, /data-scoreboard-state="final"/);
  assert.match(html, /data-scoreboard-state="scheduled"/);
  assert.doesNotMatch(html, /MATCHUP SET/);
});

test('scheduled Schedule cards omit the unrequested odds-footer band without losing row content', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'scheduled-no-footer',
          csvAway: 'Michigan',
          csvHome: 'Ohio State',
          date: '2026-09-12T23:30:00.000Z',
        }),
      ]}
      byes={[]}
      oddsByKey={{
        'scheduled-no-footer': {
          favorite: 'Ohio State',
          spread: -3.5,
          homeSpread: -3.5,
          awaySpread: 3.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 48.5,
          mlHome: -150,
          mlAway: 130,
          overPrice: -108,
          underPrice: -112,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2026-09-08T12:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-scoreboard-state="scheduled"/);
  assert.match(html, /data-scoreboard-team="away">Michigan/);
  assert.match(html, /data-scoreboard-team="home">Ohio State/);
  assert.match(html, /Ohio State -3\.5/);
  assert.doesNotMatch(html, /data-scoreboard-odds-footer/);
});

test('schedule-only rows map to shared scoreboard states', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'schedule-final-chip',
          csvAway: 'Texas',
          csvHome: 'Kansas State',
          status: 'final',
        }),
        game({
          key: 'schedule-live-chip',
          csvAway: 'TCU',
          csvHome: 'Baylor',
          status: 'in_progress',
        }),
        game({
          key: 'schedule-scheduled-chip',
          csvAway: 'Iowa State',
          csvHome: 'Kansas',
          status: 'scheduled',
        }),
        game({
          key: 'schedule-matchup-set-chip',
          csvAway: 'Team TBD',
          csvHome: 'Team TBD',
          stage: 'bowl',
          status: 'matchup_set',
          isPlaceholder: true,
          label: 'Peach Bowl',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.equal((html.match(/data-scoreboard-state="final"/g) ?? []).length, 1);
  assert.equal((html.match(/data-scoreboard-state="awaiting"/g) ?? []).length, 1);
  assert.equal((html.match(/data-scoreboard-state="scheduled"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /MATCHUP SET/);
});

test('schedule omits the retired status legend and postseason pseudo-status', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'legend-state', csvAway: 'Texas', csvHome: 'Baylor', status: 'scheduled' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, />Scheduled<\/span>/);
  assert.doesNotMatch(html, />Final<\/span>/);
  assert.doesNotMatch(html, />In Progress<\/span>/);
  assert.doesNotMatch(html, /Postseason \(TBD\)/);
});

test('always-visible scoreboard renders one final status label', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'final-expanded-status',
          csvAway: 'Texas',
          csvHome: 'Baylor',
          status: 'final',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'final-expanded-status': {
          status: 'Final',
          time: null,
          away: { team: 'Texas', score: 31 },
          home: { team: 'Baylor', score: 24 },
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.equal((html.match(/>Final<\/span>/g) ?? []).length, 1);
  assert.equal((html.match(/data-scoreboard-state="final"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-summary-state/);
});

test('live rows reuse shared game-state detection for full-word labels', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'live-quarter-1', csvAway: 'Texas', csvHome: 'Baylor' }),
        game({ key: 'live-quarter-3', csvAway: 'TCU', csvHome: 'Kansas State' }),
        game({ key: 'live-ot', csvAway: 'Iowa State', csvHome: 'Kansas' }),
        game({ key: 'live-half', csvAway: 'Oklahoma', csvHome: 'Oklahoma State' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'live-quarter-1': {
          away: { team: 'Texas', score: 7 },
          home: { team: 'Baylor', score: 3 },
          status: '1st Quarter',
          time: null,
        },
        'live-quarter-3': {
          away: { team: 'TCU', score: 20 },
          home: { team: 'Kansas State', score: 14 },
          status: '3rd Quarter',
          time: null,
        },
        'live-ot': {
          away: { team: 'Iowa State', score: 24 },
          home: { team: 'Kansas', score: 24 },
          status: 'In OT',
          time: null,
        },
        'live-half': {
          away: { team: 'Oklahoma', score: 17 },
          home: { team: 'Oklahoma State', score: 14 },
          status: 'Half',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.equal((html.match(/data-scoreboard-state="live"/g) ?? []).length, 4);
  assert.equal((html.match(/>Live<\/span>/g) ?? []).length, 4);
});

test('disrupted rows preserve their specific provider status', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'disrupted-postponed', csvAway: 'Texas', csvHome: 'Baylor' }),
        game({ key: 'disrupted-canceled', csvAway: 'TCU', csvHome: 'Kansas State' }),
        game({ key: 'disrupted-suspended', csvAway: 'Iowa State', csvHome: 'Kansas' }),
        game({ key: 'disrupted-delayed', csvAway: 'Oklahoma', csvHome: 'Oklahoma State' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'disrupted-postponed': {
          away: { team: 'Texas', score: null },
          home: { team: 'Baylor', score: null },
          status: 'Postponed',
          time: null,
        },
        'disrupted-canceled': {
          away: { team: 'TCU', score: null },
          home: { team: 'Kansas State', score: null },
          status: 'Canceled',
          time: null,
        },
        'disrupted-suspended': {
          away: { team: 'Iowa State', score: null },
          home: { team: 'Kansas', score: null },
          status: 'Suspended',
          time: null,
        },
        'disrupted-delayed': {
          away: { team: 'Oklahoma', score: null },
          home: { team: 'Oklahoma State', score: null },
          status: 'Delayed',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, />Postponed<\/span>/);
  assert.match(html, />Canceled<\/span>/);
  assert.match(html, />Suspended<\/span>/);
  assert.match(html, />Delayed<\/span>/);
  assert.equal((html.match(/data-scoreboard-state="scheduled"/g) ?? []).length, 4);
});

test('neutral-site matchup preserves neutral wording and placement', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'neutral',
          csvAway: 'Texas',
          csvHome: 'Ohio State',
          date: '2025-09-01T17:00:00.000Z',
          neutral: true,
          neutralDisplay: 'vs',
          stage: 'bowl',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /aria-label="Texas vs Ohio State"/);
  assert.match(html, /data-scoreboard-neutral-site[^>]*>Neutral site<\/span>/);
  assert.doesNotMatch(html, /aria-label="Texas @ Ohio State"/);
});

test('rankings render when lookup keys use canonical team ids instead of canonical display names', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'ranked',
          csvAway: 'Ole Miss',
          csvHome: 'Texas',
          canAway: 'Mississippi',
          canHome: 'Texas',
          participants: {
            away: {
              kind: 'team',
              teamId: 'mississippi',
              displayName: 'Mississippi',
              canonicalName: 'Mississippi',
              rawName: 'Ole Miss',
            },
            home: {
              kind: 'team',
              teamId: 'texas',
              displayName: 'Texas',
              canonicalName: 'Texas',
              rawName: 'Texas',
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={
        new Map([
          ['mississippi', { rank: 12, rankSource: 'ap' }],
          ['texas', { rank: 3, rankSource: 'cfp' }],
        ])
      }
    />
  );

  assert.match(html, />#12<\/span>[^<]*<span[^>]*>[^<]*<span data-scoreboard-team="away">Ole Miss/);
  assert.match(html, />#3<\/span>[^<]*<span[^>]*>[^<]*<span data-scoreboard-team="home">Texas/);
});

test('shared scoreboard renders team rows, rankings, scores, and final status', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'score-final',
          csvAway: 'Ole Miss',
          csvHome: 'Mississippi State',
          canAway: 'Mississippi',
          canHome: 'Mississippi State',
          participants: {
            away: {
              kind: 'team',
              teamId: 'mississippi',
              displayName: 'Mississippi',
              labels: {
                displayName: 'Mississippi',
                shortDisplayName: 'Ole Miss',
                scoreboardName: 'OLE MISS',
              },
              canonicalName: 'Mississippi',
              rawName: 'Ole Miss',
            },
            home: {
              kind: 'team',
              teamId: 'mississippi-state',
              displayName: 'Mississippi State',
              labels: {
                displayName: 'Mississippi State',
                shortDisplayName: 'Mississippi State',
                scoreboardName: 'MSST',
              },
              canonicalName: 'Mississippi State',
              rawName: 'Mississippi State',
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-final': {
          away: { team: 'Ole Miss', score: 38 },
          home: { team: 'Mississippi State', score: 19 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={new Map([['mississippi', { rank: 7, rankSource: 'ap' }]])}
      teamColorsById={new Map([['mississippi', '#C4506B']])}
    />
  );

  assert.match(html, /aria-label="Ole Miss @ Mississippi State"/);
  assert.match(html, />Final<\/span>/);
  assert.match(html, /data-scoreboard-side="away"/);
  assert.match(html, /data-scoreboard-side="home"/);
  assert.match(html, />#7<\/span>/);
  assert.match(html, /data-scoreboard-team="away">OLE MISS<\/span>/);
  assert.match(html, /data-scoreboard-team="home">MSST<\/span>/);
  assert.match(html, /data-scoreboard-value="away">38<\/span>/);
  assert.match(html, /data-scoreboard-value="home">19<\/span>/);
  assert.match(html, /data-scoreboard-side="away" data-scoreboard-leading="true"/);
  assert.match(html, /data-scoreboard-team-color="away"/);
  assert.doesNotMatch(html, /data-scoreboard-team-color="home"/);
});

test('expanded scoreboard uses provider casing for non-catalog teams and catalog scoreboard labels', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'provider-casing',
          csvAway: 'UAlbany',
          csvHome: 'Buffalo',
          canAway: 'ualbany',
          canHome: 'buffalo',
          participants: {
            away: {
              kind: 'team',
              teamId: 'ualbany',
              displayName: 'ualbany',
              canonicalName: 'ualbany',
              rawName: 'UAlbany',
            },
            home: {
              kind: 'team',
              teamId: 'buffalo',
              displayName: 'Buffalo',
              canonicalName: 'Buffalo',
              rawName: 'Buffalo',
              labels: {
                displayName: 'Buffalo',
                shortDisplayName: 'Buffalo',
                scoreboardName: 'BUF',
              },
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const awayRow = html.match(/data-scoreboard-side="away"[\s\S]*?data-scoreboard-side="home"/)?.[0];
  assert.ok(awayRow);
  assert.match(awayRow, />UAlbany<\//);
  assert.doesNotMatch(awayRow, />ualbany<\//);
  assert.match(html, /data-scoreboard-team="home">BUF<\//);
});

test('shared scoreboard presents live state and preserves pregame notices', () => {
  const liveHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-live', csvAway: 'Texas', csvHome: 'Oklahoma' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-live': {
          away: { team: 'Texas', score: 24 },
          home: { team: 'Oklahoma', score: 17 },
          status: 'Q3 8:14',
          time: null,
        },
      }}
      rosterByTeam={
        new Map([
          ['Away Team', 'Alice'],
          ['Home Team', 'Bob'],
        ])
      }
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const scheduledHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-pregame', csvAway: 'USC', csvHome: 'UCLA' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-pregame': {
          away: { team: 'USC', score: null },
          home: { team: 'UCLA', score: null },
          status: '7:30 PM ET',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(liveHtml, />Live<\/span>/);
  assert.match(liveHtml, />Q3 8:14<\/span>/);
  assert.match(scheduledHtml, /7:30 PM ET/);
  assert.match(liveHtml, /data-scoreboard-state="live"/);
  assert.match(scheduledHtml, /data-scoreboard-state="scheduled"/);
  assert.doesNotMatch(scheduledHtml, /data-scoreboard-value-kind="score"/);
});

test('shared scoreboard preserves disrupted terminal provider statuses instead of final', () => {
  const postponedHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-postponed', csvAway: 'Auburn', csvHome: 'LSU' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-postponed': {
          away: { team: 'Auburn', score: null },
          home: { team: 'LSU', score: null },
          status: 'Postponed',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const weatherHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-weather', csvAway: 'Florida', csvHome: 'Georgia' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-weather': {
          away: { team: 'Florida', score: null },
          home: { team: 'Georgia', score: null },
          status: 'Postponed - weather',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const canceledHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-canceled', csvAway: 'UCF', csvHome: 'Houston' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-canceled': {
          away: { team: 'UCF', score: null },
          home: { team: 'Houston', score: null },
          status: 'Canceled',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(postponedHtml, />Postponed<\/span>/);
  assert.match(weatherHtml, />Postponed - weather<\/span>/);
  assert.match(canceledHtml, />Canceled<\/span>/);
  assert.doesNotMatch(postponedHtml, />Final<\/span>/);
  assert.doesNotMatch(weatherHtml, />Final<\/span>/);
  assert.doesNotMatch(canceledHtml, />Final<\/span>/);
});

test('final rows preserve neutral-site context and carry no kickoff time', () => {
  const neutralGame = game({
    key: 'neutral-expanded',
    csvAway: 'Texas',
    csvHome: 'Ohio State',
    date: '2025-09-01T17:00:00.000Z',
    neutral: true,
    neutralDisplay: 'vs',
    stage: 'bowl',
  });
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[neutralGame]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'neutral-expanded': {
          away: { team: 'Texas', score: 27 },
          home: { team: 'Ohio State', score: 24 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /aria-label="Texas vs Ohio State"/);
  assert.doesNotMatch(html, /aria-label="Texas @ Ohio State"/);
  assert.equal((html.match(/Neutral site/g) ?? []).length, 1);
  assert.doesNotMatch(html, /5:00 PM/);
  assert.doesNotMatch(html, /data-scoreboard-header[^>]*>[\s\S]*Mon, Sep 1/);
});

test('moneyline-only odds use the same scoreboard names as the participant rows', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'moneyline-only',
          csvAway: 'South Carolina',
          csvHome: 'Clemson',
          participants: {
            away: {
              kind: 'team',
              teamId: 'south-carolina',
              displayName: 'South Carolina',
              canonicalName: 'South Carolina',
              rawName: 'South Carolina',
              labels: {
                displayName: 'South Carolina',
                shortDisplayName: 'South Carolina',
                scoreboardName: 'SC',
              },
            },
            home: {
              kind: 'team',
              teamId: 'clemson',
              displayName: 'Clemson',
              canonicalName: 'Clemson',
              rawName: 'Clemson',
              labels: {
                displayName: 'Clemson',
                shortDisplayName: 'Clemson',
                scoreboardName: 'CLEM',
              },
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{
        'moneyline-only': {
          favorite: null,
          spread: null,
          homeSpread: null,
          awaySpread: null,
          spreadPriceHome: null,
          spreadPriceAway: null,
          total: null,
          mlHome: -600,
          mlAway: 425,
          overPrice: null,
          underPrice: null,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2025-09-01T12:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-scoreboard-team="away">SC<\/span>/);
  assert.match(html, /data-scoreboard-team="home">CLEM<\/span>/);
  assert.match(html, /Moneyline: SC \+425 • CLEM -600/);
  assert.doesNotMatch(html, /Moneyline: South Carolina|Moneyline:[^<]*Clemson/);
  assert.doesNotMatch(html, /No odds/);
});

test('spread favorite uses the same scoreboard name as its participant row', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'named-spread',
          csvAway: 'Mississippi State',
          csvHome: 'Mississippi',
          participants: {
            away: {
              kind: 'team',
              teamId: 'mississippi-state',
              displayName: 'Mississippi State',
              canonicalName: 'Mississippi State',
              rawName: 'Mississippi State',
              labels: {
                displayName: 'Mississippi State',
                shortDisplayName: 'Mississippi State',
                scoreboardName: 'MSST',
              },
            },
            home: {
              kind: 'team',
              teamId: 'mississippi',
              displayName: 'Mississippi',
              canonicalName: 'Mississippi',
              rawName: 'Ole Miss',
              labels: {
                displayName: 'Mississippi',
                shortDisplayName: 'Ole Miss',
                scoreboardName: 'OLE MISS',
              },
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{
        'named-spread': {
          favorite: 'Mississippi State',
          spread: -3.5,
          homeSpread: 3.5,
          awaySpread: -3.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: null,
          mlHome: null,
          mlAway: null,
          overPrice: null,
          underPrice: null,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2025-09-01T12:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-scoreboard-team="away">MSST<\/span>/);
  assert.match(html, /Spread: MSST -3.5/);
  assert.doesNotMatch(html, /Spread: Mississippi State/);
});

test('team rows keep owners while conference remains a separate tier-2 line', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'summary-minimal',
          csvAway: 'Texas',
          csvHome: 'Oklahoma',
          date: '2025-10-11T19:30:00.000Z',
          awayConf: 'SEC',
          homeConf: 'Big 12',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'summary-minimal': {
          away: { team: 'Texas', score: 24 },
          home: { team: 'Oklahoma', score: 17 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={
        new Map([
          ['Texas', 'Casey'],
          ['Oklahoma', 'Jordan'],
        ])
      }
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-scoreboard-owner="away">Casey<\/span>/);
  assert.match(html, /data-scoreboard-owner="home">Jordan<\/span>/);
  assert.match(html, /data-scoreboard-state="final"/);
  assert.doesNotMatch(html, /Home owner:/);
  assert.doesNotMatch(html, /Away owner:/);
  assert.match(html, /data-schedule-tier2-conference[^>]*>SEC vs Big 12<\/div>/);
  assert.doesNotMatch(html, /data-schedule-tier2-odds[^>]*>[^<]*(SEC|Big 12)/);
});

test('team rows hide NoClaim while preserving the sibling owner', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'unowned-fbs-collapsed',
          csvAway: 'Massachusetts',
          csvHome: 'Rutgers',
        }),
        game({
          key: 'both-unowned-fbs-collapsed',
          csvAway: 'Connecticut',
          csvHome: 'Temple',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Massachusetts', 'NoClaim'],
          ['Rutgers', 'LHooper'],
          ['Connecticut', 'NoClaim'],
          ['Temple', 'NoClaim'],
        ])
      }
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /NoClaim/);
  assert.match(html, /data-scoreboard-owner="home">LHooper<\/span>/);
  assert.doesNotMatch(html, /data-scoreboard-owner="away"/);
});

test('schedule rows retire outer card edge accents', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'summary-team-accents',
          csvAway: 'Texas',
          csvHome: 'Oklahoma',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /data-card-team-accent-top=/);
  assert.doesNotMatch(html, /data-card-team-accent-bottom=/);
  assert.doesNotMatch(html, /data-card-team-accent-edge=/);
  assert.doesNotMatch(html, /flex h-1 overflow-hidden/);
  assert.doesNotMatch(html, /data-collapsed-team-accent=/);
});

test('placeholder scoreboards keep canonical labels when matchup text is not distinctive', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'placeholder-fiesta',
          csvAway: 'Team TBD',
          csvHome: 'Team TBD',
          stage: 'bowl',
          status: 'matchup_set',
          isPlaceholder: true,
          label: 'Fiesta Bowl',
        }),
        game({
          key: 'placeholder-rose',
          csvAway: 'Team TBD',
          csvHome: 'Team TBD',
          stage: 'bowl',
          status: 'matchup_set',
          isPlaceholder: true,
          label: 'Rose Bowl',
        }),
        game({
          key: 'normal-game',
          csvAway: 'Texas',
          csvHome: 'Oklahoma',
          label: 'Red River Rivalry',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Fiesta Bowl/);
  assert.match(html, /Rose Bowl/);
  assert.equal((html.match(/aria-label="Team TBD @ Team TBD"/g) ?? []).length, 2);
  assert.doesNotMatch(
    html,
    /Red River Rivalry<\/div><div class="font-medium text-gray-900 dark:text-zinc-100"><span>Texas<\/span> @ <span>Oklahoma<\/span>/
  );
});

test('odds row stays hidden only when no displayable odds markets exist', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'empty-odds',
          csvAway: 'Notre Dame',
          csvHome: 'Penn State',
        }),
      ]}
      byes={[]}
      oddsByKey={{
        'empty-odds': {
          favorite: null,
          spread: null,
          homeSpread: null,
          awaySpread: null,
          spreadPriceHome: null,
          spreadPriceAway: null,
          total: null,
          mlHome: null,
          mlAway: null,
          overPrice: null,
          underPrice: null,
          source: null,
          bookmakerKey: null,
          capturedAt: null,
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /ML:/);
  assert.doesNotMatch(html, /Spread:/);
  assert.doesNotMatch(html, /O\/U:/);
  assert.doesNotMatch(html, /No odds/);
});

test('tier 1 renders kickoff while tier 2 preserves venue on its own line', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'venue-context',
          csvAway: 'TCU',
          csvHome: 'Oklahoma State',
          date: '2025-09-01T17:00:00.000Z',
          venue: {
            stadium: 'Boone Pickens Stadium',
            city: 'Stillwater',
            state: 'OK',
            country: 'USA',
          },
        }),
        game({
          key: 'second-venue-context',
          csvAway: 'Navy',
          csvHome: 'Notre Dame',
          date: '2025-09-01T19:00:00.000Z',
          venue: { stadium: 'Aviva Stadium', city: 'Dublin', state: null, country: 'Ireland' },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-scoreboard-header[^>]*>[\s\S]*5:00 PM/);
  assert.match(
    html,
    /data-schedule-tier2-venue[^>]*>Boone Pickens Stadium • Stillwater, OK<\/div>/
  );
  assert.match(html, /<summary[^>]*>[\s\S]*More[\s\S]*Less[\s\S]*<\/summary>/);
  assert.doesNotMatch(
    html,
    /<summary[^>]*aria-label=/,
    'the native disclosure name must follow its visible More/Less label'
  );
  assert.match(
    html,
    /class="sr-only"> details for TCU @ Oklahoma State<\/span>/,
    'the native disclosure name must retain matchup context when many rows expose the same control'
  );
  assert.match(html, /class="sr-only"> details for Navy @ Notre Dame<\/span>/);
});

test('tier-2 venue falls back to stadium-only label', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'venue-stadium-only',
          csvAway: 'Navy',
          csvHome: 'Notre Dame',
          date: '2025-08-23T17:00:00.000Z',
          venue: { stadium: 'Aviva Stadium', city: null, state: null, country: 'Ireland' },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Aviva Stadium/);
  assert.doesNotMatch(html, /Aviva Stadium •/);
});

test('tier 2 omits venue when missing and disrupted rows omit kickoff', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'metadata-no-venue',
          csvAway: 'Texas',
          csvHome: 'Baylor',
          date: '2025-09-01T17:00:00.000Z',
          neutral: false,
          venue: null,
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'metadata-no-venue': {
          away: { team: 'Texas', score: null },
          home: { team: 'Baylor', score: null },
          status: 'Postponed',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /data-schedule-tier2-venue/);
  assert.doesNotMatch(html, /5:00 PM/);
  assert.doesNotMatch(html, /Neutral site/);
  assert.match(html, />Postponed<\/span>/);
});

test('shared scoreboard renders event context without a duplicate matchup title', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'duplicate-matchup',
          csvAway: 'Texas',
          csvHome: 'Ohio State',
          date: '2025-09-01T17:00:00.000Z',
          label: 'Cotton Bowl Classic',
          neutral: true,
          neutralDisplay: 'vs',
          stage: 'bowl',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.equal((html.match(/aria-label="Texas vs Ohio State"/g) ?? []).length, 1);
  assert.match(html, /data-expanded-event-name/);
  assert.match(html, /Cotton Bowl Classic/);
  assert.ok(html.includes('data-scoreboard-side="away"'));
  assert.ok(html.includes('data-scoreboard-side="home"'));
  assert.equal((html.match(/Texas @ Ohio State/g) ?? []).length, 0);
});

test('scoreboard event name falls back to notes and suppresses duplicate matchup labels', () => {
  const fallbackHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'event-notes',
          csvAway: 'Florida',
          csvHome: 'Georgia',
          date: '2025-11-01T19:30:00.000Z',
          label: '',
          notes: 'World’s Largest Outdoor Cocktail Party',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const suppressedHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'event-suppressed',
          csvAway: 'Florida',
          csvHome: 'Georgia',
          date: '2025-11-01T19:30:00.000Z',
          label: 'Florida @ Georgia',
          notes: 'Florida @ Georgia',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(
    fallbackHtml,
    /data-expanded-event-name[^>]*>World’s Largest Outdoor Cocktail Party<\/span>/
  );
  assert.doesNotMatch(suppressedHtml, /data-expanded-event-name/);
});

test('scoreboard event name prefers label over notes and preserves valid notes fallback examples', () => {
  const labelHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'event-label-wins',
          csvAway: 'Notre Dame',
          csvHome: 'Navy',
          date: '2025-08-23T17:00:00.000Z',
          label: 'Official Event Name',
          notes: 'Aer Lingus College Football Classic',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const notesHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'event-aer-lingus',
          csvAway: 'Notre Dame',
          csvHome: 'Navy',
          date: '2025-08-23T17:00:00.000Z',
          label: 'Notre Dame @ Navy',
          notes: 'Aer Lingus College Football Classic',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(labelHtml, /data-expanded-event-name[^>]*>Official Event Name<\/span>/);
  assert.doesNotMatch(
    labelHtml,
    /data-expanded-event-name[^>]*>Aer Lingus College Football Classic<\/span>/
  );
  assert.match(
    notesHtml,
    /data-expanded-event-name[^>]*>Aer Lingus College Football Classic<\/span>/
  );
});

test('neutral-site provider matchup labels fall back to notes when canonical matchup uses vs', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'neutral-site-provider-label',
          csvAway: 'Notre Dame',
          csvHome: 'Navy',
          date: '2025-08-23T17:00:00.000Z',
          neutral: true,
          neutralDisplay: 'vs',
          label: 'Notre Dame @ Navy',
          notes: 'Aer Lingus College Football Classic',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-expanded-event-name[^>]*>Aer Lingus College Football Classic<\/span>/);
  assert.doesNotMatch(html, /data-expanded-event-name[^>]*>Notre Dame @ Navy<\/span>/);
  assert.equal((html.match(/aria-label="Notre Dame vs Navy"/g) ?? []).length, 1);
});

test('scoreboard rows render without the retired outer card accent chrome', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'expanded-accented', csvAway: 'Texas', csvHome: 'Oklahoma' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-game-scoreboard/);
  assert.doesNotMatch(html, /inset 0 2px 0/);
  assert.doesNotMatch(html, /data-card-team-accent-top=/);
  assert.doesNotMatch(html, /data-card-team-accent-bottom=/);
  assert.doesNotMatch(html, /data-card-team-accent-edge=/);
  assert.doesNotMatch(html, /inset 0 -1px 0/);
});

test('shared scoreboard rows keep state styling inside the row without outer card accents', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'accented', csvAway: 'Texas', csvHome: 'Oklahoma' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        accented: {
          away: { team: 'Texas', score: 31 },
          home: { team: 'Oklahoma', score: 21 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /data-card-team-accent-top=/);
  assert.doesNotMatch(html, /data-card-team-accent-bottom=/);
  assert.doesNotMatch(html, /data-collapsed-team-accent=/);
  assert.match(html, /data-scoreboard-state="final"/);
  assert.match(html, />Final<\/span>/);
  assert.doesNotMatch(html, /bg-emerald-50 text-gray-900/);
});

test('schedule cards use primary tag priority (upset watch over top-25) with subordinate secondary tags', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'priority', csvAway: 'Away Team', csvHome: 'Home Team' })]}
      byes={[]}
      oddsByKey={{
        priority: {
          favorite: 'Home Team',
          spread: -7.5,
          homeSpread: -7.5,
          awaySpread: 7.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 51.5,
          mlHome: -140,
          mlAway: 118,
          overPrice: -110,
          underPrice: -110,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2026-09-01T17:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{
        priority: {
          away: { team: 'Away Team', score: 17 },
          home: { team: 'Home Team', score: 10 },
          status: 'In Progress',
          time: '05:32',
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={
        new Map([
          ['a', { rank: 7, rankSource: 'ap' }],
          ['h', { rank: 12, rankSource: 'ap' }],
        ])
      }
    />
  );

  assert.match(html, /data-primary-tag="upset_watch"/);
  assert.match(html, /Upset watch/);
  assert.match(html, /data-eyebrow-tag[^>]*>Top 25 Matchup<\/span>/);
  assert.doesNotMatch(html, /data-eyebrow-tag[^>]*>Top 25<\/span>/);
  assert.equal(bronzeEyebrows(html).length, 2);
});

test('single-tag cards render only a primary tag without any secondary tag chips', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'single-tag', csvAway: 'Away Team', csvHome: 'Home Team' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={
        new Map([
          ['a', { rank: 8, rankSource: 'ap' }],
          ['h', { rank: 17, rankSource: 'ap' }],
        ])
      }
    />
  );

  assert.match(html, /data-primary-tag="top_25_matchup"/);
  assert.match(html, /data-eyebrow-tag[^>]*>Top 25 Matchup<\/span>/);
  assert.doesNotMatch(html, /data-eyebrow-tag[^>]*>Top 25<\/span>/);
  assert.equal(bronzeEyebrows(html).length, 1);
});

test('cards without qualifying tags render no expanded tag chips', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'zero-tag', csvAway: 'Away Team', csvHome: 'Home Team' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-game-card-id="zero-tag"/);
  assert.match(html, /data-primary-tag=""/);
  assert.equal(bronzeEyebrows(html).length, 0);
});

test('collapsed and expanded tag presentation stay aligned to the same primary tag', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'tag-consistency', csvAway: 'Away Team', csvHome: 'Home Team' })]}
      byes={[]}
      oddsByKey={{
        'tag-consistency': {
          favorite: 'Home Team',
          spread: -7.5,
          homeSpread: -7.5,
          awaySpread: 7.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 51.5,
          mlHome: -140,
          mlAway: 118,
          overPrice: -110,
          underPrice: -110,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2026-09-01T17:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{
        'tag-consistency': {
          away: { team: 'Away Team', score: 17 },
          home: { team: 'Home Team', score: 10 },
          status: 'In Progress',
          time: '05:32',
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={
        new Map([
          ['a', { rank: 7, rankSource: 'ap' }],
          ['h', { rank: 10, rankSource: 'ap' }],
        ])
      }
    />
  );

  assert.match(html, /data-game-card-id="tag-consistency"/);
  assert.match(html, /data-primary-tag="upset_watch"/);
  assert.match(html, /data-eyebrow-tag[^>]*>Upset watch/);
  assertEveryEyebrowIsBronze(html);
});

test('upset cards keep their bronze eyebrow but render no retired amber border', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'featured-game', csvAway: 'A', csvHome: 'B' }),
        game({
          key: 'neutral-game',
          csvAway: 'C',
          csvHome: 'D',
          participants: {
            away: {
              kind: 'team',
              teamId: 'x',
              displayName: 'C',
              canonicalName: 'C',
              rawName: 'C',
            },
            home: {
              kind: 'team',
              teamId: 'y',
              displayName: 'D',
              canonicalName: 'D',
              rawName: 'D',
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{
        'featured-game': {
          favorite: 'B',
          spread: -7.5,
          homeSpread: -7.5,
          awaySpread: 7.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 51.5,
          mlHome: -280,
          mlAway: 225,
          overPrice: -110,
          underPrice: -110,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2026-09-01T17:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{
        'featured-game': {
          away: { team: 'A', score: 24 },
          home: { team: 'B', score: 17 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={
        new Map([
          ['a', { rank: 5, rankSource: 'ap' }],
          ['h', { rank: 18, rankSource: 'ap' }],
        ])
      }
    />
  );

  assert.match(html, /data-primary-tag="upset"/);
  assert.match(html, /data-eyebrow-tag[^>]*>Upset<\/span>/);
  assertEveryEyebrowIsBronze(html);
  assert.doesNotMatch(html, /border-amber-300\/80/);
  assert.match(html, /data-primary-tag=""/);
});

test('ranked games retain rank context without retired card emphasis', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'ranked-subtle', csvAway: 'Away', csvHome: 'Home' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={new Map([['h', { rank: 7, rankSource: 'ap' }]])}
    />
  );

  assert.match(html, /data-ranked-game="true"/);
  assert.match(html, />#7<\/span>/);
  assert.doesNotMatch(html, /border-blue-300\/70 bg-blue-50\/20/);
});

test('schedule header suppresses raw tag-chain legend copy', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'legend', csvAway: 'Away', csvHome: 'Home' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Tags: Upset &gt; Upset watch &gt; Top 25/);
});

test('schedule header omits summary row when scores and odds have no actionable copy', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'summary-none', csvAway: 'Away', csvHome: 'Home' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'summary-none': {
          away: { team: 'Away', score: 10 },
          home: { team: 'Home', score: 7 },
          status: 'Final',
          time: 'Final',
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /data-game-summary-row="true"/);
});

test('live schedule rows use the shared live state without the retired amber ring', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'live-ring', csvAway: 'Away', csvHome: 'Home' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'live-ring': {
          away: { team: 'Away', score: 10 },
          home: { team: 'Home', score: 7 },
          status: 'In Progress',
          time: '08:11',
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-scoreboard-state="live"/);
  assert.match(html, />Live<\/span>/);
  assert.doesNotMatch(html, /ring-1 ring-amber-300\/70/);
});

test('schedule panel shows empty-state copy when no games match selected scope', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /No games match the current filters\./);
});

test('pregame provider statuses containing "ot" letters do not render as live rows', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'not-started-regression',
          csvAway: 'Texas',
          csvHome: 'Baylor',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'not-started-regression': {
          away: { team: 'Texas', score: null },
          home: { team: 'Baylor', score: null },
          status: 'NOT_STARTED',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
    />
  );

  assert.match(html, /data-scoreboard-state="scheduled"/);
  assert.match(html, />NOT_STARTED<\/span>/);
  assert.doesNotMatch(html, /data-scoreboard-state="live"/);
});

// --- PLATFORM-086E1C1: broadcast + enriched venue + Time TBD -----------------

/**
 * ITEM 180 — the `Streaming ·` cut lands in the SHARED formatter
 * (`formatPrimaryBroadcastLabel`), so it changes Schedule as well as Overview.
 * That is deliberate: the rule is a property of the shared row
 * (`item-87-reference-game-row.md` §1), and applying it to one surface is the
 * back-application failure Item 160 exists to record.
 *
 * Schedule is asserted HERE because nothing else did. The nearby
 * `assert.doesNotMatch(html, /Streaming ·/)` at the missing-enrichment test passes
 * on a fixture carrying NO media at all, so it could never have caught the prefix
 * — the positive control this test supplies is a `web` outlet that really reaches
 * a rendered row.
 */
test('a streaming outlet reaches a Schedule row unprefixed, and radio keeps its prefix', () => {
  const render = (media: { gameId: string; mediaType: 'web' | 'radio'; outlet: string }[]) =>
    renderToStaticMarkup(
      <GameWeekPanel
        games={[
          game({
            key: 'streaming-cut',
            csvAway: 'Ohio State',
            csvHome: 'Texas',
            date: '2025-08-30T00:00:00.000Z',
            media,
          }),
        ]}
        byes={[]}
        oddsByKey={{}}
        scoresByKey={{}}
        rosterByTeam={new Map()}
        isDebug={false}
        hideByes={true}
        displayTimeZone="UTC"
      />
    );

  const streaming = render([{ gameId: 'streaming-cut', mediaType: 'web', outlet: 'ESPN+' }]);
  assert.match(streaming, /ESPN\+/, 'the outlet name reaches the row');
  assert.doesNotMatch(streaming, /Streaming ·/, 'and it carries no qualifier prefix');

  // Radio is the ONE surviving prefix, and it is a different KIND of broadcast —
  // an unprefixed station would present a radio-only game as watchable.
  const radioOnly = render([{ gameId: 'streaming-cut', mediaType: 'radio', outlet: 'KVET' }]);
  assert.match(radioOnly, /Radio · KVET/);
});

test('scheduled row renders the preferred broadcast outlet and enriched venue', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'presentation-enriched',
          csvAway: 'Ohio State',
          csvHome: 'Texas',
          date: '2025-08-30T00:00:00.000Z',
          neutral: true,
          neutralDisplay: 'vs',
          media: [
            { gameId: '101', mediaType: 'radio', outlet: 'KVET' },
            { gameId: '101', mediaType: 'tv', outlet: 'ESPN' },
          ],
          venue: {
            stadium: 'Darrell K Royal–Texas Memorial Stadium',
            city: 'Austin',
            state: 'TX',
            country: 'US',
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, />12:00 AM<\/span>/);
  assert.match(html, /ESPN/, 'the tv outlet wins the display priority');
  assert.doesNotMatch(html, /KVET/, 'the compact card shows ONE preferred outlet');
  assert.match(html, /Neutral site/);
  assert.match(html, /Darrell K Royal–Texas Memorial Stadium • Austin, TX/);
});

test('scheduled row renders Time TBD when startTimeTBD is true', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'presentation-tbd',
          csvAway: 'Georgia',
          csvHome: 'Alabama',
          date: '2025-08-30T00:00:00.000Z',
          startTimeTBD: true,
          media: [{ gameId: '102', mediaType: 'tv', outlet: 'ABC' }],
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, />Time TBD<\/span>/);
  assert.doesNotMatch(html, /12:00 AM/, 'the placeholder clock is never shown as confirmed');
  assert.match(html, /ABC/);
});

test('missing presentation enrichment omits placeholders from the shared row', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'presentation-absent',
          csvAway: 'TCU',
          csvHome: 'Baylor',
          date: '2025-09-01T17:00:00.000Z',
          venue: null,
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, />5:00 PM<\/span>/);
  assert.doesNotMatch(html, /Streaming ·/);
  assert.doesNotMatch(html, /Radio ·/);
  assert.doesNotMatch(html, /Time TBD/);
});

test('Today is the only relative date-group label', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'today', date: '2025-09-01T17:00:00.000Z' }),
        game({ key: 'tomorrow', date: '2025-09-02T17:00:00.000Z' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      currentDateMs={Date.parse('2025-09-01T12:00:00.000Z')}
    />
  );

  assert.equal((html.match(/>Today<\/div>/g) ?? []).length, 1);
  assert.match(html, />Tuesday, Sep 2<\/div>/);
  assert.doesNotMatch(html, />Tomorrow<\/div>/);
});

test('status row renders kickoff, game clock, or no value according to scoreboard state', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'status-scheduled', date: '2025-09-01T17:00:00.000Z' }),
        game({ key: 'status-live', date: '2025-09-01T18:00:00.000Z' }),
        game({
          key: 'status-awaiting',
          date: '2025-09-01T19:00:00.000Z',
          status: 'in_progress',
        }),
        game({ key: 'status-final', date: '2025-09-01T20:00:00.000Z' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'status-live': {
          away: { team: 'Away', score: 14 },
          home: { team: 'Home', score: 10 },
          status: 'Q3',
          time: '8:12',
        },
        'status-final': {
          away: { team: 'Away', score: 28 },
          home: { team: 'Home', score: 17 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  function headerFor(key: string): string {
    const start = html.indexOf(`data-game-card-id="${key}"`);
    assert.notEqual(start, -1);
    const next = html.indexOf('data-game-card-id="', start + 1);
    const cardHtml = html.slice(start, next === -1 ? undefined : next);
    return cardHtml.match(/data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
  }

  const scheduledHeader = headerFor('status-scheduled');
  const liveHeader = headerFor('status-live');
  const awaitingHeader = headerFor('status-awaiting');
  const finalHeader = headerFor('status-final');

  assert.match(scheduledHeader, />Scheduled<\/span>[\s\S]*>5:00 PM<\/span>/);
  assert.match(liveHeader, />Live<\/span>[\s\S]*>Q3 8:12<\/span>/);
  assert.match(awaitingHeader, />Awaiting score<\/span>/);
  assert.doesNotMatch(awaitingHeader, /7:00 PM|Q\d/);
  assert.match(finalHeader, />Final<\/span>/);
  assert.doesNotMatch(finalHeader, /8:00 PM|Q\d/);
});

test('broadcast renders for scheduled, live, and awaiting rows, but not final or unlisted rows', () => {
  const media = (outlet: string) => [
    { gameId: 'broadcast-test', mediaType: 'tv' as const, outlet },
  ];
  const baseProps = {
    byes: [] as string[],
    oddsByKey: {},
    rosterByTeam: new Map<string, string>(),
    isDebug: false,
    hideByes: true,
    displayTimeZone: 'UTC',
  };
  const scheduledHtml = renderToStaticMarkup(
    <GameWeekPanel
      {...baseProps}
      games={[game({ key: 'scheduled-broadcast', media: media('ESPN') })]}
      scoresByKey={{}}
    />
  );
  const liveHtml = renderToStaticMarkup(
    <GameWeekPanel
      {...baseProps}
      games={[game({ key: 'live-broadcast', media: media('FOX') })]}
      scoresByKey={{
        'live-broadcast': {
          away: { team: 'Away', score: 14 },
          home: { team: 'Home', score: 10 },
          status: '3rd Quarter',
          time: '04:32',
        },
      }}
    />
  );
  const finalHtml = renderToStaticMarkup(
    <GameWeekPanel
      {...baseProps}
      games={[game({ key: 'final-broadcast', media: media('CBS') })]}
      scoresByKey={{
        'final-broadcast': {
          away: { team: 'Away', score: 28 },
          home: { team: 'Home', score: 17 },
          status: 'Final',
          time: null,
        },
      }}
    />
  );
  const awaitingHtml = renderToStaticMarkup(
    <GameWeekPanel
      {...baseProps}
      games={[game({ key: 'awaiting-broadcast', status: 'in_progress', media: media('NBC') })]}
      scoresByKey={{}}
    />
  );
  const unlistedHtml = renderToStaticMarkup(
    <GameWeekPanel
      {...baseProps}
      games={[game({ key: 'unlisted-broadcast', media: [] })]}
      scoresByKey={{}}
    />
  );

  assert.match(scheduledHtml, />ESPN<\/span>/);
  assert.match(liveHtml, />FOX<\/span>/);
  assert.match(awaitingHtml, />NBC<\/span>/);
  assert.doesNotMatch(finalHtml, /CBS/);
  const unlistedHeader = unlistedHtml.match(/data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(unlistedHeader);
  assert.doesNotMatch(
    unlistedHeader,
    /aria-hidden="true">•<\/span>/,
    'an unlisted carrier must not add a broadcast segment to the status row'
  );
});

test('conference tier 2 collapses same-conference games and distinguishes cross-conference games', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'same-conference', awayConf: 'ACC', homeConf: 'ACC' }),
        game({
          key: 'cross-conference',
          awayConf: 'CAA',
          homeConf: 'ACC',
          awayClassification: 'fcs',
          homeClassification: 'fbs',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-schedule-tier2-conference[^>]*>ACC matchup<\/div>/);
  assert.match(html, /data-schedule-tier2-conference[^>]*>CAA vs ACC<\/div>/);
  assert.match(html, /data-scoreboard-classification="away">FCS<\/span>/);
  assert.doesNotMatch(html, /FCS vs ACC|ACC vs FCS/);
});

test('Schedule omits team records pending shared completed-game reconciliation', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'scheduled-records', providerGameId: '401234567' }),
        game({ key: 'final-records', providerGameId: '401234568' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'final-records': {
          away: { team: 'Away', score: 24 },
          home: { team: 'Home', score: 17 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /data-scoreboard-record=/);
  assert.doesNotMatch(html, /data-scoreboard-value-kind="record"/);
  assert.match(html, /data-scoreboard-value-kind="score" data-scoreboard-value="away">24<\/span>/);
});

// ---------------------------------------------------------------------------
// POLISH-005 — the postseason label override is an ADMIN authoring control.
//
// It is server-guarded already (`/api/postseason-overrides` requires admin on
// write), so rendering it to a member produced a button that always failed —
// and worse, the client writes the label to `localStorage` optimistically
// first, leaving that member a postseason label nobody else can see, persisted
// across reloads.
//
// `CFBScheduleApp` decides by passing the callback only when `isAdmin`. This
// pins the RENDERING half, which is what a member actually encounters.
// ---------------------------------------------------------------------------

function placeholderBowl() {
  return game({
    key: 'placeholder-bowl',
    stage: 'bowl',
    postseasonRole: 'bowl',
    isPlaceholder: true,
    label: 'Placeholder Bowl',
    date: null,
    csvAway: 'Team TBD',
    csvHome: 'Team TBD',
  });
}

test('POLISH-005: no override control without the callback (the member case)', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[placeholderBowl()]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="Pacific/Honolulu"
    />
  );
  assert.ok(html.includes('Placeholder Bowl'), 'the placeholder card must render');
  assert.doesNotMatch(html, /Save label override/, 'members never author overrides');
});

test('POLISH-005: the control appears WITH the callback (the admin case)', () => {
  // The positive control. Without it the assertion above would pass against a
  // card that simply never offers the button, proving nothing about gating.
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[placeholderBowl()]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="Pacific/Honolulu"
      onSavePostseasonOverride={() => {}}
    />
  );
  assert.match(html, /Save label override/, 'an admin still gets the authoring control');
});
