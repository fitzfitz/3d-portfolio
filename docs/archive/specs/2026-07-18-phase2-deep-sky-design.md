# Phase 2: Deep Sky — Design

**Date:** 2026-07-18
**Status:** Approved (direction validated via interactive artifact preview; all six effects confirmed)
**Parent:** `2026-07-18-living-universe-roadmap.md` (Phase 2)
**North star:** *live-like* — every effect must visibly move/breathe and respond to flight where applicable. The artifact mockup (Deep Sky Sneak Peek) is the vibe reference for palette, motion character, and intensity.

## Features

- **2.1 Parallax star layers** — replace the single 2,500-star field with three `StarLayer` point clouds in distinct radius bands (far 1,300 / mid 800 / near 400), rotating at different rates with alternating directions; near layer keeps the twinkle size modulation. Camera motion produces visible depth separation.
- **2.2 Distant galaxies** — `DistantGalaxies.tsx`: two procedural spiral-galaxy sprites (canvas-generated textures, module-level, zero assets) on the far sphere (~radius 230), additive, faint (α≈0.5), each slowly rotating via `SpriteMaterial.rotation`.
- **2.3 Nebula hue drift** — pure util `driftedHue(baseHue, tSeconds, amplitudeDeg=25, periodSeconds=180)` (unit-tested); each existing `NebulaCluster` stores its base HSL once and re-tints its material inside its existing `useFrame`. A sine drift of ±25° over 3 minutes — the sky is never the same color twice.
- **2.4 Sun corona** — new `Sun.tsx` (extracted from SpacePlanets section 5, which is removed): core sphere + solar pointLight unchanged; adds (a) a corona shell `ShaderMaterial` (animated value-noise rim flicker, additive, BackSide, radius 3.2 over the 2.5 core) and (b) two pulsing billboard flare sprites (shared canvas radial texture). Shell + flares skipped in low-perf. `Sun` reports its core mesh via `onSunReady` callback for god rays.
- **2.5 God rays** — `GodRays` pass from @react-three/postprocessing keyed to the sun core mesh, appended to the effects array only when the mesh exists (composer children built as an array to dodge the `false`-child typing issue met in the smooth-space phase). Inside the existing `!isLowPerf` + SafeErrorBoundary gate.
- **2.6 Warp tunnel** — `WarpTunnel.tsx`: an open cylinder shell (r≈3.5, len≈14) around the ship, aligned to `flight.heading`, custom additive `ShaderMaterial` scrolling procedural streaks along its length; `uIntensity` eased toward `isWarping ? 1 : 0` in `useFrame` (getState reads, no React state), mesh invisible under 0.01. Parent-gated on `!isLowPerf`.

## Architecture notes

- Sun mesh handoff: `GlobalCanvas` holds `const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null)` — set exactly once on mount (discrete, allowed); `<Sun onSunReady={setSunMesh} />` renders inside Suspense; effects array gains GodRays when non-null.
- All animation is clock-absolute or delta-based inside `useFrame`; zero per-frame React state anywhere (unchanged invariant).
- Zero new network assets: galaxy + flare textures canvas-generated; corona/tunnel are pure shaders.
- Low-perf: god rays, warp tunnel, corona shell + flares OFF; star layers, galaxies, nebula drift stay (cheap).
- SpacePlanets shrinks: sun section moves out (file was 400+ lines; this is the targeted split).

## File structure

- Create: `src/components/canvas/DistantGalaxies.tsx`, `src/components/canvas/Sun.tsx`, `src/components/canvas/WarpTunnel.tsx`, `src/utils/nebulaHue.ts`, `tests/nebulaHue.test.ts`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (star layers, sun state, effects array, tunnel + galaxies mounts), `src/components/canvas/SpacePlanets.tsx` (remove sun section; nebula drift)

## Acceptance (live-like bar)

1. Turning the ship shows visible parallax between star layers.
2. Corona flicker is organic (no periodic strobe); flares pulse asynchronously.
3. God rays swing with camera as the sun moves on/off screen; occluded by planets crossing in front.
4. Warp tunnel eases in over ~0.5s on boost, aligns with heading, eases out on release.
5. Nebula tint change is noticeable when comparing screenshots 90s apart.
6. Profiler: zero React renders during steady flight; low-perf mode drops rays/tunnel/corona-shell cleanly.

## Testing

Unit: `driftedHue` (base at t=0, +amplitude at quarter period, wraps mod 360). Everything else is shader/visual — verified via the manual checklist + artifact vibe comparison.
