# GitHub Pages Deploy — Design

**Date:** 2026-07-29
**Status:** Approved direction; implementation plan to follow.
**Baseline:** main @ `670d9d7` (post-fuel-crystals). 139 unit tests pass, lint shows only the
two long-known warnings (`Atmosphere.tsx:54`, `Scanner.tsx:9`), `npm run build` succeeds at
1,578 kB JS / 448 kB gzipped.

## 1. Goal

Make the production build deployable to GitHub Pages at
`https://fitzfitz.github.io/3d-portfolio/`, and stage every piece of that so the site can be
published by enabling Pages — without publishing anything today.

## 2. Why this is not just "run the build"

The app is served from the domain root today (`base: '/'`, Vite's default). A GitHub *project*
page serves from a subpath, `/3d-portfolio/`. Sixteen absolute asset paths are hardcoded to the
root and every one of them 404s under a subpath: no ship, no planets, no portal, no textures.

Vite fixes some of these automatically and — verified empirically, not assumed — silently does
not fix others. Building with `--base=/3d-portfolio/` and inspecting `dist/index.html` gives:

| Reference | Rewritten by Vite? |
| --- | --- |
| `<link rel="icon" href="/favicon.svg">` | yes → `/3d-portfolio/favicon.svg` |
| `<meta property="og:image" content="/og.webp">` | yes → `/3d-portfolio/og.webp` |
| `<meta property="twitter:image" content="/og.webp">` | **no — left as `/og.webp`** |
| emitted JS/CSS bundle tags | yes |
| the 13 `useGLTF(...)` / `useTexture(...)` string literals in `src/` | **no** |

Two distinct causes:

- **`twitter:image`** — Vite's HTML asset-rewriting list covers `meta[property=og:image]` but
  not the Twitter equivalent. The result is a half-broken preview card that renders fine on
  Facebook/LinkedIn and 404s on Twitter/X. Nothing in the build output warns about it.
- **The 13 model/texture paths** — these are *runtime fetches of string literals*, not build-time
  imports. Vite never sees them, so no base rewriting can ever apply. They must be composed
  against the base at runtime.

## 3. Approach

### 3.1 Base path via environment, not a literal

`vite.config.ts`:

```ts
base: process.env.BASE_PATH ?? '/'
```

`npm run dev` and a plain `npm run build` keep working at `/` exactly as now; only the deploy
workflow sets `BASE_PATH=/3d-portfolio/`. A future custom domain becomes an env change rather
than a code change, and local development is untouched.

### 3.2 A helper for the 13 runtime paths, and a guard test that matters more

New `src/utils/assetUrl.ts`:

```ts
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\//, "")}`;
```

`import.meta.env.BASE_URL` is Vite's own view of the configured base, so the helper cannot drift
from `vite.config.ts`. The leading-slash strip makes `asset("/models/x.glb")` and
`asset("models/x.glb")` agree, since `BASE_URL` always carries a trailing slash.

Applied at all 13 call sites in `src/components/canvas/`.

The helper is the easy half. The half that prevents this regressing is a **guard test** that
scans `src/` for surviving bare `"/models/` literals and fails if any exist. Without it, the
fourteenth model someone adds next month reintroduces the exact bug this spec exists to fix, and
nothing catches it until a visitor sees an empty sky. `tests/identity.test.ts` already uses this
source-scanning pattern to catch bare `github.com` URLs, so this follows an established
convention in the repo rather than inventing one.

### 3.3 `index.html` — close the `TODO(deploy)` at line 19

The existing TODO says `og:image` must become an absolute URL and that `og:url` + `canonical`
need adding once a domain exists. A domain now exists.

- `og:image` and `twitter:image` → absolute `https://fitzfitz.github.io/3d-portfolio/og.webp`.
  Absolute is required independently of the base fix: social scrapers do not reliably resolve
  relative image paths, which is what the original TODO was about. Making them absolute also
  moots the `twitter:image` rewriting gap, since an absolute URL needs no rewriting.
- Add `og:url` and `<link rel="canonical">` → `https://fitzfitz.github.io/3d-portfolio/`.
- Delete the now-resolved TODO comment.

**Accepted trade-off:** this hardcodes the github.io project URL in four places. A custom domain
later means revisiting them. Chosen deliberately over leaving the TODO open, because a portfolio
with no canonical URL and a broken Twitter card is a worse default than one that needs four
lines touched if the domain ever changes.

### 3.4 Workflow — committed but inert

`.github/workflows/deploy.yml`, using the official first-party Pages actions:
`actions/configure-pages` → `actions/upload-pages-artifact` → `actions/deploy-pages`.

No `gh-pages` branch. The artifact-based flow is the current GitHub-recommended path and avoids
committing build output to git history — which matters here, because `dist/` is gitignored today
and a `gh-pages` branch would start pushing 4.8 MB of models into the repo on every deploy.

Triggered by `workflow_dispatch` only. The `push: [main]` trigger is written into the file but
commented out. Reason: Pages is not enabled yet (see §4), so a push-triggered run would fail at
the deploy step on every commit and litter the repo with red X's. With `workflow_dispatch` only,
nothing runs until asked.

Sets `BASE_PATH=/3d-portfolio/` for the build step, and the `pages: write` / `id-token: write`
permissions the deploy action requires.

## 4. What is deliberately NOT done — the switch stays unflipped

Pages is **not** enabled and the repo stays **private**. Two reasons, both standing decisions
from earlier today:

1. A Pages site is served publicly regardless of repository visibility, and on a free plan Pages
   requires the repository itself to be public (private-repo Pages needs Pro or above). The
   account's plan could not be read via the API — the token lacks the `user` scope — so this is
   stated as the general constraint, not as a verified fact about this account.
2. Publishing serves the six `UNKNOWN`-licence assets (`portal_gateway.glb`, `space_crystal.glb`,
   `earth/mars/jupiter.jpg`, and the spaceship base mesh) on the open web. `assets-src/MANIFEST.md`
   states these must be re-sourced or replaced "before any public deploy". That work is tracked
   separately and is not part of this spec.

**Flipping the switch, once the licence question is settled, is:** enable Pages with source
"GitHub Actions", uncomment the `push` trigger in `deploy.yml`, make the repo public if on a free
plan. Nothing else in this design changes.

## 5. Verification

Unit tests cannot catch a broken base path — every path here is a runtime URL, and the failure
mode is a successful build that serves 404s. So verification is a real load of the real
production artifact:

1. Build with `BASE_PATH=/3d-portfolio/`.
2. Serve `dist/` at that subpath with `vite preview`.
3. Drive it with `puppeteer-core` (already a devDependency; `tests/e2e/` has an existing harness
   to follow), and assert:
   - **zero failed network requests** — the direct 404 check;
   - the ship and planet GLBs actually resolved, not merely that no error was thrown;
   - a screenshot, as human-checkable evidence it renders before anything is published.
4. Confirm the existing suite still passes at the default base: 139 unit tests, `npm run build`,
   and lint showing no new warnings.

A vacuous pass is the risk to guard against here: a probe that loads a blank page and reports
"no failed requests" would pass while proving nothing. The GLB-resolved assertion is what stops
that, and the count of expected loads should be pinned rather than checked as "> 0".

## 5a. Amendment (2026-07-29, same day) — the switch gets flipped after all

§4 above was written under a decision to stage everything and publish nothing.
The repo owner then asked directly to "fix everything then build it and push it gh-pages",
which reverses that. Two changes to the design as specified:

- **`deploy.yml` ships with an active `push: [main]` trigger**, not the commented-out version
  §3.4 describes. The reason for making it inert — avoiding failed runs while Pages was off —
  no longer applies once Pages is being enabled in the same change.
- **Pages gets enabled and the site goes live**, so §4's "what is deliberately NOT done" no
  longer holds. The licence exposure it describes is now an accepted, explicitly-requested
  consequence: the six `UNKNOWN`-provenance assets are served publicly. `MANIFEST.md`'s
  "before any public deploy" requirement is knowingly outstanding, not satisfied.

Everything in §§1–3 and §5 stands unchanged. The asset-licence work remains tracked and
unstarted; the deploy landing first does not close it.

### Verification record

- 148 unit tests pass (139 pre-existing + 9 new in `tests/assetUrl.test.ts`).
- 139/139 e2e checks pass across all 12 probes, including the new `basepath` probe.
- `npm run build` (tsc + vite) clean; lint shows only the two pre-existing warnings.
- **Both new gates were verified to fail when the bug is reintroduced**, not merely to pass
  when it is absent: reverting one call site to a bare `"/models/spaceship.glb"` literal turned
  5 of the 7 basepath checks red and failed the unit guard.
- That exercise caught a real flaw in the probe's own logic. The
  "no asset served from the domain root" check originally inspected only *successful*
  responses — and a wrong-base request 404s, so it never appeared among successes. It was the
  one check of six that still passed while the bug was live. It now records the request
  *attempt*, with a companion check asserting the list was non-empty so it cannot pass on
  nothing.

## 6. Out of scope

The 1,578 kB chunk-size warning (code splitting is separately tracked), the two known lint
warnings, the asset licence replacement work, the stale-but-merged `assets-live-uplift` branch,
and the nine human QA checks in `docs/QA-CHECKLIST.md`.

Also noted in passing and not acted on: `public/icons.svg` is referenced nowhere in `src/` or
`index.html` — an orphan comparable to `asteroid.glb` in `assets-src/`. Filed, not fixed.
