import { WORLDS } from "../../data/worlds";
import { orbitPosition } from "../../utils/orbits";
import { setScannable } from "../../utils/scannables";
import { setOccluder, worldSlot } from "./sunShadow";

/** Fixed per world, computed once: the frame loop allocates nothing. */
const WORLD_SLOTS = WORLDS.map((w) => worldSlot(w.id));
const WORLD_LABELS = WORLDS.map((w) => "WORLD_" + w.name);
const orbitScratch = { x: 0, y: 0, z: 0 };

/**
 * SpaceWorlds' frame drive: each world's orbit position into `out[w.id]`
 * (in place), its scannable (measured from its surface), and its occluder
 * slot, if it has one, at its equatorial radius. The outermost world has no
 * GPU slot (sunShadow.ts); the CPU lists read it from `bodies`.
 */
export function updateWorlds(t: number, out: Record<string, { x: number; y: number; z: number }>): void {
  for (let i = 0; i < WORLDS.length; i++) {
    const w = WORLDS[i];
    const p = orbitPosition(w.orbit, t, orbitScratch);
    const b = out[w.id];
    b.x = p.x; b.y = p.y; b.z = p.z;
    setScannable(w.id, p.x, p.y, p.z, WORLD_LABELS[i], w.size);
    if (WORLD_SLOTS[i] >= 0) setOccluder(WORLD_SLOTS[i], p.x, p.y, p.z, w.size);
  }
}
