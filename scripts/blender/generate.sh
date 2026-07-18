#!/bin/bash
# Regenerates Blender-authored assets into assets-src/, then optimizes into public/models/.
set -e
BLENDER="${BLENDER:-/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender}"
cd "$(dirname "$0")/../.."
mkdir -p assets-src
"$BLENDER" --background --python scripts/blender/gen_cargo_ship.py
[ -f scripts/blender/gen_creature.py ] && "$BLENDER" --background --python scripts/blender/gen_creature.py
npm run assets:optimize
