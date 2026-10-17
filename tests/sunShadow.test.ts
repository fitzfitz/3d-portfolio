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

describe("patchSunShadow: patch once, shared sunVis", () => {
  it("a second patch of the same material returns the first handle and injects nothing twice", () => {
    const m = new THREE.MeshStandardMaterial();
    const first = patchSunShadow(m, "object");
    const keyAfterFirst = m.customProgramCacheKey();
    const compileAfterFirst = m.onBeforeCompile;
    const second = patchSunShadow(m, "object");
    expect(second).toBe(first);
    expect(second.sunVis).toBe(first.sunVis);
    expect(m.onBeforeCompile).toBe(compileAfterFirst);
    expect(m.customProgramCacheKey()).toBe(keyAfterFirst);
    const shader = stubShader();
    m.onBeforeCompile(shader, renderer);
    expect(shader.fragmentShader.match(/float sunShadowCoverage\(/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/#define SUN_SHADOW_SELF/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/uniform float uSunVis;/g)).toHaveLength(1);
  });

  it("object mode can share one sunVis across several materials", () => {
    const shared = { value: 0.5 };
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    expect(patchSunShadow(a, "object", { sunVis: shared }).sunVis).toBe(shared);
    expect(patchSunShadow(b, "object", { sunVis: shared }).sunVis).toBe(shared);
    const sa = stubShader(), sb = stubShader();
    a.onBeforeCompile(sa, renderer);
    b.onBeforeCompile(sb, renderer);
    expect(sa.uniforms.uSunVis).toBe(shared);
    expect(sb.uniforms.uSunVis).toBe(shared);
  });
});

describe("the coverage early-out (lateral distance before the trig)", () => {
  it("sits before the asin/acos in the GLSL", () => {
    const i = SUN_SHADOW_GLSL.indexOf("r + d * tanSun");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(SUN_SHADOW_GLSL.indexOf("asin( r / d )"));
  });

  it("never skips an occluder that covers any of the sun (exact, checked against sunVisibility)", async () => {
    const { sunVisibility } = await import("../src/utils/sunOcclusion");
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let rejected = 0;
    for (let n = 0; n < 20000; n++) {
      const p = { x: (rand() - 0.5) * 400, y: (rand() - 0.5) * 400, z: (rand() - 0.5) * 400 };
      const o = { x: p.x * (0.2 + rand() * 0.8) + (rand() - 0.5) * 60, y: p.y * (0.2 + rand() * 0.8) + (rand() - 0.5) * 60,
        z: p.z * (0.2 + rand() * 0.8) + (rand() - 0.5) * 60, r: 0.5 + rand() * 20 };
      const sunDist = Math.hypot(p.x, p.y, p.z);
      if (sunDist <= 8) continue;
      const bx = o.x - p.x, by = o.y - p.y, bz = o.z - p.z, d = Math.hypot(bx, by, bz);
      if (d >= sunDist || d <= o.r) continue;
      const c = -(bx * p.x + by * p.y + bz * p.z) / (d * sunDist);
      if (c <= 0) continue;
      const sinSun = 8 / sunDist, tanSun = sinSun / Math.sqrt(1 - sinSun * sinSun);
      if (d * Math.sqrt(Math.max(0, 1 - c * c)) > o.r + d * tanSun) {
        rejected++;
        expect(sunVisibility(p, [o], 8)).toBe(1);
      }
    }
    expect(rejected).toBeGreaterThan(1000);
  });
});
