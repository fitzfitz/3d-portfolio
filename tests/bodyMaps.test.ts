import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { SOLAR_MOONS } from "../src/data/solarMoons";
import { packTier } from "../src/utils/packFormat";
import { SUN_COLOR } from "../src/utils/sunLight";
import { SOURCES } from "../scripts/textures/fetch_nasa_maps.mjs";
import { BODY_MAPS } from "../scripts/textures/process_body_maps.mjs";
import { readKtx2 } from "./ktx2Image";

/** The pinned sources, looked up by a recipe's source id. */
const SOURCE_BY_ID: Record<string, (typeof SOURCES)[keyof typeof SOURCES]> = SOURCES;

/**
 * The real bodies' and moons' shipped maps (real-solar-system spec §5.5):
 * provenance (each NASA/USGS map pins its source URL and SHA-256, the rest
 * name their seeded generator), honest albedo on the scene's scale, shape,
 * seam, poles, per-file and per-pack byte caps, the ring strip's real
 * profile and generator determinism. Reads public/models, so it checks
 * exactly what visitors download.
 */

const MODELS = "public/models";
/** A map ships as WebP, or as KTX2 where encode_ktx2.mjs compressed it (Earth's 4096 map). */
const file = (name: string) => (existsSync(`${MODELS}/${name}.ktx2`) ? `${MODELS}/${name}.ktx2` : `${MODELS}/${name}.webp`);
const shipped = (name: string) => path.basename(file(name));

/** The scene's albedo scale: a map's linear median is 0.177 × its body's geometric albedo (Jupiter's 0.538 ↔ 0.095). */
const ALBEDO_SCALE = 0.177;

/** Every albedo-carrying surface: the nine bodies and the moons drawn as spheres (Phobos and Deimos are shape models, Task 14). */
const SURFACES = [
  ...SOLAR_BODIES.map((b) => ({ id: b.id, map: b.map, hiRes: !!b.mapHiRes, albedo: b.geometricAlbedo, stat: b.texelMedianLinear })),
  ...SOLAR_MOONS.filter((m) => !m.shape).map((m) => ({ id: m.id, map: m.map, hiRes: false, albedo: m.geometricAlbedo, stat: m.texelMedianLinear })),
];
const EARTH = bodyById("earth");
const CLOUDS = EARTH.look.clouds!;
const NIGHT = EARTH.look.nightLights!;
/** Every equirect map a body or moon draws (albedo maps, Earth's cloud alpha and night lights), without the _4k variants. */
const EQUIRECT = [...new Set([...SURFACES.map((s) => s.map), CLOUDS.map, NIGHT])];
/** ... and with them: each `_4k` sibling that ships. */
const ALL_EQUIRECT = EQUIRECT.flatMap((m) => (existsSync(file(`${m}_4k`)) ? [m, `${m}_4k`] : [m]));

/** The texels, decoded: a KTX2 map through the game's own transcoder. */
async function raw(name: string) {
  if (file(name).endsWith(".ktx2")) return readKtx2(file(name));
  const { data, info } = await sharp(file(name)).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
const dims = async (name: string) => {
  if (file(name).endsWith(".ktx2")) { const k = await readKtx2(file(name)); return { width: k.w, height: k.h }; }
  const meta = await sharp(file(name)).metadata();
  return { width: meta.width!, height: meta.height! };
};

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lumAt = (data: Buffer, k: number, ch: number) =>
  0.2126 * srgbToLinear(data[k * ch] / 255) + 0.7152 * srgbToLinear(data[k * ch + 1] / 255) + 0.0722 * srgbToLinear(data[k * ch + 2] / 255);
const median = (a: Float32Array) => a.slice().sort()[a.length >> 1];

const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * The cloud shell's opacity at each texel of a w × h map: the cloud map
 * decoded from sRGB, as SolarBodies uploads it (SRGBColorSpace); it stores
 * the opacity sRGB-encoded (process_body_maps.mjs CLOUD_OPACITY_GAMMA).
 */
async function cloudAlpha(w: number, h: number) {
  const { data, info } = await sharp(file(CLOUDS.map)).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from({ length: w * h }, (_, k) => srgbToLinear(data[k * info.channels] / 255));
}

/**
 * A shipped albedo map's linear-luminance statistic: the texel median, but
 * for Earth the mean under its cloud layer, as drawn. Geometric albedo is a
 * disc average, and on a two-tone planet the median texel is open ocean.
 */
async function surfaceStat(name: string, body: string) {
  const { data, w, h, ch } = await raw(name);
  const lum = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) lum[k] = lumAt(data, k, ch);
  if (body !== "earth") return median(lum);
  // The cloud shell: colour CLOUDS.linear (linear) over the surface.
  const alpha = await cloudAlpha(w, h);
  for (let k = 0; k < w * h; k++) lum[k] = lum[k] * (1 - alpha[k]) + CLOUDS.linear * alpha[k];
  return mean(lum);
}

