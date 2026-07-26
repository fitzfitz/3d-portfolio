import { describe, it, expect } from "vitest";
import {
  CRYSTAL_MAX, CRYSTAL_RESPAWN_SECONDS, isRejectedSpawn, randomCrystalPos, respawnTick,
} from "../src/utils/crystalField";
import { COSMIC_BOUNDS } from "../src/constants";

describe("isRejectedSpawn", () => {
  it("rejects inside the asteroid belt band", () => {
    // Belt is radius 40-70 in the XZ plane.
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
    // Directly above an avoid point, within its radius: must still reject.
    const avoid = [{ x: 0, y: 0, z: 200, r: 20 }];
    expect(isRejectedSpawn(0, 15, 200, avoid)).toBe(true);
  });
});

describe("randomCrystalPos", () => {
  it("stays inside the world bounds", () => {
    let n = 0;
    const rand = () => [0.1, 0.9, 0.5, 0.3, 0.7, 0.2][n++ % 6];
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = randomCrystalPos(rand, []);
      expect(Math.abs(x)).toBeLessThanOrEqual(COSMIC_BOUNDS);
      expect(Math.abs(y)).toBeLessThanOrEqual(COSMIC_BOUNDS);
      expect(Math.abs(z)).toBeLessThanOrEqual(COSMIC_BOUNDS);
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
