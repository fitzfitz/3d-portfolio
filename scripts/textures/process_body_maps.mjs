#!/usr/bin/env node
/**
 * Turns the NASA / USGS public-domain global maps (fetch_nasa_maps.mjs) into
 * the bodies' and moons' shipped maps (real-solar-system spec §5.5), and
 * encodes the seeded ones (gen_body_maps.mjs) next to them.
 *
 *   node scripts/textures/fetch_nasa_maps.mjs     # first: sources into assets-src/nasa-src/
 *   node scripts/textures/gen_body_maps.mjs       # Venus, Titan, the Triton fill
 *   node scripts/textures/process_body_maps.mjs   # all; or name maps: ... mercury io
 *
 * For each sourced map, at each width it ships at (2048; 4096 for the
 * desktop-only `_4k` variant):
 *   1. decode; NoData (pure black: the mosaics' unimaged gaps) becomes a mask;
 *   2. resample to the equirect tier (2:1), the mask with it, so a gap's black
 *      never bleeds into its border;
 *   3. lay out longitude in the game's one convention: east-positive, -180° at
 *      u = 0, the prime meridian at u = 0.5 (THREE.SphereGeometry's u, as
 *      gen_planets.mjs's maps): products drawn 0..360 are rolled half a turn
 *      (each source's `longitude` note, from its PDS/ISIS label);
 *   4. fill the gaps by pull-push (smooth, from all sides, wrapping in
 *      longitude); Triton's unimaged north gets gen_body_maps.mjs's seeded
 *      detail on top, scaled to the imaged part's own texture contrast;
 *   5. colour: single-band ("true-grey") mosaics get one uniform tint from
 *      the body's visible colour; MESSENGER's and Triton's enhanced colour
 *      keep only part of their chroma (BODY_MAPS `color`);
 *   6. scale in linear light so the linear-luminance texel median is
 *      0.177 × the body's NASA geometric albedo (the scene's scale; Earth's
 *      is the mean under its cloud layer, see below);
 *   7. even out the last rows at each pole (a sphere's pole is one point)
 *      and spread any step across the ±180° seam over a few columns;
 *   8. write a q95 JPEG master into assets-src/ (4K ones in assets-src/4k/)
 *      and the WebP visitors download into public/models/.
 *
 * Earth: the surface (Blue Marble NG) and the cloud layer (The Blue Marble
 * clouds, drawn as an alpha-mapped shell) are one image to the eye, so the
 * rule is applied to the two together: surface and clouds take the same
 * linear scale k, the cloud shell's colour is k (the cloud map's white).
 * - The cloud shell's opacity is the cloud grey^γ (CLOUD_OPACITY_GAMMA),
 *   shipped sRGB-encoded for SolarBodies's sRGB upload. The grey is
 *   display-encoded (NASA composites it as stored, in sRGB): taken as a
 *   linear opacity (γ 1), its thin haze (median grey 0.24) veiled every
 *   ocean in grey; fully decoded (≈ γ 2.2) the haze all but vanished.
 * - k puts the MEAN of surface·(1 − α) + k·α at 0.177 × 0.434: geometric
 *   albedo is a disc average, and on a two-tone planet (bright cloud, dark
 *   sea) the median texel is open ocean, so the median rule would have
 *   lifted the oceans to the planet's average (k ≈ 0.48, cloud tops past
 *   0.177 × 2).
 * - Before that, the surface gets the Rayleigh sky's own reflectance, which
 *   Earth's geometric albedo includes and the Blue Marble (a surface map)
 *   leaves out; without it the oceans are black. Single scattering is
 *   τ·P/(4 μ μ0), 0.375 τ at nadir (P = 1.5); averaged over the lit disc
 *   inside the limb (μ ≥ 0.4, where the atmosphere shell takes over) it is
 *   about twice that against a Lambert surface's μ0, so the map takes
 *   0.75 τ for τ = 0.05 / 0.10 / 0.24 at 650 / 550 / 450 nm. The nadir value
 *   alone left clear ocean at a tenth of the cloud tops' blue, where seen
 *   from orbit it is about a fifth (≈ 0.15 against ≈ 0.7 at 450 nm).
 * The night lights are Black Marble 2016's grey map, black-pointed at 2% so
 * only lights glow.
 *
 * Prints each shipped map's measured linear median (Earth's mean under its
 * clouds): those are the `texelMedianLinear` values in
 * src/data/solarSystem.ts and solarMoons.ts (tests/bodyMaps.test.ts holds
 * them to 3%).
 */
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NASA_SRC, SOURCES } from "./fetch_nasa_maps.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets-src");
const OUT = path.join(ROOT, "public", "models");

