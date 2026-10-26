import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { withPage, nextFrames, settle, BASE_URL } from "./harness.mjs";

// The monster lab (dev only, /monster-lab.html; space monsters Task 6) and
// the shaders and budgets of Task 5's instanced monsters, in a real WebGL
// context with the game's renderer, light and post stack:
//  - the lab boots under the game's content gate: its entry settles the
//    bundled content before MonsterLab loads (source "bundled", no
//    "content: already settled" warning);
//  - every layout (fight, spread, overlap) loads under both light presets
//    (near: Earth's distance from the sun; far: Neptune's) with no console
//    error and no program carrying compile diagnostics;
//  - R19's draw-call budget: at `fight`, LOD0, the monsters draw in at most
//    7 calls above a baseline measured on the same page with them hidden
//    (saucer 4: body, dome, fur base, cards; tardigrade 3: body, fur base,
//    cards). LOD1 and auto are measured too;
//  - nothing submitted is culled: in every layout, and above all `spread`
//    (8 monsters 200 u apart), the triangles drawn above the baseline equal
//    the triangles the instance counts submit, with all 8 bodies counted;
//  - every state compiles nothing new and carries no diagnostics, and with
//    motion on the monsters visibly move (idle, fire, curl);
//  - reduced motion (R20): for each state, two frames 0.8 s apart are
//    pixel-identical (decorative motion stopped), while the state's pose
//    still differs from idle (swim excepted: it is decorative only);
//  - R22 (emissives are exposure-compensated): at Neptune the exposure is
//    ~1,350x, so an uncompensated glow bloomed into white blobs. In the
//    `charge` and `chase` states the share of the monsters' own pixels that
//    are near-white (all channels > 245) must stay close to the near preset's
//    (see BLOWN_* and blownShare below);
//  - the TS mirrors agree with the GPU (best effort): the saucer's
//    saucerMuzzle point, aimed well off its rest aim, and the tardigrade's
//    curled axis point (tardigradeCurlPoint) each land on the monster in the
//    posed frame and on empty space in the unposed frame (barrel at its rest
//    aim; the tardigrade straight), same camera: the GPU put geometry where
//    the mirror says, and only because of the pose.
// Screenshots go to $SCRATCH (default /tmp) as monsterlab-*.png.

const OUT = process.env.SCRATCH ?? "/tmp";
const LAB = `${BASE_URL}/monster-lab.html`;
const READY_TIMEOUT_MS = 45_000;
const LAYOUTS = ["fight", "spread", "overlap"];
const PRESETS = ["near", "far"];
const STATES = ["idle", "look", "fire", "chase", "hit", "defeat", "swim", "charge", "recoil", "curl"];
/** R19: draw calls per LOD level in use. */
const SAUCER_CALLS = { 0: 4, 1: 3 };
const TARDIGRADE_CALLS = 3;
/** States whose pose is decorative only (R20): identical to idle under reduced motion. */
const DECORATIVE_ONLY = new Set(["swim"]);

/**
 * R22 guard. The measure: of the pixels the monsters cover at 1 AU (frame
 * with them minus the same frame with them hidden, summed channel difference
 * > 24, dilated 8 px for the bloom), the share that is near-white (R, G and B
 * all > 245), compared with the same pixels at 30 AU. The camera and layout
 * are identical, so the mask is the same; only the light differs. (At 30 AU
 * the hidden-vs-shown difference spans the whole frame, since the bloom and
 * exposure react to the glow, so the far mask can not be taken there.) A
 * white-cyan blob is a lot of near-white pixels; a compensated glow stays
 * coloured, so the share is similar at 1 AU and at 30 AU. Calibration is in the report
 * (task-6-report.md, fix round 1). The far share must stay within
 * BLOWN_MARGIN (absolute) of the near share, and under BLOWN_MAX.
 */
const BLOWN_CHANNEL = 245;
const BLOWN_MARGIN = 0.005;
const BLOWN_MAX = 0.01;
const GUARD_STATES = ["charge", "chase"];

/** The monsters' pixels: frame with them differs from the one without, dilated by `grow` px (the glow's bloom). */
function footprint(shown, hidden, grow = 8) {
  const { width: w, height: h } = shown;
  const hit = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 3;
    const d = Math.abs(shown.data[i] - hidden.data[i]) + Math.abs(shown.data[i + 1] - hidden.data[i + 1])
      + Math.abs(shown.data[i + 2] - hidden.data[i + 2]);
    if (d > 24) hit[p] = 1;
  }
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hit[y * w + x]) continue;
    for (let dx = Math.max(0, x - grow); dx <= Math.min(w - 1, x + grow); dx++) rows[y * w + dx] = 1;
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!rows[y * w + x]) continue;
    for (let dy = Math.max(0, y - grow); dy <= Math.min(h - 1, y + grow); dy++) out[dy * w + x] = 1;
  }
  return out;
}

