# A Bigger Universe With a Real Edge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ±250 wrap-around cube with a 400-unit spherical system around the sun, and add a lawful edge where the flight computer brakes the ship and returns it.

**Architecture:** One geometry module defines the system radius, the haze and the return burn (`src/utils/edgeHaze.ts` is renamed in spirit to "the edge" and keeps its file). Every wrap-aware helper becomes plain 3D maths at its call site, and `src/utils/toroidal.ts` is deleted. The validation bounds the Worker shares become a sphere.

**Tech Stack:** React 19, @react-three/fiber, three 0.185, Vitest, Node e2e probes.

**Spec:** `docs/superpowers/specs/2026-10-17-bigger-universe-design.md` (sub-project A). Background: F11 in `docs/superpowers/specs/2026-10-16-universe-laws-fixes-design.md`.

## Global Constraints

- `SYSTEM_RADIUS = 400`. `HAZE_START = 360`. `VALIDATION_RADIUS = SYSTEM_RADIUS + 40` (440). All are spheres centred on the sun at (0, 0, 0).
- Return burn:
  - beyond `SYSTEM_RADIUS`, warp is cut;
  - the ship's outward radial velocity falls by up to `EDGE_BRAKE = 40` u/s²;
  - then it is pushed inward at up to `EDGE_BRAKE` until its inward radial speed reaches `EDGE_RETURN_SPEED = 10` u/s, never more.
  - **Plan deviation:** the spec said 25 u/s², but the pilot's thrust is 25.2 u/s² (`Spaceship.tsx:40` `ACCEL`), so a pilot thrusting outward could hold the ship at the edge. 40 is the smallest round value that beats it with margin. Update the spec's item 2 to match.