/** The scene's albedo scale (Jupiter's 0.538 ↔ its old map's 0.095). */
export const ALBEDO_SCALE = 0.177;

const GEN_BODY = "scripts/textures/gen_body_maps.mjs";
const GEN_WORLDS = "scripts/textures/gen_worlds.mjs";

/**
 * Every map a body or moon draws. `albedo`: NASA NSSDC geometric albedo
 * (planetary and satellite fact sheets). `roll`: half a turn for products
 * drawn 0..360. `gaps`: the product has NoData (pure black) to fill.
 * `color.grey`: a single-band mosaic, tinted by `tint` (linear R:G:B,
 * normalised to unit luminance); `color.chroma`: the share of the product's
 * colour kept around its luminance. `quality`: WebP quality (inside
 * tests/bodyMaps.test.ts's byte caps).
 */
export const BODY_MAPS = {
  mercury: {
    sources: ["mdis-color-665m"], albedo: 0.142, hiRes: true, gaps: true, poleCut: 82, quality: 82,
    // MDIS's colour is enhanced; Mercury's true colour is a faintly warm grey.
    color: { chroma: 0.2, tint: [1.04, 1, 0.9] },
  },
  venus: { generator: GEN_BODY, albedo: 0.689, quality: 90 },
  earth: { sources: ["bmng-2004-07", "bm-clouds"], albedo: 0.434, hiRes: true, quality: 86 },
  earth_clouds: { sources: ["bm-clouds"], quality: 72 },
  earth_night: { sources: ["black-marble-2016"], quality: 82 },
  mars: { sources: ["viking-mdim21-color"], albedo: 0.17, hiRes: true, quality: 84 },
  ceres: { sources: ["dawn-fc-20ppd"], albedo: 0.09, roll: true, gaps: true, poleCut: 80, quality: 82, color: { grey: true, tint: [1, 1, 1.02] } },
  jupiter: { sources: ["pia07782"], albedo: 0.538, quality: 86 },
  // Saturn, Uranus and Neptune: no true-colour global map exists; the seeded
  // Cassini/Voyager-calibrated maps stay (gen_worlds.mjs; optimize-assets.mjs
  // encodes them).
  "w-ringed": { generator: GEN_WORLDS, keep: true },
  "w-tilted": { generator: GEN_WORLDS, keep: true },
  "w-blue": { generator: GEN_WORLDS, keep: true },
  moon: { sources: ["cgi-moon-kit"], albedo: 0.12, quality: 84 },
  io: { sources: ["io-ssi-voyager-clrmerge-1km"], albedo: 0.62, quality: 84 },
  europa: { sources: ["europa-ssi-voyager-500m"], albedo: 0.68, roll: true, gaps: true, quality: 78, color: { grey: true, tint: [1, 0.96, 0.86] } },
  ganymede: { sources: ["ganymede-ssi-voyager-clr-1435m"], albedo: 0.44, roll: true, gaps: true, quality: 78 },
  callisto: { sources: ["callisto-ssi-voyager-1km"], albedo: 0.19, roll: true, gaps: true, quality: 78, color: { grey: true, tint: [1, 0.92, 0.8] } },
  titan: { generator: GEN_BODY, albedo: 0.22, quality: 90 },
  triton: {
    sources: ["pia18668"], albedo: 0.72, gaps: true, fill: "triton_fill", quality: 84,
    // PIA18668 is enhanced colour; Triton is a pale, faintly pink grey.
    color: { chroma: 0.35, tint: [1, 0.95, 0.92] },
  },
};

// ------------------------------------------------------------ colour helpers

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const LUT = Float32Array.from({ length: 256 }, (_, i) => s2l(i / 255));
const lum3 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const medianOf = (a) => a.slice().sort()[a.length >> 1];
const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function luminance(lin, n) {
  const L = new Float32Array(n);
  for (let k = 0; k < n; k++) L[k] = lum3(lin[k * 3], lin[k * 3 + 1], lin[k * 3 + 2]);
  return L;
}

// ------------------------------------------------------------ resampling

