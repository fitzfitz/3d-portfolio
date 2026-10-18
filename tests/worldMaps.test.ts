import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The new worlds' shipped maps (spec "Assets: photoreal and reproducible"):
 * shape, seam, poles, honest albedo, the ring strip's real profile, per-file
 * byte caps and generator determinism. Reads public/models, so it checks
 * exactly what visitors download.
 */

const MODELS = "public/models";

/** Equirect maps: width (2:1) and, for albedo maps, the target linear-luminance median (spec, Light). */
const MAPS: { name: string; width: number; median?: number }[] = [
  { name: "w-rock", width: 2048, median: 0.025 },
  { name: "w-rock_normal", width: 1024 },
  { name: "w-ringed", width: 2048, median: 0.088 },
  { name: "w-tilted", width: 1024, median: 0.086 },
  { name: "w-blue", width: 2048, median: 0.078 },
  { name: "w-dwarf", width: 1024, median: 0.016 },
  { name: "w-dwarf_normal", width: 1024 },
];
const BYTE_CAP: Record<number, number> = { 2048: 260 * 1024, 1024: 90 * 1024 };
const RING = { name: "w-ringed_ring", width: 2048, height: 4, cap: 16 * 1024 };

/** The ring strip spans the C ring's inner edge to the A ring's outer edge, in equatorial radii. */
const RING_IN = 1.24, RING_OUT = 2.27;

const file = (name: string) => `${MODELS}/${name}.webp`;

async function raw(name: string) {
  const { data, info } = await sharp(file(name)).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

describe("world maps: shape, seam and poles", () => {
  for (const m of MAPS) {
    it(`${m.name} is 2:1 at ${m.width}`, async () => {
      const meta = await sharp(file(m.name)).metadata();
      expect([meta.width, meta.height]).toEqual([m.width, m.width / 2]);
    });

    it(`${m.name} has no seam at 0/360°`, async () => {
      const { data, w, h, ch } = await raw(m.name);
      // mean |column 0 − column W−1| over every row and channel, in 8-bit levels
      let sum = 0;
      for (let y = 0; y < h; y++) {
        for (let c = 0; c < 3; c++) sum += Math.abs(data[(y * w) * ch + c] - data[(y * w + w - 1) * ch + c]);
      }
      const seam = sum / (h * 3);
      if (m.median !== undefined) {
        expect(seam).toBeLessThan(2);
      } else {
        // Normal maps (the controller's ruling (a), task-2-report.md fix
        // round 1): < 2 cannot hold at the shipped relief. w-rock_normal's
        // lossless source already measures 2.24 here, just its interior
        // column-to-column step (2.12), and lossy WebP adds independent block
        // error on the two edge columns; only a σ ≥ 2.5-texel blur gets under
        // 2, which erases the small craters. So: under 5 levels (~2.2° of
        // tilt) and, the part a visible line needs, no systematic step in any
        // channel.
        expect(seam).toBeLessThan(5);
        for (let c = 0; c < 3; c++) {
          let signed = 0;
          for (let y = 0; y < h; y++) signed += data[(y * w) * ch + c] - data[(y * w + w - 1) * ch + c];
          expect(Math.abs(signed / h), `channel ${c} bias`).toBeLessThan(1);
        }
      }
    });

    it(`${m.name} has near-uniform pole rows`, async () => {
      const { data, w, h, ch } = await raw(m.name);
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

    it(`${m.name} stays under its byte cap`, () => {
      expect(statSync(file(m.name)).size).toBeLessThanOrEqual(BYTE_CAP[m.width]);
    });
  }
});

describe("normal maps: codec fidelity", () => {
  // R and G are independent vector components: plain 4:2:0 chroma subsampling
  // tilts every texel (3.35 levels RMS against w-rock_normal's source),
  // sharp-YUV at q90 keeps it near 2.5. Needs the generator output, which
  // lives in the private assets-src repo (absent in CI), where maps are
  // regenerated.
  for (const name of ["w-rock_normal", "w-dwarf_normal"]) {
    const SRC = `assets-src/${name}.png`;
    it.skipIf(!existsSync(SRC))(`${name} stays within 2.6 levels RMS of its source`, async () => {
      const { data, w, h, ch } = await raw(name);
      const src = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
      expect([src.info.width, src.info.height]).toEqual([w, h]);
      let err = 0;
      for (let k = 0; k < w * h; k++) {
        for (let c = 0; c < 3; c++) err += (data[k * ch + c] - src.data[k * src.info.channels + c]) ** 2;
      }
      expect(Math.sqrt(err / (w * h * 3))).toBeLessThan(2.6);
    });
  }
});

describe("world maps: honest albedo", () => {
  for (const m of MAPS.filter((x) => x.median !== undefined)) {
    it(`${m.name}'s linear-luminance median is within ±35% of ${m.median}`, async () => {
      const { data, w, h, ch } = await raw(m.name);
      const lum = new Float32Array(w * h);
      for (let k = 0; k < w * h; k++) {
        const r = srgbToLinear(data[k * ch] / 255), g = srgbToLinear(data[k * ch + 1] / 255), b = srgbToLinear(data[k * ch + 2] / 255);
        lum[k] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      lum.sort();
      const median = lum[Math.floor(lum.length / 2)];
      expect(median).toBeGreaterThan(m.median! * 0.65);
      expect(median).toBeLessThan(m.median! * 1.35);
    });
  }
});

describe("w-tilted: Voyager 2's pale blue-cyan, not teal", () => {
  // The game's tone mapping (Khronos PBR Neutral) subtracts the same toe
  // offset from every channel of a dim pixel, which saturates it and lets a
  // cyan with G ≈ B read teal-green. So the map carries a bluer hue than
  // Voyager's image (B over G; the image is 1.04, Task 2's map 1.11), at
  // about the image's red (R over G 0.66; Task 2's map 0.60 read teal, Task
  // 2b's 0.72 grey-slate): bracketed around the reference, not one direction.
  it("has R/G in 0.64–0.70 and B/G ≥ 1.12 in mean linear colour", async () => {
    const { data, w, h, ch } = await raw("w-tilted");
    const sum = [0, 0, 0];
    for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) sum[c] += srgbToLinear(data[k * ch + c] / 255);
    expect(sum[2] / sum[1]).toBeGreaterThanOrEqual(1.12);
    expect(sum[0] / sum[1]).toBeGreaterThanOrEqual(0.64);
    expect(sum[0] / sum[1]).toBeLessThanOrEqual(0.7);
  });
});

describe("ring strip (w-ringed_ring)", () => {
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

describe("gen_worlds.mjs determinism", () => {
  it("writes identical files on two runs at --width=64", () => {
    const hashes = () => {
      const dir = mkdtempSync(path.join(tmpdir(), "gen-worlds-"));
      try {
        execFileSync(process.execPath, ["scripts/textures/gen_worlds.mjs", "--width=64", `--out=${dir}`], { stdio: "pipe" });
        const files = readdirSync(dir).sort();
        // w-rock and w-dwarf are numpy-in-Blender (scripts/blender/gen_world_*.py).
        expect(files).toEqual(["w-blue.jpg", "w-ringed.jpg", "w-ringed_ring.png", "w-tilted.jpg"]);
        return files.map((f) => `${f}:${createHash("sha256").update(readFileSync(path.join(dir, f))).digest("hex")}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    expect(hashes()).toEqual(hashes());
  }, 60_000);
});
