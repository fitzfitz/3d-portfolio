# Projects and career from D1: implementation plan

**Spec:** `docs/archive/specs/2026-10-23-dynamic-content-design.md`.
**Branch:** `feat/dynamic-content`, one PR (the next free number is **#59**).

## Ground rules
- Nothing remote: no deploy, no `d1 --remote`, no push. The owner's deploy
  steps go in the PR description: schema, seed, Worker, then the site.
- The new site must work against the old Worker (404 on `/content` → bundled).
- `npm run build` before calling it done (its `tsc -b` checks `tests/`).
- Frame loops stay allocation-free; nothing here touches them.

## Fixed-count assumptions to remove (found by search)
- `src/data/probes.ts`: three probes keyed by id → a slot pool.
- `src/utils/logbook.ts`: three hard-coded dossier essentials.
- `src/App.tsx`: "Three probes carry three projects."
- `src/utils/gamepad.ts`: `PROBE_IDS[0..2]` on the d-pad.
- `src/components/layout/HUDOverlay.tsx`: per-id `ZONE_COLORS`; dossier count
  from `visitedDossiers.length`.
- `src/data/chatterLines.ts`: per-id pools only.
- `src/data/careerTrail.ts`: buoys spread over the whole arc for any count.
- `src/utils/crystalField.ts`: keep-outs from the probes in play.
- Number keys 1–9 (`App.tsx`): 6 probes + 3 destinations is the most that fits.
- Tests pinning the bundled data (`probes`, `careerTrail`, `logbook`,
  `destinations`, `jellyfishPath`, the clearance helper).

## Tasks (test first)

1. **Bundled snapshot and the settled content.** `src/data/content.ts`
   (`BUNDLED_CONTENT`, `settleContent`, `activeContent`, freeze on read).
   `career.ts` keeps the type and the bundled list (`BUNDLED_CAREER`);
   `constants.projects` and the career consumers read `activeContent()`.
   Test: freeze on read, a second settle refused.
2. **Validation.** `src/utils/contentParse.ts` `parseContent(raw)`. Tests: the
   bundled data passes untouched; each rule drops its row with a warning; an
   empty or invalid list falls back; D1 NULLs and JSON-text `tech` parse.
3. **Loader.** `src/utils/contentLoader.ts` `loadContent(deps)` with injected
   fetch, storage and timer. After the owner's loading call (option C): fresh
   first (4 s), then the last good payload, then bundled; the overlay step
   (`bootStep.ts`) always ends; the asset packs start in `main.tsx` (hiResMaps
   decoupled from the store). Tests: each failure path in that order, the step
   always resolving, the pack module graph store-free.
4. **main.tsx boot order.** Settle first, then `import("./App")` and the debug
   bridge. Test: the static import graph of `main.tsx` never reaches a module
   that reads the content.
5. **Career trail over 1–12.** `buildBuoys(career)`, `MAX_BUOYS = 12`. Tests at
   n = 1, 2, 4, 5, 9, 12, 13: gaps, on the arc, climbing, first buoy in the
   opening view, n = 5 identical to today, clearance of every possible buoy
   position.
6. **Probe slots.** Search three new slots against the clearance rules
   (scratch search, not committed); `PROBE_SLOTS`, `MAX_PROBES`,
   `assignProbes(ids)`. Tests: slots 1–3 unchanged, every slot vetted, a
   project past the cap gets no probe and a warning, keys ≤ 9.
7. **Counts and copy.** Logbook essentials from the probes (derived wording),
   HUD dossier count and colours, spawn-card line, gamepad, radio pools,
   crystal keep-outs from all slots.
8. **Worker.** `beacon-api/content.sql` (schema), `beacon-api/src/content.ts`
   (`handleContent`, cache, CORS), route in `index.ts`. Tests in
   `tests/contentApi.test.ts`.
9. **Seed.** `beacon-api/src/contentSeed.ts` `contentSeedSql(projects, career)`,
   `scripts/content-seed.mjs` writes `beacon-api/content-seed.sql`, a test
   checks the committed file equals the generator's output for the bundled
   data. Local check: `wrangler d1 execute --local` both files, `wrangler dev
   --local`, `curl /content`, parse it with the client validator.
10. **e2e.** `tests/e2e/content.probe.mjs`: a mocked `/content` with a fourth
    project and three jobs shows up (probe, HUD row, keys, buoys); the cached
    payload wins on the next load; a failing API keeps today's layout.
11. **Docs.** Changelog entry (#59), README data sections, `beacon-api/README.md`
    "Editing the content in D1".
12. **Verify.** `npx vitest run`, `npx tsc -b`, `npm run build`, the new e2e
    probe alone.
