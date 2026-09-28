import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { OverviewGameItem } from '../../lib/overview';
import type { AppGame } from '../../lib/schedule';
import { withBrowserFixture, type BrowserFixturePage } from '../../test/browserFixture';
import OverviewPanel from '../OverviewPanel';

type MetadataFixture = 'short' | 'long';

/**
 * The longest broadcast label the watchlist can actually render, and the bound the #669 DESIGN.md
 * exception's scope claim depends on.
 *
 * MEASURED 2026-09-28 on the read-only replica, `schedule-media/2026-all` joined to
 * `schedule/2026-all-all`: of 888 games with an FBS participant, 509 carry media, and applying
 * `formatPrimaryBroadcastLabel`'s one-per-game `tv → web → ppv → mobile → radio` priority yields
 * **21 distinct rendered labels whose longest is 11 characters** — `SEC Network` and `ACC Network`.
 *
 * The store is NOT the population: it holds 95 (mediaType, outlet) pairs reaching 30 characters
 * (`Rock Athletics Digital Network`), but those sit on non-FBS games that no league surface renders.
 * CFBD supplies `CBSSN`, not `CBS Sports Network`, and `BTN`, not `Big Ten Network`.
 *
 * THE RADIO PATH IS NOT COVERED BY THAT BOUND, AND AN EARLIER VERSION OF THIS COMMENT WRONGLY SAID
 * IT COULD NOT OCCUR. It claimed `Radio · ` "never reaches this surface" on the strength of the same
 * day's measurement — but `gameCardPresentation.ts:139-144` and `DESIGN.md:219-223` both state that
 * the prefix "is a guard against a radio-only game, not a live label; do not retire it as
 * unreachable." A measurement that radio renders on zero games TODAY is not a licence to treat a
 * radio-only game as impossible, and that is exactly the reasoning this branch already corrected
 * once, in DESIGN.md's `max-sm` boundary.
 *
 * Measured the same day, radio-only games: ZERO, of any classification; six FBS games carry a radio
 * row and every one also carries higher-priority media. The sole radio outlet is `ERADM`, so a
 * radio-only game would render `Radio · ERADM`. Measured at 809px, the narrowest two-column width
 * and the tightest budget, with a tags-only card whose metadata box is 244px:
 *
 *   `Wed, Sep 16 · Time TBD` + `SEC Network`    → 234.0px natural, **+10px slack**
 *   `Wed, Sep 16 · Time TBD` + `Radio · ERADM`  → 244.3px natural, **−0.3px — no margin at all**
 *
 * The radio row sits ON the boundary: sub-pixel, so integer `scrollWidth` never exceeds
 * `clientWidth` and nothing visibly ellipsizes, but the budget is spent. The kickoff half of that
 * pair is the longest form the surface renders — `startTimeTBD` on a two-digit day.
 *
 * NOTHING HERE DETECTS PROVIDER DRIFT, and no fixture can: the bound is a constant, not a store
 * read, so a longer radio outlet or a dropped abbreviation changes the rendered population without
 * reddening a test. What the assertions below DO hold is that a code change narrowing the metadata
 * budget reddens — on both paths, including the tighter one. Treating the constant as a guarantee
 * rather than a dated observation is the failure mode to watch for.
 */
const LONGEST_RENDERED_OUTLET = 'SEC Network';
/**
 * Explicitly NOT in the rendered population — 18 characters, the unabbreviated form of a label CFBD
 * actually emits as `CBSSN`. It exists to hold two boundaries that nothing else in this file holds.
 */
const SYNTHETIC_OUTLET_BEYOND_BOUND = 'CBS Sports Network';