/** The game's sunlight colour, linear RGB (sunLight.ts SUN_COLOR, the point light's colour). */
const SUN_LINEAR = (() => {
  const v = parseInt(SUN_COLOR.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => srgbToLinear(c / 255));
})();

/** Hue (deg) of an RGB triple. */
function hueOf([r, g, b]: number[]) {
  const X = Math.max(r, g, b), N = Math.min(r, g, b);
  const h = X === r ? 60 * (((g - b) / (X - N)) % 6) : X === g ? 60 * ((b - r) / (X - N) + 2) : 60 * ((r - g) / (X - N) + 4);
  return h < 0 ? h + 360 : h;
}

/** Mean linear colour of a shipped map. */
async function meanLinear(name: string) {
  const { data, w, h, ch } = await raw(name);
  const sum = [0, 0, 0];
  for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) sum[c] += srgbToLinear(data[k * ch + c] / 255);
  return sum.map((s) => s / (w * h));
}

describe("provenance: a pinned NASA/USGS source or a seeded generator for every map", () => {
  it("covers every map a body or moon draws", () => {
    expect(EQUIRECT.filter((m) => !(m in BODY_MAPS))).toEqual([]);
  });

  for (const [name, recipe] of Object.entries(BODY_MAPS)) {
    it(`${name}: ${"sources" in recipe ? "source URL, SHA-256 and a public-domain page" : "an existing generator"}`, () => {
      if ("sources" in recipe) {
        expect(recipe.sources.length).toBeGreaterThan(0);
        for (const id of recipe.sources) {
          const s = SOURCE_BY_ID[id];
          expect(s, id).toBeDefined();
          expect(s.url).toMatch(/^https:\/\//);
          expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(s.bytes).toBeGreaterThan(0);
          expect(s.page).toMatch(/^https:\/\//);
          // The licence evidence is quoted from the product page (or the
          // policy it links): public domain, or NASA's "not subject to copyright".
          expect(s.licence).toMatch(/public domain|not subject to copyright/i);
        }
      } else {
        expect(existsSync(recipe.generator), recipe.generator).toBe(true);
      }
    });
  }

  const MANIFEST = "assets-src/MANIFEST.md";
  // The private assets-src repo is absent in CI.
  it.skipIf(!existsSync(MANIFEST))("assets-src/MANIFEST.md lists every map with its source URL and hash", () => {
    const text = readFileSync(MANIFEST, "utf8");
    expect(text).not.toMatch(/cited only, never shipped/);
    for (const [name, recipe] of Object.entries(BODY_MAPS)) {
      expect(text, name).toContain(`\`${name}.jpg\``);
      if ("sources" in recipe) {
        for (const id of recipe.sources) {
          expect(text, `${name} ← ${id}`).toContain(SOURCE_BY_ID[id].url);
          expect(text, `${name} ← ${id}`).toContain(SOURCE_BY_ID[id].sha256.slice(0, 16));
        }
      }
    }
  });
});

describe("honest albedo: 0.177 × geometric (within 3%), dark bodies before the display curve", () => {
  for (const s of SURFACES) {
    // The brief allows 10%; every map lands within 3% (worst: Titan 2.2%,
    // Saturn's kept w-ringed 1.9%), so 3% is held.
    it(`${s.id}: texelMedianLinear ${s.stat} is 0.177 × ${s.albedo} within 3%`, () => {
      expect(Math.abs(s.stat / (ALBEDO_SCALE * s.albedo) - 1)).toBeLessThan(0.03);
    });
    for (const name of s.hiRes ? [s.map, `${s.map}_4k`] : [s.map]) {
      it(`${s.id}: ${shipped(name)} ${s.id === "earth" ? "mean under its clouds" : "median"} is within 3% of ${s.stat}`, async () => {
        const m = await surfaceStat(name, s.id);
        expect(Math.abs(m / s.stat - 1)).toBeLessThan(0.03);
      }, 30_000); // decodes a 4096 map (and Earth's clouds at its size); slow on a loaded machine
    }
  }

  it("Earth's cloud tops are lit matter on the same scale (0 < linear ≤ 0.177 × 2)", () => {
    expect(CLOUDS.linear).toBeGreaterThan(0);
    expect(CLOUDS.linear).toBeLessThanOrEqual(ALBEDO_SCALE * 2);
  });

  it("no body is a tint any more: every one draws a map", () => {
    for (const b of SOLAR_BODIES) {
      expect(b.map, b.id).not.toBe("");
      expect("tint" in b, b.id).toBe(false);
    }
  });

  it("each body's HUD colour has its map's hue (mean linear R/G and B/G within 12%)", async () => {
    for (const b of SOLAR_BODIES) {
      const { data, w, h, ch } = await raw(b.map);
      const sum = [0, 0, 0];
      for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) sum[c] += srgbToLinear(data[k * ch + c] / 255);
      const hex = parseInt(b.color.slice(1), 16);
      const col = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => srgbToLinear(v / 255));
      expect(Math.abs(col[0] / col[1] / (sum[0] / sum[1]) - 1), `${b.id} R/G`).toBeLessThan(0.12);
      expect(Math.abs(col[2] / col[1] / (sum[2] / sum[1]) - 1), `${b.id} B/G`).toBeLessThan(0.12);
    }
  }, 30_000); // decodes every shipped map; slow on a loaded machine
});

