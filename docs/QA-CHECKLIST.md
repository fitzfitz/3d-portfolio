# Human QA checklist — the 9 feel checks the e2e suite cannot judge

Tasks 1–10 built a dev-only debug bridge, an e2e harness, and eight automated
probes (90 checks) that closed roughly thirty acceptance items which had gone
unverified for months. Nine items remain that a machine genuinely cannot
judge — they are about *feel* ("does banking read as banking", "is the audio
mix balanced"), not about a measurable store value. This document is the
checklist a human runs to close those nine.

**Every check below is set up in seconds using the Setup section's snippets
and the exact keystrokes given** — you should never need to grind two minutes
of normal flight to reach a scenario.

---

## Setup

### `window.__fitz` exists only in dev

`window.__fitz` is assigned in `src/main.tsx` under an `import.meta.env.DEV`
guard. It exists when the app is served by `npm run dev`. It does **not**
exist in a production build (`npm run build` / `npm run preview`) — the
string `__fitz` is dead-code-eliminated. If you paste any snippet below into
a built/deployed page and get `__fitz is not defined`, that is expected: go
run `npm run dev` instead.

```bash
npm run dev
# open the printed localhost URL, then open the browser devtools console
```

### What `__fitz` exposes

| Property | What it is |
| --- | --- |
| `__fitz.store` | The zustand store itself — call `__fitz.store.getState()` to read current state, or `.getState().someAction(...)` to call an action. |
| `__fitz.flight` | Read-only per-frame telemetry: `x`, `y`, `z`, `speed`, `heading`, `pitch`, `input`. Written every frame by `Spaceship.tsx` — do not assign to it (see the teleport warning below). |
| `__fitz.bodies` | Live world positions of the orbiting planets, keyed by name (`saas`, `video`, `agent`), updated every frame. |
| `__fitz.sound` | The sound manager instance. |
| `__fitz.scene` | The live `THREE.Scene`, for `.getObjectByName(...)` lookups. |
| `__fitz.gl` | The `THREE.WebGLRenderer`. |
| `__fitz.renderCount` | Count of React commits, incremented by a dev-only `<Profiler>` in `main.tsx`. |
| `__fitz.teleport(x, y, z)` | The **only** way to move the ship from the console (see below). |

### The teleport trap — read this before using any snippet below

**`__fitz.teleport(x, y, z)` is the only way to move the ship. Assigning
`__fitz.flight.x = 80` does absolutely nothing.** `Spaceship.tsx` holds the
ship's authoritative position in a `useRef` and copies it *into* `flight`
every frame (chase-cam, orbit-lock, and normal-flight branches all do this)
— nothing ever reads `flight.x` back into the ship's position. An earlier
draft of this checklist shipped `__fitz.flight.x = 80` as its headline
"teleport" snippet; it silently did nothing. Always use `__fitz.teleport(...)`.

```js
// Teleport (skip the two-minute flight to anywhere).
// NOTE: it must be __fitz.teleport(...) — assigning __fitz.flight.x does NOTHING,
// because flight is write-only telemetry copied FROM the ship's internal
// position every frame, never read back into it.
__fitz.teleport(80, -28, 75)
```

Teleporting zeroes velocity but not heading/pitch — if you were mid-turn
before teleporting, straighten out with `A`/`D` once you land.

### Other fast-path snippets

```js
// Pre-seed 9 of 10 shards, then reload, to test the collect-all fanfare on
// the 10th pickup instead of hunting down all ten from scratch.
localStorage.setItem("fitz-shards", JSON.stringify([0,1,2,3,4,5,6,7,8]))

// Force low-perf mode. The second argument marks the change as manual, which
// also stops the automatic FPS monitor from fighting you and flipping it back.
__fitz.store.getState().setLowPerf(true, true)

// Undo it
__fitz.store.getState().setLowPerf(false, true)

// Summon the space jellyfish nearby (no console needed — just press the key)
// press J

// Watch React commits while you fly — should NOT move during steady,
// hands-off flight. It printing a stable number, unmoving second to second,
// is the whole point of the "zero renders during flight" performance work.
setInterval(() => console.log(__fitz.renderCount), 1000)

// Unmute from the console instead of hunting for the HUD button
__fitz.store.getState().setMuted(false)

// Get a planet's live position (orbits move every frame — there's no fixed
// coordinate to hardcode). Names are "saas", "video", "agent".
__fitz.bodies.saas
```

### Controls reference

| Key | Action |
| --- | --- |
| `W` / `A` / `S` / `D` or arrow keys | Forward / turn left / brake-back / turn right |
| `Shift` | Boost (warp speed) |
| `Space` | Pitch up |
| `C` or `X` | Pitch down |
| `E` (hold) | Scan a nearby scannable target |
| `P` | Photo mode |
| `J` | Summon the space jellyfish |

Touch controls (joystick, pitch up/down, `SCAN`, `BOOST`) only render when
the browser reports `(pointer: coarse)` — they will **not** appear at all on
a desktop browser, including devtools' device-emulation mode in some
configurations. This matters for check 8, the real-device check: it cannot
be faked from a desktop console session.

### Asset backup note

`assets-src/MANIFEST.md` (gitignored, local-only) lists five external assets
with unknown provenance/licence that cannot be regenerated by any script in
this repo (`portal_gateway.glb`, `space_crystal.glb`, `earth.jpg`,
`mars.jpg`, `jupiter.jpg`) plus the spaceship base mesh. Whoever sets up an
off-machine backup of `assets-src/` should read that manifest first — it is
this project's only record of what would be unrecoverable if the local
directory were lost.

---

## The 9 checks

### 1. Ship banking feel on curves

**Setup:** none needed — default spawn is fine.

**Do:** Hold `D` through a long turn at cruise speed. Then repeat holding
`Shift`+`D` (boost) through another long turn.

**Look for:** Does the ship visibly roll into the turn — nose banking over
like an aircraft — rather than the ship staying level and sliding sideways
through the turn?

**Pass criterion (yes/no):** At both cruise and boost speed, does the roll
read as banking into the turn rather than sliding?

### 2. Climb/dive feel

**Setup:** none needed.

**Do:** Hold `Space` to climb through roughly 90° of pitch (watch
`__fitz.flight.pitch` in radians if you want a number — `π/2 ≈ 1.57` is
straight up). Release. Then hold `C` to pitch back down to level, and
release again.

**Look for:** Does the pitch rate ease in and out (accelerate/decelerate)
rather than snapping instantly to full rate? When you release the key, does
the nose hold exactly where you left it, with no drift toward level and no
overshoot?

**Pass criterion (yes/no):** Does the climb/dive ease rather than snap, and
does the nose stay exactly where you leave it after release?

### 3. C/X descend ergonomics

**Setup:** none needed.

**Do:** Fly using `W` + `C` together for about a minute (sustained forward
descent). Then, for comparison, try `W` + `X` for a bit.

**Look for:** Whether reaching `C` with your left hand while holding `W`
feels natural for sustained use, versus feeling cramped or requiring an
awkward hand position.

**Pass criterion (yes/no, with a recommendation if no):** Is `C` comfortable
as the descend key? If not, what key should replace/join it (e.g. is `X`
alone better)?

### 4. Altitude bar vs dead-ahead blip overlap

**Setup:**

```js
// Aim the ship at a planet, then climb toward it. Orbits move every frame,
// so read the live position rather than hardcoding one.
const p = __fitz.bodies.saas; // or .video / .agent
__fitz.teleport(p.x, p.y, p.z - 80)
```

**Do:** With the planet roughly ahead (nudge heading with `A`/`D` until its
blip centers on the RADAR.SYS widget, bottom-left of the HUD), hold `W` to
close the distance while holding `Space` to climb toward an extreme pitch
(near ±90°, i.e. the pitch-ladder dot on the radar's right edge pinned near
the top or bottom of its track).

**Look for:** With the pitch reading extreme AND a planet dead-ahead at the
same time, do the pitch ladder (right edge of the radar circle) and the
planet's blip + its relative-altitude chevron (▲/▼) crowd into the same
corner of the small radar widget and become hard to read?

**Pass criterion (yes/no):** Do the altitude/pitch indicator and the
dead-ahead blip collide illegibly in this scenario?

### 5. Chatter cadence

**Setup:** none needed. This one specifically must NOT use teleport into a
zone — the point is ambient chatter while cruising in open space.

**Do:** Fly normally (no particular direction) for three full minutes without
entering any planet's gravity-tip/zone radius (avoid getting close enough
that a zone-specific broadcast line fires).