function fixtureItem(
  key: string,
  day: number,
  metadata: MetadataFixture,
  outlet?: string,
  mediaType: 'tv' | 'radio' = 'tv'
): OverviewGameItem {
  const game: AppGame = {
    key,
    eventId: key,
    eventKey: key,
    providerGameId: key,
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: `2026-09-${String(day).padStart(2, '0')}T19:30:00Z`,
    status: 'scheduled',
    startTimeTBD: metadata === 'long',
    stage: 'regular',
    stageOrder: 1,
    slotOrder: 0,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    csvAway: `${key} Away`,
    csvHome: `${key} Home`,
    canAway: `${key}-a`,
    canHome: `${key}-h`,
    awayConf: 'SEC',
    homeConf: 'SEC',
    participants: {
      away: {
        kind: 'team',
        teamId: `${key}-a`,
        displayName: `${key} Away`,
        canonicalName: `${key} Away`,
        rawName: `${key} Away`,
      },
      home: {
        kind: 'team',
        teamId: `${key}-h`,
        displayName: `${key} Home`,
        canonicalName: `${key} Home`,
        rawName: `${key} Home`,
      },
    },
    media: [
      {
        gameId: key,
        mediaType,
        outlet: outlet ?? (metadata === 'long' ? 'ACC Network' : 'ESPN'),
      },
    ],
  };
  return {
    bucket: {
      game,
      awayOwner: 'Alice',
      homeOwner: 'Bob',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    priority: 2,
    sortDate: Date.parse(game.date!),
  };
}

async function fixtureMarkup(
  metadata: MetadataFixture,
  outlet?: string,
  mediaType: 'tv' | 'radio' = 'tv',
  /** Two-digit days render the LONGEST kickoff form; the default keeps the original fixture. */
  days: [number, number, number] = [5, 6, 7]
): Promise<string> {
  const items = [
    fixtureItem('reason-tag', days[0], metadata, outlet, mediaType),
    fixtureItem('tag', days[1], metadata, outlet, mediaType),
    fixtureItem('untagged', days[2], metadata, outlet, mediaType),
  ];
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 120,
          pointsAgainst: 100,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 5,
        },
      ]}
      standingsCoverage={{ state: 'complete', message: null }}
      matchupMatrix={{ owners: [], rows: [] }}
      liveItems={[]}
      keyMatchups={items}
      sectionItems={items}
      nowMs={Date.parse('2026-09-01T16:30:00Z')}
      rankingsByTeamId={
        new Map([
          ['reason-tag-a', { rank: 3, rankSource: 'ap' }],
          ['reason-tag-h', { rank: 8, rankSource: 'ap' }],
          ['tag-a', { rank: 3, rankSource: 'ap' }],
          ['tag-h', { rank: 8, rankSource: 'ap' }],
          ['untagged-a', { rank: 25, rankSource: 'ap' }],
        ])
      }
      context={{ scopeDetail: 'Week 1' }}
      displayTimeZone="UTC"
    />
  );
  const dom = new JSDOM(html);
  const grid = dom.window.document.querySelector('[data-watchlist-scoreboard-grid]');
  assert.ok(grid, 'the production selector must render the watchlist');
  const body = `<div class="p-4 sm:p-6"><section class="@container">${grid.outerHTML}</section></div>`;
  dom.window.close();
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const source =
    (await readFile(from, 'utf8')).replace(
      "@import 'tailwindcss';",
      "@import 'tailwindcss' source(none);"
    ) +
    `
    @source '../components/OverviewPanel.tsx';
    @source '../components/CompactGameScoreboard.tsx';
    @source '../components/ScoreboardTeamName.tsx';
    @source '../components/LeaguePageShell.tsx';
    @source '../lib/gameUi.ts';
    @source '../lib/teamLogos.ts';
  `;
  const styles = (await postcss([tailwindcss()]).process(source, { from })).css;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

type Rect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};
type Row = {
  name: string;
  card: Rect;
  header: Rect;
  metadata: Rect | null;
  slot: Rect | null;
  text: Array<{ text: string; width: number; textWidth: number; scroll: number; client: number }>;
  metadataOverflow: number;
  metadataNaturalWidth: number;
  headerGap: number;
  firstTeamTop: number;
  contextCount: number;
  footer: Rect;
  tags: Array<{ text: string; rect: Rect; clipped: number }>;
};

