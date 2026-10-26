# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

- **Ring race, left for later** (spec 2026-10-26-ring-race-design, PR #66):
  - Prizes: a finish could pay data shards. That belongs to the coins stage,
    so the race pays only the Ring runner badge and the best time for now.
  - One public lobby: the Sky room keeps a single public lobby open at a
    time, so a ninth pilot is told the race is full instead of a second lobby
    opening (`beacon-api/src/raceRoom.ts` join). More than one can wait for
    real traffic.
  - The e2e race is one page against a scripted fake room
    (`tests/e2e/race.probe.mjs`), not the two-page race the spec names: the
    harness has no real Worker. Two racers run end to end through the room's
    logic in a unit test (beacon-api), and the adapter's pieces are tested,
    but a bug in the socket wiring between `beacon-api/src/index.ts` and the
    room shows only on staging. Fly a two-tab race on staging before a release.
  - The start grid's eight slots (up to 38 u behind the start gate, ruling R6
    moved the gate 17 u up for them) are not in `tests/helpers/solarClearance`'s
    landmarks, so no test keeps the grid clear of the swept orbits. Add them
    with the gate's radius plus the grid's spread.
  - `raceLiveSkyRestore` (the race turned live sky on, so idle turns it off
    again) lives in memory only: a reload mid-race leaves live sky on for good.
    Persist it with the run, or clear live sky on a run-less load.
  - Safari: INVITE FRIENDS copies the link when the private lobby's code comes
    back from the room, after the click, so Safari's clipboard (gesture-bound)
    refuses and the card shows the link to copy by hand. Copy a link built
    before the reply, or ask the room for the code first.
  - L3 leaves the lobby: the pad's race button also leaves, and a stray stick
    click while waiting drops the pilot out. Leave on a held L3, or only from
    the LEAVE button.
  - Locked out after a network switch: after Wi-Fi to cellular the old socket
    stays open at the edge, so the rejoin by token gets `rerr busy`
    (`beacon-api/src/raceRoom.ts:253`). Claims are refused, `rover` goes to the
    dead socket, and the racer is stuck until the R17 failsafe frees them.
    Treat a bound pilot with no pose for ~5 s mid-race as gone, let the token
    rebind to the newest socket, or have the client retry `rjoin` while `busy`
    (`src/utils/raceSession.ts:71`).
  - Lost stamp: a socket drop after the room signs ring i but before `rstamp`
    arrives leaves the client claiming ring i for ever (refused, as the room's
    `next` is i+1). On a running rebind, `resend` (`raceRoom.ts:124`) can
    re-sign and resend the last stamp (`i = next − 1`, `at = lastAt`); it is
    deterministic, so no new state.
  - Unbeatable best lap: the room signs rings against the pilot's own reported
    pose, and the speed rule allows `SPEED_SLACK_S` per leg
    (`src/utils/raceProtocol.ts:245`), so a scripted client can bank about 37 s
    against about 45 s for an honest pilot at warp. The `race_best` row is
    permanent. Add a whole-lap floor in `checkLap` (Σ leg / `RACE_SPEED` minus
    one small total slack) or shrink the per-leg slack. Until then the owner
    can reset it in the D1 console: `DELETE FROM race_best WHERE course =
    'loop-2'`. Also make `checkPath`'s comparisons NaN-safe and note that it
    assumes `checkLap` ran.
  - Room and Durable Object hardening (`beacon-api/src/index.ts`,
    `raceRoom.ts`, `raceHttp.ts`): persist in a `finally` and re-arm the
    alarm on load; catch a `forwardResult` rejection and answer 503 with CORS
    instead of a CORS-less 500; let `UploadResult` carry the parsed stamps and
    ghost so `bestCandidate` doesn't re-parse; check a chunked upload's size
    while reading, not after buffering it (as `/beacons` also does); export
    one `HEX32` instead of three (`raceRoom.ts`, `raceProtocol.ts`,
    `raceSession.ts`). Under R4 one socket blip can end the race at once for a
    trailing racer when everyone still bound has finished (`leaveRaces` →
    `maybeEnd`); they rejoin into the upload window with a DNF.
  - Client race flow (`src/utils/raceController.ts`, `raceJoin.ts`): treat a
    409 `duplicate` on the upload retry as ok, so `RESULT_LOST_LINE` doesn't
    play when the first upload landed; remove an expired `fitz-race-run` in
    `readRun` (the spec says it clears on the next visit); `watchRaceOver`
    calls with `void`, so catch its rejection; reset `inviteCopyWanted` on
    `rerr`; give the token rejoin a reply timeout; exit photo mode in the
    `rgrid` handler, since photo mode during the grid skips placement and the
    hold (`Spaceship.tsx:423` returns before the grid block); a late `?race=`
    link should start at the spawn pad, not on the grid.
  - Scene and HUD polish: the waypoint counts `RING x/9` then FINISH
    (`WaypointDriver.tsx:61`) while the HUD counts `RING x/10`
    (`RaceHUD.tsx:95`), so pick one; the controls card shows `RACE R` with no
    live-sky server (`HUDOverlay.tsx`; `raceKey` ignores `liveSkyUrl()` too)
    and reads RACE over R, not the plan's "R · RACE"; hide the controls card
    while a race card is up. Perf: `RaceCourse.tsx:224` builds a template-string
    key every frame even for idle visitors (compare the fields instead);
    `crossesGate` (`src/utils/race.ts`) and `ringToClaim`
    (`src/utils/raceScene.ts`) allocate while running; the near-gate rAF loop
    runs for the whole idle session; the grid hold in `Spaceship.tsx`
    duplicates the photo-mode and orbit freeze bodies.
  - Test and e2e hygiene: the ring-miss test bump depends on `RING_RADIUS`, and
    the grid-start test doesn't tell the `i === 0` skip apart; the "9 to 11
    rings" title, the redundant 20 u spacing test, `gridSlot` silently wrapping
    slots ≥ 8 and the seed lap's stretched last tick; add `rjoin {token}` for a
    done race and rule 1 for `rstart`, `rsolo` and `ragain`; the isolate's
    `best` cache keeps the first `env.DB` (test-only); the deep-link pose test
    lives in `raceHud.test`, not the flightGate test. In e2e,
    `race.probe.mjs`'s jumps check has no positive control, its
    cleanup is skipped on a throw, and the INVITE check forces `data-quiet`.
  - Docs: `beacon-api/README.md` deploys D1, then the secret, then the Worker;
    the stated order is secret, D1, Worker, site. Both are safe (it says steps
    2 and 3 may swap); mention it in the deploy request.

