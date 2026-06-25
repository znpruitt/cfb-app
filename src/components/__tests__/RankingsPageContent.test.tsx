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
