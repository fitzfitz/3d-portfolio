import type { OsculatingElements } from "../utils/ephemeris";

/**
 * Osculating elements from the JPL Small-Body Database API, fetched 2026-10-20:
 *   https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1&full-prec=1     (Ceres)
 *   https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=2P&full-prec=1    (2P/Encke)
 *   https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=67P&full-prec=1   (67P/Churyumov-Gerasimenko)
 * J2000 ecliptic, heliocentric. Epoch and elements as returned; held fixed
 * (pure two-body). a in AU; i, node (om), argPeri (w), M0 (ma) in degrees;
 * n in degrees per day.
 */
export const CERES: OsculatingElements = {
  epochJd: 2461200.5,
  a: 2.765552595034094,
  e: 0.07969229514816586,
  i: 10.58802780183462,
  node: 80.24862682043221,
  argPeri: 73.29421453021587,
  M0: 274.4193463761342,
  nDegPerDay: 0.21430445064843,
};

export const ENCKE: OsculatingElements = {
  epochJd: 2460363.5,
  a: 2.218624763741819,
  e: 0.846940430888432,
  i: 11.33675914978793,
  node: 334.0171400057891,
  argPeri: 187.2881998732444,
  M0: 36.82518175471338,
  nDegPerDay: 0.2982485147796727,
};

export const CHURYUMOV: OsculatingElements = {
  epochJd: 2457305.5,
  a: 3.462249490129549,
  e: 0.6409081308996354,
  i: 7.040294937543767,
  node: 50.13557377155012,
  argPeri: 12.79824970228189,
  M0: 8.859927425218402,
  nDegPerDay: 0.1529912291873851,
};
