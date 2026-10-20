import { AU } from "../../constants";
import type { BodyId } from "../../data/bodyIds";
import { BODY_COUNT, SOLAR_BODIES } from "../../data/solarSystem";
import { bodies } from "../../store/spaceStore";
import { bodiesGameSeconds } from "../../utils/bodyPositions";
import { eclipticToWorld, orbitShape, type Ecl } from "../../utils/ephemeris";
import { formatOrreryDate, orreryJd } from "../../utils/orreryClock";

/** Main chart radius (SVG units): the outermost aphelion. */
const R = 100;
/** The inset: Sun to Jupiter's aphelion, a circle of this radius, centred this far below the main chart. */
const INSET_R = 62;
const INSET_CY = R + 8 + INSET_R;
const SUN_COLOR = "#ff5500";
const POINTS = 96;

const jplJd = orreryJd(0);
/** Each orbit's shape at the orrery date at load. */
const SHAPES = SOLAR_BODIES.map((b) => ({ b, o: orbitShape(b.orbit.el, jplJd) }));
const aphelion = (o: { a: number; e: number }): number => o.a * (1 + o.e);
const OUTERMOST_AU = Math.max(...SHAPES.map(({ o }) => aphelion(o)));
const JUPITER_APHELION_AU = aphelion(SHAPES.find(({ b }) => b.id === "jupiter")!.o);

/**
 * An orbit's outline seen from +Y (world x, z; the Sun at the focus, the
 * origin): the ellipse in its plane, rotated by argument of perihelion,
 * inclination and node into the ecliptic, then mapped by eclipticToWorld.
 * Chart units, `k` per AU.
 */
function ellipsePath(o: { a: number; e: number; i: number; node: number; argPeri: number }, k: number): string {
  const { a, e, i, node, argPeri } = o;
  const b = a * Math.sqrt(1 - e * e);
  const cw = Math.cos(argPeri), sw = Math.sin(argPeri), ci = Math.cos(i), si = Math.sin(i), cn = Math.cos(node), sn = Math.sin(node);
  const ecl: Ecl = { x: 0, y: 0, z: 0 };
  const w = { x: 0, y: 0, z: 0 };
  let d = "";
  for (let n = 0; n <= POINTS; n++) {
    const E = (n / POINTS) * 2 * Math.PI;
    const px = a * (Math.cos(E) - e), py = b * Math.sin(E);
    const x1 = px * cw - py * sw, y1 = px * sw + py * cw;
    ecl.x = x1 * cn - y1 * ci * sn;
    ecl.y = x1 * sn + y1 * ci * cn;
    ecl.z = y1 * si;
    eclipticToWorld(ecl, w);
    d += `${n === 0 ? "M" : "L"}${((w.x / AU) * k).toFixed(2)},${((w.z / AU) * k).toFixed(2)}`;
  }
  return d + "Z";
}

/**
 * The system chart (spec "Charting, logbook and title"; real-solar-system
 * spec §6.4): top-down, DOM SVG (no WebGL cost). The real ellipses of the nine
 * orbits seen from +Y with the Sun at the focus, in their HUD colours (dashed
 * while uncharted, solid once charted), the dots where the bodies are at the
 * orrery date, and an inset, Sun to Jupiter's aphelion, at a larger scale so
 * Mercury and the inner worlds stay readable. The bearings and the date are a
 * snapshot taken when the logbook renders; the caption and accessible name say so.
 */
export default function SystemChart({ charted }: { charted: ReadonlySet<BodyId> }) {
  const date = formatOrreryDate(orreryJd(bodiesGameSeconds()));
  const main = (R - 6) / OUTERMOST_AU;
  const zoom = (INSET_R - 4) / JUPITER_APHELION_AU;
  const inner = SHAPES.filter(({ o }) => o.a <= JUPITER_APHELION_AU);
  const dot = (id: BodyId, k: number) => ({ cx: (bodies[id].x / AU) * k, cy: (bodies[id].z / AU) * k });
  return (
    <figure className="m-0">
      <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R + 8 + 2 * INSET_R + 4}`} role="img" data-testid="system-chart"
        aria-label={`System chart, a snapshot of the real orbits seen from above for the orrery date ${date}, with an inset of the inner system: the sun and ${charted.size} of ${BODY_COUNT} world orbits charted`}
        className="block w-full max-w-[220px] mx-auto">
        <text data-testid="system-chart-date" x={-R + 1} y={-R + 8} fontSize={7} fill="#ffffff" fillOpacity={0.6}>ORRERY {date}</text>
        {SHAPES.map(({ b, o }) => {
          const on = charted.has(b.id);
          return (
            <path key={b.id} data-testid={`system-chart-orbit-${b.id}`} data-charted={on} d={ellipsePath(o, main)}
              fill="none" stroke={b.color} strokeOpacity={on ? 0.7 : 0.3} strokeWidth={0.6} strokeDasharray={on ? undefined : "2 3"} />
          );
        })}
        <circle r={2.5} fill={SUN_COLOR} />
        {SOLAR_BODIES.map((b) => <circle key={b.id} data-testid={`system-chart-dot-${b.id}`} {...dot(b.id, main)} r={charted.has(b.id) ? 2.4 : 1.6} fill={b.color} />)}
        <g data-testid="system-chart-inset" transform={`translate(0 ${INSET_CY})`}>
          <circle r={INSET_R} fill="#000000" fillOpacity={0.35} stroke="#ffffff" strokeOpacity={0.25} strokeWidth={0.5} />
          {inner.map(({ b, o }) => (
            <path key={b.id} data-testid={`system-chart-inset-orbit-${b.id}`} d={ellipsePath(o, zoom)} fill="none" stroke={b.color}
              strokeOpacity={charted.has(b.id) ? 0.7 : 0.3} strokeWidth={0.6} strokeDasharray={charted.has(b.id) ? undefined : "2 3"} />
          ))}
          <circle r={3} fill={SUN_COLOR} />
          {inner.map(({ b }) => <circle key={b.id} data-testid={`system-chart-inset-dot-${b.id}`} {...dot(b.id, zoom)} r={charted.has(b.id) ? 2.4 : 1.6} fill={b.color} />)}
        </g>
      </svg>
      <figcaption className="mt-1 text-center text-[10px] text-white/60">SNAPSHOT · REAL ORBITS FROM ABOVE · INSET: SUN TO JUPITER'S APHELION</figcaption>
    </figure>
  );
}
