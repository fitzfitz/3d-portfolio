import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { exposureCompensation } from "../src/utils/sunLight";
import {
  SAUCER_BAND_PAINTS, SAUCER_SKIN_HUE, SAUCER_SPOT_HUE, saucerTint,
} from "../src/utils/monsters/monsterTint";
import {
  FUR_SHELL_GAP_PX, MONSTER_UNIFORMS, furAtlasUv, furShellCountSmooth, furShellPx, injectShader, shellFade,
} from "../src/utils/monsters/monsterShading";
import {
  LOD_HYSTERESIS, beginMonsterFrame, chooseLod, createLodState, endMonsterFrame, prepareMonsterGeometry, splitFurGeometry,
} from "../src/utils/monsters/monsterInstances";
import {
  AIM_PITCH_MAX, AIM_PITCH_MIN, EYE_PITCH_MAX, EYE_YAW_MAX, PORTHOLE_DIM, PORTHOLE_IDLE, PORTHOLE_TRAIL,
  SAUCER_FIRE_JAW, SAUCER_FIRE_LEAN, SAUCER_HIT_SQUASH, SAUCER_INSTANCE_ATTRIBUTES, addSaucer, createSaucerMaterials,
  portholeGlow, saucerBodyWeight, saucerDeformPoint, saucerHostWeights, saucerMuzzle, writeSaucerInstance,
  type SaucerLod, type SaucerPose, type SaucerRig,
} from "../src/utils/monsters/saucerMaterial";
import {
  CRYSTAL_GLOW, LEG_RETRACT, TARDIGRADE_INSTANCE_ATTRIBUTES, THROAT_GAIN, addTardigrade, createTardigradeMaterials,
  crystalGlow, legRetraction, tardigradeCurlPoint, tardigradeDeformPoint, throatEmissiveScale, writeTardigradeInstance,
  type TardigradeLod, type TardigradePose, type TardigradeRig,
} from "../src/utils/monsters/tardigradeMaterial";

/**
 * Task 5 (space monsters): the instanced materials and the vertex-shader
 * motion. WebGL does not run here, so the shaders are checked for their
 * anchors and the pure maths through their TypeScript mirrors; Task 6's lab
 * compiles and shows them for real. The rigs are read from the committed
 * JSON (the asset contract), never copied.
 */
const saucerRig = (): SaucerRig => JSON.parse(readFileSync("src/data/saucerRig.json", "utf8"));
const tardigradeRig = (): TardigradeRig => JSON.parse(readFileSync("src/data/tardigradeRig.json", "utf8"));

const sRGBHue = (c: THREE.Color) => {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  return hsl.h * 360;
};

const saucerPose = (over: Partial<SaucerPose> = {}): SaucerPose => ({
  phase: 0.3, look: new THREE.Vector3(0, 0, 1), aim: new THREE.Vector3(0, 0, 1),
  chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0, ...over,
});
const tardigradePose = (over: Partial<TardigradePose> = {}): TardigradePose => ({
  phase: 0.6, swim: 0, charge: 0, recoil: 0, hit: 0, curl: 0, ...over,
});

/** A small stand-in for a monster primitive, with the glTF attributes the loader names. */
function stubGeometry(fur = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute("_motion", new THREE.Float32BufferAttribute(new Array(12).fill(0.03125), 4));
  if (fur) g.setAttribute("_fur", new THREE.Float32BufferAttribute(new Array(6).fill(0.5), 2));
  g.setIndex([0, 1, 2]);
  return g;
}

function instanced(g: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial(), capacity);
  mesh.count = 0;
  return mesh;
}

/** The saucer's lock cards are LOD0 only (its LOD1 has none, so no cards mesh). */
function saucerLods(capacity: number, shells: number): SaucerLod[] {
  return [0, 1].map((k) => {
    const body = stubGeometry(), dome = stubGeometry(), fur = stubGeometry(true), cards = stubGeometry(true);
    prepareMonsterGeometry(body, capacity, SAUCER_INSTANCE_ATTRIBUTES.body, 0);
    prepareMonsterGeometry(dome, capacity, SAUCER_INSTANCE_ATTRIBUTES.dome, 0);
    prepareMonsterGeometry(fur, capacity * shells, SAUCER_INSTANCE_ATTRIBUTES.fur, 0);
    prepareMonsterGeometry(cards, capacity, SAUCER_INSTANCE_ATTRIBUTES.fur, 0);
    return {
      body: instanced(body, capacity), dome: instanced(dome, capacity), fur: instanced(fur, capacity * shells),
      cards: k === 0 ? instanced(cards, capacity) : null,
    };
  });
}
const saucerMeshes = (lods: SaucerLod[]) => lods.flatMap((l) => [l.body, l.dome, l.fur, ...(l.cards ? [l.cards] : [])]);

function tardigradeLods(capacity: number, shells: number): TardigradeLod[] {
  return [0, 1].map(() => {
    const body = stubGeometry(), fur = stubGeometry(true), cards = stubGeometry(true);
    prepareMonsterGeometry(body, capacity, TARDIGRADE_INSTANCE_ATTRIBUTES.body, 0);
    prepareMonsterGeometry(fur, capacity * shells, TARDIGRADE_INSTANCE_ATTRIBUTES.fur, 0);
    prepareMonsterGeometry(cards, capacity, TARDIGRADE_INSTANCE_ATTRIBUTES.fur, 0);
    return { body: instanced(body, capacity), fur: instanced(fur, capacity * shells), cards: instanced(cards, capacity) };
  });
}

const attr = (mesh: THREE.InstancedMesh, name: string) => mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
const slot = (mesh: THREE.InstancedMesh, name: string, i: number) => {
  const a = attr(mesh, name);
  return Array.from(a.array.slice(i * a.itemSize, (i + 1) * a.itemSize));
};

/** Runs a material's compile hook over a shader, as the renderer would. */
function compile(m: THREE.Material, vertexShader: string, fragmentShader: string) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
    vertexShader, fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}
const standard = (m: THREE.Material) => compile(m, THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.standard.fragmentShader);

function saucerMaterials() {
  const body = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
  const dome = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.16 });
  const fur = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture(), alphaTest: 0.01, side: THREE.DoubleSide });
  body.vertexColors = true; fur.vertexColors = true; // as GLTFLoader leaves them (COLOR_0 present)
  createSaucerMaterials(body, dome, fur, saucerRig());
  return { body, dome, fur };
}
function tardigradeMaterials() {
  const body = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
  const fur = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture(), alphaTest: 0.01, side: THREE.DoubleSide });
  body.vertexColors = true; fur.vertexColors = true;
  createTardigradeMaterials(body, fur, tardigradeRig());
  return { body, fur };
}

// ---------------------------------------------------------------- tint ---

describe("saucerTint: a per-instance colour for the skin, spot and band zones", () => {
  it("six seeds give six distinct skins inside 95°–135°, spots inside 330°–355°, bands from the five paints", () => {
    const tints = [0, 1, 2, 3, 4, 5].map((s) => saucerTint(s));
    expect(new Set(tints.map((t) => t.skin.getHexString())).size).toBe(6);
    expect(SAUCER_SKIN_HUE).toEqual([95, 135]);
    expect(SAUCER_SPOT_HUE).toEqual([330, 355]);
    expect(SAUCER_BAND_PAINTS).toHaveLength(5);
    const paints = SAUCER_BAND_PAINTS.map((p) => new THREE.Color(p).getHex());
    for (const t of tints) {
      expect(sRGBHue(t.skin)).toBeGreaterThanOrEqual(95 - 0.5);
      expect(sRGBHue(t.skin)).toBeLessThanOrEqual(135 + 0.5);
      expect(sRGBHue(t.spot)).toBeGreaterThanOrEqual(330 - 0.5);
      expect(sRGBHue(t.spot)).toBeLessThanOrEqual(355 + 0.5);
      expect(paints).toContain(t.band.getHex());
    }
    // the six use more than one paint
    expect(new Set(tints.map((t) => t.band.getHex())).size).toBeGreaterThan(1);
  });

  it("is deterministic per seed, and fills a passed-in tint without allocating new colours", () => {
    const a = saucerTint(42), b = saucerTint(42);
    expect(a.skin.equals(b.skin) && a.spot.equals(b.spot) && a.band.equals(b.band)).toBe(true);
    const out = { skin: new THREE.Color(), spot: new THREE.Color(), band: new THREE.Color() };
    const skin = out.skin;
    expect(saucerTint(42, out)).toBe(out);
    expect(out.skin).toBe(skin);
    expect(out.skin.equals(a.skin)).toBe(true);
  });

  it("multiplies the baked albedo without blacking it out: every channel stays above 0.2 (linear)", () => {
    for (let s = 0; s < 32; s++) {
      const t = saucerTint(s);
      for (const c of [t.skin, t.spot]) for (const v of [c.r, c.g, c.b]) expect(v).toBeGreaterThan(0.2);
    }
  });
});

