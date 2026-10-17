#!/usr/bin/env node
/**
 * The new worlds' surface maps — original work, no source imagery
 * (spec docs/superpowers/specs/2026-10-17-new-worlds-design.md, "Assets").
 *
 *   node scripts/textures/gen_worlds.mjs                       # all, native widths
 *   node scripts/textures/gen_worlds.mjs w-blue --width=64 --out=/tmp/x
 *
 * Writes to assets-src/:
 *   w-ringed.jpg        2048  Saturn-type: butterscotch bands, cool polar caps, north polar hexagon
 *   w-tilted.jpg        1024  Uranus-type: pale cyan, almost featureless, faint polar brightening
 *   w-blue.jpg          2048  Neptune-type: deep blue bands, one dark storm, white ammonia-ice streaks
 *   w-dwarf.jpg         1024  Ceres-type: dark grey craters, a few brilliant salt faculae, one lone mountain
 *   w-ringed_ring.png   2048x4 RGBA ring strip: RGB = particle colour, A = tau / RING_TAU_MAX
 * (w-rock, the Mercury-type, is scripts/blender/gen_world_rock.py.)
 *
 * --width overrides every equirect map's width (the ring strip stays 2048).
 * Noise, sphere sampling and the JPEG writer are gen_planets.mjs's, so the
 * maps share its seam-safe sampling, THREE.SphereGeometry convention and
 * byte-for-byte determinism.
 *
 * Albedo is honest (spec "Light"): each map is scaled in linear light so its
 * linear-luminance texel median hits the world's target on the scene's scale.
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  mulberry32, clamp, lerp, smooth, hex, mix3, ramp, makeSimplex, fbm,
  sphereGrid, dirFromLatLon, forEachPixel, splat, rotateAbout, writeJpeg,
} from "./gen_planets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEG = Math.PI / 180;

/** Target linear-luminance texel medians (spec "Light"; tests/worldMaps.test.ts). */
export const TARGET_MEDIAN = { "w-ringed": 0.088, "w-tilted": 0.086, "w-blue": 0.078, "w-dwarf": 0.016 };

/**
 * The ring strip's alpha is tau / RING_TAU_MAX, so tau = A / 255 * RING_TAU_MAX.
 * The B ring's core (real tau 2.5-5, effectively opaque) clamps at A = 255.
 */
export const RING_TAU_MAX = 4;
/** Strip extent in equatorial radii: u = 0 at the C ring's inner edge, u = 1 at the A ring's outer edge. */
export const RING_IN = 1.24, RING_OUT = 2.27;

// ------------------------------------------------------------ helpers

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Scales an sRGB buffer in linear light so its linear-luminance median is `target`. */
function calibrate(rgb, target) {
  const n = rgb.length / 3;
  const L = new Float32Array(n);
  for (let k = 0; k < n; k++) L[k] = lum(s2l(clamp(rgb[k * 3])), s2l(clamp(rgb[k * 3 + 1])), s2l(clamp(rgb[k * 3 + 2])));
  const sorted = L.slice().sort();
  const s = target / Math.max(sorted[n >> 1], 1e-6);
  for (let k = 0; k < rgb.length; k++) rgb[k] = l2s(clamp(s2l(clamp(rgb[k])) * s));
  return s;
}

/** Longitude (rad, 0..2PI) of a unit vector, same convention as gen_planets. */
const lonOf = (x, z) => { const p = Math.atan2(z, -x); return p < 0 ? p + Math.PI * 2 : p; };

/** Local east/north frame at a unit vector c (for ellipses on the sphere). */
function frameAt(c) {
  const el = Math.hypot(c[2], c[0]) || 1;
  const e = [c[2] / el, 0, -c[0] / el];
  let n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  if (n[1] < 0) n = n.map((q) => -q);
  return { c, e, n };
}

/**
 * Calls fn(k, ang, x, y, z) for every texel within angular distance `reach`
 * of unit vector p (seam-safe, true angle on the sphere).
 */
