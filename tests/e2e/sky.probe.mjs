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

    // Star shells translate with the ship and keep their own slow rotation:
    // turning must change the ship's heading while shells stay centred on it.
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
      checks.check("star shells drift independently of heading",
        s1.shells.length > 0 && s1.shells.some((r, i) => r !== s0.shells[i]),
        `${s1.shells.length} shells`);
    } else {
      const detail = `evaluate failed (s0: ${s0r.ok ? "ok" : s0r.error?.message}, s1: ${s1r.ok ? "ok" : s1r.error?.message})`;
      checks.check("heading changes when turning", false, detail);
      checks.check("star shells drift independently of heading", false, detail);
    }

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

    // God rays: capture-only. Proving "the sun dims when a planet crosses it"
    // needs a contrived pose and luminance thresholds that would be flaky;
    // the plan downgraded this to a human-judged capture (QA checklist §2).
    try {
      await page.screenshot({ path: `${OUT}/sky-godrays-open.png` });
      checks.note("god-ray occlusion", `captured ${OUT}/sky-godrays-open.png — judge in QA checklist`);
    } catch (e) {
      checks.check("god-ray occlusion capture", false, `screenshot failed: ${e.message}`);
    }
  });
}
