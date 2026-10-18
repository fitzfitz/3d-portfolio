import { describe, it, expect } from "vitest";
import {
  CRYSTAL_LANDMARKS, CRYSTAL_MAX, CRYSTAL_RESPAWN_SECONDS, LANDMARK_KEEP_OUT, crystalAvoidPoints, isRejectedSpawn, randomCrystalPos, respawnTick,
} from "../src/utils/crystalField";
import { SYSTEM_RADIUS } from "../src/constants";
import { DESTINATIONS } from "../src/data/destinations";
import { GATE_POS } from "../src/data/dormantGate";

describe("isRejectedSpawn", () => {
  it("rejects inside the asteroid belt band", () => {
    // Belt is radius 40-70, measured as distance from the origin.
    expect(isRejectedSpawn(55, 0, 0, [])).toBe(true);
    expect(isRejectedSpawn(0, 0, 45, [])).toBe(true);
  });

  it("rejects inside the polar halo band", () => {
    // Halo is radius 80-95.
    expect(isRejectedSpawn(88, 0, 0, [])).toBe(true);
  });

  it("measures the bands as 3D radius, so the tilted halo is covered", () => {
    // Both belt rings are TILTED (BeltMain 0.436 rad, BeltHalo 1.31 rad), and a
    // tilt preserves distance from the origin while destroying XZ radius. The
    // 75-degree halo at ring radius 88 therefore reaches y ~= 85 at an XZ radius
    // of only ~22 — so an XZ-radius test would happily place a crystal in the
    // thick of the halo. Straight up the pole at 88 units must reject.
    expect(isRejectedSpawn(0, 88, 0, [])).toBe(true);
    // And a point whose XZ radius lands in the belt band but whose true distance
    // is far outside it must be accepted.
    expect(isRejectedSpawn(55, 240, 0, [])).toBe(false);
  });

  it("accepts the gaps between and beyond the bands", () => {
    expect(isRejectedSpawn(20, 0, 0, [])).toBe(false);   // the belt's inner hole
    expect(isRejectedSpawn(75, 0, 0, [])).toBe(false);   // between belt and halo
    expect(isRejectedSpawn(200, 0, 0, [])).toBe(false);  // beyond both
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
    // Origin radius 25 also sits clear of the belt band (40-70), so only the
    // avoid logic decides these two verdicts.
    const avoid = [{ x: 0, y: 0, z: 0, r: 20 }];
    // Inside the sphere in 3D: reject.
    expect(isRejectedSpawn(0, 15, 0, avoid)).toBe(true);
    // Directly above it but outside its radius in 3D: accept. An XZ-only test
    // would measure 0 here and wrongly reject.
    expect(isRejectedSpawn(0, 25, 0, avoid)).toBe(false);
  });
});

describe("randomCrystalPos", () => {
  it("stays inside the system sphere", () => {
    let n = 0;
    const rand = () => [0.1, 0.9, 0.5, 0.3, 0.7, 0.2][n++ % 6];
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = randomCrystalPos(rand, []);
      expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(SYSTEM_RADIUS);
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
    // Both points are outside the belt bands and far from the ship.
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

describe("crystal keep-out around a ringed world", () => {
  it("covers the ring reach (2.3 × size) when it lies beyond the lock-retain radius", async () => {
    const { RING_REACH_FACTOR } = await import("../src/utils/ringOptics");
    const { CRYSTAL_PICKUP_RADIUS } = await import("../src/utils/crystalField");
    const { LOCK_RETAIN_FACTOR } = await import("../src/constants");
    const { PLANETS_AND_WORLDS } = await import("../src/data/worlds");
    const ringed = PLANETS_AND_WORLDS.find((b) => b.key === "w-ringed")!;
    expect(ringed.reach).toBeCloseTo(ringed.size * RING_REACH_FACTOR);
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
    const { PLANETS_AND_WORLDS } = await import("../src/data/worlds");
    for (const b of PLANETS_AND_WORLDS) if (b.key !== "w-ringed") expect(b.reach, b.key).toBe(b.size);
    const avoid = crystalAvoidPoints([{ x: 300, y: 0, z: 0, size: 12, reach: 12 }], [], { x: -300, y: 0, z: 0 });
    expect(avoid[0].r).toBe(12 * LOCK_RETAIN_FACTOR + CRYSTAL_PICKUP_RADIUS);
  });
});
