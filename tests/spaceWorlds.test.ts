import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { STAR_RENDER_ORDER } from "../src/components/canvas/starLayer";
import { planets } from "../src/constants";
import { WORLDS, WORLD_IDS } from "../src/data/worlds";
import { orbitPosition } from "../src/utils/orbits";
import { clearScannables, nearestScannable } from "../src/utils/scannables";
import { bodies, worldVisibility } from "../src/store/spaceStore";
import { occluders, worldSlot } from "../src/components/canvas/sunShadow";
import { updateWorlds, showChartedOrbits } from "../src/components/canvas/worldDrive";
import { worldMeshScale } from "../src/utils/worldSpin";

beforeEach(() => clearScannables());

describe("updateWorlds (SpaceWorlds' frame drive)", () => {
  it("writes one bodies entry per world, where its orbit puts it", () => {
    const out: Record<string, { x: number; y: number; z: number }> = {};
    for (const w of WORLDS) out[w.id] = { x: 0, y: 0, z: 0 };
    const kept = { ...out };
    updateWorlds(123.4, out);
    expect(Object.keys(out).sort()).toEqual([...WORLD_IDS].sort());
    for (const w of WORLDS) {
      const p = orbitPosition(w.orbit, 123.4);
      expect(out[w.id]).toBe(kept[w.id]); // written in place: frame loops allocate nothing
      expect(out[w.id].x).toBeCloseTo(p.x, 9);
      expect(out[w.id].y).toBeCloseTo(p.y, 9);
      expect(out[w.id].z).toBeCloseTo(p.z, 9);
    }
  });

  it("registers one scannable per world, labelled WORLD_<name>, measured from its surface", () => {
    const out: Record<string, { x: number; y: number; z: number }> = {};
    for (const w of WORLDS) out[w.id] = { x: 0, y: 0, z: 0 };
    updateWorlds(40, out);
    for (const w of WORLDS) {
      const b = out[w.id];
      const hit = nearestScannable(b.x, b.y, b.z, 1);
      expect(hit).toEqual({ id: w.id, label: "WORLD_" + w.name, dist: -w.size });
    }
  });

  it("writes each slotted world's occluder at its position, with its equatorial radius", () => {
    const out: Record<string, { x: number; y: number; z: number }> = {};
    for (const w of WORLDS) out[w.id] = { x: 0, y: 0, z: 0 };
    updateWorlds(77, out);
    for (const w of WORLDS) {
      const slot = worldSlot(w.id);
      if (slot < 0) continue;
      expect(occluders[slot]).toEqual({ ...out[w.id], r: w.size });
    }
  });
});

describe("the worlds in the shared state", () => {
  it("bodies is seeded with the planets and every world, so the tour visits the worlds", () => {
    expect(Object.keys(bodies).sort()).toEqual([...planets.map((p) => p.name), ...WORLD_IDS].sort());
    for (const w of WORLDS) expect(bodies[w.id]).toBeDefined();
  });

  it("worldVisibility starts with every world uncharted", () => {
    expect(Object.keys(worldVisibility).sort()).toEqual([...WORLD_IDS].sort());
    for (const id of WORLD_IDS) expect(worldVisibility[id]).toEqual({ charted: false });
  });
});

describe("showChartedOrbits (the charted worlds' orbit lines)", () => {
  it("shows a world's line only once it is charted, and hides it again if not", () => {
    const lines = WORLDS.map(() => ({ visible: true }));
    const vis = Object.fromEntries(WORLD_IDS.map((id) => [id, { charted: false }])) as typeof worldVisibility;
    showChartedOrbits(lines, vis);
    expect(lines.map((l) => l.visible)).toEqual(WORLDS.map(() => false));
    vis["w-ringed"].charted = true;
    showChartedOrbits(lines, vis);
    expect(lines.map((l) => l.visible)).toEqual(WORLDS.map((w) => w.id === "w-ringed"));
  });

  it("skips a line that has not mounted yet", () => {
    const lines = WORLDS.map((_, i) => (i === 0 ? null : { visible: false }));
    expect(() => showChartedOrbits(lines, worldVisibility)).not.toThrow();
  });
});

describe("worldMeshScale", () => {
  it("flattens the ringed giant to [1, 0.9, 1] in its own frame and leaves the rest round", () => {
    for (const w of WORLDS) {
      expect(worldMeshScale(w)).toEqual(w.id === "w-ringed" ? [1, 0.9, 1] : [1, 1, 1]);
    }
  });
});

describe("the worlds' transparent layers' draw order", () => {
  it("is limb, atmosphere, ring, all between the stars and the order-0 transparents (the ring depth-sorts with them)", () => {
    const src = readFileSync("src/components/canvas/SpaceWorlds.tsx", "utf8");
    const m = src.match(/const WORLD_RENDER_ORDER = \{ limb: (-?[\d.]+), atmosphere: (-?[\d.]+), ring: (-?[\d.]+) \} as const;/);
    expect(m).not.toBeNull();
    const [limb, atmosphere, ring] = m!.slice(1).map(Number);
    expect(limb).toBeGreaterThan(STAR_RENDER_ORDER);
    expect(atmosphere).toBeGreaterThan(limb);
    expect(ring).toBeGreaterThan(atmosphere);
    // Above 0 the ring would draw after every order-0 transparent, the ship's
    // plume in front of it included, whatever their depths.
    expect(ring).toBe(0);
    for (const k of ["limb", "atmosphere", "ring"]) expect(src).toContain(`renderOrder={WORLD_RENDER_ORDER.${k}}`);
  });
});
