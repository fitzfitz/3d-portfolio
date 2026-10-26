# Projects and career from D1 (design)

**Date:** 2026-10-23. **Status:** decisions taken (owner and controller), built
on `feat/dynamic-content`.
**Plan:** `docs/archive/plans/2026-10-23-dynamic-content.md`.

## Why

The projects (`src/data/projects.json`) and the career history
(`src/data/career.ts`) are compiled into the site, so every wording fix is a
pull request and a release. The owner asked:

- "is it possible ... for the project object in space and the career path
  data are coming from database? so it's dynamic?"
- "for database, I can just go through the d1 service and update it my self."
- "the schema is pretty simple I think, what we have, put it as a field in our
  database schema"

The `beacon-api` Worker already has a D1 database (`fitz-beacons`) bound, so
the content moves there, and the bundled files stay as the fallback snapshot.

## Decisions

### Owner (2026-10-23)

| Question | Decision |
|---|---|
| Is the content dynamic? | **Yes**: projects and career come from D1 |
| How is it edited? | **In the Cloudflare D1 console.** No admin page, no write endpoint |
| Schema | **Today's fields, one column each** |
| Loading | **"Can we make the data fetching as part of the game loading?"** Then, of three options: **C** (below, "Loading") |

### Controller (stated to the owner, 2026-10-23)

1. **Two tables in the same database**, added by a schema file next to
   `beacon-api/schema.sql`: `projects` (`id TEXT PRIMARY KEY`, `sort`, one
   column per projects.json field, `tech` a JSON-array TEXT, optional fields
   NULL-able) and `career` (`id INTEGER PRIMARY KEY`, `sort`, one column per
   `CareerEntry` field, `note` and `end` NULL-able, `employment` CHECKed).
   A seed SQL file is generated from the bundled data, and a test fails when
   the two drift.
2. **`GET /content`** on beacon-api returns `{ projects, career }` ordered by
   `sort`, with the `/beacons` CORS rules (`ALLOWED_ORIGINS`) and
   `Cache-Control: public, max-age=300`. Read-only.
3. **The bundled data is the fallback**: offline, an empty or failing API, an
   old Worker without `/content`, and dev and e2e without `VITE_BEACON_API`.
4. **The data settles before the scene is built, and never changes during a
   visit.** *Replaced by the owner's loading call (option C, "Loading"
   below).* The first version used a cached payload at once and refreshed it
   in the background, and waited up to 1.5 s with no cache.
5. **The client validates every row** (types, `#rrggbb` colours, non-empty
   required strings, `tech` a string array). Bad rows are dropped with a
   `console.warn`; a list with no valid row falls back to the bundled list.
6. **Positions are derived, never stored.** Career buoys stay derived from the
   list, over a supported range of entries, with the spacing and clearance
   rules proven at both ends. Probes take slots from a pool of vetted slots,
   in `sort` order: today's three slots are unchanged, so today's three
   projects stay exactly where they are. Projects past the cap have no probe:
   they show in the résumé and the project list only, with a `console.warn`.
   Every count (HUD, logbook, keys) follows the probes in play.
7. **A probe's tint is its project's `color`**, as today.

## Behaviour

### Data flow

```
D1 (projects, career) ──► Worker GET /content ──► client
                                                   │ validate rows (drop bad ones)
                                                   │ per list: valid rows, or the bundled list
                                                   ▼
               settleContent() once, before App's modules load (main.tsx)
                                                   ▼
        constants.projects, PROBES (slot pool), BUOYS (trail), logbook, HUD
```

`main.tsx` imports only the content loader before it settles. `App` and the
debug bridge are imported dynamically after that, so every module that builds
a landmark from the data reads the settled content at its own module load,
exactly as it read the static imports before. Reading the content freezes it:
a later `settleContent` is refused with a warning, which is the "never moves
during a visit" guarantee in code.

### Loading (owner, 2026-10-23: option C)

The owner asked for the fetch to be part of the game's loading. Three options
were put to them:

- **A**, the fetch inside the canvas's loading readout as a
  `THREE.DefaultLoadingManager` item. **Declined:** the store, `App`, the HUD,
  the logbook, the destinations table and most scene components build their
  constants from the content when their modules load. Gating only the scene
  would mean about 25 files of module-load refactor, including the store's
  initial state, with real regression risk.
- **B**, keep the gate before `App` loads and only change the fetch policy.
- **C (chosen)**, B, plus the asset packs start in `main.tsx` beside the
  fetch, so the biggest download no longer waits for the content.

So (`src/main.tsx`, `src/utils/contentLoader.ts`, `src/utils/bootStep.ts`):

1. `main.tsx` starts the asset packs (`loadAssetPack()`) when the canvas will
   mount on the first render (WebGL, no résumé link), exactly the visits that
   downloaded them before. The packs never wait for the content, and the
   content never waits for the packs. Without packs (dev, e2e,
   `ASSET_PACK=0`) the call is the same settled no-op as before. To make this
   possible, `utils/hiResMaps.ts` no longer imports the store: the store
   registers its `isLowPerf` reader when it is created, and until then the
   answer is the store's own starting value (false), so the tier choice is
   unchanged. The WebGL and résumé checks moved from the store to
   `utils/flightGate.ts`.
