import { describe, it, expect } from "vitest";
import {
  CRYSTAL_LANDMARKS, CRYSTAL_MAX, CRYSTAL_RESPAWN_SECONDS, LANDMARK_KEEP_OUT, crystalAvoidPoints, isRejectedSpawn, randomCrystalPos, respawnTick,
} from "../src/utils/crystalField";
import { SYSTEM_RADIUS } from "../src/constants";
import { CRYSTAL_FIELD_RADIUS } from "../src/utils/crystalField";
import { DESTINATIONS } from "../src/data/destinations";
import { GATE_POS } from "../src/data/dormantGate";
import { PORTAL_POS, LOCK_RETAIN_FACTOR as RETAIN } from "../src/constants";
import { SOLAR_BODIES } from "../src/data/solarSystem";

describe("isRejectedSpawn", () => {
  it("has no static belt exclusion: the old band and halo radii are accepted", () => {
    for (const p of [[55, 0, 0], [0, 0, 45], [88, 0, 0], [0, 88, 0], [20, 0, 0], [200, 0, 0]]) {
      expect(isRejectedSpawn(p[0], p[1], p[2], []), p.join(",")).toBe(false);
    }
  });

  it("rejects near an avoid point, and accepts outside its radius", () => {
    const avoid = [{ x: 200, y: 10, z: -100, r: 20 }];
    expect(isRejectedSpawn(205, 10, -100, avoid)).toBe(true);
    expect(isRejectedSpawn(230, 10, -100, avoid)).toBe(false);
  });

  it("measures avoid distance in 3D, not just the XZ plane", () => {
    // Discriminating on purpose. An XZ-only avoid check would drop the y term and
    // compute distance 0 for a point directly above the avoid centre, rejecting
    // it — so the ACCEPT case below is what actually catches that regression.
    const avoid = [{ x: 0, y: 0, z: 0, r: 20 }];
    // Inside the sphere in 3D: reject.
    expect(isRejectedSpawn(0, 15, 0, avoid)).toBe(true);
    // Directly above it but outside its radius in 3D: accept. An XZ-only test
    // would measure 0 here and wrongly reject.
    expect(isRejectedSpawn(0, 25, 0, avoid)).toBe(false);
  });
});