/**
 * Decoded at W × W/2: linear RGB (Float32, 3 per texel) and coverage (1 where
 * the product imaged the whole texel, else 0). Gaps are pure black (≤ 1 of
 * 255: MDIS's holes are 1). A texel that only partly covers imaged ground is
 * a gap too, and the imaged region is eroded by `erode` texels more: the
 * mosaics' edges carry dark fringes that would otherwise bleed into the fill.
 * `poleCut` (deg) also drops latitudes past it, where a product's polar
 * reprojection is smeared.
 */
async function load(file, W, gaps, poleCut) {
  const H = W / 2;
  const opts = { limitInputPixels: false };
  const rgb = await sharp(file, opts).removeAlpha().toColourspace("srgb").resize(W, H, { fit: "fill" }).raw().toBuffer();
  const lin = new Float32Array(W * H * 3);
  for (let k = 0; k < lin.length; k++) lin[k] = LUT[rgb[k]];
  const cov = new Float32Array(W * H).fill(1);
  if (gaps) {
    const m = await sharp(file, opts).removeAlpha().greyscale().threshold(2).resize(W, H, { fit: "fill", kernel: "linear" }).raw().toBuffer();
    for (let k = 0; k < W * H; k++) cov[k] = m[k] >= 254 ? 1 : 0;
    erode(cov, W, H, Math.max(2, Math.round((3 * W) / 2048)));
  }
  if (poleCut) {
    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      if (Math.abs(lat) > poleCut) cov.fill(0, y * W, (y + 1) * W);
    }
  }
  return { lin, cov, W, H };
}

/** Shrinks the 1-region of a 0/1 mask by r texels (separable minimum, wrapping in x). */
function erode(m, W, H, r) {
  const tmp = new Float32Array(m.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1;
    for (let d = -r; d <= r && v; d++) v = Math.min(v, m[y * W + (((x + d) % W) + W) % W]);
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1;
    for (let d = -r; d <= r && v; d++) { const yy = y + d; if (yy >= 0 && yy < H) v = Math.min(v, tmp[yy * W + x]); }
    m[y * W + x] = v;
  }
}

/** Rolls every row by half its width (0..360 products to -180..180). */
function roll(buf, W, H, ch) {
  const out = new Float32Array(buf.length), half = W / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = (y * W + x) * ch, b = (y * W + ((x + half) % W)) * ch;
    for (let c = 0; c < ch; c++) out[b + c] = buf[a + c];
  }
  return out;
}

/**
 * Pull-push fill: every texel with coverage 0 takes the coverage-weighted
 * colour of its surroundings, from successively coarser levels, so a gap
 * fills smoothly from all its sides. Wraps in longitude.
 */
function pullPush(lin, cov, W, H) {
  const levels = [{ W, H, c: Float32Array.from(lin, (v, i) => v * cov[(i / 3) | 0]), w: Float32Array.from(cov) }];
  while (levels.at(-1).W > 1 || levels.at(-1).H > 1) {
    const p = levels.at(-1);
    const W2 = Math.max(1, p.W >> 1), H2 = Math.max(1, p.H >> 1);
    const c = new Float32Array(W2 * H2 * 3), w = new Float32Array(W2 * H2);
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
      const k = y * p.W + x, k2 = Math.min(H2 - 1, y >> 1) * W2 + Math.min(W2 - 1, x >> 1);
      w[k2] += p.w[k];
      for (let i = 0; i < 3; i++) c[k2 * 3 + i] += p.c[k * 3 + i];
    }
    // Clamp weights to 1, keeping the colour normalised.
    for (let k = 0; k < W2 * H2; k++) if (w[k] > 1) { for (let i = 0; i < 3; i++) c[k * 3 + i] /= w[k]; w[k] = 1; }
    levels.push({ W: W2, H: H2, c, w });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l], q = levels[l + 1];
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
      const k = y * p.W + x;
      if (p.w[k] >= 1) continue;
      // bilinear sample of the coarser level (normalised), wrapping in x
      const fx = ((x + 0.5) / p.W) * q.W - 0.5, fy = Math.min(q.H - 1, Math.max(0, ((y + 0.5) / p.H) * q.H - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const y1 = Math.min(q.H - 1, y0 + 1);
      const xs = [((x0 % q.W) + q.W) % q.W, (((x0 + 1) % q.W) + q.W) % q.W];
      for (let i = 0; i < 3; i++) {
        const s = (yy, xx) => q.c[(yy * q.W + xx) * 3 + i] / Math.max(q.w[yy * q.W + xx], 1e-9);
        const v = (1 - ty) * ((1 - tx) * s(y0, xs[0]) + tx * s(y0, xs[1])) + ty * ((1 - tx) * s(y1, xs[0]) + tx * s(y1, xs[1]));
        p.c[k * 3 + i] += (1 - p.w[k]) * v;
      }
      p.w[k] = 1;
    }
  }
  return levels[0].c;
}

