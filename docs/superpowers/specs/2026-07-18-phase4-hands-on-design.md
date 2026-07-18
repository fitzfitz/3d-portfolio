# Phase 4: Hands On — Design

**Date:** 2026-07-18
**Status:** Approved (roadmap phase 4; user: "go ahead")
**North star:** reasons to keep flying — and a world that pushes back. Highest regression risk of the roadmap (physics + input); every gameplay-logic piece is a pure, TDD'd function.

## Features

### 4.1 Data shards (collectibles)
- 10 glowing octahedron shards scattered across the map — several at altitude (vertical flight made them reachable); positions fixed in `src/data/shards.ts` with a one-line **fun fact / resume easter egg** each.
- One `InstancedMesh`; bob + spin in useFrame; collected shards hidden (zero-scale matrix).
- Pickup: 3D distance < 3 in the frame loop → guarded store action `collectShard(i)` → pickup chime (new soundManager one-shot) → the shard's line typed via RadioChatter → HUD counter `SHARDS: n/10` in the diagnostics block.
- Persistence: `localStorage["fitz-shards"]` (JSON index array, safe get/set try/catch like isMuted). Collect-all: fanfare chime + special chatter line.
- Store: `shardsCollected: number[]` + `collectShard(i)` (idempotent, persisted) — TDD.

### 4.2 Asteroid collisions
- Colliders: the 12 large scenery asteroids (positions extracted to `src/data/asteroids.ts`, radius = scale × 2.2) + the sun (origin, r=4). Belt rocks excluded (tiny, decorative — spec decision).
- Pure `resolveCollision(pos, vel, center, radius)` → null | { pos, vel }: push-out along the normal + velocity reflection damped ×0.45 — TDD (head-on reflect, miss, tangential graze, damping).
- Integration in Spaceship's frame loop after position integration (works during warp — crashing out of warp is the fun); camera shake (decaying random offset, intensity 0.5 on impact) + new `impact()` thud; chatter `impact` pool line on hit (guarded flag, rising-edge like cometNear).

### 4.3 Scanner mode
- Hold **E** (desktop) / contextual **SCAN** hold-button (touch, appears only when a target is in range) near a scannable: planets (their real project blurbs), big asteroids, comets, the jellyfish.
- Store: `scanTarget: string | null` (guarded, set by a frame-loop nearest-scannable check, range 22) + `scanProgress` handled OUTSIDE React (DOM ring via rAF; conic-gradient).
- Hold 1.6s → release fires `generateScanReport(targetId)` — pure, seeded, TDD — typed via RadioChatter (composition %s, mass class, one quip; planets return project-flavored reports).
- HUD: thin progress ring + target label near the reticle area, DOM-driven.

### 4.4 Orbit entry animation
- On lock: instead of freezing, the ship eases onto a circular orbit (radius = lock radius × 1.15) around the locked body, circling at 0.25 rad/s, facing tangent; visible around the dossier modal.
- `lockedCenter` resolved from `activeZone` (planets/PORTAL_POS) at the lock transition; `pos.current` keeps updating along the orbit so the existing tangential escape-push exit works naturally; camera keeps the standard chase framing (locked branch now runs the camera block).
- Altitude eases to the body's plane during orbit (keeps the earlier fix's behavior).

### 4.5 Photo mode
- **P** toggles `photoMode` (store; editable-target-guarded key): hides ALL DOM chrome (HUD, touch controls, modals, chatter) except a tiny `PHOTO_MODE — [P] EXIT` tag; drei `OrbitControls` takes over the camera (target = ship position at entry); Spaceship's camera-follow is skipped while active; flight input ignored (ship drifts/bobs in place — it poses).
- Screenshots are the visitor's own (OS/browser capture); no in-app capture button (would require preserveDrawingBuffer — rejected for perf; documented).
- Exiting restores chase cam smoothly (existing lerp pulls it back).

## Architecture rules (unchanged)
Zero per-frame React state; guarded setters for events; pure logic in `src/utils/` with tests; low-perf unaffected (all features cheap); touch parity for every interaction.

## Sound additions (synthesized, soundManager)
`pickup()` (bright two-note), `fanfare()` (four-note run, collect-all), `impact()` (low boom + noise burst), `scanBeep()` (tick on scan complete).

## Acceptance
1. Collect a shard → chime + fact line + counter increments; survives reload; all-10 fanfare.
2. Fly into a big asteroid at speed → bounce + shake + boom + chatter line; never tunnels through or sticks inside.
3. Hold E near a planet → ring fills → release → project-flavored scan report; touch SCAN button appears only in range.
4. Orbit lock → ship visibly circles the planet behind the modal; break-orbit exits tangentially, no teleport.
5. P → clean frame, orbitable camera; P again → everything restores.
6. Gates: build/lint/test (45 → ~55 tests); probe screenshots: shard pickup line, post-bounce shake frame, photo-mode clean frame.

## Out of scope
Belt-rock collisions, NPC/creature collisions, scan history UI, shareable photo watermarks, gamepad.
