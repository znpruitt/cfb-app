import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import PublicLanding from '../PublicLanding.tsx';
import { PerspectiveField, WordmarkFieldUnderline } from '../LandingFieldArt.tsx';

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

function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const props = (node as El).props;
    if (props) {
      collectStrings(props.children, out);
      for (const [key, value] of Object.entries(props)) {
        if (key !== 'children' && typeof value === 'string') out.push(value);
      }
    }
  }
  return out;
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

const landingText = (isSignedIn = false) => collectStrings(PublicLanding({ isSignedIn })).join(' ');

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

  assert.match(text, /TurfWar/, 'the visible wordmark is the one-word treatment');
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
    collectStrings(h1.props?.children).join(' '),
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
  const text = landingText();

  assert.match(text, /Turf War/, 'the accessible form is present in the DOM');

  const hidden = hostElements(tree).filter((el) => el.props?.['aria-hidden'] === 'true');
  const hiddenText = hidden.flatMap((el) => collectStrings(el.props?.children));
  assert.ok(hiddenText.includes('TurfWar'), 'the stylised form is hidden from assistive tech');

  const srOnly = hostElements(tree).filter(
    (el) => typeof el.props?.className === 'string' && el.props.className.includes('sr-only')
  );
  assert.ok(
    srOnly.some((el) => collectStrings(el.props?.children).includes('Turf War')),
    'and the spaced form is what gets announced'
  );
});

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------

test('both field treatments render', () => {
  const types: unknown[] = [];
  walk(PublicLanding(), (el) => types.push(el.type));

  assert.ok(types.includes(PerspectiveField), 'the lower perspective field');
  assert.ok(types.includes(WordmarkFieldUnderline), 'and the wordmark field underline');
});

// REGRESSION TEST — decoration must be invisible to assistive technology and to
// the keyboard. `focusable="false"` matters because IE-era SVG defaults still
// surface in some engines, and a focus stop on a background graphic is a trap.
test('every decorative SVG is hidden and unfocusable', () => {
  for (const [name, art] of [
    ['PerspectiveField', PerspectiveField({})],
    ['WordmarkFieldUnderline', WordmarkFieldUnderline({})],
  ] as const) {
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

  for (const art of [PerspectiveField({}), WordmarkFieldUnderline({})]) {
    const textNodes = hostElements(art).filter((el) => el.type === 'text' || el.type === 'tspan');
    assert.equal(textNodes.length, 0, 'decoration carries no SVG text');
    // CHILDREN only. `collectStrings` also gathers attribute values, so asserting
    // on it here would fail on `viewBox` and prove nothing about text.
    assert.deepEqual(textContent(art), [], 'and no string content at all');
  }
});

test('the landing introduces no raster, canvas, or video element', () => {
  const types = hostElements(PublicLanding()).map((el) => el.type);
  for (const banned of ['img', 'canvas', 'video', 'picture', 'iframe']) {
    assert.ok(!types.includes(banned), `no <${banned}> on the landing`);
  }

  // The decoration module owns every graphic on this page, so a scan that reads
  // only `PublicLanding.tsx` cannot see an `<img>` or a remote url added where
  // they would actually go.
  for (const rel of LANDING_SOURCES) {
    const code = codeOf(rel);
    assert.ok(!/next\/image/.test(code), `no next/image in ${rel}`);
    assert.ok(!/url\(["']?https?:/.test(code), `no external asset reference in ${rel}`);
    assert.ok(!/<(img|canvas|video|picture|iframe)\b/.test(code), `no raster element in ${rel}`);
  }

  // Both SVG trees too — `walk` stops at an unrendered component element, so the
  // tree assertion above never descends into them.
  for (const art of [PerspectiveField({}), WordmarkFieldUnderline({})]) {
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
  assert.match(css, /\.landing-turf-stroke\s*\{[^}]*stroke:\s*var\(--landing-turf\)/);
  assert.match(css, /\.landing-turf-fill\s*\{[^}]*fill:\s*var\(--landing-turf\)/);

  const art = codeOf('src/components/home/LandingFieldArt.tsx');
  assert.ok(
    !/#2f8f4e/i.test(art),
    'the art module must not hard-code the colour — one source of truth'
  );
  assert.match(art, /landing-turf-stroke/, 'it takes the stroke class');
  assert.match(art, /landing-turf-fill/, 'and the fill class');
});
