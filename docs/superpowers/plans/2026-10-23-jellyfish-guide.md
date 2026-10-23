# The jellyfish guide: implementation plan

**Spec:** `docs/superpowers/specs/2026-10-23-jellyfish-guide-design.md` (approved 2026-10-23).
**Branch:** `feat/jellyfish-guide`, one PR. The next free PR number is **#54**
(check `gh api repos/fitzfitz/3d-portfolio/issues?state=all&per_page=1`).

## Ground rules for this repo (from memory and past PRs)
- Push as fitzfitz (`GH_TOKEN="$(gh auth token --user fitzfitz)"`, credential
  helper override); merging deploys to Pages and Cloudflare.
- Before merging: `npm run build` (its `tsc -b` checks tests too), `npx vitest
  run`, `npm run test:e2e` (all must pass), and a changelog entry for the PR
  number (`tests/changelog.test.ts`: no gaps, field limits 220/220/240).
- Never edit `src/` or `tests/e2e/` while the e2e suite runs (the dev server
  hot-reloads into running probes).
- Subagents must not install packages or kill processes by name.
- Frame loops allocate nothing (module-scope scratch objects); DOM writes from
  rAF go through `setText`/`setStyle` (`src/utils/domWrite.ts`).
- Comments match the repo's style: say why, cite the spec or the measurement.

## Code today
- `src/components/canvas/SpaceJellyfish.tsx`: the creature. Group
  `name="SpaceJellyfish"` at `scale={6}` (~line 250); a custom
  `ShaderMaterial` with `uTime`, the bell pulse (`pulseCycle`) and tentacle
  sway (vertex shader ~lines 44–56, masks on authored `position.y`; bell is
  +y, tentacles −y); the J listener (~line 176) fast-forwards the loop to
  `JELLY_NEAR_T`; `useFrame` moves it along `src/data/jellyfishPath.ts` and
  applies `stepJelly` (`src/utils/jellyMood.ts`, moods and keep-outs).
- `src/utils/logbook.ts` `nextGoal(progress)`: the first unfinished entry
  (essentials first). `src/utils/navigation.ts` `nextWaypoint(...)`: check
  whether it already maps the next goal to a world position for the HUD
  target; reuse it rather than re-deriving.
- Positions: probes `src/store/probeState.ts` (`probePos`), destinations
  `src/data/destinations.ts`, bodies `bodies` in `src/store/spaceStore.ts`.
- Radio: pools in `src/data/chatterLines.ts`, `sendBroadcast` in the store.
- Debug bridge: `fitzDebug.jelly` (mood/offset) in `src/debug/bridge.ts`.
- Tests touching it: `tests/jellyMood.test.ts`, `tests/jellyfishPath.test.ts`,
  `tests/e2e/reactions.probe.mjs` (presses KeyJ from the pad, checks curious
  then startled), `docs/QA-CHECKLIST.md` (J = summon).

## Tasks (test first where the logic is pure)

### 1. Size
- `scale={6}` → a named constant (~0.8; ~3.9 u tall), in `SpaceJellyfish.tsx`
  or `constants.ts`, with a comment (spec: 1.6× the ship).
- Re-derive what depended on the old size: the keep-out `body` radius in
  `jellyMood.ts` inputs, the bounding-sphere pad, `jellyfishPath.test.ts`
  clearances (keep them honest), the reactions probe's distance thresholds.
- Check: `npx vitest run tests/jellyMood.test.ts tests/jellyfishPath.test.ts`.

### 2. Swim posture: `src/utils/jellyPosture.ts` (pure, unit-tested)
- `stepPosture(state, velocity, dt, out)`: from the creature's velocity,
  target orientation = rotate model +y onto the travel direction; blend weight
  `smoothstep(vSlow, vSwim, speed)` between upright and that; damped slerp
  (half-life ~0.3 s turning, ~1 s back to upright); bank toward the turn;
  continuity guard against flips (keep the previous up hemisphere when the
  direction reverses). Outputs the quaternion and a 0..1 `swim` factor.
