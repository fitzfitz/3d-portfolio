/**
 * Lens glare around the sun. Vacuum has no medium to scatter light into
 * visible beams (L21), so there are no god rays; but a camera lens does
 * scatter and diffract bright sources, which is real (L22): a veiling glare
 * near the sun's screen position and diffraction spikes that reach further.
 */
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function glareLevels(
  ndcX: number,
  ndcY: number,
  inFront: boolean,
  visibility: number,
  flare: number,
  /** Reused result, so a frame loop allocates nothing. */
  out: { spikes: number; veil: number } = { spikes: 0, veil: 0 },
): { spikes: number; veil: number } {
  if (!inFront) { out.spikes = 0; out.veil = 0; return out; }
  const k = visibility * (1 + 0.5 * Math.min(flare, 1));
  const off = Math.hypot(ndcX, ndcY);
  const v = clamp01(1 - off / 0.9);
  out.spikes = k * clamp01(1 - off / 1.6);
  out.veil = 0.35 * k * v * v;
  return out;
}
