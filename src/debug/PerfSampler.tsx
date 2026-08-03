import { useFrame, useThree } from "@react-three/fiber";
import { pushFrame, perfStats } from "./perfStats";

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
    let lights = 0;
    scene.traverse((o) => { if ((o as { isLight?: boolean }).isLight) lights++; });
    perfStats.lights = lights;
  });

  return null;
}
