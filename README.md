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
| `J` | Summon the space jellyfish |

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

Two things to know before running the whole suite:

- It needs a real Chrome at the path hardcoded in `tests/e2e/harness.mjs`, so
  it is a local gate rather than a CI one. CI runs the unit tests only.
- **The `assets` probe invokes Blender against `assets-src/`**, which is
  gitignored and local-only. It asserts a sha256 byte-for-byte restore
  afterwards. If that check ever fails, stop — see `assets-src/MANIFEST.md`.

`docs/QA-CHECKLIST.md` covers the handful of checks a machine genuinely cannot
judge — whether banking *reads* as banking, whether the audio mix is balanced —
with console snippets that set each scenario up in seconds.

## Assets

`public/models/` is ~3.6MB, and most of it is reproducible:

```bash
npm run assets:generate   # regenerate GLBs via headless Blender (scripts/blender/)
npm run assets:optimize   # gltf-transform + sharp, from assets-src/ into public/
```

The optimize pass is deliberately **visually lossless**: weld, dedup, prune,
WebP textures, then quantize and meshopt-compress. Geometry is never
simplified — that is a standing constraint, not an oversight.

Six assets are **not** reproducible — external files of unknown provenance
listed in `assets-src/MANIFEST.md`. That manifest is this repo's only record of
what would be unrecoverable if the local `assets-src/` directory were lost, so
back it up before touching the machine it lives on.

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

## Docs

`docs/superpowers/specs/` holds a design document per feature and
`docs/superpowers/plans/` the implementation plan that followed it, each with a
verification record appended. They are the reasoning behind decisions the code
cannot explain on its own — why fuel lives outside the store, why a refuel
confirms only when it lifts you out of low, why the radar gates crystals on 3D
distance rather than horizontal.