// ------------------------------------------------------- materials -------

describe("createSaucerMaterials / createTardigradeMaterials: flags and program keys", () => {
  it("the dome is glass: transparent, no depth write, front faces only", () => {
    const { dome } = saucerMaterials();
    expect(dome.transparent).toBe(true);
    expect(dome.depthWrite).toBe(false);
    expect(dome.side).toBe(THREE.FrontSide);
  });

  it("each material keeps one stable program key, and COLOR_0 is a zone mask, not a colour", () => {
    const s = saucerMaterials(), t = tardigradeMaterials();
    expect(s.body.customProgramCacheKey()).toBe("saucer:v1");
    expect(s.dome.customProgramCacheKey()).toBe("saucerDome:v1");
    expect(s.fur.customProgramCacheKey()).toBe("saucerFur:v1");
    expect(t.body.customProgramCacheKey()).toBe("tardigrade:v1");
    expect(t.fur.customProgramCacheKey()).toBe("tardigradeFur:v1");
    for (const m of [s.body, s.fur, t.body, t.fur]) expect(m.vertexColors).toBe(false);
    // the fur keeps its authored cutoff (the shells raise it per shell in the shader) and its double side (the cards)
    expect(s.fur.alphaTest).toBeCloseTo(0.01, 5);
    expect(s.fur.side).toBe(THREE.DoubleSide);
  });

  it("every material shares the one uTime and uMotion uniform objects", () => {
    const s = saucerMaterials(), t = tardigradeMaterials();
    for (const m of [s.body, s.fur, t.body, t.fur]) {
      const sh = standard(m);
      expect(sh.uniforms.uTime).toBe(MONSTER_UNIFORMS.uTime);
      expect(sh.uniforms.uMotion).toBe(MONSTER_UNIFORMS.uMotion);
    }
    expect(MONSTER_UNIFORMS.uMotion.value).toBe(1);
  });

  it("R22: every material shares the game's exposureCompensation object, and the glow terms multiply by it", () => {
    const s = saucerMaterials(), t = tardigradeMaterials();
    for (const m of [s.body, s.dome, s.fur, t.body, t.fur]) {
      expect(standard(m).uniforms.uExposureComp).toBe(exposureCompensation);
    }
    // the two emissive patches (saucer porthole, tardigrade throat and crystals) carry the factor
    for (const m of [s.body, t.body]) {
      const fs = standard(m).fragmentShader;
      expect(fs).toContain("uniform float uExposureComp;");
      expect(fs).toMatch(/totalEmissiveRadiance \*= [^;]*uExposureComp/);
    }
  });
});