describe("randomCrystalPos", () => {
  it("keeps the inner system: the field is 480, well inside the 3,600 system (spec §6.4)", () => {
    expect(CRYSTAL_FIELD_RADIUS).toBe(480);
    expect(CRYSTAL_FIELD_RADIUS).toBeLessThan(SYSTEM_RADIUS);
    let s = 7;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 500; i++) expect(Math.hypot(...randomCrystalPos(rand, []))).toBeLessThanOrEqual(480);
  });

  it("stays inside the field's sphere", () => {
    let n = 0;
    const rand = () => [0.1, 0.9, 0.5, 0.3, 0.7, 0.2][n++ % 6];
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = randomCrystalPos(rand, []);
      expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(CRYSTAL_FIELD_RADIUS);
    }
  });

  it("returns a position that passes its own rejection test", () => {
    // Deterministic sequence so the test cannot flake.
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = randomCrystalPos(rand, [{ x: 0, y: 0, z: 0, r: 30 }]);
      expect(isRejectedSpawn(x, y, z, [{ x: 0, y: 0, z: 0, r: 30 }])).toBe(false);
    }
  });

  it("gives up rather than looping forever when everything is rejected", () => {
    // An avoid point swallowing the entire volume: must still return, not hang.
    const impossible = [{ x: 0, y: 0, z: 0, r: 10_000 }];
    const pos = randomCrystalPos(() => 0.5, impossible);
    expect(pos).toHaveLength(3);
    expect(pos.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("respawnTick", () => {
  it("emits no spawn before the interval elapses", () => {
    const r = respawnTick(0, 1);
    expect(r.spawns).toBe(0);
    expect(r.accum).toBeCloseTo(1);
  });

  it("emits one spawn when the interval is reached and keeps the remainder", () => {
    const r = respawnTick(CRYSTAL_RESPAWN_SECONDS - 0.1, 0.3);
    expect(r.spawns).toBe(1);
    expect(r.accum).toBeCloseTo(0.2);
  });

  it("emits multiple spawns for a large dt rather than losing them", () => {
    const r = respawnTick(0, CRYSTAL_RESPAWN_SECONDS * 3 + 1);
    expect(r.spawns).toBe(3);
    expect(r.accum).toBeCloseTo(1);
  });

  it("has a sane cap so CRYSTAL_MAX is reachable but not absurd", () => {
    expect(CRYSTAL_MAX).toBeGreaterThan(10);
    expect(CRYSTAL_MAX).toBeLessThanOrEqual(60);
  });
});

describe("crystalAvoidPoints", () => {
  it("keeps every landmark clear, not only the portal", () => {
    const avoid = crystalAvoidPoints([], [[0, 95, -150], [0, -108, 156]], { x: 0, y: 0, z: 0 });
    expect(isRejectedSpawn(0, -108 + LANDMARK_KEEP_OUT - 1, 156, avoid)).toBe(true);
    expect(isRejectedSpawn(0, 95, -150 + LANDMARK_KEEP_OUT - 1, avoid)).toBe(true);
    expect(isRejectedSpawn(0, -108 + LANDMARK_KEEP_OUT + 1, 156, avoid)).toBe(false);
  });
});

describe("CRYSTAL_LANDMARKS", () => {
  it("covers every destination and the dormant gate", () => {
    for (const d of DESTINATIONS) expect(CRYSTAL_LANDMARKS).toContain(d.pos);
    expect(CRYSTAL_LANDMARKS).toContain(GATE_POS);
  });
  it("rejects a crystal spawn inside the gate's frame", () => {
    const avoid = crystalAvoidPoints([], CRYSTAL_LANDMARKS, { x: 0, y: 0, z: 0 });
    expect(isRejectedSpawn(GATE_POS[0], GATE_POS[1], GATE_POS[2], avoid)).toBe(true);
    expect(isRejectedSpawn(GATE_POS[0] + 14, GATE_POS[1], GATE_POS[2], avoid)).toBe(true);
  });
});

describe("crystal keep-out around a ringed body", () => {
  it("covers Saturn's ring reach (the A ring's 2.27 × size) when it lies beyond the lock-retain radius", async () => {
    const { RING_OUT } = await import("../src/utils/ringOptics");
    const { CRYSTAL_PICKUP_RADIUS } = await import("../src/utils/crystalField");
    const { LOCK_RETAIN_FACTOR } = await import("../src/constants");
    const { BODY_REACH } = await import("../src/data/solarSystem");
    const ringed = BODY_REACH.find((b) => b.key === "saturn")!;
    expect(ringed.reach).toBeCloseTo(ringed.size * RING_OUT);
    expect(ringed.reach).toBeGreaterThan(ringed.size * LOCK_RETAIN_FACTOR);
    // Far from the bands, the landmarks and the ship.
    const at = { x: 300, y: 0, z: 0 };
    const avoid = crystalAvoidPoints([{ ...at, size: ringed.size, reach: ringed.reach }], [], { x: -300, y: 0, z: 0 });
    // Inside the rings, past the lock-retain radius: rejected.
    expect(isRejectedSpawn(at.x + ringed.size * 2.2, 0, 0, avoid)).toBe(true);
    expect(isRejectedSpawn(at.x + ringed.reach + CRYSTAL_PICKUP_RADIUS - 0.1, 0, 0, avoid)).toBe(true);
    expect(isRejectedSpawn(at.x + ringed.reach + CRYSTAL_PICKUP_RADIUS + 0.1, 0, 0, avoid)).toBe(false);
  });

  it("keeps a body without rings at its lock-retain radius", async () => {
    const { CRYSTAL_PICKUP_RADIUS } = await import("../src/utils/crystalField");
    const { LOCK_RETAIN_FACTOR } = await import("../src/constants");
    const { BODY_REACH } = await import("../src/data/solarSystem");
    for (const b of BODY_REACH) if (b.key !== "saturn" && b.key !== "uranus") expect(b.reach, b.key).toBe(b.size);
    const avoid = crystalAvoidPoints([{ x: 300, y: 0, z: 0, size: 12, reach: 12 }], [], { x: -300, y: 0, z: 0 });
    expect(avoid[0].r).toBe(12 * LOCK_RETAIN_FACTOR + CRYSTAL_PICKUP_RADIUS);
  });
});

describe("crystal spawns near bodies", () => {
  it("rejects any spot inside a body's lock-retain radius", () => {
    const at = { x: 100, y: 0, z: 0 };
    const avoid = crystalAvoidPoints(
      SOLAR_BODIES.map((p) => ({ ...at, size: p.size })),
      [PORTAL_POS],
      { x: 0, y: 200, z: 0 },
    );
    for (const p of SOLAR_BODIES) {
      const r = p.size * RETAIN - 0.5;
      expect(isRejectedSpawn(at.x + r, at.y, at.z, avoid)).toBe(true);
    }
  });
});