describe("Earth: blue oceans under white clouds, as from space", () => {
  /** Linear RGB of every texel of Earth's 2048 map, and the cloud shell's opacity over each. */
  async function earthTexels() {
    const { data, w, h, ch } = await raw(EARTH.map);
    const lin = Float32Array.from({ length: w * h * 3 }, (_, i) => srgbToLinear(data[Math.floor(i / 3) * ch + (i % 3)] / 255));
    return { lin, alpha: await cloudAlpha(w, h), n: w * h };
  }
  const channelMedians = (rgb: number[][]) => rgb.map((c) => median(Float32Array.from(c)));

  // Clear-sky ocean seen from orbit is mostly the Rayleigh sky over it: about
  // 0.14–0.2 at 450 nm against ~0.7 for thick cloud. The Rayleigh term taken
  // at nadir alone (0.375 τ) gave a tenth, and the oceans drew near-black.
  it("the open ocean's blue is a sixth to a third of the cloud tops' (it was a tenth)", async () => {
    const { lin, n } = await earthTexels();
    const blue: number[][] = [[], [], []];
    for (let k = 0; k < n; k++) {
      const [r, g, b] = [lin[k * 3], lin[k * 3 + 1], lin[k * 3 + 2]];
      if (b > g && g > r) for (let c = 0; c < 3; c++) blue[c].push(lin[k * 3 + c]);
    }
    const ocean = channelMedians(blue);
    expect(ocean[2] / CLOUDS.linear).toBeGreaterThanOrEqual(1 / 6);
    expect(ocean[2] / CLOUDS.linear).toBeLessThanOrEqual(1 / 3);
  });

  // The Blue Marble's cloud grey is display-encoded; taken as a linear
  // opacity, its thin haze (median grey 0.24) veiled every ocean in grey:
  // this median read B/G 0.89 at hue 34°. Under the opacity curve the median
  // texel is blue sea (γ 1.3: 1.06 at 243°; the full sRGB decode: 1.28 at 223°).
  it("in the sunlight, the median colour of its surface under its clouds is blue (hue 205–250°, B/G ≥ 1.0)", async () => {
    const { lin, alpha, n } = await earthTexels();
    const m = [0, 1, 2].map((c) => median(Float32Array.from({ length: n },
      (_, k) => (lin[k * 3 + c] * (1 - alpha[k]) + CLOUDS.linear * alpha[k]) * SUN_LINEAR[c])));
    expect(hueOf(m)).toBeGreaterThanOrEqual(205);
    expect(hueOf(m)).toBeLessThanOrEqual(250);
    expect(m[2] / m[1]).toBeGreaterThanOrEqual(1.0);
  }, 30_000);

  // The ocean mask rides in the map's alpha (process_body_maps.mjs
  // oceanMask): SolarBodies reads it for the sea's gloss and water's F0, so
  // the land stays matte. Open water is 1, land and ice 0, the coasts soft.
  for (const name of [EARTH.map, `${EARTH.map}_4k`]) {
    it(`${shipped(name)} carries the ocean mask in its alpha: the seas are water, the land and ice are not`, async () => {
      const { data, w, h, ch } = await raw(name);
      expect(ch).toBe(4);
      const at = (lon: number, lat: number) => {
        const x = Math.min(w - 1, Math.floor(((lon + 180) / 360) * w)), y = Math.min(h - 1, Math.floor(((90 - lat) / 180) * h));
        return data[(y * w + x) * ch + 3] / 255;
      };
      const seas = { pacific: [-150, 0], atlantic: [-30, 0], indian: [75, -20], mediterranean: [18, 35], caspian: [51, 42], "lake superior": [-88, 47.6] };
      const lands = { sahara: [10, 23], amazon: [-60, -5], siberia: [100, 62], himalaya: [85, 30], greenland: [-40, 72], antarctica: [0, -85] };
      for (const [k, [lon, lat]] of Object.entries(seas)) expect(at(lon, lat), k).toBeGreaterThan(0.95);
      for (const [k, [lon, lat]] of Object.entries(lands)) expect(at(lon, lat), k).toBeLessThan(0.05);
      // Earth is 71% water by area; on the equirect texel grid (poles
      // stretched: Antarctica's land, the Arctic's sea) it reads ~0.64.
      let water = 0;
      for (let k = 0; k < w * h; k++) water += data[k * ch + 3] / 255;
      expect(water / (w * h)).toBeGreaterThan(0.6);
      expect(water / (w * h)).toBeLessThan(0.7);
    }, 30_000);
  }
});

