#!/bin/bash
# Regenerates Blender-authored assets into assets-src/, then optimizes into public/models/.
set -e
# Note: meshopt re-encoding is non-deterministic — regenerating produces byte-different (functionally identical) GLBs.
BLENDER="${BLENDER:-/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender}"
cd "$(dirname "$0")/../.."
mkdir -p assets-src
"$BLENDER" --background --python scripts/blender/gen_cargo_ship.py
[ -f scripts/blender/gen_creature.py ] && "$BLENDER" --background --python scripts/blender/gen_creature.py
# Phobos and Deimos (2026-10-20, real-solar-system Task 14): PDS shape models
# (pinned URL + SHA-256) plus seeded detail. Replaces gen_moon.py's fictional moons.
"$BLENDER" --background --python scripts/blender/gen_mars_moons.py
[ -f scripts/blender/gen_comet_head.py ] && "$BLENDER" --background --python scripts/blender/gen_comet_head.py
[ -f scripts/blender/gen_asteroids.py ] && "$BLENDER" --background --python scripts/blender/gen_asteroids.py
# Hero ship, contact portal and fuel crystal (original replacements, 2026-10-10,
# for files with no recorded source). gen_spaceship.py is a clean generator, so
# unlike the old one-shot uplift it is safe to re-run.
"$BLENDER" --background --python scripts/blender/gen_spaceship.py
"$BLENDER" --background --python scripts/blender/gen_portal.py
"$BLENDER" --background --python scripts/blender/gen_crystal.py
"$BLENDER" --background --python scripts/blender/gen_shard.py
# Career landmarks (2026-10-15): the career station and its trail buoy.
"$BLENDER" --background --python scripts/blender/gen_career_station.py
"$BLENDER" --background --python scripts/blender/gen_buoy.py
# Shipyard and dormant gate (2026-10-16).
"$BLENDER" --background --python scripts/blender/gen_shipyard.py
"$BLENDER" --background --python scripts/blender/gen_dormant_gate.py
# Project probes (2026-10-20): the Voyager-style probe that carries the dossiers.
"$BLENDER" --background --python scripts/blender/gen_probe.py
# The real bodies' maps (2026-10-20, real-solar-system spec §5.5): NASA/USGS
# public-domain mosaics (pinned URL + SHA-256), the seeded Venus, Titan and
# Triton fill, and Saturn's, Uranus's and Neptune's seeded maps (pure Node +
# sharp, no Blender). The retired fictional maps' generators (gen_planets.mjs's
# own outputs, gen_world_rock.py, gen_world_dwarf.py) no longer run.
node scripts/textures/fetch_nasa_maps.mjs
node scripts/textures/gen_body_maps.mjs
node scripts/textures/gen_worlds.mjs
node scripts/textures/process_body_maps.mjs
npm run assets:optimize
