import { describe, it, expect } from "vitest";
import {
  resolveWorldContact, SHIP_HALF_LENGTH, keepCameraOutsideBodies, keepOutside, worldCameraRadius, ICE_GIANT_SHELL, CAMERA_CLEARANCE,
  SOLID_BODIES,
} from "../src/utils/worldCollide";
import { CHASE_CAM, chaseCamTarget } from "../src/utils/chaseCam";
import { bodies } from "../src/store/spaceStore";
import { PLAYER_SHIP_SCALE, SHIP_WARP_SPEED, planets } from "../src/constants";
import { WORLDS } from "../src/data/worlds";
import { PLANET_ATMOSPHERES } from "../src/data/planetAtmospheres";

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

describe("SOLID_BODIES (planets, then worlds: everything the ship cannot fly through)", () => {
  it("lists every planet, then every world, at its equatorial size", () => {
    expect(SOLID_BODIES.map((b) => b.id)).toEqual([...planets.map((p) => p.name), ...WORLDS.map((w) => w.id)]);
    expect(SOLID_BODIES.map((b) => b.size)).toEqual([...planets.map((p) => p.size), ...WORLDS.map((w) => w.size)]);
  });

  it("keeps the camera past a planet's atmosphere shell (SpacePlanets' Atmosphere thickness) and a world's outermost shell", () => {
    for (const p of planets) {
      const b = SOLID_BODIES.find((s) => s.id === p.name)!;
      expect(PLANET_ATMOSPHERES[p.name].thickness, p.name).toBeGreaterThan(1);
      expect(b.cameraR, p.name).toBeCloseTo(p.size * PLANET_ATMOSPHERES[p.name].thickness + CAMERA_CLEARANCE, 12);
    }
    for (const w of WORLDS) expect(SOLID_BODIES.find((s) => s.id === w.id)!.cameraR, w.id).toBeCloseTo(worldCameraRadius(w), 12);
  });

  // The capture net used to stop a ship at a planet by docking it; now the
  // surface does, as it does at a world.
  describe.each(planets.map((p) => [p.name, p.size] as const))("a ship driven into each planet at 39 u/s stops at its surface: %s (size %d)", (id, size) => {
    const reach = size + SHIP_HALF_LENGTH;
    it("2 s at 60 Hz with warp held at the centre: never inside, never through", () => {
      const c = { x: -80, y: 14, z: 60 };
      const centers = { ...bodies, [id]: c };
      const pos = { x: c.x - reach - 30, y: c.y + 0.4, z: c.z }, vel = { x: 0, y: 0, z: 0 };
      const dt = 1 / 60;
      let hits = 0;
      for (let i = 0; i < 120; i++) {
        const d = dist(pos, c);
        vel.x = (c.x - pos.x) / d * SHIP_WARP_SPEED; vel.y = (c.y - pos.y) / d * SHIP_WARP_SPEED; vel.z = (c.z - pos.z) / d * SHIP_WARP_SPEED;
        pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
        // Spaceship's loop: every solid body, first contact wins.
        for (const b of SOLID_BODIES) if (resolveWorldContact(pos, vel, centers[b.id], b.size)) { hits++; break; }
        expect(dist(pos, c), `step ${i}`).toBeGreaterThanOrEqual(reach);
        expect(pos.x, `step ${i}: passed through to the far side`).toBeLessThan(c.x);
      }
      expect(hits).toBeGreaterThan(0);
    });
  });
});

describe("keepOutside", () => {
  it("pushes a point inside the radius out to it, along the same direction", () => {
    const p = { x: 3, y: 4, z: 0 }; // 5u from the centre
    keepOutside(p, { x: 0, y: 0, z: 0 }, 18);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(18);
    expect(p.y / p.x).toBeCloseTo(4 / 3);
  });
  it("leaves a point already outside alone", () => {
    const p = { x: 30, y: 0, z: 0 };
    keepOutside(p, { x: 0, y: 0, z: 0 }, 18);
    expect(p).toEqual({ x: 30, y: 0, z: 0 });
  });
  it("handles a point exactly at the centre", () => {
    const p = { x: 5, y: 5, z: 5 };
    keepOutside(p, { x: 5, y: 5, z: 5 }, 18);
    expect(Math.hypot(p.x - 5, p.y - 5, p.z - 5)).toBeCloseTo(18);
  });
});

describe("keepCameraOutsideBodies (the spec's reason for solid surfaces: the camera never ends up inside a planet or a world)", () => {
  const camRadius = (w: (typeof WORLDS)[number]) => w.size * (w.type === "ice-giant" ? ICE_GIANT_SHELL : 1) + CAMERA_CLEARANCE;

  it("keeps the whole near plane (0.1, corners < 0.3 at 86° on 2.5:1) outside the outermost shell", () => {
    const halfV = 0.1 * Math.tan((86 / 2) * Math.PI / 180);
    expect(Math.hypot(0.1, halfV, halfV * 2.5)).toBeLessThan(CAMERA_CLEARANCE);
    for (const w of WORLDS) expect(worldCameraRadius(w)).toBeCloseTo(camRadius(w), 12);
    expect(worldCameraRadius(WORLDS.find((w) => w.type === "ice-giant")!)).toBeGreaterThan(WORLDS.find((w) => w.type === "ice-giant")!.size * 1.04);
  });

  // For a planet: the camera kept outside each planet's atmosphere shell.
  describe.each(SOLID_BODIES.map((b) => [b.id, b] as const))("camera kept outside %s's outermost shell, with the ship parked nose-out at its contact radius", (id, w) => {
    const shell = w.size * (PLANET_ATMOSPHERES[id]?.thickness ?? 1);
    // Away from the origin and off the plane, so no axis is special.
    const c = { x: 140, y: -12, z: -75 };
    const centers = { ...bodies, [id]: c };
    const dirs = [
      { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
      { x: 0.6, y: -0.48, z: 0.64 },
    ];

    it.each(dirs.map((d, i) => [i, d] as const))("outward direction %i: the camera ends at or beyond the body's camera radius", (_i, n) => {
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
        keepCameraOutsideBodies(cam, centers);
        expect(dist(cam, c)).toBeGreaterThanOrEqual(w.cameraR - 1e-9);
        expect(dist(cam, c)).toBeGreaterThan(shell);
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
        keepCameraOutsideBodies(cam, centers);
        expect(dist(cam, c), `frame ${i}`).toBeGreaterThanOrEqual(w.cameraR - 1e-9);
      }
      expect(hit).toBe(true);
    });
  });

  it("leaves a camera clear of every planet and world untouched", () => {
    const cam = { x: 0, y: 500, z: 0 };
    keepCameraOutsideBodies(cam, bodies);
    expect(cam).toEqual({ x: 0, y: 500, z: 0 });
  });
});
