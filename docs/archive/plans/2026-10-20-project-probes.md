# Project Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three project dossiers move off the planets onto three Voyager-style probes. A pilot grabs a probe with the tractor beam to open its dossier, and on close the probe burns away to a remote spot. The planets become solid, scan-only bodies.

**Architecture:**
- **Pure layer:**
  - `src/data/probes.ts`: the probe table (home spot plus remote pool).
  - `src/utils/probes.ts`: spot cycling, storage sanitising, the relocation curve and the beacon blink.
- **Store:** a new popup state `openDossier`, independent of `isOrbitLocked`. The derived selector `selectModalOpen` replaces "a dossier is open ⇔ `isOrbitLocked`" everywhere.
- **Live positions:** a mutable `probePos` registry (like `bodies`) feeds the beam, jumps, waypoint, radar and HUD.
- **Rendering:** `ProjectProbes.tsx` renders one InstancedMesh of 3.
- **Planets:** they leave the zone/lock loop and join the world collision path.

**Tech Stack:** React 19, @react-three/fiber 9, three 0.185, zustand, Vitest, Node e2e probes (`npm run test:e2e`), Blender 5.1.2 headless (`~/Applications/Blender.app`), gltf-transform via `scripts/optimize-assets.mjs`.

**Spec:** `docs/archive/specs/2026-10-20-project-probes-design.md` (approved 2026-10-20, all §7 calls accepted). Read it alongside this plan.

## Global Constraints

**Branch and scope**
- Branch `feat/project-probes` (it holds the spec commits). One PR, **#39**; the changelog entry has `pr: 39`.
- **No change** to `beacon-api/`, `src/utils/liveSkyProtocol.ts`, `src/data/plumeColors.ts` or `CHART_TOTAL`. There is no Worker deploy.
- Subagents must not install packages, run `pnpm`/`npm install`, or kill processes by name (`pkill`, `kill -9 <name>`). Kill by PID only, and only processes they started.

**Ids and storage**
- Probe ids **are the project ids**: `ruangrapi`, `portfolio`, `fuxx`, in `projects.json` order. Jump/pad ids stay these strings, so `JUMP_TARGETS` ids keep their current order: `["ruangrapi","portfolio","fuxx","career","shipyard","contact"]`.
- `fitz-dossiers` keeps its key and values. It is filtered by **project ids** (not `PLANET_IDS`).
- `fitz-probes` (new): `Record<projectId, spotIndex>`. Index 0 = home, 1..n = remote pool. It is sanitised on load.
- The planets keep their internal ids (`ruangrapi`/`portfolio`/`fuxx`) for moons, textures, occluders, `PLANET_PROPS`, `PLANET_ORBITS` and assets.

**Values pinned by the spec**
- Beam: `BEAM_RANGE` 30, `BEAM_HALF_ANGLE` 20°, shared `BEAM_MAX_TARGETS` 3.
- Beacon blink: ≤ 1.5 Hz, eased (no hard on/off steps). Brightness changes by no more than one full swing per 1/3 s.
- Remote spots are 150–420 u from `SPAWN`, `|p| ≤ SYSTEM_RADIUS − 60` (420), and clear of every planet/world reach, destination, gate, belt and crystal field.
- Planet display names: ruangrapi → `OCEAN WORLD`, portfolio → `BANDED GIANT`, fuxx → `RUST WORLD`.
- Planet atmosphere colours are unchanged. Orbit-path rings and HUD/radar/scan/system-chart colours use a new neutral `color`. Project colours (`#00ff87`, `#00f0ff`, `#bd00ff`) are used by the probes only.
- **Reduced motion:** the relocation is an instant move, with the same radio line.

**Rendering and performance**
- Probes: one `InstancedMesh` (3 instances), one material, **no lights** (`LIGHT_BUDGET` 4). Always mounted, so ShaderWarmup compiles it at load.
- Budget: +1 draw call (≤ +2). The `programs.probe.mjs` tour adds 0 programs. Every perf state stays under its existing ceiling. A load-time program increase of 1–2 is allowed and recorded in `docs/PERF-BUDGETS.md`.
- Frame loops allocate nothing. Both perf tiers and reduced motion keep working.

**Copy rules**
- Radio/HUD lines are uppercase, `//`-separated, in the existing tone.
- Changelog limits (`tests/changelog.test.ts`): title ≤ 4 words, what ≤ 220, why ≤ 220, how ≤ 240 chars.

**Verification bar (every task)**
- `npx vitest run` green, `npx tsc -b` clean, `npm run lint` clean.
- Tasks that touch the scene also run their named e2e probes.
- The final task runs the full `npm run test:e2e`.

## Review Focus

