# Asset packs: load like a web game

**Date:** 2026-10-19 · **Branch:** `feat/asset-packs` (from the spike `spike/asset-pack`) · **PR:** #36

**Owner:** the idea and the approach are the owner's: ship the site the way Unity and Godot web builds ship (the code bundle plus one data download), and test it on a branch first. Details marked *my call* are mine, most of them settled by measurement on the spike.

## Intent

The owner wants the site to load like a web game:
- one place the 3D content comes from;
- a loading bar that shows the true percentage;
- a return visit that downloads nothing;
- play that keeps working offline.

The text, menus, HUD and CV stay as page elements over the canvas. Drawing them in WebGL would break screen readers, links and crawlers, and it would not make loading faster.

## What the spike proved (spike/asset-pack, `baf88d1`)

The spike is built and works. All numbers are from a real production build in Chrome, through a local server that gives every response one shared bandwidth budget, the way a home connection does. Chrome's own throttling limits each request separately, which flattered ~30 loose files about 3×, so it is not used for comparisons.

| | Packs (spike) | Loose files (main) |
|---|---|---|
| First frame, 2 MB/s | 7.7 s | 7.4 s |
| First frame, 6 MB/s | 3.9 s | 3.6 s |
| Return visit | 2.75 s, no asset requests | network revalidation |
| Offline | full scene in 2.26 s | does not load |

"First frame" is the moment the spawn banner (`SPACE FLIGHT CV`) appears, which `sceneReady` gates.

**Measurement conditions:** repeat these exactly; the A/B is only comparable under them.
- **Server:** the shared-link server (one bandwidth budget for all responses). Its fixed per-response delay was 40 ms at 2 MB/s and 25 ms at 6 MB/s.
- **Browser:** real Chrome (Playwright), viewport 1512×802, a fine-pointer desktop, so the hd tier.
- **Cold start before each run:** unregister every service worker, delete every Cache Storage entry, and disable the HTTP cache (CDP `Network.setCacheDisabled`).
- **Timing:** from `page.goto(…, { waitUntil: "commit" })` until `getByText("SPACE FLIGHT CV")` is visible.
- **Order:** builds alternate pack, loose, pack, loose.
- **Noise:** loose on main varied by at most 0.06 s across 3 runs (7.42/7.47/7.44, 3.68/3.62/3.62).