function forEachInCap(G, p, reach, fn) {
  const { W, H, sinLat, cosLat, cosPhi, sinPhi } = G;
  const lat = Math.asin(clamp(p[1], -1, 1));
  const phi = lonOf(p[0], p[2]);
  const j0 = Math.max(0, Math.floor(((Math.PI / 2 - lat - reach) / Math.PI) * H) - 1);
  const j1 = Math.min(H - 1, Math.ceil(((Math.PI / 2 - lat + reach) / Math.PI) * H) + 1);
  const cosReach = Math.cos(reach);
  const allCols = Math.abs(lat) + reach > 1.4;
  for (let j = j0; j <= j1; j++) {
    const c = cosLat[j];
    let i0 = 0, i1 = W - 1;
    if (!allCols) {
      const span = (reach * 1.2) / Math.max(c, 1e-3) + (2 * Math.PI * 2) / W;
      if (span < Math.PI) {
        i0 = Math.floor(((phi - span) / (Math.PI * 2)) * W);
        i1 = Math.ceil(((phi + span) / (Math.PI * 2)) * W);
      }
    }
    for (let ii = i0; ii <= i1; ii++) {
      const i = ((ii % W) + W) % W;
      const qx = -cosPhi[i] * c, qy = sinLat[j], qz = sinPhi[i] * c;
      const d = qx * p[0] + qy * p[1] + qz * p[2];
      if (d < cosReach) continue;
      fn(j * W + i, Math.acos(Math.min(1, d)), qx, qy, qz);
    }
  }
}