1. **Résumé toggle while a probe dossier is open.** `setShowClassicCV(true)` must close the popup. A probe it came from relocates as on a normal close. Returning to the cabin must not mount a frozen canvas (the PR-era "mount-while-frozen" hole). The test goes in Task 3.
2. **Reload during the relocation flight.** The new spot is persisted at close time, so a reload mid-burn shows the probe at its destination, not home and not mid-air. The test goes in Task 3.
3. **Two probes in the cone, or a probe grabbed while relocating.** Only the nearest grabbable probe opens. A relocating probe is never selected by the beam. A second popup cannot open over the first. The tests go in Task 6.
4. **Hand-edited or stale storage.** `fitz-probes` as a non-object, unknown ids, or a float/negative/out-of-range index each fall back to home without crashing. `fitz-dossiers` with old ids keeps only project ids. The tests go in Task 2 and Task 3.
5. **Reduced motion and photo mode.** Under reduced motion, a close teleports the probe at once. In photo mode the beam is off, so nothing can be grabbed, and an in-flight relocation completes on the next unfrozen frame. The tests go in Task 6.

---

### Task 1: The probe model (owner look check)

**Files:**
- Create: `scripts/blender/gen_probe.py` (seeded, headless, same structure as `gen_shard.py`/`gen_buoy.py`, using `bake_utils.py`)
- Create: `scripts/blender/turntable_probe.py` (Cycles turntable stills, same approach as `turntable_worlds.py`)
- Modify: `scripts/blender/generate.sh` (add the probe), `scripts/optimize-assets.mjs:50` (add `"probe"` to `MODELS`)
- Create (generated): `public/models/probe.glb`
- Modify: `tests/assetProvenance.test.ts` (`"probe.glb": "scripts/blender/gen_probe.py"`), `tests/assetContracts.test.ts` (new contract block)
- `assets-src/` (separate git repo): the `.blend` original plus a `MANIFEST.md` row. Commit and push with the `fitzfitz` token (`GH_TOKEN="$(gh auth token --user fitzfitz)" git -C assets-src -c credential.helper= -c credential.helper='!gh auth git-credential' push`; if it stalls, retry with `-c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60`).

**Interfaces:**
- Produces: `public/models/probe.glb` with exactly **one mesh, one primitive, one `MeshStandardMaterial`**. Its vertex colour attribute `COLOR_0` carries the zone mask:
  - R = insignia/trim zone (tinted per instance);
  - G = beacon lamp (emissive, blinked per instance);
  - B unused.
