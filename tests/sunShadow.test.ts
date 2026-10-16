import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  MAX_OCCLUDERS,
  SUN_SHADOW_GLSL,
  patchSunShadow,
  setOccluder,
  sunShadowUniforms,
  updateSunView,
} from "../src/components/canvas/sunShadow";

/** What three hands onBeforeCompile: chunks are still unresolved #includes. */
function stubShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: "#include <common>\n#include <worldpos_vertex>\nvoid main() {}\n",
    fragmentShader:
      "#include <common>\n#include <emissivemap_fragment>\n#include <lights_fragment_begin>\nvoid main() {}\n",
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

const renderer = {} as THREE.WebGLRenderer;

/** Copy of three r185's unrollLoops (WebGLProgram.js), which is not exported. */
const unrollLoopPattern =
  /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
function unrollPointLoop(src: string, lights: number): string {
  return src
    .replace(/NUM_POINT_LIGHTS/g, String(lights))
    .replace(unrollLoopPattern, (_m, start: string, end: string, body: string) => {
      let out = "";
      for (let i = parseInt(start); i < parseInt(end); i++) {
        out += body.replace(/\[\s*i\s*\]/g, "[ " + i + " ]").replace(/UNROLLED_LOOP_INDEX/g, String(i));
      }
      return out;
    });
}