- `tests/jellyPosture.test.ts`: upright at rest (body +y · world up > 0.99);
  bell along velocity at speed (> 0.95); monotonic easing back upright; no
  flip on a 180° reversal (bounded angular step per frame); allocation-free.
- Wire into `SpaceJellyfish.tsx`: velocity from the frame-to-frame position
  delta (smoothed), group quaternion from `stepPosture`.

### 3. Shader: swimming tentacles and pulse
- New uniforms `uSwim` (0..1) and `uPulseRate`. With `uSwim`, tentacle
  displacement streams back along −y (stretch, less lateral curl) with a
  ripple travelling down; the bell pulse speeds up and deepens with speed.
  `uSwim` 0 must reproduce today's shader exactly.
- Reduced motion: no ripple, slow pulse only.
- Check: `node tests/e2e/run-one.mjs programs` (adds no program).

### 4. The guide: `src/utils/jellyGuide.ts` (pure state machine, unit-tested)
- States: `roaming` → `coming` (to the ship) → `leading` (to the target) →
  `presenting` (circle once) → `roaming`; J while active → back to roaming.
- Inputs per frame: ship position, velocity and warp state; target (world
  position or null); a progress signature (to detect progress); blockers
  (docked, dossier, race, photo mode, classic CV, radio busy); reduced motion; dt.
- Lost timer: 45 s without the progress signature changing and no blocker
  → offer (enter `coming`); cooldown between offers; flying away from an
  offer returns it to roaming.
- Leading: a station point ~20 u ahead of the ship along the ship→target
  route; speed matched to the ship (warp included); waits (slows, turns back)
  when the ship falls behind or heads away; never startled while leading;
  keep-outs still apply.
- Arrival: within the target's dock/scan radius → `presenting` (one circle),
  then `roaming`.
- `tests/jellyGuide.test.ts`: J toggles; offer after 45 s with no progress,
  never under a blocker, not again inside the cooldown; leads toward the
  target ~20 u ahead; waits when the ship turns away; arrives and presents;
  target null (all done) → roams; reduced motion → appears beside the ship.

### 5. Wire it up
- `SpaceJellyfish.tsx`: run the guide each frame; while not roaming its
  position comes from the guide; when it returns it resumes the loop from the
  nearest loop phase (no teleport back). Moods only while roaming.
- J: replace the loop fast-forward with the guide toggle (keep
  `isEditableTarget`); keep the gamepad mapping J has; add a touch button in
  `TouchControls` (same style as BEAM).
- Target: `nextGoal` → world position via the existing navigation helper.
- Radio: a `guide` pool in `chatterLines.ts` (called, offering, arrived, all
  done), through `sendBroadcast`, respecting the busy radio.
- Glow streak during warp: allocation-free (reuse `EngineWake`'s geometry
  pattern if it is a ribbon).
- Debug bridge: expose the guide state for e2e (`fitzDebug.jellyGuide`).

### 6. Tests and docs
- Update `tests/e2e/reactions.probe.mjs` for the new J (curious and startled
  still checked while it roams near the ship, e.g. by teleporting near its loop).
- New e2e: J brings it within ~25 u in ≤ 3 s; with a dossier unread it leads
  (moves toward the target, ahead of the ship); posture: swimming body +y ·
  velocity > 0.8, standing body +y · up > 0.95; reduced motion appears beside
  the ship. Register the probe in `tests/e2e/probeList.mjs`, `COST` in
  `run.mjs`, and a rule in `tests/e2e/affected.mjs`.
- `docs/QA-CHECKLIST.md`: J = call or dismiss the guide.
- Changelog entry for #54 (visitor-facing: what / why / how).

### 7. Verify, then PR
- Screenshots for the owner: swimming ahead (posture), standing, arriving at
  a probe; before/after size.
- `npm run build`, `npx vitest run`, `npm run test:e2e` all green; memory and
  programs probes unchanged.
- PR #54 with the numbers; merge when green (merging deploys).