- Targets: maximum overshoot under 440, and back inside 400 within 6 s, at warp or cruise, with or without outward thrust held.
- The radio line `FLIGHT COMPUTER // RETURN BURN — EDGE OF THE SYSTEM` plays with a cooldown, not on every bounce.
- No wrap anywhere. The altitude warning (`|y| > 180`) goes. Radar `RANGE = 220`. HUD `SECTOR.RANGE` reads `distanceAU(SYSTEM_RADIUS * 2)` = 6.96 AU.
- Fuel crystals stay at 40, spawned in the sphere. Plasma anomalies clamp to the sphere. The client never draws or scans a beacon beyond `SYSTEM_RADIUS`.
- No landmark, the spawn, the trail, the ring course or the gate moves. Every existing clearance test passes.
- No new shader program during play (`programs` tour `added=0`). Frame loops allocate nothing. Reduced motion and the low-perf tier keep working.
- Branch `feat/bigger-universe`, which sits on `feat/fuel-endurance`.
- One changelog entry: id `2026-10-17-bigger-universe`, title "A Bigger Universe", `pr: 32` (the fuel change ships first as #31).
- `docs/UNIVERSE-RULES.md` L18 → Follows, naming the return burn and that its thrusters are F1. Mark F11 in the fixes design as built at radius 400, except the "assist off drifts out" clause, which is deferred to F1.
- Subagents never install packages, never kill processes by name, never dispatch subagents, never push.
- Before `npm run test:e2e`: port 5199 is free.
- The Worker (`beacon-api/`) is NOT deployed by this plan. The PR says it must be redeployed before merge.

## Review Focus

1. **Pilot fights the edge**: holding outward thrust or warp at 400. They must still be returned. Test: Task 1, Step 1 (cases with outward thrust).
2. **Old beacons in the cube's corners** (up to 433 from the sun) appearing as unreachable scenery. Test: Task 3, Step 1 (beacon filter).
3. **A live-sky pose between 400 and 440** must stay valid on both sides of the protocol. Test: Task 3, Step 1 (`inWorld` at 435 accepted, 445 rejected).
4. **Gravity, scans, pickups or the radar near the old ±250 seam** behaving as if the seam were still there. Test: Task 2, Step 1 (pairs straddling 250 measure plain distance).
5. **The return-burn radio line spamming** while the pilot bounces at the edge. Test: Task 1, Step 1 (cooldown gate).

---

### Task 1: The edge — system radius, haze and the return burn

**Files:**
- Modify:
  - `src/constants.ts`: replace `COSMIC_BOUNDS = 250` with `SYSTEM_RADIUS = 400`. Keep a deprecated `COSMIC_BOUNDS` re-export only until Task 3 removes its last users, then delete it in Task 3.
  - `src/utils/edgeHaze.ts`:
    - `HAZE_START = 360`;
    - `edgeDepth(x, y, z)` becomes radial: smoothstep from `HAZE_START` to `SYSTEM_RADIUS` on `hypot(x, y, z)`, holding at 1 beyond;
    - delete `wrapCoord`;
    - add the burn helpers and the radio gate.
  - `src/components/canvas/Spaceship.tsx`:
    - remove the wrap (~689–697) and the altitude warning (~647; also `setAltitudeWarn` / `altitudeWarn` in `spaceStore.ts` and `RadioChatter.tsx` ~73);
    - `warpActive` also requires `hypot(pos) <= SYSTEM_RADIUS`;
    - apply `edgeReturn` to the pilot velocity each frame after the cruise and warp caps;
    - play the radio line through the gate (use `announce` / the existing broadcast path, like the haze line).
  - `src/data/chatterLines.ts`: the return-burn line.
- Test: `tests/edgeHaze.test.ts`

**Interfaces:**
- Produces, from `src/utils/edgeHaze.ts`:
  - `HAZE_START`, `EDGE_BRAKE = 40`, `EDGE_RETURN_SPEED = 10`
  - `edgeDepth(x: number, y: number, z: number): number`
  - `edgeReturn(p: Vec3, v: Vec3, dt: number): boolean`: mutates `v` in place; returns true while active, i.e. while `|p| > SYSTEM_RADIUS`.
  - `class ReturnBurnLineGate { update(active: boolean, now: number, radioBusy: boolean): boolean }`, with a 20 s cooldown.
- Produces, from `src/constants.ts`: `SYSTEM_RADIUS`, `VALIDATION_RADIUS`.

- [ ] **Step 1: Write the failing tests** in `tests/edgeHaze.test.ts`. Replace the cube and wrap cases, and keep the `HazeLineGate` cases with the new depth. Simulate the burn at dt = 1/60 with this local helper:

```ts
// p, v along +X for clarity; also run one case along (1,1,1)/√3.
function fly(p0: number, v0: number, pilotOut: number, seconds: number) {
  const p = { x: p0, y: 0, z: 0 }, v = { x: v0, y: 0, z: 0 };
  let maxR = p0, backInsideAt = -1, maxInward = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    v.x += pilotOut / 60;             // pilot holding outward thrust (u/s²)
    edgeReturn(p, v, 1 / 60);
    p.x += v.x / 60;
    maxR = Math.max(maxR, p.x); maxInward = Math.max(maxInward, -v.x);
    if (backInsideAt < 0 && p.x < SYSTEM_RADIUS) backInsideAt = t;
  }
  return { maxR, backInsideAt, maxInward };
}
it("stops a warp-speed crossing before 440 and returns it within 6 s", () => {
  const r = fly(400.01, 39, 0, 10);
  expect(r.maxR).toBeLessThan(440); expect(r.backInsideAt).toBeGreaterThan(0); expect(r.backInsideAt).toBeLessThan(6);
});
it("still returns a pilot holding full outward thrust (25.2 u/s²)", () => {
  const r = fly(400.01, 10.8, 25.2, 15);
  expect(r.maxR).toBeLessThan(440); expect(r.backInsideAt).toBeGreaterThan(0);
});
it("never pushes inward faster than EDGE_RETURN_SPEED", () => {
  expect(fly(420, 0, 0, 10).maxInward).toBeLessThanOrEqual(EDGE_RETURN_SPEED + 1e-9);
});
it("does nothing inside the system", () => {
  const v = { x: 39, y: 0, z: 0 };
  expect(edgeReturn({ x: 399, y: 0, z: 0 }, v, 1 / 60)).toBe(false); expect(v.x).toBe(39);
});
it("edgeDepth is radial: 0 inside 360, 1 at 400 and beyond, along any direction", () => {
  const d = (r: number) => edgeDepth(r / Math.sqrt(3), r / Math.sqrt(3), r / Math.sqrt(3));
  expect(d(359)).toBe(0); expect(d(400)).toBeCloseTo(1, 9); expect(d(430)).toBe(1);
  expect(edgeDepth(250, 250, 0)).toBe(0); // the old cube corner zone is inside now
});
it("the return-burn line plays once, then waits out its 20 s cooldown", () => {
  const g = new ReturnBurnLineGate();
  expect(g.update(true, 0, false)).toBe(true); expect(g.update(true, 5, false)).toBe(false);
  expect(g.update(true, 21, false)).toBe(true); expect(g.update(true, 22, true)).toBe(false);
});
```

- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run tests/edgeHaze.test.ts`. Expected: FAIL, `edgeReturn` / `ReturnBurnLineGate` not exported.
- [ ] **Step 3: Implement** the helpers and the Spaceship wiring under Files. In `edgeReturn`, use n = p/|p| and vr = v·n:
  - if vr > 0, subtract min(vr, `EDGE_BRAKE`·dt)·n;
  - else, if −vr < `EDGE_RETURN_SPEED`, add the inward push min(`EDGE_BRAKE`·dt, `EDGE_RETURN_SPEED` + vr)·(−n).
- [ ] **Step 4: Run the tests and the type check.** `npx vitest run tests/edgeHaze.test.ts && npx tsc --noEmit -p tsconfig.app.json`. Expected: PASS. Other tests that use `COSMIC_BOUNDS` still compile through the temporary re-export.
- [ ] **Step 5: Commit**

`feat(edge): a 400-unit system with a return burn instead of wrap-around (F11)`

---

### Task 2: Plain distances everywhere

**Files:**
- Delete: `src/utils/toroidal.ts`, `tests/toroidal.test.ts`, `tests/toroidal3.test.ts`, `tests/wrapDelta.test.ts`.
- Modify every use of `wrapDelta` / `toroidalDistance` / `toroidalDistance3` / `wrapCoord`. Replace each with a plain difference or `Math.hypot`, allocation-free in frame loops. From the survey:
  - `src/components/canvas/SpacePlanets.tsx` (~558, 574)
  - `src/components/canvas/Spaceship.tsx` (~627, 679)
  - `src/utils/gravityWell.ts` (~79–81)
  - `src/utils/scannables.ts` (~24)
  - `src/utils/logbook.ts` (~85, convoy sighting)
  - `src/components/canvas/FuelCrystals.tsx` (~146)
  - `src/components/canvas/DataShards.tsx` (~102)
  - `src/utils/tractorBeam.ts` (~3, 48, 81–92: drop `nearImage` and the re-wrap)
  - `src/components/canvas/TractorBeam.tsx`, `WarpTunnel` (if they call these)
- `src/utils/crystalField.ts` (~90–92): spawn uniformly in the sphere of `SYSTEM_RADIUS`, keeping all keep-outs and rejection bands. Count unchanged at 40.
- `src/components/canvas/PlasmaAnomalies.tsx` (~21, 83–92): clamp to the sphere.
- Tests:
  - update `tests/logbook.test.ts` (~88, the convoy across the seam), `tests/crystalField.test.ts` (~66–68) and `tests/gravityWell.test.ts`;
  - add `tests/plainDistance.test.ts`.

**Interfaces:**
- Consumes: `SYSTEM_RADIUS` (Task 1).
- Produces: nothing new. `toroidal.ts` is gone.

- [ ] **Step 1: Write the failing test** `tests/plainDistance.test.ts`, straddling the old seam:
  - `nearestScannable` from (245, 0, 0) to a target at (−245, 0, 0) reports distance 490, not 10;
  - `convoySighted` from x = 240 to a convoy at x = −240 is false (it was true across the seam);
  - `wellAccel` / `stepGravity` from (245, 0, 0) gets no pull from a well at (−245, 0, 0);
  - `crystalField`: 1,000 spawns all lie within `SYSTEM_RADIUS`, and at least one lies beyond 250 on some axis.
- [ ] **Step 2: Run it and see it fail.** Run: `npx vitest run tests/plainDistance.test.ts`. Expected: FAIL (seam distances).
- [ ] **Step 3: Implement** the replacements listed under Files.
- [ ] **Step 4: Confirm no wrap is left.** `grep -rnE "wrapDelta|toroidal|wrapCoord|nearImage" src tests` must return nothing. Then run `npx vitest run && npx tsc --noEmit -p tsconfig.app.json`. Expected: PASS, except tests Task 3 owns; list them in the report.
- [ ] **Step 5: Commit**

`refactor(space): plain 3D distances — no seam anywhere`

---

### Task 3: Radar, HUD, live sky and beacons

**Files:**
- `src/components/layout/RadarMap.tsx`: `RANGE = 220`; plain deltas (~70–216); anything beyond range stays a rim arrow.
- `src/components/canvas/Ghosts.tsx` (~25, 158–160): draw ghosts at their real positions.
- `src/utils/liveSky.ts`:
  - clamp incoming positions to the `VALIDATION_RADIUS` sphere (~46);
  - remove `wrap()` (~95–97);
  - `blendInto` lerps straight (~102);
  - `nearestGhosts` (~181) and `shouldSend` (~212–214) use plain distance.
- `src/utils/liveSkyProtocol.ts` (~48): `inWorld` becomes finite and `|p| <= VALIDATION_RADIUS`.
- `src/utils/beacons.ts` (~32): `inBounds` becomes `|p| <= VALIDATION_RADIUS`. Add `beaconVisible(p): boolean` (`|p| <= SYSTEM_RADIUS`) and use it wherever beacons are drawn and registered as scannables (`src/components/canvas/Beacons.tsx`).
- `src/components/layout/HUDOverlay.tsx` (~193): `SECTOR.RANGE` from `distanceAU(SYSTEM_RADIUS * 2)`.
- `src/components/layout/EdgeHaze.tsx`: no change beyond the new `edgeDepth`; confirm.
- Remove the temporary `COSMIC_BOUNDS` re-export, and update the remaining tests:
  - `tests/liveSky.test.ts`, `tests/liveSkyProtocol.test.ts`, `tests/skyRoom.test.ts`
  - `tests/realUnits.test.ts` (~39: 4.35 AU becomes 6.96 AU)
  - `tests/fuel.test.ts` (~29: "covers three full crossings of the system": `seconds × SHIP_WARP_SPEED > SYSTEM_RADIUS × 2 × 3`, which is 2,437 > 2,400)
  - `tests/shipyardGate.test.ts` (~11, 73: the gate inside the radial `HAZE_START`)
  - `tests/beacons.test.ts`

**Interfaces:**
- Consumes: `SYSTEM_RADIUS`, `VALIDATION_RADIUS` (Task 1).
- Produces: `beaconVisible(p: { x: number; y: number; z: number }): boolean` in `src/utils/beacons.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `tests/liveSkyProtocol.test.ts`: a `me` at (435, 0, 0) is accepted, at (445, 0, 0) rejected, at (240, 240, 240) (|p| = 415.7) accepted.
  - `tests/beacons.test.ts`: `inBounds` accepts |p| = 430 and rejects 450; `beaconVisible` is false at (250, 250, 250) (433) and true at (200, 200, 200).
  - `tests/realUnits.test.ts`: `distanceAU(SYSTEM_RADIUS * 2).toFixed(2) === "6.96"`.
  - `tests/fuel.test.ts`: the three-crossings claim above.
- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run tests/liveSkyProtocol.test.ts tests/beacons.test.ts tests/realUnits.test.ts tests/fuel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes listed under Files.
- [ ] **Step 4: Run the full checks.** `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint`, and `grep -rn "COSMIC_BOUNDS" src tests beacon-api` returns nothing. Expected: all green; lint shows only the one existing warning.
- [ ] **Step 5: Commit**

`feat(edge): sphere-bounded radar, HUD, live sky and beacons`

---

### Task 4: Probes, docs, changelog, verification

**Files:**
- `tests/e2e/flight.probe.mjs`: replace the wrap-seam section (~3, 15, 119–170) with **"flying out at warp, the ship is returned"**:
  - from (380, 0, 0) facing +X, hold warp until 400 is crossed;
  - assert the maximum |p| stays under 440;
  - assert the ship is back inside 400 within 6 simulated seconds (poll generously; headless runs about 3× slow);
  - assert the return-burn radio line was broadcast.
- `tests/e2e/mechanics.probe.mjs` (~20–40): the edge test becomes **"holding thrust outward at the edge, the ship is still brought back"**, plus **"the haze is full at 400"** (the overlay opacity reads `HAZE_MAX_OPACITY`).
- `tests/e2e/fuel.probe.mjs` (~71–73, 284–366): the wrap-aware crystal picker and the torus antipode search become plain distance. A point at least 160 from every crystal inside the sphere is found by sampling.
- `docs/UNIVERSE-RULES.md`: L18 → Follows. The F11 section of the fixes design is marked built at radius 400 (the assist-off clause deferred to F1). The spec's item 2 is updated to 40 u/s².
- `README.md`: a "Deploying" note that `beacon-api` must be redeployed before this merges.
- `src/data/changelog.ts`: the entry under Global Constraints, within the format limits.
  - **what:** the universe is about 60% wider and has a real edge, where the flight computer turns you back instead of wrapping you to the other side;
  - **why:** room for new worlds, and space doesn't wrap;
  - **how:** a 400-unit sphere, a return burn that cuts warp and brakes you, and plain distances everywhere.
- `docs/PERF-BUDGETS.md`: re-measure and note any change.

- [ ] **Step 1: Rewrite the probes** listed under Files.
- [ ] **Step 2: Docs and changelog.** Run: `npx vitest run tests/changelog.test.ts`. Expected: PASS.
- [ ] **Step 3: Full verification.** `npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npm run lint && npm run build && npm run test:e2e`. Expected: all green and programs `added=0`. If headless Chrome hangs on a probe (known on this machine), re-run it alone and report both runs.
- [ ] **Step 4: Screenshots** (Playwright MCP against `npm run dev -- --port 5200 --strictPort`; stop only your PID; close tabs):
  - the haze at 360 and at 400;
  - the radar from the system's middle (r ≈ 200);
  - the ship mid return burn.

  Save to the scratchpad and describe them in the report.
- [ ] **Step 5: Commit**

`test(e2e): the edge returns the ship; docs and changelog for A`