describe("the shader patches hit every three.js anchor they target", () => {
  const V = ["#include <common>", "#include <beginnormal_vertex>", "#include <begin_vertex>"];
  const BAKED_F = ["#include <common>", "#include <emissivemap_fragment>",
    "#include <lights_physical_fragment>", "#include <lights_fragment_begin>"];
  const SAUCER_F = [...BAKED_F, "#include <color_fragment>"]; // + the per-instance tint
  const FUR_F = ["#include <common>", "#include <map_fragment>", "#include <alphatest_fragment>",
    "#include <normal_fragment_maps>", "#include <lights_fragment_begin>"];
  const DOME_F = ["#include <common>", "#include <opaque_fragment>"];
  const cases = () => {
    const s = saucerMaterials(), t = tardigradeMaterials();
    return [
      ["saucer body", s.body, V, SAUCER_F],
      ["saucer dome", s.dome, [], DOME_F],
      ["saucer fur", s.fur, V, FUR_F],
      ["tardigrade body", t.body, V, BAKED_F],
      ["tardigrade fur", t.fur, V, FUR_F],
    ] as const;
  };
  const marker = (anchor: string) => `// monster patch: ${anchor}`;

  it("on three's own standard shader, each targeted anchor carries its patch (no silent no-op)", () => {
    for (const [name, m, vs, fs] of cases()) {
      const sh = standard(m);
      for (const a of vs) expect(sh.vertexShader, `${name} vertex ${a}`).toContain(marker(a));
      for (const a of fs) expect(sh.fragmentShader, `${name} fragment ${a}`).toContain(marker(a));
      // and nothing else is marked: the lists above are the whole patch
      expect(sh.vertexShader.split("// monster patch: ").length - 1, `${name} vertex`).toBe(vs.length);
      expect(sh.fragmentShader.split("// monster patch: ").length - 1, `${name} fragment`).toBe(fs.length);
    }
  });

  it("on a stub holding only the anchors, every anchor is patched too", () => {
    for (const [name, m, vs, fs] of cases()) {
      const sh = compile(m, vs.join("\n"), fs.join("\n"));
      for (const a of vs) expect(sh.vertexShader, `${name} ${a}`).toContain(marker(a));
      for (const a of fs) expect(sh.fragmentShader, `${name} ${a}`).toContain(marker(a));
    }
  });

  it("a missing anchor fails loudly (a three.js upgrade must not silently drop the motion)", () => {
    for (const [name, m, vs, fs] of cases()) {
      if (vs.length) expect(() => compile(m, vs.slice(1).join("\n"), fs.join("\n")), name).toThrow(/anchor/);
      expect(() => compile(m, vs.join("\n"), fs.slice(0, -1).join("\n")), name).toThrow(/anchor/);
    }
    expect(() => injectShader("void main() {}", "#include <begin_vertex>", "x", "after")).toThrow(/anchor/);
  });

  it("the replaced fur chunks keep three's code but sample the remapped atlas with explicit gradients", () => {
    for (const m of [saucerMaterials().fur, tardigradeMaterials().fur]) {
      const fs = standard(m).fragmentShader;
      // (the patch markers quote the anchor in a comment; no live include line may remain)
      expect(fs).not.toMatch(/^\s*#include <map_fragment>/m);
      expect(fs).not.toMatch(/^\s*#include <normal_fragment_maps>/m);
      expect(fs).not.toMatch(/^\s*#include <alphatest_fragment>/m);
      expect(fs).not.toContain("texture2D( map, vMapUv )");
      expect(fs).not.toContain("texture2D( normalMap, vNormalMapUv )");
      expect(fs).toContain("monsterFurTexture( map, vMapUv )");
      expect(fs).toContain("monsterFurTexture( normalMap, vNormalMapUv )");
      expect(fs).toContain("textureGrad(");
      expect(fs).toContain("mapN.xy *= normalScale;"); // the rest of three's chunk is still there
    }
  });

  it("the generated GLSL has no NaN, undefined or unbalanced braces (template slips)", () => {
    for (const [name, m] of cases()) {
      const sh = standard(m);
      for (const src of [sh.vertexShader, sh.fragmentShader]) {
        expect(src, name).not.toMatch(/NaN|undefined|Infinity|\[object/);
        expect(src.split("{").length, name).toBe(src.split("}").length);
        expect(src.split("(").length, name).toBe(src.split(")").length);
      }
    }
  });

  it("the rig's numbers reach the shaders (pivots, the fur's atlas rect and length, the curl centre)", () => {
    const r = saucerRig(), tr = tardigradeRig();
    const s = saucerMaterials(), t = tardigradeMaterials();
    const fv = (x: number) => x.toFixed(5);
    expect(standard(s.body).vertexShader).toContain(fv(r.pivots.jaw[1]));
    expect(standard(s.body).vertexShader).toContain(fv(r.pivots.cannon[1]));
    expect(standard(s.fur).vertexShader).toContain(fv(r.furMaxLength));
    expect(standard(s.fur).fragmentShader).toContain(`vec4(${r.furAtlas.shells.map(fv).join(", ")})`);
    expect(standard(t.body).vertexShader).toContain(fv(tr.hips[7][2]));
    expect(standard(t.fur).vertexShader).toContain(fv(tr.furMaxLength));
  });
});

// ------------------------------------------------------- writers ---------

describe("writeSaucerInstance / writeTardigradeInstance: packed, clamped, in their declared slots", () => {
  it("declares the per-instance attributes of each primitive (and stays under 16 vertex attributes)", () => {
    expect(Object.keys(SAUCER_INSTANCE_ATTRIBUTES).sort()).toEqual(["body", "dome", "fur"]);
    expect(SAUCER_INSTANCE_ATTRIBUTES.fur.monsterShell).toBe(2);
    expect(TARDIGRADE_INSTANCE_ATTRIBUTES.fur.monsterShell).toBe(2);
    const slots = (layout: Record<string, number>, mesh: number) => Object.keys(layout).length + mesh + 4; // + instanceMatrix
    expect(slots(SAUCER_INSTANCE_ATTRIBUTES.body, 5)).toBeLessThanOrEqual(16); // position normal uv mask motion
    expect(slots(SAUCER_INSTANCE_ATTRIBUTES.fur, 6)).toBeLessThanOrEqual(16); // + _FUR
    expect(slots(TARDIGRADE_INSTANCE_ATTRIBUTES.body, 5)).toBeLessThanOrEqual(16);
    expect(slots(TARDIGRADE_INSTANCE_ATTRIBUTES.fur, 6)).toBeLessThanOrEqual(16);
  });

  it("saucer: the pose and the tint land in slot i of their attributes", () => {
    const [lod] = saucerLods(4, 16);
    const tint = saucerTint(7);
    writeSaucerInstance(lod.body, 2, saucerPose({ phase: 0.25, chase: 0.4, fire: 0.5, hit: 0.75, defeat: 0.2, blink: 0.9 }), tint);
    expect(slot(lod.body, "saucerPose", 2)).toEqual([0.25, expect.closeTo(0.4, 6), 0.5, 0.75]);
    expect(slot(lod.body, "saucerPose", 1)).toEqual([0, 0, 0, 0]);
    expect(slot(lod.body, "saucerMood", 2)).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.9, 6)]);
    expect(slot(lod.body, "saucerLook", 2)).toEqual([0, 0, 0, 0]); // rest gaze and rest aim are +Z
    expect(slot(lod.body, "saucerSkin", 2)).toEqual([tint.skin.r, tint.skin.g, tint.skin.b].map((v) => expect.closeTo(v, 6)));
    expect(slot(lod.body, "saucerSpot", 2)).toEqual([tint.spot.r, tint.spot.g, tint.spot.b].map((v) => expect.closeTo(v, 6)));
    expect(slot(lod.body, "saucerBand", 2)).toEqual([tint.band.r, tint.band.g, tint.band.b].map((v) => expect.closeTo(v, 6)));
    expect(attr(lod.body, "saucerPose").version).toBeGreaterThan(0);
    // the dome has no pose; the fur takes only what its parts use
    writeSaucerInstance(lod.dome, 0, saucerPose(), tint);
    writeSaucerInstance(lod.fur, 5, saucerPose({ fire: 1 }), tint);
    expect(slot(lod.fur, "saucerPose", 5)[2]).toBe(1);
  });

  it("saucer: out-of-range input is clamped, the chase wraps (or switches off), the phase wraps", () => {
    const [lod] = saucerLods(2, 16);
    const tint = saucerTint(1);
    writeSaucerInstance(lod.body, 0, saucerPose({ phase: 1.25, chase: 5, fire: 2, hit: -1, defeat: 9, blink: -3 }), tint);
    expect(slot(lod.body, "saucerPose", 0)).toEqual([0.25, 0, 1, 0]);
    expect(slot(lod.body, "saucerMood", 0)).toEqual([1, 0]);
    writeSaucerInstance(lod.body, 0, saucerPose({ chase: 5.75, phase: -0.25 }), tint);
    expect(slot(lod.body, "saucerPose", 0)[1]).toBeCloseTo(0.75, 6);
    expect(slot(lod.body, "saucerPose", 0)[0]).toBeCloseTo(0.75, 6);
    writeSaucerInstance(lod.body, 0, saucerPose({ chase: -0.3 }), tint);
    expect(slot(lod.body, "saucerPose", 0)[1]).toBe(-1);
  });

  it("saucer: look and aim become clamped yaw/pitch (eyes can't look behind; the barrel can't aim into the hull)", () => {
    const [lod] = saucerLods(1, 16);
    const tint = saucerTint(1);
    writeSaucerInstance(lod.body, 0, saucerPose({ look: new THREE.Vector3(1, 0, 0), aim: new THREE.Vector3(0, -1, 0) }), tint);
    let [ly, lp, ay, ap] = slot(lod.body, "saucerLook", 0);
    expect(ly).toBeCloseTo(EYE_YAW_MAX, 6);
    expect(lp).toBeCloseTo(0, 6);
    expect(ap).toBeCloseTo(AIM_PITCH_MIN, 6);
    writeSaucerInstance(lod.body, 0, saucerPose({ look: new THREE.Vector3(0, 5, 0.1), aim: new THREE.Vector3(-1, 0, -1) }), tint);
    [ly, lp, ay, ap] = slot(lod.body, "saucerLook", 0);
    expect(lp).toBeCloseTo(EYE_PITCH_MAX, 6);
    expect(ay).toBeCloseTo(-3 * Math.PI / 4, 5); // the turret turns all the way round
    expect(ap).toBeCloseTo(0, 6);
    writeSaucerInstance(lod.body, 0, saucerPose({ aim: new THREE.Vector3(0, 1, 1) }), tint);
    expect(slot(lod.body, "saucerLook", 0)[3]).toBeCloseTo(AIM_PITCH_MAX, 6);
    // a zero vector is the rest pose, never NaN
    writeSaucerInstance(lod.body, 0, saucerPose({ look: new THREE.Vector3(), aim: new THREE.Vector3() }), tint);
    expect(slot(lod.body, "saucerLook", 0)).toEqual([0, 0, 0, 0]);
  });

  it("tardigrade: the pose lands in slot i; charge 2 → 1 and every other channel clamps", () => {
    const [lod] = tardigradeLods(3, 16);
    writeTardigradeInstance(lod.body, 1, tardigradePose({ phase: 0.5, swim: 0.25, charge: 0.75, recoil: 0.1, hit: 0.2, curl: 0.3 }));
    expect(slot(lod.body, "tardigradePose", 1)).toEqual([0.5, 0.25, 0.75, expect.closeTo(0.1, 6)]);
    expect(slot(lod.body, "tardigradeState", 1)).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.3, 6)]);
    expect(slot(lod.body, "tardigradePose", 0)).toEqual([0, 0, 0, 0]);
    writeTardigradeInstance(lod.body, 1, tardigradePose({ phase: 2.5, swim: -1, charge: 2, recoil: 7, hit: -2, curl: 1.5 }));
    expect(slot(lod.body, "tardigradePose", 1)).toEqual([0.5, 0, 1, 1]);
    expect(slot(lod.body, "tardigradeState", 1)).toEqual([0, 1]);
  });
});

