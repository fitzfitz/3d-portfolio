import { describe, it, expect } from "vitest";
import {
  resolveWorldContact, SHIP_HALF_LENGTH, keepCameraOutsideBodies, keepOutside, bodyCameraRadius, CAMERA_CLEARANCE,
  SOLID_BODIES,
} from "../src/utils/worldCollide";
import { CHASE_CAM, chaseCamTarget } from "../src/utils/chaseCam";
import { bodies } from "../src/store/spaceStore";
import { PLAYER_SHIP_SCALE, SHIP_WARP_SPEED } from "../src/constants";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { moonCenters } from "../src/store/moonState";
import { G_MAX } from "../src/utils/gravityWell";
import { JD_J2000, orbitShape, visVivaKmS } from "../src/utils/ephemeris";
import { KM_PER_UNIT, SECONDS_PER_GAME_SECOND } from "../src/utils/realUnits";

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
  describe.each(SOLAR_BODIES.map((b) => [b.id, b.size] as const))("a warp run at %s (size %d)", (_id, size) => {
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

    it("a body moving onto a stationary ship pushes it out", () => {
      const c = { x: 0, y: 0, z: 0 };
      const pos = { x: reach + 2, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 200; i++) {
        c.x += 3.5 * DT; // faster than any body along its orbit (Mercury at perihelion, ~3.4 u/s)
        resolveWorldContact(pos, vel, c, size);
        expect(dist(pos, c)).toBeGreaterThanOrEqual(reach);
      }
    });
  });
});

/** Every centre SOLID_BODIES needs, as Spaceship reads them: `bodies` plus `moonCenters` (empty until Task 14). */
const allCenters = () => ({ ...bodies, ...moonCenters });
/** A body's fastest orbital speed (u/s): vis-viva at perihelion, on the orrery clock. */
const fastest = (id: (typeof SOLAR_BODIES)[number]["id"]) => {
  const s = orbitShape(bodyById(id).orbit.el, JD_J2000);
  return (visVivaKmS(s.a * (1 - s.e), s.a) * SECONDS_PER_GAME_SECOND) / KM_PER_UNIT;
};

