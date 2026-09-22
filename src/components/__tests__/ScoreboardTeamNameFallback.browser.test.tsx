import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import { build as buildBundle } from 'esbuild';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';

import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';
import {
  ScoreboardTeamNameHydrationFixture,
  ScoreboardTeamNameNoJavaScriptFixture,
} from './fixtures/ScoreboardTeamNameHydrationFixture';

type LabelMeasurement = {
  abbreviationAriaHidden: string | null;
  abbreviationHeight: number;
  abbreviationVisibility: string;
  abbreviationWidth: number;
  accessibleText: string;
  boxRight: number;
  boxWidth: number;
  containerRight: number;
  display: string;
  fullAriaHidden: string | null;
  fullVisibility: string;
  fullWidth: number;
  overflowX: string;
  textOverflow: string;
  visibleText: string;
  visibleHeight: number;
  visibleClientWidth: number;
  visibleScrollWidth: number;
  visibleClientHeight: number;
  visibleScrollHeight: number;
  visibleLineWidths: number[];
  visibleVariant: string | null;
  visibleVisibility: string;
  visibleWidth: number;
  whiteSpace: string;
};

type BrowserReport = {
  boxIndependence: {
    abbreviationShown: number;
    fullForced: number;
    probesHidden: number;
  };
  compactByWidth: Array<{
    away: LabelMeasurement;
    home: LabelMeasurement;
    ownerClientWidth: number;
    ownerScrollWidth: number;
    ownerTextOverflow: string;
    ownerVisibleWidth: number;
    ownerWidth: number;
    recordClientWidth: number;
    recordScrollWidth: number;
    recordWidth: number;
    recordVisibleWidth: number;
    suffixWidth: number;
  }>;
  font: { family: string; size: string; weight: string };
  hiddenAfterReveal: LabelMeasurement;
  hiddenBeforeReveal: LabelMeasurement;
  hydrationErrors: string[];
  mismatch: LabelMeasurement;
  mismatchErrors: string[];
  neverWider: LabelMeasurement;
  noJavaScript: LabelMeasurement;
  resizeAfterGrow: LabelMeasurement;
  resizeAfterShrink: LabelMeasurement;
  resizeBefore: LabelMeasurement;
  scheduled: {
    abbreviationHeight: number;
    nameHeight: number;
    ownerClientWidth: number;
    ownerScrollWidth: number;
    ownerTextOverflow: string;
    ownerVisibleWidth: number;
    recordVisibleWidth: number;
    recordWidth: number;
    valueKind: string | null;
  };
  userAgent: string;
};

async function compileFixtureStyles(): Promise<string> {
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const productionStyles = await readFile(from, 'utf8');
  const source = `${productionStyles.replace(
    "@import 'tailwindcss';",
    "@import 'tailwindcss' source(none);"
  )}
    @source '../components/CompactGameScoreboard.tsx';
    @source '../components/ScoreboardTeamName.tsx';
    @source '../components/__tests__/fixtures/ScoreboardTeamNameHydrationFixture.tsx';
    @source '../lib/teamLogos.ts';
  `;
  const result = await postcss([tailwindcss()]).process(source, { from });
  return result.css;
}

async function compileFixtureScript(): Promise<string> {
  const entry = fileURLToPath(
    new URL('./fixtures/ScoreboardTeamNameHydrationFixture.tsx', import.meta.url)
  );
  const result = await buildBundle({
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    entryPoints: [entry],
    format: 'iife',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [
      {
        name: 'scoreboard-next-image-stub',
        setup(build) {
          build.onResolve({ filter: /^next\/image$/ }, () => ({
            namespace: 'scoreboard-image-stub',
            path: 'next/image',
          }));
          build.onLoad({ filter: /.*/, namespace: 'scoreboard-image-stub' }, () => ({
            contents: 'export default function Image() { return null; }',
            loader: 'js',
          }));
        },
      },
    ],
    target: 'chrome120',
    write: false,
  });
  const script = result.outputFiles[0]?.text;
  if (!script) throw new Error('scoreboard hydration fixture did not bundle');
  return script.replaceAll('</script', '<\\/script');
}

