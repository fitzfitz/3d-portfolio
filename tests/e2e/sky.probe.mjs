import { writeFile } from "node:fs/promises";
import { withPage, hold, settle, sceneQuery, retryEval, pollUntil } from "./harness.mjs";

const OUT = process.env.SCRATCH ?? "/tmp";

/** Hue in degrees of the first NebulaCluster's material colour. */
const nebulaHue = (page) => page.evaluate(() => {
  let pts = null;
  window.__fitz.scene.traverse((o) => { if (!pts && o.name === "NebulaCluster") pts = o; });
  if (!pts) return null;
  const hsl = {};
  pts.material.color.getHSL(hsl);
  return hsl.h * 360;
});


// ---- F3 exposure (L19) ----
// Distances below are the CAMERA's distance from the sun, which is what the
// exposure follows. The ship faces the sun from direction u, so the chase
// camera sits behind it along u (4.6 at rest) and 1.8 above in world y.
const CAM_BACK = 4.6;
const CAM_UP = 1.8;
const SUN_R = 8; // Sun.tsx CORE_R (SUN_RADIUS)

/**
 * A direction from the sun clear of every planet, landmark and their lines of
 * sight to the sun at all three sample distances. Computed live, since the
 * planets move.
 */
const clearDirection = (page) => page.evaluate(async (dists) => {
  const { STATION_POS } = await import("/src/data/careerTrail.ts");
  const { SHIPYARD_POS } = await import("/src/data/shipyard.ts");
  const { GATE_POS } = await import("/src/data/dormantGate.ts");
  const obstacles = [
    ...Object.values(window.__fitz.bodies).map((b) => [b.x, b.y, b.z, 75]),
    [...STATION_POS, 30], [...SHIPYARD_POS, 30], [...GATE_POS, 30],
  ];
  // Distance from p to the segment 0..q.
  const segDist = (p, q) => {
    const qq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2];
    const t = Math.max(0, Math.min(1, (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / qq));
    return Math.hypot(p[0] - q[0] * t, p[1] - q[1] * t, p[2] - q[2] * t);
  };
  for (const elev of [0.6, -0.6, 0.45, -0.45]) {
    for (let k = 0; k < 16; k++) {
      const az = (k / 16) * Math.PI * 2;
      const u = [Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)];
      const ok = dists.every((d) => obstacles.every(([x, y, z, r]) => segDist([x, y, z], [u[0] * (d + 10), u[1] * (d + 10), u[2] * (d + 10)]) > r));
      if (ok) return u;
    }
  }
  return null;
}, [40, 115, 230]);

/**
 * Parks the ship nose-on to the sun so the camera ends `camDist` from it,
 * puts the camera there directly (the chase camera would otherwise ease in
 * over many slow SwiftShader frames), then waits until it has settled.
 * Returns { camDist, exposure, comp, guideComp } read on the same frame.
 */
async function parkFacingSun(page, u, camDist) {
  // Solve |s·u + o| = camDist for the ship's radius s, o = u·CAM_BACK + (0, CAM_UP, 0).
  const o = [u[0] * CAM_BACK, u[1] * CAM_BACK + CAM_UP, u[2] * CAM_BACK];
  const uo = u[0] * o[0] + u[1] * o[1] + u[2] * o[2];
  const oo = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
  const s = -uo + Math.sqrt(uo * uo - oo + camDist * camDist);
  await page.evaluate((u, s, o) => {
    const d = window.__fitz;
    d.teleport(u[0] * s, u[1] * s, u[2] * s);
    d.setAttitude(Math.atan2(-u[0], -u[2]), Math.asin(-u[1]));
    d.camera.position.set(u[0] * s + o[0], u[1] * s + o[1], u[2] * s + o[2]);
  }, u, s, o);
  const read = () => page.evaluate(() => {
    const d = window.__fitz;
    let comp = null, guideComp = null;
    d.scene.traverse((ob) => {
      const un = ob.material?.uniforms;
      if (!un?.uExposureComp) return;
      if (un.uHeat && comp === null) comp = un.uExposureComp.value;
      if (un.uFadeIn && guideComp === null) guideComp = un.uExposureComp.value;
    });
    return { camDist: d.camera.position.length(), exposure: d.gl.toneMappingExposure, comp, guideComp };
  });
  // Settled: the camera holds the distance and the (snapped) exposure has caught up.
  const r = await pollUntil(async () => {
    const a = await read();
    if (Math.abs(a.camDist - camDist) > 0.5) return null;
    await settle(page, 600);
    const b = await read();
    return Math.abs(b.camDist - camDist) <= 0.5 && Math.abs(b.exposure - a.exposure) < 1e-3 ? b : null;
  }, { timeoutMs: 40_000, intervalMs: 400 });
  return r.value ?? (await read());
}