**Look for:** How often an ambient chatter line appears in the HUD, and
whether the tone/frequency feels atmospheric (background flavor) or
intrusive (interrupts, repeats too often, or feels like spam).

**Pass criterion (yes/no):** Over three minutes of normal flight, does the
chatter read as atmospheric rather than annoying?

### 6. Asteroid ram impact weight

**Setup:**

```js
// Get the first scenery asteroid's collider (position + radius) and
// position the ship just outside it, on the -Z side so holding W (which
// drives the ship toward +Z at the default heading) actually closes the
// gap instead of flying away from it.
const mod = await import("/src/data/asteroids.ts");
const a = mod.ASTEROID_COLLIDERS[0];
__fitz.teleport(a.x, a.y, a.z - a.r - 2)
```

**Do:** Hold `Shift`+`W` (boost) to ram the asteroid head-on. Note the shake,
sound, and bounce-back on impact. Then keep holding `W` (or `Shift`+`W`) to
grind/scrape along it for several seconds, paying attention to how often the
impact sound/shake repeats (it is rate-limited to one per 0.5s).

**Look for (ram):** Do the camera shake, impact sound, and velocity
bounce-back all land together as one event with real weight — or do they
feel disconnected/floaty?

**Look for (grind):** Does the repeat-impact rate (capped at one per 0.5s)
feel like a plausible grinding contact, or like a machine-gun of repeated
hits?