/** Piecewise-linear profile over sorted [x, y] stops. */
function profile(stops) {
  return (x) => {
    if (x <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (x <= stops[i][0]) {
        const [x0, y0] = stops[i - 1], [x1, y1] = stops[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return stops[stops.length - 1][1];
  };
}

const set3 = (rgb, k, c) => { rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2]; };
const mixInto = (c, t, a) => { c[0] = lerp(c[0], t[0], a); c[1] = lerp(c[1], t[1], a); c[2] = lerp(c[2], t[2], a); };

// =================================================================
// w-ringed — Saturn-type: low-contrast butterscotch bands under haze
// =================================================================

function genRinged(W) {
  const G = sphereGrid(W, W / 2);
  const nB = makeSimplex(601), nW = makeSimplex(602), nS = makeSimplex(603), nF = makeSimplex(604), nH = makeSimplex(605);
  // Band brightness by latitude (deg), north and south apart so the hemispheres differ.
  const north = profile([[0, 0.9], [5, 0.93], [9, 0.74], [14, 0.62], [18, 0.7], [21, 0.8], [26, 0.68], [31, 0.8], [36, 0.66],
    [41, 0.75], [46, 0.6], [51, 0.7], [57, 0.58], [63, 0.63], [68, 0.55], [74, 0.58], [90, 0.55]]);
  const south = profile([[0, 0.9], [6, 0.9], [10, 0.72], [15, 0.6], [19, 0.7], [23, 0.78], [28, 0.66], [33, 0.79], [38, 0.64],
    [44, 0.73], [49, 0.6], [55, 0.67], [61, 0.56], [68, 0.6], [75, 0.53], [90, 0.52]]);
  const band = (L) => (L >= 0 ? north(L) : south(-L))
    + 0.05 * nB(L * 0.55, 1.3, 2.7) + 0.025 * nB(L * 1.9, 5.1, 0.4);
  const pal = ramp([
    [0.0, "#7d6847"], [0.3, "#a38c66"], [0.5, "#bba27a"], [0.68, "#ccb68e"],
    [0.82, "#dac8a3"], [0.93, "#e6d8b8"], [1.0, "#efe5cb"],
  ]);
  const cool = hex("#8f9c98"), hexIn = hex("#8a9590"), vortex = hex("#4d5a5e"), jet = hex("#5f6a66");
  const rgb = new Float32Array(W * (W / 2) * 3);
  const c = [0, 0, 0];

  forEachPixel(G, (k, x, y, z) => {
    // gentle anisotropic warp: Saturn's haze hides most turbulence
    const wa = fbm(nW, x * 2, y * 9, z * 2, 4);
    const wb = fbm(nS, x * 4 + 3, y * 22, z * 4, 3);
    const L = Math.asin(clamp(y, -1, 1)) / DEG + 0.9 * wa + 0.35 * wb;
    let v = band(L);
    v += 0.025 * fbm(nF, x * 6, y * 90, z * 6, 3); // long flow streaks
    pal(clamp(v), c);
    // cooler polar caps (the north more so) and a faint hemisphere drift
    const aL = Math.abs(L);
    mixInto(c, cool, (L > 0 ? 0.75 : 0.55) * smooth(58, 80, aL));
    // the north polar hexagon (~78 N) around a dark polar vortex
    if (L > 65) {
      const col = 90 - L; // colatitude, deg
      const phi = lonOf(x, z) / DEG;
      const a = (((phi + 17) % 60) + 60) % 60 - 30;
      const hr = col * Math.cos(a * DEG); // hexagonal "radius": the apothem direction
      const inside = smooth(12.3, 11.6, hr);
      mixInto(c, hexIn, 0.7 * inside * (0.85 + 0.15 * fbm(nH, x * 18, y * 18, z * 18, 3)));
      mixInto(c, jet, 0.55 * Math.exp(-(((hr - 12) / 0.45) ** 2)));
      mixInto(c, vortex, smooth(3.2, 1.2, col));
    }
    set3(rgb, k, c);
  });

  // "storm alley" near 35 S: a few small pale ovals
  const rand = mulberry32(6060);
  for (let i = 0; i < 6; i++) {
    const p = dirFromLatLon(-33 - rand() * 5, rand() * 360);
    splat(rgb, G, p, 0.006 + 0.006 * rand(), 0.1, 0.09, 0.07);
  }
  calibrate(rgb, TARGET_MEDIAN["w-ringed"]);
  return rgb;
}

// =================================================================
// w-tilted — Uranus-type: pale cyan, almost featureless
// =================================================================

function genTilted(W) {
  const G = sphereGrid(W, W / 2);
  const nB = makeSimplex(701), nW = makeSimplex(702);
  const pal = ramp([[0, "#8cc2d0"], [0.45, "#acdbe6"], [0.75, "#c6e9ef"], [1, "#e2f6f8"]]);
  const rgb = new Float32Array(W * (W / 2) * 3);
  const c = [0, 0, 0];
  forEachPixel(G, (k, x, y, z) => {
    const L = Math.asin(clamp(y, -1, 1)) / DEG + 0.3 * fbm(nW, x * 2, y * 8, z * 2, 3);
    // faint zonal bands (a few percent), a bright north polar cap with a dim collar
    let v = 0.45 + 0.025 * Math.sin(L * 0.21) + 0.015 * nB(L * 0.4, 2.2, 7.1);
    v += 0.28 * smooth(52, 72, L) - 0.05 * Math.exp(-(((L - 50) / 4) ** 2));
    v += 0.08 * smooth(-62, -82, L);
    pal(clamp(v), c);
    set3(rgb, k, c);
  });
  calibrate(rgb, TARGET_MEDIAN["w-tilted"]);
  return rgb;
}

// =================================================================
// w-blue — Neptune-type: deep blue bands, a dark storm, ammonia-ice streaks
// =================================================================

function genBlue(W) {
  const G = sphereGrid(W, W / 2);
  const nB = makeSimplex(801), nW = makeSimplex(802), nT = makeSimplex(803), nS = makeSimplex(804), nC = makeSimplex(805);
  const pal = ramp([[0, "#13225e"], [0.3, "#22408f"], [0.55, "#2f57b3"], [0.75, "#4572cc"], [0.9, "#6d94dc"], [1, "#9cb8e8"]]);
  const lat = profile([[-90, 0.6], [-75, 0.62], [-66, 0.7], [-58, 0.42], [-48, 0.4], [-38, 0.52], [-28, 0.6], [-15, 0.62],
    [0, 0.66], [15, 0.62], [28, 0.56], [40, 0.6], [55, 0.48], [68, 0.55], [90, 0.58]]);
  const white = hex("#eef3ff"), dark = hex("#0e1849"), collar = hex("#5c86d4");

  // The dark storm (Great-Dark-Spot-like): an oval at 22 S with white companion clouds on its poleward side.
  const gds = { ...frameAt(dirFromLatLon(-22, 205)), a: 0.26, b: 0.13, s: 1.6 };
  const d2 = { ...frameAt(dirFromLatLon(-55, 80)), a: 0.06, b: 0.04, s: -2.2 };
  // Bright ammonia-ice streak latitudes (deg) and half-widths.
  const streaks = [[27, 0.9], [33, 0.6], [-42, 0.8], [-29, 0.55], [61, 0.7], [-67, 0.6]];
  const rgb = new Float32Array(W * (W / 2) * 3);
  const q = [0, 0, 0], c = [0, 0, 0];

  forEachPixel(G, (k, x, y, z) => {
    q[0] = x; q[1] = y; q[2] = z;
    let gIn = 0, gRing = 0, gComp = 0, dIn = 0, dCore = 0;
    for (const v of [gds, d2]) {
      const dt = x * v.c[0] + y * v.c[1] + z * v.c[2];
      if (dt < 0.85) continue;
      const le = x * v.e[0] + y * v.e[1] + z * v.e[2];
      const ln = x * v.n[0] + y * v.n[1] + z * v.n[2];
      const dd = Math.hypot(le / v.a, ln / v.b);
      if (dd > 3) continue;
      rotateAbout(q, v.c, v.s * Math.exp(-dd * dd * 0.8) * (1 - 0.3 * dd) * 0.5);
      if (v === gds) {
        gIn = smooth(1.05, 0.55, dd);
        gRing = Math.exp(-(((dd - 1.12) / 0.12) ** 2));
        const pole = clamp(-ln / (v.b * Math.max(dd, 1e-3)));
        gComp = Math.exp(-(((dd - 1.35) / 0.22) ** 2)) * smooth(0.1, 0.8, pole);
      } else {
        dIn = smooth(1.0, 0.4, dd);
        dCore = smooth(0.35, 0.0, dd);
      }
    }
    const qx = q[0], qy = q[1], qz = q[2];
    const wa = fbm(nW, qx * 1.8, qy * 7, qz * 1.8, 4);
    const wb = fbm(nT, qx * 3.5 + 2 * wa, qy * 16, qz * 3.5, 3);
    const L = Math.asin(clamp(qy, -1, 1)) / DEG + 1.6 * wa + 0.7 * wb;
    let v = lat(L) + 0.05 * nB(L * 0.5, 3.3, 1.1) + 0.015 * fbm(nB, qx * 5, qy * 50, qz * 5, 3);
    pal(clamp(v), c);
    // white ammonia-ice streaks: thin, long in longitude, broken
    let st = 0;
    for (let i = 0; i < streaks.length; i++) {
      const [sl, sw] = streaks[i];
      const env = Math.exp(-(((L - sl) / sw) ** 2));
      if (env < 0.01) continue;
      // patchy along the band, feathered into filaments by a strongly stretched noise
      const brk = smooth(0.15, 0.6, fbm(nS, qx * 1.3 + i * 7.1, qy * 2 + i, qz * 1.3, 3));
      const fil = 0.45 + 0.55 * smooth(-0.3, 0.5, fbm(nC, qx * 5 + i, qy * 70, qz * 5, 3));
      st = Math.max(st, env * brk * fil);
    }
    st = Math.max(st, 0.8 * gComp * smooth(-0.2, 0.45, fbm(nC, x * 9, y * 24, z * 9, 3)));
    // the storm: dark oval, lighter collar, then the white companions
    mixInto(c, collar, 0.35 * gRing);
    mixInto(c, dark, 0.8 * gIn + 0.55 * dIn);
    mixInto(c, white, Math.max(clamp(st) * 0.8, 0.85 * dCore));
    set3(rgb, k, c);
  });
  calibrate(rgb, TARGET_MEDIAN["w-blue"]);
  return rgb;
}

// =================================================================
// w-dwarf — Ceres-type: dark grey craters, salt faculae, one lone mountain
// =================================================================

function genDwarf(W) {
  const H = W / 2;
  const G = sphereGrid(W, H);
  const n1 = makeSimplex(901), n2 = makeSimplex(902), n3 = makeSimplex(903);
  const rand = mulberry32(9090);
  const N = W * H;
  // shade: the crater albedo pattern (floors darker, rims and walls paler),
  // so craters read without a normal map and under any sun angle.
  const shade = new Float32Array(N), fresh = new Float32Array(N), salt = new Float32Array(N), alb = new Float32Array(N);
  forEachPixel(G, (k, x, y, z) => {
    alb[k] = 1 + 0.08 * fbm(n3, x * 2, y * 2, z * 2, 4) + 0.04 * fbm(n3, x * 14 + 5, y * 14, z * 14, 3);
  });
  const randDir = () => {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return [r * Math.cos(a), u, r * Math.sin(a)];
  };
  const powerLaw = (n, rmin, rmax, alpha) => {
    const out = [];
    const a = rmin ** (1 - alpha), b = rmax ** (1 - alpha);
    for (let i = 0; i < n; i++) out.push({ c: randDir(), r: (a + rand() * (b - a)) ** (1 / (1 - alpha)) });
    return out.sort((p, q) => q.r - p.r);
  };
  /** One crater: later (smaller) craters overprint earlier ones, as on gen_moon.py's surfaces. */
  const stamp = (cr, floorDark, rimBright, ext, onTexel) => {
    forEachInCap(G, cr.c, cr.r * ext, (k, ang, x, y, z) => {
      const wob = 1 + 0.12 * n2((x / cr.r) * 0.9, (y / cr.r) * 0.9, (z / cr.r) * 0.9);
      const xr = ang / (cr.r * wob);
      const inside = 1 - smooth(0.75, 1.0, xr);
      const rim = Math.exp(-(((xr - 0.93) / 0.09) ** 2));
      const blanket = Math.exp(-Math.max(xr - 1, 0) * 3) * smooth(0.95, 1.05, xr) * smooth(ext, ext * 0.7, xr);
      const wall = Math.exp(-(((xr - 0.78) / 0.1) ** 2));
      shade[k] = shade[k] * (1 - 0.8 * inside) - floorDark * (inside * (1 - rim) + 0.6 * wall) + rimBright * (rim + 0.25 * blanket);
      if (onTexel) onTexel(k, xr, x, y, z);
    });
  };
  // old, relaxed basins (Kerwan/Yalode-like): wide, shallow, barely darker
  for (const cr of powerLaw(4, 0.16, 0.3, 1.5)) stamp(cr, 0.04, 0.04, 1.6);
  for (const cr of powerLaw(30, 0.04, 0.13, 1.8)) stamp(cr, 0.05, 0.12, 1.8);
  for (const cr of powerLaw(600, 0.012, 0.04, 2.2)) stamp(cr, 0.045, 0.1, 1.8);
  for (const cr of powerLaw(1600, 0.006, 0.012, 2.4)) stamp(cr, 0.035, 0.07, 1.6);
  // a few young craters with paler, bluish ejecta (Haulani/Oxo-like)
  for (const cr of [{ c: dirFromLatLon(6, 11), r: 0.035 }, { c: dirFromLatLon(42, 359), r: 0.012 }, { c: dirFromLatLon(-48, 140), r: 0.022 }]) {
    stamp(cr, 0.05, 0.15, 4, (k, xr, x, y, z) => {
      fresh[k] = Math.max(fresh[k], Math.exp(-Math.max(xr - 0.9, 0) * 1.6) * (0.55 + 0.45 * smooth(-0.2, 0.4, n1(x * 40, y * 40, z * 40))));
    });
  }
  // Occator-like crater with its faculae: a bright central pit spot and scattered spots on the east floor
  stamp({ c: dirFromLatLon(20, 239), r: 0.1 }, 0.12, 0.12, 1.8);
  const fac = (lat, lon, sig, amp) => {
    const p = dirFromLatLon(lat, lon);
    forEachInCap(G, p, sig * 3.2, (k, ang) => { salt[k] += amp * Math.exp(-((ang / sig) ** 2) / 2); });
  };
  const px = (Math.PI * 2) / 1024; // spot sizes are authored in 1024-px units
  fac(20, 239, 1.6 * px, 1.0); // Cerealia-like: the brightest, in the central pit
  fac(20.3, 239.2, 0.7 * px, 0.6);
  for (let i = 0; i < 7; i++) fac(19 + rand() * 3, 242 + rand() * 3.5, (0.5 + 0.5 * rand()) * px, 0.35 + 0.35 * rand()); // Vinalia-like
  fac(42, 359, 0.8 * px, 0.45); // Oxo-like
  // the lone mountain (Ahuna-Mons-like): a steep dome, darker summit, bright streaks down its flanks
  const ahuna = frameAt(dirFromLatLon(-10.5, 316));
  const amR = 0.032;
  forEachInCap(G, ahuna.c, amR * 1.6, (k, ang, x, y, z) => {
    const xr = ang / amR;
    shade[k] += 0.1 * Math.exp(-(((xr - 0.85) / 0.15) ** 2)) - 0.06 * smooth(0.5, 0.1, xr);
    const az = Math.atan2(x * ahuna.n[0] + y * ahuna.n[1] + z * ahuna.n[2], x * ahuna.e[0] + y * ahuna.e[1] + z * ahuna.e[2]);
    const streak = smooth(0.2, 0.75, n1(Math.cos(az) * 6, Math.sin(az) * 6, 2.5));
    salt[k] = Math.max(salt[k], 0.3 * streak * smooth(0.25, 0.6, xr) * smooth(1.05, 0.85, xr));
  });

  // Colour: dark neutral grey (C-type, a flat spectrum).
  const base = hex("#545558"), freshC = hex("#8d939c");
  const rgb = new Float32Array(N * 3);
  const c = [0, 0, 0];
  forEachPixel(G, (k) => {
    const a = alb[k] * (1 + clamp(shade[k], -0.3, 0.3));
    c[0] = base[0] * a; c[1] = base[1] * a; c[2] = base[2] * a;
    mixInto(c, freshC, 0.6 * fresh[k]);
    set3(rgb, k, c);
  });
  // Calibrate on the dark terrain, then lay the faculae on top: they are the
  // brightest thing on Ceres (several times its mean), not scaled down with it.
  calibrate(rgb, TARGET_MEDIAN["w-dwarf"]);
  const peak = l2s(0.16); // facula core ~10x the median, linear
  for (let k = 0; k < N; k++) {
    const s = clamp(salt[k]);
    if (s > 0) for (let ch = 0; ch < 3; ch++) rgb[k * 3 + ch] = lerp(rgb[k * 3 + ch], peak, s);
  }
  return rgb;
}

// =================================================================
// w-ringed_ring — the ring strip (1D radial profile, 2048 x 4 RGBA)
// =================================================================

/**
 * Optical depth tau(R), R in equatorial radii, after Saturn's measured profile
 * (Voyager/Cassini occultations, simplified): C ring 1.24-1.53 faint with
 * plateaus and the Colombo/Maxwell gaps; B ring 1.53-1.95, an opaque core;
 * Cassini division 1.95-2.03 with the Huygens gap and the outer ramp; A ring
 * 2.03-2.27 with the Encke gap (~2.214) and the Keeler gap (~2.265).
 */
function ringTau(R, n) {
  const gap = (c, w) => smooth(w * 0.5, w * 0.5 + 0.0012, Math.abs(R - c));
  const fine = (f, s) => n(R * f, s, 0.5);
  if (R < 1.2405 || R > 2.2695) return 0;
  let t;
  if (R < 1.527) {
    // C ring: tau ~0.06-0.12, a few plateaus ~0.35-0.45 in its outer half, a ramp into B
    t = 0.08 + 0.025 * fine(260, 1);
    for (const [a, b] of [[1.425, 1.437], [1.455, 1.463], [1.468, 1.479], [1.488, 1.493]]) t = Math.max(t, 0.38 * smooth(a - 0.001, a + 0.001, R) * smooth(b + 0.001, b - 0.001, R));
    t = lerp(t, 0.2, smooth(1.495, 1.527, R));
    t *= gap(1.29, 0.003) * gap(1.4495, 0.0045);
  } else if (R < 1.951) {
    // B ring: inner B1 ~1-1.6 with ringlets, B2-B3 core 2.5-5 (opaque), outer B4 ~2
    const b1 = 1.25 + 0.35 * fine(180, 2) + 0.2 * fine(700, 3);
    const core = 3.6 + 1.2 * fine(90, 4);
    const b4 = 2.1 + 0.6 * fine(220, 5);
    t = R < 1.64 ? lerp(0.25, b1, smooth(1.527, 1.545, R)) : R < 1.85 ? lerp(b1, core, smooth(1.64, 1.68, R)) : lerp(core, b4, smooth(1.85, 1.87, R));
  } else if (R < 2.027) {
    // Cassini division: tau ~0.05-0.12, the empty Huygens gap, the outer ramp ~0.25
    t = 0.07 + 0.02 * fine(400, 6);
    t = lerp(t, 0.24, smooth(1.995, 2.022, R));
    t *= gap(1.9555, 0.0045);
  } else {
    // A ring: tau ~0.5-0.7, rising mid-ring, thinning outward; Encke and Keeler gaps
    t = 0.55 + 0.12 * smooth(2.04, 2.1, R) - 0.15 * smooth(2.15, 2.26, R) + 0.05 * fine(300, 7);
    t *= gap(2.214, 0.0054) * gap(2.2655, 0.0007);
  }
  return Math.max(0, t);
}

function genRing() {
  const W = 2048, Hs = 4;
  const n = makeSimplex(1001);
  // particle colour (linear): cream-tan B, greyer A, dusty grey-brown C and Cassini
  const cC = hex("#968a7b"), cB = hex("#d9c4a0"), cA = hex("#c6b79e");
  const lin = (c, Lt) => { const l = c.map(s2l), s = Lt / lum(l[0], l[1], l[2]); return l.map((v) => v * s); };
  const C = lin(cC, 0.045), B = lin(cB, 0.11), A = lin(cA, 0.085);
  const out = Buffer.alloc(W * Hs * 4);
  for (let x = 0; x < W; x++) {
    const R = RING_IN + ((x + 0.5) / W) * (RING_OUT - RING_IN);
    const tau = ringTau(R, n);
    let col;
    if (R < 1.527) col = C;
    else if (R < 1.951) col = mix3(C, B, smooth(1.527, 1.6, R));
    else if (R < 2.027) col = mix3(C, A, smooth(1.995, 2.027, R));
    else col = A;
    const tint = 1 + 0.06 * n(R * 150, 9, 9);
    for (let y = 0; y < Hs; y++) {
      const o = (y * W + x) * 4;
      out[o] = Math.round(clamp(l2s(col[0] * tint)) * 255);
      out[o + 1] = Math.round(clamp(l2s(col[1] * tint)) * 255);
      out[o + 2] = Math.round(clamp(l2s(col[2] * tint)) * 255);
      out[o + 3] = Math.round(clamp(tau / RING_TAU_MAX) * 255);
    }
  }
  return { out, W, Hs };
}

// ------------------------------------------------------------------- main

const MAPS = {
  "w-ringed": { width: 2048, gen: genRinged },
  "w-tilted": { width: 1024, gen: genTilted },
  "w-blue": { width: 2048, gen: genBlue },
  "w-dwarf": { width: 1024, gen: genDwarf },
};

async function main() {
  const args = process.argv.slice(2);
  const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
  const names = args.filter((a) => !a.startsWith("--"));
  const override = opt.width === undefined ? null : Number(opt.width);
  if (override !== null && (!Number.isInteger(override) || override % 2)) throw new Error("--width must be an even integer");
  const outDir = path.resolve(opt.out ?? path.join(ROOT, "assets-src"));
  mkdirSync(outDir, { recursive: true });
  const all = [...Object.keys(MAPS), "w-ringed_ring"];
  for (const name of names.length ? names : all) {
    const t = Date.now();
    if (name === "w-ringed_ring") {
      const { out, W, Hs } = genRing();
      const file = path.join(outDir, `${name}.png`);
      await sharp(out, { raw: { width: W, height: Hs, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
      console.log(`${name} @ ${W}x${Hs}\n  wrote`, path.relative(ROOT, file) || file);
    } else {
      const m = MAPS[name];
      if (!m) throw new Error(`unknown world map "${name}" (expected: ${all.join(", ")})`);
      const W = override ?? m.width;
      console.log(`${name} @ ${W}x${W / 2}`);
      await writeJpeg(m.gen(W), W, W / 2, path.join(outDir, `${name}.jpg`));
    }
    console.log(`  ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
}

// Run only as a script: turntable_worlds.py imports the ring constants above.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