/**
 * Screenshots the canvas with every DOM overlay hidden and measures the sun's
 * disc: the brightest pixel's luma and the mean luma over the inner 60% of
 * the projected radius (clear of the limb's anti-aliasing). Decoded in the
 * page from the PNG, so there is no PNG decoder to maintain here.
 */
async function sunDisc(page, shot) {
  const geom = await page.evaluate((sunR) => {
    const cam = window.__fitz.camera;
    const v = new cam.position.constructor(0, 0, 0).project(cam);
    const H = window.innerHeight, W = window.innerWidth;
    const dist = cam.position.length();
    const rpx = (sunR / dist) / Math.tan((cam.fov * Math.PI) / 360) * (H / 2);
    return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, rpx, onScreen: v.z < 1 && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 };
  }, SUN_R);
  await page.evaluate(() => {
    const st = document.createElement("style");
    st.dataset.probe = "hide-hud";
    st.textContent = "body * { visibility: hidden !important; } canvas { visibility: visible !important; }";
    document.head.appendChild(st);
  });
  await settle(page, 800);
  const b64 = await page.screenshot({ encoding: "base64" });
  if (shot) await writeFile(`${OUT}/${shot}.png`, Buffer.from(b64, "base64")).catch(() => {});
  await page.evaluate(() => document.querySelector('style[data-probe="hide-hud"]')?.remove());
  const stats = await page.evaluate(async (b64, g) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const scale = img.width / window.innerWidth;
    const cx = g.x * scale, cy = g.y * scale, r = 0.6 * g.rpx * scale;
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(c.width, Math.ceil(cx + r)), y1 = Math.min(c.height, Math.ceil(cy + r));
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let max = 0, sum = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (l > max) max = l;
        sum += l; n++;
      }
    }
    return { max, mean: n ? sum / n : 0, n };
  }, b64, geom);
  return { ...geom, ...stats };
}

const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(a, b);

/**
 * F3 exposure checks for the tier currently rendering. Reduced motion is on,
 * so the exposure snaps to its target every frame.
 */
async function exposureChecks(page, checks, tier) {
  const lowPerf = tier === "low-perf";
  const ur = await retryEval(() => clearDirection(page));
  const u = ur.value;
  checks.check(`[${tier}] found a view of the sun clear of planets and landmarks`, !!u, u ? `u=${u.map((c) => c.toFixed(2)).join(",")}` : String(ur.error?.message ?? "none clear"));
  if (!u) return;

  const at115 = await parkFacingSun(page, u, 115);
  const disc115 = await sunDisc(page, `sky-exposure-${tier}-115`);
  checks.check(`[${tier}] exposure is 1 at Ruangrapi's distance`, Math.abs(at115.exposure - 1) <= 0.02,
    `camera ${at115.camDist.toFixed(2)} from the sun, exposure=${at115.exposure.toFixed(4)}`);
  // The compensation follows the tier: the post pass exposes the sun and the
  // guides (1 / exposure); in low-perf nothing exposes them (1).
  const wantComp = (e) => (lowPerf ? 1 : 1 / e);
  checks.check(`[${tier}] sun and guide compensation is ${lowPerf ? "1" : "1 / exposure"}`,
    at115.comp !== null && Math.abs(at115.comp - wantComp(at115.exposure)) < 1e-6
      && at115.guideComp !== null && Math.abs(at115.guideComp - at115.comp) < 1e-12,
    `comp=${at115.comp} guide=${at115.guideComp} exposure=${at115.exposure}`);

  const at40 = await parkFacingSun(page, u, 40);
  const disc40 = await sunDisc(page, `sky-exposure-${tier}-40`);
  const at230 = await parkFacingSun(page, u, 230);
  const disc230 = await sunDisc(page, `sky-exposure-${tier}-230`);
  checks.check(`[${tier}] exposure falls near the sun and rises far out`,
    at40.exposure < 0.3 && at230.exposure > 2,
    `d=${at40.camDist.toFixed(1)} exposure=${at40.exposure.toFixed(3)}; d=${at230.camDist.toFixed(1)} exposure=${at230.exposure.toFixed(3)}`);
  checks.check(`[${tier}] sun and guide compensation tracks the exposure far out`,
    at230.comp !== null && Math.abs(at230.comp - wantComp(at230.exposure)) < 1e-6,
    `comp=${at230.comp} exposure=${at230.exposure}`);

  // The brightest pixel within 10% (the spec's bar). The disc saturates, so
  // that alone barely moves without compensation; the mean over the inner
  // disc is held to 3%. Measured: compensated, the means agree within 1%;
  // with the compensation forced to 1, the d=40 mean fell 6% (243 -> 228).
  const fmt = (d) => `max=${d.max.toFixed(1)} mean=${d.mean.toFixed(1)} (${d.n}px, r=${d.rpx.toFixed(0)}px)`;
  const discsOk = [disc115, disc40, disc230].every((d) => d.onScreen && d.n > 50);
  checks.check(`[${tier}] the sun's disc looks the same at every exposure`,
    discsOk && near(disc115.max, disc230.max, 0.1) && near(disc115.mean, disc230.mean, 0.03)
      && near(disc115.max, disc40.max, 0.1) && near(disc115.mean, disc40.mean, 0.03),
    `d115 ${fmt(disc115)}; d230 ${fmt(disc230)}; d40 ${fmt(disc40)}`);
}

