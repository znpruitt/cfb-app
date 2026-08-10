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

  // What is LANDING-specific ends here: the mark that reaches this page carries
  // no whitespace. How the separation is achieved — an em margin, its size, and
  // the tracking it must not fight — belongs to the shared treatment and is
  // asserted once in `src/components/brand/__tests__/wordmark.test.tsx`. This
  // test previously carried its own copy of that arithmetic, which froze the
  // same brittle relationship in two files at once.
});

// REGRESSION TEST — the mobile composition must not reach desktop.
//
// "Desktop appearance remains unchanged" has been the binding constraint of every
// mobile pass, and scope is the only structural way to guarantee it: every
// override lives inside the media query. This asserts the SCOPING, not any
// particular value, so the framing stays tunable while the isolation stays
// enforced.
test('the mobile composition overrides are scoped to the media query', () => {
  const css = codeOf('src/styles/publicLanding.css');
  const at = css.indexOf('@media (max-width: 640px)');
  assert.ok(at !== -1, 'the mobile block exists');

  const desktop = css.slice(0, at);
  const mobile = css.slice(at);

  assert.match(mobile, /\.landing-scene\s*\{[^}]*background-size:/, 'mobile reframes the plate');

  // POSITIVE CONTROL — the desktop half is not simply empty, so assertions about
  // it discriminate rather than passing on a mis-sliced string. It deliberately
  // does NOT pin the framing VALUES: those are tunables, and pinning them would
  // fail on every legitimate adjustment while catching nothing a reader notices.
  assert.match(desktop, /\.landing-scene\s*\{/, 'desktop still declares the scene');
  assert.match(desktop, /background-position:/, 'with positioning of its own');
});

// REGRESSION TEST — no spotlight behind the copy.
//
// A radial scrim was added over the hero to stop the goalpost cutting through it,
// then removed: it treated the symptom of a too-tight crop, and a dark oval behind
// the text is exactly what this page must not have. Reframing the photograph is
// the fix. If legibility needs help again, it belongs in the full-bleed gradient,
// not in a shape centred on the words.
test('no radial scrim is painted behind the hero', () => {
  const css = codeOf('src/styles/publicLanding.css');

  assert.ok(!/\.landing-scene::after/.test(css), 'no pseudo-element scrim on the scene');
  assert.ok(!/\.landing-root::after/.test(css), 'nor on the landing root');

  // POSITIVE CONTROL — the full-bleed legibility gradient is still present, so the
  // absence above is about the SPOTLIGHT rather than about all darkening.
  assert.match(css, /linear-gradient\(\s*to bottom/, 'the full-bleed scrim remains');
});

// ---------------------------------------------------------------------------
// Three review fixes that shipped with no coverage until a mutation pass showed
// all three surviving. Each is a CSS contract with a concrete failure mode, so
// each is pinned the way the other CSS contracts in this file are — by reading
// the stylesheet, not by pinning tunable values.
// ---------------------------------------------------------------------------

// REGRESSION TEST — `color-scheme` must sit on the ROOT scroller.
//
// It was on `.landing-root` (the `<main>`), where it governs only that element's
// own UA widgets — and that element has `overflow: hidden`, so it has none. A
// light-OS visitor kept light scrollbars over the stadium while the declaration
// looked correct.
test('the dark colour scheme is declared on the root scroller', () => {
  const css = codeOf('src/styles/publicLanding.css');

  const rootScoped = /html:has\(\.landing-root\)[^{]*\{[^}]*color-scheme:\s*dark/;
  assert.match(css, rootScoped, 'declared against html, which owns the viewport scrollbar');

  const onMain = /\.landing-root\s*\{[^}]*color-scheme/;
  assert.ok(!onMain.test(css), 'and NOT on .landing-root, where it would do nothing');
});

// REGRESSION TEST — the anchored stack needs a floor.
//
// `margin-top: auto` on the card resolves to ZERO once content exceeds its
// container — a landscape phone, or text zoom — and the markup's `mt-10` was
// removed when that margin moved into CSS. Without a floor on the preceding
// element the card's border sits flush against the supporting copy.
test('a minimum gap survives the auto margin collapsing', () => {
  const css = codeOf('src/styles/publicLanding.css');

  assert.match(css, /\.landing-guidance\s*\{[^}]*margin-top:\s*auto/, 'the card claims slack');
  assert.match(
    css,
    /\.landing-lede\s*\{[^}]*margin-bottom:\s*[\d.]+rem/,
    'and the element before it carries a floor for when there is none'
  );
});

// REGRESSION TEST — bottom-anchoring must measure the SMALL viewport.
//
// On iOS Safari `100vh` is the large viewport, so anchoring against it pushed the
// account row — which carries "Sign out" — below the toolbar on first paint. That
// is the control a signed-in non-admin needs to escape the `/` -> `/login` loop.
test('the anchored height uses the dynamic viewport unit', () => {
  const css = codeOf('src/styles/publicLanding.css');

  assert.match(css, /\.landing-content\s*\{[^}]*min-height:\s*calc\(100dvh/);
  assert.ok(
    !/min-height:\s*calc\(100vh/.test(css),
    'never 100vh here — it hides the sign-out control behind the iOS toolbar'
  );
});
