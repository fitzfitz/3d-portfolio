# Phase 1: Ambient Life — Design

**Date:** 2026-07-18
**Status:** Draft for approval
**Parent:** `2026-07-18-living-universe-roadmap.md` (Phase 1)
**Decisions locked:** sound fully synthesized (Web Audio, zero asset bytes); sound ON by default at subtle volume, first user gesture starts it, mute toggle persisted to localStorage.

## Goal

Make the universe feel inhabited without touching the flight/orbit gameplay loop or giving back any performance: ambient sound, an orbiting asteroid belt, living planet clouds, a working radar, contextual radio chatter, and occasional shooting stars.

## Architecture

Six independent features; each is its own module with one integration point. Nothing adds React state that changes per-frame — all animation reads `flight`/clock inside `useFrame`/rAF, matching the established pattern.

### 1.1 Sound — `src/audio/soundManager.ts` + `src/hooks/useSound.ts`

A singleton class (no React) owning one `AudioContext` and a master `GainNode`:

- **Engine hum**: brown-noise buffer loop → lowpass filter → gain. rAF loop maps `flight.speed` → filter cutoff (200–900Hz) and gain (0 at rest → 0.08 cruising). Warp (store `isWarping`) adds a detuned sawtooth layer with its own envelope.
- **One-shots** (all synthesized envelopes): orbit-lock chime (two sine notes, minor third), orbit-break thunk, teleport-wrap zap, UI tick for chatter lines.
- **Ambient pad**: two slow-detuned sine/triangle oscillators through a long-attack gain, volume 0.03 — barely-there space drone.
- **Lifecycle**: constructed lazily on first user gesture (pointerdown/keydown listener, once). Master volume 0 when muted. `muted` persisted as `localStorage["fitz-sound-muted"]`.
- **Integration**: `useSound()` hook mounted once in App — subscribes to store transitions (`isOrbitLocked`, `isWarping`, `isTeleporting`) via `useSpaceStore.subscribe` (subscribeWithSelector is already applied) and fires one-shots; runs the engine-hum rAF. HUD gets a SOUND_ON/MUTE button (same style as LOW_PERF) writing through a new store field `isMuted` + `setMuted(v)` (persistence inside the store action, not the component).
- **Store addition**: `isMuted: boolean` (initialized from localStorage; guard `typeof window` for tests), `setMuted(v)`.

### 1.2 Asteroid belt — `src/components/canvas/AsteroidBelt.tsx`

