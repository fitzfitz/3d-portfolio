import { IO_HOT_SPOTS } from "../data/ioHotSpots";

/**
 * Io's glow mask (spec §5.5, L33): the catalogued hot spots
 * (data/ioHotSpots.ts) as Gaussian glows of their relative power, summed and
 * held to 1, laid out like the Io map (scripts/textures/process_body_maps.mjs:
 * east-positive, -180° at u = 0, the prime meridian at u = 0.5), so the
 * emissive map lines up with the surface it lights. SolarMoons uploads it as
 * Io's emissive map; nightGlow.ts keeps it to the night side and eclipses.
 */

/** The mask's size: 0.7° a texel, finer than the smallest glow's σ (1.6°). */
export const IO_GLOW_SIZE = [512, 256] as const;

const D2R = Math.PI / 180;
const SPOTS = IO_HOT_SPOTS.map((s) => {
  const lat = s.latDeg * D2R, lonE = -s.lonWDeg * D2R;
  return {
    x: Math.cos(lat) * Math.cos(lonE), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lonE),
    power: s.power, k: 1 / (2 * (s.sigmaDeg * D2R) ** 2),
    // Past 4σ a glow is under 0.04% of its peak: skipped.
    cosReach: Math.cos(4 * s.sigmaDeg * D2R),
  };
});

/** The glow (0..1) at planetographic latitude `latDeg`, east longitude `lonEDeg`. */
export function ioGlowAt(latDeg: number, lonEDeg: number): number {
  const lat = latDeg * D2R, lon = lonEDeg * D2R;
  const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
  let v = 0;
  for (const s of SPOTS) {
    const c = x * s.x + y * s.y + z * s.z;
    if (c < s.cosReach) continue;
    const a = Math.acos(Math.min(1, c));
    v += s.power * Math.exp(-a * a * s.k);
  }
  return Math.min(1, v);
}

let cached: Uint8Array | null = null;

/**
 * The mask, one byte a texel, row 0 the south (a DataTexture is not flipped,
 * so v = 0 is the bottom row and the south pole of THREE.SphereGeometry).
 * Computed once.
 */
export function ioGlowMask(): Uint8Array {
  if (cached) return cached;
  const [w, h] = IO_GLOW_SIZE;
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const lat = -90 + ((j + 0.5) / h) * 180;
    for (let i = 0; i < w; i++) {
      const lonE = ((i + 0.5) / w - 0.5) * 360;
      out[j * w + i] = Math.round(255 * ioGlowAt(lat, lonE));
    }
  }
  return (cached = out);
}