/**
 * The pill-clipping observer, as ONE definition shared by `measure()` and its positive control.
 *
 * It is extracted rather than inlined because a control that re-implements the observer proves the
 * COPY, not the thing the assertions use. `clipped === 0` is asserted in four places in this file
 * and, before this control existed, never once produced a non-zero value — so "the observer looked
 * and found nothing" and "the observer cannot see" were indistinguishable results. The sibling
 * `ThirdColumnTier.browser.test.tsx` carries the same shape for its visible-name observer.
 *
 * It deliberately reads `checkVisibility` AND walks every ancestor's computed overflow, because a
 * pill can be lost either by being hidden or by being cut off by a clipping ancestor, and #879's
 * subgrid work moves which ancestor that is.
 */
const CLIPPED_OBSERVER = `tag => {
  const box = e => e.getBoundingClientRect();
  const r = box(tag);
  let clipped = tag.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) ? 0 : r.width;
  for (let parent = tag.parentElement; parent; parent = parent.parentElement) {
    const p = box(parent), style = getComputedStyle(parent);
    if (['hidden','clip','auto','scroll'].includes(style.overflowX))
      clipped = Math.max(clipped, p.left-r.left, r.right-p.right);
    if (['hidden','clip','auto','scroll'].includes(style.overflowY))
      clipped = Math.max(clipped, p.top-r.top, r.bottom-p.bottom);
  }
  return clipped;
}`;

async function measure(page: BrowserFixturePage): Promise<Row[]> {
  return page.evaluate<Row[]>(`(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = e => {
      const {top, bottom, left, right, width, height} = e.getBoundingClientRect();
      return {top, bottom, left, right, width, height};
    };
    return [...document.querySelectorAll('[data-game-scoreboard]')].map(card => {
      const header = card.querySelector('[data-scoreboard-header]');
      const metadata = card.querySelector('[data-scoreboard-header-metadata]');
      const slot = card.querySelector('[data-scoreboard-tag-slot]');
      return {name: card.getAttribute('aria-label'), card: rect(card), header: rect(header),
        metadata: metadata && rect(metadata), slot: slot && rect(slot),
        metadataOverflow: metadata ? metadata.scrollWidth - metadata.clientWidth : 0,
        metadataNaturalWidth: metadata ? [...metadata.children].reduce((width, span) => {
          const range = document.createRange();
          range.selectNodeContents(span);
          return width + range.getBoundingClientRect().width;
        }, (metadata.children.length - 1) * parseFloat(getComputedStyle(metadata).columnGap)) : 0,
        headerGap: parseFloat(getComputedStyle(header).columnGap),
        text: [...(metadata || header).querySelectorAll('.truncate')].map(span => {
          const range = document.createRange();
          range.selectNodeContents(span);
          return {text: span.textContent, width: rect(span).width,
            textWidth: range.getBoundingClientRect().width,
            scroll: span.scrollWidth, client: span.clientWidth};
        }),
        firstTeamTop: header.nextElementSibling.getBoundingClientRect().top,
        contextCount: card.querySelectorAll('[data-scoreboard-context-slot]').length,
        footer: rect(card.querySelector('[data-scoreboard-odds-footer]')),
        tags: [...card.querySelectorAll('[data-watchlist-reason-label], [data-eyebrow-tag]')].map(tag => {
          return {text: tag.textContent, rect: rect(tag), clipped: (${CLIPPED_OBSERVER})(tag)};
        })};
    });
  })()`);
}

const WIDTHS = [
  320, 360, 375, 390, 430, 639, 640, 808, 809, 843, 870, 894, 901, 902, 903, 909, 911, 912, 915,
  920, 929, 1024, 1388, 1389, 1440, 1920,
];

