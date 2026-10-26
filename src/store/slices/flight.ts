import { PROBE_IDS } from "../../data/probes";
import { destinationById } from "../../data/destinations";
import type { SliceCreator } from "../spaceStore";

/** Orbit and dock, warp, the spawn pad, the teleport flash, fuel-out, jumps and impacts. */
export interface FlightSlice {
  activeZone: string | null;
  setActiveZone: (z: string | null) => void;
  isOrbitLocked: boolean;
  setOrbitLocked: (v: boolean) => void;
  isOrbitCooldown: boolean;
  breakOrbit: () => void;
  isWarping: boolean;
  setWarping: (v: boolean) => void;
  isNearSpawn: boolean;
  setNearSpawn: (v: boolean) => void;
  isTeleporting: boolean;
  triggerTeleportFlash: () => void;
  fuelEmpty: boolean;
  setFuelEmpty: (v: boolean) => void;
  /**
   * Pending jump to a planet id or a destination id (src/data/destinations.ts),
   * consumed by Spaceship's frame loop. `seq` makes a repeat request for the
   * same target a new value.
   */
  jumpRequest: { id: string; seq: number } | null;
  requestJump: (id: string) => void;
  impactCount: number;
  bumpImpact: () => void;
}

// Module-level timeout handles for cancellation on re-entry
let orbitCooldownTimer: ReturnType<typeof setTimeout> | null = null;
let teleportFlashTimer: ReturnType<typeof setTimeout> | null = null;

/** Cross-slice: setOrbitLocked records the destination's badge through the logbook slice's recordBadge. */
export const createFlightSlice: SliceCreator<FlightSlice> = (set, get) => ({
  activeZone: null,
  // Guarded setters: these are called from frame loops, so bail without
  // notifying when the value hasn't changed.
  setActiveZone: (z) => { if (get().activeZone !== z) set({ activeZone: z }); },
  isOrbitLocked: false,
  // Locking freezes the frame loop (selectSceneFrozen), so the ship can no
  // longer clear isWarping itself — clear it here or the warp drone and the
  // HUD's "ACTIVE" line outlive the boost for as long as the dossier is open.
  setOrbitLocked: (v) => {
    if (get().isOrbitLocked === v) return;
    if (!v) { set({ isOrbitLocked: false }); return; }
    const zone = get().activeZone;
    set({ isOrbitLocked: true, isWarping: false });
    // Logbook essential: docking at a destination records the badge named
    // after it (recordBadge ignores ids the logbook does not list).
    const dest = destinationById(zone);
    if (dest) get().recordBadge(dest.id);
  },
  isOrbitCooldown: false,
  breakOrbit: () => {
    if (orbitCooldownTimer) clearTimeout(orbitCooldownTimer);
    set({ isOrbitLocked: false, activeZone: null, isOrbitCooldown: true });
    orbitCooldownTimer = setTimeout(() => set({ isOrbitCooldown: false }), 1800);
  },
  isWarping: false,
  setWarping: (v) => { if (get().isWarping !== v) set({ isWarping: v }); },
  isNearSpawn: true,
  setNearSpawn: (v) => { if (get().isNearSpawn !== v) set({ isNearSpawn: v }); },
  isTeleporting: false,
  triggerTeleportFlash: () => {
    if (teleportFlashTimer) clearTimeout(teleportFlashTimer);
    set({ isTeleporting: true });
    teleportFlashTimer = setTimeout(() => set({ isTeleporting: false }), 380);
  },
  fuelEmpty: false,
  // Change-guarded: called from a frame loop, so it must not notify unless the
  // value actually flipped.
  setFuelEmpty: (v) => { if (get().fuelEmpty !== v) set({ fuelEmpty: v }); },
  jumpRequest: null,
  requestJump: (id) => {
    if (!destinationById(id) && !PROBE_IDS.includes(id)) return;
    set({ jumpRequest: { id, seq: (get().jumpRequest?.seq ?? 0) + 1 } });
  },
  impactCount: 0,
  bumpImpact: () => set({ impactCount: get().impactCount + 1 }),
});
