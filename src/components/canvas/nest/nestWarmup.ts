import * as THREE from "three";
import { releaseUploadedImages, sceneTextures } from "../../../utils/sceneAssets";

/** Upper bound on the wait, as ShaderWarmup's (GlobalCanvas WARMUP_TIMEOUT_MS). */
export const NEST_WARMUP_TIMEOUT_MS = 8000;

/**
 * Compiles the Nest's programs and uploads its maps before wave 1 (the Nest
 * machine's warm gate waits on it, the HUD saying CONTACT IN …), the way
 * GlobalCanvas's ShaderWarmup does for the scene, without holding the frame
 * loop: compileAsync(object, camera, scene), so the programs see the scene's
 * lights, for a 1×1 render target when PostFX is on (the composer's buffer:
 * linear, no tone mapping; otherwise the first real draw compiles a second
 * variant), then initTexture for each map, one per task, then the maps' CPU
 * copies go (sceneAssets.ts; GlobalCanvas reloads them on a new canvas).
 * compileAsync can poll forever (a lost context), so the wait is capped at
 * `timeoutMs`; past it, programs still compiling finish on first use. Never
 * rejects.
 */
export function warmNest(gl: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene,
  postFx: boolean, timeoutMs: number = NEST_WARMUP_TIMEOUT_MS): Promise<void> {
  let ready: Promise<unknown>;
  const target = postFx ? new THREE.WebGLRenderTarget(1, 1) : null;
  const previous = gl.getRenderTarget();
  try {
    if (target) gl.setRenderTarget(target);
    // compile() inside compileAsync runs synchronously: the target can go as soon as it returns.
    ready = gl.compileAsync(object, camera, scene);
  } catch (e) {
    ready = Promise.reject(e);
  } finally {
    if (target) { gl.setRenderTarget(previous); target.dispose(); }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = Promise.race([
    ready,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]).catch(() => {}).finally(() => clearTimeout(timer));
  return capped.then(() => new Promise<void>((resolve) => {
    const textures = sceneTextures(object);
    const queue = [...textures];
    const step = () => {
      const t = queue.pop();
      if (t) {
        try { gl.initTexture(t); } catch { /* a lost context: it uploads on first use */ }
        setTimeout(step, 0);
        return;
      }
      releaseUploadedImages(gl, textures);
      resolve();
    };
    step();
  }));
}
