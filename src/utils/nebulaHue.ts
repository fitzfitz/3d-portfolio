/** Sine-drifted hue in degrees, wrapped to [0, 360). Default: ±25° over 3 minutes. */
export function driftedHue(
  baseHue: number,
  tSeconds: number,
  amplitudeDeg = 25,
  periodSeconds = 180
): number {
  const drift = amplitudeDeg * Math.sin((tSeconds / periodSeconds) * Math.PI * 2);
  return ((baseHue + drift) % 360 + 360) % 360;
}
