import { AU } from "../../constants";
import type { BodyId } from "../../data/bodyIds";
import { BODY_COUNT, SOLAR_BODIES } from "../../data/solarSystem";
import { bodies } from "../../store/spaceStore";
import { orbitShape } from "../../utils/ephemeris";
import { orreryJd } from "../../utils/orreryClock";

/** Chart radius (SVG units). */
const R = 100;
const SUN_COLOR = "#ff5500";
/** Each body's semi-major axis (u), for the orrery date at load: the chart's layout radius. */
const ORBIT_R: Readonly<Record<BodyId, number>> = Object.fromEntries(
  SOLAR_BODIES.map((b) => [b.id, orbitShape(b.orbit.el, orreryJd(0)).a * AU]),
) as Record<BodyId, number>;
const OUTERMOST = Math.max(...Object.values(ORBIT_R));
/**
 * Radius on the chart: square-root distances, so Mercury (1.3% of Neptune's
 * distance) stays off the Sun's dot. Task 11 draws the true ellipses with an
 * inner-system inset instead.
 */
const chartR = (r: number): number => (R - 6) * Math.sqrt(r / OUTERMOST);

/**
 * Where a body sits on the chart: on its orbit's circle, at its current
 * top-down bearing from the sun (read from `bodies` at render).
 */
function dot(id: BodyId): { cx: number; cy: number } {
  const b = bodies[id];
  const a = Math.atan2(b.z, b.x);
  const r = chartR(ORBIT_R[id]);
  return { cx: Math.cos(a) * r, cy: Math.sin(a) * r };
}

/**
 * The system chart (spec "Charting, logbook and title"): top-down, DOM SVG
 * (no WebGL cost). The sun and the nine bodies on their orbits, in their HUD
 * colours: an orbit is dashed while uncharted, solid once charted.
 * Inclinations and eccentricities are flattened: each orbit draws as a circle
 * at its semi-major axis, at square-root distance. The bearings are a
 * snapshot taken when the logbook renders; the caption and the accessible
 * name both say so.
 */
export default function SystemChart({ charted }: { charted: ReadonlySet<BodyId> }) {
  return (
    <figure className="m-0">
      <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} role="img" data-testid="system-chart"
        aria-label={`System chart, a snapshot with orbits drawn flattened at square-root distances: the sun and ${charted.size} of ${BODY_COUNT} world orbits charted`}
        className="block w-full max-w-[220px] mx-auto">
        {SOLAR_BODIES.map((b) => {
          const on = charted.has(b.id);
          return (
            <circle key={b.id} data-testid={`system-chart-orbit-${b.id}`} data-charted={on}
              r={chartR(ORBIT_R[b.id])} fill="none" stroke={b.color}
              strokeOpacity={on ? 0.7 : 0.3} strokeWidth={0.6} strokeDasharray={on ? undefined : "2 3"} />
          );
        })}
        <circle r={3.5} fill={SUN_COLOR} />
        {SOLAR_BODIES.map((b) => <circle key={b.id} {...dot(b.id)} r={charted.has(b.id) ? 2.4 : 1.6} fill={b.color} />)}
      </svg>
      <figcaption className="mt-1 text-center text-[10px] text-white/60">SNAPSHOT · ORBITS DRAWN FLATTENED, SQUARE-ROOT DISTANCES</figcaption>
    </figure>
  );
}
