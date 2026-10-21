import type { JplPlanetElements } from "../utils/ephemeris";

/**
 * Keplerian elements and rates for the eight planets, copied verbatim from
 * JPL SSD "Approximate Positions of the Planets" (E.M. Standish and
 * J.G. Williams), Table 2a (valid 3000 BC to 3000 AD, mean ecliptic and
 * equinox of J2000) and Table 2b (extra mean-anomaly terms, Jupiter to Neptune).
 *   https://ssd.jpl.nasa.gov/planets/approx_pos.html
 * Fetched 2026-10-20. Each pair is [value at J2000, rate per Julian century]:
 * a in AU, e dimensionless, I / L / varpi (long. of perihelion) / Omega
 * (long. of ascending node) in degrees.
 *
 * Earth is the "EM Bary" row (the Earth-Moon barycentre).
 *
 * Table 2b: M = L - varpi + b*T^2 + c*cos(f*T) + s*sin(f*T), T in Julian
 * centuries past J2000. The page does not state the unit of f and its linked
 * "related document" (the Keplerian elements PDF) is not linked from the page
 * and was unreachable (404 at the obvious paths), so nothing was read there.
 * f*T is taken in degrees (as for every other angle); this is confirmed
 * empirically: with degrees, planetEcliptic matches JPL Horizons within the
 * published accuracy (tests/ephemeris.test.ts).
 *
 * Past 3000 AD (T > JPL_HELD_AFTER_T) the elements are held; see ephemeris.ts.
 */
export const JPL_HELD_AFTER_T = 10;

export const JPL_PLANETS: Record<
  "mercury" | "venus" | "earth" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune",
  JplPlanetElements
> = {
  mercury: {
    a: [0.38709843, 0.0],
    e: [0.20563661, 0.00002123],
    I: [7.00559432, -0.00590158],
    L: [252.25166724, 149472.67486623],
    varpi: [77.45771895, 0.15940013],
    Omega: [48.33961819, -0.12214182],
  },
  venus: {
    a: [0.72332102, -0.00000026],
    e: [0.00676399, -0.00005107],
    I: [3.39777545, 0.00043494],
    L: [181.9797085, 58517.8156026],
    varpi: [131.76755713, 0.05679648],
    Omega: [76.67261496, -0.27274174],
  },
  earth: {
    a: [1.00000018, -0.00000003],
    e: [0.01673163, -0.00003661],
    I: [-0.00054346, -0.01337178],
    L: [100.46691572, 35999.37306329],
    varpi: [102.93005885, 0.3179526],
    Omega: [-5.11260389, -0.24123856],
  },
  mars: {
    a: [1.52371243, 0.00000097],
    e: [0.09336511, 0.00009149],
    I: [1.85181869, -0.00724757],
    L: [-4.56813164, 19140.29934243],
    varpi: [-23.91744784, 0.45223625],
    Omega: [49.71320984, -0.26852431],
  },
  jupiter: {
    a: [5.20248019, -0.00002864],
    e: [0.0485359, 0.00018026],
    I: [1.29861416, -0.00322699],
    L: [34.33479152, 3034.90371757],
    varpi: [14.27495244, 0.18199196],
    Omega: [100.29282654, 0.13024619],
    extra: { b: -0.00012452, c: 0.0606406, s: -0.35635438, f: 38.35125 },
  },
  saturn: {
    a: [9.54149883, -0.00003065],
    e: [0.05550825, -0.00032044],
    I: [2.49424102, 0.00451969],
    L: [50.07571329, 1222.11494724],
    varpi: [92.86136063, 0.54179478],
    Omega: [113.63998702, -0.25015002],
    extra: { b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125 },
  },
  uranus: {
    a: [19.18797948, -0.00020455],
    e: [0.0468574, -0.0000155],
    I: [0.77298127, -0.00180155],
    L: [314.20276625, 428.49512595],
    varpi: [172.43404441, 0.09266985],
    Omega: [73.96250215, 0.05739699],
    extra: { b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025 },
  },
  neptune: {
    a: [30.06952752, 0.00006447],
    e: [0.00895439, 0.00000818],
    I: [1.7700552, 0.000224],
    L: [304.22289287, 218.46515314],
    varpi: [46.68158724, 0.01009938],
    Omega: [131.78635853, -0.00606302],
    extra: { b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025 },
  },
};
