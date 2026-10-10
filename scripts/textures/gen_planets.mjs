#!/usr/bin/env node
/**
 * Procedural planet surface textures — original work, no source imagery.
 *
 *   node scripts/textures/gen_planets.mjs                 # all three, 2048x1024
 *   node scripts/textures/gen_planets.mjs fuxx --width=1024 --out=/tmp/x
 *
 * Writes equirectangular sRGB JPEGs (q92) to assets-src/:
 *   ruangrapi.jpg + ruangrapi_glow.jpg   archipelago ocean world + city lights
 *   portfolio.jpg                         cyan banded gas giant
 *   fuxx.jpg + fuxx_glow.jpg              violet rock world + glowing canyon net
 *
 * Every pixel is computed by sampling 3D fields on the unit sphere
 * (lat/long -> xyz), so the 0/360 seam is continuous by construction and the
 * poles have no pinching. All randomness is seeded (mulberry32), so the output
 * is byte-for-byte deterministic for a given width.
 *
 * Sphere convention matches THREE.SphereGeometry: for pixel (u, v) with
 * phi = u * 2PI and lat = PI/2 - v * PI,
 *   x = -cos(phi) cos(lat),  y = sin(lat),  z = sin(phi) cos(lat).
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------- utilities

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hex = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Piecewise-linear colour ramp over sorted [pos, "#rrggbb"] stops. */
function ramp(stops) {
  const pos = stops.map((s) => s[0]);
  const col = stops.map((s) => hex(s[1]));
  return (t, out) => {
    if (t <= pos[0]) { out[0] = col[0][0]; out[1] = col[0][1]; out[2] = col[0][2]; return out; }
    for (let i = 1; i < pos.length; i++) {
      if (t <= pos[i]) {
        const k = (t - pos[i - 1]) / (pos[i] - pos[i - 1]);
        const a = col[i - 1], b = col[i];
        out[0] = a[0] + (b[0] - a[0]) * k;
        out[1] = a[1] + (b[1] - a[1]) * k;
        out[2] = a[2] + (b[2] - a[2]) * k;
        return out;
      }
    }
    const c = col[col.length - 1];
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return out;
  };
}

// ------------------------------------------------------------ simplex noise

const GX = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];
const GZ = [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1];

/** Seeded 3D simplex noise (Gustavson), range ~[-1, 1]. */
function makeSimplex(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const F3 = 1 / 3, G3 = 1 / 6;
  return function (xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) { g = pm12[ii + perm[jj + perm[kk]]]; tt *= tt; n += tt * tt * (GX[g] * x0 + GY[g] * y0 + GZ[g] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) { g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]; tt *= tt; n += tt * tt * (GX[g] * x1 + GY[g] * y1 + GZ[g] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) { g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]; tt *= tt; n += tt * tt * (GX[g] * x2 + GY[g] * y2 + GZ[g] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) { g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]; tt *= tt; n += tt * tt * (GX[g] * x3 + GY[g] * y3 + GZ[g] * z3); }
    return 32 * n;
  };
}

/** Fractal sum, normalised to roughly [-1, 1]. */
function fbm(n, x, y, z, oct, lac = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * n(x, y, z);
    norm += amp;
    amp *= gain;
    x *= lac; y *= lac; z *= lac;
    // decorrelate octaves a little so lattice artefacts don't stack
    x += 17.31; y -= 9.17; z += 5.43;
  }
  return sum / norm;
}

/** Ridged multifractal in [0, 1] (sharp crests). */
function ridged(n, x, y, z, oct, lac = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let r = 1 - Math.abs(n(x, y, z));
    r *= r;
    r *= w;
    w = clamp(r * 1.6);
    sum += amp * r;
    norm += amp;
    amp *= gain;
    x *= lac; y *= lac; z *= lac;
    x += 11.7; y += 3.1; z -= 7.9;
  }
  return sum / norm;
}

// ---------------------------------------------------------- cellular noise