describe("maps: shape, seam and poles", () => {
  for (const name of ALL_EQUIRECT) {
    it(`${name} is 2:1 at 1024, 2048 or (a desktop _4k) 4096`, async () => {
      const meta = await dims(name);
      expect(meta.width / meta.height).toBe(2);
      expect(name.endsWith("_4k") ? [4096] : [1024, 2048]).toContain(meta.width);
    });

    it(`${name} has no seam at ±180°: the wrap step is no bigger than the map's own step between neighbouring columns`, async () => {
      const { data, w, h, ch } = await raw(name);
      // Mean |left pair − right pair| over every row and channel (8-bit
      // levels), each side the mean of two columns so lossy WebP's own
      // per-column noise at the image edge does not read as a seam; for scale,
      // the same step between interior column pairs.
      const pairStep = (l0: number, l1: number, r0: number, r1: number) => {
        let sum = 0;
        for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
          const v = (x: number) => data[(y * w + x) * ch + c];
          sum += Math.abs((v(l0) + v(l1)) / 2 - (v(r0) + v(r1)) / 2);
        }
        return sum / (h * 3);
      };
      const cols = [w >> 3, w >> 2, (3 * w) >> 3, w >> 1, (5 * w) >> 3, (3 * w) >> 2, (7 * w) >> 3];
      const interior = cols.reduce((s, x) => s + pairStep(x - 1, x, x + 1, x + 2), 0) / cols.length;
      expect(pairStep(w - 2, w - 1, 0, 1)).toBeLessThan(Math.max(2, 1.5 * interior));
      // and no systematic step in any channel
      for (let c = 0; c < 3; c++) {
        let signed = 0;
        for (let y = 0; y < h; y++) signed += data[(y * w) * ch + c] - data[(y * w + w - 1) * ch + c];
        expect(Math.abs(signed / h), `channel ${c} bias`).toBeLessThan(1);
      }
    });

    it(`${name} has near-uniform pole rows`, async () => {
      const { data, w, h, ch } = await raw(name);
      for (const y of [0, h - 1]) {
        for (let c = 0; c < 3; c++) {
          let mean = 0;
          for (let x = 0; x < w; x++) mean += data[(y * w + x) * ch + c];
          mean /= w;
          let v = 0;
          for (let x = 0; x < w; x++) v += (data[(y * w + x) * ch + c] - mean) ** 2;
          expect(Math.sqrt(v / w), `row ${y} channel ${c}`).toBeLessThan(3);
        }
      }
    });
  }

  it("the 4K maps are desktop-only variants: each has its 2048 sibling and ships in the hd pack", () => {
    const names = readdirSync(MODELS);
    const hi = names.filter((f) => /_4k\.(webp|ktx2)$/.test(f));
    expect(hi.length).toBeGreaterThan(0);
    for (const f of hi) {
      const sibling = f.replace(/_4k\.\w+$/, ".webp");
      expect(names, f).toContain(sibling);
      expect(packTier(f, names)).toBe("hd");
      expect(packTier(sibling, names)).toBe("sd");
    }
    // Exactly the bodies that ask for one, and one format each.
    expect(hi.map((f) => f.replace(/_4k\.\w+$/, "")).sort()).toEqual(SOLAR_BODIES.filter((b) => b.mapHiRes).map((b) => b.map).sort());
  });
});

