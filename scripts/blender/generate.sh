#!/bin/bash
# Regenerates Blender-authored assets into assets-src/, then optimizes into public/models/.
set -e
# Note: meshopt re-encoding is non-deterministic — regenerating produces byte-different (functionally identical) GLBs.
BLENDER="${BLENDER:-/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender}"
cd "$(dirname "$0")/../.."
mkdir -p assets-src
"$BLENDER" --background --python scripts/blender/gen_cargo_ship.py
[ -f scripts/blender/gen_creature.py ] && "$BLENDER" --background --python scripts/blender/gen_creature.py
[ -f scripts/blender/gen_moon.py ] && "$BLENDER" --background --python scripts/blender/gen_moon.py
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
# The new worlds (2026-10-17): the airless rock's and the dwarf's albedo + normal (numpy in Blender).
"$BLENDER" --background --python scripts/blender/gen_world_rock.py
"$BLENDER" --background --python scripts/blender/gen_world_dwarf.py
# Planet colour + glow maps and the other worlds' maps (pure Node + sharp, no Blender).
node scripts/textures/gen_planets.mjs
node scripts/textures/gen_worlds.mjs
npm run assets:optimize