describe("addSaucer / addTardigrade: per-instance LOD and the shell layout", () => {
  const at = (x: number) => new THREE.Matrix4().makeTranslation(x, 0, 0);

  it("six saucers up close: LOD0 only, the fur drawn monsters × shells with each shell's index written", () => {
    const r = saucerRig();
    const lods = saucerLods(6, r.furShells);
    const all = saucerMeshes(lods);
    beginMonsterFrame(all);
    const tint = saucerTint(3);
    for (let i = 0; i < 6; i++) addSaucer(lods, r, at(i * 4), 3, saucerPose({ fire: i / 5 }), tint);
    endMonsterFrame(all);
    expect([lods[0].body.count, lods[0].dome.count, lods[0].fur.count]).toEqual([6, 6, 6 * r.furShells]);
    expect([lods[1].body.count, lods[1].dome.count, lods[1].fur.count]).toEqual([0, 0, 0]);
    // R19: the lock cards draw once per saucer, as shell 0 of 1, with the saucer's own pose and place
    expect(lods[0].cards!.count).toBe(6);
    for (let m = 0; m < 6; m++) {
      expect(slot(lods[0].cards!, "monsterShell", m)).toEqual([0, 1]);
      expect(slot(lods[0].cards!, "saucerPose", m)[2]).toBeCloseTo(m / 5, 6);
      const e = new THREE.Matrix4();
      lods[0].cards!.getMatrixAt(m, e);
      expect(e.elements[12]).toBe(m * 4);
    }
    for (let m = 0; m < 6; m++) {
      for (let s = 0; s < r.furShells; s++) {
        const j = m * r.furShells + s;
        expect(slot(lods[0].fur, "monsterShell", j)).toEqual([s, r.furShells]);
        expect(slot(lods[0].fur, "saucerPose", j)[2]).toBeCloseTo(m / 5, 6); // the monster's data, once per shell
        const e = new THREE.Matrix4();
        lods[0].fur.getMatrixAt(j, e);
        expect(e.elements[12]).toBe(m * 4);
      }
    }
    expect(lods[0].body.boundingSphere).not.toBeNull();
    expect(lods[0].body.boundingSphere!.radius).toBeGreaterThan(10); // spans all six
  });

  it("a saucer past rig.lod1Distance moves to LOD1, with fewer shells; the frame starts clean", () => {
    const r = saucerRig();
    const lods = saucerLods(6, r.furShells);
    const all = saucerMeshes(lods);
    beginMonsterFrame(all);
    const tint = saucerTint(3);
    addSaucer(lods, r, at(0), 3, saucerPose(), tint);
    addSaucer(lods, r, at(0), r.lod1Distance + 0.01, saucerPose(), tint);
    addSaucer(lods, r, at(0), 500, saucerPose(), tint);
    endMonsterFrame(all);
    expect([lods[0].body.count, lods[1].body.count, lods[1].dome.count]).toEqual([1, 2, 2]);
    expect(lods[0].cards!.count).toBe(1); // the LOD1 saucers have no cards to draw
    expect(lods[1].cards).toBeNull();
    const farC = furShellCountSmooth(r.lod1Distance + 0.01, r.furMaxLength, r.furShells), far = Math.ceil(farC);
    expect(lods[1].fur.count).toBe(far + 1);
    expect(slot(lods[1].fur, "monsterShell", 0)[1]).toBeCloseTo(farC, 5);
    beginMonsterFrame(all);
    expect(all.every((m) => m.count === 0)).toBe(true);
  });

  it("never writes past a mesh's capacity", () => {
    const r = saucerRig();
    const lods = saucerLods(2, r.furShells);
    const all = saucerMeshes(lods);
    beginMonsterFrame(all);
    for (let i = 0; i < 5; i++) addSaucer(lods, r, at(i), 2, saucerPose(), saucerTint(i));
    expect(lods[0].body.count).toBe(2);
    expect(lods[0].fur.count).toBe(2 * r.furShells);
    expect(lods[0].cards!.count).toBe(2);
  });

  it("two tardigrades: body, fur base and cards per level, the shells per monster, the LOD per instance", () => {
    const r = tardigradeRig();
    const lods = tardigradeLods(2, r.furShells);
    const all = lods.flatMap((l) => [l.body, l.fur, l.cards!]);
    beginMonsterFrame(all);
    addTardigrade(lods, r, at(0), 4, tardigradePose({ charge: 0.5 }));
    addTardigrade(lods, r, at(20), r.lod1Distance + 1, tardigradePose());
    endMonsterFrame(all);
    expect([lods[0].body.count, lods[1].body.count]).toEqual([1, 1]);
    expect(lods[0].fur.count).toBe(r.furShells);
    expect(slot(lods[0].fur, "monsterShell", r.furShells - 1)).toEqual([r.furShells - 1, r.furShells]);
    expect(slot(lods[0].fur, "tardigradePose", 3)[2]).toBe(0.5);
    expect(lods[1].fur.count).toBe(Math.ceil(furShellCountSmooth(r.lod1Distance + 1, r.furMaxLength, r.furShells)));
    // R19: cards once per tardigrade on either level (LOD1 keeps its merged fringe cards)
    expect([lods[0].cards!.count, lods[1].cards!.count]).toEqual([1, 1]);
    expect(slot(lods[0].cards!, "monsterShell", 0)).toEqual([0, 1]);
    expect(slot(lods[0].cards!, "tardigradePose", 0)[2]).toBe(0.5);
  });
});

describe("splitFurGeometry (R19): the lock cards come off the fur base at load", () => {
  /** Two quads' worth: triangle 0 on the fur base, triangle 1 a card (COLOR_0 R = 1), sharing no vertex. */
  function furWithCard(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0, 9, 9, 9], 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1], 4));
    g.setAttribute("_fur", new THREE.Float32BufferAttribute([0.5, 0.1, 0.6, 0.2, 0.7, 0.3, 0.04, 0.9, 0.2, 0.9, 0.34, 0.9, 0, 0], 2));
    g.setIndex([0, 1, 2, 3, 4, 5]); // vertex 6 is unused
    return g;
  }

  it("splits by the card flag, keeps only each part's vertices, and carries every attribute", () => {
    const { base, cards } = splitFurGeometry(furWithCard());
    expect(base.getIndex()!.count).toBe(3);
    expect(cards!.getIndex()!.count).toBe(3);
    expect(base.getAttribute("position").count).toBe(3);
    expect(cards!.getAttribute("position").count).toBe(3);
    expect(Array.from(cards!.getAttribute("position").array.slice(0, 3))).toEqual([5, 0, 0]);
    expect(Array.from(cards!.getAttribute("_fur").array)).toEqual([0.04, 0.9, 0.2, 0.9, 0.34, 0.9].map((v) => expect.closeTo(v, 6)));
    for (let i = 0; i < 3; i++) {
      expect(base.getAttribute("color").getX(i)).toBe(0);
      expect(cards!.getAttribute("color").getX(i)).toBe(1);
    }
    expect(Object.keys(cards!.attributes).sort()).toEqual(["_fur", "color", "position"]);
  });

  it("a fur with no cards (the saucer's LOD1) gives no cards geometry; a fur without the mask is refused", () => {
    const g = furWithCard();
    g.setIndex([0, 1, 2]);
    expect(splitFurGeometry(g).cards).toBeNull();
    g.deleteAttribute("color");
    expect(() => splitFurGeometry(g)).toThrow(/mask/);
  });
});

describe("prepareMonsterGeometry", () => {
  it("renames the glTF zone mask and motion channels, adds dynamic per-instance attributes, pads the bounds", () => {
    const g = stubGeometry(true);
    g.computeBoundingSphere();
    const r0 = g.boundingSphere!.radius;
    prepareMonsterGeometry(g, 8, SAUCER_INSTANCE_ATTRIBUTES.fur, 0.5);
    expect(g.getAttribute("color")).toBeUndefined();
    expect(g.getAttribute("_motion")).toBeUndefined();
    expect(g.getAttribute("_fur")).toBeUndefined();
    expect(g.getAttribute("monsterMask").itemSize).toBe(4);
    expect(g.getAttribute("monsterMotion").itemSize).toBe(4);
    expect(g.getAttribute("monsterFur").itemSize).toBe(2);
    const shell = g.getAttribute("monsterShell") as THREE.InstancedBufferAttribute;
    expect(shell.isInstancedBufferAttribute).toBe(true);
    expect(shell.count).toBe(8);
    expect(shell.usage).toBe(THREE.DynamicDrawUsage);
    expect(g.boundingSphere!.radius).toBeCloseTo(r0 + 0.5, 6);
  });
});