- One `InstancedMesh` reusing the already-loaded asteroid geometry/material (`useGLTF("/models/asteroid.glb")` — cached, shares Task 6's GPU resources).
- N = 400 instances (200 when `isLowPerf`, via store selector re-seeding count — React re-render on toggle is fine, it's discrete).
- Seeded per-instance params (`useMemo`, mulberry32 PRNG seed 42 for determinism): orbit radius 40–70, y-jitter ±2.5, angular speed 0.008–0.02 rad/s (Kepler-ish: faster inner), phase, self-rotation axis/speed, scale 0.05–0.22.
- `useFrame`: one loop composing matrices via shared dummy (Task 6 pattern). Belt plane tilted 4° for visual interest.
- Sits between sun (r≈2.5) and planets (r≈110+): no gameplay interference; purely visual (no collision — that's Phase 4).

### 1.3 Planet cloud layers — `src/components/canvas/CloudLayer.tsx`

- Procedural cloud alpha texture generated ONCE module-level on a 256×256 canvas (value-noise octaves → soft threshold), shared by all three planets as a `THREE.CanvasTexture`.
- Per-planet: `<mesh>` sphere radius×1.03, `MeshStandardMaterial` with `alphaMap` = shared texture, `transparent`, `depthWrite:false`, per-planet tint (white on earth-planet, cyan-tinted on video, warm on agent), opacity ~0.35.
- Rotation in the existing SpacePlanets `useFrame`: cloud rotates at 1.4× its planet's surface speed (refs added alongside existing planet refs).
- Placed inside each planet group in `SpacePlanets.tsx` next to `<Atmosphere />`.

### 1.4 Radar minimap — `src/components/layout/RadarMap.tsx`

- 148×148 `<canvas>` in the HUD bottom-center-left (avoids existing corners: diagnostics top-left, buttons bottom-left get it stacked above them, sector map bottom-right, boost button bottom-right on touch). Final placement: above the LOW_PERF/RESET buttons, left edge.
- Own rAF loop drawing: range rings, sweep line rotating for flavor, ship chevron at center pointing up; world rotated by −shipHeading so "up = where you're pointing". Needs heading: **store addition** — `flight.heading: number` written by Spaceship alongside x/z (one line; stays in the mutable object).
- Blips: three planets (their colors) + portal (pink) + sun (orange), positions from `constants`, transformed via toroidal-aware delta (reuse `toroidalDistance` math for wrapping deltas: `wrapDelta(a,b,bounds)` helper added to `src/utils/toroidal.ts`, unit-tested). Radar range 120 world units; blips outside range clamp to the rim at reduced alpha (direction indicators).
- Blip pulse when that zone is `activeZone` (read store via `getState()` in the draw loop).
- Hidden in classic CV mode (whole HUD already is); shown on touch too (small enough not to clash with joystick zone — it's display-only, `pointer-events-none`).

### 1.5 HUD radio chatter — `src/components/layout/RadioChatter.tsx` + `src/data/chatterLines.ts`

- One line of monospace text, bottom-center of HUD, typewriter-reveal animation (rAF slicing, DOM textContent writes — no React per-char state).
- Line pools in `chatterLines.ts`: `deepSpace[]` (ambient flavor), per-zone pools keyed by zone name (`saas`, `video`, `agent`, `contact` — resume storytelling lines), `warp[]`, `wrap[]` (post-teleport). ~8–12 lines each; content drafted at plan time, user-editable in one file.
- Scheduler: next line 18–35s random after previous completes; zone-entry and wrap events interrupt immediately with a matching line (subscribe to store `activeZone`/`isTeleporting` transitions). Each line prefixed `> ` and plays the UI tick sound (via soundManager, respects mute).
- Pure logic (pool selection + scheduler timing) extracted to `src/utils/chatterScheduler.ts` and unit-tested (fake timers): zone interrupt wins over ambient timer, no repeat of the immediately-previous line.

### 1.6 Shooting stars — `src/components/canvas/ShootingStars.tsx`

- Pool of 4 line segments (one `LineSegments`, 8 verts). Each meteor: spawn on a random far-sphere chord (radius ~200 centered on camera), lifetime 0.8–1.4s, head advances, tail = head − dir×len, alpha via material opacity per-meteor impossible on one material → use vertex colors (colors attribute, fade written per-frame).
- Spawn scheduler inside `useFrame`: random interval 4–12s, max 2 concurrent. Skipped entirely when `isLowPerf` (component returns null via store selector).

## File structure summary

- Create: `src/audio/soundManager.ts`, `src/hooks/useSound.ts`, `src/components/canvas/AsteroidBelt.tsx`, `src/components/canvas/CloudLayer.tsx`, `src/components/canvas/ShootingStars.tsx`, `src/components/layout/RadarMap.tsx`, `src/components/layout/RadioChatter.tsx`, `src/data/chatterLines.ts`, `src/utils/chatterScheduler.ts`, `tests/chatterScheduler.test.ts`, `tests/toroidal-wrapDelta.test.ts`
- Modify: `src/store/spaceStore.ts` (`isMuted`+`setMuted`, `flight.heading`), `src/components/canvas/Spaceship.tsx` (write `flight.heading`), `src/components/canvas/SpacePlanets.tsx` (cloud layers), `src/components/canvas/GlobalCanvas.tsx` (mount belt + shooting stars), `src/components/layout/HUDOverlay.tsx` (mute button, mount radar + chatter), `src/App.tsx` (`useSound()`), `src/utils/toroidal.ts` (`wrapDelta`)

## Error handling

- SoundManager: constructor wrapped — if `AudioContext` unavailable/throws, manager becomes inert no-op (site works silently); all one-shot calls guard on initialized state.
- Radar/chatter rAF loops guard refs and cancel on unmount (HUD unmounts in classic CV mode).
- Cloud texture generation guards `getContext("2d")` null → skips clouds gracefully.

## Performance budget

Zero new per-frame React state (all six features). New per-frame CPU work: 400 matrix composes (belt) + 8 vert writes (meteors) + one 148px canvas draw — well under a millisecond combined on the target hardware. Low-perf mode: belt halves, meteors off, sound unaffected (negligible), radar/chatter unaffected. Zero new network assets.

## Testing

- Unit (vitest): `wrapDelta` toroidal math; chatter scheduler (interrupt priority, no-immediate-repeat, timing windows); store `isMuted` persistence action (localStorage mocked).
- Gates: build/lint/test + manual dev-server pass (sound audible & mutable across reload, belt orbits, clouds rotate, radar tracks & wraps correctly near boundaries, chatter reacts to zones, meteors appear, low-perf degradations, profiler still render-free in steady flight).

## Out of scope (later phases)

Belt collisions (P4), comet announcements (P3 ties into chatter pools), god rays/warp tunnel (P2), any new GLB assets.
