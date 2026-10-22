# Memory budget, phases 0–5 (PR 47)

**Date:** 2026-10-22/23. **Goal:** bring the game's memory down towards
500 MB before the game stages add assets, without changing how the full tier
looks. The owner approved phases 0–3, then "continue up until #5": KTX2 maps
(4) and, in place of distance-based texture loading (worth ~16 MB once the
maps were compressed), a hunt for per-frame JS garbage (5).

What "500 MB" measures is still the owner's call: the game's share (its tab
plus its GPU process, over an idle Chrome) or Chrome's whole total. An idle
Chrome alone is 0.34–0.49 GB, so the total is not a realistic target.

## Baseline (main at afa2573)

`scripts/perf/memory-footprint.mjs`, headed Chrome on the M5's real GPU, fresh
profile, device scale 2, medians of 3 runs:

| Window | Chrome total | Game's share | GPU process | Tab | JS heap | Ledger |
|---|---|---|---|---|---|---|
| 1512×802 | 2042 MB | 1550 MB | 1401 MB | 467 MB | 24 MB | 775 MB |
| 760×377 | 1558 MB | 1215 MB | 898 MB | 489 MB | 25 MB | 581 MB |

The GPU process is about 743 MB fixed plus 241 MB per million canvas pixels.
The ledger (what WebGL was asked for) counts 93 MB per million; the rest of
the per-pixel cost is Chrome's own (compositing, the canvas's swap chain).

The ledger at 1512×802: textures 491 MB (14 maps at 2048×1024, 157 MB; the
three 4K maps, 134 MB; 30 model textures at 1024², 168 MB), the composer's
screen-sized targets 181 MB, the multisampled canvas 98 MB.

## Phase 0: the measurement

`scripts/perf/memory-footprint.mjs <dirA> [dirB]` serves one or two production
builds and, per run, launches its own headed Chrome with a fresh profile:
idle on about:blank (Chrome's own share), then the game, the spawn banner,
20 s idle, the number-key jumps 1–6 with Escape after each, the logbook open
and shut, 20 s idle. Every 2 s it reads `footprint` for each of that Chrome's
processes (CDP `SystemInfo.getProcessInfo` gives the pids and types). It
prints per-run and median totals, the game's share, the GPU process's fixed
and per-pixel split from the two window sizes, and the ledger, and saves
screenshots after each jump from each build's first run. The orrery date is
pinned, so A and B show the same views. Runs alternate A, B per size.

## Phase 1: the ledger and its budget

`tests/e2e/gpuLedger.mjs` wraps WebGL2's allocation calls (texStorage,
texImage, compressedTexImage, renderbufferStorage, bufferData, their deletes)
and the bindings they act on, and sums bytes per mip level and face. It sits
below three.js and postprocessing, so nothing is missed for being made behind
the scene graph. Entries keep their context; a lost one (R3F's unmount forces
the loss) drops out. The canvas's own buffers are estimated from the context
attributes. Headless and headed runs agree to the megabyte.

`tests/e2e/memory.probe.mjs` loads at the measurement's laptop size, in both
tiers, and holds each category to a ceiling (baseline + 5%, up to the next
5 MB). Flying every jump target must allocate no texture or render target.

## Phase 2: free wins

- **No canvas MSAA** (`antialias: false`). The full tier draws into the
  composer's targets and SMAA smooths it, so the multisampled canvas only held
  ~76 MB for a final full-screen quad. Low-perf draws to the canvas directly
  and now goes without anti-aliasing (owner's choice, 2026-10-22: the cheaper
  tier is its job; keeping SMAA there meant moving four tier-dependent colour
  branches over to a composer path and more GPU work on struggling devices).