for (const metadata of ['short', 'long'] as const) {
  test(`watchlist ${metadata} metadata stays visible and only a reason header wraps on demand beyond phone width`, async (t) => {
    await withBrowserFixture(
      t,
      { directoryPrefix: 'cfb-watchlist-header-', markup: () => fixtureMarkup(metadata) },
      async (page) => {
        for (const viewport of WIDTHS) {
          await page.setViewport(viewport, 900);
          const rows = await measure(page);
          assert.equal(rows.length, 3, 'the ordinary population contains three cards');
          const reason = rows.find((row) => row.name === 'reason-tag Away at reason-tag Home');
          const tag = rows.find((row) => row.name === 'tag Away at tag Home');
          const untagged = rows.find((row) => row.name === 'untagged Away at untagged Home');
          assert.ok(reason && tag && untagged);
          assert.ok(reason.slot);
          // Use actual glyph widths, not a breakpoint inferred from one host's font stack.
          //
          // The epsilon matters and is not decoration. This predicate feeds a strict
          // `assert.equal` on header height, so it must agree with Chrome's OWN line-packing
          // decision; `WIDTHS` deliberately probes adjacent values (901/902/903, 909-915), which
          // puts the sum within a fraction of a pixel of `header.width` on some font stacks. At
          // exact equality the content still FITS, so the comparison has to be strictly-greater by
          // more than float noise — matching the `+ 0.02` and `< 0.5` tolerances used below.
          const reasonNeedsWrap =
            reason.metadataNaturalWidth + reason.slot.width + reason.headerGap >
            reason.header.width + 0.02;
          assert.deepEqual(
            reason.tags.map((pill) => pill.text),
            ['Game of the Week', 'Top 25 Matchup'],
            'ordinary widest slot is one reason plus one tag'
          );
          assert.deepEqual(
            tag.tags.map((pill) => pill.text),
            ['Top 25 Matchup']
          );
          assert.deepEqual(untagged.tags, []);
          for (const row of rows) {
            const label = `${viewport}px ${row.name}`;
            assert.equal(row.contextCount, 0, `${label}: no context band remains`);
            assert.equal(row.footer.height, 16, `${label}: empty odds footer remains reserved`);
            const hasReason: boolean = row === reason;
            const wrapped: boolean =
              (viewport < 640 && row.tags.length > 0) ||
              (hasReason && viewport >= 640 && reasonNeedsWrap);
            assert.equal(row.text.length, 2, `${label}: both kickoff and broadcast are measured`);
            assert.ok(row.metadataOverflow <= 0, `${label}: metadata wrapper does not overflow`);
            for (const span of row.text) {
              assert.ok(
                span.scroll <= span.client,
                `${label}: ${span.text} has no scroll overflow`
              );
              assert.ok(
                span.textWidth <= span.width + 0.02,
                `${label}: ${span.text} has no subpixel text clipping`
              );
            }
            if (!hasReason && viewport >= 640) {
              assert.equal(
                row.header.height,
                16,
                `${label}: a card without a reason stays on one line`
              );
            }
            assert.equal(
              row.header.height,
              wrapped ? 36 : 16,
              `${label}: only a constrained reason header or the existing phone rule adds a line`
            );
            assert.equal(
              row.card.height,
              wrapped || (viewport >= 809 && reasonNeedsWrap && (row === tag || viewport >= 1389))
                ? 153
                : 133,
              `${label}: card height excludes the old band, with existing grid stretch for peers`
            );
            if (row.tags.length === 0) {
              assert.equal(row.slot, null, `${label}: no empty tag line`);
              continue;
            }
            assert.ok(row.metadata && row.slot, `${label}: tags and metadata share the header`);
            assert.ok(
              Math.abs(row.tags.at(-1)!.rect.right - row.header.right) < 0.5,
              `${label}: last pill pins to the header right edge`
            );
            if (wrapped) {
              if (viewport < 640) {
                assert.equal(
                  row.metadata.width,
                  row.header.width,
                  `${label}: phone metadata keeps the whole line`
                );
                assert.equal(
                  row.slot.width,
                  row.header.width,
                  `${label}: phone tags keep the whole line`
                );
              }
              assert.equal(
                row.slot.top - row.metadata.bottom,
                4,
                `${label}: wrapped tag line follows metadata by 4px`
              );
            } else {
              assert.equal(row.slot.top, row.metadata.top, `${label}: tags sit beside metadata`);
            }
            for (const pill of row.tags) {
              assert.equal(
                pill.clipped,
                0,
                `${label}: ${pill.text} fits every horizontal and vertical clipping ancestor`
              );
              assert.equal(
                pill.rect.height,
                16,
                `${label}: pill inherits the shared slot line height`
              );
            }
          }
          if (viewport >= 809) {
            assert.equal(
              reason.firstTeamTop - reason.card.top - (tag.firstTeamTop - tag.card.top),
              reasonNeedsWrap ? 20 : 0,
              `${viewport}px: only the overflowing reason card pays the accepted 20px team-row offset`
            );
          }
          const columns = await page.evaluate<number>(
            `getComputedStyle(document.querySelector('[data-watchlist-scoreboard-grid]')).gridTemplateColumns.split(' ').length`
          );
          assert.equal(
            columns,
            viewport < 809 ? 1 : viewport < 1389 ? 2 : 3,
            `${viewport}px: Overview's existing grid tiers remain`
          );
          t.diagnostic(JSON.stringify({ viewport, columns, rows }));
        }

        // A reason by itself fits even at the narrowest two-column width.
        // Remove only the category pill, then restore it for the synthetic stress case.
        await page.setViewport(809, 900);
        await page.evaluate(`(() => {
          const pill = document.querySelector('[aria-label="reason-tag Away at reason-tag Home"] [data-eyebrow-tag]');
          window.savedCategoryPill = pill;
          pill.remove();
          return true;
        })()`);
        const reasonOnly = (await measure(page)).find(
          (row) => row.name === 'reason-tag Away at reason-tag Home'
        )!;
        assert.equal(reasonOnly.header.height, 16, 'a fitting reason-only header does not wrap');
        assert.ok(
          reasonOnly.text.every(
            (span) => span.scroll <= span.client && span.textWidth <= span.width + 0.02
          ),
          'reason-only metadata remains wholly visible'
        );
        assert.ok(
          Math.abs(reasonOnly.tags[0].rect.right - reasonOnly.header.right) < 0.5,
          'a reason alone retains its right-pin'
        );
        await page.evaluate(`(() => {
          document.querySelector('[aria-label="reason-tag Away at reason-tag Home"] [data-scoreboard-tag-slot]').append(window.savedCategoryPill);
          delete window.savedCategoryPill;
          return true;
        })()`);

        // Synthetic only: the scheduled Close guard prevents a third ordinary pill.
        await page.setViewport(375, 900);
        await page.evaluate(`(() => {
      const card = document.querySelector('[aria-label="reason-tag Away at reason-tag Home"]');
      card.setAttribute('data-synthetic-three-pill-stress', '');
      const tag = card.querySelector('[data-eyebrow-tag]').cloneNode(true);
      tag.textContent = 'Close';
      card.querySelector('[data-scoreboard-tag-slot]').append(tag);
      return true;
    })()`);
        const synthetic = (await measure(page)).find(
          (row) => row.name === 'reason-tag Away at reason-tag Home'
        )!;
        assert.deepEqual(
          synthetic.tags.map((pill) => pill.text),
          ['Game of the Week', 'Top 25 Matchup', 'Close'],
          'synthetic-only three-pill stress population'
        );
        assert.ok(
          synthetic.tags.every((pill) => pill.clipped === 0),
          'synthetic three-pill slot is visible at 375px'
        );
        t.diagnostic(`SYNTHETIC ONLY: ${JSON.stringify(synthetic)}`);
      }
    );
  });
}

