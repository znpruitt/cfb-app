/**
 * POLISH-004 — the two decorative field treatments on the public landing.
 *
 * Both are SERVER-rendered inline SVG with no client JavaScript, no image asset,
 * and no network request. They are DECORATION: `aria-hidden`, `focusable={false}`,
 * no text inside, and non-interactive. Every meaningful string on the landing is
 * real DOM text in `PublicLanding`.
 *
 * The owner's reference image is art direction only and is not committed. Taken
 * from it: the perspective field emerging from below, and the small field strip
 * under the wordmark. Deliberately NOT taken: photoreal turf, detailed floodlight
 * arrays, smoke texture, and the large yard-number graphics — the numerals in
 * particular would be SVG text, which this page does not use.
 *
 * Geometry is computed rather than hand-listed so the perspective stays
 * consistent, but it is plain arithmetic over a fixed viewBox — not an
 * illustration framework, and nothing here is reusable beyond this page.
 */

/**
 * The turf colour is NOT defined here. It lives once, as `--landing-turf` on
 * `.landing-root` in `src/styles/publicLanding.css`, and reaches these shapes
 * through the `landing-turf-stroke` / `landing-turf-fill` classes.
 *
 * A duplicated constant lived here first, which made the CSS token inert: editing
 * the documented source of truth changed nothing on screen, and DESIGN.md claimed
 * a wiring that did not exist. Paint is applied by rule rather than by `var()` in
 * a presentation attribute, because support for the latter is not uniform.
 */

// ---------------------------------------------------------------------------
// Lower perspective field
// ---------------------------------------------------------------------------

const FIELD_W = 1200;
const FIELD_H = 600;
/** Half-width of the field at the horizon (top) and at the foreground (bottom). */
const TOP_HALF = 150;
const BOTTOM_HALF = 800;
const CENTER = FIELD_W / 2;

function edgesAt(t: number): { left: number; right: number } {
  const half = TOP_HALF + (BOTTOM_HALF - TOP_HALF) * t;
  return { left: CENTER - half, right: CENTER + half };
}

/**
 * Yard-line depths. Spaced by `t²` so lines bunch toward the horizon and open up
 * in the foreground, which is what reads as perspective — evenly spaced lines
 * read as a flat grid.
 */
const YARD_LINE_DEPTHS = [0.18, 0.3, 0.44, 0.6, 0.78, 0.98].map((t) => t * t);

export function PerspectiveField({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Fades the horizon into the black page rather than ending on a hard
            edge. A gradient-filled overlay rect, not an SVG filter — filters over
            a full-viewport element are expensive and buy nothing here. */}
        <linearGradient id="landing-field-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000000" stopOpacity="1" />
          <stop offset="45%" stopColor="#000000" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g
        className="landing-turf-stroke"
        strokeOpacity="0.55"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      >
        {/* Sidelines converging toward the horizon. */}
        <line x1={edgesAt(1).left} y1={FIELD_H} x2={edgesAt(0).left} y2={0} />
        <line x1={edgesAt(1).right} y1={FIELD_H} x2={edgesAt(0).right} y2={0} />
        {/* Centre line. */}
        <line x1={CENTER} y1={FIELD_H} x2={CENTER} y2={0} strokeOpacity="0.4" />

        {YARD_LINE_DEPTHS.map((t) => {
          const y = t * FIELD_H;
          const { left, right } = edgesAt(t);
          // Hash marks sit a fixed fraction in from each sideline, so they carry
          // the same perspective as the line they belong to.
          const inset = (right - left) * 0.22;
          const tick = 6 + 10 * t;
          return (
            <g key={t}>
              <line x1={left} y1={y} x2={right} y2={y} strokeOpacity={0.2 + 0.35 * t} />
              <line
                x1={left + inset}
                y1={y - tick}
                x2={left + inset}
                y2={y + tick}
                strokeOpacity={0.15 + 0.3 * t}
              />
              <line
                x1={right - inset}
                y1={y - tick}
                x2={right - inset}
                y2={y + tick}
                strokeOpacity={0.15 + 0.3 * t}
              />
            </g>
          );
        })}
      </g>

      <rect x="0" y="0" width={FIELD_W} height={FIELD_H} fill="url(#landing-field-fade)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Wordmark field underline
// ---------------------------------------------------------------------------

const MARK_W = 600;
const MARK_H = 44;

/**
 * The small field strip beneath the wordmark. The one place on this page where
 * turf green is a filled shape rather than a line — it is what ties the wordmark
 * to the field below without putting colour anywhere else.
 */
export function WordmarkFieldUnderline({ className }: { className?: string }) {
  const inset = 52;
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
      <g stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.5" fill="none">
        {[0.2, 0.4, 0.6, 0.8].map((f) => {
          const topX = inset + (MARK_W - 2 * inset) * f;
          const bottomX = MARK_W * f;
          return <line key={f} x1={topX} y1={0} x2={bottomX} y2={MARK_H} />;
        })}
        <line x1={MARK_W / 2} y1={0} x2={MARK_W / 2} y2={MARK_H} strokeOpacity="0.85" />
      </g>
    </svg>
  );
}