describe("byte caps: per map, and per asset-pack tier", () => {
  /** Per-file caps by width: a photographic 2048 map at WebP q≈85 is ~200–350 KB. */
  const FILE_CAP: Record<number, number> = { 4096: 1300 * 1024, 2048: 420 * 1024, 1024: 120 * 1024 };
  /**
   * KTX2 (UASTC + RDO + zstd, mipmaps inside) is several times a WebP's
   * bytes for a quarter of its GPU memory (encode_ktx2.mjs): Earth's 4096
   * map is 2.11 MB against the WebP's 262 KB.
   */
  const KTX2_CAP: Record<number, number> = { 4096: 2600 * 1024, 2048: 700 * 1024 };
  for (const name of ALL_EQUIRECT) {
    it(`${shipped(name)} stays under its width's cap`, async () => {
      const { width } = await dims(name);
      const cap = file(name).endsWith(".ktx2") ? KTX2_CAP : FILE_CAP;
      expect(statSync(file(name)).size).toBeLessThanOrEqual(cap[width]);
    });
  }

  // hd 3.6 → 4.0 MiB on purpose (2026-10-22, PR 47): Earth's 4096 map ships
  // as KTX2 (2.0 MiB, 11 MB of GPU memory rather than 45).
  it("the texture tiers stay within their pack budgets (hd ≤ 4.0 MiB, sd ≤ 1.4 MiB, common maps ≤ 6.5 MiB)", () => {
    const names = readdirSync(MODELS);
    const total = (tier: string) => names.filter((f) => /\.(webp|ktx2)$/.test(f) && packTier(f, names) === tier)
      .reduce((s, f) => s + statSync(`${MODELS}/${f}`).size, 0);
    const MiB = 1024 * 1024;
    expect(total("hd")).toBeLessThanOrEqual(4.0 * MiB);
    expect(total("sd")).toBeLessThanOrEqual(1.4 * MiB);
    expect(total("common")).toBeLessThanOrEqual(6.5 * MiB);
  });

  it("retires the interim maps no body draws", () => {
    const names = readdirSync(MODELS);
    for (const gone of ["ruangrapi", "portfolio", "fuxx", "w-rock", "w-dwarf"]) {
      expect(names.filter((f) => f.startsWith(gone)), gone).toEqual([]);
    }
  });
});

describe("w-tilted (Uranus): Voyager 2's pale cyan, not teal; Neptune stays the deep blue", () => {
  // The map is bluer than Voyager's image (B over G; the image is 1.04) at
  // about the image's red (R over G 0.66; Task 2's map 0.60 read teal, Task
  // 2b's 0.72 grey-slate): the game's sunlight is warm (#fff4e0 takes B/G
  // × 0.82), so a map at the image's own B/G is lit teal-green.
  it("has R/G in 0.64–0.70 and B/G ≥ 1.22 in mean linear colour", async () => {
    const [r, g, b] = await meanLinear("w-tilted");
    expect(b / g).toBeGreaterThanOrEqual(1.22);
    expect(r / g).toBeGreaterThanOrEqual(0.64);
    expect(r / g).toBeLessThanOrEqual(0.7);
  });

  // B/G 1.15 lit 0.95 at hue ~168° and read 160° on the disc (2026-10-21).
  it("in the sunlight its mean colour is pale cyan: blue at least green, hue 180–200°", async () => {
    const lit = (await meanLinear("w-tilted")).map((v, c) => v * SUN_LINEAR[c]);
    expect(lit[2] / lit[1]).toBeGreaterThanOrEqual(1);
    expect(hueOf(lit)).toBeGreaterThanOrEqual(180);
    expect(hueOf(lit)).toBeLessThanOrEqual(200);
  });

  it("Neptune (w-blue) stays clearly bluer in the same light: hue ≥ 215° and at least twice Uranus's B/G", async () => {
    const u = (await meanLinear("w-tilted")).map((v, c) => v * SUN_LINEAR[c]);
    const n = (await meanLinear("w-blue")).map((v, c) => v * SUN_LINEAR[c]);
    expect(hueOf(n)).toBeGreaterThanOrEqual(215);
    expect(n[2] / n[1]).toBeGreaterThanOrEqual(2 * (u[2] / u[1]));
  });
});

