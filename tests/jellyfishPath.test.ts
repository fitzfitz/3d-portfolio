import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { JELLY_PATH, JELLY_NEAR_T, JELLY_LOOP_SECONDS } from "../src/data/jellyfishPath";
import { SPAWN } from "../src/data/spawn";
import { BUOYS, STATION_POS } from "../src/data/careerTrail";
import { PROBES } from "../src/data/probes";
import { SHIPYARD_POS } from "../src/data/shipyard";
import { GATE_POS } from "../src/data/dormantGate";
import { PORTAL_POS } from "../src/constants";

const at = (t: number) => JELLY_PATH.getPointAt(t);
const SPAWN_V = new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z);
const v = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2]);

describe("jellyfish path", () => {
  it("NEAR_T is a genuine near pass (within 80 units of the play-area center, 3D)", () => {
    expect(at(JELLY_NEAR_T).length()).toBeLessThan(80);
  });
  it("NEAR_T is the true closest approach (no sampled point is meaningfully closer)", () => {
    const near = at(JELLY_NEAR_T).length();
    for (let i = 0; i < 500; i++) {
      expect(at(i / 500).length()).toBeGreaterThan(near - 2);
    }
  });
  it("most of the loop stays far away (rare-sighting behavior)", () => {
    let far = 0;
    for (let i = 0; i < 100; i++) {
      if (at(i / 100).length() > 150) far++;
    }
    expect(far).toBeGreaterThan(70);
  });
  it("swims past the spawn pad once a loop, close enough to meet (findable)", () => {
    let near = Infinity;
    for (let i = 0; i < 500; i++) near = Math.min(near, at(i / 500).distanceTo(SPAWN_V));
    expect(near).toBeLessThan(30);
    expect(near).toBeGreaterThan(15); // past the pad, not through it
  });
  it("reaches the near pass about a minute after load, not at once", () => {
    const s = JELLY_NEAR_T * JELLY_LOOP_SECONDS;
    expect(s).toBeGreaterThan(40);
    expect(s).toBeLessThan(90);
  });
  it("drifts: a slow, smooth loop with no turn tighter than 30 u", () => {
    expect(JELLY_PATH.getLength() / JELLY_LOOP_SECONDS).toBeLessThan(3.2);
    const N = 480;
    const p = Array.from({ length: N }, (_, i) => at(i / N));
    for (let i = 0; i < N; i++) {
      const a = p[i], b = p[(i + 1) % N], c = p[(i + 2) % N];
      const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
      if (area < 1e-9) continue;
      const radius = (a.distanceTo(b) * b.distanceTo(c) * c.distanceTo(a)) / (4 * area);
      expect(radius, `t=${(i / N).toFixed(3)}`).toBeGreaterThan(30);
    }
  });
  it("keeps clear of the career trail, the station and the places pilots fly to", () => {
    const keep = [
      ...BUOYS.map((b) => ({ name: b.id, p: v(b.pos), r: 30 })),
      { name: "station", p: v(STATION_POS), r: 35 },
      ...PROBES.map((pr) => ({ name: `${pr.id} home`, p: v(pr.home), r: 20 })),
      { name: "shipyard", p: v(SHIPYARD_POS), r: 25 },
      { name: "gate", p: v(GATE_POS), r: 35 },
      { name: "portal", p: v(PORTAL_POS), r: 30 },
    ];
    for (let i = 0; i < 400; i++) {
      const q = at(i / 400);
      for (const k of keep) expect(q.distanceTo(k.p), `t=${i / 400} vs ${k.name}`).toBeGreaterThan(k.r);
    }
  });
});
