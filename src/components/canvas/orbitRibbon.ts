import * as THREE from "three";
import type { Vec3 } from "../../utils/reactions";

/**
 * Orbit lines as true ellipses (docs/superpowers/specs/2026-10-20-real-solar-system-design.md
 * §6.2). The ribbon is built in the orbit's own perifocal frame (x toward
 * perihelion, y a quarter turn ahead along the motion, z the orbit normal; the
 * Sun at the origin, a focus), and its mesh is turned into the world by
 * `orbitFrameQuaternion`. In that frame the curve lies in local XY around the
 * origin, which is what the guide-line shader's dashes read (guideLine.ts
 * `atan(position.y, position.x)`), so every orbit shares the guide line's one
 * program. The shader keeps the strip at least ORBIT_MIN_HALF_PX wide on
 * screen from anywhere, and the apsis ticks marked (§6.2).
 */

/** Points per orbit, uniform in eccentric anomaly (as tests/helpers/solarClearance.ts sweeps). */
export const ORBIT_RIBBON_SAMPLES = 512;
/** Half the ribbon's width (u): the old planets' and worlds' rings were r ± 0.06. */
export const ORBIT_RIBBON_HALF_WIDTH = 0.06;
/**
 * The ribbon is never thinner than this half-width on screen (CSS px): the
 * guide-line shader widens it with distance (guideLine.ts `minHalfPx`), so a
 * 0.12 u line stays a 2 px line across the whole system.
 */
export const ORBIT_MIN_HALF_PX = 1;
/** Half the length of a perihelion / aphelion tick, along the radius (u). */
export const ORBIT_TICK_HALF_LENGTH = 0.6;
/** And never shorter than this on screen (CSS px), however far (guideLine.ts `tickHalfPx`). */
export const ORBIT_TICK_MIN_HALF_PX = 4;

/**
 * `samples` points of an ellipse with semi-major axis `a` (u) and eccentricity
 * `e`, in the perifocal frame, focus at the origin: E = 2πk / samples,
 * (a(cos E − e), b sin E, 0). Perihelion is the first point.
 */
export function perifocalEllipse(a: number, e: number, samples: number): Vec3[] {
  const b = a * Math.sqrt(1 - e * e);
  const out: Vec3[] = [];
  for (let k = 0; k < samples; k++) {
    const E = (k / samples) * Math.PI * 2;
    out.push({ x: a * (Math.cos(E) - e), y: b * Math.sin(E), z: 0 });
  }
  return out;
}

const _m = new THREE.Matrix4();

/**
 * The perifocal → world rotation for an orbit's shape (radians, as
 * ephemeris.ts orbitShape returns): Rz(Ω)·Rx(I)·Rz(ω) into the J2000
 * ecliptic, then the ecliptic → world map (x, z, −y), a proper rotation.
 * Written into `out`.
 */
export function orbitFrameQuaternion(
  shape: { i: number; node: number; argPeri: number },
  out: THREE.Quaternion,
): THREE.Quaternion {
  const cw = Math.cos(shape.argPeri), sw = Math.sin(shape.argPeri);
  const cO = Math.cos(shape.node), sO = Math.sin(shape.node);
  const cI = Math.cos(shape.i), sI = Math.sin(shape.i);
  // Columns of the perifocal → ecliptic matrix (P, Q, W), ephemeris.ts rotate().
  const Px = cw * cO - sw * sO * cI, Py = cw * sO + sw * cO * cI, Pz = sw * sI;
  const Qx = -sw * cO - cw * sO * cI, Qy = -sw * sO + cw * cO * cI, Qz = cw * sI;
  const Wx = sO * sI, Wy = -cO * sI, Wz = cI;
  // Ecliptic (x, y, z) → world (x, z, −y), row by row.
  _m.set(
    Px, Qx, Wx, 0,
    Pz, Qz, Wz, 0,
    -Py, -Qy, -Wy, 0,
    0, 0, 0, 1,
  );
  return out.setFromRotationMatrix(_m);
}

/** One CSS px in units at view depth `depth`: 2 z tan(fov / 2) / H (guideLine.ts, the same sum). */
export function pxAtDepth(depth: number, fovYRad: number, viewportH: number): number {
  return (2 * Math.max(depth, 0) * Math.tan(fovYRad / 2)) / viewportH;
}

/**
 * An in-plane offset `o` (from a line's centre, across the line), turned
 * about the line's own direction to face the camera, and grown to at least
 * `minLen`: the guide-line shader's `facing()` (guideLine.ts), mirrored for
 * tests. The line runs along t = n × o (n the plane's normal); the result is
 * along t × toCam, ⟂ both the line and the view, so it keeps its screen
 * width when the orbit is seen edge-on, from in the ecliptic. Face-on it is
 * o's own direction; −o gives the opposite. Looking straight down the line,
 * where that is undefined, it keeps o's direction.
 */
export function facingOffset(o: Vec3, n: Vec3, toCam: Vec3, minLen: number): Vec3 {
  const l = Math.hypot(o.x, o.y, o.z);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  const tx = n.y * o.z - n.z * o.y, ty = n.z * o.x - n.x * o.z, tz = n.x * o.y - n.y * o.x;
  const fx = ty * toCam.z - tz * toCam.y, fy = tz * toCam.x - tx * toCam.z, fz = tx * toCam.y - ty * toCam.x;
  const fl = Math.hypot(fx, fy, fz);
  const k = Math.max(l, minLen);
  if (fl <= 1e-6 * Math.hypot(tx, ty, tz) * Math.hypot(toCam.x, toCam.y, toCam.z)) {
    return { x: (o.x / l) * k, y: (o.y / l) * k, z: (o.z / l) * k };
  }
  return { x: (fx / fl) * k, y: (fy / fl) * k, z: (fz / fl) * k };
}

