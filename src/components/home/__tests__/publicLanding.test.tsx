import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import PublicLanding from '../PublicLanding.tsx';
import { renderDeep } from '../../../test/renderTree.ts';

// ---------------------------------------------------------------------------
// POLISH-004 — the landing's stadium presentation.
//
// Presentation-only, so these assert SEMANTIC and STRUCTURAL properties rather
// than appearance: what is the heading, what is real text, what is decoration,
// and what the page must never quietly become again. No snapshot — a snapshot
// would fail on every spacing tweak while proving none of this.
//
// PLATFORM-088's behavioural guarantees (server component, no league data,
// server-decided exit) are covered in `src/app/__tests__/homeView.test.tsx` and
// deliberately not duplicated here.
// ---------------------------------------------------------------------------

type El = { type?: unknown; props?: Record<string, unknown> };

function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const el = node as El;
  visit(el);
  walk(el.props?.children, visit);
}

/** String CHILDREN only — no attribute values. */
function textContent(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) textContent(child, out);
    return out;
  }
  if (node && typeof node === 'object') textContent((node as El).props?.children, out);
  return out;
}

function hostElements(node: unknown): El[] {
  const found: El[] = [];
  walk(node, (el) => {
    if (typeof el.type === 'string') found.push(el);
  });
  return found;
}

function firstOfType(node: unknown, type: string): El | null {
  return hostElements(node).find((el) => el.type === type) ?? null;
}

// Text CHILDREN only. An earlier helper here also gathered string-valued PROPS,
// which is why `viewBox` once counted as SVG text — and it would now splice class
// names between the headline's two sentences, since they are separate spans.
/**
 * The VISIBLE wordmark, concatenated with no separator.
 *
 * It is split into two nodes so the `f` → `W` pair can take a hair of optical
 * margin. Joining with a space would report `Turf War` and hide the very thing
 * worth checking — that the brand is still spelled as one word.
 */
function visibleWordmark(tree: unknown): string {
  const hidden = hostElements(renderDeep(tree)).filter(
    (el) => el.props?.['aria-hidden'] === 'true'
  );
  return hidden.map((el) => textContent(el.props?.children).join('')).join('');
}

const landingText = (isSignedIn = false) =>
  textContent(renderDeep(PublicLanding({ isSignedIn }))).join(' ');

/**
 * Source with comments stripped. Every scan here reads CODE, not prose about the
 * code: these files DISCUSS the things being scanned for by name in their header
 * docs, and a naive match hits the explanation. That false positive has already
 * bitten this campaign three times.
 */
function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * EVERY file that renders part of the landing. Scanning only `PublicLanding.tsx`
 * left the two files that actually own the decoration and the sign-out control
 * unguarded — and `SignOutControl.tsx` was changed in this very slice precisely
 * because it carried a light/dark pair that rendered near-black on black.
 */
const LANDING_SOURCES = [
  'src/components/home/PublicLanding.tsx',
  'src/components/home/SignOutControl.tsx',
] as const;

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

test('the hero copy is exactly what was approved', () => {
  const text = landingText();

  assert.equal(
    visibleWordmark(PublicLanding()),
    'TurfWar',
    'the visible wordmark is the one-word treatment'
  );
  assert.match(text, /College football pools/i);
  assert.match(text, /Draft college football teams\. Compete all season\./);
  assert.match(
    text,
    /Draft your teams, go head-to-head each week, and follow live scores, standings, and league\s+history in one place\./
  );
  assert.match(text, /Already in a league\?/);
  assert.match(text, /Open the link\s+your commissioner shared with you to go straight to it\./);
});

// REGRESSION TEST — the PRODUCT STATEMENT is the page heading, not the wordmark.
// A wordmark is branding; it does not describe what the page is, and making it
// the `<h1>` leaves the page's actual subject unannounced.
test('the product statement is the h1', () => {
  const h1 = firstOfType(renderDeep(PublicLanding()), 'h1');
  assert.ok(h1, 'the landing has a level-one heading');
  assert.match(
    textContent(h1.props?.children).join(' '),
    /Draft college football teams\. Compete all season\./
  );

  // And the wordmark is NOT a heading — it must not compete for that role.
  const headings = hostElements(renderDeep(PublicLanding())).filter(
    (el) => typeof el.type === 'string' && /^h[1-6]$/.test(el.type)
  );
  assert.equal(headings.length, 1, 'exactly one heading on the page');
});

