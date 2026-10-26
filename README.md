# Fitzgeral — 3D Flight-Sim CV

An interactive CV you fly through, set in the real Solar System: the eight
planets, Ceres and the nine major moons, each where NASA/JPL puts it on the
date the HUD shows (`docs/UNIVERSE-RULES.md` lists every law it keeps and
every convention it discloses). Each project is a probe (three today, up to
six; see "Content" below); fly close
and hold `F` to reel one in with the tractor beam and open its dossier. There is a classic
resume view too, for people who would rather read than fly.

**Live:** https://porto.fitzgeral.my.id (staging: https://fitzfitz.github.io/3d-portfolio/)

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
| `F` (hold) | Tractor beam: reel in crystals, belt pebbles and project probes |
| `P` | Photo mode |
| `B` | Drop a beacon (only when a beacon API is configured) |
| `J` | Summon the space jellyfish |
| `1`–`3` | Jump next to a project probe (grab it with `F` to open its dossier) |
| `4` | Jump to the career station (opens the Career dossier) |
| `5` | Jump to the shipyard (opens the Hangar: engine plume colours) |
| `6` | Jump to the contact portal |
| `Esc` | Close the open dossier, hangar or contact form |

The keys above are for the three projects the site has today. The probes come
first, one key each, then the three destinations, so with more projects every
destination key moves up by one (six projects: career `7`, shipyard `8`,
contact `9`).

No flying required: the spawn card has jump buttons for each project, the
sector list (bottom right) jumps on click, and a waypoint marks the next unread
probe. `?cv` (or `#resume`) on the URL opens the classic résumé directly —
the link to send someone who won't fly.

**Time trial.** The amber ring in the inner system, near the sun, starts a lap of nine rings
out past the orbits of Mercury and Venus and back. Fly them in order and finish through
the start ring. Par is 0:35, and one tank of warp won't quite cover the loop.
Your best time is saved in this browser, and later laps race a ghost of that
best lap. A jump or an orbit lock aborts the lap.

**Beacons.** If a beacon API is configured, `B` (or the BEACON button) drops a
beacon where your ship is. It carries a phrase from a fixed list, never free
text, and later visitors can scan it. Without the API the feature is absent. See
[`beacon-api/README.md`](beacon-api/README.md).

A gamepad works too, once the browser has seen its first button press: left
stick (or `RT`/`LT`) flies, right stick pitches, `RB` warps, `A` scans, `Y` is
photo mode, `B` closes a dossier, `LB` grabs a probe, the d-pad (clockwise from up) jumps like
`1`–`4`, View jumps to the shipyard, and Menu jumps to the contact portal. Impacts rumble the pad in Chrome.

Touch controls (joystick, pitch, `SCAN`, `BOOST`, `BEAM`) render only when the browser
reports `(pointer: coarse)`, so they will not appear on desktop — including, in
some configurations, devtools device emulation.

Warp costs fuel; floating crystals refuel it. In open space warp keeps
building (long-range cruise, up to 12×), so Earth to Neptune takes seconds,
and it eases off as you near anything. **An empty tank never strands
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
It stops the server's whole process group when it ends, Ctrl-C included, so
no `vite` is left holding port 5199; `node tests/e2e/run-one.mjs <probe>` runs
a single probe with its own server and stops it the same way.
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

