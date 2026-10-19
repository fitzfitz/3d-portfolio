# Fitzgeral — 3D Flight-Sim CV

An interactive CV you fly through. Three planets are three projects; fly close
enough and the ship locks into orbit and opens the dossier. There is a classic
resume view too, for people who would rather read than fly.

**Live:** https://fitzfitz.github.io/3d-portfolio/

Built with React 19, TypeScript, `@react-three/fiber` / `three`, `zustand`, and
Tailwind, on Vite.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Forward · turn left · brake-back · turn right |
| `Shift` | Warp boost — **consumes fuel** |
| `Space` | Pitch up |
| `C` / `X` | Pitch down |
| `E` (hold) | Scan a nearby object |
| `P` | Photo mode |
| `B` | Drop a beacon (only when a beacon API is configured) |
| `J` | Summon the space jellyfish |
| `1`–`3` | Jump straight into a project's orbit (opens its dossier) |
| `4` | Jump to the career station (opens the Career dossier) |
| `5` | Jump to the shipyard (opens the Hangar: engine plume colours) |
| `6` | Jump to the contact portal |
| `Esc` | Close the open dossier, hangar or contact form |

No flying required: the spawn card has jump buttons for each project, the
sector list (bottom right) jumps on click, and a waypoint marks the next unread
dossier. `?cv` (or `#resume`) on the URL opens the classic résumé directly —
the link to send someone who won't fly.

**Time trial.** The amber ring in the inner belt, near the sun, starts a lap of nine rings
out through the asteroid belt and back. Fly them in order and finish through
the start ring. Par is 0:35, and one tank of warp won't quite cover the loop.
Your best time is saved in this browser, and later laps race a ghost of that
best lap. A jump or an orbit lock aborts the lap.

**Beacons.** If a beacon API is configured, `B` (or the BEACON button) drops a
beacon where your ship is. It carries a phrase from a fixed list, never free
text, and later visitors can scan it. Without the API the feature is absent. See
[`beacon-api/README.md`](beacon-api/README.md).

A gamepad works too, once the browser has seen its first button press: left
stick (or `RT`/`LT`) flies, right stick pitches, `RB` warps, `A` scans, `Y` is
photo mode, `B` closes a dossier, the d-pad (clockwise from up) jumps like
`1`–`4`, View jumps to the shipyard, and Menu jumps to the contact portal. Impacts rumble the pad in Chrome.

Touch controls (joystick, pitch, `SCAN`, `BOOST`) render only when the browser
reports `(pointer: coarse)`, so they will not appear on desktop — including, in
some configurations, devtools device emulation.

Warp costs fuel; floating crystals refuel it. **An empty tank never strands
you** — it disables warp only, and normal thrust stays fuel-blind in every
mode, including touch.

## Running it

```bash
npm install
npm run dev
```

A production build (`npm run build`) ships `public/models` as three asset
packs at the site root, the way a Unity or Godot web build ships its data:
`world-common.<hash>.pack`, plus `world-hd.<hash>.pack` (the planets' 4096
maps) or `world-sd.<hash>.pack` (their 2048 originals), one tier per device.
The loose `models/` files still ship as the fallback for a pack that fails.
`ASSET_PACK=0 npm run build` builds without packs, for comparisons. Dev and
the e2e harness always use the loose files.