- **Space monsters** (the combat stage, PR 67, put the saucer and the
  tardigrade in the game):
  - Done: the glbs moved from `public/models-lab/` to `public/models-ondemand/`,
    loose files outside the asset packs that the Nest's load gate fetches only
    within 200 u of the Nest (the packs are startup downloads by design); the
    e2e affected mapping runs the combat probe and the budgets for monster
    changes, and `tests/labBoot.test.ts` keeps the game from importing
    `src/lab`; the saucer body's vertex attributes were left alone (no
    attribute added, 15 of 16 WebGL2 slots still used: free one by packing the
    band as a paint index before adding any).
  - Still open: no test ties the GLSL to the TypeScript mirrors (the per-shell
    pose is re-packed per shell: pack once, copy); normals are not corrected
    under the tardigrade's anisotropic hit/recoil scale, or for the goo;
    `tests/monsterGeometry.test.ts`'s bounds sweeps use 30 s timeouts (watch
    the first CI run on ubuntu; raise to 60-90 s if needed).
  - The on-demand glbs are unhashed, and the service worker serves same-origin
    files cache-first: after a model update, a returning visitor gets the old
    model for one visit (the new one is fetched behind it). Hash the names or
    give the folder a network-first rule if that ever matters.
  - Look polish: the owner closed it at "realistic at normal viewing". Do not
    reopen close-up look work.