/**
 * The apsides of an ellipse in its perifocal frame (Sun at the origin):
 * perihelion at E = 0, (a(1 − e), 0, 0), and aphelion at E = π, (−a(1 + e), 0, 0).
 */
export function apsides(a: number, e: number): [Vec3, Vec3] {
  return [{ x: a * (1 - e), y: 0, z: 0 }, { x: -a * (1 + e), y: 0, z: 0 }];
}

/**
 * A closed, flat strip along `points` (a planar loop, in order, not
 * repeating the first point), `halfWidth` to each side within the loop's
 * plane. The last column repeats the first, so the seam closes; uv.x is the
 * arc-length fraction (0 at the first point, 1 back at it), uv.y 0 / 1 across.
 *
 * Each `ticks` point (the apsides) adds a short crossbar after the strip: a
 * quad along the radius from the origin, `tickHalfLength` each way, the
 * strip's width across, so it crosses the orbit at right angles where the
 * radius meets the curve square (it does at the apsides).
 *
 * For the shader's screen-constant width (guideLine.ts) every vertex carries
 * its offsets from the line's centre: `aSide` across the line (the strip's
 * half-width; a tick's thickness) and `aAlong` along a tick's length (zero on
 * the strip). position − aSide − aAlong is the centre.
 */
export function orbitRibbonGeometry(
  points: Vec3[], halfWidth: number, ticks: readonly Vec3[] = [], tickHalfLength = ORBIT_TICK_HALF_LENGTH,
): THREE.BufferGeometry {
  const n = points.length;
  // The loop's plane normal: its (doubled) vector area, Σ p_k × p_{k+1}.
  let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < n; k++) {
    const p = points[k], q = points[(k + 1) % n];
    nx += p.y * q.z - p.z * q.y;
    ny += p.z * q.x - p.x * q.z;
    nz += p.x * q.y - p.y * q.x;
  }
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;

  const cols = n + 1;
  const verts = cols * 2 + ticks.length * 4;
  const pos = new Float32Array(verts * 3);
  const side = new Float32Array(verts * 3);
  const along = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const arc = new Float64Array(cols);
  for (let k = 1; k < cols; k++) {
    const p = points[k - 1], q = points[k % n];
    arc[k] = arc[k - 1] + Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  }
  const total = arc[n] || 1;
  for (let k = 0; k < cols; k++) {
    const p = points[k % n];
    // Central-difference tangent; the side is tangent × normal, in the plane.
    const prev = points[(k - 1 + n) % n], next = points[(k + 1) % n];
    const tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
    let sx = ty * nz - tz * ny, sy = tz * nx - tx * nz, sz = tx * ny - ty * nx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx = (sx / sl) * halfWidth; sy = (sy / sl) * halfWidth; sz = (sz / sl) * halfWidth;
    const o = k * 6;
    pos[o] = p.x - sx; pos[o + 1] = p.y - sy; pos[o + 2] = p.z - sz;
    pos[o + 3] = p.x + sx; pos[o + 4] = p.y + sy; pos[o + 5] = p.z + sz;
    side[o] = -sx; side[o + 1] = -sy; side[o + 2] = -sz;
    side[o + 3] = sx; side[o + 4] = sy; side[o + 5] = sz;
    const u = k === n ? 1 : arc[k] / total;
    uv[k * 4] = u; uv[k * 4 + 1] = 0;
    uv[k * 4 + 2] = u; uv[k * 4 + 3] = 1;
  }
  const index: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    index.push(a, c, b, b, c, d);
  }
  ticks.forEach((q, t) => {
    // Along: the radius, in the plane. Across: normal × along.
    const rl = Math.hypot(q.x, q.y, q.z) || 1;
    const ax = q.x / rl, ay = q.y / rl, az = q.z / rl;
    const cx = ny * az - nz * ay, cy = nz * ax - nx * az, cz = nx * ay - ny * ax;
    // The arc fraction of the nearest sample, for uv.x.
    let near = 0, best = Infinity;
    points.forEach((p, k) => {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
      if (d < best) { best = d; near = k; }
    });
    const v0 = cols * 2 + t * 4;
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([l, w], j) => {
      const v = v0 + j, o = v * 3;
      const lx = ax * tickHalfLength * l, ly = ay * tickHalfLength * l, lz = az * tickHalfLength * l;
      const wx = cx * halfWidth * w, wy = cy * halfWidth * w, wz = cz * halfWidth * w;
      pos[o] = q.x + lx + wx; pos[o + 1] = q.y + ly + wy; pos[o + 2] = q.z + lz + wz;
      along[o] = lx; along[o + 1] = ly; along[o + 2] = lz;
      side[o] = wx; side[o + 1] = wy; side[o + 2] = wz;
      uv[v * 2] = arc[near] / total; uv[v * 2 + 1] = w < 0 ? 0 : 1;
    });
    index.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 3));
  g.setAttribute("aAlong", new THREE.BufferAttribute(along, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