function hash3(ix, iy, iz, s) {
  let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ Math.imul(s, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const U32 = 1 / 4294967296;

/**
 * Voronoi border distance (Quilez two-pass) in 3D. Returns into `out`:
 * [0] distance to the nearest cell border, [1] distance to the second-nearest
 * border (small at junctions), [2] activity hash of the nearest border in
 * [0,1) (stable per cell pair), [3] F1 cell hash in [0,1), [4..6] unit
 * normal of the nearest border plane, [7] activity hash of the second border.
 */
function makeVoronoi(seed) {
  const pt = (X, Y, Z, o) => {
    o[0] = X + 0.15 + 0.7 * (hash3(X, Y, Z, seed + 1) * U32);
    o[1] = Y + 0.15 + 0.7 * (hash3(X, Y, Z, seed + 2) * U32);
    o[2] = Z + 0.15 + 0.7 * (hash3(X, Y, Z, seed + 3) * U32);
  };
  const P = [0, 0, 0];
  return function (x, y, z, out) {
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    // pass 1: nearest feature point
    let best = 1e9, bx = 0, by = 0, bz = 0, ax = 0, ay = 0, az = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          pt(cx + dx, cy + dy, cz + dz, P);
          const px = P[0] - x, py = P[1] - y, pz = P[2] - z;
          const d = px * px + py * py + pz * pz;
          if (d < best) { best = d; bx = cx + dx; by = cy + dy; bz = cz + dz; ax = px; ay = py; az = pz; }
        }
    const aid = hash3(bx, by, bz, seed);
    // pass 2: exact distance to the borders of that cell (5x5x5 around it)
    let b1 = 1e9, b2 = 1e9, act = 0, act2 = 0, nx = 0, ny = 0, nz = 0;
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy && !dz) continue;
          const X = bx + dx, Y = by + dy, Z = bz + dz;
          pt(X, Y, Z, P);
          const px = P[0] - x, py = P[1] - y, pz = P[2] - z;
          const ex = px - ax, ey = py - ay, ez = pz - az;
          const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
          const d = ((ax + px) * 0.5 * ex + (ay + py) * 0.5 * ey + (az + pz) * 0.5 * ez) / el;
          if (d < b2) {
            const nid = hash3(X, Y, Z, seed);
            const lo = Math.min(aid, nid), hi = Math.max(aid, nid);
            const a = hash3(lo, hi, 7, seed + 9) * U32;
            if (d < b1) {
              b2 = b1; act2 = act; b1 = d; act = a;
              nx = ex / el; ny = ey / el; nz = ez / el;
            } else { b2 = d; act2 = a; }
          }
        }
    out[0] = b1; out[1] = b2; out[2] = act; out[3] = aid * U32;
    out[4] = nx; out[5] = ny; out[6] = nz; out[7] = act2;
    return out;
  };
}

// ------------------------------------------------------------ sphere frame

function sphereGrid(W, H) {
  const sinLat = new Float64Array(H), cosLat = new Float64Array(H);
  const cosPhi = new Float64Array(W), sinPhi = new Float64Array(W);
  for (let j = 0; j < H; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / H) * Math.PI;
    sinLat[j] = Math.sin(lat); cosLat[j] = Math.cos(lat);
  }
  for (let i = 0; i < W; i++) {
    const phi = ((i + 0.5) / W) * Math.PI * 2;
    cosPhi[i] = Math.cos(phi); sinPhi[i] = Math.sin(phi);
  }
  return { W, H, sinLat, cosLat, cosPhi, sinPhi };
}

/** Unit vector for a given latitude/longitude (degrees), same convention. */
function dirFromLatLon(latDeg, lonDeg) {
  const lat = (latDeg * Math.PI) / 180, phi = (lonDeg * Math.PI) / 180;
  return [-Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat)];
}

function forEachPixel(G, fn) {
  const { W, H, sinLat, cosLat, cosPhi, sinPhi } = G;
  for (let j = 0; j < H; j++) {
    const y = sinLat[j], c = cosLat[j];
    for (let i = 0; i < W; i++) fn(j * W + i, -cosPhi[i] * c, y, sinPhi[i] * c, j, i);
  }
}

/**
 * Additive gaussian splat on the equirect, measured as true angle on the
 * sphere so dots stay round at every latitude and wrap across the seam.
 */
function splat(buf, G, p, sigma, r, g, b) {
  const { W, H, sinLat, cosLat, cosPhi, sinPhi } = G;
  const lat = Math.asin(clamp(p[1], -1, 1));
  let phi = Math.atan2(p[2], -p[0]);
  if (phi < 0) phi += Math.PI * 2;
  const reach = sigma * 3.2;
  const j0 = Math.max(0, Math.floor(((Math.PI / 2 - lat - reach) / Math.PI) * H));
  const j1 = Math.min(H - 1, Math.ceil(((Math.PI / 2 - lat + reach) / Math.PI) * H));
  const inv = 1 / (2 * sigma * sigma);
  for (let j = j0; j <= j1; j++) {
    const c = cosLat[j];
    const span = c > 1e-3 ? reach / c : Math.PI;
    let i0, i1;
    if (span >= Math.PI) { i0 = 0; i1 = W - 1; }
    else {
      i0 = Math.floor(((phi - span) / (Math.PI * 2)) * W);
      i1 = Math.ceil(((phi + span) / (Math.PI * 2)) * W);
    }
    for (let ii = i0; ii <= i1; ii++) {
      const i = ((ii % W) + W) % W;
      const qx = -cosPhi[i] * c, qy = sinLat[j], qz = sinPhi[i] * c;
      const d2 = 2 * (1 - (qx * p[0] + qy * p[1] + qz * p[2]));
      if (d2 > reach * reach) continue;
      const w = Math.exp(-d2 * inv);
      const k = (j * W + i) * 3;
      buf[k] += r * w; buf[k + 1] += g * w; buf[k + 2] += b * w;
    }
  }
}

/** Rotate v about unit axis a by angle t (Rodrigues), in place. */
function rotateAbout(v, a, t) {
  const c = Math.cos(t), s = Math.sin(t);
  const d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  const cx = a[1] * v[2] - a[2] * v[1], cy = a[2] * v[0] - a[0] * v[2], cz = a[0] * v[1] - a[1] * v[0];
  const x = v[0] * c + cx * s + a[0] * d * (1 - c);
  const y = v[1] * c + cy * s + a[1] * d * (1 - c);
  const z = v[2] * c + cz * s + a[2] * d * (1 - c);
  v[0] = x; v[1] = y; v[2] = z;
}