/**
 * THE GATE'S OWN BOUNDARY, which nothing else in this file holds.
 *
 * `OVERVIEW_WATCHLIST_HEADER_CLASSES` scopes the wrap to
 * `:has([data-watchlist-reason-label])`. That `:has()` is what makes #669 a bounded EXCEPTION to
 * DESIGN.md's single-line contract rather than a repeal of it — and removing it left the whole
 * suite green, because the tests above only ever exercise cards that fit on one line anyway. A
 * tags-only card with headroom does not wrap whether the gate is there or not, so it cannot
 * witness the gate.
 *
 * This test builds the card that CAN: tags-only (no reason label) and deliberately wider than the
 * line. Strip the `:has()` and the header wraps to 36px and the first assertion reddens by name.
 *
 * It also records the bound from finding 1 of the `46ef835c` review. The reviewer measured a
 * tags-only card truncating with `CBS Sports Network`, `Big Ten Network` and `Radio · ESPN Radio`
 * — all real-sounding and none of them reachable, because CFBD emits `CBSSN` and `BTN` and no
 * radio label survives the per-game priority on an FBS game. See `LONGEST_RENDERED_OUTLET`. The
 * mechanism was real; only the population was wrong. So both facts are pinned here: at the real
 * bound nothing truncates, and one step beyond it the metadata — not the pills — pays.
 */