The contact form relays through [Web3Forms](https://web3forms.com). Copy
`.env.example` to `.env` and set `VITE_FORM_KEY` to enable it; with the key
empty the form degrades to a `mailto:` link rather than rendering a form that
cannot send. The key is public by design — it only permits sending to the
address that registered it.

## Testing

```bash
npm test          # unit — pure logic, no scene required
npm run test:e2e  # end-to-end — drives a real Chrome via puppeteer-core
npm run lint      # oxlint
```

The e2e suite is a set of probes under `tests/e2e/`, each driving the real app
and asserting against a dev-only debug bridge (`window.__fitz`, stripped from
production builds). Run one at a time by name:

```bash
npm run test:e2e fuel
```

The runner starts one Vite server and runs each probe in its own process.
`startup` (the eager-compile ceiling, best of up to three loads) and
`transition` (the draw-call and triangle budgets) run first, alone, on
SwiftShader, where `docs/PERF-BUDGETS.md` was measured. Every other probe then
runs on the real GPU, four at a time; the full suite takes about five minutes.
`E2E_JOBS=1` runs them one by one, `E2E_BACKEND=swiftshader` puts every
unpinned probe back on the CPU rasterizer, and `E2E_TIMING_OUT=file.json`
saves per-page phase timings.

Load speed is compared outside the suite, between two production builds:
`node scripts/perf/first-frame-ab.mjs <dirA> <dirB>` serves both through
`scripts/perf/shared-link-server.mjs`, which gives every response one shared
bandwidth budget like a home connection (DevTools throttling limits each
request on its own and flatters many small files), and prints the time to the
spawn banner at 2 and 6 MB/s.

Two things to know before running the whole suite:

- It needs a real Chrome at the path hardcoded in `tests/e2e/harness.mjs`, so
  it is a local gate rather than a CI one. CI runs the unit tests only.
- **The `assets` probe invokes Blender against `assets-src/`**, which this
  repo gitignores (it is its own repo, see below). It asserts a sha256
  byte-for-byte restore afterwards. If that check ever fails, stop — see
  `assets-src/MANIFEST.md`.

`docs/QA-CHECKLIST.md` covers the handful of checks a machine genuinely cannot
judge — whether banking *reads* as banking, whether the audio mix is balanced —
with console snippets that set each scenario up in seconds.

## Assets

`public/models/` is ~3.5MB, and **all of it is original and reproducible**:
every model and planet texture comes from a deterministic script in this repo.

```bash
npm run assets:generate   # regenerate everything (Blender headless + scripts/textures/)
npm run assets:optimize   # gltf-transform + sharp, from assets-src/ into public/
```

Every file in `public/models/` goes into an asset pack automatically
(`vite.config.ts`, `src/utils/packFormat.ts`). Naming decides the tier: an
`x_4k.*` file is HD, the `x.*` it replaces is SD, and everything else is in
the common pack every device downloads.

| Asset | Generator |
| --- | --- |
| Hero ship, contact portal, fuel crystal | `scripts/blender/gen_spaceship.py`, `gen_portal.py`, `gen_crystal.py` |
| Asteroids, cargo ship, moon, comet head, jellyfish | `scripts/blender/gen_*.py` |
| Career station, buoy, shipyard, dormant gate | `scripts/blender/gen_career_station.py`, `gen_buoy.py`, `gen_shipyard.py`, `gen_dormant_gate.py` |
| Planet colour + glow maps (one world per project) | `scripts/textures/gen_planets.mjs` |

The optimize pass is deliberately **visually lossless**: weld, dedup, prune,
WebP textures, then quantize and meshopt-compress. Geometry is never
simplified — that is a standing constraint, not an oversight. (The asteroid
belt draws a procedural 80-triangle stand-in at runtime,
`src/utils/lowPolyRock.ts`, rather than a simplified copy of the asset; the
GLB itself is untouched and the hero asteroids still use it.)

`assets-src/` (the raw generator output) is gitignored here but is its own git
repository, backed up to the private `fitzfitz/3d-portfolio-assets-src`, with a
provenance manifest in `assets-src/MANIFEST.md`. `tests/assetProvenance.test.ts`
fails if a shipped file has no generator, so an unowned asset can't slip in.

## Architecture

Two constraints shape most of the code:

**Zero React renders during flight.** Per-frame state lives in `flight`, a
mutable module-level telemetry object in `src/store/spaceStore.ts` — not in
React state and not in the zustand store. The HUD, the radar and the fuel gauge
each read it from their own `requestAnimationFrame` loop and write straight to
the DOM. Store setters that frame loops touch are change-guarded so they cannot
notify on an unchanged value. `tests/e2e/perf.probe.mjs` enforces this by
asserting `commits=0` across five seconds of steady flight; if you add a
per-frame `set()`, that probe is what will catch it.

**Anything repeated is instanced.** Asteroids, crystals, shards and NPC traffic
are each a single `InstancedMesh` with per-instance matrices updated in one
loop. Inactive slots scale to zero rather than resizing an array.

Pure logic — orbital mechanics, toroidal wrapping, fuel, collision, radar
transforms — lives in `src/utils/` with unit tests, so tuning is verifiable
without standing up a scene.

## Deploying

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the unit
tests, builds with `BASE_PATH=/3d-portfolio/`, and publishes to GitHub Pages.

The base path matters: assets are resolved through `src/utils/assetUrl.ts`
rather than by hardcoded absolute paths, because Vite rewrites `<link>`/`<img>`
attributes at build time but not URLs constructed in JavaScript. The social
image URLs in `index.html` are deliberately absolute — scrapers do not reliably
resolve relative `og:image`, and Vite's HTML rewriting covers `og:image` but not
`twitter:image`. A custom domain later means updating `og:url`, `canonical`,
`og:image` and `twitter:image` by hand.

### The service worker

Production builds register `public/sw.js`. It fetches pages network first (a
deploy shows on the next visit, the cached page only when offline), serves the
hashed `assets/*` files from its cache, and leaves the asset packs to
`src/utils/assetPack.ts`, which keeps them in Cache Storage. The build stamps
the worker with its own file list, and the worker drops cached files from
older builds. To retire the worker, deploy the kill-switch version written out
in the header of `public/sw.js`.

### `beacon-api` shares bounds with the client

`beacon-api` imports its validation (position bound `VALIDATION_RADIUS`, phrases,
spawn keep-out) from the client source, so the two must agree. When those bounds
change, deploy the Worker first, then merge the client.

For the bigger-universe change (system grew from a 250-unit torus to a 400-unit
sphere; `VALIDATION_RADIUS` is now a fixed 520): deploy `beacon-api`, verify it
accepts a position near 500, then merge. Otherwise beacons and live-sky positions
beyond the old bounds are rejected.

The New Worlds change moved the edge again, to a 480-unit sphere (the haze from
440). That sits inside the fixed 520, so it needed no Worker deploy.

## Docs

`docs/superpowers/specs/` holds a design document per feature and
`docs/superpowers/plans/` the implementation plan that followed it, each with a
verification record appended. They are the reasoning behind decisions the code
cannot explain on its own — why fuel lives outside the store, why a refuel
confirms only when it lifts you out of low, why the radar gates crystals on 3D
distance rather than horizontal.