export default async function run() {
  return withPage({ label: "sky" }, async (page, checks) => {
    // Nebula hue drift: driftedHue is ±25° over 180s, so 20s from load moves it
    // by 25*sin(20/180*2pi) ≈ 16°. Assert a conservative ≥5°.
    //
    // Residual flake risk (verified against src/utils/nebulaHue.ts): letting
    // θ0 = 2*t0 degrees (t0 = seconds since mount at the first sample), the
    // 20s swing works out to dHue = 17.1·cos(θ0 + 20°). That threshold-crossing
    // (dHue < 5°) only happens when cos(θ0+20°) < ~0.29, i.e. θ0 within ~17°
    // of 70° or 250° — which corresponds to a first sample landing roughly
    // 35s or 125s into the 180s drift cycle. A slow cold start that happens
    // to straddle one of those windows could produce a real, non-regression
    // failure here. Do not raise the threshold to compensate — it is already
    // conservative at typical load timing (measured 13.5°); this is a known,
    // narrow timing flake, not a defect.
    // Each read below goes through retryEval: a transient "Attempted to use
    // detached Frame" (an HMR reload or navigation racing this evaluate) gets
    // a couple of retries instead of throwing straight out of run() — which
    // would otherwise crash the whole probe (see run.mjs) and lose every
    // sibling check below, not just this one. A read that still fails after
    // retrying reports as a clean failed check instead.
    const h0r = await retryEval(() => nebulaHue(page));
    checks.check("nebula material is readable", h0r.ok && h0r.value !== null,
      h0r.ok ? `hue=${h0r.value}` : `evaluate failed: ${h0r.error?.message}`);
    await settle(page, 20_000);
    const h1r = await retryEval(() => nebulaHue(page));
    if (h0r.ok && h1r.ok && h0r.value !== null && h1r.value !== null) {
      const dHue = Math.abs(((h1r.value - h0r.value + 540) % 360) - 180);
      checks.check("nebula hue drifts over 20s", dHue >= 5,
        `${h0r.value.toFixed(1)}° -> ${h1r.value.toFixed(1)}° (delta ${dHue.toFixed(1)}°)`);
    } else {
      checks.check("nebula hue drifts over 20s", false,
        `could not read hue reliably (h0: ${h0r.ok ? "ok" : h0r.error?.message}, h1: ${h1r.ok ? "ok" : h1r.error?.message})`);
    }

    // Cloud layers rotate (1.4x surface speed, so rotation.y must advance).
    const c0r = await retryEval(() => sceneQuery(page, "CloudLayer"));
    await settle(page, 3000);
    const c1r = await retryEval(() => sceneQuery(page, "CloudLayer"));
    const c0 = c0r.value, c1 = c1r.value;
    checks.check("cloud layer rotates",
      c0r.ok && c1r.ok && c0.found && c1.found && c1.rotation.y !== c0.rotation.y,
      c0r.ok && c1r.ok
        ? `y ${c0.rotation?.y?.toFixed(3)} -> ${c1.rotation?.y?.toFixed(3)}`
        : `evaluate failed (c0: ${c0r.ok ? "ok" : c0r.error?.message}, c1: ${c1r.ok ? "ok" : c1r.error?.message})`);

    // Star shells translate with the ship and never rotate (L24): turning must
    // change the ship's heading while shells stay centred on it.
    //
    // Selector note: a bare `type === "Points" && name !== "NebulaCluster"`
    // (the brief's original filter) also matches Comets.tsx's per-comet ion/
    // dust tails and Spaceship.tsx's engine-trail particles — real Points
    // objects, but heliocentric-orbit or ship-local particle systems, not sky
    // shells. Probed live (traversing the scene and logging o.parent), the
    // three StarLayer instances and DustField in GlobalCanvas.tsx (lines
    // 64/103: `pointsRef.current.position.set(flight.x, flight.y, flight.z)`
    // every frame) are the only Points mounted directly on the R3F root scene
    // — GalaxyStarfield is rendered as a top-level fragment with no wrapping
    // group, while every other Points-bearing component (Comets, Spaceship)
    // nests its points inside its own <group>. So `o.parent === scene` is
    // exactly "is this one of the sky shells" here, and including the
    // Comets/Spaceship points without it made this check fail on unrelated
    // objects (e.g. a comet tail near its own orbit, tens of units from the
    // ship) rather than reveal any real centring bug.
    const shellSnapshot = () => page.evaluate(() => {
      const f = window.__fitz.flight;
      const scene = window.__fitz.scene;
      const shells = [];
      scene.traverse((o) => {
        if (o.type === "Points" && o.name !== "NebulaCluster" && o.parent === scene) shells.push(o.rotation.y);
      });
      return { heading: f.heading, shells, x: f.x, y: f.y, z: f.z };
    });
    const s0r = await retryEval(shellSnapshot);
    await hold(page, ["KeyD"], 2500);
    const s1r = await retryEval(shellSnapshot);
    const s0 = s0r.value, s1 = s1r.value;
    if (s0r.ok && s1r.ok) {
      checks.check("heading changes when turning", s0.heading !== s1.heading,
        `${s0.heading.toFixed(3)} -> ${s1.heading.toFixed(3)}`);
    } else {
      const detail = `evaluate failed (s0: ${s0r.ok ? "ok" : s0r.error?.message}, s1: ${s1r.ok ? "ok" : s1r.error?.message})`;
      checks.check("heading changes when turning", false, detail);
    }

    // L24 fixed stars: the shells never move, so each StarLayer's world
    // quaternion is identical before and after a wait.
    const starQuats = () => page.evaluate(() => {
      const q = [];
      window.__fitz.scene.traverse((o) => {
        if (o.name === "StarLayer") q.push(o.getWorldQuaternion(new o.quaternion.constructor()).toArray());
      });
      return q;
    });
    const q0r = await retryEval(starQuats);
    await settle(page, 2000);
    const q1r = await retryEval(starQuats);
    checks.check("the star shells hold still",
      q0r.ok && q1r.ok && q0r.value.length === 3 && q1r.value.length === 3
        && q1r.value.every((q, i) => q.every((c, k) => c === q0r.value[i][k])),
      q0r.ok && q1r.ok ? `${q1r.value.length} StarLayer objects` : `evaluate failed (a: ${q0r.ok ? "ok" : q0r.error?.message}, b: ${q1r.ok ? "ok" : q1r.error?.message})`);

    const centredR = await retryEval(() => page.evaluate(() => {
      const f = window.__fitz.flight;
      const scene = window.__fitz.scene;
      let ok = true, n = 0;
      scene.traverse((o) => {
        if (o.type === "Points" && o.name !== "NebulaCluster" && o.parent === scene) {
          n++;
          if (Math.hypot(o.position.x - f.x, o.position.y - f.y, o.position.z - f.z) > 1) ok = false;
        }
      });
      return { ok, n };
    }));
    // Require n > 0: `ok` starts true and is only ever flipped false by a
    // mismatch, so if the selector ever matched zero shells this would pass
    // vacuously while printing "0 shells checked" instead of catching the
    // regression. Currently n=4 (3 StarLayer + DustField), so this is not
    // live today, but nothing upstream of this line guarantees it stays so.
    checks.check("star shells stay centred on the ship",
      centredR.ok && centredR.value.ok && centredR.value.n > 0,
      centredR.ok ? `${centredR.value.n} shells checked` : `evaluate failed: ${centredR.error?.message}`);

    // Corona flicker: Sun.tsx's coronaMaterial is a THREE.ShaderMaterial with a
    // single uniform `uTime` (a plain number) that useFrame sets to the clock's
    // elapsed time every frame (Sun.tsx:84). That numeric uniform is exactly
    // the animation mechanism, so reading it before/after a wait is a direct
    // proof the shader is animating (not a proxy for something else).
    // Split into two short harness-side-spaced evaluates rather than one
    // page.evaluate() that awaits 1200ms in-page: a shorter evaluate call
    // shrinks the window in which a detached-frame error could hit it, and
    // retryEval gives each read its own error tolerance.
    const readCoronaUniform = () => page.evaluate(() => {
      let m = null;
      window.__fitz.scene.traverse((o) => { if (!m && o.name === "SunCorona") m = o.material; });
      if (!m) return null;
      const u = m.uniforms ?? {};
      const key = Object.keys(u).find((k) => typeof u[k]?.value === "number");
      return key ? u[key].value : null;
    });
    const flickerAr = await retryEval(readCoronaUniform);
    await settle(page, 1200);
    const flickerBr = await retryEval(readCoronaUniform);
    checks.check("sun corona shader animates",
      flickerAr.ok && flickerBr.ok && flickerAr.value !== null && flickerAr.value !== flickerBr.value,
      flickerAr.ok && flickerBr.ok
        ? `uniform ${flickerAr.value} -> ${flickerBr.value}`
        : `evaluate failed (a: ${flickerAr.ok ? "ok" : flickerAr.error?.message}, b: ${flickerBr.ok ? "ok" : flickerBr.error?.message})`);

    // Meteors: ShootingStars.tsx pools a *single* LineSegments object and never
    // touches material.opacity (it stays at its default of 1 the whole time,
    // so `material.opacity > 0.01` is always true and would pass even with
    // zero meteors spawned). The real visibility mechanism is the per-vertex
    // `color` attribute: inactive slots are zeroed with `col.fill(0, o, o+6)`
    // and the code comment is explicit that "brightness IS alpha under
    // additive blending" (ShootingStars.tsx:69,80-84). So a meteor is visible
    // iff some component of that color buffer is above the noise floor.
    // Harness-side polling rather than a single in-page loop spanning up to
    // 30s: each iteration is its own short-lived page.evaluate() call, so a
    // transient detached-frame error only aborts that one iteration (pollUntil
    // tolerates up to 5 in a row) instead of the entire 30s wait — and thus
    // the whole probe — crashing on whichever iteration happened to race a
    // reload. A meteor that genuinely never appears still exhausts the
    // deadline and reports a clean failed check, same as before.
    const meteorVisibleNow = () => page.evaluate(() => {
      let visible = 0;
      window.__fitz.scene.traverse((o) => {
        if (o.type === "LineSegments" && o.visible) {
          const col = o.geometry?.attributes?.color?.array;
          if (col) {
            for (let i = 0; i < col.length; i++) {
              if (col[i] > 0.05) { visible++; break; }
            }
          }
        }
      });
      return visible > 0;
    });
    const meteorResult = await pollUntil(meteorVisibleNow, { timeoutMs: 30_000, intervalMs: 500 });
    checks.check("a shooting star appears within 30s", meteorResult.ok,
      meteorResult.error ? `evaluate failed repeatedly: ${meteorResult.error.message}` : "");

    // Sun glare: capture-only. Proving "the glare dims when a planet crosses the sun"
    // needs a contrived pose and luminance thresholds that would be flaky;
    // the plan downgraded this to a human-judged capture (QA checklist §2).
    try {
      await page.screenshot({ path: `${OUT}/sky-glare-open.png` });
      checks.note("sun glare", `captured ${OUT}/sky-glare-open.png — judge in QA checklist`);
    } catch (e) {
      checks.check("sun glare capture", false, `screenshot failed: ${e.message}`);
    }

    // F3 (L19): the camera's exposure, and the sun looking the same at every
    // exposure, in both tiers. Reduced motion so the exposure snaps.
    await page.evaluate(() => window.__fitz.store.getState().setReducedMotion(true, true));
    await settle(page, 1000);
    await exposureChecks(page, checks, "composer");
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(true, true));
    // The low tier's tone-mapped variants compile on the switch (slow in SwiftShader).
    await settle(page, 4000);
    await exposureChecks(page, checks, "low-perf");
  });
}
