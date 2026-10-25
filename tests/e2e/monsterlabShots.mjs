// Gate B shots of the monster lab (space monsters Task 7). A script, not a
// probe: it asserts nothing and writes PNGs to --out. Run it by hand:
//
//   node tests/e2e/monsterlabShots.mjs --out <dir>
//
// It uses the harness's own Vite (port 5199) and Chrome, so no other harness
// run may be going. Output, in <dir>:
//   near-lod0 / near-lod1 / far-lod0 / far-lod1   fight layout, ui=0
//   overlap-near                                   the overlap layout (blended domes)
//   hero-saucer / hero-tardigrade                  close, LOD0, near preset (cam=hero-*)
//   strip-<state>                                  fight, 6 frames over 4 s, one wide PNG
//   strip-saucer-<state> / strip-tardigrade-<state>  the same from the hero cameras
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { withPage, nextFrames, settle, BASE_URL } from "./harness.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const OUT = arg("out");
if (!OUT) { console.error("usage: node tests/e2e/monsterlabShots.mjs --out <dir>"); process.exit(2); }

const LAB = `${BASE_URL}/monster-lab.html`;
const VIEWPORT = { width: 1512, height: 802 };
const STATES = ["idle", "look", "fire", "chase", "hit", "defeat", "swim", "charge", "recoil", "curl"];
const SAUCER_STATES = ["idle", "look", "fire", "chase", "hit", "defeat"];
const TARDIGRADE_STATES = ["idle", "swim", "charge", "recoil", "hit", "curl"];
const FRAMES = 6, FRAME_GAP_MS = 700, FRAME_W = 504;

const lab = (page, fn, ...a) => page.evaluate(fn, ...a);
async function open(page, query) {
  const q = new URLSearchParams({ cycle: "0", ui: "0", seed: "7", ...query });
  await page.goto(`${LAB}?${q}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__monsterLab?.ready === true, { timeout: 60_000 });
  await nextFrames(page, 16);
}
const grab = async (page) => Buffer.from(await page.screenshot({ encoding: "base64" }), "base64");
async function save(name, buf) { await writeFile(`${OUT}/${name}.png`, buf); console.log("wrote", name); }

/** `frames` PNG buffers side by side, each scaled to FRAME_W wide. */
async function strip(frames) {
  const small = await Promise.all(frames.map((f) => sharp(f).resize({ width: FRAME_W }).png().toBuffer()));
  const { height } = await sharp(small[0]).metadata();
  return sharp({ create: { width: FRAME_W * small.length, height, channels: 3, background: "#000" } })
    .composite(small.map((input, i) => ({ input, left: i * FRAME_W, top: 0 }))).png().toBuffer();
}

async function stateStrip(page, state) {
  await lab(page, (s) => window.__monsterLab.setState(s), state);
  await nextFrames(page, 6);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    frames.push(await grab(page));
    await settle(page, FRAME_GAP_MS);
  }
  return strip(frames);
}

await mkdir(OUT, { recursive: true });
await withPage({ label: "monsterlab-shots", viewport: VIEWPORT }, async (page) => {
  for (const preset of ["near", "far"]) {
    for (const lod of ["0", "1"]) {
      await open(page, { preset, lod, layout: "fight", state: "idle" });
      await save(`${preset}-lod${lod}`, await grab(page));
    }
  }
  await open(page, { preset: "near", lod: "0", layout: "overlap", state: "idle" });
  await save("overlap-near", await grab(page));

  for (const kind of ["saucer", "tardigrade"]) {
    await open(page, { preset: "near", lod: "0", layout: "fight", state: "idle", cam: `hero-${kind}` });
    await save(`hero-${kind}`, await grab(page));
    for (const state of kind === "saucer" ? SAUCER_STATES : TARDIGRADE_STATES) {
      await save(`strip-${kind}-${state}`, await stateStrip(page, state));
    }
  }

  await open(page, { preset: "near", lod: "0", layout: "fight", state: "idle" });
  for (const state of STATES) await save(`strip-${state}`, await stateStrip(page, state));
});
process.exit(0);