- Required parts: the high-gain dish (facing +Z), a foil-wrapped bus, the RTG boom, the magnetometer boom, the golden plate on the bus front, and an RCS nozzle cluster.
- Overall length along its longest axis is 3.0 u ±10% after `bakeNodeTransform` (about the ship's size, under 2× it).

- [ ] **Step 1: Write the failing contract tests** in `tests/assetContracts.test.ts`:
  - `"probe.glb: one mesh, one primitive, one material"`
  - `"probe.glb: COLOR_0 present; R and G masks each cover > 0 and < 25% of vertices"`
  - `"probe.glb: triangles <= 6000"`
  - `"probe.glb: longest extent 2.7–3.3"`

  Add the provenance row.
- [ ] **Step 2: Run** `npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts`. Expected: FAIL (file missing).
- [ ] **Step 3: Write `gen_probe.py`.**
  - Photoreal PBR: gold/amber Kapton foil with crinkle normal detail, white-painted dish, dark RTG fins, brushed-metal booms.
  - Bake to the shared material as the other generators do. Write the masks to `COLOR_0`.
  - Run it with `~/Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/gen_probe.py`, then `node scripts/optimize-assets.mjs`.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Render the turntable** (`turntable_probe.py`): 4 angles plus one close-up of the golden plate, at 1024². Write them to the session scratchpad and show them to the owner.
- [ ] **Step 6: STOP for the owner's approval of the look.** Iterate Steps 3–5 on their feedback. Do not start Task 6 rendering work until they approve. Tasks 2–5 may proceed in parallel.
- [ ] **Step 7: Commit** the generator, GLB and tests. Commit and push `assets-src`.

```bash
git add scripts/blender/gen_probe.py scripts/blender/turntable_probe.py scripts/blender/generate.sh scripts/optimize-assets.mjs public/models/probe.glb tests/assetContracts.test.ts tests/assetProvenance.test.ts
git commit -m "feat(probes): photoreal probe model"
```

---

### Task 2: Probe table and pure logic

**Files:**
- Create: `src/data/probes.ts`, `src/utils/probes.ts`
- Modify: `src/utils/crystalField.ts:58` (`CRYSTAL_LANDMARKS` gains every probe home and remote spot)
- Test: `tests/probes.test.ts` (new), `tests/planetClearance.test.ts` (extend)

**Interfaces:**
- Produces, in `src/data/probes.ts`:
  ```ts
  export type Vec3T = readonly [number, number, number];
  export interface ProbeDef { id: string; home: Vec3T; remote: readonly Vec3T[] }
  export const PROBES: readonly ProbeDef[];        // projects.json order
  export const PROBE_IDS: readonly string[];       // PROBES.map(p => p.id)
  export const PROBE_RADIUS = 1.6;                 // solid/keep-out radius of the model
  export const PROBE_JUMP_STANDOFF = 12;           // inside BEAM_RANGE
  export const PROBE_OPEN_DIST = 4;                // the popup opens when the pulled probe is this close to the nose origin
  export const PROBE_PULL_SPEED = 14;
  export const PROBE_IN_RANGE = 45;                // HUD tip and chatter radius
  ```
- Produces, in `src/utils/probes.ts`:
  ```ts
  export function loadProbeSpots(raw: unknown): Record<string, number>; // every PROBE_ID present, invalid → 0
  export function nextSpot(def: ProbeDef, spot: number): number;         // 0→1, k→k+1, last→1 (never back to 0)
  export function spotPos(def: ProbeDef, spot: number): Vec3T;           // 0 → home, k → remote[k-1]
  export const RELOCATE_S = 2.5;
  export function relocationTravel(t: number): number;  // distance flown along the burn direction after t s; ease-in, 0 at 0, 60 at RELOCATE_S
  export function beaconLevel(t: number, phase: number): number; // 0..1, smooth, period 1/1.2 s
  ```

- [ ] **Step 1: Write the failing tests** in `tests/probes.test.ts`:
  - `PROBE_IDS` equals `projects.map(p => p.id)`.
  - Every probe has 6–8 remote spots.
  - Every home spot is within 90 u of `SPAWN`. Probe 1's home is within 45 u of `SPAWN` and in front of the spawn heading (the dot product with the heading toward probe 1 is > 0 — the spawn heading is defined in Task 7).
  - Every remote spot is 150–420 u from `SPAWN`, and its length is ≤ `SYSTEM_RADIUS − 60`.
  - `nextSpot` cycles `0→1→…→n→1`.
  - `spotPos(def,0)` equals home.
  - `loadProbeSpots`:
    - `null`, `[]` and `"x"` give all zeros;
    - `{ruangrapi: 2.5}`, `{ruangrapi: -1}` and `{ruangrapi: 99}` give `ruangrapi: 0`;
    - an unknown id is dropped;
    - `{portfolio: 3}` keeps 3 when `remote.length ≥ 3`.
  - `relocationTravel`: `(0) === 0`; it is monotonic; `(RELOCATE_S)` is within 1e-9 of 60; its second derivative is > 0 (ease-in).
  - `beaconLevel`:
    - its range stays within [0,1];
    - over 10 s sampled at 1 ms, the count of upward crossings of 0.5 is ≤ 15 (1.5 Hz);
    - the maximum |Δ| between consecutive 1 ms samples is ≤ 0.02 (no hard steps).
- [ ] **Step 2: Extend `tests/planetClearance.test.ts`.** Every home and remote spot (plus `PROBE_RADIUS`) clears:
  - every planet's and world's orbit tube (the existing reach rules);
  - every destination's `zoneR`;
  - the gate, the shards, the career buoys and the ring-course gates (the existing helper margins);
  - the asteroid belt and halo bands.
- [ ] **Step 3: Run** `npx vitest run tests/probes.test.ts tests/planetClearance.test.ts`. Expected: FAIL (the modules are missing).
- [ ] **Step 4: Implement** both modules.
  - Pick the coordinates by hand, guided by the failing clearance assertions. Spread the homes so the waypoint walks probe 1 → 2 → 3, and spread each remote pool around the system.
  - `beaconLevel` = `0.5 − 0.5·cos(2π·1.2·t + phase)`, raised to a soft power (≥ 1.5) so the beacon rests dim and peaks briefly. Recheck the |Δ| bound.
- [ ] **Step 5: Add** the spots to `CRYSTAL_LANDMARKS`. Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 6: Commit** with `git commit -m "feat(probes): probe table, spot cycling, relocation and beacon curves"`.

---

### Task 3: Store — dossier popup state, probe spots, progress by project id

**Files:**
- Create: `src/store/probeState.ts`
- Modify: `src/store/spaceStore.ts` (lines ~21, 134-137, 300-420 interface, 601-690 actions, 730-734 selector)
- Test: `tests/spaceStore.test.ts`

**Interfaces:**
- Consumes: `PROBES`, `PROBE_IDS`, `spotPos`, `nextSpot`, `loadProbeSpots` (Task 2).
- Produces, in `src/store/probeState.ts` (mutable, outside React, like `bodies`):
  ```ts
  export const probePos: Record<string, { x: number; y: number; z: number }>; // initialised from fitz-probes spots
  export const probeRelocating: Record<string, boolean>;                      // true while the burn plays
  ```
- Produces, in `SpaceState`:
  ```ts
  openDossier: string | null;                 // project id whose popup is open
  dossierVia: "probe" | "logbook" | null;
  probeSpots: Record<string, number>;         // persisted fitz-probes
  relocation: { id: string; seq: number } | null; // consumed by ProjectProbes (Task 6)
  probeNear: string | null;                   // nearest probe within PROBE_IN_RANGE (Task 6 writes, change-guarded)
  openProjectDossier: (id: string, via: "probe" | "logbook") => void;
  closeDossier: () => void;
  setProbeNear: (id: string | null) => void;
  ```
- Produces, exported:
  - `selectModalOpen(s: Pick<SpaceState,"isOrbitLocked"|"openDossier">): boolean` (either is set);
  - `selectSceneFrozen` now returns `selectModalOpen(s) && !s.photoMode`.
- Behaviour:
  - `openProjectDossier` ignores unknown ids and any call while `openDossier` is set.
  - It records the visit exactly as `setOrbitLocked` does today: append to `visitedDossiers` and persist `fitz-dossiers`. It also clears `isWarping`.
  - `closeDossier`, when the dossier came from a probe:
    - sets `probeSpots[id] = nextSpot(...)`;
    - persists `fitz-probes` **before** any animation;
    - sets `relocation`.
  - Both close routes clear `openDossier`/`dossierVia`.
  - `setShowClassicCV(true)` calls `closeDossier()` next to `breakOrbit()`.
  - `requestJump` accepts `PROBE_IDS` (in place of `PLANET_IDS`).
  - `loadVisitedDossiers` filters by `projects.map(p => p.id)`.
  - `setOrbitLocked` no longer records dossiers (planets don't lock any more). It keeps the warp clear and the destination badge.

- [ ] **Step 1: Write the failing tests** in `tests/spaceStore.test.ts`:
  - **Replace** "locking onto a project planet records it once" with:
    - `"openProjectDossier records the visit once and persists fitz-dossiers"`;
    - `"openProjectDossier while one is open is ignored"`;
    - `"unknown id is ignored"`.
  - `"closeDossier via probe advances and persists fitz-probes before relocation is set"`: spy on `safeSetJSON` order, or read localStorage at the moment `relocation` changes.
  - `"closeDossier via logbook leaves probeSpots and relocation untouched"`.
  - `"setShowClassicCV(true) closes an open dossier and the scene is not frozen afterwards"` (Review Focus 1).
  - `"a reload after close starts the probe at its new spot"`: re-import the store module with the persisted `fitz-probes`, then check `probePos` equals `spotPos(def, 1)` (Review Focus 2).
  - `"fitz-dossiers with stale ids keeps only project ids"` (Review Focus 4).
  - `"selectSceneFrozen: dossier open → frozen; photo mode → not frozen; orbit lock still freezes"`.
  - `"requestJump accepts probe ids and destinations, rejects world ids"`.
- [ ] **Step 2: Run** `npx vitest run tests/spaceStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the state, actions, selector and `probeState.ts`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS, except tests that the later tasks rewrite. List any such failures in the commit message; they must be green by the end of Task 8.
- [ ] **Step 5: Commit** with `git commit -m "feat(probes): dossier popup state and persisted probe spots"`.

---

### Task 4: The dossier popup component

**Files:**
- Create: `src/components/layout/ProjectDossier.tsx` (extracted from `src/App.tsx:296-385`, following the `CareerDossier.tsx` pattern)
- Modify: `src/App.tsx` (lines 98-106 Esc, 116-126 key guards, 146-150 lookups, 173-181 letterbox, 247-290 spawn card, 296-385 dossier)
- Test: `tests/projectDossier.test.tsx` (new; React Testing Library, as the other `*.test.tsx` files use)

**Interfaces:**
- Consumes: `openDossier`, `dossierVia`, `closeDossier`, `selectModalOpen` (Task 3).
- Produces: `export default function ProjectDossier({ project, via, onClose }: { project: Project; via: "probe" | "logbook"; onClose: () => void })`.
- Copy changes:
  - The badge `ORBIT_LOCKED` → `PROBE_RECOVERED`. When opened from the logbook it reads `LOGBOOK_COPY`.
  - The button `THRUSTERS_BREAK_ORBIT` → `RELEASE_PROBE`. From the logbook it reads `CLOSE_DOSSIER`.
  - The close X label stays "Close dossier (Esc)".
- App wiring:
  - The popup shows when `openDossier` is set.
  - Esc closes it (outside editable targets).
  - L/N/B are blocked while `selectModalOpen`.
  - The letterbox shows on `selectModalOpen`.
  - The spawn card hides while `openDossier` is set.
- Spawn card copy:
  - "Three probes carry three projects. Grab one with the tractor beam to open it."
  - The control line keeps its three variants.
  - The fast path label: `OR JUMP STRAIGHT TO`. It adds the line `THEN HOLD F` (pad: `THEN HOLD LB`; touch: `THEN HOLD BEAM`).

- [ ] **Step 1: Write the failing tests:**
  - It renders the title, short line, description, tech and repo link for each project.
  - The badge and button text depend on `via`.
  - The X and the main button both call `onClose`.
  - The X has `autoFocus`.
- [ ] **Step 2: Run** `npx vitest run tests/projectDossier.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Extract and wire** the component. Remove the `planetProject` lookup from App.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(probes): dossier popup opens from probe state"`.

---

### Task 5: Every "dossier open" consumer reads `selectModalOpen`

**Files** (each currently keys "a modal is open" off `isOrbitLocked`):
- `src/components/layout/LogbookPanel.tsx:39-41,55`
- `src/components/layout/ChangelogPanel.tsx:20,34`
- `src/components/layout/TouchControls.tsx:22-39,64`
- `src/hooks/useSound.ts:25-28`: the chime on open and the thunk on close, also for `openDossier`
- `src/hooks/useGamepadInput.ts:31-32`: B closes either. Route it to `closeDossier` when `openDossier` is set, otherwise to `breakOrbit`.
- `src/hooks/useKeyboardInput.ts:60`
- `src/components/canvas/RingCourse.tsx:167` (race abort)
- `src/components/layout/HUDOverlay.tsx` (~178-182, ScanRing/BuoyCard hide; the 152-165 completion line fires on `!selectModalOpen`)
- `src/components/canvas/WaypointDriver.tsx:33`
- `src/components/canvas/Spaceship.tsx:531` (beam forced off)
- `src/components/canvas/GlobalCanvas.tsx:476,519` (already through `selectSceneFrozen`; verify only)
- **Input clearing:** when `openDossier` turns non-null, reset the held input (keyboard, touch and pad state, using the TouchControls reset pattern), so F/W don't act under the modal.
- Test: `tests/modalOpen.test.ts` (new) covers the selector use. Extend the component tests where they exist.

**Interfaces:**
- Consumes: `selectModalOpen`, `closeDossier` (Task 3).

- [ ] **Step 1: Write the failing tests.** For each consumer with a unit seam (gamepad action routing in `padAction`/`useGamepadInput`, and LogbookPanel auto-close): with `openDossier: "fuxx"` and `isOrbitLocked: false`, it behaves as when locked today.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Switch** every listed consumer. Wherever both "locked" and "dossier open" mean "modal open", write `useSpaceStore(selectModalOpen)`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(probes): an open dossier behaves like a docked modal everywhere"`.

---

### Task 6: `ProjectProbes` — render, beam grab, relocation

**Files:**
- Create: `src/components/canvas/ProjectProbes.tsx`
- Modify:
  - `src/utils/tractorBeam.ts:17`: `BeamKind` gains `"probe"`.
  - `src/components/canvas/TractorBeam.tsx:64-80`: consider probes.
  - `src/components/canvas/GlobalCanvas.tsx`: mount after `TractorBeam` and before `SpacePlanets`, like DataShards.
  - `src/debug/bridge.ts`: `probes: typeof probePos | null` registered in dev.
- Test: `tests/tractorBeam.test.ts` (extend), `tests/probeGrab.test.ts` (new, pure step logic)

**Interfaces:**
- Consumes: Task 1's GLB, Task 2's constants and curves, Task 3's store and `probePos`/`probeRelocating`.
- Produces, in `src/utils/probes.ts` (pure, testable):
  ```ts
  export function grabbableProbe(ox,oy,oz,dx,dy,dz, pos: Record<string,{x:number;y:number;z:number}>, relocating: Record<string,boolean>): string | null; // nearest in cone+range, skipping relocating
  ```
- Behaviour:
  - **Beam selection.** TractorBeam calls `grabbableProbe` and `consider(sel, budget, "probe", PROBE_IDS.indexOf(id), …)` before crystals, so a probe wins its slot.
  - **Pull.** ProjectProbes pulls the selected probe with `pullStep(..., PROBE_PULL_SPEED)`. When the remaining distance to the nose origin is ≤ `PROBE_OPEN_DIST`, it calls `openProjectDossier(id, "probe")` once. This happens only if no modal is open and the store is not in photo mode.
  - **Release.** If the beam is released mid-pull, the probe stays where it is and drifts back to its spot at 2 u/s.
  - **Relocation.** On `relocation.seq` change:
    - set `probeRelocating[id]`;
    - point the burn away from the ship;
    - move by `relocationTravel(t)` for `RELOCATE_S`, then snap to `spotPos(def, probeSpots[id])`;
    - clear the flag;
    - send the radio line `PROBE RELOCATING // <TITLE> SIGNAL REACQUIRED <bearing> AT <distance> U` (non-silent; through `sendBroadcast`, as with destination-adjacent lines).

    Under reduced motion it snaps at t = 0.
  - **Each frame:**
    - write `probePos`;
    - set the instance matrices (slow idle spin of 0.15 rad/s, frozen under reduced motion);
    - set instance colour: project colour on the R zone, `beaconLevel` on the G zone, through a small `onBeforeCompile` patch reading `COLOR_0` (fallback: two meshes; see spec §4.1);
    - add a faint RCS puff every ~6 s (an emissive flash on the nozzle zone is enough; no particles needed);
    - `setProbeNear` for the nearest probe within `PROBE_IN_RANGE`, change-guarded.
  - **Pickup tip.** The HUD shows `PROBE IN RANGE // HOLD F TO GRAB` (pad `LB`, touch `BEAM`) while `probeNear` is set and no modal is open.

- [ ] **Step 1: Write the failing tests.**
  - `grabbableProbe`:
    - It returns the nearest of two probes in the cone.
    - It skips a relocating probe.
    - It returns null outside 30 u or outside 20°.

    (Review Focus 3)
  - `consider` with `"probe"` keeps nearest-first and respects the shared budget.
  - The store side of Review Focus 3/5:
    - `openProjectDossier` is a no-op while another is open (Task 3 test; reference it).
    - A new pure helper `relocationDone(elapsed: number, reducedMotion: boolean): boolean` returns true at 0 under reduced motion and at ≥ `RELOCATE_S` otherwise.
- [ ] **Step 2: Run** `npx vitest run tests/probeGrab.test.ts tests/tractorBeam.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure functions, the beam change, `ProjectProbes.tsx`, the HUD tip and the bridge registration. Relocation timing reads frame `dt`, so a frozen or photo-mode frame simply doesn't advance it and it finishes on the next running frames.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Run** `npm run test:e2e -- transition programs mechanics`. Expected:
  - the deep-space calls stay ≤ ceiling;
  - the beam-on check is ≤ 110 calls;
  - the beam adds no program;
  - the programs tour adds 0.

  Paste the numbers into the commit message.
- [ ] **Step 6: Commit** with `git commit -m "feat(probes): grab a probe with the beam; it burns away on close"`.

---

### Task 7: Navigation follows the probes

**Files:**
- `src/data/destinations.ts:84,104-107`:
  - `JUMP_TARGETS` heads become the probes: id = project id, label = project title, colour = project colour.
  - Delete `WAYPOINT_PLANET_NAMES`.
- `src/utils/gamepad.ts:81-84`: `PAD_JUMPS` uses `PROBE_IDS[0..2]`.
- `src/components/canvas/Spaceship.tsx`:
  - **Jumps (539-561):** for a probe id, target = `probePos[id]` with standoff `PROBE_JUMP_STANDOFF`, using the `jumpPoint` level placement. No lock and no auto-open. Delete the planet branch and `JUMP_PLANET_FACTOR`.
  - **Spawn heading (86, 218-221):** face probe 1's home.
  - **Pre-flight auto-aim (577):** aim straight at probe 1 (`headingToward` plus the pitch to it), since it is static. `interceptAim` is no longer used here.
- `src/components/canvas/WaypointDriver.tsx`: `nextWaypoint(flight, PROBE_IDS, probePos, s.visitedDossiers, afterProbes(s.badges))`. The label is the project title plus ` PROBE`; the colour is the project colour.
- `src/components/layout/RadarMap.tsx`: a probe blip for each probe (diamond, 2.2 px, project colour, never hidden by range). The visited ring is keyed by project id. Planet blips stop drawing visited rings.
- `src/components/layout/HUDOverlay.tsx`:
  - The sector list (370-382) becomes `// SECTOR_PROBES — CLICK TO JUMP`. Rows show `[1..3]`, a project-coloured dot, `PROBE_<ID>` with live coords from `probePos`, and ✓ from `visitedDossiers`.
  - Destination key numbering stays `PROBES.length + i + 1`.
  - `ZONE_COLORS` (23-24) is keyed by probe id.
  - The TARGET line is `PROBE_<ID>` while `probeNear` is set.
  - The completion line uses `PROBES.length`.
- Rename `afterPlanets` → `afterProbes` (same behaviour); update its call sites and doc comments.
- Test: `tests/destinations.test.ts`, `tests/gamepad.test.ts`, `tests/padAction.test.ts`, `tests/navigation.test.ts`

**Interfaces:**
- Consumes: `PROBE_IDS`, `PROBE_JUMP_STANDOFF` (Task 2); `probePos` (Task 3).

- [ ] **Step 1: Update the tests to the new truth.**
  - `JUMP_TARGETS` ids are unchanged; their labels and colours come from `projects.json`.
  - Keys 1-3 map to `PROBE_IDS`.
  - The `PAD_JUMPS` d-pad is up/right/down → `PROBE_IDS`, left → career.
  - `nextWaypoint` over probes: it picks the nearest unread probe, then `afterProbes`.
  - The `navigation.test.ts` planet standoff test becomes: "a probe jump parks inside BEAM_RANGE and outside PROBE_RADIUS + ship half-length".
  - Remove the tests pinning `WAYPOINT_PLANET_NAMES`/planet standoffs.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(probes): keys, pad, waypoint, radar and HUD follow the probes"`.

---

### Task 8: Planets become solid, scan-only bodies

**Files:**
- `src/constants.ts`:
  - `PLANET_PROPS` (78-82) gains `label` (`OCEAN WORLD` / `BANDED GIANT` / `RUST WORLD`) and `color` (a neutral UI colour picked from each surface map).
  - `planets` (150-152) takes `color` from `PLANET_PROPS`, no longer from the project.
  - Update the doc comment at 7-10. A project id is still the planet's internal id, but no longer its zone.
- `src/components/canvas/SpacePlanets.tsx`:
  - Delete the planet branch of the zone/lock loop (553-566). Destinations stay.
  - Delete the gravity-field circles and `gravityMats` (331-334, 603-606, 617-620, 630-633).
  - The Atmosphere at 614 uses the literal `PORTFOLIO_ATMOSPHERE = "#00f0ff"`, so the look is unchanged.
  - The orbit rings use the new `p.color`.
  - The scannable label is `p.label` (457).
- `src/data/destinations.ts:72-77`: delete `ZONE_PLANETS`.
- `src/utils/worldCollide.ts`:
  - Generalise to `SOLID_BODIES: readonly { id: string; size: number; cameraR: number }[]` (planets, then worlds). For planets `cameraR` = `size × atmosphere shell` + `CAMERA_CLEARANCE`; read the shell from the Atmosphere `thickness` used in SpacePlanets.
  - `keepCameraOutsideWorlds` → `keepCameraOutsideBodies`, iterating `SOLID_BODIES`.
- `src/components/canvas/Spaceship.tsx`:
  - The collision loop (696-700) iterates `SOLID_BODIES`.
  - Delete the lock-entry planet lookup (270-312), the escape-grace planet path (98, 328, 657-662) and `WELL_RADIUS_BY_NAME`. Destinations keep their lock/escape.
- `src/utils/scanReport.ts`: planet report titles use `label`.
- `src/components/dom/SystemChart.tsx`: uses the new `p.color` (no change in code if it already reads `p.color`; verify).
- `src/data/chatterLines.ts:17-35`: the zone pools keyed `ruangrapi`/`portfolio`/`fuxx` stay, but fire on `probeNear` entry. Change "ENTERING <X> SECTOR" to "<X> PROBE IN RANGE".
  - In `src/components/layout/RadioChatter.tsx:51,65`, subscribe to `probeNear` for those three ids; `activeZone` still drives `contact`/`career`/`shipyard`.
- Delete `src/utils/capture.ts` if nothing else uses it (otherwise keep it for the destinations).
- Test:
  - `tests/projects.test.ts`: "every project has exactly one planet" becomes "every project has exactly one probe and one planet keyed by its id"; colour single-sourcing moves to the probes.
  - `tests/spaceWorlds.test.ts`: the `bodies` keys are unchanged.
  - `tests/orbitInvariant.test.ts`, `tests/orbitEscape.test.ts`, `tests/gravityWell.test.ts:175,235`, `tests/intercept.test.ts`, `tests/scannables.test.ts`, `tests/scanReport.test.ts`.
  - `tests/worldCollide.test.ts`, new or extended.

**Interfaces:**
- Produces: `SOLID_BODIES`, `keepCameraOutsideBodies(cam, centers)`, `PlanetData.label`.

- [ ] **Step 1: Write the failing tests.**
  - `"a ship driven into each planet at 39 u/s stops at its surface"`: `resolveWorldContact` over `SOLID_BODIES`, simulated 2 s at 60 Hz.
  - `"camera kept outside each planet's atmosphere shell"`.
  - `"planet labels are OCEAN WORLD / BANDED GIANT / RUST WORLD"`.
  - `"no planet colour equals a project colour"`.
  - `"Portfolio atmosphere colour is still #00f0ff"`.
  - `gravityWell.test.ts:175` becomes `"a fast skim neither sticks nor passes through"`.
  - Delete the lock-geometry tests that only made sense for planet docking (`orbitInvariant` planet rows, `intercept` lock-radius pass). Keep their destination rows.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npm run lint`. Expected: **all** PASS, including anything Task 3 deferred.
- [ ] **Step 5: Commit** with `git commit -m "feat(probes): planets are solid scan-only worlds"`.

---

### Task 9: The logbook re-opens read dossiers

**Files:**
- `src/utils/logbook.ts:24-29`:
  - `DOSSIERS` derives from `PROBE_IDS`.
  - Hints become `GRAB THE RUANGRAPI PROBE (HOLD F)` / `GRAB THE FLIGHT-SIM CV PROBE (HOLD F)` / `GRAB THE FUXX PROBE (HOLD F)`.
  - The `hintShort` values become `RUANGRAPI PROBE` / `CV PROBE` / `FUXX PROBE`.
  - Titles stay "Read the … dossier".
- `src/components/layout/LogbookPanel.tsx:62-79`: a done dossier entry renders its title as a `<button>` with `aria-label="Re-open the <title> dossier"`. Clicking it calls `openProjectDossier(id, "logbook")`. The panel then closes itself through the existing auto-close (now on `selectModalOpen`).
- Test: `tests/logbook.test.ts`, `tests/logbookPanel.test.tsx` (new or extended)

- [ ] **Step 1: Write the failing tests.**
  - The hints match the copy above.
  - A done dossier renders a button; an undone one does not.
  - The click calls `openProjectDossier(id, "logbook")`.
  - `probeSpots` is unchanged after open and close from the logbook.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(probes): re-open read dossiers from the logbook"`.

---

### Task 10: Copy, docs and the patch note

**Files:**
- `src/data/chatterLines.ts:9,13`:
  - "FLY TOWARD THE GLOWING PLANETS" → "FOLLOW THE BLINKING PROBES".
  - "THE NUMBER KEYS JUMP TO EACH DOSSIER" → "THE NUMBER KEYS JUMP TO EACH PROBE".
- `src/data/projects.json:16`: "orbit-lock dossiers" → "probe dossiers you grab with a tractor beam".
- `index.html:18,35` (og/twitter descriptions): replace the planet-dossier wording.
- `README.md:3-4,24,28,32,48`: probes, not planets.
- `docs/UNIVERSE-RULES.md` L16: add "the project probes (station-keeping, RCS puffs shown)" to the list of things that hold still.
- `docs/PERF-BUDGETS.md`: the new load-program figure (if any) and the "modal open" state now meaning an open probe dossier.
- `src/data/changelog.ts`: a new first entry, `pr: 39`, dated 2026-10-20, id starting `2026-10-20`, title "Project Probes", with visitor-facing what/why/how within the limits.
- Test: `tests/changelog.test.ts` (existing)

- [ ] **Step 1: Make** the edits.
- [ ] **Step 2: Run** `npx vitest run tests/changelog.test.ts && npx vitest run`. Expected: PASS.
- [ ] **Step 3: Commit** with `git commit -m "docs(probes): copy, rules, budgets and patch note (pr 39)"`.

---

### Task 11: e2e — rewrite the dossier fixtures; add the probes probe

**Files:**
- `tests/e2e/harness.mjs`: add `grabProbe(page, id)`. It calls `requestJump(id)`, waits for the jump, holds `KeyF` until `store.getState().openDossier === id` (timeout 8 s), then releases F.
- Rewrite each fixture that used "Digit1-3 / approach a planet → `isOrbitLocked`" to `grabProbe`, keeping each assertion's intent:
  - `transition.probe.mjs`: 350-361; 375-445 (the "modal open" perf state = an open probe dossier); 450-511 (the classic-CV round trip while a dossier is open); 611-707.
  - `gameplay.probe.mjs:150-190,225-241`: the planet orbit-lock checks become "a slow approach to a planet doesn't stick, and the ship stops at the surface". Zone chatter now comes from `probeNear`.
  - `mechanics.probe.mjs:72-115`: the skim/dock pair becomes skim/solid. The beam-on calls stay ≤ 110.
  - `logbook.probe.mjs:14-24,65-72`: the probe opens; `LOGBOOK 1/11`; focus moves into the dialog. A logbook re-open button works.
  - `career.probe.mjs:57-82`: three grabs, then the "after all three dossiers" radio line.
  - `gamepad.probe.mjs:86-99`: d-pad up jumps to probe 1; LB grabs; B closes.
  - `programs.probe.mjs:61,91`: also tour the `probePos` spots. No stop may open a dossier.
  - `sky.probe.mjs:525-537`, `touch.probe.mjs:128-134`, `careerphone.probe.mjs:43-46`, `beacons.probe.mjs:92-114`, `fuel.probe.mjs:140`: re-point any planet jump to a probe or a destination, whichever the assertion needs.
- Create `tests/e2e/probes.probe.mjs`:
  1. Press `Digit1`. The ship parks within 30 u of probe 1, and the radar shows 3 probe blips.
  2. Hold F. `openDossier === "ruangrapi"`, the dialog is visible, and the canvas is frozen.
  3. Press Esc. Within `RELOCATE_S + 1` s, `probePos.ruangrapi` equals `spotPos(def, 1)` and the radio shows `PROBE RELOCATING`.
  4. Reload. `probePos.ruangrapi` is still `spotPos(def, 1)`, and `visitedDossiers` includes `ruangrapi`.
  5. Under reduced motion, a close relocates within one frame.
  6. In photo mode, holding F next to a probe opens nothing.
- Register the new probe in the e2e runner's probe list (the same place the other `*.probe.mjs` files are listed).

- [ ] **Step 1: Before running**, close Playwright tabs and stop any dev server on the harness port (5199), by PID.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all green. If a probe fails only under load, re-run it alone and record both runs.
- [ ] **Step 3: Commit** with `git commit -m "test(probes): e2e grab, relocation and fixtures"`.

---

### Task 12: Real-Chrome check, review, PR

- [ ] **Step 1: In real Chrome** (Playwright MCP, `npm run dev`), take screenshots into the scratchpad:
  - spawn with probe 1 ahead;
  - the beam tether on a probe;
  - the open dossier;
  - the relocation burn;
  - the radar with three probes;
  - each planet's scan card, with its unchanged look next to a `main` screenshot.

  Show them to the owner.
- [ ] **Step 2: Whole-branch review.** Use a fresh reviewer on the most capable model, given this plan and the spec. Fix what it confirms.
- [ ] **Step 3: Push and open the PR.** Push as `fitzfitz` (`GH_TOKEN="$(gh auth token --user fitzfitz)"`). Open PR #39 with a body that lists the verification numbers. Check the Cloudflare preview build passes.
- [ ] **Step 4: Ask the owner before merging.** Merging deploys to Pages and Cloudflare.