// ------------------------------------------------------- pure maths ------

describe("furAtlasUv: the shells sample only the atlas's shell half, inset against bleeding", () => {
  const rect = () => saucerRig().furAtlas.shells as [number, number, number, number];
  const out = { u: 0, v: 0 };

  it("wraps unbounded coordinates into the rect from the rig (not a hard-coded 0.5)", () => {
    const r = rect();
    furAtlasUv(3.25, -1.75, r, 1024, 512, 1, out);
    const w = r[2] - r[0], h = r[3] - r[1];
    const iu = 1 / 1024, iv = 1 / 512;
    expect(out.u).toBeCloseTo(r[0] + iu + 0.25 * (w - 2 * iu), 9);
    expect(out.v).toBeCloseTo(r[1] + iv + 0.25 * (h - 2 * iv), 9);
    furAtlasUv(0.5, 0.5, [0.5, 0, 1, 1], 1024, 512, 1, out);
    expect(out.u).toBeCloseTo(0.75, 9);
  });

  it("never reaches the rect's edge by less than the current mip's footprint", () => {
    const r = rect();
    for (const fp of [1, 2, 8, 64]) {
      for (const u of [0, 0.999999, -0.000001, 7.5, -7.0]) {
        furAtlasUv(u, u, r, 1024, 512, fp, out);
        expect(out.u).toBeGreaterThanOrEqual(r[0] + fp / 1024 - 1e-9);
        expect(out.u).toBeLessThanOrEqual(r[2] - fp / 1024 + 1e-9);
        expect(out.v).toBeGreaterThanOrEqual(r[1] + fp / 512 - 1e-9);
        expect(out.v).toBeLessThanOrEqual(r[3] - fp / 512 + 1e-9);
      }
    }
    // a footprint under one texel still insets a whole texel (bilinear at mip 0 reads half of one each side)
    furAtlasUv(0, 0, r, 1024, 512, 0.25, out);
    expect(out.u).toBeCloseTo(r[0] + 1 / 1024, 9);
  });
});

describe("portholeGlow: the chase runs round the 16 portholes", () => {
  it("off (chase -1): every porthole holds the idle glow; off a lens nothing glows", () => {
    const n = saucerRig().portholes;
    expect(saucerRig().portholeOrder).toBe("+Z toward +X");
    for (let k = 0; k < n; k++) expect(portholeGlow((k + 0.5) / n, -1, n)).toBe(PORTHOLE_IDLE);
    expect(portholeGlow(0, 0.3, n)).toBe(0);
    expect(portholeGlow(0, -1, n)).toBe(0);
  });

  it("the porthole nearest the chase glows full and the two behind it fade, wrapping round", () => {
    const n = saucerRig().portholes;
    const glow = (c: number) => Array.from({ length: n }, (_, k) => portholeGlow((k + 0.5) / n, c, n));
    const g = glow((5 + 0.5) / n);
    expect(g[5]).toBe(1);
    expect(g[4]).toBe(PORTHOLE_TRAIL[0]);
    expect(g[3]).toBe(PORTHOLE_TRAIL[1]);
    expect(PORTHOLE_TRAIL[0]).toBeGreaterThan(PORTHOLE_TRAIL[1]);
    expect(PORTHOLE_TRAIL[1]).toBeGreaterThan(PORTHOLE_DIM);
    for (const k of [0, 1, 2, 6, 7, 15]) expect(g[k]).toBe(PORTHOLE_DIM);
    const w = glow(0.01);
    expect([w[0], w[15], w[14], w[13]]).toEqual([1, PORTHOLE_TRAIL[0], PORTHOLE_TRAIL[1], PORTHOLE_DIM]);
    // quantized ramps (±0.002) still find their own porthole
    expect(portholeGlow((5 + 0.5) / n + 0.002, (5 + 0.5) / n, n)).toBe(1);
  });
});

