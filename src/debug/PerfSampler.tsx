import { useFrame, useThree } from "@react-three/fiber";
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

  useFrame((_state, delta) => {
    pushFrame(delta * 1000);
    perfStats.calls = gl.info.render.calls;
    perfStats.triangles = gl.info.render.triangles;
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
