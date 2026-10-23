# The jellyfish guide (design)

**Date:** 2026-10-23. **Status:** approved by the owner, not built.
**Plan:** `docs/superpowers/plans/2026-10-23-jellyfish-guide.md`.

## Why

The space jellyfish is one of the best-made things in the scene and has no
job. It swims a fixed loop above the inner planets with three moods (calm,
curious when you approach slowly, startled when you boost at it), and J
fast-forwards its loop to the spawn pad. Nothing in the game uses it.

It becomes a **living guide**. It leads a visitor to what they have not seen
yet, which is the portfolio's real job (getting a recruiter in a hurry to the
projects, the career and the contact form), and it can grow into a companion
for the game stages later (fuel while following it, friendship).

## Decisions (owner, 2026-10-23)

| Question | Decision |
|---|---|
| Role | Guide (over: befriendable creature, keeper of the gate, fuel source) |
| Size | **~4 u tall, ~1.6× the ship** (was ~30 u, 12× the ship) |
| When it guides | **On call (J) and when lost**; otherwise it roams freely |
| What it leads to | **The logbook's NEXT step** (`nextGoal`), the same source as the HUD |
| How it leads | **Swims ahead at your pace**, warp included |
| Auto-offer | **After 45 s with no progress** |
| Posture | **Swims bell first, tentacles trailing; upright when stopped** |

## Behaviour

### Size
Group scale 6 → ~0.8 (the model is 1.94 × 4.92 × 1.96; ~3.9 u tall in game).
Its look (glow, bell colours, rings, tentacle sway) is unchanged, only smaller.
Everything sized to the old creature is re-derived: the keep-out bodies in
`jellyMood.ts` (planet plus creature radius), the culling bound pad, the
loop's clearance tests (`tests/jellyfishPath.test.ts`) and the reactions
probe's distances.

### Roaming (not guiding)
As today: the loop above the inner planets and the calm, curious and
startled moods. It swims bell first along the loop (see posture).

### Calling it
- **J** (keyboard), the gamepad button J already maps to, and a small touch
  button: toggle. Called, it streaks to the ship (~2 s, glow trail), pulses,
  and the radio says one line from a new `guide` pool, e.g. *"Your guide is
  here: follow the glow."* Pressed again: it is sent back to roaming.
- J no longer fast-forwards the loop to the spawn pad.

### Offering itself ("when lost")
- After **45 s with no progress**: no newly opened dossier, no newly reached
  destination, no newly charted world, no logbook entry earned.
- Never while docked or orbit-locked, in a dossier, racing, in photo mode, in
  the classic résumé, or while another broadcast holds the radio.
- At most once every few minutes (cooldown; a constant in the guide module).
  If the pilot flies away from the offer, it goes back to roaming.

### Leading
- **Target:** the world position of the logbook's NEXT step: the three probe
  dossiers, then the career station, then contact, then uncharted worlds
  (CARTOGRAPHER). Everything done: it roams. Use one source of truth with the
  HUD's NEXT line and target lock (`nextGoal`, `utils/navigation.ts`).
- **Station:** ~20 u ahead of the ship along the route to the target,
  matching the ship's speed, warp included (glow streak while warping).
- **Waiting:** if the pilot falls behind or turns away, it slows and turns
  back toward the ship until the pilot follows again.
- While guiding, boosting does not startle it, and it keeps clear of every
  solid (planets, moons, stations), as the keep-out law does today.

### Arriving
It circles the target once, pulses, and the HUD's target locks on. Then it
returns to roaming, or leads to the next step if called again.

