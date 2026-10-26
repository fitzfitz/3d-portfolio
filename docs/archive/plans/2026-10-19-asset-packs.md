# Asset Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `spike/asset-pack` spike into a mergeable PR #36. The site's 3D content loads like a web game, and the first visit is no slower than loose files.

**Architecture:**
- The build splits `public/models` into three hashed packs: common, hd and sd.
- A loader streams common plus one tier into blob URLs (`assetUrl()` answers from them). It caches the packs in Cache Storage and falls back to the loose files on any failure.
- The canvas mounts at once, and an in-canvas gate holds only the scene until the packs settle.
- A service worker keeps the page, code and fonts for offline visits. It prunes against the build's own file list.

**Tech Stack:** Vite 8 (rolldown) plugin, React 19 (`use`), react-three-fiber 9 / drei 10, Cache Storage, a classic service worker, vitest (node env), and the puppeteer-core e2e probes.

**Spec:** `docs/archive/specs/2026-10-19-asset-packs-design.md`, approved 2026-10-19. Read it first. Its "Measurement conditions" are binding for Task 7.

## Global Constraints

- **Branch:** `feat/asset-packs`, which already holds the spike (`baf88d1`) and the spec commit. Don't rebuild what's there; change it.
- **Pack names:** `world-common.<10 hex>.pack`, `world-hd.<10 hex>.pack`, `world-sd.<10 hex>.pack`, at the build root. The format is `src/utils/packFormat.ts` ("FPK1").
- **Tiers:** `x_4k.*` goes to hd. An `x.*` whose `x_4k.*` sibling exists goes to sd. Everything else goes to common.
- **Loose files** keep shipping in `dist/models/` as the fallback. `ASSET_PACK=0` builds without packs.
- **`?cv` and no-WebGL visitors never download a pack.**
- **Every URL goes through `import.meta.env.BASE_URL`.** GitHub Pages serves from `/3d-portfolio/`.
- **Goal 1:** first frame within ±0.1 s of main, at 2 MB/s and at 6 MB/s, median of 5, under the spec's measurement conditions.
- **Dev and e2e** keep loose files. Perf ceilings in `docs/PERF-BUDGETS.md` don't change.
- **Changelog:** a new entry with `pr: 36`. The title is at most 4 words, `what` and `why` at most 220 characters, `how` at most 240 (`tests/changelog.test.ts`).
- **Subagents** must not install packages, kill processes by name, or push.

## Review Focus

1. **A pack URL answered by Cloudflare's single-page-app fallback** (`index.html`, 200, `text/html`) must fall back to the loose files with one warning. Covered in Task 1 (unit) and Task 5 (probe).
2. **Leaving `?cv` and then flying offline** must still work. Pruning keeps every file in the build list, including the `GlobalCanvas` chunk a `?cv` page never loaded. Covered in Task 4.
3. **Low-perf mode switching on during the download, before SpacePlanets mounts**, must not change the tier or fetch loose `/models/` files. Covered in Task 2.
4. **The first visit after a deploy** (new pack hashes) downloads the new packs, removes the old ones, and is never served a stale page. Covered in Task 1 (prune test) and Task 4 (network-first page).
5. **Cache Storage missing or throwing** (private mode, insecure origin): the packs still load from the network. Covered in Task 1.

---

### Task 1: Loader becomes an injectable factory that never rejects

**Files:**
- Modify: `src/utils/assetPack.ts`
- Test: `tests/assetPack.test.ts` (new)

**Interfaces:**
- Produces, in `src/utils/assetPack.ts`:
  - `type Tier = "hd" | "sd"`
  - `interface PackRef { file: string; size: number }`
  - `interface PackSet { common: PackRef; hd: PackRef; sd: PackRef }`
  - `createPackLoader(opts: { packs: PackSet; base: string; tier: () => Tier; fetch?: typeof fetch; caches?: CacheStorage | null }): PackLoader`
  - `interface PackLoader { load(): Promise<void>; packedUrl(path: string): string | undefined; onEntry(fn: (path: string, url: string) => void): void; progress: { loaded: number; total: number; fromCache: boolean; done: boolean }; tier(): Tier | null }`
  - **Module defaults:** keep the spike's export names, delegating to one loader built from `import.meta.env.VITE_ASSET_PACKS`. That's `HAS_ASSET_PACK`, `packProgress`, `packedUrl`, `onPackEntry`, `loadAssetPack`, plus the new `chosenTier(): Tier | null`.
  - **Env format change:** `VITE_ASSET_PACKS` becomes a JSON *string* (`JSON.parse` it; `undefined` means no packs). Task 2 changes the define to match.

