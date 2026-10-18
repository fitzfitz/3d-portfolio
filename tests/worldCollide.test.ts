import { describe, it, expect } from "vitest";
import {
  resolveWorldContact, SHIP_HALF_LENGTH, keepCameraOutsideWorlds, worldCameraRadius, ICE_GIANT_SHELL, CAMERA_CLEARANCE,
} from "../src/utils/worldCollide";
import { CHASE_CAM, chaseCamTarget } from "../src/utils/chaseCam";
import { bodies } from "../src/store/spaceStore";
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

describe("keepCameraOutsideWorlds (the spec's reason for solid surfaces: the camera never ends up inside a world)", () => {
  const camRadius = (w: (typeof WORLDS)[number]) => w.size * (w.type === "ice-giant" ? ICE_GIANT_SHELL : 1) + CAMERA_CLEARANCE;

  it("keeps the whole near plane (0.1, corners < 0.3 at 86° on 2.5:1) outside the outermost shell", () => {
    const halfV = 0.1 * Math.tan((86 / 2) * Math.PI / 180);
    expect(Math.hypot(0.1, halfV, halfV * 2.5)).toBeLessThan(CAMERA_CLEARANCE);
    for (const w of WORLDS) expect(worldCameraRadius(w)).toBeCloseTo(camRadius(w), 12);
    expect(worldCameraRadius(WORLDS.find((w) => w.type === "ice-giant")!)).toBeGreaterThan(WORLDS.find((w) => w.type === "ice-giant")!.size * 1.04);
  });

  describe.each(WORLDS.map((w) => [w.id, w] as const))("a ship parked nose-out at %s's contact radius", (id, w) => {
    // Away from the origin and off the plane, so no axis is special.
    const c = { x: 140, y: -12, z: -75 };
    const centers = { ...bodies, [id]: c };
    const dirs = [
      { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
      { x: 0.6, y: -0.48, z: 0.64 },
    ];

    it.each(dirs.map((d, i) => [i, d] as const))("outward direction %i: the camera ends at or beyond the world's radius", (_i, n) => {
      const len = Math.hypot(n.x, n.y, n.z);
      const nose = { x: n.x / len, y: n.y / len, z: n.z / len };
      // Rest where resolveWorldContact leaves the ship.
      const pos = { x: c.x + nose.x * 2, y: c.y + nose.y * 2, z: c.z + nose.z * 2 }, vel = { x: 0, y: 0, z: 0 };
      expect(resolveWorldContact(pos, vel, c, w.size)).toBe(true);
      const side = { x: 0, y: 0, z: 0 };
      for (const [distance, height] of [
        [CHASE_CAM.distance, CHASE_CAM.height],
        [CHASE_CAM.distance + CHASE_CAM.speedGain, CHASE_CAM.height],
        [CHASE_CAM.warpDistance, CHASE_CAM.warpHeight],
      ] as const) {
        const cam = chaseCamTarget({ x: 0, y: 0, z: 0 }, pos, nose, distance, height, side);
        // Nose-out puts the chase framing behind the ship, inside the world:
        // the collider alone does not keep the camera out (the finding).
        if (n.y === 0) expect(dist(cam, c)).toBeLessThan(w.size);
        keepCameraOutsideWorlds(cam, centers);
        expect(dist(cam, c)).toBeGreaterThanOrEqual(worldCameraRadius(w) - 1e-9);
        expect(dist(cam, c)).toBeGreaterThanOrEqual(w.size);
      }
    });

    it("a lagging camera, lerped frame by frame while the ship bounces off and turns away, never ends a frame inside", () => {
      const pos = { x: c.x - w.size - 20, y: c.y + 0.5, z: c.z }, vel = { x: SHIP_WARP_SPEED, y: 0, z: 0 };
      const cam = { x: pos.x - CHASE_CAM.distance, y: pos.y + CHASE_CAM.height, z: pos.z };
      const target = { x: 0, y: 0, z: 0 }, side = { x: 0, y: 0, z: 0 };
      let hit = false;
      for (let i = 0; i < 200; i++) {
        pos.x += vel.x * DT; pos.y += vel.y * DT; pos.z += vel.z * DT;
        hit = resolveWorldContact(pos, vel, c, w.size) || hit;
        if (hit) { vel.x = 0; vel.y = 0; vel.z = 0; } // parked on the surface
        // Inbound nose, then turned to face away from the world (nose-out).
        const out = hit ? { x: (pos.x - c.x) / dist(pos, c), y: (pos.y - c.y) / dist(pos, c), z: (pos.z - c.z) / dist(pos, c) } : { x: 1, y: 0, z: 0 };
        chaseCamTarget(target, pos, out, CHASE_CAM.distance, CHASE_CAM.height, side);
        const f = 1 - Math.pow(1 - 0.05, DT * 60); // frameLerp(0.05, dt)
        cam.x += (target.x - cam.x) * f; cam.y += (target.y - cam.y) * f; cam.z += (target.z - cam.z) * f;
        keepCameraOutsideWorlds(cam, centers);
        expect(dist(cam, c), `frame ${i}`).toBeGreaterThanOrEqual(worldCameraRadius(w) - 1e-9);
      }
      expect(hit).toBe(true);
    });
  });

  it("leaves a camera clear of every world untouched", () => {
    const cam = { x: 0, y: 500, z: 0 };
    keepCameraOutsideWorlds(cam, bodies);
    expect(cam).toEqual({ x: 0, y: 500, z: 0 });
  });
});
