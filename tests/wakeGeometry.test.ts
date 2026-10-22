import { describe, it, expect } from "vitest";
import * as THREE from "three";
// meshline is drei's own dependency (its <Trail>): the reference this port must match.
import { MeshLineGeometry } from "meshline";
import { WakeGeometry } from "../src/components/canvas/wakeGeometry";

const taper = (t: number) => t * t;
const attrs = ["position", "previous", "next", "side", "width", "uv", "counters"] as const;

/** Both geometries after the same history: drei's points buffer handed to meshline, and ours. */
function both(history: THREE.Vector3[], n: number) {
  const wake = new WakeGeometry(n, taper);
  wake.reset(history[0]);
  for (const p of history.slice(1)) wake.push(p);
  const line = new MeshLineGeometry();
  line.setPoints(wake.points, taper);
  return { wake, line };
}

describe("WakeGeometry", () => {
  it("matches meshline attribute for attribute, index included, on a moving history", () => {
    const history = Array.from({ length: 50 }, (_, i) => new THREE.Vector3(Math.sin(i * 0.3) * 4, i * 0.25, Math.cos(i * 0.2) * 3));
    const { wake, line } = both(history, 35);
    for (const name of attrs) {
      expect(Array.from(wake.getAttribute(name).array), name).toEqual(Array.from(line.getAttribute(name).array).map((v) => Math.fround(v)));
    }
    expect(Array.from(wake.getIndex()!.array)).toEqual(Array.from(line.getIndex()!.array));
  });

  it("matches meshline on a fresh history (every point the same: a closed line)", () => {
    const { wake, line } = both([new THREE.Vector3(1, 2, 3)], 35);
    for (const name of ["position", "previous", "next"] as const) {
      expect(Array.from(wake.getAttribute(name).array), name).toEqual(Array.from(line.getAttribute(name).array));
    }
  });

  it("allocates its attributes once: a push rewrites the same arrays", () => {
    const wake = new WakeGeometry(35, taper);
    wake.reset(new THREE.Vector3());
    const before = attrs.map((a) => wake.getAttribute(a).array);
    wake.push(new THREE.Vector3(1, 0, 0));
    expect(attrs.map((a) => wake.getAttribute(a).array)).toEqual(before);
    attrs.forEach((a, i) => expect(wake.getAttribute(a).array).toBe(before[i]));
  });
});
