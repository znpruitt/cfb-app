import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import PublicLanding from '../PublicLanding.tsx';
import { WordmarkFieldUnderline } from '../LandingFieldArt.tsx';

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
  const hidden = hostElements(tree).filter((el) => el.props?.['aria-hidden'] === 'true');
  return hidden.map((el) => textContent(el.props?.children).join('')).join('');
}

const landingText = (isSignedIn = false) => textContent(PublicLanding({ isSignedIn })).join(' ');

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
  'src/components/home/LandingFieldArt.tsx',
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
  const h1 = firstOfType(PublicLanding(), 'h1');
  assert.ok(h1, 'the landing has a level-one heading');
  assert.match(
    textContent(h1.props?.children).join(' '),
    /Draft college football teams\. Compete all season\./
  );

  // And the wordmark is NOT a heading — it must not compete for that role.
  const headings = hostElements(PublicLanding()).filter(
    (el) => typeof el.type === 'string' && /^h[1-6]$/.test(el.type)
  );
  assert.equal(headings.length, 1, 'exactly one heading on the page');
});

// REGRESSION TEST — the visible mark is stylised; the accessible name is real.
// A screen reader announcing "TurfWar" as one token is worse than the product
// name, and the fix is a hidden label rather than renaming anything.
test('the accessible wordmark is the spaced product name', () => {
  const tree = PublicLanding();
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

test('the scene layer and the vector wordmark mark both render', () => {
  const tree = PublicLanding();
  const types: unknown[] = [];
  walk(tree, (el) => types.push(el.type));

  // The brand mark stays VECTOR — it scales with the wordmark and must stay crisp.
  assert.ok(types.includes(WordmarkFieldUnderline), 'the wordmark field underline');

  // The atmosphere is a raster plate carried by a decorative background layer.
  const scene = hostElements(tree).filter(
    (el) => typeof el.props?.className === 'string' && el.props.className.includes('landing-scene')
  );
  assert.equal(scene.length, 1, 'exactly one scene layer');
  assert.equal(scene[0]!.props?.['aria-hidden'], 'true', 'and it is hidden from assistive tech');
  assert.deepEqual(textContent(scene[0]), [], 'and carries no text');
});

// REGRESSION TEST — decoration must be invisible to assistive technology and to
// the keyboard. `focusable="false"` matters because IE-era SVG defaults still
// surface in some engines, and a focus stop on a background graphic is a trap.
test('every decorative SVG is hidden and unfocusable', () => {
  for (const [name, art] of [['WordmarkFieldUnderline', WordmarkFieldUnderline({})]] as const) {
    const svg = art as El;
    assert.equal(svg.type, 'svg', `${name} renders an svg root`);
    assert.equal(svg.props?.['aria-hidden'], 'true', `${name} is aria-hidden`);
    assert.equal(svg.props?.focusable, 'false', `${name} is not focusable`);
  }
});

// REGRESSION TEST — no meaningful copy inside the decoration. The reference's
// giant yard numerals were deliberately rejected: text in a background graphic is
// unselectable, unsearchable, and announced out of context if it is announced at
// all.
test('no text is rendered inside the decorative SVGs', () => {
  // POSITIVE CONTROL FIRST — AGENTS.md: "a negative assertion requires a proven
  // observer". Both observers are shown detecting the forbidden thing on a
  // synthetic tree of the same shape. Without this, an observer that stopped
  // descending into children would return empty for ANY input and this test
  // would pass forever while the accessibility contract silently rotted.
  const withText = {
    type: 'svg',
    props: {
      children: [{ type: 'g', props: { children: { type: 'text', props: { children: '40' } } } }],
    },
  };
  assert.equal(
    hostElements(withText).filter((el) => el.type === 'text').length,
    1,
    'the element observer finds a nested <text>'
  );
  assert.deepEqual(textContent(withText), ['40'], 'and the text observer finds its content');

  for (const art of [WordmarkFieldUnderline({})]) {
    const textNodes = hostElements(art).filter((el) => el.type === 'text' || el.type === 'tspan');
    assert.equal(textNodes.length, 0, 'decoration carries no SVG text');
    // CHILDREN only — attribute values are not text, and treating them as text
    // is what made an earlier version of this assertion meaningless.
    assert.deepEqual(textContent(art), [], 'and no string content at all');
  }
});

test('the scene is a LOCAL CSS background, never a DOM element', () => {
  const types = hostElements(PublicLanding()).map((el) => el.type);
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

  // The vector mark's tree too — `walk` stops at an unrendered component element,
  // so the tree assertion above never descends into it.
  for (const art of [WordmarkFieldUnderline({})]) {
    const artTypes = hostElements(art).map((el) => el.type);
    for (const banned of ['img', 'canvas', 'video', 'image']) {
      assert.ok(!artTypes.includes(banned), `no <${banned}> inside the decoration`);
    }
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
  assert.match(css, /--landing-turf/, 'real declarations survive the strip');
});

// The turf green is LANDING-SCOPED. It lives on this page's root element and is
// not promoted to a global token — DESIGN.md records the exception, and this
// keeps the exception honest.
test('the turf colour stays scoped to the landing', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/publicLanding.css'), 'utf8');
  assert.match(css, /\.landing-root\s*\{[^}]*--landing-turf:/, 'declared on the landing root');

  const globals = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  assert.ok(!/--landing-turf/.test(globals), 'and never promoted into the global token block');

  // REGRESSION TEST — the token must actually PAINT. It was declared, documented
  // as the source of the field colour, and consumed by nothing: both SVGs carried
  // a duplicated literal, so editing the documented token changed nothing on
  // screen while this test still passed on the declaration alone.
  assert.match(css, /\.landing-turf-fill\s*\{[^}]*fill:\s*var\(--landing-turf\)/);

  const art = codeOf('src/components/home/LandingFieldArt.tsx');
  assert.ok(
    !/#2f8f4e/i.test(art),
    'the art module must not hard-code the colour — one source of truth'
  );
  assert.match(art, /landing-turf-fill/, 'it takes the fill class');

  // Markings are WHITE; the token paints the mark's surface. `--landing-turf` is
  // kept as the scoped TurfWar accent token even though the strip is now its only
  // consumer — it is a brand value, not a convenience for two call sites.
  assert.match(css, /\.landing-field-markings\s*\{[^}]*stroke:\s*#ffffff/);
  assert.match(css, /--landing-turf:/, 'the accent token survives the scene removal');
});

// REGRESSION TEST — the strip's single integration pass.
//
// It read as a separate green trapezoid parked below the wordmark. Two things
// changed that, and both are structural rather than taste: it overlaps the
// wordmark's descender space instead of starting below its box, and its FAR edge
// is masked to a fade so it recedes rather than ending on a hard line.
test('the wordmark strip is tucked under the mark and its far edge is softened', () => {
  const css = codeOf('src/styles/publicLanding.css');
  assert.match(
    css,
    /\.landing-wordmark-field\s*\{[^}]*margin:\s*-[\d.]+rem/,
    'a negative top margin overlaps the wordmark rather than clearing it'
  );

  const art = WordmarkFieldUnderline({});
  const masked = hostElements(art).filter((el) => typeof el.props?.mask === 'string');
  assert.ok(masked.length > 0, 'the mark is drawn through a mask');
  assert.ok(
    hostElements(art).some((el) => el.type === 'mask'),
    'and the mask is defined in the SVG, so the far edge fades'
  );
});

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
  const css = codeOf('src/styles/publicLanding.css');
  assert.match(css, /\.landing-wordmark-join\s*\{[^}]*margin-left:\s*0?\.\d+em/);
});