/** Near-white pixels (all channels > BLOWN_CHANNEL) inside `mask`. */
function blownShare(shown, mask) {
  let cover = 0, white = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    cover++;
    const i = p * 3;
    if (shown.data[i] > BLOWN_CHANNEL && shown.data[i + 1] > BLOWN_CHANNEL && shown.data[i + 2] > BLOWN_CHANNEL) white++;
  }
  return { cover, white, share: cover ? white / cover : 0 };
}

/**
 * Pixels that differ from idle under reduced motion, as measured on the lab
 * (fight, near, LOD0, 1512x802-class viewport; task-6-report.md). Each state
 * must keep at least 40% of its own value, so a heavily damped pose fails
 * (a single flat 200 was too weak for look and chase).
 */
const RM_POSE_PX = { look: 772, fire: 21305, chase: 471, hit: 43556, defeat: 26656, charge: 2320, recoil: 20463, curl: 26205 };

/**
 * Gate B fix A1: the dome is clear glass. The measure: through the middle of
 * the dome (a disc of DOME_DISC of its on-screen radius), over the pixels
 * where the alien (or its fur) shows with the dome hidden, the frame with the
 * dome keeps at least DOME_KEEP of the luminance and of the contrast
 * (standard deviation of luminance) the dome-hidden frame has (and the luminance does not rise by more than that:
 * a milky veil lifts the blacks). Same camera,
 * pose (reduced motion holds it) and light, so only the glass differs. The
 * dome's bright rim and sun glint are outside the disc or add contrast.
 */
const DOME_DISC = 0.45;
const DOME_KEEP = 0.85;

/** Luminance mean and standard deviation of `a` over `mask` (indices of pixels). */
function lumaStats(a, mask) {
  let sum = 0, sq = 0;
  for (const p of mask) {
    const i = p * 3;
    const y = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
    sum += y;
    sq += y * y;
  }
  const mean = sum / mask.length;
  return { mean, std: Math.sqrt(Math.max(0, sq / mask.length - mean * mean)), n: mask.length };
}

/** Pixels inside the disc (x, y, r) where `shown` differs from `bg` (the alien is there). */
function discMask(shown, bg, [x, y, r]) {
  const out = [];
  const { width: w, height: h } = shown;
  for (let py = Math.max(0, Math.floor(y - r)); py <= Math.min(h - 1, Math.ceil(y + r)); py++) {
    for (let px = Math.max(0, Math.floor(x - r)); px <= Math.min(w - 1, Math.ceil(x + r)); px++) {
      if ((px - x) ** 2 + (py - y) ** 2 > r * r) continue;
      const i = (py * w + px) * 3;
      const d = Math.abs(shown.data[i] - bg.data[i]) + Math.abs(shown.data[i + 1] - bg.data[i + 1]) + Math.abs(shown.data[i + 2] - bg.data[i + 2]);
      if (d > 24) out.push(py * w + px);
    }
  }
  return out;
}

const lab = (page, fn, ...args) => page.evaluate(fn, ...args);

