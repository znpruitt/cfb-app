import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RankingsPageContent from '../RankingsPageContent';

test('rankings page renders CFP first and AP as a separate section', () => {
  const html = renderToStaticMarkup(
    <RankingsPageContent
      season={2025}
      loading={false}
      error={null}
      latestWeek={{
        season: 2025,
        seasonType: 'regular',
        week: 12,
        primarySource: 'cfp',
        teams: [],
        polls: {
          cfp: [{ teamId: 'oregon', teamName: 'Oregon', rank: 1, rankSource: 'cfp' }],
          ap: [{ teamId: 'texas', teamName: 'Texas', rank: 2, rankSource: 'ap' }],
          coaches: [],
        },
      }}
    />
  );

  // Anchor on the column section headings (CFP renders before AP). Using the
  // closing </h3> avoids matching the "AP Top 25 · Coaches Poll · CFP" subtitle.
  const cfpIndex = html.indexOf('CFP Rankings</h3>');
  const apIndex = html.indexOf('AP Top 25</h3>');
  assert.ok(cfpIndex >= 0);
  assert.ok(apIndex > cfpIndex);
  // Rank number and team name render in adjacent spans (no "#" prefix).
  assert.match(html, /1<\/span><span[^>]*>Oregon<\/span>/);
  assert.match(html, /2<\/span><span[^>]*>Texas<\/span>/);
});

function pollWeek(week: number, apTeams: [string, string, number][]) {
  return {
    season: 2026,
    seasonType: 'regular' as const,
    week,
    primarySource: 'ap' as const,
    teams: [],
    polls: {
      cfp: [],
      ap: apTeams.map(([teamId, teamName, rank]) => ({
        teamId,
        teamName,
        rank,
        rankSource: 'ap' as const,
      })),
      coaches: [],
    },
  };
}

test('POLISH-008: the first poll of a season reports no movement at all', () => {
  // Preseason has no prior poll, so "NR" — a claim that a team was absent from
  // the PREVIOUS poll — cannot be true of anyone. The old derivation marked
  // every team `new` and rendered NR twenty-five times over.
  const week = pollWeek(1, [
    ['ohio-state', 'Ohio State', 1],
    ['oregon', 'Oregon', 2],
  ]);

  const html = renderToStaticMarkup(
    <RankingsPageContent season={2026} loading={false} error={null} latestWeek={week} />
  );

  // Positive control: the poll itself rendered, so the absence assertions below
  // are reached rather than passing on an empty page.
  assert.match(html, /1<\/span><span[^>]*>Ohio State<\/span>/);

  assert.doesNotMatch(html, />NR</, 'no team is marked unranked-before');
  assert.doesNotMatch(html, /vs last/, 'an absent column is not labelled');
  assert.doesNotMatch(html, /No change/, 'no placeholder dashes stand in for it');
});

test('POLISH-008: a real prior poll restores movement, its label, and NR', () => {
  const html = renderToStaticMarkup(
    <RankingsPageContent
      season={2026}
      loading={false}
      error={null}
      latestWeek={pollWeek(2, [
        ['ohio-state', 'Ohio State', 1],
        ['texas', 'Texas', 2],
      ])}
      allWeeks={[
        pollWeek(1, [
          ['ohio-state', 'Ohio State', 3],
          ['oregon', 'Oregon', 2],
        ]),
        pollWeek(2, [
          ['ohio-state', 'Ohio State', 1],
          ['texas', 'Texas', 2],
        ]),
      ]}
    />
  );

  assert.match(html, /vs last/, 'the column is labelled once it carries meaning');
  // Ohio State climbed 3 -> 1.
  assert.match(html, /Up 2/, 'movement is reported against the prior poll');
  // Texas was not in week 1's poll, which is what NR actually means.
  assert.match(html, />NR</, 'a genuinely new entrant is marked NR');
});

test('rankings page renders coaches poll entries when that is the available normalized data', () => {
  const html = renderToStaticMarkup(
    <RankingsPageContent
      season={2025}
      loading={false}
      error={null}
      latestWeek={{
        season: 2025,
        seasonType: 'postseason',
        week: 16,
        primarySource: 'coaches',
        teams: [],
        polls: {
          cfp: [],
          ap: [],
          coaches: [
            { teamId: 'notre-dame', teamName: 'Notre Dame', rank: 4, rankSource: 'coaches' },
          ],
        },
      }}
    />
  );

  assert.match(html, /Coaches Poll/);
  // Rank number and team name render in adjacent spans (no "#" prefix).
  assert.match(html, /4<\/span><span[^>]*>Notre Dame<\/span>/);
});
