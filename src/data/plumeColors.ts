/**
 * Engine-plume colours unlocked by logbook badges (spec §5). `stock` is the
 * engine's cyan: the plume shader's original vec3(0, 0.85, 1). Applied as
 * uniform/CPU colour changes only (Spaceship.tsx), so no shader programs are
 * added. Tuned against bloom in the real-browser pass.
 */
export const PLUME_COLORS: Readonly<Record<string, { name: string; hex: string }>> = {
  stock: { name: "CYAN", hex: "#00d9ff" },
  slingshot: { name: "GOLD", hex: "#ffc23d" },
  comet: { name: "ICE", hex: "#9fe8ff" },
  ring: { name: "MAGENTA", hex: "#ff3df0" },
  ore: { name: "AMBER", hex: "#ff8a1f" },
  convoy: { name: "LIME", hex: "#a6ff3d" },
  shards: { name: "VIOLET", hex: "#a77bff" },
  // Not a badge: the survey's reward for charting all five worlds (utils/charting.ts).
  cartographer: { name: "AURUM", hex: "#ffe9a3" },
};

export function hasPlumeColour(id: string): boolean {
  return Object.hasOwn(PLUME_COLORS, id);
}

/** The spark vertex-colour base for a plume: the colour scaled so its brightest channel is 1. */
export function sparkBase(hex: string, out: [number, number, number]): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const m = Math.max(r, g, b) || 1;
  out[0] = r / m; out[1] = g / m; out[2] = b / m;
  return out;
}
