import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { SOURCES } from "../scripts/textures/fetch_nasa_maps.mjs";
import { BODY_MAPS } from "../scripts/textures/process_body_maps.mjs";

/**
 * Every shipped asset must have a script in this repo that makes it. Until
 * 2026-10-10 five shipped files (ship base mesh, portal, fuel crystal, Earth
 * and Mars maps) had no recorded source or licence; they were replaced by
 * scripted originals. Since the real Solar System (2026-10-20, spec §5.5)
 * the bodies' and moons' maps are NASA/USGS public-domain mosaics:
 * scripts/textures/fetch_nasa_maps.mjs pins each source's URL and SHA-256
 * (tests/bodyMaps.test.ts checks the licence evidence) and
 * process_body_maps.mjs makes the shipped file from it, or a seeded generator
 * makes it where no true-colour global map exists. This keeps an unowned file
 * from slipping back in: add the script first, then the asset.
 */
const MODEL_GENERATORS: Record<string, string> = {
  "spaceship.glb": "scripts/blender/gen_spaceship.py",
  "portal_gateway.glb": "scripts/blender/gen_portal.py",
  "space_crystal.glb": "scripts/blender/gen_crystal.py",
  "data_shard.glb": "scripts/blender/gen_shard.py",
  "asteroids.glb": "scripts/blender/gen_asteroids.py",
  "cargo_ship.glb": "scripts/blender/gen_cargo_ship.py",
  "moon.glb": "scripts/blender/gen_moon.py",
  "comet_head.glb": "scripts/blender/gen_comet_head.py",
  "creature.glb": "scripts/blender/gen_creature.py",
  "career_station.glb": "scripts/blender/gen_career_station.py",
  "buoy.glb": "scripts/blender/gen_buoy.py",
  "shipyard.glb": "scripts/blender/gen_shipyard.py",
  "dormant_gate.glb": "scripts/blender/gen_dormant_gate.py",
  "probe.glb": "scripts/blender/gen_probe.py",
  // Saturn's ring strip (its maps are in BODY_MAPS).
  "w-ringed_ring.webp": "scripts/textures/gen_worlds.mjs",
};

/** The body and moon maps: each recipe's maker (its `_4k` desktop variant too). */
const MAP_GENERATORS: Record<string, string> = Object.fromEntries(
  Object.entries(BODY_MAPS).flatMap(([name, r]) => {
    const maker = "sources" in r ? "scripts/textures/process_body_maps.mjs" : r.generator;
    return r.hiRes ? [[`${name}.webp`, maker], [`${name}_4k.webp`, maker]] : [[`${name}.webp`, maker]];
  }),
);
const GENERATORS: Record<string, string> = { ...MODEL_GENERATORS, ...MAP_GENERATORS };

describe("asset provenance", () => {
  const shipped = readdirSync("public/models");

  it("every shipped model and texture has a generator", () => {
    expect(shipped.filter((f) => !(f in GENERATORS))).toEqual([]);
  });

  it("every listed generator exists", () => {
    for (const [asset, script] of Object.entries(GENERATORS)) {
      expect(existsSync(script), `${asset} -> ${script}`).toBe(true);
    }
  });

  it("every sourced map's sources are pinned", () => {
    for (const r of Object.values(BODY_MAPS)) {
      if ("sources" in r) for (const id of r.sources) expect(SOURCES[id]?.sha256, id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("no listed asset is missing from the build", () => {
    expect(Object.keys(GENERATORS).filter((f) => !shipped.includes(f))).toEqual([]);
  });
});