- **Combat, for the coins stage** (the Nest, PR 67; spec
  `docs/superpowers/specs/2026-10-27-combat-design.md`):
  - Shards as money, rewards on clearing the Nest, and the hull as an upgrade
    slot (with shields) are the next stage's; the Nest gives only the badge
    and the CRIMSON plume today.
  - Release order: the `nest` plume fails the deployed beacon Worker's plume
    check until it is redeployed, so live-sky poses from pilots wearing
    CRIMSON are dropped. Redeploy `beacon-api` (`--config
    beacon-api/wrangler.toml`) before the site release.
  - Small leftovers from the build reviews: the hull regen applies a whole
    frame's regen at the 4 s mark; the bolt's 160 u range and the 12° assist
    cone's exact boundaries are untested; the hot loops use `Math.hypot`;
    `monsterMatrix` can flip its up axis when a monster faces near-vertically;
    `debugStartWave` does not clear the debug formation's freeze and repeats
    `endFight`'s leave loops; a redundant `as MonsterBody` in `nest.ts`; the
    out timer is not reset when the Nest is cleared; the placement test copies
    the programs tour's stop literals (they can drift; read them from the probe
    or pin them) and its names test is tautological; `labBoot.test.ts`'s
    import scan has regex edge cases; the hull label reads 100% while the hull
    regens from 99.5 to 99.99; a stalled (not failed) model fetch keeps
    showing `CONTACT IN …` (harmless: no wave starts).

- **Layout constants stay built at module load** (deferred from the store
  split, PR 62; spec docs/archive/specs/2026-10-26-store-split-design.md):
  `PROBES`, `BUOYS`, `LOGBOOK`, `JUMP_TARGETS` and the store's initial
  dossier/probe/plume state are still computed from the content when their
  modules load. The boot gate (PR 59) settles the content before any of them
  load, so they are correct today. Revisit only if content must change
  mid-visit; combat spawns are runtime state and do not need it.

- **Memory, past PR 53** (docs/archive/specs/2026-10-22-memory-budget-design.md;
  Chrome's memory-infra dump, 2026-10-23, at 1512×802@2):
  - ~550 MB of the GPU process is Chrome's own for any WebGL page here (a blank
    WebGL2 canvas: ANGLE/Metal 252 MB, shared images 304 MB). ANGLE holds what
    the page allocates plus ~255 MB more, internal and not reachable from the
    page. An opaque canvas (`alpha: false`) changed nothing.
  - Done: the HTML overlays were five full-window layers over the canvas (PRs
    51, 52: ~80 MB of the GPU process); the HUD rewrote unchanged text every
    frame, growing Blink's heap ~2.6 MB/s at rest (PR 53, now ~0.3 MB/s).
  - The model textures are still WebP: ~196 MB uncompressed on the GPU.
    Colour as ETC1S and normal/roughness as UASTC measured −136 MB for +9 MB
    of download; the owner deferred it (2026-10-23) to keep the hero ship sharp
    and the first load fast. GlobalCanvas's pack-entry `useGLTF.preload` runs
    before a renderer exists, which KTX2Loader.detectSupport needs: queue it.
  - What is left of Blink's growth (~0.3 MB/s at rest) is the radio's
    typewriter and other text that really changes.

- **New Worlds C1 minors, left for later** (each noticed in review, none
  wrong on screen; the items about `worlds.ts`, `SpaceWorlds.tsx`,
  `worldMaps.test.ts`, the w-rock and w-dwarf maps and the assetContracts cap
  comment went with the fictional worlds in PR #40):
  - The turntable script (`turntable_bodies.py`) restates the exposure
    (every body lit as at 1 AU under a uniform 0.15 / PI fill) instead of
    calling `targetExposure`, and loads the TypeScript through jiti, which is
    only a transitive dependency (Node 22's type stripping cannot load `src/`:
    its imports are extensionless). Calling the game's functions needs each
    body's distance, and would change the inner planets' renders: inside
    1 AU the game's fill is AMBIENT_BASE × exposure (Venus ×0.52, Mercury
    ×0.15), not the full 0.15. The owner's colour decision came back
    2026-10-21 (the hue-keeping toe, `hueToe.ts`, and `EXPOSURE_LIFT` 1.5):
    the script applies neither, so its renders now sit ~0.58 stop under the
    game, and its Khronos curve keeps the olive toe.
  - Tests: `fillLight.test.ts`, `starLayer.test.ts` and `ringOptics.test.ts`
    pin wiring and GLSL by source regex rather than behaviour. Not a quick
    swap: vitest has no WebGL to run a shader and no R3F renderer to mount
    the JSX, so behaviour tests would be e2e (the sky probe already reads the
    fill, the star shells and the ring budgets in a browser). The
    codec-fidelity guard skips in CI (no `assets-src`).
