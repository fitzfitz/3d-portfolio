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
# Planet colour + glow maps (pure Node + sharp, no Blender).
node scripts/textures/gen_planets.mjs
npm run assets:optimize
