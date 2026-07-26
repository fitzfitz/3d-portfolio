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
# uplift_spaceship.py is deliberately NOT called here. It imports and exports
# assets-src/spaceship.glb in place (see its SRC at line 14 used by both the
# import at line 23 and the export at line 82), so a second run would uplift an
# already-uplifted model. It is a one-shot migration, not a generator; the
# pristine input is preserved at assets-src/originals/spaceship_orig.glb.
npm run assets:optimize
