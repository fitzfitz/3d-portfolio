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
npm run assets:optimize