- **CPU image copies released after upload** (`src/utils/sceneAssets.ts`).
  three keeps each loaded image (GLB ImageBitmaps, map `<img>`s) only to
  upload it again. ShaderWarmup now uploads uniform maps too and then releases
  every image whose upload is current (renderer properties' `__version`), a
  shared GLB image only once all its textures are up. Measured in dev: the tab
  418 → 256 MB. Canvas and data textures are drawn by code and stay.
  Two paths need the images again, both a new WebGL context:
  - the classic-résumé round trip: GlobalCanvas clears the loader caches on
    unmount, so the new canvas loads afresh from the asset pack's blob: URLs;
  - a lost context: three would restore by re-uploading from the images, so
    `webglcontextrestored` calls `remountCanvas()` (a key bump in App) instead.
  Every `useGLTF`/`useTexture` goes through `useModel`/`useModels`/`useMaps`,
  which record the cache keys to clear. The probe proves both paths bring every
  texture back (and fails, 491 → 5.7 MB, with the cache clear disabled).

## Phase 3: a pixel budget

`src/utils/pixelBudget.ts`: the device pixel ratio stays capped at 1.5 and is
capped further so the canvas draws at most `PIXEL_BUDGET` pixels, never below
one pixel per CSS pixel. `PixelBudget` (GlobalCanvas) keeps it as the window
resizes or changes screens, replacing drei's AdaptiveDpr, which only acted on
`performance.regress()`, which nothing here calls. The HUD is HTML and keeps
the screen's resolution.

## Phase 4: KTX2 maps

`scripts/textures/encode_ktx2.mjs` encodes the body and moon maps from their
masters with KTX-Software's `ktx` (v4.4.2). Owner's choices: Earth's 4096 map
as the UASTC pilot (signed off on its look), then maps only, ETC1S, over
UASTC everywhere (which measured +39 MB of download) and over model textures
too (+9 MB). Opaque maps are ETC1S (BC1 on the GPU, half a byte a texel),
fitted to their decoded result: pole bands evened, the gain bisected until
the linear median is within 1% of the master, the seam's edge columns
balanced; where ETC1S cannot keep within the albedo tests it falls back to
UASTC (Ceres, the Moon). Earth's two maps, whose alpha carries the ocean
mask, are UASTC. Earth's clouds (opacity weighed by three tests) and
Saturn's ring strip stay WebP. KTX2Loader reads them with three's
transcoder, shipped in `public/basis/`; transcoded levels are released after
upload and the transcoder workers ended after warm-up. The map tests decode
KTX2 in Node with the same transcoder (`tests/ktx2Image.ts`). Earth's hue
under its clouds reads 253° from the master; the band went 250 → 255° (the
WebP's 4:2:0 chroma had held it under 250).

## Phase 5: per-frame garbage

A sampling heap profile (collected objects included) put 241 KB of JS
allocation on each frame, over half from drei's `<Trail>` on the cargo
ships: meshline's `setPoints` rebuilt every attribute as fresh arrays and
re-uploaded all of them. `EngineWake.tsx` draws the same ribbon (meshline's
geometry, `wakeGeometry.ts`, held equal to meshline's by a test, and its
shader, ported with the repo's log depth) with its buffers allocated once:
241 → 114 KB a frame while flying, 225 → 99 at idle. The memory probe holds
idle allocation under 160 KB a frame. What remains is three's per-draw
uniform uploads (~36 KB) and many small app sites.

Not explained: in some production sessions the tab's V8 memory climbs
~2.6 MB/s (outside the JS heap, which stays at ~41 MB) until a major GC; in
others it stays flat. It does not come from the trails, and the dev build
does not reproduce it. See docs/FOLLOW-UPS.md.

## Results

Real GPU, M5, headed Chrome, 1512×802 at device scale 2, medians of 3
alternating runs, network off (2026-10-22). "Live" is after a forced GC.

| | main | phase 2 | phase 3 | phase 4 |
|---|---|---|---|---|
| Game's share, live | 1435 MB | 1207 | 1103 | **909** |
| Game's share, steady | 1504 MB | 1468 | 1354 | 1107 |
| GPU process | 1412 MB | 1323 | 1264 | **990** |
| Tab, live | 389 MB | 251 | 250 | 285 |
| Peak, Chrome total | 2285 MB | 2230 | 2180 | 1966 |
| GPU ledger | 775 MB | 699 | 651 | **388** |

(Phase 3's build predates the SMAA fix; the ledger with it is 627 MB.) The
GPU process is ~600 MB above the ledger in every build: Chrome's own share.
Phase 5 changes allocation, not these figures.

Download, first visit (return visits read the packs from Cache Storage):
desktop 8.46 → 15.08 MB, phones 7.16 → 11.65 MB. First frame over a shared
link (`first-frame-ab.mjs`, medians of 3): 7.14 → 10.80 s at 2 MB/s,
3.47 → 4.22 s at 6 MB/s.

500 MB is not reached: the largest remaining parts are Chrome's GPU-process
overhead (~600 MB), the model textures (~196 MB uncompressed) and the JS
garbage between major GCs.