### Swim posture
- **Stopped or slow:** upright, bell up, tentacles hanging (today's look).
- **Swimming:** the bell (model +y) points along the travel direction and the
  tentacles trail behind, as real jellyfish swim bell first.
- **Blend:** the tilt follows speed: upright below a slow drift, leaning
  smoothly into the swim posture as speed rises, easing back upright over
  ~1 s as it slows. Turns bank gently; the rotation is damped so it never
  flips or jitters on a direction change.
- **Tentacles:** streaming straight back with a ripple travelling down them
  while swimming; drifting and curling while standing (the shader's existing
  sway, weighted by a new swim factor).
- **Bell pulse:** faster and stronger with speed (propulsion); the glow streak
  lengthens during warp.
- Applies everywhere: roaming the loop it swims bell first; curious and
  holding near the ship, it stands.

### Reduced motion
It still guides. No bob, no surge, no streak: it appears beside the ship
instead of swimming in. Posture still follows its heading (so it reads
right), without the tentacle ripple and with a slow pulse only.

## Budgets
No new shader program beyond the creature's own material changing in place
(`programs.probe.mjs` must still add 0 on the tour). Draw calls unchanged.
GPU memory ledger unchanged. The frame loop stays allocation-free (the memory
probe's ≤ 160 KB a frame of JS).

## Out of scope
- A logbook badge for following it, and fuel or friendship: later, with the
  game stages.
- Its name on the radio beyond "your guide" (copy can change in review).

## Build rulings (2026-10-23)

Decisions taken while building, where the plan or this spec was silent, or
wrong about the code. Code comments cite them as "spec, build ruling Rn".

- **R1, the target.** The guide leads where the HUD waypoint points (one shared
  helper, `utils/waypointTarget.ts`): the nearest unread probe, then the career
  station, then contact. Once those are done, the nearest uncharted world
  (CARTOGRAPHER). Badge goals (a slingshot, a comet) are activities, not
  places, so they are skipped. Nothing left: no target, and it roams.
- **R2, no gamepad button.** No gamepad button maps to J (the spec assumed one),
  and none was invented. Listed in `docs/FOLLOW-UPS.md`.
- **R3, posture thresholds.** Upright below 0.6 u/s, fully bell first above
  vSwim; half-lives 0.3 s into a swim or a turn, 1 s back upright. The loop
  averages 2.96 u/s, under the plan's 3 u/s, so vSwim is 0.8 of it (2.37 u/s)
  and roaming reads as swimming.
- **R4, merging.** The work stops at a pushed PR (#54). Merging deploys to
  production, so it waits for the owner.
- **R5, one keep-out law.** The guide clears solids with the moods' own
  keep-out helper (`pushOutOfSolids` in `utils/jellyMood.ts`), shared, not copied.
- **R6, debug bridge.** `fitzDebug.jellyGuide` shows the state, position,
  velocity, body up (+y in world space) and swim factor, for the e2e probe.
- **R7, the streak in.** About 2 s (this spec); the e2e probe allows up to 3 s
  to come within ~25 u of the ship.
- **R8, the old J follow-up.** The follow-up asking for J to summon the
  jellyfish is done by this work and was removed.
- **R9, no target-lock action.** No store action locks the HUD's target, so
  arriving adds none; arrival uses the radius at which the HUD's own target
  line locks on. Listed in `docs/FOLLOW-UPS.md`.
- **R10, pulse rate on the CPU.** No `uPulseRate` uniform: the faster beat goes
  into the CPU-integrated pulse clock, because a uniform multiplying `uTime`
  would jump the phase whenever the rate changes.
- **R11, reduced motion.** Only the bell moves, slowly: no surge, and the
  tentacle sway and ripple stay frozen, as before.
- **R12, a full logbook.** The target goes null only when no uncharted world is
  left. The logbook has no charting entry, so a full logbook still leads to
  worlds while any remain.
- **R13, allocation.** A per-frame allocation in the target lookup counts as
  Important, not Minor: frame loops allocate nothing, and the memory probe's
  ceiling is already tight.
- **R14, review before the PR.** The final whole-branch review and its fixes
  land before the last verification and the PR, so that verification covers them.
- **Final review, near targets.** The career station is reached 8.5 u out and
  the portal 2.2 u out, both inside the 20 u lead. Within 20 u plus the
  presenting radius of its target, the guide's station swings round onto the
  presenting circle, beside the approach line, and it never comes nearer the
  target than that radius: 16.7 u, the widest docking orbit (10) plus the
  ship's half length and the creature's reach, so it clears a docked ship.
