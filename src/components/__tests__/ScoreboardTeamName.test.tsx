import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CompactGameScoreboard from '../CompactGameScoreboard';

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

test('SSR starts each measured label at one visible abbreviation with one stable accessible name', () => {
  const document = renderNames('Southeast Missouri State', 'Ohio State');

  for (const [marker, fullName, abbreviation] of [
    ['away', 'Southeast Missouri State', 'SEMO'],
    ['home', 'Ohio State', 'OSU'],
  ] as const) {
    const label = document.querySelector(`[data-scoreboard-team-label="${marker}"]`);
    const accessible = label?.querySelector(`[data-scoreboard-team-accessible="${marker}"]`);
    const full = label?.querySelector(`[data-scoreboard-team-full="${marker}"]`);
    const short = label?.querySelector(`[data-scoreboard-team-abbreviation="${marker}"]`);
    const visible = label?.querySelector(`[data-scoreboard-team-visible="${marker}"]`);
    assert.ok(label && accessible && full && short && visible);

    assert.equal(label.getAttribute('data-scoreboard-team-display'), 'abbreviation');
    assert.match(label.className, /flex-1/);
    assert.match(label.className, /overflow-hidden/);
    assert.doesNotMatch(label.className, /truncate|shrink-0/);
    assert.equal(accessible.textContent, fullName);
    assert.ok(accessible.classList.contains('sr-only'));
    assert.equal(accessible.getAttribute('aria-hidden'), null);
    assert.equal(full.textContent, fullName);
    assert.equal(full.getAttribute('aria-hidden'), 'true');
    assert.match(full.className, /invisible/);
    assert.match(full.className, /absolute/);
    assert.equal(short.textContent, abbreviation);
    assert.equal(short.getAttribute('aria-hidden'), 'true');
    assert.match(short.className, /absolute/);
    assert.match(short.className, /invisible/);
    assert.equal(visible.textContent, abbreviation);
    assert.equal(visible.getAttribute('aria-hidden'), 'true');
    assert.equal(visible.getAttribute('data-scoreboard-team-visual'), 'abbreviation');
    assert.doesNotMatch(visible.className, /absolute|invisible|truncate/);
    assert.match(visible.className, /whitespace-normal break-words/);
    assert.equal(label.querySelectorAll('.sr-only').length, 1);
    assert.equal(label.getAttribute('aria-live'), null);
  }
});

test('Compact scoreboard gives the name its own box and isolates record and owner suffixes', () => {
  const document = renderNames('Southeast Missouri State', 'Ohio State');
  const label = document.querySelector('[data-scoreboard-team-label="away"]');
  const suffix = document.querySelector('[data-scoreboard-suffix="away"]');
  const owner = document.querySelector('[data-scoreboard-owner="away"]');
  assert.ok(label && suffix && owner);
  assert.equal(label.parentElement, suffix.parentElement);
  assert.equal(label.contains(suffix), false);
  assert.equal(label.contains(owner), false);
  assert.match(label.className, /flex-1/);
  assert.doesNotMatch(label.className, /shrink-0/);
  assert.match(label.className, /overflow-hidden/);
  assert.match(suffix.className, /truncate/);
  assert.doesNotMatch(label.parentElement?.className ?? '', /truncate|overflow-hidden/);
});

test('Compact scoreboard leaves a null abbreviation as plain untruncated full-name text', () => {
  const document = renderNames('Chicago State', 'Ohio State');
  const away = document.querySelector('[data-scoreboard-team="away"]');
  assert.ok(away);
  assert.equal(away.textContent, 'Chicago State');
  assert.equal(away.children.length, 0);
  assert.match(away.className, /overflow-hidden/);
  assert.match(away.className, /whitespace-normal break-words/);
  assert.doesNotMatch(away.className, /truncate|shrink-0/);
  assert.equal(document.querySelector('[data-scoreboard-team-label="away"]'), null);
  assert.equal(document.querySelector('[data-scoreboard-team-accessible="away"]'), null);
  assert.equal(document.querySelector('[data-scoreboard-team-abbreviation="away"]'), null);
});

test('shipped fallback code has no threshold, surface calibration, or font-weight assumption', () => {
  const source = readFileSync(new URL('../ScoreboardTeamName.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /@(?:min|max)-\[/);
  assert.doesNotMatch(source, /threshold/i);
  assert.doesNotMatch(source, /requiredWidth/i);
  assert.doesNotMatch(source, /minimumNameLength/i);
  assert.doesNotMatch(source, /fontWeight|font-weight/);
  assert.doesNotMatch(source, /suppressHydrationWarning/);
  assert.match(source, /abbreviationWidth >= fullNameWidth \|\| fullNameWidth <= boxWidth/);
});
