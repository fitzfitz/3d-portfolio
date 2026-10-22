import * as THREE from "three";
import { useGLTF, useTexture } from "@react-three/drei";

/**
 * The scene's models and maps, loaded through drei but recorded here, so
 * their CPU-side images can be let go once they are on the GPU.
 *
 * After upload, three.js keeps every texture's decoded image (an ImageBitmap
 * from a GLB, an <img> from a map) only to upload it again: about 160 MB of
 * the tab at 1512×802, measured 2026-10-22. ShaderWarmup releases them
 * (releaseUploadedImages) once every texture is up. The one thing that needs
 * them back is a new WebGL context: GlobalCanvas remounting (the classic
 * résumé round trip, which a lost context also falls back to through
 * SafeErrorBoundary). So GlobalCanvas clears the loader caches on unmount
 * (clearSceneAssets), and the new canvas loads them afresh from the asset
 * pack's blob: URLs, which stay alive for the page's lifetime.
 *
 * Every useGLTF / useTexture in the scene goes through these hooks: one that
 * did not would come back from the cache with its image gone.
 */
const models = new Map<string, string | string[]>();
const maps = new Map<string, string[]>();
let released = false;

/** useGLTF for one model, recorded for clearSceneAssets. */
export function useModel(url: string) {
  models.set(url, url);
  return useGLTF(url);
}

/** useGLTF for several models (one cache entry for the whole list). */
export function useModels(urls: string[]) {
  models.set(JSON.stringify(urls), urls);
  return useGLTF(urls);
}

/** useTexture for a list of maps (one cache entry for the whole list). */
export function useMaps(urls: string[]) {
  maps.set(JSON.stringify(urls), urls);
  return useTexture(urls);
}

/** A loaded image three.js would keep only for a re-upload; canvases and data textures are drawn by code and stay. */
function releasable(tex: THREE.Texture): boolean {
  const t = tex as THREE.Texture & Record<string, unknown>;
  if (t.isCanvasTexture || t.isDataTexture || t.isCubeTexture || t.isVideoTexture || t.isCompressedTexture
    || t.isDepthTexture || t.isRenderTargetTexture || t.isData3DTexture || t.isDataArrayTexture) return false;
  const img = tex.image as unknown;
  return (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap)
    || (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement);
}

/** Every texture a material in `scene` holds, as a property or a uniform. */
export function sceneTextures(scene: THREE.Object3D): Set<THREE.Texture> {
  const found = new Set<THREE.Texture>();
  const take = (v: unknown) => { if (v instanceof THREE.Texture) found.add(v); };
  scene.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      for (const v of Object.values(m)) take(v);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) take(u?.value);
    }
  });
  return found;
}

/**
 * Drops the CPU copy of every texture in `textures` that is already on the
 * GPU at its current version (renderer properties' __version, the same check
 * three makes before re-uploading). One flagged for another upload keeps its
 * image, so a pending colour-space or anisotropy change still lands. A GLB
 * shares one image (three's Source) between textures with different
 * samplers, so an image goes only when every texture on it is up.
 * Returns how many images were released.
 */
export function releaseUploadedImages(gl: THREE.WebGLRenderer, textures: Iterable<THREE.Texture>): number {
  const bySource = new Map<THREE.Source<unknown>, THREE.Texture[]>();
  for (const tex of textures) {
    if (!releasable(tex)) continue;
    const list = bySource.get(tex.source);
    if (list) list.push(tex);
    else bySource.set(tex.source, [tex]);
  }
  const uploaded = (tex: THREE.Texture) => (gl.properties.get(tex) as { __version?: number }).__version === tex.version;
  let n = 0;
  for (const [source, list] of bySource) {
    if (!list.every(uploaded)) continue;
    const img = source.data as unknown;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
    source.data = null;
    n++;
  }
  if (n) released = true;
  return n;
}

/**
 * Forgets every recorded model and map, so the next canvas loads them again
 * with their images. A no-op until something was released, which keeps
 * StrictMode's dev-only mount, unmount, mount from reloading the scene.
 */
export function clearSceneAssets(): void {
  if (!released) return;
  for (const key of models.values()) useGLTF.clear(key);
  for (const key of maps.values()) useTexture.clear(key);
  released = false;
}
