import { AU } from "../constants";
import { JPL_HELD_AFTER_T } from "../data/jplElements";

export { JPL_HELD_AFTER_T, JPL_PLANETS } from "../data/jplElements";
export { CERES, ENCKE, CHURYUMOV } from "../data/smallBodies";

/**
 * Real-sky ephemeris (docs/superpowers/specs/2026-10-20-real-solar-system-design.md §4).
 * Planets follow JPL's "Approximate Positions of the Planets" Table 2a step list;
 * small bodies are pure two-body Kepler orbits from osculating SBDB elements.
 * Pure functions, no scene imports; allocation-free when `out` is given.
 */

export const JD_J2000 = 2451545.0;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
const D2R = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export const jdFromUnixMs = (ms: number): number => ms / MS_PER_DAY + UNIX_EPOCH_JD;
export const unixMsFromJd = (jd: number): number => (jd - UNIX_EPOCH_JD) * MS_PER_DAY;

/** Heliocentric position in AU, J2000 ecliptic (x to the equinox, z to ecliptic north). */
export interface Ecl { x: number; y: number; z: number }

/** [value at J2000, rate per Julian century]; degrees and AU. */
export interface JplPlanetElements {
  a: [number, number];
  e: [number, number];
  I: [number, number];
  L: [number, number];
  varpi: [number, number];
  Omega: [number, number];
  /** Table 2b: M += b·T² + c·cos(f·T) + s·sin(f·T), f·T in degrees. */
  extra?: { b: number; c: number; s: number; f: number };
}

/** SBDB osculating elements: AU, degrees, degrees per day; epoch as a Julian date. */
export interface OsculatingElements {
  epochJd: number;
  a: number;
  e: number;
  i: number;
  node: number;
  argPeri: number;
  M0: number;
  nDegPerDay: number;
}

/** Kepler's equation E − e·sin E = M (radians), Newton iteration to machine precision. */
export function solveKepler(M: number, e: number): number {
  // Wrap M into (-π, π]
  let m = M % TWO_PI;
  if (m > Math.PI) m -= TWO_PI;
  else if (m <= -Math.PI) m += TWO_PI;
  // Starting guess: JPL's M + e·sin M; for high e, start at ±π so Newton cannot overshoot.
  let E = e < 0.8 ? m + e * Math.sin(m) : m < 0 ? -Math.PI : Math.PI;
  for (let i = 0; i < 50; i++) {
    const dE = (m - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-15) break;
  }
  return E;
}

/** In-plane position from E, rotated by ω, then I, then Ω (angles in radians). */
function rotate(
  a: number, e: number, E: number, w: number, I: number, Om: number, out: Ecl,
): Ecl {
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w);
  const cO = Math.cos(Om), sO = Math.sin(Om);
  const cI = Math.cos(I), sI = Math.sin(I);
  out.x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  out.y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  out.z = sw * sI * xp + cw * sI * yp;
  return out;
}

/**
 * JPL Table 2a / 2b position. Past JPL_HELD_AFTER_T (3000 AD) every element and the
 * Table 2b terms use the clamped T; only the mean longitude L keeps advancing.
 */
export function planetEcliptic(el: JplPlanetElements, jd: number, out: Ecl): Ecl {
  const T = (jd - JD_J2000) / 36525;
  const Tc = T > JPL_HELD_AFTER_T ? JPL_HELD_AFTER_T : T;
  const e = el.e[0] + el.e[1] * Tc;
  const varpi = el.varpi[0] + el.varpi[1] * Tc;
  const Om = el.Omega[0] + el.Omega[1] * Tc;
  const L = el.L[0] + el.L[1] * T;
  let M = L - varpi;
  const x = el.extra;
  if (x) M += x.b * Tc * Tc + x.c * Math.cos(x.f * Tc * D2R) + x.s * Math.sin(x.f * Tc * D2R);
  const E = solveKepler(M * D2R, e);
  return rotate(el.a[0] + el.a[1] * Tc, e, E, (varpi - Om) * D2R, (el.I[0] + el.I[1] * Tc) * D2R, Om * D2R, out);
}

/** Two-body position of a small body from its osculating elements. */
export function osculatingEcliptic(el: OsculatingElements, jd: number, out: Ecl): Ecl {
  const M = (el.M0 + el.nDegPerDay * (jd - el.epochJd)) * D2R;
  const E = solveKepler(M, el.e);
  return rotate(el.a, el.e, E, el.argPeri * D2R, el.i * D2R, el.node * D2R, out);
}

/** Ecliptic (x, y, z) to world (x, z, −y), scaled to scene units. A proper rotation. */
export function eclipticToWorld(
  v: Ecl,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const x = v.x * AU, y = v.y * AU, z = v.z * AU;
  out.x = x;
  out.y = z;
  out.z = 0 - y; // not -y: keeps +0 rather than -0 on the x axis
  return out;
}

/** Orbit geometry for drawing and clearance: AU and radians. */
export function orbitShape(
  el: JplPlanetElements | OsculatingElements,
  jd: number,
): { a: number; e: number; i: number; node: number; argPeri: number } {
  if ("epochJd" in el) {
    return { a: el.a, e: el.e, i: el.i * D2R, node: el.node * D2R, argPeri: el.argPeri * D2R };
  }
  const T = (jd - JD_J2000) / 36525;
  const Tc = T > JPL_HELD_AFTER_T ? JPL_HELD_AFTER_T : T;
  const varpi = el.varpi[0] + el.varpi[1] * Tc;
  const Om = el.Omega[0] + el.Omega[1] * Tc;
  return {
    a: el.a[0] + el.a[1] * Tc,
    e: el.e[0] + el.e[1] * Tc,
    i: (el.I[0] + el.I[1] * Tc) * D2R,
    node: Om * D2R,
    argPeri: (varpi - Om) * D2R,
  };
}

/** Orbital speed (km/s) at distance r on an orbit of semi-major axis a (both AU). */
export const visVivaKmS = (rAU: number, aAU: number): number =>
  29.7847 * Math.sqrt(2 / rAU - 1 / aAU);