/** The text between the point-light loop's markers in a patched fragment shader. */
function pointLoopBody(frag: string): string {
  const start = frag.indexOf("pointLight = pointLights[ i ];");
  const end = frag.indexOf("#pragma unroll_loop_end", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return frag.slice(start, end);
}

describe("sunShadowUniforms / setOccluder", () => {
  it("holds MAX_OCCLUDERS = 8 Vector4 slots, a count and the sun's view position", () => {
    expect(MAX_OCCLUDERS).toBe(8);
    expect(sunShadowUniforms.uOccluders.value).toHaveLength(MAX_OCCLUDERS);
    for (const v of sunShadowUniforms.uOccluders.value) expect(v).toBeInstanceOf(THREE.Vector4);
    expect(typeof sunShadowUniforms.uOccluderCount.value).toBe("number");
    expect(sunShadowUniforms.uSunView.value).toBeInstanceOf(THREE.Vector3);
  });

  it("writes into the same Vector4 instances (no allocation)", () => {
    const before = [...sunShadowUniforms.uOccluders.value];
    const arr = sunShadowUniforms.uOccluders.value;
    setOccluder(3, 1, 2, 3, 4);
    expect(sunShadowUniforms.uOccluders.value).toBe(arr);
    expect(sunShadowUniforms.uOccluders.value[3]).toBe(before[3]);
    expect(before[3].toArray()).toEqual([1, 2, 3, 4]);
    for (let i = 0; i < MAX_OCCLUDERS; i++) expect(sunShadowUniforms.uOccluders.value[i]).toBe(before[i]);
  });

  it("updateSunView writes the origin's view-space position in place", () => {
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(10, 0, 0);
    cam.updateMatrixWorld();
    const v = sunShadowUniforms.uSunView.value;
    updateSunView(cam);
    expect(sunShadowUniforms.uSunView.value).toBe(v);
    expect(v.x).toBeCloseTo(-10, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });
});

describe("SUN_SHADOW_GLSL", () => {
  it("defines the coverage function and the sun-light gate", () => {
    expect(SUN_SHADOW_GLSL).toMatch(/float\s+sunShadowCoverage\s*\(/);
    expect(SUN_SHADOW_GLSL).toMatch(/bool\s+isSunLight\s*\(/);
    expect(SUN_SHADOW_GLSL).toContain("uOccluders[");
    expect(SUN_SHADOW_GLSL).toContain("uOccluderCount");
    expect(SUN_SHADOW_GLSL).toContain("asin(");
  });
});

describe("patchSunShadow", () => {
  it("keeps an existing onBeforeCompile working and patches inside the point-light loop", () => {
    const mat = new THREE.MeshStandardMaterial();
    const prevUniform = { value: new THREE.Vector3() };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunView = prevUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uSunView;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n// PREVIOUS_PATCH");
    };
    patchSunShadow(mat, "fragment", { selfIndex: 2 });
    const shader = stubShader();
    mat.onBeforeCompile(shader, renderer);

    // The previous patch is intact.
    expect(shader.uniforms.uSunView).toBe(prevUniform);
    expect(shader.fragmentShader).toContain("// PREVIOUS_PATCH");
    expect(shader.fragmentShader.match(/uniform vec3 uSunView;/g)).toHaveLength(1);

    // Ours: shared uniforms wired, chunk expanded, gate inside the loop.
    expect(shader.uniforms.uOccluders).toBe(sunShadowUniforms.uOccluders);
    expect(shader.uniforms.uOccluderCount).toBe(sunShadowUniforms.uOccluderCount);
    expect(shader.uniforms.uSunShadowView).toBe(sunShadowUniforms.uSunView);
    expect(shader.fragmentShader).not.toContain("#include <lights_fragment_begin>");
    expect(shader.fragmentShader).toContain("float sunShadowCoverage(");
    expect(shader.fragmentShader).toContain("#define SUN_SHADOW_SELF 2");
    const body = pointLoopBody(shader.fragmentShader);
    expect(body).toMatch(/isSunLight\(\s*pointLight\.position\s*\)/);
    expect(body).toContain("directLight.color *=");
    // The gate precedes the light's contribution being accumulated.
    expect(body.indexOf("isSunLight")).toBeLessThan(body.indexOf("RE_Direct"));
  });

  it("still unrolls under three's #pragma unroll_loop with the gate in every copy", () => {
    const mat = new THREE.MeshStandardMaterial();
    patchSunShadow(mat, "fragment");
    const shader = stubShader();
    mat.onBeforeCompile(shader, renderer);
    const unrolled = unrollPointLoop(shader.fragmentShader, 3);
    expect(unrolled).not.toContain("#pragma unroll_loop_start\n\tfor ( int i = 0; i < 3");
    expect(unrolled.match(/pointLight = pointLights\[ \d \];/g)).toHaveLength(3);
    expect(unrolled.match(/isSunLight\(\s*pointLight\.position\s*\)/g)).toHaveLength(3);
  });

  it("object mode multiplies by a per-material sunVis that starts at 1", () => {
    const mat = new THREE.MeshStandardMaterial();
    const { sunVis } = patchSunShadow(mat, "object");
    expect(sunVis).toBeDefined();
    expect(sunVis!.value).toBe(1);
    const shader = stubShader();
    mat.onBeforeCompile(shader, renderer);
    expect(shader.uniforms.uSunVis).toBe(sunVis);
    expect(shader.fragmentShader).toContain("uniform float uSunVis;");
    expect(pointLoopBody(shader.fragmentShader)).toContain("uSunVis");
    // Object mode never runs the per-fragment coverage loop.
    expect(pointLoopBody(shader.fragmentShader)).not.toContain("sunShadowCoverage");
  });

  it("fragment mode returns no sunVis", () => {
    expect(patchSunShadow(new THREE.MeshStandardMaterial(), "fragment").sunVis).toBeUndefined();
  });

  it("cache keys differ by mode and by selfIndex, and keep the previous key", () => {
    const key = (mode: "fragment" | "object", selfIndex?: number) => {
      const m = new THREE.MeshStandardMaterial();
      patchSunShadow(m, mode, { selfIndex });
      return m.customProgramCacheKey();
    };
    expect(key("fragment", 0)).not.toBe(key("object", 0));
    expect(key("fragment", 0)).not.toBe(key("fragment", 1));
    expect(key("fragment", 1)).toBe(key("fragment", 1));

    const m = new THREE.MeshStandardMaterial();
    m.customProgramCacheKey = () => "previous-key";
    patchSunShadow(m, "fragment");
    expect(m.customProgramCacheKey()).toContain("previous-key");
  });

  it("refreshes uSunView from the rendering camera, composing with onBeforeRender", () => {
    const m = new THREE.MeshStandardMaterial();
    let prevCalled = false;
    m.onBeforeRender = () => { prevCalled = true; };
    patchSunShadow(m, "object");
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 5, 0);
    cam.updateMatrixWorld();
    m.onBeforeRender(renderer, new THREE.Scene(), cam, new THREE.BufferGeometry(), new THREE.Mesh(), null as unknown as THREE.Group);
    expect(prevCalled).toBe(true);
    expect(sunShadowUniforms.uSunView.value.y).toBeCloseTo(-5, 6);
  });
});