- **The real star catalogue.** The background is still the painted Milky Way
  and three random star shells (L24). An astronomy fan who flies to Earth
  expects the real sky: the constellations from a catalogue (e.g. Hipparcos
  or Yale BSC, brightest few thousand), Polaris within a degree of Earth's
  IAU north pole, the Milky Way band along the real galactic plane, and
  every pole in the scene pointing where the real sky says (the poles are
  already IAU, `bodySpin.ts`). A non-goal of the real-solar-system PR (#40,
  spec §2), named there as the natural next step. Keep it inside the
  program and draw-call budgets (one Points per magnitude band).
- **The sun slingshot is a knife-edge.** With the Sun's well cut to 34 u
  (inside Mercury's perihelion, PR #40) and G 3,500, a sun skim leaves above
  SLINGSHOT_SPEED only for impact parameters b ≈ 29.5–30.5 u; the tests fly
  a single b (30). Since 2026-10-21 the Sun's well is watched like a
  planet's (`wellAt` over every active well), so that skim earns the whoosh,
  the radio line and the badge (tests/gravityWell.test.ts), but the window is
  still hard to find by hand. Revisit with F2 (Newtonian ship gravity), which
  replaces the well law; do not retune G alone, since 4,000 already brings a
  surface touch.
- **Jellyfish guide, left for later** (spec
  docs/archive/specs/2026-10-23-jellyfish-guide-design.md, PR #54):
  - No gamepad button calls the guide (build ruling R2). The spec assumed J
    already had one; nothing maps to it in `utils/gamepad.ts`, and inventing
    one risked clashing with the layout: every face, shoulder and d-pad
    button is taken; only the stick clicks (buttons 10 and 11) are free. Pick
    one with the owner and have it call `requestGuideToggle()`, as the touch
    GUIDE button does.
  - Arriving does not lock the HUD's target (build ruling R9). The spec says
    "the HUD's target locks on", but no store action locks a target; the
    guide only arrives at the radius where the HUD's own target line locks
    on. Wants a lock flourish action the guide can call on `arrived`.
  - The memory probe's idle allocation ceiling (`ALLOC_KB_PER_FRAME`, 160 KB
    a frame in `tests/e2e/memory.probe.mjs`) is flaky at baseline: about 2
    runs in 6 over, median ~142 KB, measured while building the guide and
    not caused by it. Find the remaining per-frame garbage or re-measure the
    ceiling on a quiet machine.
  - The guide's lean toward the target (`GUIDE_LEAD_MAX_ANGLE`, added after
    #54) is 20°, the largest that keeps it on a landscape screen in every
    direction. A lean straight up from a hovering ship sits 26.9° above the
    view axis, inside the 29° vertical half-fov; the derivation is in the
    constant's comment. That is an accepted limitation: on a portrait phone
    the horizontal half-fov is only ~14°, so a sideways lean (~16° off the
    axis) is still off screen. Within ~37 u of its target (20 u plus the
    16.7 u presenting radius) the station is beside the target, wherever the
    nose points, so a reduced-motion call made there can still appear out
    of view.
  - The keep-out list holds the planets only (SolarBodies). The guide keeps
    its own target's radius clear (the station or portal it leads to), but
    not a station it only passes (the shipyard, or the career station on the
    way to a probe), nor the moons. Add the destinations (career station
    5.2 u, shipyard 4.8 u, portal frame 7.0 u from their centres) and the
    moons (moving, like the planets) to the list.
- **SwiftShader start-up rose with the real Solar System.** The start-up
  probe's best of three read 13.0 s and 15.4 s in two full runs on PR #40's
  branch, against 10.1–12.1 s for New Worlds: inside the 20 s ceiling, not
  bisected. Suspects: the NASA maps' texture uploads and the nine moons'
  materials at warm-up. Bisect over the branch's commits (`startup.probe.mjs`
  alone, best of three each) before the ceiling is next touched. Tried
  2026-10-21 and abandoned: the machine sat at load 21–46 from other
  processes, and main (6513572) itself read 12–51 s a load, so bisect on a
  quiet machine.