Findings that shape this design:
1. **There is nothing to load later.** The loose build requests nearly every model before its first frame, in Suspense waterfalls (ship, then a batch, then portal, then moon). A "core now, rest later" split saves nothing.
2. **The only safe saving is the unused texture tier.** A device draws either the 4096 planet maps or the 2048 originals, never both.
3. **The remaining gap is constant across bandwidths (~0.25 s).** That makes it a start-up ordering cost, not bytes. The spike mounts the whole canvas only after the packs arrive, so the WebGL context and the post-processing compile (PostFX sits outside the scene's Suspense) wait for the download. In the loose build they run during it.

## Goals

1. **First visit no slower than loose files:** within ±0.1 s of main at 2 MB/s and 6 MB/s on the shared-link harness, median of 3.
2. **Return visit downloads no 3D content and no code** (only the page itself, network-first).
3. **Offline after one visit:** the full scene renders. Live sky and beacons are simply absent.
4. **Never worse than today when something fails:** a missing, truncated or blocked pack falls back to the loose files and the scene still renders.
5. **One origin:** fonts are self-hosted; nothing loads from Google.

## Non-goals

- A single-file HTML build, or UI drawn inside the canvas.
- Offline live sky, beacons or the contact form.
- New compression (KTX2/Basis, Draco). The packs carry the files as they are today.
- Packs in dev or in the e2e harness. Those keep the loose files.
- Installable-app polish (manifest, icons, install prompt). It's easy to add later.

## Anti-goals (a failure even if it technically works)

- A stale site after a deploy. The page must always be fetched network-first.
- A blank or broken scene when a pack fails.
- Any regression on the GitHub Pages subpath (`/3d-portfolio/`).
- A slower first visit than main, beyond the ±0.1 s tolerance.

## Design

### Packs (build)

As in the spike (`vite.config.ts`, plugin `fitz-asset-pack`):
- `public/models` becomes three packs:
  - `world-common.<hash>.pack`
  - `world-hd.<hash>.pack`: the `_4k` maps
  - `world-sd.<hash>.pack`: each `x` that has an `x_4k` sibling
- **Format:** `src/utils/packFormat.ts` ("FPK1", u32 index length, JSON index, bytes). Models come before textures inside a pack.
- **What the build exposes:** each pack's file name and exact size, through `import.meta.env.VITE_ASSET_PACKS`.
- **Loose files** still ship in `dist/models/` as the fallback (*my call*: deploy size only, never downloaded when the packs work).
- **`ASSET_PACK=0`** builds without packs, for A/B runs.

### Loader (runtime)

As in the spike (`src/utils/assetPack.ts`):
- **Which packs:** common plus one tier, chosen by `prefersHiResMaps()` (`src/utils/hiResMaps.ts`). SpacePlanets uses the same rule.
- **Streaming:** files are delivered as their last byte arrives (`onPackEntry`). GlobalCanvas starts `useGLTF.preload` per model.
- **Cache:** packs live in Cache Storage (`fitz-asset-pack`), keyed by hashed URL. After a load, every pack this build doesn't name is pruned. Both tiers of this build are kept.

**New in this PR:**
1. **The canvas mounts before the packs arrive.**
   - The lazy `GlobalCanvas` import no longer waits for the packs.
   - Inside the canvas, the main Suspense's children sit behind a gate that suspends until `loadAssetPack()` settles. The Canvas, WebGL context and PostFX mount at once.
   - This is expected to close the ~0.25 s, but that is a hypothesis to measure.
   - The gate must wrap every component that calls `assetUrl`. A component that renders before the packs arrive would get a loose URL and fetch the loose file.
   - **The download still starts in `App`, alongside the code chunk** (as in the spike), not inside the gate, where it would wait for the chunk (*my call*).
   - **If the gate does not meet Goal 1** (*my call*):
     1. Try starting the pack download before the main bundle runs. A small inline script in `index.html` repeats the `?cv`, WebGL and tier checks and hands its in-flight fetch to `assetPack.ts`. A `<link rel=preload>` is not allowed, because it would download packs for `?cv` and no-WebGL visitors.
     2. If it still misses, stop and report the numbers to the owner before opening the PR for merge. The owner decides whether to ship.
1b. **The texture tier is fixed once** (*my call*). `loadAssetPack()` decides the tier and exports it, and SpacePlanets reads that choice instead of asking `prefersHiResMaps()` again. With the canvas mounting during the download, the performance monitor could switch on low-perf mode before SpacePlanets mounts. SpacePlanets would then ask for the other tier and fetch loose files.
2. **The loading bar moves into the canvas.**
   - `LoadProgress`, the Suspense fallback, shows pack bytes ("2.4 / 6.9 MB") while packs stream.
   - The DOM `EngineLoading` goes back to the plain text it had before the spike, since it now only covers the code chunk.
3. **Failure falls back, it doesn't throw.**
   - If a pack fetch fails (HTTP error, network, truncation, size mismatch, bad magic), `loadAssetPack()` still resolves.
   - Bad magic covers a real case: Cloudflare's single-page-app fallback answers a missing or outdated pack name with `index.html` and a 200 status. A test covers it.
   - It logs one `console.warn`. Files that arrived stay packed, and `assetUrl()` returns the loose URL for the rest.
   - A damaged cached pack is deleted and downloaded again.
4. **Stable URLs.** `assetUrl()` keeps returning the first answer it gave for each path (*my call*). A component that remounts can then never switch between loose and blob URLs, which would re-suspend the scene.

### Service worker

As in the spike (`public/sw.js`, registered by `src/utils/serviceWorker.ts` in production only):
- **Pages:** network first, with the cached copy as the offline fallback.
- **`/assets/*`** (hashed): cache first.
- **Other same-origin files:** stale-while-revalidate.
- **`*.pack`:** ignored (the loader owns them).
- **Cross-origin:** never touched.

**New in this PR:**
1. **Pruning.** The worker drops cached `/assets/*` entries that aren't in the build's own file list, so old builds don't pile up (*my call*).
   - It must not prune by what the current page loaded. A `?cv` visit never loads the `GlobalCanvas` chunk, so pruning by that would delete this build's 3D engine from the cache, and offline flying would then fail.
   - The builder chooses how the worker learns the build's list, for example a manifest the build writes.
2. **Kill switch.** It's documented in the worker header and the README. To retire the worker, deploy a `sw.js` that unregisters itself and clears its caches. A short test or doc example shows the exact file.

### Fonts

Self-hosted with `@fontsource` (Orbitron 700–900, Outfit 300–600, JetBrains Mono 400–700), Latin subset only (*my call*). Characters outside Latin fall back to system fonts per glyph, as they would with Google's subsets.

### Patch note (changelog, PR #36)

The visitor-facing entry is titled "Loads Like a Game":
- **What:** the universe downloads as a couple of packs with a real progress bar, opens instantly on return, and flies offline.
- **Why:** web games feel solid because they load once.
- **How:** packs split by texture quality, streaming, browser storage and a service worker.

*My call:* this PR takes #36. C2 (the cartographer in the live sky) becomes #37, and its spec and the roadmap note get renumbered.

## Testing

- **Unit tests:**
  - pack format round-trip (exists);
  - plugin tiering: `x_4k` goes to hd, `x` with an `x_4k` sibling goes to sd, everything else to common;
  - `assetUrl` stability.
- **e2e (`tests/e2e/basepath.probe.mjs`, the probe that already builds production):**
  1. **Packs load:** common plus exactly one tier, under the subpath, with no loose `/models/` request (exists).
  2. **Return visit:** reload, then no `.pack` request and the scene renders.
  3. **Offline:** turn the network off, reload, then the WebGL canvas and the spawn banner appear.
  4. **Fallback:** block `world-common.*.pack`, reload, then the scene still renders from loose files with no page error.
- **Performance:**
  - the shared-link A/B against main, under the measurement conditions above: 2 and 6 MB/s, 5 runs each (*my call*, up from the spike's 3), median compared against ±0.1 s, reported in the PR;
  - a real-Chrome memory A/B against the prod baseline (~2 GB at 1512×802; see the memory note on the prod baseline). The packs keep about 7 MB of blobs alive, which is expected to be negligible.
- **The rest:** the full `npm run test:e2e` and unit suite stay green, and the existing perf ceilings are unchanged (dev builds don't use packs).

## Constraints

- Cloudflare assets allow at most 25 MiB per file. The biggest pack is 5.1 MB.
- GitHub Pages serves from `/3d-portfolio/`. Every URL goes through `BASE_URL`, and the worker scope is the base.
- `?cv` and no-WebGL visitors must never download a pack.
- No beacon-api change, so nothing to deploy before merge.

## Left to the builder

- How the in-canvas gate is built (`use()` of the pack promise, or a small suspender), as long as it wraps every `assetUrl` user.
- The exact files for the A/B tooling. *My call:* commit the shared-bandwidth server (its spike copy lives only in a temporary session folder) and a small driver script that repeats the measurement conditions, both under `scripts/perf/`, with a README line. The throttling lesson is easy to relearn the hard way.
- The probe's structure for the return, offline and fallback checks.