/** Separable box blur (radius r texels, wrapping in x), `passes` times: a cheap Gaussian. */
function blur(a, W, H, r, passes = 3) {
  let src = Float32Array.from(a);
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[y * W + ((d % W) + W) % W];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = s / (2 * r + 1);
        s += src[y * W + ((x + r + 1) % W)] - src[y * W + ((x - r) % W + W) % W];
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let s = 0, n = 0;
        for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++; } }
        src[y * W + x] = s / n;
      }
    }
  }
  return src;
}

// ------------------------------------------------------------ finishing

/** Rows within `deg` of each pole ease toward their row mean (exactly uniform at the pole row). */
function evenPoles(buf, W, H, ch, deg = 2.5) {
  const P = Math.max(2, Math.round((deg / 180) * H));
  for (const [j, t] of Array.from({ length: P }, (_, j) => [j, ((P - j) / P) ** 2]).flatMap(([j, t]) => [[j, t], [H - 1 - j, t]])) {
    const mean = new Float64Array(ch);
    for (let x = 0; x < W; x++) for (let c = 0; c < ch; c++) mean[c] += buf[(j * W + x) * ch + c] / W;
    for (let x = 0; x < W; x++) for (let c = 0; c < ch; c++) {
      const k = (j * W + x) * ch + c;
      buf[k] = buf[k] * (1 - t) + mean[c] * t;
    }
  }
}

/** Spreads the step between the last and first columns over B columns each side, so ±180° meets. */
function closeSeam(buf, W, H, ch, B = 8) {
  for (let y = 0; y < H; y++) for (let c = 0; c < ch; c++) {
    const a = (y * W) * ch + c, b = (y * W + W - 1) * ch + c;
    const d = (buf[a] - buf[b]) / 2;
    for (let x = 0; x < B; x++) {
      const t = 1 - x / B;
      buf[(y * W + x) * ch + c] -= d * t;
      buf[(y * W + W - 1 - x) * ch + c] += d * t;
    }
  }
}

/** Scales linear RGB so the luminance median is `target`; returns the factor. */
function calibrate(lin, n, target) {
  const s = target / Math.max(medianOf(luminance(lin, n)), 1e-9);
  for (let k = 0; k < lin.length; k++) lin[k] = clamp01(lin[k] * s);
  return s;
}

function applyColor(lin, n, color) {
  if (!color) return;
  const t = color.tint ?? [1, 1, 1];
  const tl = lum3(t[0], t[1], t[2]);
  const keep = color.grey ? 0 : (color.chroma ?? 1);
  for (let k = 0; k < n; k++) {
    const L = lum3(lin[k * 3], lin[k * 3 + 1], lin[k * 3 + 2]);
    for (let i = 0; i < 3; i++) lin[k * 3 + i] = Math.max(0, (L + keep * (lin[k * 3 + i] - L)) * (t[i] / tl));
  }
}

const toBytes = (lin) => {
  const out = Buffer.alloc(lin.length);
  for (let k = 0; k < lin.length; k++) out[k] = Math.round(l2s(clamp01(lin[k])) * 255);
  return out;
};

async function write(name, W, H, bytes, ch, quality) {
  const hi = W > 2048;
  const masterDir = hi ? path.join(SRC, "4k") : SRC;
  mkdirSync(masterDir, { recursive: true });
  const master = path.join(masterDir, `${name}.jpg`);
  await sharp(bytes, { raw: { width: W, height: H, channels: ch } }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toFile(master);
  const webp = path.join(OUT, `${name}${hi ? "_4k" : ""}.webp`);
  await sharp(master).webp({ quality }).toFile(webp);
  return webp;
}

/**
 * Linear-luminance median of a shipped WebP (what the tests measure); with
 * `clouds` (Earth), the mean under the cloud shell, its grey decoded from sRGB.
 */
export async function shippedMedian(file, clouds) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height, L = new Float32Array(n);
  for (let k = 0; k < n; k++) L[k] = lum3(LUT[data[k * info.channels]], LUT[data[k * info.channels + 1]], LUT[data[k * info.channels + 2]]);
  if (!clouds) return medianOf(L);
  const a = await sharp(clouds.file).resize(info.width, info.height, { fit: "fill" }).greyscale().raw().toBuffer();
  for (let k = 0; k < n; k++) L[k] = L[k] * (1 - LUT[a[k]]) + clouds.linear * LUT[a[k]];
  return meanOf(L);
}

