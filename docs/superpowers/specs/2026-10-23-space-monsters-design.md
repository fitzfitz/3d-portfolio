# Space monsters: the assets (design)

**Date:** 2026-10-23. **Status:** agreed with the owner in conversation, not built.
**Stage:** the first step of the PvE combat stage (the game layer: combat →
coins → shop → realms → PvP). This design covers the two monster **models**
only. Fighting them (AI, the beam, damage, spawning) is the combat stage's own
design, written later.

## Why

The owner wants activity in the universe, starting with PvE fights. The
monsters are the costliest part to redo, so they are built and approved
first, before any gameplay depends on them. The probe went the same way
(PR 39 / 44): model first, owner look check, then gameplay.

## Decisions (owner, 2026-10-23)

| Question | Decision |
|---|---|
| How many monsters | **Two types** |
| Look | **Pixar-film style**: the same friendly, exaggerated shapes, made with real materials. Not scary, not horror. |
| Monster 1 | **The saucer alien** from the owner's reference image (below) |
| Monster 2 | **A tardigrade** (water bear), chosen over a space anglerfish |
| Monster 2's attack | **It shoots a beam at the pilot** |
| Monster 1's attack | **Quick bursts of small glowing shots from a cannon under the saucer**, warned by a porthole chase-light (my recommendation, owner: "go with it") |
| How they are made | **Heavily in Blender**, very detailed, patterns and structure done well, and **game-ready** |

The owner agreed to every "my call" below as played back in conversation
("all good"), but they remain calls the builder may revisit with reason.

## Monster 1: the saucer alien

### The reference

The owner's image: a green, pear-shaped alien with **three eyes** (two on the
face, one on top), a **wide open grin** with blocky white teeth and a pink
tongue, and **tentacle arms raised**, green with **pink spots** on their
undersides. It sits in a **grey flying saucer**: a deep bowl with a **ring of
round portholes**, a raised rim, **four or so conical spikes** underneath, and a
**clear glass dome** over the alien. A copy lives at
`docs/superpowers/specs/assets/2026-10-23-saucer-alien-reference.png`.

The model is an **original** made after this reference: same character,
proportions and parts, not a trace of the image. Provenance in
`assets-src/MANIFEST.md` says "after an owner-supplied reference image".

### The look (my calls, agreed)

- **Skin:** soft and slightly translucent where it is thin (tentacle tips, the
  top of the head), with faint speckles and a wet sheen. Spots are recessed
  pink patches, not painted dots.
- **Eyes:** glossy with a clear outer layer and a reflection highlight; the
  pupils can look at the pilot.
- **Mouth:** the grin as in the picture, teeth slightly uneven, pink tongue.
- **Saucer:** brushed metal with panel seams, rivets, small scratches and
  grime along the seams. The porthole ring **glows**, so the saucer reads
  against black space.
- **Dome:** real glass, with a bright edge where it faces away from the viewer.

### Size and role (my call, agreed)

About **ship-sized** (~1–1.5× the pilot's ship, which is ~2.4 u), nimble,
met **in small groups** (up to ~6 at once).

**Variety within a group (my call):** the saucers in a group are not clones.
Each instance gets its own tint, within a narrow range: the skin's green, the
spots' pink, and a painted band on the saucer. This works through a mask
channel tinted per instance, like the probe's project colour. All instances
share one shape and one expression set.

### Movement (my call, agreed)

Built into the asset, so the combat stage only plays it:
- **Idle:** tentacles wave, the saucer bobs and tilts gently.
- **Look:** eyes (all three) and head turn toward a target point.
- **Blink.**
- **Attack (owner-approved):**
  - A small **domed cannon under the saucer**, between the spikes, that
    **turns to aim** (the game gives it a target direction). It has a
    **muzzle point** the game spawns shots from.
  - Before a burst, the **portholes light one after another** around the rim
    (a chase): the warning. The game drives it, so the asset needs each
    porthole individually addressable (or an ordered ramp the shader can
    sweep).
  - While firing, the alien **leans forward, grins wider and flails its
    tentacles**.
  - The shots themselves are a combat-stage effect.
- **Hit:** a flinch.
- **Defeated:** spins off dizzy (eyes crossed or spinning), trailing smoke.
  It does not explode into pieces. The smoke itself is a game effect.

## Monster 2: the tardigrade

### Why a tardigrade

A real microscopic animal and the only one known to have survived open space
(FOTON-M3, 2007). Scaled up, it has a reason to live out here, which fits
the site's real-NASA-data tone. Its outline (long, segmented, eight legs)
looks nothing like the saucer, so the two read apart at a distance.

### The look (my calls, agreed)

- **Body:** plump, segmented, with soft folds between segments.
- **Legs:** eight stubby legs, each ending in small curved claws (real
  tardigrades have 4–8 claws per leg; keep a few, readable not busy).
- **Face:** tiny dark eyes; a **round tube-shaped mouth** at the front.
- **Skin:** warm translucent tan-pink, light glowing through thin edges, fine
  wrinkles, a slight wet sheen.
- **Back:** a few small **crystals** growing out of it that glow faintly: the
  "space creature" touch, and a way to spot it in the dark.
- **Mouth glow:** the mouth carries an emissive zone the game can drive from
  0 to full, for the beam's charge.

### Size and role (my call, agreed)

Bigger and slower: about **3× the ship** (~7 u long). Met **one or two at a
time**.

### Movement (my call, agreed)

- **Idle / swim:** the legs paddle slowly as if swimming; the body undulates.
- **Turn to face** the pilot (the game rotates the whole model; the asset
  only needs a forward axis).
- **Charge:** the body tenses and the mouth glow builds (the game drives the
  glow; the pose is in the asset).
- **Fire:** a recoil jolt backwards.
- **Hit:** a flinch.
- **Defeated:** curls into a dried-up **tun** ball (what real tardigrades do
  to survive vacuum) and drifts off. No explosion, no gore.

## Game-ready: what that means here

These hold for both models.

- **Made by script in Blender**, like every model on the site: a
  `scripts/blender/gen_<name>.py` that rebuilds the asset from nothing,
  byte-reproducible like the probe. The `.blend`, the `.glb` and the reference
  go to `assets-src/` and are **pushed** to its private remote. Trusted
  Blender add-ons are allowed; name the source in the MANIFEST row. Blender
  5.1.2 is at `~/Applications`.
- **Detail is sculpted in high resolution and baked** onto a game mesh
  (normal, AO, colour, roughness/metal, plus whatever thickness or
  translucency data the in-game skin needs), the way the probe was.
- **Triangle budget (my call):** about **5–8k triangles** for the near
  version of each (the probe is 5,444), plus **one or two lighter versions**
  for distance. The builder sets exact caps and pins them in
  `tests/assetContracts.test.ts`.
- **Drawn instanced (my call).** Today's worst state (deep space facing away
  from the sun) is at 42 of 50 draw calls and ~264k of ~303k triangles
  (`docs/PERF-BUDGETS.md`), so one mesh per monster does not fit. Each
  monster type is drawn as an `InstancedMesh` (or `BatchedMesh`): **one draw
  call per material for the whole group**, whatever its size. The saucer
  needs an opaque and a glass material (2–3 calls for all six); the
  tardigrade 1–2 calls for both. The distance versions keep this.
