# Store split: implementation plan

**Spec:** `docs/archive/specs/2026-10-26-store-split-design.md`.

**Goal:** split `src/store/spaceStore.ts` into slices. This is a behaviour-preserving refactor: no consumer edits, an identical store API, and identical persisted keys.

**Approach:**
- One implementer, working in staged commits, one commit per step below.
- The full existing test suite is the safety net. Run it after every step.
- One final review, then the full e2e.

**Input map:** `refactor-map.md` (in the scratchpad) lists every field, action, importer and test that touches the store.

## Global constraints
- `useSpaceStore`'s shape stays exactly the same: every field and action name, plus `selectSceneFrozen` and `selectModalOpen`.
- Every current export of `spaceStore.ts` is still exported from it.
- No consumer file outside `src/store/` changes. The only exception is a test that imports a moved helper and can't be served by a re-export; record it.
- Every `fitz-*` localStorage key and format is unchanged, and so is the import-time initial-state behaviour.
- Mutable per-frame objects (`flight`, `bodies`, `crystalSlots`, `worldClock`) keep their identity.
- `tests/spaceStore.test.ts`, `tests/bootOrder.test.ts` and `tests/labBoot.test.ts` pass **unmodified**.
- No new file is reachable from `src/main.tsx`'s static import graph, or from `utils/assetPack`'s.
- No per-frame allocation or render-count change. The HUD rule (no React re-renders during flight) is unchanged.

## Steps (one commit each; the suite stays green after each)
1. **Guard first.** Add `tests/storeShape.test.ts`. It pins:
   - the sorted list of `Object.keys(useSpaceStore.getState())`, taken from today's store;
   - the list of named exports of `src/store/spaceStore.ts`.

   It must pass on the unmodified store.
2. **Move the persistence helpers** (the `load*`/`save` helpers, `todayStamp`, the key constants) to `src/store/persist.ts`. Re-export them from `spaceStore.ts`.
3. **Move the per-frame objects** to `src/store/flightState.ts`, `bodies.ts`, `crystalSlots.ts` and `worldClock.ts`. Re-export them.
4. **Low-coupling slices:** `settings.ts` (including isMuted) and `sky.ts`.
5. **HUD and logbook slices:** `hud.ts` and `logbook.ts`, with recordBadge → announceLogbook → sendBroadcast through `get()`.
6. **`progress.ts`:** shards, charting and race.
7. **`flight.ts` and `dossier.ts`.** Cross-slice: setOrbitLocked → recordBadge; setShowClassicCV and remountCanvas → breakOrbit + closeDossier; openProjectDossier sets isWarping.
8. **Compose.** `spaceStore.ts` composes the slices, keeps the re-exports and selectors, and opens with a comment block listing the cross-slice actions and writes. Target: about 150 lines or fewer.
9. **Wrap up:**
   - add a `docs/FOLLOW-UPS.md` note: layout constants stay built at module load (the boot gate makes them correct); revisit only if content must change mid-visit;
   - add changelog entry #62, "Behind the scenes" (check the next free PR number);
   - run the full `npx vitest run` and `npm run build`.

The controller runs the full e2e in the main checkout.