test('a tags-only watchlist header never wraps, and the rendered outlet bound is where the measurement says', async (t) => {
  for (const [label, outlet, expectTruncation] of [
    ['at the rendered bound', LONGEST_RENDERED_OUTLET, false],
    ['beyond it, synthetically', SYNTHETIC_OUTLET_BEYOND_BOUND, true],
  ] as const) {
    await withBrowserFixture(
      t,
      {
        directoryPrefix: 'cfb-watchlist-tag-only-',
        markup: () => fixtureMarkup('long', outlet),
      },
      async (page) => {
        let sawTruncation = false;
        for (const viewport of WIDTHS) {
          await page.setViewport(viewport, 900);
          const tagOnly = (await measure(page)).find((row) => row.name === 'tag Away at tag Home')!;
          assert.ok(tagOnly.slot, `${label} ${viewport}px: the tags-only card has a tag slot`);
          assert.deepEqual(
            tagOnly.tags.map((pill) => pill.text),
            ['Top 25 Matchup'],
            `${label} ${viewport}px: exactly one pill and no reason label`
          );

          // THE GATE. Below 640px `max-sm:flex-wrap` on the shared component applies to every
          // tagged card, reason or not, and that is the pre-existing phone exemption rather than
          // #669's. Above it, only a reason header may wrap — so this card must stay one line at
          // every width, even when its metadata cannot fit.
          if (viewport >= 640) {
            assert.equal(
              tagOnly.header.height,
              16,
              `${label} ${viewport}px: a tags-only header stays on one line above phone width`
            );
            assert.equal(
              tagOnly.slot.top,
              tagOnly.metadata!.top,
              `${label} ${viewport}px: its pill sits beside the metadata, not below it`
            );
          }

          // The pills never pay, at either end of the bound: they are `shrink-0` by Item 175 and
          // the metadata absorbs the whole deficit. That asymmetry is the reason the bound matters.
          for (const pill of tagOnly.tags) {
            assert.equal(
              pill.clipped,
              0,
              `${label} ${viewport}px: ${pill.text} is never the thing that gets clipped`
            );
          }

          for (const span of tagOnly.text) {
            if (span.scroll > span.client) sawTruncation = true;
            if (!expectTruncation) {
              assert.ok(
                span.scroll <= span.client,
                `${label} ${viewport}px: ${span.text} is whole at the rendered bound`
              );
            }
          }
          t.diagnostic(JSON.stringify({ label, outlet, viewport, tagOnly }));
        }
        assert.equal(
          sawTruncation,
          expectTruncation,
          expectTruncation
            ? `${label}: an 18-character outlet must still truncate somewhere, or this control proves nothing`
            : `${label}: the real population must not truncate anywhere`
        );
      }
    );
  }
});

/**
 * THE CLIPPING OBSERVER'S OWN POSITIVE CONTROL.
 *
 * `clipped === 0` is asserted at four points above. Every one of them passes if the observer is
 * blind, and the tests cannot tell that apart from a genuinely unclipped pill — the
 * "measurement coverage is part of the result" shape. #879's subgrid work moves the clipping
 * ancestor these assertions depend on, so the observer needs to be shown capable of returning
 * non-zero against this markup, not just trusted to.
 *
 * The poison shrinks the header, which carries `overflow-hidden`, so the pills are cut by a REAL
 * clipping ancestor of the production markup rather than by a synthetic wrapper.
 */