- [ ] **Step 1: Write the failing tests** in `tests/assetPack.test.ts`. Build real packs with `encodePack`, and stream them through a fake `fetch` whose `Response` body is a `ReadableStream` that sends the bytes in 3 chunks. Use a fake `CacheStorage` backed by a `Map`.
  - `delivers each file before the stream ends`: `onEntry` gets `models/a.glb` before the last chunk is read (assert via a flag set in the stream's final `pull`).
  - `loads common plus only the chosen tier`: with `tier: () => "hd"`, fetch is called for the common and hd URLs only, and `packedUrl("models/x_4k.webp")` is defined.
  - `never rejects on a single-page-app fallback`: the common URL answers `"<!doctype html>"` with status 200. `load()` resolves, `packedUrl("models/a.glb")` is `undefined`, and `console.warn` is called exactly once.
  - `never rejects on HTTP 404, network error or a truncated body`: one case each. Each resolves, and the files delivered before the failure stay packed.
  - `reads a cached pack without fetching`: pre-seed the fake cache. Fetch is never called and `progress.fromCache` is `true`.
  - `replaces a damaged cached pack`: the cache holds bad bytes. They're deleted, the pack is fetched, and the good pack is stored.
  - `prunes packs this build does not name`: the cache holds `world-common.0000000000.pack`. After `load()`, only this build's three names can remain.
  - `works without Cache Storage`: `caches: null`, and also a `caches.open` that throws. Packs still load from fetch.

- [ ] **Step 2:** Run `npx vitest run tests/assetPack.test.ts`. Expected: FAIL (`createPackLoader` is not exported).

- [ ] **Step 3: Implement `createPackLoader` in `src/utils/assetPack.ts`.**
  - Move the spike's streaming, cache and prune logic into the factory unchanged.
  - **Changes:**
    - Each pack's `loadPack` catches its own errors, warns, and resolves.
    - `load()` warns at most once per page.
    - A cache hit that fails `decodePackIndex` is deleted, then fetched.
    - The tier is read once, on the first `load()`, and kept (exposed via `tier()`).
  - Keep `load()` idempotent: one shared promise.

- [ ] **Step 4:** Run `npx vitest run tests/assetPack.test.ts tests/packFormat.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(packs): loader as a factory that falls back instead of throwing"`.

### Task 2: Build plugin tiering, one tier decision, stable URLs

**Files:**
- Modify: `src/utils/packFormat.ts`, `vite.config.ts`, `src/utils/hiResMaps.ts`, `src/components/canvas/SpacePlanets.tsx`, `src/utils/assetUrl.ts`
- Test: `tests/packFormat.test.ts`, `tests/hiResMaps.test.ts` (new), `tests/assetUrl.test.ts`

**Interfaces:**
- Consumes: `chosenTier()` from Task 1.
- Produces:
  - `packTier(file: string, names: readonly string[]): "common" | "hd" | "sd"` in `packFormat.ts`, used by the plugin.
  - `hiResChoice(): boolean` in `hiResMaps.ts`: the first answer of `prefersHiResMaps()`, kept for the page's lifetime. If the loader already chose a tier (`chosenTier()`), it returns `chosenTier() === "hd"`.
  - SpacePlanets uses `useState(hiResChoice)`, and the loader's `tier` option is `() => (hiResChoice() ? "hd" : "sd")`.

- [ ] **Step 1: Write the failing tests:**
  - **`tests/packFormat.test.ts`, `packTier sorts files into tiers`:** with `names = ["a.glb","fuxx.webp","fuxx_4k.webp","portfolio.webp"]`, `a.glb` is `"common"`, `fuxx.webp` is `"sd"`, `fuxx_4k.webp` is `"hd"`, and `portfolio.webp` is `"common"`.
  - **`tests/hiResMaps.test.ts`, `the choice holds after low-perf switches on`:**
    - Use `vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) })`.
    - `hiResChoice()` is `true`.
    - Then `useSpaceStore.getState().setLowPerf(true)` (check its signature in `src/store/spaceStore.ts`).
    - `hiResChoice()` is still `true`.
  - **`tests/assetUrl.test.ts`, `answers the same URL for a path all page long`:**
    - `vi.mock("../src/utils/assetPack")` with a mutable `packedUrl`.
    - The first call returns the loose URL.
    - After the mock starts returning `"blob:x"`, the same path still returns the loose URL.
    - A new path returns `"blob:x"`.
    - The existing tests must still pass. They pass an explicit `base`, so key the memo by `base + path`.

- [ ] **Step 2:** Run `npx vitest run tests/packFormat.test.ts tests/hiResMaps.test.ts tests/assetUrl.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `packTier` holds the spike plugin's tier rule.
  - The plugin calls `packTier`, and its define becomes `'import.meta.env.VITE_ASSET_PACKS': JSON.stringify(JSON.stringify(refs))`.
  - `hiResChoice` caches its first answer in a module variable.
  - The `assetUrl` memo is a `Map<string, string>`.
  - SpacePlanets swaps `prefersHiResMaps` for `hiResChoice`, and its comment says the choice is per page, shared with the loader.

- [ ] **Step 4:** Run `npx vitest run` (all unit tests). Expected: all pass. Run `npx tsc -b`. Expected: no output.

- [ ] **Step 5: Commit**: `git commit -m "feat(packs): tier rule in packFormat; one tier decision per page; stable asset URLs"`.

### Task 3: Canvas mounts before the packs; loading bar moves into the canvas

**Files:**
- Modify: `src/App.tsx` (lazy factory, `EngineLoading`), `src/components/canvas/GlobalCanvas.tsx` (gate, `LoadProgress`)
- Test: `tests/e2e/basepath.probe.mjs` (existing checks: no loose `/models/` request, no page errors)

**Interfaces:**
- Consumes: `loadAssetPack`, `packProgress`, `HAS_ASSET_PACK` (Task 1).
- Produces: `function PackGate({ children }: { children: ReactNode }): ReactNode` in `GlobalCanvas.tsx`. It calls React 19's `use(loadAssetPack())`. `loadAssetPack` returns one cached promise, which `use` requires.

- [ ] **Step 1: App.tsx.**
  - The lazy factory becomes `lazy(() => { void loadAssetPack(); return import("./components/canvas/GlobalCanvas"); })`. The download starts alongside the chunk, only when the canvas is requested, so `?cv` and no-WebGL never trigger it.
  - `EngineLoading` goes back to its pre-spike form: plain text, no bar, no `useRef`.

- [ ] **Step 2: GlobalCanvas.tsx.**
  - Wrap every child of the main `<Suspense fallback={<LoadProgress />}>` in `<PackGate>`. That includes `DebugBridge`, `PerfSampler` and `ShaderWarmup`, which must stay last inside the gate.
  - `PostFX`, `OrbitControls`, `AdaptiveDpr` and `PerformanceMonitor` stay outside.
  - `LoadProgress`'s rAF tick shows `"<loaded> / <total> MB"` from `packProgress` while `HAS_ASSET_PACK && !packProgress.done`. Otherwise it shows the existing loading-manager readout.

- [ ] **Step 3:** Run `npx tsc -b && npx vitest run && npx oxlint src tests`. Expected: clean, with all unit tests passing.

- [ ] **Step 4:** Run `npm run test:e2e -- basepath`. Expected: every check passes, including `the packs covered the landing view (no loose /models/ request)`, which proves the gate wraps every `assetUrl` user.

- [ ] **Step 5: Commit**: `git commit -m "feat(packs): mount the canvas at once; gate only the scene on the packs"`.

### Task 4: Service worker prunes against the build's file list

**Files:**
- Modify: `public/sw.js`, `vite.config.ts` (inject the list), `src/utils/serviceWorker.ts` (drop the prune-by-loaded assumption only if it moves into the worker)
- Test: `tests/serviceWorker.test.ts` (new)

**Interfaces:**
- Produces:
  - In `public/sw.js`: a top-level `const BUILD_ASSETS = /*__BUILD_ASSETS__*/[];` and a top-level `function staleAssetUrls(cachedUrls, buildAssets, scope)`. It returns the cached URLs under `<scope>assets/` whose path isn't in `buildAssets`. Non-asset URLs are never stale.
  - In `vite.config.ts`: the plugin's `writeBundle` replaces `/*__BUILD_ASSETS__*/[]` in `<outDir>/sw.js` with the JSON list of the bundle's `assets/...` file names. The bytes then change every build, which makes the browser install the new worker.
  - The worker's `activate` runs `staleAssetUrls` over `fitz-shell-v1` and deletes what it returns. That happens before `clients.claim()`.

- [ ] **Step 1: Write the failing tests** in `tests/serviceWorker.test.ts`. Load `public/sw.js` into a `node:vm` context with a stub `self` (`addEventListener` is a no-op, `location.origin` is set) and read `staleAssetUrls` from the context.
  - `keeps every build file, loaded or not`: scope `/3d-portfolio/`, build list `["assets/GlobalCanvas-A.js","assets/index-B.js"]`, cached `[".../3d-portfolio/assets/index-B.js"]`. Result: `[]`. This is the `?cv` case: GlobalCanvas wasn't loaded and isn't deleted.
  - `drops assets from older builds`: cached `assets/index-OLD.js` is returned.
  - `never touches non-asset URLs`: the page URL and `favicon.svg` aren't returned.

- [ ] **Step 2:** Run `npx vitest run tests/serviceWorker.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `staleAssetUrls`, the activate-time prune and the plugin injection.
  - Document the kill switch in the `sw.js` header. To retire the worker, replace `public/sw.js` with a worker whose `install` calls `skipWaiting()` and whose `activate` deletes every `fitz-shell-*` cache, calls `self.registration.unregister()`, and navigates open clients to reload.
  - Put the exact few lines in the header comment.

- [ ] **Step 4:** Run `npx vitest run && npx vite build --outDir /tmp/x` (use your scratch dir). Expected: tests pass, and `grep -c '"assets/' <outDir>/sw.js` is at least 3.

- [ ] **Step 5: Commit**: `git commit -m "feat(sw): prune against the build's own file list; document the kill switch"`.

### Task 5: Probe the return, offline and failure paths

**Files:**
- Modify: `tests/e2e/basepath.probe.mjs`

**Interfaces:**
- Consumes: the built artifact the probe already makes, and the `Checks` API from `tests/e2e/harness.mjs`.
- Produces new checks, named exactly:
  - `return visit downloads no pack and renders the scene`
  - `offline reload renders the scene`
  - `a pack answered by the SPA fallback falls back to loose files`

- [ ] **Step 1: Add the three checks after the existing ones**, on the same page and browser.
  - **"Renders the scene"** means `page.waitForFunction(() => document.body.innerText.includes("SPACE FLIGHT CV"))` within `CANVAS_READY_TIMEOUT_MS`, plus the existing full-size WebGL canvas check.
  - **Return:** reload, record `.pack` requests, and expect 0.
  - **Offline:** `await page.setOfflineMode(true)`, reload, expect the scene, then `setOfflineMode(false)`.
  - **Fallback:** open a fresh `browser.createBrowserContext()` page. There's no SW or cache there; still unregister and clear defensively. Intercept `world-common.*.pack` with `req.respond({ status: 200, contentType: "text/html", body: "<!doctype html><title>x</title>" })`. Expect the scene, no page errors, and at least one loose `/models/` request.

- [ ] **Step 2:** Run `npm run test:e2e -- basepath`. Expected: all checks pass. Confirm the fallback check *can* fail: temporarily make `load()` rethrow, see the check fail, then revert. Note the result in the commit message.

- [ ] **Step 3: Commit**: `git commit -m "test(e2e): basepath probe covers return, offline and pack-failure fallback"`.

### Task 6: Docs, patch note, renumbering

**Files:**
- Modify: `src/data/changelog.ts`, `README.md` (sections "Running it", "Deploying", "Assets"), `docs/FOLLOW-UPS.md:45`, `docs/archive/specs/2026-10-17-new-worlds-design.md` (C2 PR number)

- [ ] **Step 1: Add the newest-first entry** `{ id: "2026-10-19-loads-like-a-game", date: "2026-10-19", pr: 36, title: "Loads Like a Game", ... }`.
  - `what`: the universe arrives as a couple of downloads with a real progress bar, opens straight from your device on a return visit, and keeps flying offline.
  - `why`: web games feel solid because they load once.
  - `how`: packs split by texture quality, streaming, browser storage and a service worker.
  - Keep within the length limits.

- [ ] **Step 2: README.**
  - **Running it:** what a production build emits (three packs plus the loose fallback) and `ASSET_PACK=0`.
  - **Deploying:** the service worker, network-first pages and the kill switch (point to the `sw.js` header).
  - **Assets:** adding a file to `public/models` puts it in a pack automatically, and the `_4k` naming decides the tier.

- [ ] **Step 3: Renumber C2 from #36 to #37** in `docs/FOLLOW-UPS.md` and the new-worlds spec.

- [ ] **Step 4:** Run `npx vitest run tests/changelog.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "docs: patch note (pr 36), README on packs and the service worker; C2 is now #37"`.

### Task 7: Measure against main (Goal 1) and memory

**Files:**
- Create: `scripts/perf/first-frame-ab.mjs`
- Modify: `README.md` (one line under Testing pointing to `scripts/perf/`)

**Interfaces:**
- Consumes: `scripts/perf/shared-link-server.mjs` (committed): `node shared-link-server.mjs <dir> <port> <bytesPerSec> <latencyMs>`.
- Produces: `node scripts/perf/first-frame-ab.mjs <packDir> <looseDir> [runs=5]`.
  - It starts both servers at 2 MB/s with 40 ms delay, then at 6 MB/s with 25 ms delay.
  - It drives Chrome with puppeteer-core (Chrome path as in `tests/e2e/harness.mjs`).
  - Each run follows the spec's measurement conditions exactly: viewport 1512×802; unregister SWs, clear caches and disable the HTTP cache before each run; time from `goto` (commit) until the banner text; alternate the two builds.
  - It prints each run and the medians.
  - It stops its servers by the PIDs it spawned. Never by name.

- [ ] **Step 1: Write the script.**

- [ ] **Step 2: Build both sides into the scratch dir.**
  - This branch: `npx vite build --outDir <scratch>/pack`.
  - main: `git worktree add <scratch>/main-wt main`, then `npm ci` there. That's a separate install in its own tree, which is allowed only for the controller, not subagents. Then `npx vite build --outDir <scratch>/loose`.

- [ ] **Step 3: Run the script.** Expected: pack median minus loose median ≤ 0.1 s at both speeds.
  - If it misses, do the spec's fallback 1: a small inline script in `index.html` that starts the pack fetches early, with the same `?cv`, WebGL and tier checks, and hands the in-flight responses to the loader. Then re-measure.
  - If it still misses, **stop and report the numbers to the owner.**

- [ ] **Step 4: Memory A/B in real Chrome at 1512×802.** Compare the GPU-process RSS against main's ~2 GB baseline, as described in the prod memory-baseline memory note. Expected: within noise. Record both numbers.

- [ ] **Step 5: Commit** the script and README line with the medians in the message. Then run the full `npm run test:e2e` and `npx vitest run`. Both green.

### Task 8: Pull request

- [ ] **Step 1:** Push `feat/asset-packs` as fitzfitz (see the push-account memory note). Open PR #36 against `main`. The body carries what/why/how, the Task 7 medians table, the memory numbers, the e2e and unit counts, and a note that the preview is behind Cloudflare Access.
- [ ] **Step 2:** Wait for the Cloudflare Workers Builds check to pass, then hand the PR link to the owner. **Do not merge.**
