import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { pushFrame, perfStats } from "./perfStats";

// Hoisted to module scope: scene.traverse() invokes its callback once per
// scene node, and an inline arrow function there would be a fresh closure
// allocated every frame -- the same class of defect Task 1's percentile()
// fix (43262ac) removed from this same feature. A module-level counter plus
// a callback defined once keeps the traversal allocation-free.
let lightCount = 0;
function countLight(o: unknown): void {
  if ((o as { isLight?: boolean }).isLight) lightCount++;
}

// Lights in this scene are effectively static after mount, and perfStats.lights
// is a DEV-overlay display value only -- nothing needs it frame-current.
// Walking the *entire* scene graph (planets, asteroid belt, cargo traffic,
// comets, shooting stars, jellyfish, data shards, fuel crystals, ...) every
// frame purely to count lights would inject O(scene-node-count) work into
// the exact frame loop this sampler exists to measure, inflating the p99
// baselines it produces. So this is throttled to every Nth frame instead of
// running unconditionally -- do not "fix" it back to per-frame.
const LIGHT_COUNT_INTERVAL = 30;
let frameCounter = 0;

/**
 * Samples renderer counters and frame time into `perfStats`. Renders nothing
 * and holds no state, so it cannot itself cause the commits it exists to
 * measure. Mounted only under import.meta.env.DEV, alongside DebugBridge.
 */
export default function PerfSampler() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  // Capture calls/triangles from scene.onAfterRender, NOT from a plain
  // useFrame read of gl.info.render.*. Verified against
  // node_modules/three/src/renderers/WebGLRenderer.js: every call to
  // renderer.render() resets gl.info at its own start (when autoReset is
  // true, which it is here -- and stays here, see the DO-NOT-TOUCH note
  // below). PostFX's EffectComposer renders through several internal passes
  // per frame (RenderPass for the real scene, then a merged fullscreen
  // EffectPass for Bloom/Vignette/ChromaticAberration/GodRays), each calling
  // renderer.render() again -- so by the time composer.render() returns,
  // gl.info holds only the LAST pass's tiny counts (one fullscreen quad).
  // EffectComposer's own useFrame runs at renderPriority=1, and R3F runs
  // useFrame subscribers in ascending priority order (lowest first) -- so a
  // plain useFrame here, at the default priority 0, always runs BEFORE this
  // frame's composer pass, meaning it can only observe gl.info as left by
  // the PREVIOUS frame's trailing quad pass. Measured: that reads a
  // permanently stuck calls=1/triangles=1 in every scene state (deep space,
  // close approach, modal open, 40 anomalies) -- indistinguishable from the
  // composer-reset bug this sampler exists to route around.
  //
  // scene.onAfterRender(renderer, scene, camera) is a standard three.js
  // Object3D hook that WebGLRenderer.render() invokes once, synchronously,
  // right after that specific render() call finishes drawing `scene` and
  // before the function returns (see WebGLRenderer.js ~line 1787) -- i.e.
  // exactly when gl.info still holds the real scene's totals, strictly
  // before the composer's later passes (which render their OWN internal
  // quad, a different object, so this hook does not fire for those) get a
  // chance to reset it again. Measured with this hook in place: calls ~29-31,
  // triangles ~825k -- consistent with the DEV overlay's own historical
  // reading (calls 70 / tris 876368) and nothing like the stuck 1/1 above.
  //
  // Do NOT "fix" this by setting `gl.info.autoReset = false` instead --
  // that mutates renderer state itself and was already rejected during this
  // task's design (see docs/PERF-BUDGETS.md and the Task 9 brief).
  useEffect(() => {
    scene.onAfterRender = () => {
      perfStats.calls = gl.info.render.calls;
      perfStats.triangles = gl.info.render.triangles;
    };
    return () => {
      scene.onAfterRender = () => {};
    };
  }, [scene, gl]);

  useFrame((_state, delta) => {
    pushFrame(delta * 1000);
    perfStats.programs = gl.info.programs?.length ?? 0;

    frameCounter++;
    if (frameCounter >= LIGHT_COUNT_INTERVAL) {
      frameCounter = 0;
      lightCount = 0;
      scene.traverse(countLight);
      perfStats.lights = lightCount;
    }
  });

  return null;
}