test('the pill-clipping observer rejects its own poisoned control', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-watchlist-observer-', markup: () => fixtureMarkup('long') },
    async (page) => {
      await page.setViewport(1440, 900);
      const report = await page.evaluate<{ before: number[]; after: number[]; overflowX: string }>(
        `(async () => {
          await document.fonts.ready;
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const clippedOf = ${CLIPPED_OBSERVER};
          const card = document.querySelector('[aria-label="reason-tag Away at reason-tag Home"]');
          const header = card.querySelector('[data-scoreboard-header]');
          const pills = () => [...card.querySelectorAll('[data-watchlist-reason-label], [data-eyebrow-tag]')];
          const before = pills().map(clippedOf);
          const overflowX = getComputedStyle(header).overflowX;
          header.style.width = '40px';
          const after = pills().map(clippedOf);
          return { before, after, overflowX };
        })()`
      );
      assert.equal(
        report.overflowX,
        'hidden',
        'the header is a real clipping ancestor, so the poison uses production markup'
      );
      assert.ok(report.before.length >= 2, 'the control needs the two-pill card');
      assert.deepEqual(
        report.before.map((clipped) => clipped <= 0),
        report.before.map(() => true),
        'positive control: every pill is unclipped before the poison'
      );
      assert.ok(
        report.after.every((clipped) => clipped > 0),
        `the observer detects clipping when the header cannot hold the pills (after=${JSON.stringify(report.after)})`
      );
    }
  );
});

/**
 * THE RADIO PATH AT THE TIGHTEST BUDGET — the reachable worst case, which nothing else covers.
 *
 * `formatPrimaryBroadcastLabel` prefixes a radio-only game with `Radio · `, and both
 * `gameCardPresentation.ts:139-144` and `DESIGN.md:219-223` forbid retiring that as unreachable. So
 * the tags-only card's budget has to hold `Radio · ERADM` beside the LONGEST kickoff form, at the
 * narrowest two-column width — and per the measurement above it does so with no margin whatever.
 *
 * `expectNoVisibleTruncation` is the member-visible property and is what this asserts; the raw slack
 * is a diagnostic, because pinning −0.3px as a literal would be asserting one host's font metrics.
 * The structural assertion is the one that survives a font change: the radio label is WIDER than the
 * tv bound, so a future change that re-derives the budget from `LONGEST_RENDERED_OUTLET` alone is
 * measuring the looser of the two paths.
 */
test('the radio-only guard still fits the tags-only card at the narrowest two-column width', async (t) => {
  const naturalByCase = new Map<string, number>();
  for (const [label, outlet, mediaType] of [
    ['tv bound', LONGEST_RENDERED_OUTLET, 'tv'],
    ['radio guard', 'ERADM', 'radio'],
  ] as const) {
    await withBrowserFixture(
      t,
      {
        directoryPrefix: 'cfb-watchlist-radio-',
        // Two-digit days force `Wed, Sep 16 · Time TBD`, the longest kickoff the surface renders.
        markup: () => fixtureMarkup('long', outlet, mediaType, [15, 16, 17]),
      },
      async (page) => {
        await page.setViewport(809, 900);
        const tagOnly = (await measure(page)).find((row) => row.name === 'tag Away at tag Home')!;
        assert.ok(tagOnly.metadata, `${label}: the tags-only card has a metadata span`);
        const rendered = tagOnly.text.map((span) => span.text).join(' | ');
        assert.match(
          rendered,
          /Time TBD/,
          `${label}: the fixture renders the longest kickoff form (got ${rendered})`
        );
        if (mediaType === 'radio') {
          assert.match(
            rendered,
            /Radio · ERADM/,
            `${label}: the radio prefix is what the guard is about (got ${rendered})`
          );
        }
        for (const span of tagOnly.text) {
          assert.ok(
            span.scroll <= span.client,
            `${label} 809px: ${span.text} renders whole — the reachable worst case must not clip`
          );
        }
        naturalByCase.set(label, tagOnly.metadataNaturalWidth);
        t.diagnostic(
          `${label}: box=${tagOnly.metadata.width} natural=${tagOnly.metadataNaturalWidth} rendered=[${rendered}]`
        );
      }
    );
  }
  assert.ok(
    naturalByCase.get('radio guard')! > naturalByCase.get('tv bound')!,
    `the radio guard is the WIDER path, so it is the one that bounds the budget (${JSON.stringify([...naturalByCase])})`
  );
});
