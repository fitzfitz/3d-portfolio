import { planets } from "../../constants";
import { WORLDS, WORLD_COUNT, WORLD_MARK_COLOR, type WorldId } from "../../data/worlds";
import { bodies } from "../../store/spaceStore";

/** Chart radius (SVG units) and the scale that fits the outermost orbit inside it. */
const R = 100;
const OUTERMOST = Math.max(...planets.map((p) => p.orbit.radius), ...WORLDS.map((w) => w.orbit.radius));
const SCALE = (R - 6) / OUTERMOST;
const SUN_COLOR = "#ff5500";

/**
 * Where a body sits on the chart: on its orbit's circle (to scale in r), at
 * its current top-down bearing from the sun (read from `bodies` at render).
 */
function dot(key: string, r: number): { cx: number; cy: number } {
  const b = bodies[key];
  const a = Math.atan2(b.z, b.x);
  return { cx: Math.cos(a) * r * SCALE, cy: Math.sin(a) * r * SCALE };
}

/**
 * The system chart (spec "Charting, logbook and title"): top-down, DOM SVG
 * (no WebGL cost), to scale in orbital radius. The sun, the three project
 * planets on their orbits, and the five worlds' orbits: dashed while
 * uncharted, solid with the world's dot once charted. Inclinations are
 * flattened: each orbit draws as its circle of radius r. The bearings are a
 * snapshot taken when the logbook renders; the caption and the accessible
 * name both say so, and say the orbits are flattened.
 */
export default function SystemChart({ charted }: { charted: ReadonlySet<WorldId> }) {
  return (
    <figure className="m-0">
      <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} role="img" data-testid="system-chart"
        aria-label={`System chart, a snapshot with orbits drawn flattened: the sun, ${planets.length} planets and ${charted.size} of ${WORLD_COUNT} world orbits charted`}
        className="block w-full max-w-[220px] mx-auto">
        {planets.map((p) => (
          <circle key={p.name} r={p.orbit.radius * SCALE} fill="none" stroke={p.color} strokeOpacity={0.35} strokeWidth={0.6} />
        ))}
        {WORLDS.map((w) => {
          const on = charted.has(w.id);
          return (
            <circle key={w.id} data-testid={`system-chart-orbit-${w.id}`} data-charted={on}
              r={w.orbit.radius * SCALE} fill="none" stroke={WORLD_MARK_COLOR}
              strokeOpacity={on ? 0.7 : 0.3} strokeWidth={0.6} strokeDasharray={on ? undefined : "2 3"} />
          );
        })}
        <circle r={3.5} fill={SUN_COLOR} />
        {planets.map((p) => <circle key={p.name} {...dot(p.name, p.orbit.radius)} r={2.4} fill={p.color} />)}
        {WORLDS.filter((w) => charted.has(w.id)).map((w) => (
          <circle key={w.id} {...dot(w.id, w.orbit.radius)} r={2} fill={WORLD_MARK_COLOR} />
        ))}
      </svg>
      <figcaption className="mt-1 text-center text-[10px] text-white/60">SNAPSHOT · ORBITS DRAWN FLATTENED</figcaption>
    </figure>
  );
}