/**
 * Non-directional relief term from a height array: approximates the slope on
 * the sphere (longitude spacing scaled by cos(lat)) and returns per-pixel
 * gradient components in a consistent north/east tangent frame.
 */
function sphereGradient(h, G, scale) {
  const { W, H, cosLat } = G;
  const gE = new Float32Array(W * H), gN = new Float32Array(W * H);
  const step = (Math.PI * 2) / W;
  for (let j = 0; j < H; j++) {
    const ju = Math.max(0, j - 1), jd = Math.min(H - 1, j + 1);
    const dy = (jd - ju) * step;
    const dx = 2 * step * Math.max(cosLat[j], 0.02);
    for (let i = 0; i < W; i++) {
      const il = (i + W - 1) % W, ir = (i + 1) % W;
      gE[j * W + i] = ((h[j * W + ir] - h[j * W + il]) / dx) * scale;
      gN[j * W + i] = ((h[ju * W + i] - h[jd * W + i]) / dy) * scale;
    }
  }
  return { gE, gN };
}

function quantile(arr, q, stride = 7) {
  const s = [];
  for (let i = 0; i < arr.length; i += stride) s.push(arr[i]);
  s.sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))];
}

async function writeJpeg(rgb, W, H, file) {
  const out = Buffer.alloc(W * H * 3);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(clamp(rgb[k]) * 255);
  await sharp(out, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(file);
  console.log("  wrote", path.relative(ROOT, file) || file);
}

// =================================================================
// 1. RUANGRAPI — emerald archipelago ocean world (+ settlement lights)
// =================================================================

function ruangrapiHeight(N) {
  const { n1, n2, n3, n4, n5 } = N;
  const fn = function (x, y, z) {
    // gentle large-scale warp so arcs curve instead of running straight
    const wx = fbm(n1, x * 1.7 + 3.1, y * 1.7, z * 1.7, 3);
    const wy = fbm(n1, x * 1.7, y * 1.7 + 7.7, z * 1.7, 3);
    const wz = fbm(n1, x * 1.7, y * 1.7, z * 1.7 - 4.2, 3);
    const qx = x + 0.2 * wx, qy = y + 0.2 * wy, qz = z + 0.2 * wz;
    // archipelago provinces vs open-ocean basins
    const prov = fbm(n3, x * 1.05, y * 1.05, z * 1.05, 3);
    const inProv = smooth(-0.25, 0.3, prov);
    // volcanic island arcs: thin ridges of low-frequency noise
    const c1 = 1 - Math.abs(n2(qx * 1.9, qy * 1.9, qz * 1.9));
    const c2 = 1 - Math.abs(n2(qx * 3.4 + 9, qy * 3.4, qz * 3.4));
    const arc = Math.pow(c1, 7) + 0.7 * Math.pow(c2, 9);
    // large islands and the crinkly multi-scale coast
    const big = fbm(n4, qx * 2.6, qy * 2.6, qz * 2.6, 4);
    const fine = fbm(n5, qx * 9, qy * 9, qz * 9, 6, 2.1, 0.55);
    const micro = n5(qx * 34 + 2, qy * 34, qz * 34);
    const low = 0.42 * prov + 0.34 * big + 0.34 * arc * (0.35 + 0.65 * inProv);
    fn.low = 0.42 * prov + 0.34 * big; // smooth bathymetry (no arcs/fine), for offshore colour
    return low + (0.2 + 0.08 * inProv) * fine + 0.035 * micro;
  };
  fn.low = 0;
  return fn;
}

async function genRuangrapi(W, outDir) {
  const H = W / 2;
  const G = sphereGrid(W, H);
  const N = {
    n1: makeSimplex(101), n2: makeSimplex(102), n3: makeSimplex(103),
    n4: makeSimplex(104), n5: makeSimplex(105), n6: makeSimplex(106),
    n7: makeSimplex(107), n8: makeSimplex(108),
  };
  const heightAt = ruangrapiHeight(N);
  const h = new Float32Array(W * H);
  const lat = new Float32Array(W * H);
  const hLow = new Float32Array(W * H);
  forEachPixel(G, (k, x, y, z) => { h[k] = heightAt(x, y, z); hLow[k] = heightAt.low; lat[k] = y; });

  const sea = quantile(h, 0.78); // ~22% land
  const top = quantile(h, 0.995);
  const bottom = quantile(h, 0.002);
  const { gE, gN } = sphereGradient(h, G, 0.012);

  const water = ramp([
    [0.0, "#4fcfb2"], // lagoon
    [0.025, "#2aa896"],
    [0.07, "#158279"],
    [0.15, "#0d6262"], // shelf edge
    [0.3, "#0a4a4d"],
    [0.6, "#073b3f"],
    [1.0, "#052e33"],
  ]);
  const land = ramp([
    [0.0, "#6fb878"],  // tidal flats
    [0.02, "#47b864"],
    [0.05, "#2fae5a"], // lowland emerald
    [0.2, "#1f9450"],
    [0.42, "#167642"], // rainforest
    [0.64, "#235f37"], // highlands
    [0.82, "#3f5c3e"], // volcanic upland
    [1.0, "#66705f"],
  ]);
  const ice = hex("#e6f4f0");
  const rgb = new Float32Array(W * H * 3);
  const c = [0, 0, 0], d = [0, 0, 0];
  const { n6, n7, n8 } = N;

  forEachPixel(G, (k, x, y, z) => {
    const e = h[k] - sea;
    const absLat = Math.abs(lat[k]);
    if (e < 0) {
      // ocean: normalised depth -> lagoon / shelf / abyss gradient
      const dNear = -e / (sea - bottom);
      const dFar = Math.max(0, (sea - hLow[k]) / (sea - bottom));
      // use the true height near coasts (shelf follows the coastline) and
      // the smooth bathymetry offshore (no noise veins in deep water)
      const depth = lerp(dNear, Math.max(0.12, dFar), smooth(0.05, 0.16, dNear));
      water(clamp(depth + 0.008 * fbm(n6, x * 22, y * 22, z * 22, 3)), c);
      // faint current streaks in open water
      const cur = 1 + 0.06 * fbm(n7, x * 2.5, y * 6, z * 2.5, 3) * smooth(0.1, 0.4, depth);
      c[0] *= cur; c[1] *= cur; c[2] *= cur;
    } else {
      const t = clamp(e / (top - sea));
      // vegetation mottling (tone + species variation)
      const m = fbm(n6, x * 18, y * 18, z * 18, 5);
      const m2 = fbm(n8, x * 5, y * 5, z * 5, 3);
      land(clamp(Math.pow(t, 1.25) + 0.04 * m), c);
      d[0] = c[0] * (1 + 0.07 * m2); d[1] = c[1] * (1 + 0.12 * m + 0.1 * m2); d[2] = c[2] * (1 + 0.1 * m);
      c[0] = d[0]; c[1] = d[1]; c[2] = d[2];
      // relief: soft directional + slope darkening so mountains read at range
      const gx = gE[k], gy = gN[k];
      const slope = Math.sqrt(gx * gx + gy * gy);
      const shade = clamp(1 + 0.35 * (gy * 0.7 - gx * 0.7) / (1 + slope) - 0.25 * smooth(0.2, 1.4, slope), 0.55, 1.3);
      c[0] *= shade; c[1] *= shade; c[2] *= shade;
    }
    // small polar caps with ragged edge
    const capEdge = 0.988 + 0.009 * fbm(n7, x * 9, y * 9, z * 9, 5);
    const capT = smooth(capEdge, capEdge + 0.003, absLat);
    if (capT > 0) {
      c[0] = lerp(c[0], ice[0], capT * 0.9); c[1] = lerp(c[1], ice[1], capT * 0.9); c[2] = lerp(c[2], ice[2], capT * 0.9);
    }
    rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2];
  });
  await writeJpeg(rgb, W, H, path.join(outDir, "ruangrapi.jpg"));

  // ----- settlement lights: seeded candidate sites, kept on land near coasts
  const glow = new Float32Array(W * H * 3);
  const rand = mulberry32(4242);
  const sigma = ((Math.PI * 2) / 2048) * 1.0; // authored in 2048-px units
  const warm = hex("#ffc27a"), white = hex("#fff1d6");
  const gauss = () => {
    const u = Math.max(rand(), 1e-9), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const randDir = () => {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return [r * Math.cos(a), u, r * Math.sin(a)];
  };
  const landT = (p) => (heightAt(p[0], p[1], p[2]) - sea) / (top - sea);
  const popDensity = (p) => smooth(-0.1, 0.4, fbm(n8, p[0] * 4 + 5, p[1] * 4, p[2] * 4, 3));
  const dot = (p, sig, amp, tint) => splat(glow, G, p, sig, tint[0] * amp, tint[1] * amp, tint[2] * amp);

  // Hubs: coastal lowland towns in populated provinces, each with satellites.
  const hubs = [];
  for (let tries = 0; hubs.length < 230 && tries < 400000; tries++) {
    const p = randDir();
    if (Math.abs(p[1]) > 0.85) continue;
    const t = landT(p);
    if (t < 0 || t > 0.4) continue;
    if (rand() > popDensity(p) * Math.exp(-t * 9)) continue;
    hubs.push(p);
  }
  let lights = 0;
  for (const p of hubs) {
    const size = Math.pow(rand(), 2.5); // a few metros, many towns
    const tint = mix3(warm, white, 0.3 + 0.5 * size);
    dot(p, sigma * (1.1 + 1.6 * size), 0.55 + 0.9 * size, tint);
    lights++;
    if (size > 0.35) dot(p, sigma * (5 + 6 * size), 0.05 + 0.06 * size, warm); // urban sky-glow
    const n = 4 + Math.floor(size * 46);
    const spread = 0.004 + 0.016 * size; // radians
    for (let s = 0; s < n; s++) {
      const q = [p[0] + gauss() * spread, p[1] + gauss() * spread, p[2] + gauss() * spread];
      const l = Math.hypot(q[0], q[1], q[2]);
      q[0] /= l; q[1] /= l; q[2] /= l;
      if (landT(q) < 0) continue;
      dot(q, sigma * (0.7 + 0.4 * rand()), 0.25 + 0.45 * rand() * (0.6 + size), mix3(warm, white, rand() * 0.5));
      lights++;
    }
  }
  // scattered villages, faint
  for (let s = 0; s < 1400; s++) {
    const p = randDir();
    const t = landT(p);
    if (t < 0 || Math.abs(p[1]) > 0.88 || rand() > 0.3 + popDensity(p)) continue;
    dot(p, sigma * 0.7, 0.08 + 0.12 * rand(), warm);
    lights++;
  }
  const cities = { length: `${hubs.length} hubs / ${lights}` };
  console.log(`  ruangrapi: ${cities.length} settlements`);
  // soft-clip so dense clusters bloom instead of hard-clipping
  for (let k = 0; k < glow.length; k++) glow[k] = 1 - Math.exp(-glow[k] * 1.4);
  await writeJpeg(glow, W, H, path.join(outDir, "ruangrapi_glow.jpg"));
}

// =================================================================
// 2. PORTFOLIO — cyan gas giant with turbulent bands and storms
// =================================================================

async function genPortfolio(W, outDir) {
  const H = W / 2;
  const G = sphereGrid(W, H);
  const nB = makeSimplex(201), nW = makeSimplex(202), nT = makeSimplex(203);
  const nS = makeSimplex(204), nF = makeSimplex(205), nP = makeSimplex(206);

  const pal = ramp([
    [0.0, "#06162b"],
    [0.16, "#0a2d55"],
    [0.32, "#0d4f7a"],
    [0.47, "#117e95"],
    [0.6, "#1fa9b8"],
    [0.74, "#5fd6e0"],
    [0.87, "#aeeff1"],
    [1.0, "#e4fdfb"],
  ]);

  // Band profile along latitude coordinate t in [-1, 1]
  const band = (t) => {
    const a = 0.5 + 0.5 * nB(t * 2.3, 0.3, 0.7);
    const b = 0.5 + 0.5 * nB(t * 5.2, 4.1, 1.9);
    const c = 0.5 + 0.5 * nB(t * 13.5, 8.2, 3.3);
    // equatorial zone slightly brighter, poles darker
    const lat = 1 - Math.abs(t);
    return clamp(0.6 * a + 0.28 * b + 0.12 * c + 0.2 * (lat - 0.6), 0, 1);
  };

  const rand = mulberry32(2077);
  // [lat, lon, radius(rad, along latitude), aspect (lon/lat), swirl strength]
  const vortices = [{ lat: -24, lon: 205, r: 0.16, asp: 1.75, s: 1.9, main: true }];
  for (let v = 0; v < 11; v++) {
    const la = (rand() * 2 - 1) * 62;
    vortices.push({ lat: la, lon: rand() * 360, r: 0.025 + rand() * 0.035, asp: 1.3 + rand() * 0.5, s: (rand() < 0.5 ? -1 : 1) * (1.8 + rand() * 1.5), main: false });
  }
  for (const v of vortices) {
    v.c = dirFromLatLon(v.lat, v.lon);
    // local tangent frame (east, north) at the vortex centre
    const e = [v.c[2], 0, -v.c[0]];
    const el = Math.hypot(e[0], e[2]) || 1;
    v.e = [e[0] / el, 0, e[2] / el];
    v.n = [v.c[1] * v.e[2] - v.c[2] * v.e[1], v.c[2] * v.e[0] - v.c[0] * v.e[2], v.c[0] * v.e[1] - v.c[1] * v.e[0]];
    // make sure n points north
    if (v.n[1] < 0) v.n = v.n.map((q) => -q);
  }

  const rgb = new Float32Array(W * H * 3);
  const q = [0, 0, 0], c = [0, 0, 0];
  const core = hex("#0a2a52"), ring = hex("#c8f7f5"), spot = hex("#d8fbf8");

  forEachPixel(G, (k, x, y, z) => {
    q[0] = x; q[1] = y; q[2] = z;
    let stormMask = 0, stormRing = 0, stormCore = 0;
    for (const v of vortices) {
      const dt = x * v.c[0] + y * v.c[1] + z * v.c[2];
      if (dt < 0.8) continue;
      const le = x * v.e[0] + y * v.e[1] + z * v.e[2];
      const ln = x * v.n[0] + y * v.n[1] + z * v.n[2];
      const dd = Math.sqrt((le / v.asp) * (le / v.asp) + ln * ln) / v.r; // elliptical radius
      if (dd > 3) continue;
      const fall = Math.exp(-dd * dd * 0.9);
      rotateAbout(q, v.c, v.s * fall * (1 - 0.35 * dd));
      if (v.main) {
        stormMask = Math.max(stormMask, smooth(1.15, 0.75, dd));
        // broken, patchy collar of bright cloud, heavier on the poleward side
        const patch = smooth(-0.25, 0.4, fbm(nF, x * 11, y * 11, z * 11, 3));
        const side = 0.55 - 0.45 * (ln / (v.r * dd + 1e-6));
        stormRing = Math.max(stormRing, Math.exp(-((dd - 1.05) * (dd - 1.05)) / 0.035) * patch * side);
        stormCore = Math.max(stormCore, smooth(1.0, 0.25, dd));
      } else {
        stormMask = Math.max(stormMask, smooth(1.1, 0.2, dd));
      }
    }
    const qx = q[0], qy = q[1], qz = q[2];
    const t0 = qy;
    // band-edge shear: turbulence concentrates where adjacent bands differ
    const db = Math.abs(band(t0 + 0.004) - band(t0 - 0.004)) / 0.008;
    const shear = smooth(0.3, 3.0, db);
    // iterated anisotropic warp -> long laminar filaments that curl at edges
    const wa = fbm(nW, qx * 1.6, qy * 6, qz * 1.6, 4, 2.0, 0.5);
    const wc = fbm(nS, qx * 1.6 + 7, qy * 6, qz * 1.6, 4, 2.0, 0.5);
    const k2 = 0.9 + 1.6 * shear;
    const wb = fbm(nT, qx * 3.2 + k2 * wa, qy * 11 + k2 * wc, qz * 3.2 - k2 * wa, 4, 2.0, 0.5);
    // Kelvin-Helmholtz wave trains riding the sharper edges (integer
    // wavenumbers in longitude keep the seam continuous; faded at the poles)
    const phi = Math.atan2(z, -x);
    const cl = 1 - y * y;
    const kh = Math.sin(phi * 38 + 6 * wa) * shear * cl * 0.006;
    const t = t0 + 0.02 * wa + (0.006 + 0.026 * shear) * wb + kh;
    let v = band(t);
    // contrast so belts reach deep blue and zones reach pale cyan
    v = clamp((v - 0.5) * 1.7 + 0.44);
    // fine flow streaks, strongly stretched along longitude
    const st = fbm(nF, qx * 9, qy * 110, qz * 9, 3);
    v = clamp(v + 0.035 * st + 0.05 * wb * shear);
    pal(v, c);
    // polar hoods: deeper, mottled
    const pole = smooth(0.78, 0.97, Math.abs(y));
    if (pole > 0) {
      const m = 0.5 + 0.5 * fbm(nP, x * 6, y * 6, z * 6, 5);
      const pc = pal(0.12 + 0.22 * m, [0, 0, 0]);
      c[0] = lerp(c[0], pc[0], pole * 0.8); c[1] = lerp(c[1], pc[1], pole * 0.8); c[2] = lerp(c[2], pc[2], pole * 0.8);
    }
    // storms: pale lifted cores, dark teal collar on the big one
    if (stormMask > 0) {
      // big storm: deep-blue eye; small ovals: pale cyan cloud tops
      const tgt = stormCore > 0 || stormRing > 0.01 ? core : spot;
      const amt = tgt === core ? 0.62 * stormCore + 0.15 * stormMask : 0.42 * stormMask * stormMask;
      c[0] = lerp(c[0], tgt[0], amt); c[1] = lerp(c[1], tgt[1], amt); c[2] = lerp(c[2], tgt[2], amt);
    }
    if (stormRing > 0) {
      c[0] = lerp(c[0], ring[0], stormRing * 0.75); c[1] = lerp(c[1], ring[1], stormRing * 0.75); c[2] = lerp(c[2], ring[2], stormRing * 0.75);
    }
    // subtle large-scale hue drift so hemispheres aren't identical
    const drift = 0.04 * fbm(nS, x * 1.2, y * 1.2, z * 1.2, 2);
    rgb[k * 3] = c[0] * (1 - drift);
    rgb[k * 3 + 1] = c[1];
    rgb[k * 3 + 2] = c[2] * (1 + drift);
  });
  await writeJpeg(rgb, W, H, path.join(outDir, "portfolio.jpg"));
}

// =================================================================
// 3. FUXX — violet/charcoal rock world with a glowing canyon network
// =================================================================

/**
 * Along-surface distance (radians) from a raw field `f` of 3D distances:
 * f / |surface gradient of f|. One-sided differences (max of left/right)
 * keep the V-shaped kink at a border from cancelling to zero. This removes
 * blobs where a Voronoi plane grazes the (warped) sphere.
 */
function surfaceDistance(f, G, k, j, i) {
  const { W, H, cosLat } = G;
  const step = (Math.PI * 2) / W;
  const il = (i + W - 1) % W, ir = (i + 1) % W;
  const ju = Math.max(0, j - 1), jd = Math.min(H - 1, j + 1);
  const v = f[k];
  const dx = Math.max(Math.abs(f[j * W + ir] - v), Math.abs(v - f[j * W + il])) / (step * Math.max(cosLat[j], 0.02));
  const dy = Math.max(Math.abs(f[jd * W + i] - v), Math.abs(v - f[ju * W + i])) / step;
  return v / Math.max(Math.hypot(dx, dy), 0.05);
}

async function genFuxx(W, outDir) {
  const H = W / 2;
  const G = sphereGrid(W, H);
  const n1 = makeSimplex(301), n2 = makeSimplex(302), n3 = makeSimplex(303);
  const n4 = makeSimplex(304), n5 = makeSimplex(305), n6 = makeSimplex(306);
  const n7 = makeSimplex(307), n8 = makeSimplex(308);
  const vMajor = makeVoronoi(311), vMid = makeVoronoi(312);
  const o1 = new Float64Array(8), o2 = new Float64Array(8);

  // impact craters: [centre, radius (rad)], power-law sizes
  const rand = mulberry32(3030);
  const craters = [];
  for (let i = 0; i < 160; i++) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    craters.push({ c: [r * Math.cos(a), u, r * Math.sin(a)], r: 0.006 + 0.07 * Math.pow(rand(), 4) });
  }
  for (const k of craters) k.cos = Math.cos(k.r * 1.6);

  const rock = ramp([
    [0.0, "#0d0a13"],
    [0.25, "#191422"],
    [0.5, "#272033"],
    [0.7, "#372d46"],
    [0.86, "#4e425f"],
    [1.0, "#6c5e7c"],
  ]);
  const floorC = hex("#2c0a40"), hotC = hex("#8a24b8");
  const gHot = hex("#ffc4ff"), gMid = hex("#e22cff"), gOut = hex("#8a14e0"), gTrace = hex("#9a3cff");

  const N = W * H;
  const rgb = new Float32Array(N * 3);
  const glow = new Float32Array(N * 3);
  const hgt = new Float32Array(N);
  // raw network fields, resolved to surface distance in pass 2
  const E1 = new Float32Array(N), J1 = new Float32Array(N), ON1 = new Uint8Array(N), END1 = new Uint8Array(N), WN = new Float32Array(N);
  const E2 = new Float32Array(N), J2 = new Float32Array(N), ON2 = new Float32Array(N);
  const SEG = new Float32Array(N), BUS = new Float32Array(N), LANES = new Uint8Array(N);

  // ---------------- pass 1: rock + raw network fields
  forEachPixel(G, (k, x, y, z) => {
    const wx = fbm(n1, x * 1.8 + 1.7, y * 1.8, z * 1.8, 3);
    const wy = fbm(n1, x * 1.8, y * 1.8 - 3.3, z * 1.8, 3);
    const wz = fbm(n1, x * 1.8, y * 1.8, z * 1.8 + 6.1, 3);
    const qx = x + 0.07 * wx, qy = y + 0.07 * wy, qz = z + 0.07 * wz;

    // rock: plains + ridged highlands, terraced into mesas, cratered
    const base = fbm(n2, qx * 2.6, qy * 2.6, qz * 2.6, 7, 2.05, 0.5);
    const hi = ridged(n3, qx * 4.5, qy * 4.5, qz * 4.5, 6);
    const highland = smooth(-0.05, 0.35, fbm(n4, x * 1.3, y * 1.3, z * 1.3, 3));
    let h = 0.48 + 0.32 * base + 0.32 * hi * highland;
    const steps = 7;
    const ter = Math.floor(h * steps) / steps + smooth(0.75, 1, (h * steps) % 1) / steps;
    h = lerp(h, ter, 0.55 * highland);
    for (const cr of craters) {
      const d = x * cr.c[0] + y * cr.c[1] + z * cr.c[2];
      if (d < cr.cos) continue;
      const rr = Math.acos(Math.min(1, d)) / cr.r;
      const sz = Math.min(1, cr.r * 25);
      if (rr < 1) h -= 0.16 * (1 - rr * rr) * sz;
      h += 0.07 * Math.exp(-((rr - 1) * (rr - 1)) / 0.03) * sz;
    }
    h += 0.045 * fbm(n5, qx * 40, qy * 40, qz * 40, 3);
    h += 0.07 * (ridged(n7, qx * 16, qy * 16, qz * 16, 4) - 0.5) * (0.4 + 0.6 * highland);
    hgt[k] = h;

    const c = rock(clamp(0.5 + (h - 0.5) * 0.75), [0, 0, 0]);
    const sp = 1 + 0.1 * fbm(n4, x * 45, y * 45, z * 45, 3) + 0.05 * n5(x * 160, y * 160, z * 160);
    // dark basalt plains (smooth, cool violet) vs dusty rugged highlands
    const plains = smooth(0.05, -0.3, fbm(n4, x * 1.3, y * 1.3, z * 1.3, 4));
    const pr = lerp(1, 0.62, plains), pb = lerp(1, 0.8, plains);
    const dust = 1 + 0.12 * highland * smooth(0.55, 0.8, h);
    rgb[k * 3] = c[0] * sp * pr * dust; rgb[k * 3 + 1] = c[1] * sp * pr * 0.97 * dust; rgb[k * 3 + 2] = c[2] * sp * pb * 1.04 * dust;

    // major rifts: partial Voronoi borders (some borders stay sealed)
    vMajor(qx * 2.3, qy * 2.3, qz * 2.3, o1);
    E1[k] = o1[0]; J1[k] = o1[1]; ON1[k] = o1[2] < 0.58 ? 1 : 0; END1[k] = o1[7] < 0.58 ? 0 : 1;
    WN[k] = 0.5 + 0.5 * n6(qx * 5, qy * 5, qz * 5);
    // mid faults, only in some provinces
    vMid(qx * 5.5 + 0.3 * wx, qy * 5.5, qz * 5.5, o2);
    E2[k] = o2[0]; J2[k] = o2[1];
    ON2[k] = o2[2] < 0.5 ? smooth(-0.2, 0.25, fbm(n7, x * 1.9, y * 1.9, z * 1.9, 3)) : 0;
    // uneven brightness per stretch so the net "pulses"
    SEG[k] = 0.5 + 0.5 * smooth(-0.4, 0.5, n6(qx * 4 + 3, qy * 4, qz * 4));
    // circuit flavour: parallel "bus" traces along some rift stretches
    BUS[k] = smooth(0.05, 0.3, n8(qx * 3.1, qy * 3.1, qz * 3.1));
    LANES[k] = 1 + Math.floor((0.5 + 0.5 * n8(qx * 1.3 + 4, qy * 1.3, qz * 1.3)) * 3.5);
  });

  // ---------------- pass 2: resolve network in true surface distance
  const { gE, gN } = sphereGradient(hgt, G, 0.032);
  const px = (Math.PI * 2) / 2048; // widths are authored in 2048-px units
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const on1 = ON1[k], on2 = ON2[k], seg = SEG[k];
      const s1 = surfaceDistance(E1, G, k, j, i);
      const t1 = surfaceDistance(J1, G, k, j, i);
      const s2 = surfaceDistance(E2, G, k, j, i);
      const t2 = surfaceDistance(J2, G, k, j, i);

      let w1 = (2.4 + 3.2 * WN[k]) * px; // rift half-width
      // where the neighbouring border is sealed the rift is a dead end:
      // taper it to a point instead of a square cut
      if (END1[k]) w1 *= 0.15 + 0.85 * smooth(0, 14 * px, t1 - s1);
      const rift = on1 * (1 - smooth(w1 * 0.45, w1, s1));
      const riftWall = on1 * Math.exp(-((s1 / (w1 * 2.6)) ** 2));
      const node1 = on1 * (1 - smooth(3 * px, 9 * px, t1)) * (1 - smooth(0, 6 * px, s1));
      const fault = on2 * (1 - smooth(0.5 * px, 1.4 * px, s2));
      const faultWall = on2 * Math.exp(-((s2 / (4 * px)) ** 2));
      const node2 = on2 * (1 - smooth(1.5 * px, 4 * px, t2)) * (1 - smooth(0, 3 * px, s2));
      let bus = 0;
      if (on1 && BUS[k] > 0) {
        for (let l = 1; l <= LANES[k]; l++) {
          const off = w1 + (2.5 + 3.6 * l) * px;
          bus = Math.max(bus, 1 - smooth(0.45 * px, 1.1 * px, Math.abs(s1 - off)));
        }
        bus *= BUS[k];
      }
      const canyon = Math.max(rift, fault);

      // colour: relief-shaded rock, dark walls, magenta floors, faint traces
      const gx = gE[k], gy = gN[k];
      const slope = Math.sqrt(gx * gx + gy * gy);
      let m = clamp(1 + 0.55 * (gy * 0.7 - gx * 0.7) / (1 + 0.6 * slope) - 0.25 * smooth(0.3, 2.5, slope), 0.35, 1.6);
      m *= 1 - 0.5 * riftWall * (1 - rift) - 0.25 * faultWall * (1 - fault);
      let r = rgb[k * 3] * m, g = rgb[k * 3 + 1] * m, b = rgb[k * 3 + 2] * m;
      if (canyon > 0) {
        const fc = mix3(floorC, hotC, Math.max(rift, fault * 0.6) * seg);
        r = lerp(r, fc[0], canyon); g = lerp(g, fc[1], canyon); b = lerp(b, fc[2], canyon);
      }
      const tr = bus * (1 - canyon);
      r = lerp(r, 0.3, tr * 0.5); g = lerp(g, 0.1, tr * 0.5); b = lerp(b, 0.45, tr * 0.5);
      rgb[k * 3] = r; rgb[k * 3 + 1] = g; rgb[k * 3 + 2] = b;

      // emissive
      const core = Math.max(rift, 0.55 * fault) * seg;
      const halo = (0.22 * on1 * Math.exp(-((s1 / (w1 * 3)) ** 2)) + 0.1 * on2 * Math.exp(-((s2 / (5 * px)) ** 2))) * seg;
      const gc = Math.min(1, core + Math.max(node1, 0.7 * node2) * 0.8 * seg);
      const hot = clamp((gc - 0.55) * 2.2);
      glow[k * 3] = gOut[0] * halo + lerp(gMid[0], gHot[0], hot) * gc + gTrace[0] * tr * 0.55;
      glow[k * 3 + 1] = gOut[1] * halo + lerp(gMid[1], gHot[1], hot) * gc + gTrace[1] * tr * 0.55;
      glow[k * 3 + 2] = gOut[2] * halo + lerp(gMid[2], gHot[2], hot) * gc + gTrace[2] * tr * 0.55;
    }
  }
  await writeJpeg(rgb, W, H, path.join(outDir, "fuxx.jpg"));
  await writeJpeg(glow, W, H, path.join(outDir, "fuxx_glow.jpg"));
}

// ------------------------------------------------------------------- main

const GENERATORS = { ruangrapi: genRuangrapi, portfolio: genPortfolio, fuxx: genFuxx };

async function main() {
  const args = process.argv.slice(2);
  const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
  const names = args.filter((a) => !a.startsWith("--"));
  const W = Number(opt.width ?? 2048);
  if (!Number.isInteger(W) || W % 2) throw new Error("--width must be an even integer");
  const outDir = path.resolve(opt.out ?? path.join(ROOT, "assets-src"));
  mkdirSync(outDir, { recursive: true });
  const todo = names.length ? names : Object.keys(GENERATORS);
  for (const name of todo) {
    const gen = GENERATORS[name];
    if (!gen) throw new Error(`unknown planet "${name}" (expected: ${Object.keys(GENERATORS).join(", ")})`);
    const t = Date.now();
    console.log(`${name} @ ${W}x${W / 2}`);
    await gen(W, outDir);
    console.log(`  ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