// REGRESSION TEST — the visible mark is stylised; the accessible name is real.
// A screen reader announcing "TurfWar" as one token is worse than the product
// name, and the fix is a hidden label rather than renaming anything.
test('the accessible wordmark is the spaced product name', () => {
  const tree = renderDeep(PublicLanding());
  // Deliberately NOT asserted against the whole page's text: the visible mark is
  // two nodes now, so a page-wide `/Turf War/` match would be satisfied by the
  // VISIBLE split and would pass even with the `sr-only` label deleted. The
  // discriminating assertion is the one on the `sr-only` element below.
  assert.equal(visibleWordmark(tree), 'TurfWar', 'the stylised form is hidden from assistive tech');

  const srOnly = hostElements(tree).filter(
    (el) => typeof el.props?.className === 'string' && el.props.className.includes('sr-only')
  );
  assert.ok(
    srOnly.some((el) => textContent(el.props?.children).includes('Turf War')),
    'and the spaced form is what gets announced'
  );
});

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------

test('the decorative scene layer renders, and is inert', () => {
  const tree = PublicLanding();

  // POSITIVE CONTROL FIRST — AGENTS.md: "a negative assertion requires a proven
  // observer". Inherited from the SVG-text test that the strip removal deleted;
  // the observers still do negative work below, so their proof moves rather than
  // vanishing with the element it used to describe.
  const withText = {
    type: 'div',
    props: { children: [{ type: 'span', props: { children: 'leak' } }] },
  };
  assert.equal(hostElements(withText).length, 2, 'the element observer descends');
  assert.deepEqual(textContent(withText), ['leak'], 'and the text observer finds content');

  const scene = hostElements(tree).filter(
    (el) => typeof el.props?.className === 'string' && el.props.className.includes('landing-scene')
  );
  assert.equal(scene.length, 1, 'exactly one scene layer');
  assert.equal(scene[0]!.props?.['aria-hidden'], 'true', 'hidden from assistive tech');
  assert.deepEqual(textContent(scene[0]), [], 'and carrying no text');
});