2. Every visit fetches `/content` fresh, bounded by **4 s**. Fallback order:
   a fresh answer with at least one valid list → the last good payload
   (localStorage `fitz-content`, guarded) → the bundled data. A slow, failing
   (network, 404 from an old Worker, 503) or invalid answer falls back; a good
   answer is kept as the last good payload, even when it arrives after the
   timeout. `loadContent` never rejects.
3. The step shows on index.html's INITIALIZING overlay: "SYNCING MISSION
   DATA...", then "MISSION DATA: LIVE", "… LAST KNOWN" or "… ONBOARD". It
   always reaches a final line, and with no API configured it shows nothing.
4. The content settles, then `App` is imported, and its canvas shows the
   existing `LoadProgress` readout for the rest of the load, unchanged.

### Validation (`src/utils/contentParse.ts`)

Projects: `id` a slug (`^[a-z0-9][a-z0-9_-]{0,31}$`), unique, not a
destination id (`contact`, `career`, `shipyard`) and not a body id; `title`,
`role`, `duration`, `short`, `description` non-empty strings; `color`
`#rrggbb`; `tech` a non-empty array of non-empty strings, given as JSON text
(D1) or an array; `repo` absent/NULL or an `https://` URL.

Career: `role`, `company`, `location`, `summary` non-empty; `start` and
(optional) `end` in `Mon YYYY` form; `employment` `Full-time` or `Contract`;
`note` absent/NULL or non-empty. NULL becomes an absent field.

### Probes (`src/data/probes.ts`)

`PROBE_SLOTS` is the pool: six slots, each a home and seven remote spots. Slots
1–3 are today's coordinates, unchanged. Slots 4–6 were picked by search against
the same rules (see the build rulings). `assignProbes` gives the first six
projects (in `sort` order) slots 1–6. Six is the cap because the number keys
stop at 9 and the three destinations take three of them.

### Career trail (`src/data/careerTrail.ts`)

Supported: **1 to 12 entries**. The arc (`TRAIL_START` → `TRAIL_BEND` →
`TRAIL_END`) and the station do not move. Buoys sit at equal steps from
`TRAIL_START`, one step being `1 / max(n − 1, 4)` of the arc: five entries give
today's layout exactly, more entries close up (12 entries: ~15.6 u apart), and
fewer keep today's 43 u step and stop short of the arc's end, with the dashed
guide still running on to the station. Past 12, the newest twelve get buoys
(the résumé still lists every entry) and a `console.warn` says so.

## Out of scope

- An admin page or any write endpoint (owner).
- The `index.html` `<noscript>` summary and JSON-LD: they stay static, for
  crawlers and no-JS visitors, and are edited by hand.
- Per-project radio and logbook copy for new projects beyond what is derived
  from the row (see the build rulings).

## Build rulings (2026-10-23)

Decisions taken while building, where the brief was silent. They are the
implementer's calls.

- **R1, freeze on read.** `activeContent()` freezes the content the first time
  anything reads it; `settleContent` after that returns false and warns.
- **R2, the last good payload is the raw response**, not the parsed rows, so a
  later client with different rules re-validates it. Only an answer with at
  least one valid list is kept.
- **R3, the seed is non-destructive.** `INSERT OR IGNORE`, so re-running it
  never overwrites the owner's edits. Resetting to the bundled snapshot is a
  documented `DELETE` first.
- **R4, `sort` steps of 10** in the seed, so a row can go between two others
  without renumbering.
- **R5, CHECKs in the schema** for what the console can catch early:
  `employment`, the colour pattern and `tech` being a JSON array. The client
  still validates everything.
- **R6, the Worker caches the content for 60 s per isolate** (the beacon list
  does the same for 30 s), and `/content` counts against the per-pilot
  `LIMITER` like any other request. A D1 error answers 503, so the client
  falls back.
- **R7, the buoy step** is `1 / max(n − 1, 4)` (above). Gaps are at least 15 u
  (a buoy card is 6 u across) and at most 43 u, inside the ≤ 50 u rule. The
  old "at least 20 apart" rule holds up to 9 entries.
- **R8, two readers of the probe spots.** Crystal spawn keep-outs
  (`CRYSTAL_LANDMARKS`) and the clearance tests use all six slots, whatever
  the data, so the world outside the probes never depends on the content. The
  warp limit (`WARP_LANDMARKS`, Spaceship's cruise spheres) uses only the
  probes in play: an empty slot must not throttle the warp, and with the
  bundled three projects the set is exactly the one it always was (whole-branch
  review, 2026-10-23).
- **R9, logbook wording is derived** from the project title: "Read the
  ⟨title⟩ dossier", "GRAB THE ⟨TITLE⟩ PROBE (HOLD F)", and a short hint of the
  longest tail of the title's words that fits 18 characters with " PROBE"
  (else "PROBE ⟨n⟩"). A leading "This" or "The" is dropped. Today's three
  entries come out word for word as before.
- **R10, radio pools** stay hand-written per id; a probe with no pool gets one
  line, "⟨ID⟩ PROBE IN RANGE // ⟨short⟩".
- **R11, the sector list colours** come from the project colour (they were
  per-id Tailwind classes of the same three colours).
- **R12, the gamepad** d-pad still reaches the first three probes and the
  career station. With fewer probes the missing directions do nothing; probes
  4–6 are reached by flying or with the HUD rows.
- **R13, a project past the cap** keeps its résumé entry and its dossier id
  (`openDossier` accepts any project id), but has no probe, no jump key and no
  logbook entry, so the dossier count is "probe dossiers read".