async function open(page, query) {
  // ui=0: no panel, whose live readout would differ between two screenshots.
  const q = new URLSearchParams({ cycle: "0", ui: "0", ...query });
  await page.goto(`${LAB}?${q}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__monsterLab?.ready === true, { timeout: READY_TIMEOUT_MS });
  await nextFrames(page, 12);
}

/**
 * One frame's stats with the monsters shown. The monster draw calls and triangles come from the monster
 * meshes' own render hooks in the same frame as the submitted counts, so nothing is compared across frames.
 */
async function measure(page) {
  await nextFrames(page, 6);
  const shown = await lab(page, () => window.__monsterLab.stats());
  // The instance counts and submitted totals come with `shown`, snapshotted in the same render as its calls and triangles.
  const meta = await lab(page, () => window.__monsterLab.instances());
  const meshes = meta.map((m, i) => ({ ...m, count: shown.counts[i] }));
  const bodies = (model) => meshes.filter((m) => m.model === model && m.part === "body").reduce((n, m) => n + m.count, 0);
  const levels = (model) => new Set(meshes.filter((m) => m.model === model && m.count > 0).map((m) => m.lod));
  return {
    shown,
    calls: shown.monsterCalls,
    triangles: shown.monsterTriangles,
    submittedCalls: shown.submittedCalls,
    submittedTriangles: shown.submittedTriangles,
    saucers: bodies("saucer"), tardigrades: bodies("tardigrade"),
    saucerLods: [...levels("saucer")].sort(), tardigradeLods: [...levels("tardigrade")].sort(),
  };
}

/** The R19 budget for the LOD levels a measurement used. */
const budget = (m) => m.saucerLods.reduce((n, l) => n + SAUCER_CALLS[l], 0) + m.tardigradeLods.length * TARDIGRADE_CALLS;

const row = (m) => `calls ${m.calls} (budget ${budget(m)}), triangles ${m.triangles.toLocaleString("en")}`
  + ` (submitted ${m.submittedTriangles.toLocaleString("en")}), programs ${m.shown.programs},`
  + ` saucers ${m.saucers} on LOD ${m.saucerLods.join("+") || "-"}, tardigrades ${m.tardigrades} on LOD ${m.tardigradeLods.join("+") || "-"}`;

async function shot(page, name) {
  const buf = Buffer.from(await page.screenshot({ encoding: "base64" }), "base64");
  if (name) await writeFile(`${OUT}/monsterlab-${name}.png`, buf).catch(() => {});
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** How many pixels differ between two frames (any channel by more than `tol`). */
function differing(a, b, tol = 0) {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) n++;
  }
  return n;
}

/** Share of a 5×5 window at (x, y) where the frame with monsters differs from the one without. */
function coverage(shown, hidden, x, y) {
  let on = 0, all = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= shown.width || py >= shown.height) continue;
      const i = (py * shown.width + px) * 3;
      const d = Math.abs(shown.data[i] - hidden.data[i]) + Math.abs(shown.data[i + 1] - hidden.data[i + 1])
        + Math.abs(shown.data[i + 2] - hidden.data[i + 2]);
      all++;
      if (d > 24) on++;
    }
  }
  return all ? on / all : 0;
}

export default function run() {
  return withPage({ label: "monsterlab" }, async (page, checks) => {
    const table = [];

    // Focused mode for flake hunting: MONSTERLAB_LOOP=N repeats only `spread far lod=auto` N times and reports each count.
    const loop = Number(process.env.MONSTERLAB_LOOP) || 0;
    if (loop > 0) {
      for (let i = 1; i <= loop; i++) {
        await open(page, { layout: "spread", preset: "far", lod: "auto", state: "idle", seed: "7" });
        const m = await measure(page);
        checks.check(`loop ${i}/${loop}: spread far lod=auto, drawn == submitted`,
          m.triangles === m.submittedTriangles && m.calls === m.submittedCalls, row(m));
        checks.note(`loop ${i}`, `calls ${m.calls}/${m.submittedCalls}, triangles ${m.triangles}/${m.submittedTriangles}`);
      }
      return;
    }

    // --- the boot gate: the lab settles the bundled content before MonsterLab and the game modules it borrows load ---
    const contentWarnings = [];
    page.on("console", (m) => { if (/^content: /.test(m.text())) contentWarnings.push(m.text()); });
    await open(page, { layout: "fight", preset: "near", lod: "0", state: "idle", seed: "7" });
    const source = await lab(page, () => window.__monsterLab.content);
    checks.check("the lab boots with the content settled from the bundled snapshot, before any module read it",
      source === "bundled" && contentWarnings.length === 0, `source ${source}; ${contentWarnings.join(" | ") || "no content warnings"}`);

    // --- every layout under both presets ---
    for (const layout of LAYOUTS) {
      for (const preset of PRESETS) {
        const lod = layout === "fight" ? "0" : "auto";
        await open(page, { layout, preset, lod, state: "idle", seed: "7" });
        const m = await measure(page);
        const tag = `${layout} ${preset} lod=${lod}`;
        table.push([tag, m]);
        checks.check(`${tag}: no program carries compile diagnostics`, m.shown.diagnostics === 0, `${m.shown.diagnostics} with diagnostics`);
        checks.check(`${tag}: monster draw calls within R19's budget`, m.calls <= budget(m) && m.calls === m.submittedCalls, row(m));
        checks.check(`${tag}: every submitted triangle is drawn (none culled)`, m.triangles === m.submittedTriangles,
          `drawn ${m.triangles} vs submitted ${m.submittedTriangles}`);
        const want = layout === "overlap" ? [2, 0] : [6, 2];
        checks.check(`${tag}: ${want[0]} saucers and ${want[1]} tardigrades are drawn`, m.saucers === want[0] && m.tardigrades === want[1],
          `saucers ${m.saucers}, tardigrades ${m.tardigrades}`);
        if (layout === "fight") {
          checks.check(`${tag}: R19 — the fight at LOD0 draws in ≤ 7 calls above the baseline`, m.calls <= 7 && budget(m) === 7, `${m.calls} calls`);
          for (const other of ["1", "auto"]) {
            await lab(page, (l) => window.__monsterLab.setLod(l), other);
            await nextFrames(page, 6);
            const o = await measure(page);
            table.push([`${layout} ${preset} lod=${other}`, o]);
            checks.check(`${layout} ${preset} lod=${other}: within budget, none culled`,
              o.calls <= budget(o) && o.calls === o.submittedCalls && o.triangles === o.submittedTriangles, row(o));
          }
        }
        if (layout === "spread") await shot(page, `spread-${preset}`);
        else await shot(page, `${layout}-${preset}`);
      }
    }
    for (const [tag, m] of table) checks.note(`measured: ${tag}`, row(m));

    // --- every state: nothing new compiles, no diagnostics ---
    await open(page, { layout: "fight", preset: "near", lod: "0", state: "idle", seed: "7" });
    const programs0 = (await lab(page, () => window.__monsterLab.stats())).programs;
    for (const state of STATES) {
      await lab(page, (s) => window.__monsterLab.setState(s), state);
      await nextFrames(page, 8);
      const s = await lab(page, () => window.__monsterLab.stats());
      checks.check(`state ${state}: compiles nothing new, no diagnostics`, s.programs === programs0 && s.diagnostics === 0,
        `programs ${s.programs} (idle ${programs0}), diagnostics ${s.diagnostics}`);
    }

    // --- motion on: the timed poses and the idle motion are alive ---
    for (const state of ["idle", "fire", "curl"]) {
      await lab(page, (s) => window.__monsterLab.setState(s), state);
      await nextFrames(page, 8);
      const a = await shot(page, `motion-${state}`);
      await settle(page, 600);
      await nextFrames(page, 4);
      const moved = differing(a, await shot(page), 8);
      checks.check(`motion on, ${state}: the monsters move (frames 0.6 s apart differ)`, moved > 500, `${moved} pixels differ`);
    }

    // --- reduced motion (R20): held poses, no decorative motion ---
    await lab(page, () => window.__monsterLab.setReducedMotion(true));
    await lab(page, () => window.__monsterLab.setState("idle"));
    await nextFrames(page, 10);
    const idle = await shot(page, "rm-idle");
    for (const state of STATES) {
      await lab(page, (s) => window.__monsterLab.setState(s), state);
      await nextFrames(page, 10);
      const a = await shot(page, `rm-${state}`);
      await settle(page, 800);
      await nextFrames(page, 4);
      const b = await shot(page);
      const still = differing(a, b);
      checks.check(`reduced motion, ${state}: two frames 0.8 s apart are pixel-identical`, still === 0, `${still} pixels differ`);
      if (state === "idle") continue;
      const vsIdle = differing(a, idle, 8);
      if (DECORATIVE_ONLY.has(state)) {
        checks.check(`reduced motion, ${state}: decorative only, so it matches idle`, vsIdle === 0, `${vsIdle} pixels differ from idle`);
      } else {
        const min = Math.round(RM_POSE_PX[state] * 0.4);
        checks.check(`reduced motion, ${state}: the pose still shows (differs from idle)`, vsIdle > min, `${vsIdle} pixels differ from idle (need > ${min}, 40% of the measured ${RM_POSE_PX[state]})`);
      }
    }

    // --- the TS mirrors against the GPU (best effort) ---
    const MIRRORS = [
      { kind: "saucer", posed: "fire", unposed: "fire", what: "saucerMuzzle (aimed)" },
      { kind: "tardigrade", posed: "curl", unposed: "idle", what: "tardigradeCurlPoint (curled)" },
    ];
    // Set reduced motion explicitly (not left over from the state loop above):
    // the mirrors compare held poses, so any timed motion would move the
    // geometry between the posed, unposed and hidden frames.
    await lab(page, () => window.__monsterLab.setReducedMotion(true));
    for (const m of MIRRORS) {
      const frame = async (state, posed, name) => {
        await lab(page, (k, s, p) => { window.__monsterLab.setSolo(k); window.__monsterLab.setState(s); window.__monsterLab.frameMirror(p); },
          m.kind, state, posed);
        await nextFrames(page, 12);
        return shot(page, name);
      };
      const posed = await frame(m.posed, true, `mirror-${m.kind}-posed`);
      const pts = await lab(page, () => window.__monsterLab.mirror());
      const unposed = await frame(m.unposed, false, `mirror-${m.kind}-unposed`);
      await lab(page, () => window.__monsterLab.setHidden(true));
      await nextFrames(page, 6);
      const hidden = await shot(page);
      await lab(page, () => window.__monsterLab.setHidden(false));
      const [x, y] = pts[m.kind].posed;
      const on = coverage(posed, hidden, x, y);
      const off = coverage(unposed, hidden, x, y);
      checks.check(`mirror vs GPU: ${m.what} lands on the ${m.kind}`, on >= 0.5,
        `${(on * 100).toFixed(0)}% of a 5×5 window at (${x.toFixed(0)}, ${y.toFixed(0)}) is monster`);
      checks.check(`mirror vs GPU: unposed, the same pixel is empty (the pose moved the geometry there)`, off <= 0.2,
        `${(off * 100).toFixed(0)}% monster with the ${m.kind} unposed`);
    }
    await lab(page, () => window.__monsterLab.setSolo(null));

    // --- Gate B A1: the dome is clear glass ---
    await open(page, { layout: "fight", preset: "near", lod: "0", state: "idle", seed: "7", rm: "1", cam: "hero-saucer" });
    await nextFrames(page, 12);
    const withDome = await shot(page, "dome-shown");
    await lab(page, () => window.__monsterLab.setDomeHidden(true));
    await nextFrames(page, 6);
    const noDome = await shot(page, "dome-hidden");
    await lab(page, () => { window.__monsterLab.setDomeHidden(false); window.__monsterLab.setHidden(true); });
    await nextFrames(page, 6);
    const empty = await shot(page);
    await lab(page, () => window.__monsterLab.setHidden(false));
    const disc = await lab(page, () => window.__monsterLab.domeDisc());
    const mask = discMask(noDome, empty, [disc[0], disc[1], disc[2] * DOME_DISC]);
    const sA = lumaStats(withDome, mask), sB = lumaStats(noDome, mask);
    const keepL = sA.mean / sB.mean, keepC = sA.std / sB.std;
    checks.note("dome clarity", `disc (${disc.map((v) => v.toFixed(0)).join(", ")}), ${mask.length} alien px; luminance ${sA.mean.toFixed(1)} vs ${sB.mean.toFixed(1)} `
      + `(${(keepL * 100).toFixed(1)}%), contrast ${sA.std.toFixed(1)} vs ${sB.std.toFixed(1)} (${(keepC * 100).toFixed(1)}%)`);
    checks.check("dome: the alien shows through its centre (enough pixels measured)", mask.length > 2000, `${mask.length} px`);
    checks.check(`dome: through the centre the alien's luminance stays within ${(1 - DOME_KEEP) * 100}% of the dome-hidden frame (a milky veil lifts it)`, Math.abs(keepL - 1) <= 1 - DOME_KEEP, `${(keepL * 100).toFixed(1)}%`);
    checks.check(`dome: through the centre the alien keeps ≥ ${DOME_KEEP * 100}% of its contrast`, keepC >= DOME_KEEP, `${(keepC * 100).toFixed(1)}%`);

    // --- R22: the glow is exposure-compensated (far must not blow out) ---
    // Reduced motion holds each pose at full strength, so the frame is
    // deterministic (the chase held on, the throat fully charged).
    const blown = {}, masks = {};
    for (const preset of PRESETS) {
      await open(page, { layout: "fight", preset, lod: "0", state: "idle", seed: "7", rm: "1" });
      for (const state of GUARD_STATES) {
        await lab(page, (s) => window.__monsterLab.setState(s), state);
        await nextFrames(page, 14);
        const shown = await shot(page, `r22-${preset}-${state}`);
        await lab(page, () => window.__monsterLab.setHidden(true));
        await nextFrames(page, 6);
        const hidden = await shot(page);
        await lab(page, () => window.__monsterLab.setHidden(false));
        await nextFrames(page, 4);
        if (preset === "near") masks[state] = footprint(shown, hidden);
        blown[`${preset}-${state}`] = blownShare(shown, masks[state]);
      }
    }
    for (const state of GUARD_STATES) {
      const near = blown[`near-${state}`], far = blown[`far-${state}`];
      const fmt = (b) => `${(b.share * 100).toFixed(2)}% (${b.white} of ${b.cover} px)`;
      checks.note(`R22 ${state}`, `near-white share of the monsters' pixels: near ${fmt(near)}, far ${fmt(far)}`);
      checks.check(`R22, ${state}: far glow is not blown out (near-white share within ${BLOWN_MARGIN * 100}% of near, under ${BLOWN_MAX * 100}%)`,
        far.share <= near.share + BLOWN_MARGIN && far.share <= BLOWN_MAX, `near ${fmt(near)}, far ${fmt(far)}`);
    }
  });
}
