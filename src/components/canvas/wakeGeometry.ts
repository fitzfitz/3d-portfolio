import * as THREE from "three";

/**
 * The cargo wake's ribbon (EngineWake.tsx): meshline's MeshLineGeometry
 * attributes for a fixed-length point history, allocated once and rewritten
 * in place each frame. tests/wakeGeometry.test.ts holds it equal to
 * meshline's own setPoints output.
 */

/** Point a of P equals point b (meshline's compareV3). */
function samePoint(P: Float32Array, a: number, b: number): boolean {
  return P[3 * a] === P[3 * b] && P[3 * a + 1] === P[3 * b + 1] && P[3 * a + 2] === P[3 * b + 2];
}
/** Writes point k of P into vertex pair `pair` of arr (both of the pair's vertices). */
function putPair(arr: Float32Array, pair: number, P: Float32Array, k: number): void {
  const o = pair * 6, s = k * 3;
  arr[o] = arr[o + 3] = P[s];
  arr[o + 1] = arr[o + 4] = P[s + 1];
  arr[o + 2] = arr[o + 5] = P[s + 2];
}

export class WakeGeometry extends THREE.BufferGeometry {
  /** The point history, oldest first (drei's useTrail buffer). */
  readonly points: Float32Array;
  private readonly n: number;
  private readonly position: THREE.BufferAttribute;
  private readonly previous: THREE.BufferAttribute;
  private readonly next: THREE.BufferAttribute;

  constructor(n: number, widthAt: (t: number) => number) {
    super();
    this.n = n;
    this.points = new Float32Array(n * 3);
    const v = n * 2;
    this.position = new THREE.BufferAttribute(new Float32Array(v * 3), 3);
    this.previous = new THREE.BufferAttribute(new Float32Array(v * 3), 3);
    this.next = new THREE.BufferAttribute(new Float32Array(v * 3), 3);
    for (const a of [this.position, this.previous, this.next]) a.setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(v), width = new Float32Array(v), uv = new Float32Array(v * 2), counters = new Float32Array(v);
    const index = new Uint16Array((n - 1) * 6);
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1);
      side[2 * j] = 1; side[2 * j + 1] = -1;
      width[2 * j] = width[2 * j + 1] = widthAt(t);
      uv.set([t, 0, t, 1], 4 * j);
      // meshline's own counter for a flat array input: j·3 / (3n − 1).
      counters[2 * j] = counters[2 * j + 1] = (3 * j) / (3 * n - 1);
      if (j < n - 1) index.set([2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 2, 2 * j + 1, 2 * j + 3], 6 * j);
    }
    this.setAttribute("position", this.position);
    this.setAttribute("previous", this.previous);
    this.setAttribute("next", this.next);
    this.setAttribute("side", new THREE.BufferAttribute(side, 1));
    this.setAttribute("width", new THREE.BufferAttribute(width, 1));
    this.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    this.setAttribute("counters", new THREE.BufferAttribute(counters, 1));
    this.setIndex(new THREE.BufferAttribute(index, 1));
  }

  /** Every point at p, as drei fills the history when its target arrives. */
  reset(p: THREE.Vector3): void {
    for (let k = 0; k < this.n; k++) {
      this.points[3 * k] = p.x; this.points[3 * k + 1] = p.y; this.points[3 * k + 2] = p.z;
    }
    this.rebuild();
  }

  /** Drops the oldest point and appends p (drei's shiftLeft and set). */
  push(p: THREE.Vector3): void {
    const pts = this.points;
    pts.copyWithin(0, 3);
    const last = pts.length - 3;
    pts[last] = p.x; pts[last + 1] = p.y; pts[last + 2] = p.z;
    this.rebuild();
  }

  /** meshline's process(): each point twice, its neighbours beside it, ends closed when the line is. */
  private rebuild(): void {
    const n = this.n, P = this.points;
    const pos = this.position.array as Float32Array, prev = this.previous.array as Float32Array, next = this.next.array as Float32Array;
    const closed = samePoint(P, 0, n - 1);
    for (let j = 0; j < n; j++) {
      putPair(pos, j, P, j);
      putPair(prev, j, P, j === 0 ? (closed ? n - 2 : 0) : j - 1);
      putPair(next, j, P, j === n - 1 ? (closed ? 1 : n - 1) : j + 1);
    }
    this.position.needsUpdate = this.previous.needsUpdate = this.next.needsUpdate = true;
    this.computeBoundingSphere();
  }
}