describe("SOLID_BODIES (the nine bodies: everything the ship cannot fly through)", () => {
  it("lists every body in BODY_IDS order, at its equatorial size", () => {
    expect(SOLID_BODIES.map((b) => b.id)).toEqual(SOLAR_BODIES.map((b) => b.id));
    expect(SOLID_BODIES.map((b) => b.size)).toEqual(SOLAR_BODIES.map((b) => b.size));
  });

  it("has a centre for every body in `bodies`; the moons hold none yet", () => {
    const centers = allCenters();
    for (const b of SOLID_BODIES) expect(centers[b.id], b.id).toBeDefined();
    expect(Object.keys(moonCenters)).toEqual([]);
  });

  // A check after each step cannot tunnel through a moving body: the furthest
  // the ship and the body close in one 0.05 s step (warp + the gravity cap +
  // the body's own speed) is under the contact sphere's diameter.
  it("no body can be tunnelled through at the 0.05 s dt clamp, its orbital speed included", () => {
    for (const b of SOLAR_BODIES) {
      const step = (SHIP_WARP_SPEED + G_MAX + fastest(b.id)) * DT;
      expect(step, b.id).toBeLessThan(2 * (b.size + SHIP_HALF_LENGTH));
    }
    expect(fastest("mercury")).toBeGreaterThan(3);
    expect(fastest("mercury")).toBeLessThan(3.5);
  });

  it("keeps the camera past a body's atmosphere shell (its look.atmosphere thickness), or its surface", () => {
    for (const b of SOLAR_BODIES) {
      const s = SOLID_BODIES.find((x) => x.id === b.id)!;
      expect(s.cameraR, b.id).toBeCloseTo(b.size * (b.look.atmosphere?.thickness ?? 1) + CAMERA_CLEARANCE, 12);
      expect(s.cameraR, b.id).toBeCloseTo(bodyCameraRadius(b), 12);
    }
    // Earth's cloud shell (1.03 R) lies inside its atmosphere's.
    expect(bodyById("earth").look.atmosphere!.thickness).toBeGreaterThan(1.03);
  });

  // The capture net used to stop a ship at a planet by docking it; now the
  // surface does (spec §4.4).
  describe.each(SOLAR_BODIES.map((b) => [b.id, b.size] as const))("a ship driven into %s at 39 u/s stops at its surface (size %d)", (id, size) => {
    const reach = size + SHIP_HALF_LENGTH;
    it("2 s at 60 Hz with warp held at the centre: never inside, never through", () => {
      const c = { x: -80, y: 14, z: 60 };
      const centers = { ...allCenters(), [id]: c };
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

describe("keepCameraOutsideBodies (the spec's reason for solid surfaces: the camera never ends up inside a body)", () => {
  it("keeps the whole near plane (0.1, corners < 0.3 at 86° on 2.5:1) outside the outermost shell", () => {
    const halfV = 0.1 * Math.tan((86 / 2) * Math.PI / 180);
    expect(Math.hypot(0.1, halfV, halfV * 2.5)).toBeLessThan(CAMERA_CLEARANCE);
    const neptune = bodyById("neptune");
    expect(bodyCameraRadius(neptune)).toBeGreaterThan(neptune.size * neptune.look.atmosphere!.thickness);
  });

  // The camera kept outside each body's atmosphere shell (or its surface).
  describe.each(SOLID_BODIES.map((b) => [b.id, b] as const))("camera kept outside %s's outermost shell, with the ship parked nose-out at its contact radius", (id, w) => {
    const shell = w.size * (bodyById(id as (typeof SOLAR_BODIES)[number]["id"]).look.atmosphere?.thickness ?? 1);
    // Away from the origin and off the plane, so no axis is special.
    const c = { x: 140, y: -12, z: -75 };
    const centers = { ...allCenters(), [id]: c };
    const dirs = [
      { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
      { x: 0.6, y: -0.48, z: 0.64 },
    ];

    it.each(dirs.map((d, i) => [i, d] as const))("outward direction %i: the camera ends at or beyond the body's camera radius", (_i, n) => {
      const len = Math.hypot(n.x, n.y, n.z);
      const nose = { x: n.x / len, y: n.y / len, z: n.z / len };
      // Rest where resolveWorldContact leaves the ship (start inside: 2 u,
      // or half the contact radius for a moon smaller than that).
      const k = Math.min(2, (w.size + SHIP_HALF_LENGTH) / 2);
      const pos = { x: c.x + nose.x * k, y: c.y + nose.y * k, z: c.z + nose.z * k }, vel = { x: 0, y: 0, z: 0 };
      expect(resolveWorldContact(pos, vel, c, w.size)).toBe(true);
      const side = { x: 0, y: 0, z: 0 };
      for (const [distance, height] of [
        [CHASE_CAM.distance, CHASE_CAM.height],
        [CHASE_CAM.distance + CHASE_CAM.speedGain, CHASE_CAM.height],
        [CHASE_CAM.warpDistance, CHASE_CAM.warpHeight],
      ] as const) {
        const cam = chaseCamTarget({ x: 0, y: 0, z: 0 }, pos, nose, distance, height, side);
        // Nose-out puts the chase framing behind the ship, inside the body:
        // the collider alone does not keep the camera out (the finding).
        // (A body smaller than the chase distance: the camera lands past it.)
        if (n.y === 0 && w.size > distance) expect(dist(cam, c)).toBeLessThan(w.size);
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

  it("leaves a camera clear of every body untouched", () => {
    const cam = { x: 0, y: 500, z: 0 };
    keepCameraOutsideBodies(cam, bodies);
    expect(cam).toEqual({ x: 0, y: 500, z: 0 });
  });
});
