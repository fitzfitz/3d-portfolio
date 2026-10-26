# Split spaceStore into slices (design)

**Date:** 2026-10-26.
**Status:** scope agreed with the owner ("cool go"). The design calls are the controller's.
**Plan:** `docs/superpowers/plans/2026-10-26-store-split.md`.

## Why

`src/store/spaceStore.ts` is 794 lines and holds:
- 49 fields and 41 actions across 8 unrelated groups;
- four non-React per-frame objects;
- about 20 localStorage loaders.

The coming combat stage adds a lot of game state (health, enemies, shots, coins). That state needs a clean place to land, and the existing groups need clear owners.

This is a **behaviour-preserving refactor**. Nothing a visitor sees or does changes.

## Out of scope

Moving the content-derived layout constants (PROBES, BUOYS, LOGBOOK and so on) off module load is out of scope. The owner agreed to drop it: the boot gate (PR #59) already makes them correct, and combat spawns are runtime. It gets a note in `docs/FOLLOW-UPS.md` in case content ever needs to change mid-visit.

## Design

1. **One store, composed from slices.** `useSpaceStore` stays a single zustand store with the same `SpaceState` shape, the same field and action names, and the same selectors. It is built from slice creators, using zustand's slices pattern.
   - Every consumer (45 src files, 9 test files, the e2e harness paths `/src/store/spaceStore.ts`) keeps working unchanged.
   - No consumer is edited in this refactor.
2. **Slices**, one file each in `src/store/slices/`. Each slice owns its state type, actions and initial values (including its localStorage loads):

   | Slice file | Contents |
   |---|---|
   | `flight.ts` | Orbit and dock: activeZone, isOrbitLocked, isOrbitCooldown, isWarping, isNearSpawn, isTeleporting, fuelEmpty, jumpRequest, impactCount, plus their actions and the module timers |
   | `dossier.ts` | openDossier, dossierVia, visitedDossiers, probeSpots, relocation, probeNear, probeTip, and their actions |
   | `hud.ts` | showClassicCV, canvasEpoch, photoMode, padConnected, scanTarget, logbookOpen, changelogOpen, beaconPickerOpen, broadcast, cometNear, worldEvent; sendBroadcast; start/endWorldEvent |
   | `logbook.ts` | badges, plumeColor, logbookLineAt; recordBadge, setPlumeColor, announceLogbook |
   | `progress.ts` | Shards, charting (charted, legacyCartographer, chartShoutAt, aurumTold, chartWorld, clearChartShout, tellAurumOnce) and race |
   | `sky.ts` | beacons, ownBeacons, liveSky, liveSkySeen, and their actions |
   | `settings.ts` | isLowPerf, lowPerfManual, pendingLowPerf, warmingUp, sceneReady, reducedMotion, reducedMotionManual, changelogSeen; isMuted (audio is small, so it lives here) |

   The builder may merge two tiny slices if the split reads worse. Record why.
3. **Cross-slice actions stay explicit.** An action that touches another group calls that group's action through `get()`. It never writes the other slice's fields directly, except where it does so today. In that case keep it, and list it in a "cross-slice writes" comment block at the top of `spaceStore.ts`.
   - `setOrbitLocked` → `recordBadge`
   - `recordBadge` → `announceLogbook` → `sendBroadcast`
   - `setShowClassicCV` and `remountCanvas` → `breakOrbit` + `closeDossier`
   - `chartWorld` → `announceLogbook`
   - `openProjectDossier` touches `isWarping`
   - `setPlumeColor` reads progress and dossier state
   - `startWorldEvent` → `sendBroadcast`
4. **Per-frame objects move to their own modules and are re-exported from `spaceStore.ts`:**
   - `src/store/flightState.ts` holds `flight`.
   - `src/store/bodies.ts` holds `bodies`.
   - `src/store/crystalSlots.ts` holds `crystalSlots`.
   - `src/store/worldClock.ts` holds `worldClock` and `worldEventElapsed`.
   - Importers keep importing from `spaceStore`.
   - Mutable object identity must be unchanged: same object, same fields.
5. **localStorage helpers** (`load*`, the save helpers, `todayStamp`) move to `src/store/persist.ts` and are re-exported where tests import them. Every `fitz-*` key and format is unchanged.
6. **Module-load behaviour is unchanged.** Initial state still reads storage and content at import, exactly as today. `tests/spaceStore.test.ts` (resetModules plus dynamic import) must pass unmodified.
7. **The boot gate holds.** No new file under `src/store/` may be reachable from `main.tsx`'s static graph, or from the asset-pack graph. `tests/bootOrder.test.ts` and `tests/labBoot.test.ts` pass unmodified.

## Acceptance

- `spaceStore.ts` is a short composition file of roughly 150 lines or fewer, plus the re-exports and the cross-slice comment block.
- **An API-shape guard test.** The full set of store keys (fields and action names) equals a pinned list taken from today's store. Every re-export that exists today still exists.
- Every existing test passes unmodified: unit tests, the full e2e suite, and the source-text scans that read store paths. The only allowed exception is a test that imports a helper whose module moved, and only if a re-export can't serve it. Record it.
- `npm run build`, `npx vitest run` and `npm run test:e2e` pass in the main checkout.
- No change to React render counts (`__fitz.renderCount` in the perf and smoke probes).
- A changelog entry, "Behind the scenes", and the FOLLOW-UPS note about the deferred layout change.
