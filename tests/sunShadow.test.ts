import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SUN_RADIUS } from "../src/constants";
import { BODY_IDS } from "../src/data/bodyIds";
import { MOON_IDS } from "../src/data/solarMoons";
import { readFileSync } from "node:fs";
import { bodyById } from "../src/data/solarSystem";
import { sunVisibility } from "../src/utils/sunOcclusion";
import {
  allOccluders,
  CPU_ONLY_BODIES,
  occluders,
  MAX_OCCLUDERS,
  OCCLUDER_SLOTS,
  SUN_SHADOW_GLSL,
  patchSunShadow,
  sunShadowCoverage,
  bodySlot,
  moonSlot,
  OCCLUDER_COUNT,
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
  it("holds MAX_OCCLUDERS = 16 Vector4 slots, a count and the sun's view position", () => {
    expect(MAX_OCCLUDERS).toBe(16);
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
    patchSunShadow(mat, "fragment");
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
    // No body is compiled out: the loop skips its own body by distance.
    expect(shader.fragmentShader).not.toMatch(/#define SUN_SHADOW_SELF /);
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

  it("cache keys differ by mode only, never by body, and keep the previous key", () => {
    const key = (mode: "fragment" | "object") => {
      const m = new THREE.MeshStandardMaterial();
      patchSunShadow(m, mode);
      return m.customProgramCacheKey();
    };
    expect(key("fragment")).not.toBe(key("object"));
    // Two planet surfaces with identical features: one program, whichever slots they fill.
    const a = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const b = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    patchSunShadow(a, "fragment");
    patchSunShadow(b, "fragment");
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toMatch(/sunShadow:fragment:/);

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
    expect(shader.fragmentShader.match(/#define SUN_SHADOW_SELF_SKIP/g)).toHaveLength(1);
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

describe("the self-skip (a body never shadows its own surface)", () => {
  it("is in the GLSL occluder loop, by distance, before the cover", () => {
    const loop = SUN_SHADOW_GLSL.slice(SUN_SHADOW_GLSL.indexOf("float sunShadowCoverage("));
    expect(SUN_SHADOW_GLSL).toContain("#define SUN_SHADOW_SELF_SKIP 1.05");
    const skip = loop.search(/if \( length\( uOccluders\[ k \]\.xyz - p \) < SUN_SHADOW_SELF_SKIP \* uOccluders\[ k \]\.w \) continue;/);
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(loop.indexOf("sunShadowCoverFrom("));
  });

  // The CPU mirror of that loop, so the skip is tested on real numbers.
  const body = { x: 100, y: 0, z: 0, r: 10 };
  const nightSide = (radii: number) => ({ x: 100 + radii * body.r, y: 0, z: 0 });

  it("a point on the occluder's own surface, or on a cloud shell at 1.03 R, is not self-shadowed", () => {
    expect(sunVisibility(nightSide(1), [body], SUN_RADIUS)).toBe(0); // without the skip: inside its own umbra
    expect(sunShadowCoverage(nightSide(1), [body])).toBe(1);
    expect(sunVisibility(nightSide(1.03), [body], SUN_RADIUS)).toBe(0);
    expect(sunShadowCoverage(nightSide(1.03), [body])).toBe(1);
  });

  it("stops at 1.05 R: beyond it the body shadows as before", () => {
    expect(sunShadowCoverage(nightSide(1.06), [body])).toBe(sunVisibility(nightSide(1.06), [body], SUN_RADIUS));
    expect(sunShadowCoverage(nightSide(1.06), [body])).toBeLessThan(0.01);
  });

  it("still lets every other occluder shadow the surface", () => {
    const moon = { x: 60, y: 0, z: 0, r: 4 }; // between the sun and the body's day side
    const daySide = { x: 90, y: 0, z: 0 };
    expect(sunShadowCoverage(daySide, [body, moon])).toBe(sunVisibility(daySide, [moon], SUN_RADIUS));
    expect(sunShadowCoverage(daySide, [body, moon])).toBeLessThan(1);
  });
});

describe("OCCLUDER_SLOTS (fixed, no per-frame selection)", () => {
  it("bodies with a moon or a ring 0-5, the nine moons 6-14: 15 of MAX_OCCLUDERS", () => {
    expect(OCCLUDER_SLOTS.bodies).toEqual({ first: 0, count: 6 });
    expect(OCCLUDER_SLOTS.moons).toEqual({ first: 6, count: 9 });
    expect(OCCLUDER_COUNT).toBe(15);
    expect(OCCLUDER_COUNT).toBeLessThanOrEqual(MAX_OCCLUDERS);
  });

  it("bodySlot gives Earth to Neptune (each has a moon or a ring) 0-5 and Mercury, Venus, Ceres none (CPU only)", () => {
    expect(Object.fromEntries(BODY_IDS.map((id) => [id, bodySlot(id)]))).toEqual({
      mercury: -1, venus: -1, earth: 0, mars: 1, ceres: -1, jupiter: 2, saturn: 3, uranus: 4, neptune: 5,
    });
  });

  it("moonSlot gives the moons 6-14 in MOON_IDS order", () => {
    expect(Object.fromEntries(MOON_IDS.map((id) => [id, moonSlot(id)]))).toEqual({
      moon: 6, phobos: 7, deimos: 8, io: 9, europa: 10, ganymede: 11, callisto: 12, titan: 13, triton: 14,
    });
  });
});

describe("allOccluders: every body and moon, for the CPU's sun tests (the ship's shadow, the sun's glare)", () => {
  it("is the sixteen GPU slots (the same objects, moons included) then Mercury, Venus and Ceres", () => {
    expect(allOccluders.slice(0, MAX_OCCLUDERS)).toEqual(occluders);
    for (let i = 0; i < MAX_OCCLUDERS; i++) expect(allOccluders[i]).toBe(occluders[i]);
    expect(CPU_ONLY_BODIES).toEqual(["mercury", "venus", "ceres"]);
    expect(allOccluders.length).toBe(MAX_OCCLUDERS + 3);
    CPU_ONLY_BODIES.forEach((id, k) => expect(allOccluders[MAX_OCCLUDERS + k].r, id).toBe(bodyById(id).size));
  });

  it("lets a moon hide the sun: a point behind the Moon sees less of it than the bodies alone allow", () => {
    const slot = moonSlot("moon");
    const keep = { ...occluders[slot] };
    try {
      // Far above the ecliptic, where no body can be in the way.
      setOccluder(slot, 0, 2000, 0, 5);
      const p = { x: 0, y: 2030, z: 0 };
      const withoutMoon = allOccluders.filter((o) => o !== occluders[slot]);
      const lit = sunVisibility(p, withoutMoon, SUN_RADIUS);
      expect(sunVisibility(p, allOccluders, SUN_RADIUS)).toBeLessThan(lit - 0.1);
    } finally {
      setOccluder(slot, keep.x, keep.y, keep.z, keep.r);
    }
  });

  it("is what the ship's shadow and the sun's glare both read", () => {
    const sun = readFileSync("src/components/canvas/Sun.tsx", "utf8");
    const ship = readFileSync("src/components/canvas/Spaceship.tsx", "utf8");
    expect(sun).toMatch(/sunVisibility\(cam\.position, allOccluders, SUN_RADIUS\)/);
    expect(ship).toMatch(/sunVisibility\(pos\.current, allOccluders, SUN_RADIUS\)/);
  });
});