async function fixtureMarkup(): Promise<string> {
  const [styles, script] = await Promise.all([compileFixtureStyles(), compileFixtureScript()]);
  const hydrated = renderToString(<ScoreboardTeamNameHydrationFixture />);
  const noJavaScript = renderToStaticMarkup(<ScoreboardTeamNameNoJavaScriptFixture />);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body><div data-hydration-root>${hydrated}</div><div data-no-js-root>${noJavaScript}</div><div data-mismatch-root><span>deliberate hydration mismatch</span></div><script>window.process={env:{NODE_ENV:'test'}};window.__scoreboardPageErrors=[];window.addEventListener('error',function(event){window.__scoreboardPageErrors.push(String(event.error||event.message));});window.addEventListener('unhandledrejection',function(event){window.__scoreboardPageErrors.push(String(event.reason));});</script><script>${script}</script></body></html>`;
}

async function collectReport(page: BrowserFixturePage): Promise<BrowserReport> {
  return page.evaluate<BrowserReport>(`
    (async () => {
      await document.fonts.ready;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (document.documentElement.dataset.scoreboardHydrated === 'true') break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (document.documentElement.dataset.scoreboardHydrated !== 'true') {
        return {
          hydrationReady: false,
          pageErrors: window.__scoreboardPageErrors ?? [],
        };
      }
      const settle = () => new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      await settle();

      const round = (value) => Math.round(value * 1000) / 1000;
      const measure = (marker) => {
        const label = document.querySelector('[data-scoreboard-team-label="' + marker + '"]');
        const full = label?.querySelector('[data-scoreboard-team-full="' + marker + '"]');
        const abbreviation = label?.querySelector(
          '[data-scoreboard-team-abbreviation="' + marker + '"]'
        );
        const accessible = label?.querySelector(
          '[data-scoreboard-team-accessible="' + marker + '"]'
        );
        const visible = label?.querySelector('[data-scoreboard-team-visible="' + marker + '"]');
        if (
          !(label instanceof HTMLElement) ||
          !(full instanceof HTMLElement) ||
          !(abbreviation instanceof HTMLElement) ||
          !(accessible instanceof HTMLElement) ||
          !(visible instanceof HTMLElement)
        ) {
          throw new Error(marker + ' fallback label did not render');
        }
        const display = label.dataset.scoreboardTeamDisplay;
        const style = getComputedStyle(label);
        const visibleTextRange = document.createRange();
        visibleTextRange.selectNodeContents(visible);
        return {
          abbreviationAriaHidden: abbreviation.getAttribute('aria-hidden'),
          abbreviationHeight: round(abbreviation.getBoundingClientRect().height),
          abbreviationVisibility: getComputedStyle(abbreviation).visibility,
          abbreviationWidth: round(abbreviation.getBoundingClientRect().width),
          accessibleText: accessible.textContent ?? '',
          boxRight: round(label.getBoundingClientRect().right),
          boxWidth: round(label.getBoundingClientRect().width),
          containerRight: round(label.parentElement?.getBoundingClientRect().right ?? 0),
          display: display ?? '',
          fullAriaHidden: full.getAttribute('aria-hidden'),
          fullVisibility: getComputedStyle(full).visibility,
          fullWidth: round(full.getBoundingClientRect().width),
          overflowX: style.overflowX,
          textOverflow: style.textOverflow,
          visibleText: visible.textContent ?? '',
          visibleHeight: round(visible.getBoundingClientRect().height),
          visibleClientWidth: visible.clientWidth,
          visibleScrollWidth: visible.scrollWidth,
          visibleClientHeight: visible.clientHeight,
          visibleScrollHeight: visible.scrollHeight,
          visibleLineWidths: Array.from(visibleTextRange.getClientRects(), (rect) => round(rect.width)),
          visibleVariant: visible.dataset.scoreboardTeamVisual ?? null,
          visibleVisibility: getComputedStyle(visible).visibility,
          visibleWidth: round(visible.getBoundingClientRect().width),
          whiteSpace: getComputedStyle(visible).whiteSpace,
        };
      };

      const compactContainer = document.querySelector('[data-compact-case]');
      if (!(compactContainer instanceof HTMLElement)) throw new Error('compact case missing');
      const compactByWidth = [];
      for (const width of [430, 390, 320, 240]) {
        compactContainer.style.width = width + 'px';
        await settle();
        const suffix = compactContainer.querySelector('[data-scoreboard-suffix="away"]');
        const record = compactContainer.querySelector('[data-scoreboard-record="away"]');
        const owner = compactContainer.querySelector('[data-scoreboard-owner="away"]');
        if (!(suffix instanceof HTMLElement) || !(record instanceof HTMLElement) ||
            !(owner instanceof HTMLElement)) {
          throw new Error('compact suffix control did not render');
        }
        const suffixRect = suffix.getBoundingClientRect();
        const visibleWidth = (element) => {
          const rect = element.getBoundingClientRect();
          return round(Math.max(0,
            Math.min(rect.right, suffixRect.right) - Math.max(rect.left, suffixRect.left)
          ));
        };
        compactByWidth.push({
          away: measure('away'),
          home: measure('home'),
          ownerClientWidth: owner.clientWidth,
          ownerScrollWidth: owner.scrollWidth,
          ownerTextOverflow: getComputedStyle(owner).textOverflow,
          ownerVisibleWidth: visibleWidth(owner),
          ownerWidth: round(owner.getBoundingClientRect().width),
          recordClientWidth: record.clientWidth,
          recordScrollWidth: record.scrollWidth,
          recordWidth: round(record.getBoundingClientRect().width),
          recordVisibleWidth: visibleWidth(record),
          suffixWidth: round(suffixRect.width),
        });
      }

      // At the same row width, change only the text in the in-flow visual and
      // then suppress both out-of-flow probes. None may resize the allocated box.
      compactContainer.style.width = '390px';
      await settle();
      const box = compactContainer.querySelector('[data-scoreboard-team-label="away"]');
      const visual = box?.querySelector('[data-scoreboard-team-visible="away"]');
      const fullProbe = box?.querySelector('[data-scoreboard-team-full="away"]');
      const abbreviationProbe = box?.querySelector('[data-scoreboard-team-abbreviation="away"]');
      if (!(box instanceof HTMLElement) || !(visual instanceof HTMLElement) ||
          !(fullProbe instanceof HTMLElement) || !(abbreviationProbe instanceof HTMLElement)) {
        throw new Error('name-box independence control did not render');
      }
      const abbreviationShown = round(box.getBoundingClientRect().width);
      visual.textContent = 'Southeast Missouri State';
      const fullForced = round(box.getBoundingClientRect().width);
      fullProbe.style.display = 'none';
      abbreviationProbe.style.display = 'none';
      const probesHidden = round(box.getBoundingClientRect().width);
      fullProbe.style.display = '';
      abbreviationProbe.style.display = '';
      visual.textContent = 'SEMO';

      const hiddenContainer = document.querySelector('[data-hidden-case]');
      if (!(hiddenContainer instanceof HTMLElement)) throw new Error('hidden recap control missing');
      const hiddenBeforeReveal = measure('hidden-recap');
      hiddenContainer.hidden = false;
      await settle();
      const hiddenAfterReveal = measure('hidden-recap');

      const resizeContainer = document.querySelector('[data-resize-case]');
      if (!(resizeContainer instanceof HTMLElement)) throw new Error('resize case missing');
      const resizeBefore = measure('resize');
      resizeContainer.style.width = resizeBefore.fullWidth + 1 + 'px';
      await settle();
      const resizeAfterGrow = measure('resize');
      resizeContainer.style.width =
        (resizeBefore.fullWidth + resizeBefore.abbreviationWidth) / 2 + 'px';
      await settle();
      const resizeAfterShrink = measure('resize');

      // Temporarily remove the name floor only in this control. This forces a real
      // rendered box narrower than both names so the measured never-wider branch,
      // rather than the ordinary fit branch, decides Berry versus BERR.
      const neverWiderBox = document.querySelector('[data-scoreboard-team-label="never-wider"]');
      if (!(neverWiderBox instanceof HTMLElement)) throw new Error('never-wider control missing');
      neverWiderBox.style.minWidth = '0px';
      await settle();
      const neverWider = measure('never-wider');

      const scheduled = document.querySelector('[data-scheduled-case]');
      const scheduledRow = scheduled?.querySelector('[data-scoreboard-side="away"]');
      const scheduledName = scheduledRow?.querySelector('[data-scoreboard-team-visible="away"]');
      const scheduledAbbreviation = scheduledRow?.querySelector(
        '[data-scoreboard-team-abbreviation="away"]'
      );
      const scheduledOwner = scheduledRow?.querySelector('[data-scoreboard-owner="away"]');
      const scheduledRecord = scheduledRow?.querySelector('[data-scoreboard-value="away"]');
      if (!(scheduledRow instanceof HTMLElement) || !(scheduledName instanceof HTMLElement) ||
          !(scheduledAbbreviation instanceof HTMLElement) ||
          !(scheduledOwner instanceof HTMLElement) || !(scheduledRecord instanceof HTMLElement)) {
        throw new Error('scheduled scoreboard control did not render');
      }
      const scheduledRowRect = scheduledRow.getBoundingClientRect();
      const scheduledOwnerRect = scheduledOwner.getBoundingClientRect();
      const scheduledRecordRect = scheduledRecord.getBoundingClientRect();
      const scheduledMeasurement = {
        abbreviationHeight: round(scheduledAbbreviation.getBoundingClientRect().height),
        nameHeight: round(scheduledName.getBoundingClientRect().height),
        ownerClientWidth: scheduledOwner.clientWidth,
        ownerScrollWidth: scheduledOwner.scrollWidth,
        ownerTextOverflow: getComputedStyle(scheduledOwner).textOverflow,
        ownerVisibleWidth: round(Math.max(0, Math.min(scheduledOwnerRect.right,
          scheduledRowRect.right) - Math.max(scheduledOwnerRect.left, scheduledRowRect.left))),
        recordVisibleWidth: round(Math.max(0, Math.min(scheduledRecordRect.right,
          scheduledRowRect.right) - Math.max(scheduledRecordRect.left, scheduledRowRect.left))),
        recordWidth: round(scheduledRecordRect.width),
        valueKind: scheduledRecord.dataset.scoreboardValueKind ?? null,
      };

      const fontTarget = document.querySelector('[data-scoreboard-team-label="away"]');
      if (!(fontTarget instanceof HTMLElement)) throw new Error('font target missing');
      const fontStyle = getComputedStyle(fontTarget);
      return {
        boxIndependence: { abbreviationShown, fullForced, probesHidden },
        compactByWidth,
        font: {
          family: fontStyle.fontFamily,
          size: fontStyle.fontSize,
          weight: fontStyle.fontWeight,
        },
        hydrationErrors: window.__scoreboardHydrationErrors ?? [],
        hiddenAfterReveal,
        hiddenBeforeReveal,
        mismatch: measure('mismatch'),
        mismatchErrors: window.__scoreboardMismatchErrors ?? [],
        neverWider,
        noJavaScript: measure('no-js'),
        resizeAfterGrow,
        resizeAfterShrink,
        resizeBefore,
        scheduled: scheduledMeasurement,
        userAgent: navigator.userAgent,
      };
    })()
  `);
}

type NameScoreEdges = {
  cardWidth: number;
  nameRight: number;
  scoreLeft: number;
  viewport: number;
};

async function measureNameScoreEdges(
  page: BrowserFixturePage,
  scope: 'data-compact-case' | 'data-overlap-viewport'
): Promise<NameScoreEdges> {
  return page.evaluate<NameScoreEdges>(`
    (async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const card = document.querySelector('[${scope}] [data-game-scoreboard]');
      const row = card?.querySelector('[data-scoreboard-side="away"]');
      const name = row?.querySelector('[data-scoreboard-team-label="away"]');
      const score = row?.querySelector('[data-scoreboard-value="away"]');
      if (!(card instanceof HTMLElement) || !(name instanceof HTMLElement) ||
          !(score instanceof HTMLElement)) {
        throw new Error('name–score overlap control did not render');
      }
      return {
        cardWidth: card.getBoundingClientRect().width,
        nameRight: name.getBoundingClientRect().right,
        scoreLeft: score.getBoundingClientRect().left,
        viewport: window.innerWidth,
      };
    })()
  `);
}

test('the hydrated name box never overlaps the score at the reviewed widths', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-scoreboard-name-score-overlap-', markup: fixtureMarkup },
    async (page) => {
      const report = await collectReport(page);
      assert.deepEqual(report.hydrationErrors, []);
      const at390Card = await measureNameScoreEdges(page, 'data-compact-case');
      assert.equal(at390Card.cardWidth, 390);

      await page.setViewport(272, 800);
      const at272Viewport = await measureNameScoreEdges(page, 'data-overlap-viewport');
      assert.equal(at272Viewport.viewport, 272);
      assert.equal(at272Viewport.cardWidth, 240);

      await page.setViewport(219, 800);
      const at219Viewport = await measureNameScoreEdges(page, 'data-overlap-viewport');
      assert.equal(at219Viewport.viewport, 219);
      assert.equal(at219Viewport.cardWidth, 187);

      for (const [width, edges] of [
        ['390px card', at390Card],
        ['272px viewport', at272Viewport],
        ['219px viewport', at219Viewport],
      ] as const) {
        t.diagnostic(`${width}: name right ${edges.nameRight}px, score left ${edges.scoreLeft}px`);
        // Settles the round-5 reported name–score overlap: a box entering the
        // score's reserved area must make this behavioral assertion fail.
        assert.ok(edges.nameRight <= edges.scoreLeft, `${width}: name box overlaps score`);
      }
    }
  );
});

test('the full owner outranks the full team name in their measured fit band', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-scoreboard-owner-priority-', markup: fixtureMarkup },
    async (page) => {
      const report = await collectReport(page);
      const at390 = report.compactByWidth[1];
      assert.ok(at390);
      t.diagnostic(`390px owner-priority band: ${JSON.stringify(at390)}`);
      assert.equal(
        at390.ownerScrollWidth,
        at390.ownerClientWidth,
        'the owner must stay whole when the full team name alone cannot fit'
      );
      assert.ok(
        at390.ownerVisibleWidth >= at390.ownerWidth - 0.5,
        'the full owner must remain visible before the full team name is considered'
      );
      assert.ok(
        at390.away.fullWidth > at390.away.boxWidth,
        'the full team name must not fit beside the full record and owner'
      );
      assert.ok(at390.away.abbreviationWidth <= at390.away.boxWidth);
      assert.ok(at390.recordVisibleWidth >= at390.recordWidth - 0.5);
      assert.equal(at390.away.display, 'abbreviation');
      assert.equal(at390.away.visibleText, 'SEMO');
    }
  );
});

test('272px viewport equivalent keeps SEMO on one line and gives owner the squeeze', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-scoreboard-name-single-line-', markup: fixtureMarkup },
    async (page) => {
      const report = await collectReport(page);
      const at240Card = report.compactByWidth[3];
      assert.ok(at240Card);
      t.diagnostic(`240px card at a 272px padded viewport: ${JSON.stringify(at240Card)}`);
      assert.equal(at240Card.away.display, 'abbreviation');
      assert.equal(
        at240Card.away.visibleHeight,
        at240Card.away.abbreviationHeight,
        'the visible SEMO must occupy one line, not four stacked letters'
      );
      assert.ok(at240Card.away.visibleScrollWidth <= at240Card.away.visibleClientWidth);
      assert.ok(at240Card.ownerVisibleWidth > 0, 'owner must remain present');
      assert.ok(
        at240Card.ownerScrollWidth > at240Card.ownerClientWidth,
        'owner must yield by truncating before the abbreviation or record does'
      );
      assert.equal(at240Card.ownerTextOverflow, 'ellipsis');
      assert.ok(
        at240Card.recordVisibleWidth >= at240Card.recordWidth - 0.5,
        'record must remain whole'
      );
      assert.ok(at240Card.recordScrollWidth <= at240Card.recordClientWidth);
      t.diagnostic(`scheduled control: ${JSON.stringify(report.scheduled)}`);
      assert.equal(report.scheduled.nameHeight, report.scheduled.abbreviationHeight);
      assert.ok(report.scheduled.ownerVisibleWidth > 0);
      assert.ok(report.scheduled.ownerScrollWidth > report.scheduled.ownerClientWidth);
      assert.equal(report.scheduled.ownerTextOverflow, 'ellipsis');
      assert.equal(report.scheduled.valueKind, 'record');
      assert.equal(report.scheduled.recordVisibleWidth, report.scheduled.recordWidth);
    }
  );
});

test('SSR and no-JS keep a single untruncated abbreviation', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-scoreboard-name-no-js-', markup: fixtureMarkup },
    async (page) => {
      const report = await collectReport(page);
      const boot = report as BrowserReport & {
        hydrationReady?: boolean;
        pageErrors?: string[];
      };
      assert.equal(boot.hydrationReady, undefined, JSON.stringify(boot.pageErrors ?? []));
      const { noJavaScript } = report;
      assert.equal(noJavaScript.display, 'abbreviation');
      assert.equal(noJavaScript.visibleText, 'SEMO');
      assert.equal(noJavaScript.visibleVariant, 'abbreviation');
      assert.equal(noJavaScript.visibleVisibility, 'visible');
      assert.equal(noJavaScript.accessibleText, 'Southeast Missouri State');
      assert.equal(noJavaScript.fullAriaHidden, 'true');
      assert.equal(noJavaScript.abbreviationAriaHidden, 'true');
      assert.ok(noJavaScript.fullWidth > noJavaScript.boxWidth);
      assert.ok(noJavaScript.abbreviationWidth <= noJavaScript.boxWidth);
      assert.equal(
        noJavaScript.overflowX,
        'hidden',
        'the no-JS box must contain text overflow rather than emit page overflow'
      );
      assert.equal(noJavaScript.whiteSpace, 'nowrap', 'the no-JS abbreviation stays on one line');
      assert.equal(noJavaScript.visibleHeight, noJavaScript.abbreviationHeight);
      assert.ok(noJavaScript.visibleWidth <= noJavaScript.boxWidth);
      assert.ok(noJavaScript.boxRight <= noJavaScript.containerRight);
      assert.equal(
        noJavaScript.textOverflow,
        'clip',
        'the name box must not manufacture an ellipsis'
      );
    }
  );
});

test('fit, overflow, never-wider, and resize decisions use the rendered name box', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-scoreboard-name-measurement-', markup: fixtureMarkup },
    async (page) => {
      const report = await collectReport(page);
      const boot = report as BrowserReport & {
        hydrationReady?: boolean;
        pageErrors?: string[];
      };
      assert.equal(boot.hydrationReady, undefined, JSON.stringify(boot.pageErrors ?? []));
      assert.deepEqual(report.hydrationErrors, [], 'matching SSR must hydrate without recovery');
      assert.equal(
        report.boxIndependence.abbreviationShown,
        report.boxIndependence.fullForced,
        'the row-allocated name box must not grow when its visual text changes to the full name'
      );
      assert.equal(
        report.boxIndependence.abbreviationShown,
        report.boxIndependence.probesHidden,
        'the measurement probes must not contribute to the name-box width'
      );
      assert.equal(report.hiddenBeforeReveal.boxWidth, 0);
      assert.equal(report.hiddenBeforeReveal.fullWidth, 0);
      assert.equal(
        report.hiddenBeforeReveal.display,
        'abbreviation',
        'a hidden recap label must not upgrade on zero-width measurements'
      );
      assert.equal(
        report.hiddenAfterReveal.display,
        'full',
        'a recap label upgrades only after its full name fits a laid-out box'
      );
      assert.ok(report.hiddenAfterReveal.fullWidth <= report.hiddenAfterReveal.boxWidth);

      assert.equal(
        report.resizeBefore.display,
        'abbreviation',
        'a full name wider than its own box must remain abbreviated before resize'
      );
      assert.ok(report.resizeBefore.fullWidth > report.resizeBefore.boxWidth);
      assert.equal(
        report.resizeAfterGrow.display,
        'full',
        'the shared ResizeObserver must upgrade after the same name box grows'
      );
      assert.ok(report.resizeAfterGrow.fullWidth <= report.resizeAfterGrow.boxWidth);
      assert.equal(
        report.resizeAfterShrink.display,
        'abbreviation',
        'the shared ResizeObserver must restore the safe abbreviation after the box shrinks'
      );
      assert.ok(report.resizeAfterShrink.fullWidth > report.resizeAfterShrink.boxWidth);

      const fitting = report.compactByWidth[0]?.away;
      assert.ok(fitting);
      assert.ok(
        fitting.fullWidth <= fitting.boxWidth,
        'the 430px control must prove the full name fits its row-allocated box'
      );
      assert.equal(
        fitting.display,
        'full',
        'a fitting full name must upgrade instead of staying abbreviated'
      );

      const nonFitting = report.compactByWidth
        .map(({ away }) => away)
        .filter(
          ({ abbreviationWidth, boxWidth, fullWidth }) =>
            fullWidth > boxWidth && abbreviationWidth < fullWidth
        );
      assert.ok(nonFitting.length >= 2, 'the width sweep must contain multiple genuine overflows');
      for (const measurement of nonFitting) {
        assert.equal(
          measurement.display,
          'abbreviation',
          'every swept tier whose full name does not fit must render the narrower abbreviation'
        );
        assert.equal(measurement.visibleText, 'SEMO');
      }
      const mixed = report.compactByWidth[3];
      assert.ok(mixed);
      assert.equal(mixed.away.display, 'abbreviation');
      assert.ok(mixed.suffixWidth > 0, 'the 240px suffix container must retain rendered width');
      assert.ok(
        mixed.recordVisibleWidth > 0,
        'the 240px record must retain visible width after abbreviation'
      );
      assert.ok(
        mixed.ownerVisibleWidth > 0,
        'the 240px owner must retain visible width after abbreviation'
      );
      assert.ok(
        mixed.away.visibleScrollWidth <= mixed.away.visibleClientWidth,
        'the visible 240px abbreviation must not be clipped horizontally'
      );
      assert.ok(
        mixed.away.visibleScrollHeight <= mixed.away.visibleClientHeight,
        'the visible 240px abbreviation must not be clipped vertically'
      );
      assert.equal(
        mixed.home.display,
        'full',
        'the opposing fitting label must stay full when only one side overflows'
      );
      assert.ok(mixed.home.fullWidth <= mixed.home.boxWidth);

      assert.ok(report.neverWider.fullWidth > report.neverWider.boxWidth);
      assert.ok(
        report.neverWider.abbreviationWidth >= report.neverWider.fullWidth,
        'the current viewer must actually render BERR at least as wide as Berry'
      );
      assert.equal(
        report.neverWider.display,
        'full',
        'a measured abbreviation that is not narrower must never replace the full name'
      );
      assert.equal(report.neverWider.visibleText, 'Berry');

      assert.ok(
        report.mismatchErrors.length > 0,
        'a real hydration mismatch must not be suppressed'
      );
      assert.equal(
        report.mismatch.display,
        'abbreviation',
        'React recovery must regenerate from the conservative client state'
      );
      assert.equal(report.mismatch.visibleText, 'SEMO');

      for (const measurement of [
        ...report.compactByWidth.map(({ away }) => away),
        report.hiddenAfterReveal,
        report.resizeBefore,
        report.resizeAfterGrow,
        report.resizeAfterShrink,
      ]) {
        assert.equal(measurement.accessibleText, 'Southeast Missouri State');
        assert.equal(measurement.fullAriaHidden, 'true');
        assert.equal(measurement.abbreviationAriaHidden, 'true');
        assert.equal(measurement.visibleVariant, measurement.display);
        assert.equal(measurement.visibleVisibility, 'visible');
        assert.equal(measurement.fullVisibility, 'hidden');
        assert.equal(measurement.abbreviationVisibility, 'hidden');
      }
      for (const { home } of report.compactByWidth) {
        assert.equal(home.accessibleText, 'Ohio State');
        assert.equal(home.fullAriaHidden, 'true');
        assert.equal(home.abbreviationAriaHidden, 'true');
      }
      assert.equal(report.neverWider.accessibleText, 'Berry');
      assert.equal(report.neverWider.fullAriaHidden, 'true');
      assert.equal(report.neverWider.abbreviationAriaHidden, 'true');

      t.diagnostic(
        `Measured in ${report.userAgent}; ${report.font.family}, ${report.font.size}, weight ${report.font.weight}`
      );
      t.diagnostic(
        report.compactByWidth
          .map(
            ({ away, home }, index) =>
              `${[430, 390, 320, 240][index]}px: away ${away.display}, full ${away.fullWidth}px / box ${away.boxWidth}px / abbreviation ${away.abbreviationWidth}px; home ${home.display}`
          )
          .join('; ')
      );
      t.diagnostic(`240px visible span: ${JSON.stringify(report.compactByWidth[3]?.away)}`);
    }
  );
});
