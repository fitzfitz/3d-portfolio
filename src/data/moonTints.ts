/**
 * Per-moon tints, multiplied over moon.glb's neutral bakes by OrbitingMoon in
 * SpacePlanets.tsx. Kept at low saturation (HSL s <= 25%, same hue as before)
 * so a moon reads as rock or ice catching a hint of its planet's colour. The
 * old fully saturated tints made the ice moon beside Fuxx look like a small
 * planet, and visitors try to fly to anything that looks like a planet.
 */
export const MOON_TINTS = {
  ruangrapiRock: "#c5dccf",
  portfolioIce: "#cad9df",
  portfolioRock: "#cad9df",
  fuxxVolcanic: "#e0d7e7",
  fuxxIce: "#d4cde1",
} as const;
