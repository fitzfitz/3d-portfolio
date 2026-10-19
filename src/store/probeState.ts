import { PROBES } from "../data/probes";
import { loadProbeSpots, spotPos } from "../utils/probes";

/**
 * Per-frame probe state, mutable outside React like `bodies`. ProjectProbes
 * (the writer) moves `probePos` while a probe is pulled or relocating; the
 * ship, beam and HUD read it. Initialised from the persisted spots so a reload
 * starts each probe where the visitor left it.
 */
function readSpots(): Record<string, number> {
  let raw: unknown = null;
  try {
    const s = localStorage.getItem("fitz-probes");
    raw = s === null ? null : JSON.parse(s);
  } catch {
    raw = null;
  }
  return loadProbeSpots(raw);
}

const spots = readSpots();

export const probePos: Record<string, { x: number; y: number; z: number }> = Object.fromEntries(
  PROBES.map((def) => {
    const [x, y, z] = spotPos(def, spots[def.id]);
    return [def.id, { x, y, z }] as const;
  }),
);

/** True while a probe's relocation burn plays. */
export const probeRelocating: Record<string, boolean> = Object.fromEntries(PROBES.map((def) => [def.id, false] as const));