`public/models/` is ~9 MB, and **every file has a recorded source and is
reproducible**: the models and the generated maps come from deterministic
scripts in this repo, and the real bodies' surfaces are NASA/USGS/JPL
public-domain mosaics, fetched by a script that pins each URL and SHA-256.

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
| Asteroids, cargo ship, comet head, jellyfish, project probe | `scripts/blender/gen_*.py` |
| Career station, buoy, shipyard, dormant gate | `scripts/blender/gen_career_station.py`, `gen_buoy.py`, `gen_shipyard.py`, `gen_dormant_gate.py` |
| Phobos and Deimos (built to P. C. Thomas's PDS shape models) | `scripts/blender/gen_mars_moons.py` |
| Planet and moon maps from NASA/USGS/JPL mosaics (Mercury, Earth with clouds and night lights, the Moon, Mars, Ceres, Jupiter, the Galileans, Triton) | `scripts/textures/fetch_nasa_maps.mjs`, then `process_body_maps.mjs` |
| Maps where no true-colour global map exists (Venus, Titan; Saturn, Uranus, Neptune) | `scripts/textures/gen_body_maps.mjs`, `gen_worlds.mjs` |

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

## Content

The projects and the career history live in two tables of the beacon API's D1
database, `projects` and `career`, and the owner edits them in the Cloudflare
D1 console. The steps, the columns and the rules are in
[`beacon-api/README.md`](beacon-api/README.md) ("Editing the content").

- **The bundled copy.** [`src/data/projects.json`](src/data/projects.json) and
  [`src/data/career.ts`](src/data/career.ts) are the snapshot that ships with
  the site. The site uses them offline, when the API is slow, failing or empty,
  against a Worker without `/content`, and in dev and e2e (no
  `VITE_BEACON_API`). `beacon-api/content-seed.sql` is generated from them
  (`npm run content:seed`), and `tests/contentSeed.test.ts` fails when the
  two drift.
- **Loading.** While the game loads, `src/main.tsx` fetches `GET /content`
  fresh, alongside the asset packs. It waits at most 4 s, then falls back to
  the last good copy in localStorage, then to the bundled copy. The INITIALIZING
  overlay shows this as a step. Each row is validated
  (`src/utils/contentParse.ts`), and a bad row is dropped with a
  `console.warn`. The content settles before the app's modules load, and it
  never changes during a visit.
- **Placement.** Positions are never stored. Projects take the vetted probe
  slots in `src/data/probes.ts` in their `sort` order: six slots, the first
  three where the probes always were. A seventh project shows in the résumé
  but gets no probe (and a `console.warn`). The career buoys are spread along
  the trail for 1 to 12 jobs (`src/data/careerTrail.ts`); past 12, the newest
  twelve get buoys.
- **Not dynamic.** `index.html`'s `<noscript>` summary and JSON-LD are kept by
  hand, for crawlers (`tests/indexHtml.test.ts` checks them against the
  bundled copy). So are the hand-written radio lines per project
  (`src/data/chatterLines.ts`); a project without them gets one line made from
  its `short`.

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

Pure logic — the ephemeris and orbital mechanics, fuel, collision, radar
transforms — lives in `src/utils/` with unit tests, so tuning is verifiable
without standing up a scene.

## Deploying

Two stages, each with its own workflow:

- **Staging.** Merging to `main` triggers `.github/workflows/staging.yml`, which
  runs the unit tests, builds with `BASE_PATH=/3d-portfolio/`, and publishes to
  GitHub Pages (https://fitzfitz.github.io/3d-portfolio/).
- **Production.** Pushing a version tag triggers
  `.github/workflows/release.yml`, which refuses a tag that is not on `main`,
  runs the unit tests, builds for the domain root, and deploys the Cloudflare
  Worker `3d-portfolio` (https://porto.fitzgeral.my.id and
  https://3d-portfolio.fitzgeralmedia.workers.dev). Check the commit on staging
  first, then:

  ```bash
  gh release create v1.2.0 --target main --generate-notes
  ```

  To roll back, re-run the release run of the previous tag, or
  `npx wrangler rollback`. The workflow needs the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` repository secrets, and Workers Builds must stay
  disconnected in the Cloudflare dashboard, or merges would deploy production
  directly again.

`beacon-api/` is not part of either: deploy it by hand (below).

The base path matters: assets are resolved through `src/utils/assetUrl.ts`
rather than by hardcoded absolute paths, because Vite rewrites `<link>`/`<img>`
attributes at build time but not URLs constructed in JavaScript. The social
image URLs in `index.html` are deliberately absolute — scrapers do not reliably
resolve relative `og:image`, and Vite's HTML rewriting covers `og:image` but not
`twitter:image`. They name production, porto.fitzgeral.my.id, on every host.

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
sphere; `VALIDATION_RADIUS` became a fixed 520): deploy `beacon-api`, verify it
accepts a position near 500, then merge. Otherwise beacons and live-sky positions
beyond the old bounds are rejected.

The New Worlds change moved the edge again, to a 480-unit sphere (the haze from
440), inside the fixed 520, so it needed no Worker deploy.

The real Solar System (PR #40) moved it to a 3,600-unit sphere (31.3 AU, past
Neptune; the haze from 3,560) and `VALIDATION_RADIUS` to 3,800. That change
needs the Worker first: deploy `beacon-api`
(`npx wrangler deploy --config beacon-api/wrangler.toml`), check that it accepts
a position near 3,700 and the AURUM plume at both 5 (old cached clients) and 9
charted worlds, then merge the site.

## Docs

`docs/archive/specs/` holds a design document per feature and
`docs/archive/plans/` the implementation plan that followed it, each with a
verification record appended. They are the reasoning behind decisions the code
cannot explain on its own — why fuel lives outside the store, why a refuel
confirms only when it lifts you out of low, why the radar gates crystals on 3D
distance rather than horizontal.