// ------------------------------------------------------------ recipes

const srcFile = (id) => path.join(NASA_SRC, SOURCES[id].file);

async function processSourced(name, r, W) {
  const H = W / 2, n = W * H;
  let { lin, cov } = await load(srcFile(r.sources[0]), W, !!r.gaps, r.poleCut);
  if (r.roll) { lin = roll(lin, W, H, 3); cov = roll(cov, W, H, 1); }
  if (r.gaps || r.poleCut) {
    const valid = Float32Array.from(cov);
    lin = pullPush(lin, cov, W, H);
    if (r.fill) {
      // Seeded detail over the smooth fill, at the imaged part's own contrast
      // (relative luminance deviation from a ~4°-blurred version of itself).
      const fillPng = path.join(SRC, `${r.fill}.png`);
      if (!existsSync(fillPng)) throw new Error(`${fillPng} missing: run ${GEN_BODY} first`);
      const g = await sharp(fillPng).resize(W, H, { fit: "fill" }).greyscale().raw().toBuffer();
      const L = luminance(lin, n);
      const Lb = blur(L, W, H, Math.max(1, Math.round(W / 270)));
      let s2 = 0, cnt = 0;
      for (let k = 0; k < n; k++) if (valid[k]) { const d = L[k] / Math.max(Lb[k], 1e-6) - 1; s2 += d * d; cnt++; }
      const amp = Math.sqrt(s2 / Math.max(cnt, 1));
      // feather: the seeded texture fades in over ~1.5° into the gap
      const edge = blur(valid, W, H, Math.max(1, Math.round(W / 720)));
      for (let k = 0; k < n; k++) {
        if (valid[k]) continue;
        const f = 1 + amp * ((g[k] / 255 - 0.5) / 0.12) * (1 - edge[k]);
        for (let i = 0; i < 3; i++) lin[k * 3 + i] *= Math.max(0, f);
      }
    }
  }
  applyColor(lin, n, r.color);
  const scale = calibrate(lin, n, ALBEDO_SCALE * r.albedo);
  evenPoles(lin, W, H, 3);
  closeSeam(lin, W, H, 3);
  return { bytes: toBytes(lin), scale };
}

/**
 * The cloud shell's opacity from The Blue Marble's cloud grey g (0..1):
 * g^CLOUD_OPACITY_GAMMA. γ = 1 drew the grey as stored (its thin haze veiled
 * every ocean); γ ≈ 2.2 is the grey's full sRGB decode, as NASA composites
 * it (thin haze all but vanishes). The shipped earth_clouds map holds the
 * opacity sRGB-encoded, so SolarBodies's sRGB upload decodes it on the GPU
 * with the dark end's precision and no shader change. Tunable:
 * CLOUD_GAMMA=1.3 node scripts/textures/process_body_maps.mjs earth
 * (then copy the printed k into solarSystem.ts `look.clouds.linear`).
 */
export const CLOUD_OPACITY_GAMMA = Number(process.env.CLOUD_GAMMA ?? 1.3);
const cloudOpacity = (g) => g ** CLOUD_OPACITY_GAMMA;

/** The Rayleigh sky's reflectance over the disc at 650 / 550 / 450 nm (0.75 τ; see the header). */
const RAYLEIGH = [0.75 * 0.05, 0.75 * 0.1, 0.75 * 0.24];

