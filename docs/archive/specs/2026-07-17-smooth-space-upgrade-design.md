# Smooth Space Upgrade — Design

**Date:** 2026-07-17
**Status:** Approved (Approach A: surgical upgrade)
**Goal:** Make the 3D space-flight portfolio noticeably smoother and better-looking, and make it usable on touch devices.

## Problem

The site is a React Three Fiber "Space Flight CV" (pilot a ship, orbit planets to open project dossiers). It works, but:

1. **60fps React re-render storm.** `Spaceship` calls `onPositionUpdate` and `onWarpStatus` inside `useFrame`, which `setState`s in `App` every frame, re-rendering the entire React tree. `HUDOverlay` then re-renders a second time via its own `useEffect` on `vehiclePos`. `SpacePlanets` and the click-plane also receive per-frame props.
2. **28MB asteroid.glb**, cloned 12 times via `scene.clone()` — no instancing. Dominates load time (~31MB total model payload) and memory.
3. **Frame-rate-dependent physics.** Per-frame constants mean the ship flies ~2× faster on a 120Hz display, and lerp smoothing varies with refresh rate.
4. **Keyboard input via React state** — every keypress re-renders `Spaceship`.
5. **Dead legacy code**: `Vehicle`, `PlaygroundLevel`, `MarblesContainer`, `Scene`, `ProjectCarousel` (and `HeroNodeNetwork` if unreferenced) only reference each other, not the live tree.
6. **Keyboard-only** — touch devices cannot fly at all.
7. **HUD bug**: the SECTOR_PLANETS panel hardcodes stale coordinates (`[-35, 0, 35]`…) that don't match the real planet positions (`[-110, 0, 110]`…).
8. `preserveDrawingBuffer: true` on the canvas for no reason (nothing reads the buffer).

## Design

### 1. Asset pipeline (build-time) — zero detail loss

Inspection results changed the plan: **no mesh simplification is needed anywhere.** The asteroid's geometry is only 4,600 vertices (178KB); the 28MB is three oversized PNG textures (4096² base color = 20.3MB, 4096² metallic-roughness = 6.7MB, 2048² normal = 2.6MB). The other models already use 1024² textures.

Blender is not installed; `gltf-transform` v4 (works via `npx @gltf-transform/cli`) covers everything needed. New script `scripts/optimize-assets.mjs` + npm script `assets:optimize`:

- Move originals to `assets-src/` (gitignored); optimized output overwrites `public/models/`.
- **Geometry: untouched on every model.** Only weld/dedup (lossless) + quantization + **meshopt** compression (visually lossless, spec-standard).
- `asteroid.glb` textures, sized to what the GPU can actually sample at render distance (asteroids are background objects; 4096² is never sampled even at 1:1):
  - base color 4096² PNG → 2048² WebP q90
  - normal map: kept at 2048², WebP **near-lossless** (normal data is compression-sensitive)
  - metallic-roughness 4096² → 1024² WebP (smooth low-frequency data)
  - Expected: ~28MB → **~1.5–2MB** with no visible difference in-app; VRAM for the asteroid material drops ~200MB → ~30MB, which itself removes stutter on integrated GPUs.
- `portal_gateway.glb`, `space_crystal.glb`, `spaceship.glb`: keep texture resolutions, convert PNG → WebP q92 + meshopt. Modest savings, zero visible change.
- Planet textures (2048×1024 JPGs): keep resolution, convert to WebP q88.
- Runtime: register `MeshoptDecoder` (ships with `three`) with `useGLTF`.
- Acceptance check: A/B screenshot comparison at gameplay camera distance before/after for each model.

### 2. State architecture

Add **zustand**. One store, two data classes:

- **Transient (per-frame) data** — ship position, speed, warp flag: written from `useFrame` via `store.setState`, consumed only through `subscribe` outside React rendering. `HUDOverlay` telemetry numbers update DOM text via refs in a subscription — zero React renders during flight.
- **Discrete (event) data** — `activeZone`, `isOrbitLocked`, `isOrbitCooldown`, `isLowPerf`, `showClassicCV`: normal reactive zustand state; changes only on real events.

Consequences:

- `App.tsx` no longer owns `vehiclePos`; the startup info card visibility becomes a store-driven flag (computed in the ship's frame loop, set as discrete state on enter/leave of the spawn area).
- `SpacePlanets` reads ship position from the store inside its own `useFrame` for proximity checks; no per-frame props.
- The invisible click-plane follows the ship inside a `useFrame`.
- `onWarpStatus` becomes a discrete store write (only on change).

### 3. Input & physics

- `useKeyboard` rewritten as an input store writer (mutable, no React state). Physics reads `getState().input`.
- All motion converted to **delta-time**: `useFrame((state, delta) => …)` with per-second units (current per-frame constants × 60), and lerps converted to exponential damping (`1 - Math.pow(k, delta * 60)` or `THREE.MathUtils.damp`). Feel preserved at 60Hz, now identical at 30/120/144Hz.

### 4. Rendering performance

- `Asteroids` → single `THREE.InstancedMesh` built from the optimized asteroid geometry (largest mesh in the GLB), 12 instance matrices updated in one loop.
- Remove `preserveDrawingBuffer: true`.
- Add drei `<AdaptiveDpr pixelated />` and `<PerformanceMonitor>`; on sustained low performance, auto-enable the existing low-perf mode (manual toggle stays authoritative once touched).
- Delete dead components (`Vehicle`, `PlaygroundLevel`, `MarblesContainer`, `Scene`, `ProjectCarousel`, `HeroNodeNetwork` if unreferenced) and their orphaned assets/hooks.

### 5. Visual polish & quality uplift

Asset *uplift* (models look better than today, not just smaller):

- **Image-based lighting**: drei `<Environment>` with a subtle space/night preset — the single biggest PBR upgrade. Today only an `ambientLight` lights the scene, so the asteroid's normal/roughness maps and the ship's metallic hull barely read. An environment map makes that authored detail actually visible.
- **Anisotropic filtering** (up to GPU max, typically 16×) on planet and asteroid textures — sharper detail at grazing angles, effectively free.
- **Correct color spaces** verified on all textures (sRGB for color, linear for normal/roughness) — a common source of washed-out models.
- **Planet atmospheres**: shared fresnel-glow `ShaderMaterial` shell (backside-rendered sphere, ~1.06× radius) tinted per-planet color.

Motion polish:

- **Engine trail**: drei `<Trail>` ribbon behind the ship; width/opacity scale with speed, boosted during warp.
- **Warp streaks**: existing local dust points get velocity-stretched rendering during warp (elongate along -Z), stronger FOV kick already partially exists — tune to 86.
- **Post-fx**: add `Vignette` (always, subtle) and `ChromaticAberration` (warp-only, animated in) to the existing `EffectComposer`; entire composer stays disabled in low-perf mode.

### 6. Touch controls

- New `TouchControls` component, no library: pointer-event virtual joystick on the left half (drag vector → turn + thrust magnitude), BOOST button bottom-right (maps to warp/jump input). Writes to the same input store as the keyboard.
- Rendered when `(pointer: coarse)` matches (existing `useMediaQuery` hook). HUD instruction card swaps wording (JOYSTICK / BOOST instead of WASD / SPACEBAR).

### 7. Bug fixes

- HUD SECTOR_PLANETS panel derives labels/coordinates from the real `planets` array (passed once; it's static data).
- HUD escaped-entity bug: `&gt;` rendered literally inside a JSX expression string on the gravity-lock line.

## Error handling

- Asset script fails loudly per-file and leaves originals untouched (`assets-src/` is the source of truth).
- `SafeErrorBoundary` around the composer stays; new post-fx go inside it.
- If `MeshoptDecoder` fails to load, models were also quantized — fallback is a rebuild without `meshopt` flag documented in the script header.

## Testing / verification

1. `npm run build` and `npm run lint` pass.
2. Asset budget: `public/models/` total < 4MB (from ~31.5MB), with A/B screenshots confirming no visible quality loss at gameplay distances.
3. Dev-server flight test: React DevTools profiler shows **zero component renders during steady flight**; orbit lock/break, boundary wrap, plasma spawn, classic-CV toggle all work.
4. Touch emulation (Chrome device mode): joystick steers, BOOST warps, HUD shows touch wording.
5. Feel check at 60Hz vs 120Hz (if display available): identical traversal speed.

## Out of scope

- KTX2/Basis textures, GPU-tier detection, quality presets (Approach B items).
- New 3D asset creation (Blender not installed; current models sufficient after optimization).
- Classic resume mode content changes.
