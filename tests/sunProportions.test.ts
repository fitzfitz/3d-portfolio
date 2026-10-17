import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SUN_RADIUS, planets } from "../src/constants";
import { SUN_COLLIDER, ASTEROID_COLLIDERS } from "../src/data/asteroids";
import { SHARDS } from "../src/data/shards";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import { JELLY_PATH } from "../src/data/jellyfishPath";
import { CORONA_SIZE } from "../src/components/canvas/sunMaterials";
import { SUN_SHADOW_CORE_GLSL } from "../src/components/canvas/sunShadow";

const BELT_INNER = 40;
const clear = SUN_COLLIDER.r + 4;

describe("L35 a sun bigger than its planets", () => {
  it("the core is 24 and the collider wraps it", () => {
    expect(SUN_RADIUS).toBe(24);
    expect(SUN_COLLIDER.r).toBe(25.5);
    for (const p of planets) expect(SUN_RADIUS).toBeGreaterThan(p.size);
  });
  it("the corona ends before the belt's inner edge", () => {
    expect(CORONA_SIZE / 2).toBeGreaterThan(SUN_RADIUS);
    expect(CORONA_SIZE / 2).toBeLessThan(BELT_INNER);
  });
  it("shards, ring gates, asteroids and the jelly path keep clear of the sun", () => {
    for (const s of SHARDS) expect(Math.hypot(...s.pos), `shard ${s.pos}`).toBeGreaterThanOrEqual(clear);
    for (const g of RING_GATES) expect(Math.hypot(...g), `gate ${g}`).toBeGreaterThanOrEqual(clear + RING_RADIUS);
    for (const c of ASTEROID_COLLIDERS) expect(Math.hypot(c.x, c.y, c.z), c.id).toBeGreaterThanOrEqual(clear + c.r);
    for (let i = 0; i < 800; i++) {
      const p: THREE.Vector3 = JELLY_PATH.getPointAt(i / 800);
      expect(p.length(), `jelly ${i}`).toBeGreaterThanOrEqual(clear);
    }
  });
  it("the shadow GLSL takes the sun radius from SUN_RADIUS", () => {
    expect(SUN_SHADOW_CORE_GLSL).toContain("#define SUN_SHADOW_RADIUS 24.0");
  });
});
