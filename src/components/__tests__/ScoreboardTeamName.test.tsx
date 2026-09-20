import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CompactGameScoreboard from '../CompactGameScoreboard';
import {
  SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS,
  SCOREBOARD_TEAM_NAME_FALLBACK_RULE_SPECS,
  SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS,
} from '../ScoreboardTeamName';

function renderNames(awayName: string, homeName: string): Document {
  const html = renderToStaticMarkup(
    <CompactGameScoreboard
      state="final"
      matchupLabel={`${awayName} at ${homeName}`}
      away={{ teamName: awayName, owner: 'Mastromatteo', rank: 25, score: 100 }}
      home={{ teamName: homeName, owner: 'Chamness', rank: null, score: 7 }}
    />
  );
  return new JSDOM(html).window.document;
}

test('fallback thresholds are rounded from the named browser measurements and match their Tailwind utilities', () => {
  const expected = [
    ['atLeast22Characters', 22, 403],
    ['atLeast18Characters', 18, 378],
    ['atLeast13Characters', 13, 361],
    ['atLeast11Characters', 11, 342],
    ['atLeast8Characters', 8, 324],
    ['anyLength', 1, 306],
  ] as const;

  assert.deepEqual(
    SCOREBOARD_TEAM_NAME_FALLBACK_RULE_SPECS.map(
      ({ key, minimumNameLength, thresholdPx }) => [key, minimumNameLength, thresholdPx] as const
    ),
    expected
  );
  for (const rule of SCOREBOARD_TEAM_NAME_FALLBACK_RULE_SPECS) {
    const measurement = SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS[rule.key];
    assert.equal(rule.minimumNameLength, measurement.minimumNameLength);
    assert.equal(rule.thresholdPx, Math.ceil(measurement.requiredWidthPx));
    assert.equal(rule.thresholdPx, SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS[rule.key]);
    assert.equal(rule.fullNameClassName, `@max-[${rule.thresholdPx}px]:hidden`);
    assert.equal(rule.abbreviationClassName, `hidden @max-[${rule.thresholdPx}px]:inline`);
  }
});

test('Compact scoreboard prepares each label independently and exposes only its full name to assistive technology', () => {
  const document = renderNames('Southeast Missouri State', 'Ohio State');
  const away = document.querySelector('[data-scoreboard-team-label="away"]');
  const home = document.querySelector('[data-scoreboard-team-label="home"]');
  assert.ok(away && home);

  assert.equal(away.getAttribute('data-scoreboard-team-fallback'), 'atLeast22Characters');
  assert.equal(away.getAttribute('data-scoreboard-team-fallback-max-width'), '403');
  assert.equal(home.getAttribute('data-scoreboard-team-fallback'), 'atLeast8Characters');
  assert.equal(home.getAttribute('data-scoreboard-team-fallback-max-width'), '324');

  for (const [label, marker, fullName, abbreviation] of [
    [away, 'away', 'Southeast Missouri State', 'SEMO'],
    [home, 'home', 'Ohio State', 'OSU'],
  ] as const) {
    const accessible = label.querySelector(`[data-scoreboard-team-accessible="${marker}"]`);
    const full = label.querySelector(`[data-scoreboard-team-full="${marker}"]`);
    const short = label.querySelector(`[data-scoreboard-team-abbreviation="${marker}"]`);
    assert.ok(accessible && full && short);
    assert.equal(accessible.textContent, fullName);
    assert.ok(accessible.classList.contains('sr-only'));
    assert.equal(accessible.getAttribute('aria-hidden'), null);
    assert.equal(full.textContent, fullName);
    assert.equal(full.getAttribute('aria-hidden'), 'true');
    assert.equal(short.textContent, abbreviation);
    assert.equal(short.getAttribute('aria-hidden'), 'true');
    assert.equal(label.querySelectorAll('.sr-only').length, 1);
  }
});

test('Compact scoreboard leaves a null abbreviation as plain full-name text', () => {
  const document = renderNames('Chicago State', 'Ohio State');
  const away = document.querySelector('[data-scoreboard-team="away"]');
  assert.ok(away);
  assert.equal(away.textContent, 'Chicago State');
  assert.equal(away.children.length, 0);
  assert.equal(document.querySelector('[data-scoreboard-team-label="away"]'), null);
  assert.equal(document.querySelector('[data-scoreboard-team-accessible="away"]'), null);
  assert.equal(document.querySelector('[data-scoreboard-team-abbreviation="away"]'), null);
});
