import { describe, it, expect } from "vitest";
import { resolveWorldContact, SHIP_HALF_LENGTH } from "../src/utils/worldCollide";
import { PLAYER_SHIP_SCALE, SHIP_WARP_SPEED } from "../src/constants";
import { WORLDS } from "../src/data/worlds";

const DT = 0.05; // Spaceship clamps dt here: the longest step a slow device takes
const dist = (p: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }) =>
  Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);

describe("resolveWorldContact", () => {
  it("measures the ship's half-length from its model (v1 footprint z ±3.5) at the scale it is drawn", () => {
    expect(SHIP_HALF_LENGTH).toBeCloseTo(3.5 * PLAYER_SHIP_SCALE, 12);
  });

  it("leaves a ship clear of the surface alone", () => {
    const pos = { x: 30, y: 0, z: 0 }, vel = { x: -5, y: 1, z: 0 };
    expect(resolveWorldContact(pos, vel, { x: 0, y: 0, z: 0 }, 15)).toBe(false);
    expect(pos).toEqual({ x: 30, y: 0, z: 0 });
    expect(vel).toEqual({ x: -5, y: 1, z: 0 });
  });

  // Review Focus 3: warp is 39 u/s; a step is 1.95 u at dt 0.05.
  describe.each(WORLDS.map((w) => [w.id, w.size] as const))("a warp run at %s (size %d)", (_id, size) => {
    const reach = size + SHIP_HALF_LENGTH;

    it("aimed at the centre with warp held throughout, never ends a step inside, never tunnels", () => {
      expect(SHIP_WARP_SPEED).toBe(39);
      const c = { x: 100, y: -20, z: 50 };
      const pos = { x: c.x - 60, y: c.y + 0.3, z: c.z }, vel = { x: 0, y: 0, z: 0 };
      let hits = 0;
      for (let i = 0; i < 200; i++) {
        // Warp assigns the velocity every frame, straight at the centre.
        const d = dist(pos, c);
        vel.x = (c.x - pos.x) / d * SHIP_WARP_SPEED; vel.y = (c.y - pos.y) / d * SHIP_WARP_SPEED; vel.z = (c.z - pos.z) / d * SHIP_WARP_SPEED;
        pos.x += vel.x * DT; pos.y += vel.y * DT; pos.z += vel.z * DT;
        if (resolveWorldContact(pos, vel, c, size)) {
          hits++;
          // The inward part of the velocity is reflected or zeroed.
          const n = { x: (pos.x - c.x) / dist(pos, c), y: (pos.y - c.y) / dist(pos, c), z: (pos.z - c.z) / dist(pos, c) };
          expect(vel.x * n.x + vel.y * n.y + vel.z * n.z).toBeGreaterThanOrEqual(0);
        }
        expect(dist(pos, c), `step ${i}`).toBeGreaterThanOrEqual(reach);
        expect(pos.x, `step ${i}: passed through to the far side`).toBeLessThan(c.x);
      }
      expect(hits).toBeGreaterThan(0);
    });

    it("bounces back out when the pilot lets go after the hit", () => {
      const c = { x: 0, y: 0, z: 0 };
      const pos = { x: -reach - 1, y: 0, z: 0 }, vel = { x: SHIP_WARP_SPEED, y: 0, z: 0 };
      let hit = false;
      for (let i = 0; i < 40; i++) {
        pos.x += vel.x * DT; pos.y += vel.y * DT; pos.z += vel.z * DT;
        hit = resolveWorldContact(pos, vel, c, size) || hit;
        expect(dist(pos, c)).toBeGreaterThanOrEqual(reach);
      }
      expect(hit).toBe(true);
      expect(vel.x).toBeLessThan(0);
      expect(pos.x).toBeLessThan(-reach);
    });

    it("a world moving onto a stationary ship pushes it out", () => {
      const c = { x: 0, y: 0, z: 0 };
      const pos = { x: reach + 2, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 200; i++) {
        c.x += 2 * DT; // worlds drift ~1-2 u/s along their orbits
        resolveWorldContact(pos, vel, c, size);
        expect(dist(pos, c)).toBeGreaterThanOrEqual(reach);
      }
    });
  });
});
