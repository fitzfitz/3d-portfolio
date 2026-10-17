import { describe, it } from "vitest";
import { AU, sunOmega } from "../src/constants";
import { orbitPosition, type OrbitalElements } from "../src/utils/orbits";
import type { WorldTypeId } from "../src/data/worldTypes";
import { WORLDS, type WorldId } from "../src/data/worlds";
import { worldMargins, worldReach, BODY_GAP, type ToOrbit, type WorldShape } from "./helpers/worldRules";

/**
 * The search that chose the worlds' orbits (spec: "the search tool that found
 * the orbits is kept"). Skipped by default; run it when a world is added or a
 * placement rule changes:
 *
 *   WORLD_SEARCH=1 npx vitest run tests/worldOrbitSearch.test.ts
 *
 * Planes are judged by the same rules as worldClearance (helpers/worldRules.ts),
 * measured with the exact distance from a point to a circle. Two circles about
 * the sun come within |r1 − r2| of each other on their line of nodes whatever
 * their planes, so the world-vs-body gaps depend on radius alone: the search
 * finds each world's best plane per radius, then the best set of radii.
 */

const DEG = Math.PI / 180;
/** Straight to stdout: vitest's console interception hides a passing test's logs. */
const report = (line: string) => process.stdout.write(`${line}\n`);

/** The unit normal of an orbit's plane, cached per orbit. */
const normals = new WeakMap<OrbitalElements, number[]>();
function normalOf(o: OrbitalElements): number[] {
  let n = normals.get(o);
  if (!n) {
    const a = orbitPosition({ ...o, phase: 0 }, 0);
    const b = orbitPosition({ ...o, phase: Math.PI / 2 }, 0);
    const c = [a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x];
    const l = Math.hypot(c[0], c[1], c[2]);
    n = c.map((v) => v / l);
    normals.set(o, n);
  }
  return n;
}

/** Exact distance from point p to the circle of orbit o. */
const toCircle: ToOrbit = (o, p) => {
  const n = normalOf(o);
  const h = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
  const rho = Math.sqrt(Math.max(0, p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - h * h));
  return Math.hypot(h, rho - o.radius);
};

interface Candidate { id: string; type: WorldTypeId; size: number; window: [number, number] }
/**
 * Radius windows, about ±25 around each preference: the rock innermost (just
 * past Fuxx's reach), the ice giants outermost (up to the haze). The dwarf sits
 * at real Ceres's 2.77 AU (318.55), so its window is that one radius. A new
 * world needs a window here and its row in WORLDS.
 */
const CERES_R = 2.77 * AU;
const WINDOWS: Record<WorldId, [number, number]> = {
  "w-rock": [205, 245],
  "w-ringed": [245, 295],
  "w-dwarf": [CERES_R, CERES_R],
  "w-tilted": [335, 407],
  "w-blue": [335, 407],
};
const CANDIDATES: Candidate[] = WORLDS.map((w) => ({ id: w.id, type: w.type, size: w.size, window: WINDOWS[w.id] }));
const INC_MAX = 40;

interface Plane { inc: number; node: number; margin: number; worst: string }

function judge(c: Candidate, radius: number, inc: number, node: number): Plane {
  const orbit: OrbitalElements = { radius, angularSpeed: sunOmega(radius), inclination: inc * DEG, node: node * DEG, phase: 0 };
  const w: WorldShape = { id: c.id, type: c.type, size: c.size, orbit };
  let margin = Infinity, worst = "";
  for (const m of worldMargins(w, [], toCircle)) if (m.margin < margin) { margin = m.margin; worst = m.what; }
  return { inc, node, margin, worst };
}

/** Grid: inclination −40…40° in 2.5° steps, node 0…350° in 10°; then refined around the best to 0.5° and 1°. */
function bestPlane(c: Candidate, radius: number): Plane {
  let best: Plane = { inc: 0, node: 0, margin: -Infinity, worst: "" };
  for (let inc = -INC_MAX; inc <= INC_MAX; inc += 2.5) {
    for (let node = 0; node < 360; node += 10) {
      const p = judge(c, radius, inc, node);
      if (p.margin > best.margin) best = p;
    }
  }
  const coarse = best;
  for (let inc = Math.max(-INC_MAX, coarse.inc - 2.5); inc <= Math.min(INC_MAX, coarse.inc + 2.5); inc += 0.5) {
    for (let dn = -10; dn <= 10; dn += 1) {
      const p = judge(c, radius, inc, (coarse.node + dn + 360) % 360);
      if (p.margin > best.margin) best = p;
    }
  }
  return best;
}

const gapMargin = (i: number, ri: number, j: number, rj: number) =>
  Math.abs(ri - rj) - worldReach(CANDIDATES[i]) - worldReach(CANDIDATES[j]) - BODY_GAP;

describe.skipIf(!process.env.WORLD_SEARCH)("world orbit search", () => {
  it("prints the best plane per radius and the best set of radii", () => {
    const table = CANDIDATES.map((c) => {
      const rows = new Map<number, Plane>();
      for (let r = c.window[0]; r <= c.window[1]; r += 1) rows.set(r, bestPlane(c, r));
      return rows;
    });
    // 1. The radii (1 u steps) that maximise the smallest margin of all: each
    //    world's best-plane margin and every world-vs-world gap.
    let best = { score: -Infinity, radii: [] as number[] };
    const pick = (i: number, radii: number[], score: number) => {
      if (i === CANDIDATES.length) { best = { score, radii: [...radii] }; return; }
      for (const [r, plane] of table[i]) {
        let s = Math.min(score, plane.margin);
        for (let j = 0; j < i; j++) s = Math.min(s, gapMargin(i, r, j, radii[j]));
        if (s > best.score) pick(i + 1, [...radii, r], s);
      }
    };
    pick(0, [], Infinity);
    // 2. Polish: each world in turn takes the radius that maximises its own
    //    smallest margin, the others held.
    const radii = best.radii;
    const own = (i: number, r: number) => {
      let s = table[i].get(r)!.margin;
      radii.forEach((rj, j) => { if (j !== i) s = Math.min(s, gapMargin(i, r, j, rj)); });
      return s;
    };
    for (let pass = 0; pass < 3; pass++) {
      CANDIDATES.forEach((_, i) => {
        for (const r of table[i].keys()) if (own(i, r) > own(i, radii[i])) radii[i] = r;
      });
    }
    report(`best smallest margin ${best.score.toFixed(2)}; after polish:`);
    CANDIDATES.forEach((c, i) => {
      const p = table[i].get(radii[i])!;
      report(`${c.id}: r ${radii[i]} inc ${p.inc}° node ${p.node}° plane margin ${p.margin.toFixed(2)} (${p.worst}), worst margin ${own(i, radii[i]).toFixed(2)}`);
    });
    report("best plane margin per radius:");
    CANDIDATES.forEach((c, i) => {
      report(`${c.id} ${[...table[i]].map(([r, p]) => `${+r.toFixed(2)}:${p.margin.toFixed(1)}`).join(" ")}`);
    });
  }, 600_000);
});