describe("ring strip (w-ringed_ring)", () => {
  const RING = { name: "w-ringed_ring", width: 2048, height: 4, cap: 16 * 1024 };
  /** The ring strip spans the C ring's inner edge to the A ring's outer edge, in equatorial radii. */
  const RING_IN = 1.24, RING_OUT = 2.27;
  async function tau() {
    const { data, w, h, ch } = await raw(RING.name);
    expect(ch).toBe(4);
    const t = Array.from({ length: w }, (_, x) => data[x * ch + 3] / 255);
    return { data, w, h, ch, t };
  }
  /** Equatorial radius at texel x's centre. */
  const radiusAt = (x: number, w: number) => RING_IN + ((x + 0.5) / w) * (RING_OUT - RING_IN);
  const span = (t: number[], w: number, a: number, b: number) =>
    t.filter((_, x) => radiusAt(x, w) >= a && radiusAt(x, w) <= b);

  it("is a 2048×4 strip, every row the same, under its byte cap", async () => {
    const { data, w, h, ch } = await tau();
    expect([w, h]).toEqual([RING.width, RING.height]);
    for (let y = 1; y < h; y++) expect(data.subarray(y * w * ch, (y + 1) * w * ch).equals(data.subarray(0, w * ch))).toBe(true);
    expect(statSync(file(RING.name)).size).toBeLessThanOrEqual(RING.cap);
  });

  it("has τ = 0 in the first and last texel (inside C, outside A)", async () => {
    const { t, w } = await tau();
    expect(t[0]).toBe(0);
    expect(t[w - 1]).toBe(0);
  });

  it("keeps the Cassini division under 0.15 of the B ring's peak", async () => {
    const { t, w } = await tau();
    const bPeak = Math.max(...span(t, w, 1.53, 1.95));
    expect(bPeak).toBeGreaterThan(0.5);
    expect(Math.max(...span(t, w, 1.96, 2.02))).toBeLessThan(0.15 * bPeak);
  });

  it("opens the Encke gap below the A ring's mean", async () => {
    const { t, w } = await tau();
    const a = span(t, w, 2.03, 2.27);
    const aMean = a.reduce((s, v) => s + v, 0) / a.length;
    expect(Math.min(...span(t, w, 2.205, 2.225))).toBeLessThan(aMean);
  });

  it("keeps the C ring faint next to B", async () => {
    const { t, w } = await tau();
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
    expect(mean(span(t, w, 1.25, 1.52))).toBeLessThan(0.3 * mean(span(t, w, 1.54, 1.94)));
  });
});

describe("generator determinism", () => {
  const hashes = (script: string, expected: string[]) => {
    const dir = mkdtempSync(path.join(tmpdir(), "gen-maps-"));
    try {
      execFileSync(process.execPath, [script, "--width=64", `--out=${dir}`], { stdio: "pipe" });
      const files = readdirSync(dir).sort();
      expect(files).toEqual(expected);
      return files.map((f) => `${f}:${createHash("sha256").update(readFileSync(path.join(dir, f))).digest("hex")}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("gen_worlds.mjs writes identical files on two runs at --width=64", () => {
    const expected = ["w-blue.jpg", "w-ringed.jpg", "w-ringed_ring.png", "w-tilted.jpg"];
    expect(hashes("scripts/textures/gen_worlds.mjs", expected)).toEqual(hashes("scripts/textures/gen_worlds.mjs", expected));
  }, 60_000);

  it("gen_body_maps.mjs (Venus's cloud deck, Titan's haze, the Triton fill) writes identical files on two runs at --width=64", () => {
    const expected = ["titan.jpg", "triton_fill.png", "venus.jpg"];
    expect(hashes("scripts/textures/gen_body_maps.mjs", expected)).toEqual(hashes("scripts/textures/gen_body_maps.mjs", expected));
  }, 60_000);
});