describe("saucer motion helpers (TS mirrors of the vertex shader's choices)", () => {
  it("body weight is linear in glTF y over rig.bodySpan, clamped", () => {
    const r = saucerRig();
    expect(saucerBodyWeight(r.bodySpan[0], r)).toBe(0);
    expect(saucerBodyWeight(r.bodySpan[1], r)).toBe(1);
    expect(saucerBodyWeight((r.bodySpan[0] + r.bodySpan[1]) / 2, r)).toBeCloseTo(0.5, 9);
    expect(saucerBodyWeight(-5, r)).toBe(0);
    expect(saucerBodyWeight(5, r)).toBe(1);
  });

  it("each part follows its host: drips by their root's host weight (_MOTION.z), the jaw by its height", () => {
    const r = saucerRig();
    const out = { wave: 0, body: 0 };
    const slot16 = (id: number) => (id + 0.5) / 16;
    // rim drips (9) are static but for their own sway
    saucerHostWeights([slot16(9), 0.8, 0, 0.5], 0.1, r, out);
    expect(out).toEqual({ wave: 0, body: 0 });
    // tentacle drips (10) follow the wave at the root's weight, and the body by its height under the base
    saucerHostWeights([slot16(10), 0.9, 0.6, 0.5], 0.5, r, out);
    expect(out.wave).toBeCloseTo(0.6, 6);
    expect(out.body).toBeCloseTo(saucerBodyWeight(0.5, r) * 0.4, 6);
    // body drips (11) lean with the body at the root's height weight
    saucerHostWeights([slot16(11), 0.9, 0.7, 0.5], -0.4, r, out);
    expect(out).toEqual({ wave: 0, body: expect.closeTo(0.7, 6) });
    // the jaw's y is its influence, so its body weight comes from its height (R13)
    saucerHostWeights([slot16(6), 1, 0, 0.3], 0.2, r, out);
    expect(out.body).toBeCloseTo(saucerBodyWeight(0.2, r), 6);
    // the tentacle itself: wave by its weight, body lean fading toward its tip
    saucerHostWeights([slot16(2), 0.25, 0, 0], 0.4, r, out);
    expect(out.wave).toBeCloseTo(0.25, 6);
    expect(out.body).toBeCloseTo(saucerBodyWeight(0.4, r) * 0.75, 6);
    // the hull and the cannon never lean
    for (const id of [0, 7]) {
      saucerHostWeights([slot16(id), 1, 0.5, 0], 0.9, r, out);
      expect(out).toEqual({ wave: 0, body: 0 });
    }
  });

  it("saucerMuzzle: the barrel's tip follows the aim about the cannon pivot", () => {
    const r = saucerRig();
    const out = new THREE.Vector3();
    saucerMuzzle(new THREE.Vector3(0, 0, 1), r, out);
    expect(out.toArray().map((v, i) => v - r.muzzle[i]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
    saucerMuzzle(new THREE.Vector3(1, 0, 0), r, out);
    const reach = Math.hypot(r.muzzle[0] - r.pivots.cannon[0], r.muzzle[1] - r.pivots.cannon[1], r.muzzle[2] - r.pivots.cannon[2]);
    expect(out.x - r.pivots.cannon[0]).toBeCloseTo(reach, 5);
    saucerMuzzle(new THREE.Vector3(0, -1, 0), r, out);
    expect(out.y).toBeLessThan(r.muzzle[1]);
    expect(out.distanceTo(new THREE.Vector3(...r.pivots.cannon))).toBeCloseTo(reach, 5);
  });
});

describe("tardigrade helpers", () => {
  it("throatEmissiveScale: dark at charge 0 (the tested default look), monotone, charge² × gain, clamped", () => {
    expect(throatEmissiveScale(0)).toBe(0);
    expect(throatEmissiveScale(-1)).toBe(0);
    expect(throatEmissiveScale(1)).toBe(THROAT_GAIN);
    expect(throatEmissiveScale(2)).toBe(THROAT_GAIN);
    expect(throatEmissiveScale(0.5)).toBeCloseTo(0.25 * THROAT_GAIN, 9);
    let last = -1;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const v = throatEmissiveScale(c);
      expect(v).toBeGreaterThan(last);
      last = v;
    }
  });

  it("the curl: straight at 0; at full curl the axis closes into a ring of radius L/2π about rig.curlCentre", () => {
    const r = tardigradeRig();
    const T = new THREE.Vector3(...r.axis.tail), M = new THREE.Vector3(...r.axis.mouth), C = new THREE.Vector3(...r.curlCentre);
    const L = T.distanceTo(M);
    const p = new THREE.Vector3();
    for (const a of [0, 0.25, 0.5, 0.9, 1]) {
      tardigradeCurlPoint(a, 0, r, p);
      expect(p.distanceTo(T.clone().lerp(M, a))).toBeLessThan(1e-6);
      tardigradeCurlPoint(a, 1, r, p);
      expect(p.distanceTo(C)).toBeCloseTo(L / (2 * Math.PI), 3); // the rig is rounded to 4 decimals
    }
    const tail = new THREE.Vector3(), mouth = new THREE.Vector3();
    tardigradeCurlPoint(0, 1, r, tail);
    tardigradeCurlPoint(1, 1, r, mouth);
    expect(tail.distanceTo(mouth)).toBeLessThan(1e-5);
    // the middle stays put and the ends swing toward the belly (curlCentre's side)
    tardigradeCurlPoint(0.5, 0.6, r, p);
    expect(p.distanceTo(T.clone().lerp(M, 0.5))).toBeLessThan(1e-6);
    tardigradeCurlPoint(0, 0.6, r, p);
    expect(p.y).toBeLessThan(T.y);
    // tiny curls are stable (no 0/0)
    tardigradeCurlPoint(1, 1e-9, r, p);
    expect(p.distanceTo(M)).toBeLessThan(1e-5);
  });

  it("the legs retract toward their hips as the curl rises, so the feet stay outside the ball's centre", () => {
    expect(legRetraction(0)).toBe(1);
    expect(legRetraction(1)).toBeCloseTo(1 - LEG_RETRACT, 9);
    expect(legRetraction(2)).toBeCloseTo(1 - LEG_RETRACT, 9);
    const r = tardigradeRig();
    // at full curl the hips sit on the ring's belly side: a leg's reach shrunk by the retraction must not reach the centre
    const C = new THREE.Vector3(...r.curlCentre);
    const L = new THREE.Vector3(...r.axis.tail).distanceTo(new THREE.Vector3(...r.axis.mouth));
    const ring = L / (2 * Math.PI);
    const hipDrop = Math.min(...r.hips.map((h) => h[1])) - r.axis.tail[1]; // hips sit this far below the axis (belly side)
    const legReach = 0.9; // hip to the foot's far side, about (gen_tardigrade.py: LEG_LEN 0.44, claws, FOOT_R 0.31)
    expect(ring + hipDrop - legReach * legRetraction(1)).toBeGreaterThan(0);
    expect(C.y).toBeLessThan(r.axis.tail[1]);
  });
});

// ------------------------------------------- reduced motion (R20) -------

describe("reduced motion (R20): decorative motion stops, state poses still apply without oscillating", () => {
  const slot16 = (id: number) => (id + 0.5) / 16;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const out = new THREE.Vector3();
  const TIMES = [0, 0.5, 3.7, 19.1, 41.2];

  /** One rest vertex per saucer part (positions in glTF space, near where the part sits). */
  const saucerSamples = (r: SaucerRig) => {
    const piv = (p: readonly number[], dz = 0, dy = 0) => v(p[0], p[1] + dy, p[2] + dz);
    return [
      { name: "hull porthole", motion: [slot16(0), 0, 0.3, 0], rest: v(1.2, -0.1, 0.5) },
      { name: "body crown", motion: [slot16(1), 0.9, 0, 0], rest: v(0, 1.1, 0.1) },
      { name: "tentacle", motion: [slot16(2), 0.8, 0, 0.3], rest: v(0.6, 0.6, 0.2) },
      { name: "eye L", motion: [slot16(3), 0, 0, 0], rest: piv(r.pivots.eyeL, r.eyeRadius) },
      { name: "eye R", motion: [slot16(4), 0, 0, 0], rest: piv(r.pivots.eyeR, r.eyeRadius) },
      { name: "eye top", motion: [slot16(5), 0, 0, 0], rest: piv(r.pivots.eyeTop, r.eyeRadius) },
      { name: "jaw", motion: [slot16(6), 1, 0, 0.3], rest: v(0, 0.2, 0.55) },
      { name: "cannon barrel", motion: [slot16(7), 1, 0, 0], rest: v(r.muzzle[0], r.muzzle[1], r.muzzle[2]) },
      { name: "goo", motion: [slot16(8), 0.5, 0, 0.8], rest: v(0, 0.2, 0.56) },
      { name: "rim drip", motion: [slot16(9), 0.8, 0, 0.8], rest: v(1.4, 0.1, 0.3) },
      { name: "tentacle drip", motion: [slot16(10), 0.7, 0.6, 0.8], rest: v(0.6, 0.4, 0.2) },
      { name: "body drip", motion: [slot16(11), 0.7, 0.5, 0.8], rest: v(0.3, 0.6, 0.4) },
    ];
  };
  /** One rest vertex per tardigrade part kind (a = _MOTION.y along the axis). */
  const tardigradeSamples = (r: TardigradeRig) => {
    const T = v(...(r.axis.tail as [number, number, number])), M = v(...(r.axis.mouth as [number, number, number]));
    const on = (a: number, up: number) => T.clone().lerp(M, a).add(v(0, up, 0));
    const hip = v(...(r.hips[0] as [number, number, number]));
    return [
      { name: "body back", motion: [slot16(0), 0.2, 0, 0.1], rest: on(0.2, 1.0) },
      { name: "leg claw", motion: [slot16(1), 0.66, 1, 0.3], rest: hip.clone().add(v(0.1, -0.5, 0.05)) },
      { name: "mouth tube", motion: [slot16(9), 0.97, 0, 0.5], rest: on(0.97, 0.4) },
      { name: "crystal", motion: [slot16(10), 0.5, 0, 0], rest: on(0.5, 1.6) },
      { name: "drool tip", motion: [slot16(12), 1, 0, 0.9], rest: on(1, -0.6) },
      { name: "drip", motion: [slot16(13), 0.8, 0.4, 0.9], rest: on(0.4, -0.9) },
    ];
  };
  const restSaucer = () => saucerPose({ phase: 0.37 });
  const richSaucer = () => saucerPose({
    phase: 0.37, look: v(1, 0.3, 1), aim: v(0.5, -0.6, 1), chase: 0.4, fire: 1, hit: 0.5, defeat: 1, blink: 0.3,
  });

  it("the saucer's rest pose holds its authored shape at any time; with motion on, the decorative terms move it", () => {
    const r = saucerRig();
    for (const s of saucerSamples(r)) {
      for (const t of TIMES) {
        saucerDeformPoint(r, s.motion, s.rest, restSaucer(), t, 0, out);
        expect(out.distanceTo(s.rest), `${s.name} t=${t}`).toBeLessThan(1e-9);
      }
    }
    for (const name of ["body crown", "tentacle", "rim drip", "tentacle drip", "body drip", "goo", "jaw"]) {
      const s = saucerSamples(r).find((x) => x.name === name)!;
      saucerDeformPoint(r, s.motion, s.rest, restSaucer(), 3.7, 1, out);
      expect(out.distanceTo(s.rest), `${name} moves with motion on`).toBeGreaterThan(1e-4);
    }
  });

  it("the saucer's state poses don't oscillate under reduced motion (the defeat swirl is held still)", () => {
    const r = saucerRig();
    const a = new THREE.Vector3();
    for (const s of saucerSamples(r)) {
      saucerDeformPoint(r, s.motion, s.rest, richSaucer(), TIMES[0], 0, a);
      for (const t of TIMES.slice(1)) {
        saucerDeformPoint(r, s.motion, s.rest, richSaucer(), t, 0, out);
        expect(out.distanceTo(a), `${s.name} t=${t}`).toBeLessThan(1e-9);
      }
    }
  });

  it("the saucer's state poses still apply under reduced motion: aim, look, fire lean and grin, hit, blink, defeat", () => {
    const r = saucerRig();
    const S = saucerSamples(r);
    const at = (name: string, pose: SaucerPose, t = 2.3) => {
      const s = S.find((x) => x.name === name)!;
      return saucerDeformPoint(r, s.motion, s.rest, pose, t, 0, new THREE.Vector3());
    };
    // the barrel turns to the aim: its tip is saucerMuzzle's shot origin
    const aim = v(0.5, -0.6, 1);
    expect(at("cannon barrel", saucerPose({ aim })).distanceTo(saucerMuzzle(aim, r, new THREE.Vector3()))).toBeLessThan(1e-9);
    // the eye turns to the look: its pupil sits eyeRadius out along the clamped gaze
    const L = r.pivots.eyeL;
    const pupil = at("eye L", saucerPose({ look: v(1, 0, 0) }));
    expect(pupil.distanceTo(v(L[0] + r.eyeRadius * Math.sin(EYE_YAW_MAX), L[1], L[2] + r.eyeRadius * Math.cos(EYE_YAW_MAX)))).toBeLessThan(1e-9);
    // fire leans the body forward about its pivot by SAUCER_FIRE_LEAN × the body weight
    const crown = S.find((x) => x.name === "body crown")!;
    const B = v(...(r.pivots.body as [number, number, number]));
    const bw = saucerBodyWeight(crown.rest.y, r);
    const lean = crown.rest.clone().sub(B).applyAxisAngle(v(1, 0, 0), SAUCER_FIRE_LEAN * bw).add(B);
    expect(at("body crown", saucerPose({ fire: 1 })).distanceTo(lean)).toBeLessThan(1e-9);
    expect(lean.z).toBeGreaterThan(crown.rest.z);
    // and opens the grin: the jaw swings down about its pivot
    const jawRest = S.find((x) => x.name === "jaw")!.rest;
    const J = v(...(r.pivots.jaw as [number, number, number]));
    const grin = jawRest.clone().sub(J).applyAxisAngle(v(1, 0, 0), SAUCER_FIRE_JAW).add(J);
    const leanJaw = grin.clone().sub(B).applyAxisAngle(v(1, 0, 0), SAUCER_FIRE_LEAN * saucerBodyWeight(jawRest.y, r)).add(B);
    expect(at("jaw", saucerPose({ fire: 1 })).distanceTo(leanJaw)).toBeLessThan(1e-9);
    expect(grin.y).toBeLessThan(jawRest.y);
    // a hit squashes the body (top down, sides out) by the body weight
    const q = crown.rest.clone().sub(B);
    const squash = v(q.x * (1 + SAUCER_HIT_SQUASH / 2 * bw), q.y * (1 - SAUCER_HIT_SQUASH * bw), q.z * (1 + SAUCER_HIT_SQUASH / 2 * bw)).add(B);
    expect(at("body crown", saucerPose({ hit: 1 })).distanceTo(squash)).toBeLessThan(1e-9);
    // a blink flattens the eye about its pivot
    const top = new THREE.Vector3();
    saucerDeformPoint(r, [slot16(3), 0, 0, 0], v(L[0], L[1] + r.eyeRadius, L[2]), saucerPose({ blink: 1 }), 2.3, 0, top);
    expect(top.y - L[1]).toBeLessThan(0.1 * r.eyeRadius);
    // defeated, the eyes still look crossed (each its own way), held still
    const dl = at("eye L", saucerPose({ defeat: 1 })).sub(S.find((x) => x.name === "eye L")!.rest);
    const dr = at("eye R", saucerPose({ defeat: 1 })).sub(S.find((x) => x.name === "eye R")!.rest);
    expect(dl.length()).toBeGreaterThan(0.02);
    expect(dr.length()).toBeGreaterThan(0.02);
    expect(dl.normalize().dot(dr.normalize())).toBeLessThan(0.9);
  });

  it("the tardigrade's rest pose holds still at any time; with motion on, the idle breath and paddle move it", () => {
    const r = tardigradeRig();
    const rest = tardigradePose({ phase: 0.37 });
    for (const s of tardigradeSamples(r)) {
      for (const t of TIMES) {
        tardigradeDeformPoint(r, s.motion, s.rest, rest, t, 0, out);
        expect(out.distanceTo(s.rest), `${s.name} t=${t}`).toBeLessThan(1e-9);
      }
      tardigradeDeformPoint(r, s.motion, s.rest, tardigradePose({ phase: 0.37, swim: 1 }), 3.7, 1, out);
      expect(out.distanceTo(s.rest), `${s.name} swims with motion on`).toBeGreaterThan(1e-4);
      // ... but not under reduced motion: swimming is decorative
      tardigradeDeformPoint(r, s.motion, s.rest, tardigradePose({ phase: 0.37, swim: 1 }), 3.7, 0, out);
      expect(out.distanceTo(s.rest), `${s.name} swim under reduced motion`).toBeLessThan(1e-9);
    }
  });

  it("a defeated tardigrade still ends curled under reduced motion, legs drawn in, with no oscillation", () => {
    const r = tardigradeRig();
    const T = v(...(r.axis.tail as [number, number, number])), M = v(...(r.axis.mouth as [number, number, number]));
    const curled = tardigradePose({ phase: 0.37, curl: 1 });
    const tail = tardigradeDeformPoint(r, [slot16(0), 0, 0, 0], T, curled, 5, 0, new THREE.Vector3());
    const mouth = tardigradeDeformPoint(r, [slot16(0), 1, 0, 0], M, curled, 5, 0, new THREE.Vector3());
    expect(tail.distanceTo(mouth)).toBeLessThan(1e-6); // the ball closes
    expect(tail.distanceTo(tardigradeCurlPoint(0, 1, r, new THREE.Vector3()))).toBeLessThan(1e-6);
    // the legs: a claw's reach from its hip shrinks by LEG_RETRACT (hip and claw share the axial position, so the bend is rigid)
    const claw = tardigradeSamples(r).find((x) => x.name === "leg claw")!;
    const hipRest = v(...(r.hips[0] as [number, number, number]));
    const c = tardigradeDeformPoint(r, claw.motion, claw.rest, curled, 5, 0, new THREE.Vector3());
    const h = tardigradeDeformPoint(r, [slot16(1), 0.66, 0, 0.3], hipRest, curled, 5, 0, new THREE.Vector3());
    expect(c.distanceTo(h) / claw.rest.distanceTo(hipRest)).toBeCloseTo(1 - LEG_RETRACT, 9);
    // every state pose at once is still under reduced motion
    const rich = tardigradePose({ phase: 0.37, swim: 1, charge: 0.8, recoil: 0.4, hit: 0.3, curl: 0.6 });
    for (const s of tardigradeSamples(r)) {
      const a = tardigradeDeformPoint(r, s.motion, s.rest, rich, TIMES[0], 0, new THREE.Vector3());
      for (const t of TIMES.slice(1)) {
        tardigradeDeformPoint(r, s.motion, s.rest, rich, t, 0, out);
        expect(out.distanceTo(a), `${s.name} t=${t}`).toBeLessThan(1e-9);
      }
    }
  });

  it("the tardigrade's charge still shows under reduced motion: the throat glows, the drool hangs longer; the crystals stop pulsing", () => {
    const r = tardigradeRig();
    const drool = tardigradeSamples(r).find((x) => x.name === "drool tip")!;
    const idle = tardigradeDeformPoint(r, drool.motion, drool.rest, tardigradePose(), 2, 0, new THREE.Vector3());
    const charged = tardigradeDeformPoint(r, drool.motion, drool.rest, tardigradePose({ charge: 1 }), 2, 0, new THREE.Vector3());
    expect(idle.y - charged.y).toBeGreaterThan(0.25);
    expect(throatEmissiveScale(1)).toBe(THROAT_GAIN); // the glow has no motion term at all
    for (const t of TIMES) expect(crystalGlow(t, 0.37, 0)).toBe(CRYSTAL_GLOW);
    expect(new Set(TIMES.map((t) => crystalGlow(t, 0.37, 1).toFixed(6))).size).toBeGreaterThan(1);
  });
});

// ------------------------------------------- Gate B fix A2: LOD and shell pops ---

describe("chooseLod: hysteresis on the LOD switch", () => {
  const D = 12.1;
  it("leaves LOD0 above D × 1.08 and returns below D × 0.92, and holds inside the band", () => {
    expect(LOD_HYSTERESIS).toBe(0.08);
    expect(chooseLod(D * 1.08 - 1e-6, 0, D)).toBe(0);
    expect(chooseLod(D * 1.08 + 1e-6, 0, D)).toBe(1);
    expect(chooseLod(D * 0.92 + 1e-6, 1, D)).toBe(1);
    expect(chooseLod(D * 0.92 - 1e-6, 1, D)).toBe(0);
    expect(chooseLod(D, 0, D)).toBe(0);
    expect(chooseLod(D, 1, D)).toBe(1);
  });

  it("never flip-flops: jitter anywhere inside the band switches nothing, and each full swing switches exactly twice", () => {
    for (const start of [0, 1] as const) {
      const state = createLodState(start);
      let flips = 0;
      for (let k = 0; k < 400; k++) {
        const d = D * (1 + 0.079 * Math.sin(k * 0.7)); // inside (0.92, 1.08) throughout
        const next = chooseLod(d, state.lod, D);
        if (next !== state.lod) flips++;
        state.lod = next;
      }
      expect(flips, `started on LOD${start}`).toBe(0);
    }
    const state = createLodState(0);
    let flips = 0;
    for (let k = 0; k < 2000; k++) {
      const d = D * (1 + 0.4 * Math.sin((2 * Math.PI * 6 * k) / 2000)); // six wide swings through D and back
      const next = chooseLod(d, state.lod, D);
      if (next !== state.lod) flips++;
      state.lod = next;
    }
    expect(flips).toBe(12); // two per swing
  });

  it("without a previous level it is the plain threshold at D", () => {
    expect(chooseLod(D - 0.01, undefined, D)).toBe(0);
    expect(chooseLod(D, undefined, D)).toBe(1);
  });

  it("addSaucer / addTardigrade with a state keep their level inside the band, and write it back", () => {
    const at = new THREE.Matrix4();
    const sr = saucerRig(), tr = tardigradeRig();
    for (const [name, D2, run] of [
      ["saucer", sr.lod1Distance, (d: number, st: ReturnType<typeof createLodState>) => {
        const lods = saucerLods(2, sr.furShells);
        beginMonsterFrame(saucerMeshes(lods));
        addSaucer(lods, sr, at, d, saucerPose(), saucerTint(1), st);
        return lods[1].body.count;
      }],
      ["tardigrade", tr.lod1Distance, (d: number, st: ReturnType<typeof createLodState>) => {
        const lods = tardigradeLods(2, tr.furShells);
        beginMonsterFrame(lods.flatMap((l) => [l.body, l.fur, l.cards!]));
        addTardigrade(lods, tr, at, d, tardigradePose(), st);
        return lods[1].body.count;
      }],
    ] as const) {
      const st = createLodState();
      expect(run(D2 * 1.05, st), `${name}: inside the band from near`).toBe(0);
      expect(run(D2 * 1.1, st), `${name}: past the band`).toBe(1);
      expect(st.lod).toBe(1);
      expect(run(D2 * 0.95, st), `${name}: inside the band from far`).toBe(1);
      expect(run(D2 * 0.9, st), `${name}: back under the band`).toBe(0);
      expect(st.lod).toBe(0);
    }
  });
});

describe("furShellCountSmooth / shellFade: the shell count is continuous", () => {
  it("is monotone non-increasing in distance, in [1, max], and continuous (a small step in distance never jumps)", () => {
    for (const rig of [saucerRig(), tardigradeRig()]) {
      const { furMaxLength: len, furShells: max } = rig;
      expect(furShellCountSmooth(1, len, max)).toBe(max);
      expect(furShellCountSmooth(1000, len, max)).toBe(1);
      let last = max, biggest = 0;
      for (let d = 1; d < 600; d += 0.01) {
        const c = furShellCountSmooth(d, len, max);
        expect(c).toBeLessThanOrEqual(last + 1e-12);
        expect(c).toBeGreaterThanOrEqual(1);
        biggest = Math.max(biggest, last - c);
        last = c;
      }
      expect(biggest, "largest drop in the count over a 0.01 u step").toBeLessThan(0.05);
    }
  });

  it("keeps the gap between shells at the gap budget once the fur thins", () => {
    for (const rig of [saucerRig(), tardigradeRig()]) {
      for (let d = 1; d < 400; d += 0.5) {
        const c = furShellCountSmooth(d, rig.furMaxLength, rig.furShells);
        if (c > 1 && c < rig.furShells) expect(furShellPx(d, rig.furMaxLength) / c).toBeLessThanOrEqual(FUR_SHELL_GAP_PX + 1e-9);
      }
    }
  });

  it("only the outermost drawn shell fades, by the fractional part of the count; shell 0 and cards never do", () => {
    expect(shellFade(0, 1)).toBe(1);
    expect(shellFade(0, 1.2)).toBe(1);
    expect(shellFade(1, 2.25)).toBe(1);
    expect(shellFade(2, 2.25)).toBeCloseTo(0.25, 12);
    expect(shellFade(3, 2.25)).toBe(0); // past the count: not drawn
    expect(shellFade(15, 16)).toBe(1);
  });

  it("the shell coverage (the sum of the fades) equals the count: no pop at any threshold, one-shell steps included", () => {
    const rig = saucerRig();
    const coverage = (c: number) => { let sum = 0; for (let s = 0; s < Math.ceil(c); s++) sum += shellFade(s, c); return sum; };
    let last = coverage(furShellCountSmooth(1, rig.furMaxLength, rig.furShells)), biggest = 0;
    for (let d = 1; d < 400; d += 0.01) {
      const c = furShellCountSmooth(d, rig.furMaxLength, rig.furShells);
      expect(coverage(c)).toBeCloseTo(c, 9);
      biggest = Math.max(biggest, last - coverage(c));
      last = coverage(c);
    }
    expect(biggest, "largest drop in coverage over a 0.01 u step (an old one-shell pop was 1)").toBeLessThan(0.05);
  });

  it("addSaucer draws ceil(count) shells and writes the continuous count into monsterShell.y (no new attribute slot)", () => {
    const r = saucerRig();
    const lods = saucerLods(2, r.furShells);
    const all = saucerMeshes(lods);
    const d = 14; // LOD1, a fractional count
    const c = furShellCountSmooth(d, r.furMaxLength, r.furShells);
    expect(c % 1).not.toBe(0);
    beginMonsterFrame(all);
    addSaucer(lods, r, new THREE.Matrix4(), d, saucerPose(), saucerTint(1), createLodState(1));
    expect(lods[1].fur.count).toBe(Math.ceil(c));
    const last = slot(lods[1].fur, "monsterShell", Math.ceil(c) - 1);
    expect(last[0]).toBe(Math.ceil(c) - 1);
    expect(last[1]).toBeCloseTo(c, 5);
    expect(shellFade(last[0], last[1])).toBeCloseTo(c % 1, 5);
    expect(Object.keys(SAUCER_INSTANCE_ATTRIBUTES.fur)).toEqual(["saucerPose", "monsterShell"]);
    expect(SAUCER_INSTANCE_ATTRIBUTES.fur.monsterShell).toBe(2);
  });
});
