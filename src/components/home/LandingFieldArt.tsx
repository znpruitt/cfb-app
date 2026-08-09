/**
 * POLISH-004 — the two decorative field treatments on the public landing.
 *
 * Both are SERVER-rendered inline SVG with no client JavaScript, no image asset,
 * and no network request. They are DECORATION: `aria-hidden`, `focusable={false}`,
 * no text inside, and non-interactive. Every meaningful string on the landing is
 * real DOM text in `PublicLanding`.
 *
 * The owner's reference image is art direction only and is not committed. Taken
 * from it: the perspective field emerging from below, and the field strip under
 * the wordmark. Deliberately NOT taken: photoreal turf, detailed floodlight
 * arrays, smoke texture, and the large yard numerals — the numerals in particular
 * would be SVG text, which this page does not use.
 *
 * Geometry is computed rather than hand-listed so the perspective stays
 * consistent, but it is plain arithmetic over a fixed viewBox — not an
 * illustration framework, and nothing here is reusable beyond this page.
 *
 * The turf colour is NOT defined here. It lives once, as `--landing-turf` on
 * `.landing-root` in `src/styles/publicLanding.css`, and reaches these shapes
 * through the `landing-turf-fill` / `landing-turf-stop` classes. A duplicated
 * constant lived here first, which made the CSS token inert. Paint is applied by
 * rule rather than by `var()` in a presentation attribute, because support for
 * the latter is not uniform.
 *
 * VISUAL REVISION against the reference. The field was a green WIREFRAME — green
 * strokes on black, no fill — which reads as a grid rather than turf. A field is
 * a green SURFACE with WHITE markings, so those are now inverted: a filled
 * gradient carries the colour and the markings are white at low alpha.
 * Convergence was also far too shallow, and the far edge is what buys distance.
 */

// ---------------------------------------------------------------------------
// Lower perspective field
// ---------------------------------------------------------------------------

const FIELD_W = 1200;
const FIELD_H = 600;
/**
 * Half-width at the horizon and in the foreground.
 *
 * The horizon value is the depth control. It was 150 of a 1200-wide box — a 25%
 * far edge, which reads as a shallow trapezoid seen from a few feet up. Pulling
 * it to 45 (7.5%) converges much closer to a point, and pushing the foreground
 * past the frame puts the viewer ON the field rather than above it.
 */
const TOP_HALF = 45;
const BOTTOM_HALF = 1150;
const CENTER = FIELD_W / 2;

function edgesAt(t: number): { left: number; right: number } {
  const half = TOP_HALF + (BOTTOM_HALF - TOP_HALF) * t;
  return { left: CENTER - half, right: CENTER + half };
}

/**
 * Yard-line depths, spaced by `t²` so lines bunch toward the horizon and open up
 * in the foreground — evenly spaced lines read as a flat grid. More lines than
 * before: with tighter convergence the far ones compress into the haze, and the
 * near ones are what carry the surface.
 */
const YARD_LINE_DEPTHS = [0.16, 0.26, 0.37, 0.49, 0.62, 0.76, 0.9, 1].map((t) => t * t);

export function PerspectiveField({ className }: { className?: string }) {
  const far = edgesAt(0);
  const near = edgesAt(1);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/*
          The turf SURFACE: invisible at the horizon, strongest underfoot, so the
          field emerges from black rather than ending on an edge. This replaced a
          fade-to-black overlay, which dimmed the marks without ever suggesting
          ground.
        */}
        <linearGradient id="landing-turf-surface" x1="0" y1="0" x2="0" y2="1">
          <stop className="landing-turf-stop" offset="0%" stopOpacity="0" />
          <stop className="landing-turf-stop" offset="28%" stopOpacity="0.14" />
          <stop className="landing-turf-stop" offset="65%" stopOpacity="0.34" />
          <stop className="landing-turf-stop" offset="100%" stopOpacity="0.5" />
        </linearGradient>

        {/* Markings share the surface's depth falloff, so they never float above a
            horizon that has already faded out. */}
        <linearGradient id="landing-marking-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="30%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>
        <mask id="landing-marking-mask">
          <rect x="0" y="0" width={FIELD_W} height={FIELD_H} fill="url(#landing-marking-depth)" />
        </mask>
      </defs>

      <polygon
        points={`${far.left},0 ${far.right},0 ${near.right},${FIELD_H} ${near.left},${FIELD_H}`}
        fill="url(#landing-turf-surface)"
      />

      <g
        className="landing-field-markings"
        mask="url(#landing-marking-mask)"
        fill="none"
        strokeLinecap="round"
      >
        <line
          x1={near.left}
          y1={FIELD_H}
          x2={far.left}
          y2={0}
          strokeWidth="2.5"
          strokeOpacity="0.5"
        />
        <line
          x1={near.right}
          y1={FIELD_H}
          x2={far.right}
          y2={0}
          strokeWidth="2.5"
          strokeOpacity="0.5"
        />
        <line x1={CENTER} y1={FIELD_H} x2={CENTER} y2={0} strokeWidth="2" strokeOpacity="0.3" />

        {YARD_LINE_DEPTHS.map((t) => {
          const y = t * FIELD_H;
          const { left, right } = edgesAt(t);
          const inset = (right - left) * 0.24;
          const tick = 4 + 12 * t;
          return (
            <g key={t} strokeWidth={1 + 2 * t} strokeOpacity={0.22 + 0.28 * t}>
              <line x1={left} y1={y} x2={right} y2={y} />
              <line x1={left + inset} y1={y - tick} x2={left + inset} y2={y + tick} />
              <line x1={right - inset} y1={y - tick} x2={right - inset} y2={y + tick} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Wordmark field underline
// ---------------------------------------------------------------------------

const MARK_W = 600;
const MARK_H = 60;

/**
 * The field strip beneath the wordmark — the one place turf green is a filled
 * shape at full strength, which ties the word to the ground below it.
 *
 * Deliberately sized to OVERHANG the wordmark slightly (see
 * `.landing-wordmark-field`). Narrower than the word it sits under, it read as a
 * separate flat trapezoid parked below the mark; wider, it reads as the surface
 * the word is standing on.
 */
export function WordmarkFieldUnderline({ className }: { className?: string }) {
  const inset = 76;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${MARK_W} ${MARK_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <polygon
        className="landing-turf-fill"
        points={`${inset},0 ${MARK_W - inset},0 ${MARK_W},${MARK_H} 0,${MARK_H}`}
      />
      <g className="landing-field-markings" fill="none" strokeOpacity="0.45" strokeWidth="1.5">
        {[0.16, 0.32, 0.48, 0.64, 0.8].map((f) => {
          const topX = inset + (MARK_W - 2 * inset) * f;
          const bottomX = MARK_W * f;
          return <line key={f} x1={topX} y1={0} x2={bottomX} y2={MARK_H} />;
        })}
        <line
          x1={MARK_W / 2}
          y1={0}
          x2={MARK_W / 2}
          y2={MARK_H}
          strokeOpacity="0.8"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}