- **The budgets are re-measured in the combat stage, not here.** No game
  scene loads these models yet. The combat stage measures a real fight and
  re-baselines `docs/PERF-BUDGETS.md` deliberately and on the record. This
  follows the owner's standing rule: graphics and UX come first, and the CI
  budgets guard against regressions, not new features. This stage reports
  each model's triangles, draw calls and shader programs so that measurement
  has numbers to start from.
- **Movement is in the file, and it must work instanced (my call).** three.js
  cannot instance skinned meshes, so the movements are made in the vertex
  shader, driven per instance (phase, state, look target, glow level), the
  way the jellyfish and probe already move. How is **left to the builder**:
  `COLOR_0` / extra vertex attribute masks with procedural motion, baked
  vertex-animation textures for the acted moves (dizzy spin, tun curl,
  recoil), or a mix. Conditions: every movement listed above can be played
  per instance, it looks good in three.js (not only in Blender), and the
  cost is measured. A skeleton may still be used inside Blender to author
  and bake the moves.
- **The in-game look is what counts.** three.js has no true subsurface
  scattering, and the look check must not approve a Cycles render the game
  cannot match. The owner sees **both**: Blender turntables and the models
  in the real three.js renderer under the game's lighting (a dev-only
  viewer or test scene is fine; it ships nothing to visitors).
- **Compressed** through `scripts/optimize-assets.mjs` (added to `MODELS`,
  texture quality set like the probe's) into `public/models/`.
- **Not loaded by the game yet.** Which asset pack they join is decided in
  the combat stage, so visitors download nothing new now.

## Look checks (the owner's gate)

1. **Blockout** of both: shapes, proportions and size against the ship.
   Cheap to change; the owner says go before detail work.
2. **Final** of each: Blender turntables plus in-engine shots, near and far,
   and each movement shown (short clips or frame strips).

Nothing is merged before the owner approves the finals.

## Delivery (my call)

One PR with both models, their scripts, MANIFEST rows, asset-contract tests
and a "behind the scenes" changelog entry (every PR gets one; see
`src/data/changelog.ts`). Run the full build (`npm run build`) and the full
e2e before merging. Merging deploys staging only; production is a `v*` tag.

## Not in this stage

- Fighting: monster AI, the beam effect, shooting them, damage, health,
  spawn zones, smoke and debris effects, sounds. Combat stage.
- Where they live in the universe (they must be reachable; no unreachable
  scenery). Combat stage.
- Coins, achievements, PvP.
- Projects and career data in D1. A separate project, brainstormed next.
  The owner will edit D1 rows themselves (no admin page).

## Left to the builder

- How each movement is made within the instanced rule (see above), and the
  mask or vertex-animation layout.
- Exact triangle caps, texture sizes and texture quality.
- Colours within the brief (green alien, pink spots, grey saucer, tan-pink
  tardigrade) and the crystal colour.
- How the translucent skin is done in three.js.
- The dev-only viewer.