/** Earth's surface at width W; `k` (the shared surface-and-cloud scale) is solved here at 2048. */
async function processEarth(W, kGiven) {
  const H = W / 2, n = W * H;
  const { lin } = await load(srcFile("bmng-2004-07"), W, false);
  for (let k = 0; k < n; k++) for (let i = 0; i < 3; i++) lin[k * 3 + i] += RAYLEIGH[i];
  let k = kGiven;
  if (k === undefined) {
    const a = await sharp(srcFile("bm-clouds")).resize(W, H, { fit: "fill" }).greyscale().raw().toBuffer();
    const L = luminance(lin, n);
    for (let j = 0; j < n; j++) { const o = cloudOpacity(a[j] / 255); L[j] = L[j] * (1 - o) + o; }
    k = (ALBEDO_SCALE * BODY_MAPS.earth.albedo) / meanOf(L);
  }
  for (let j = 0; j < lin.length; j++) lin[j] = clamp01(lin[j] * k);
  evenPoles(lin, W, H, 3);
  closeSeam(lin, W, H, 3);
  return { bytes: toBytes(lin), scale: k };
}

/**
 * A single-band map at 2048: `transfer` maps the source grey (0..1, after the
 * black point) to the value wanted, `encode` that value to the stored 0..1.
 * The night lights are stored as is; the cloud cover is its opacity,
 * sRGB-encoded (CLOUD_OPACITY_GAMMA).
 */
async function processGrey(id, W, { blackPoint = 0, transfer = (v) => v, encode = (v) => v } = {}) {
  const H = W / 2;
  const g = await sharp(srcFile(id)).greyscale().resize(W, H, { fit: "fill" }).raw().toBuffer();
  const f = Float32Array.from(g, (v) => transfer(clamp01((v / 255 - blackPoint) / (1 - blackPoint))));
  evenPoles(f, W, H, 1);
  closeSeam(f, W, H, 1);
  return Buffer.from(Uint8Array.from(f, (v) => Math.round(clamp01(encode(clamp01(v))) * 255)));
}

async function main() {
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));
  mkdirSync(OUT, { recursive: true });
  const results = [];
  let earthK;
  const want = (n) => only.size === 0 || only.has(n);
  for (const [name, r] of Object.entries(BODY_MAPS)) {
    if (r.keep || !want(name) && !(name === "earth_clouds" && want("earth"))) continue;
    const t = Date.now();
    if ("generator" in r) {
      const master = path.join(SRC, `${name}.jpg`);
      if (!existsSync(master)) throw new Error(`${master} missing: run ${r.generator} first`);
      await sharp(master).webp({ quality: r.quality }).toFile(path.join(OUT, `${name}.webp`));
    } else if (name === "earth") {
      for (const W of [2048, 4096]) {
        const { bytes, scale } = await processEarth(W, earthK);
        earthK ??= scale;
        await write(name, W, W / 2, bytes, 3, r.quality);
      }
    } else if (name === "earth_clouds") {
      await write(name, 2048, 1024, await processGrey("bm-clouds", 2048, { transfer: cloudOpacity, encode: l2s }), 1, r.quality);
    } else if (name === "earth_night") {
      // The grey 2016 map is black but for the lights (≥ 90% of texels are 0);
      // a 2% black point drops the JPEG's noise floor so only lights glow.
      await write(name, 2048, 1024, await processGrey("black-marble-2016", 2048, { blackPoint: 0.02 }), 1, r.quality);
    } else {
      for (const W of r.hiRes ? [2048, 4096] : [2048]) {
        const { bytes, scale } = await processSourced(name, r, W);
        await write(name, W, W / 2, bytes, 3, r.quality);
        if (W === 2048) results.push({ name, scale: +scale.toFixed(4) });
      }
    }
    console.log(`${name}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  if (earthK !== undefined) console.log(`earth: surface and cloud scale k = ${earthK.toFixed(5)} (the cloud shell's linear colour)`);
  // What the tests measure: the shipped files' medians (Earth's mean under its clouds).
  const cloudLinear = earthK;
  for (const [name, r] of Object.entries(BODY_MAPS)) {
    if (r.albedo === undefined || !want(name)) continue;
    for (const f of [`${name}.webp`, `${name}_4k.webp`].map((x) => path.join(OUT, x)).filter(existsSync)) {
      const clouds = name === "earth" && cloudLinear !== undefined ? { file: path.join(OUT, "earth_clouds.webp"), linear: cloudLinear } : undefined;
      const m = await shippedMedian(f, clouds);
      console.log(`  ${path.basename(f)}: ${clouds ? "mean under its clouds" : "median"} ${m.toFixed(5)} (target ${(ALBEDO_SCALE * r.albedo).toFixed(5)})`);
    }
  }
  if (results.length) console.log("linear scales:", JSON.stringify(results));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
