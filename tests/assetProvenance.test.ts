import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";

/**
 * Every shipped asset must be original work with a generator in this repo.
 * Until 2026-10-10 five shipped files (ship base mesh, portal, fuel crystal,
 * Earth and Mars maps) had no recorded source or licence; they were replaced
 * by scripted originals. This keeps an unowned file from slipping back in:
 * add the generator first, then the asset.
 */
const GENERATORS: Record<string, string> = {
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
  "ruangrapi.webp": "scripts/textures/gen_planets.mjs",
  "ruangrapi_glow.webp": "scripts/textures/gen_planets.mjs",
  "portfolio.webp": "scripts/textures/gen_planets.mjs",
  "fuxx.webp": "scripts/textures/gen_planets.mjs",
  "fuxx_glow.webp": "scripts/textures/gen_planets.mjs",
  // Desktop-only 4096-wide variants (--width=4096, see SpacePlanets HI_RES_MAPS).
  "ruangrapi_4k.webp": "scripts/textures/gen_planets.mjs",
  "fuxx_4k.webp": "scripts/textures/gen_planets.mjs",
  "fuxx_glow_4k.webp": "scripts/textures/gen_planets.mjs",
  // The new worlds (2026-10-17). NASA imagery was reference only (MANIFEST).
  "w-rock.webp": "scripts/blender/gen_world_rock.py",
  "w-rock_normal.webp": "scripts/blender/gen_world_rock.py",
  "w-ringed.webp": "scripts/textures/gen_worlds.mjs",
  "w-ringed_ring.webp": "scripts/textures/gen_worlds.mjs",
  "w-tilted.webp": "scripts/textures/gen_worlds.mjs",
  "w-blue.webp": "scripts/textures/gen_worlds.mjs",
  "w-dwarf.webp": "scripts/blender/gen_world_dwarf.py",
  "w-dwarf_normal.webp": "scripts/blender/gen_world_dwarf.py",
};

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

  it("no listed asset is missing from the build", () => {
    expect(Object.keys(GENERATORS).filter((f) => !shipped.includes(f))).toEqual([]);
  });
});
