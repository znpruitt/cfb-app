/**
 * POLISH-004 — the wordmark's field strip.
 *
 * SERVER-rendered inline SVG, no client JavaScript, no network request. It is
 * DECORATION: `aria-hidden`, `focusable={false}`, no text inside, and
 * non-interactive. Every meaningful string on the landing is real DOM text in
 * `PublicLanding`.
 *
 * This module used to also own `PerspectiveField`, a full-viewport stadium scene
 * built from SVG geometry and CSS gradients. It was removed: two passes of blind
 * value-tuning could not make native shapes read as an atmospheric field, and
 * preview confirmed the gap was material rather than parametric. The scene is now
 * a decorative raster plate (`.landing-scene`), which is what that kind of
 * atmosphere actually wants.
 *
 * The strip stays VECTOR deliberately. It is part of the brand mark — it scales
 * with the wordmark, needs no asset, and must stay crisp at any size. The durable
 * rule in DESIGN.md draws exactly this line: decorative atmosphere may be raster,
 * brand marks stay native.
 *
 * The turf colour is NOT defined here. It lives once as `--landing-turf` on
 * `.landing-root` and reaches these shapes through `landing-turf-fill` /
 * `landing-field-markings`. A duplicated constant lived here first, which made the
 * CSS token inert. Paint is applied by rule rather than by `var()` in a
 * presentation attribute, because support for the latter is not uniform.
 */

const MARK_W = 600;
const MARK_H = 60;

/**
 * The field strip beneath the wordmark — the one place turf green is a filled
 * shape at full strength, tying the word to ground.
 *
 * Sized to OVERHANG the wordmark (see `.landing-wordmark-field`) and pulled up
 * beneath its baseline. Narrower and detached, it read as a separate flat
 * trapezoid parked below the mark; overlapping and overhanging, it reads as the
 * surface the word stands on.
 *
 * The FAR edge is masked to a soft fade. A hard top edge is what made it look
 * like a shape rather than a receding plane — perspective implies the far end
 * dissolves into distance, and the mask is what supplies that.
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
      <defs>
        <linearGradient id="landing-mark-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>
        <mask id="landing-mark-mask">
          <rect x="0" y="0" width={MARK_W} height={MARK_H} fill="url(#landing-mark-depth)" />
        </mask>
      </defs>

      <g mask="url(#landing-mark-mask)">
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
      </g>
    </svg>
  );
}