**Pass criterion (yes/no, two parts):** (a) Does the initial ram read as one
weighted impact? (b) Does the 0.5s cooldown feel right rather than
machine-gun during a sustained grind?

### 7. God-ray occlusion

**Setup:**

```js
// Position the ship further from the sun than a planet, on the same
// sun-to-planet line, so the planet sits roughly between you and the sun.
// Orbits move — you may need to nudge sideways (A/D) to walk the planet
// across the line, or just wait a few seconds as its own orbit carries it.
const p = __fitz.bodies.saas; // sun is always at (0,0,0)
const k = 1.6; // ship further out than the planet, same direction from the sun
__fitz.teleport(p.x * k, p.y * k, p.z * k)
```

**Do:** Turn to face back toward the sun (roughly toward the origin). Watch
the sun's rays as the planet's continued orbital motion (or your own small
sideways drift) carries it across the direct line between your ship and the
sun.

For a fixed reference to compare against, run the automated sky probe once
(`npm run test:e2e` — it captures `sky-godrays-open.png` into the probe's
scratch output with the rays unoccluded) and eyeball the difference when a
body is in the way versus that baseline.

**Look for:** Do the god rays visibly dim while the planet occludes the sun,
and re-emerge (brighten back up) once it clears the line?

**Pass criterion (yes/no):** Do the rays visibly dim during occlusion and
recover afterward?

### 8. Real-device touch ergonomics

**Setup:** none — this check cannot be done from a desktop console session.
Touch controls only render when the browser reports `(pointer: coarse)`, so
this genuinely requires an actual phone (or tablet), not devtools emulation.

**Do:** Open the deployed/dev site on a real phone. One-handed, thumb only:
try to reach the movement joystick, the pitch up/down buttons, `SCAN` (only
visible when a scannable target is in range), and `BOOST`. Separately, get
the ship orbit-locked around a planet (fly close enough that it locks
automatically) and open whatever modal/info card that triggers — check it
stays tappable while locked.

**Look for:** Any control that requires stretching your thumb uncomfortably,
or a modal that becomes hard to tap/dismiss while orbit-locked.

**Pass criterion (yes/no):** Are all of joystick, pitch-up/down, `SCAN`, and
`BOOST` reachable one-thumbed without stretching? Do modals stay tappable
while orbit-locked?

### 9. Audio mix balance

**Setup:**

```js
// Unmute from the console instead of hunting for the HUD button.
__fitz.store.getState().setMuted(false)
```

**Do:** With sound on, cycle through the game's audio-triggering moments in
one sitting: fly normally, boost (`Shift`), get the ship orbit-locked around
a planet (fly close enough to trigger it automatically), ram a scenery
asteroid (see check 6's setup snippet), and complete a scan (hold `E` near a
scannable target).

**Look for:** Whether any one layer (engine, boost, impact, ambient
chatter, scan chime, orbit-lock hum, etc.) drowns out or clashes with the
others at any point in that sequence.

**Pass criterion (yes/no):** Across that whole sequence, is any single audio
layer too loud relative to the rest of the mix?

---

## Results

Every row below is `NOT RUN — awaiting human pass`. These nine checks exist
precisely because they require human judgement that an automated agent
cannot honestly provide; a fabricated verdict here would be worse than an
empty row. Do not fill in Pass/Fail without actually performing the check.

| Date | Tester | Check | Result | Notes |
| --- | --- | --- | --- | --- |
| | | 1. Ship banking feel on curves | NOT RUN — awaiting human pass | |
| | | 2. Climb/dive feel | NOT RUN — awaiting human pass | |
| | | 3. C/X descend ergonomics | NOT RUN — awaiting human pass | |
| | | 4. Altitude bar vs dead-ahead blip overlap | NOT RUN — awaiting human pass | |
| | | 5. Chatter cadence | NOT RUN — awaiting human pass | |
| | | 6. Asteroid ram impact weight | NOT RUN — awaiting human pass | |
| | | 7. God-ray occlusion | NOT RUN — awaiting human pass | |
| | | 8. Real-device touch ergonomics | NOT RUN — awaiting human pass | |
| | | 9. Audio mix balance | NOT RUN — awaiting human pass | |