// REGRESSION TEST — the wordmark stands ALONE.
//
// A miniature perspective-field strip sat under it until the stadium plate took
// over the football identity: two fields competed, and at this scale the small one
// read as a green platform rather than a mark. Nothing decorative replaced it, and
// nothing should drift back in.
test('no decorative artwork sits under the wordmark', () => {
  const svgs = hostElements(renderDeep(PublicLanding())).filter((el) => el.type === 'svg');
  assert.equal(svgs.length, 0, 'the hero carries no inline SVG at all');

  const css = codeOf('src/styles/publicLanding.css');
  assert.ok(!/--landing-turf/.test(css), 'the turf token went with its only consumer');
  assert.ok(!/#2f8f4e/i.test(css), 'and no stray literal of it survives');
});

test('the scene is a LOCAL CSS background, never a DOM element', () => {
  const types = hostElements(renderDeep(PublicLanding())).map((el) => el.type);
  for (const banned of ['img', 'canvas', 'video', 'picture', 'iframe']) {
    assert.ok(!types.includes(banned), `no <${banned}> on the landing`);
  }

  // A decorative raster IS now permitted (DESIGN.md, "Decorative raster
  // backgrounds") — but only as a background, never as content. The contract
  // inverted rather than disappeared: no DOM element for the scene, and the asset
  // must be local.
  for (const rel of LANDING_SOURCES) {
    const code = codeOf(rel);
    assert.ok(!/next\/image/.test(code), `no next/image in ${rel}`);
    assert.ok(!/<(img|canvas|video|picture|iframe)\b/.test(code), `no raster element in ${rel}`);
  }

  const css = codeOf('src/styles/publicLanding.css');
  assert.match(css, /image-set\(/, 'the plate is referenced through CSS');
  assert.match(css, /url\('\/landing\/stadium-\d+\.avif'\)/, 'AVIF primary, local path');
  assert.match(css, /url\('\/landing\/stadium-\d+\.webp'\)/, 'WebP fallback, local path');
  assert.ok(
    !/url\(["']?https?:/.test(css),
    'and never a remote asset — the plate ships with the app'
  );

  // The referenced files must actually exist, or the page renders a blank scene
  // and every assertion above still passes.
  for (const ext of ['avif', 'webp']) {
    const [, name] = css.match(new RegExp(`url\\('(/landing/stadium-\\d+\\.${ext})'\\)`)) ?? [];
    assert.ok(name, `a ${ext} reference exists`);
    assert.ok(existsSync(join(process.cwd(), 'public', name)), `${name} is present in public/`);
  }
});

// ---------------------------------------------------------------------------
// Always dark
// ---------------------------------------------------------------------------

// REGRESSION TEST — the landing is a fixed dark composition, NOT theme-aware.
// It previously split white/dark on the OS preference; a stadium rendered on
// white is not a lighter version of this page, it is a broken one.
test('the landing does not follow the OS colour scheme', () => {
  for (const rel of LANDING_SOURCES) {
    const code = codeOf(rel);
    assert.ok(!/\bdark:/.test(code), `no dark: variants in ${rel} — there is only one theme here`);
    assert.ok(!/\bbg-white\b/.test(code), `and no light background in ${rel}`);
    assert.ok(
      !/\btext-gray-[0-9]/.test(code),
      `and no light-theme text token in ${rel} — those render near-black on black`
    );
  }

  // Comments stripped: the stylesheet's own header explains that it contains no
  // `prefers-color-scheme` block, so a naive scan matches the explanation rather
  // than a rule. Same false positive as the label audit and the auth scan — a
  // source check must read CODE, not prose about the code.
  const css = readFileSync(join(process.cwd(), 'src/styles/publicLanding.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );
  assert.ok(
    !/prefers-color-scheme/.test(css),
    'the stylesheet must not reintroduce a theme split either'
  );
  assert.match(css, /background-color:\s*#000000/, 'the root is black');
  // POSITIVE CONTROL — the stripper leaves rules intact, so the absence above is
  // discrimination rather than an emptied string.
  assert.match(css, /\.landing-scene\s*\{/, 'real declarations survive the strip');
});

// The turf green is LANDING-SCOPED. It lives on this page's root element and is
// not promoted to a global token — DESIGN.md records the exception, and this
// keeps the exception honest.
// REGRESSION TEST — the brand is ONE WORD, and the optical fix must not become an
// orthographic one.
//
// `War` is a separate node purely so the `f` → `W` pair can take a small left
// margin. A space character, or JSX whitespace between the nodes, would silently
// rebrand the page to "Turf War" while every other assertion still passed.
test('the visible wordmark contains no whitespace', () => {
  const mark = visibleWordmark(PublicLanding());

  assert.equal(mark, 'TurfWar');
  assert.ok(!/\s/.test(mark), `no whitespace inside the mark; got ${JSON.stringify(mark)}`);

  // The separation is CSS, not a character — and in `em` so it tracks the
  // wordmark's clamp rather than drifting at size.
  // The treatment lives in the SHARED stylesheet now — it is no longer a landing
  // concern, and the interior headers depend on the same relationship.
  const css = codeOf('src/styles/wordmark.css');
  const margin = css.match(/\.wordmark-join\s*\{[^}]*margin-left:\s*(-?[\d.]+)em/);
  assert.ok(margin, 'the join carries an em margin');

  // REGRESSION TEST — the margin must CLEAR the wordmark's negative tracking.
  //
  // `letter-spacing` applies after every character, including the `f`, so the
  // margin pays that back before it adds anything visible. At `-0.03em` tracking
  // a `0.04em` margin nets +0.01em — roughly 1px, and invisible. This asserts the
  // NET, so retightening the tracking cannot silently swallow the gap again.
  const tracking = css.match(/\.wordmark\s*\{[^}]*letter-spacing:\s*(-?[\d.]+)em/);
  assert.ok(tracking, 'the wordmark declares its tracking in em');
  const net = Number(margin[1]) + Number(tracking[1]);
  assert.ok(
    net >= 0.05,
    `net f/W gap must stay perceptible; got ${net.toFixed(3)}em ` +
      `(margin ${margin[1]}em + tracking ${tracking[1]}em)`
  );
});
