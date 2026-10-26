import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { BOTTLES_SHOWN_MAX, bottleRegistry, bottleScanId, bottleVisible, type Bottle } from "../../utils/beacons";
import { activeBottle, bottleCardState } from "../../utils/bottleCard";
import { setScannable, removeScannable } from "../../utils/scannables";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { exposureCompensation } from "../../utils/sunLight";
import { useModel } from "../../utils/sceneAssets";
import { assetUrl } from "../../utils/assetUrl";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";

/** Every bottle that can show at once: the newest 30 plus the visitor's own. */
const N = BOTTLES_SHOWN_MAX;
/** The model is 0.70 u long (gen_bottle.py); drawn a little larger so it reads beside the 2.4 u ship. */
const BOTTLE_SCALE = 1.5;
/** Camera distance (u) where a bottle starts to shrink away, and where it is gone. */
export const FADE_NEAR = 120;
export const FADE_FAR = 180;
/** Bob: amplitude (u) and rate (rad/s); turn: rate about the vertical (rad/s). Slow, like flotsam. */
const BOB = 0.12;
const BOB_RATE = 0.7;
const SPIN = 0.22;
/** The bottle lies tilted this far off upright (rad), rocking a little, so its length shows. */
const TILT = 1.15;
/** Glint (the COLOR_0 R zone: the lip and the shoulder ring) at the top of its shimmer, and the rim. */
const GLINT_GAIN = 1.6;
const RIM_GAIN = 0.55;
/**
 * Range boost: up close the glint is faint, but a bottle a few pixels long
 * shows only as a highlight, so glint and rim brighten (to 1 + RANGE_BOOST
 * times) from BOOST_NEAR to BOOST_FAR camera distance (u), before the fade.
 */
const RANGE_BOOST = 3;
const BOOST_NEAR = 15;
const BOOST_FAR = 60;

const dummy = new THREE.Object3D();
/** The glass shader's clock (ambient seconds): one shared uniform object, written once a frame. */
const bottleTime = { value: 0 };

/** A stable per-bottle phase in [0, 2π) from its id, so a bottle keeps its motion when the list reorders. */
function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

const smooth01 = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/**
 * The glass (gen_bottle.py contract). Its COLOR_0 is a glint mask, not a
 * colour: GLTFLoader would switch `vertexColors` on and multiply the green by
 * it (the glass went near-black), so the attribute is renamed `bottleMask`
 * and read here. Per instance, `bottleLook`: x = shimmer phase, y = distance
 * fade, z = 1 for the visitor's own bottle (a pink glint, as beacons had),
 * w = the range boost.
 *  - Glint: a faint, slow shimmer on the R zone, so a bottle can be spotted
 *    as a tiny highlight.
 *  - Rim: a Fresnel term, emissive and a little more opaque at grazing
 *    angles, so the glass outline reads against black space even backlit.
 * Both are emissive, so they multiply by the shared exposureCompensation
 * (sunLight.ts), as the monsters' glows do: the same glint at 1 AU and at
 * 30 AU. A uniform object, so no recompile and no new cache key.
 */
function patchGlassMaterial(m: THREE.MeshStandardMaterial): void {
  m.vertexColors = false;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBottleTime = bottleTime;
    shader.uniforms.uExposureComp = exposureCompensation;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec4 bottleMask;
attribute vec4 bottleLook;
varying float vBottleMask;
varying vec4 vBottleLook;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vBottleMask = bottleMask.r;
vBottleLook = bottleLook;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uBottleTime;
uniform float uExposureComp;
varying float vBottleMask;
varying vec4 vBottleLook;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
float bShimmer = 0.55 + 0.45 * sin(uBottleTime * 1.3 + vBottleLook.x);
vec3 bGlint = mix(vec3(1.0, 0.94, 0.80), vec3(1.0, 0.42, 0.72), vBottleLook.z);
float bRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
totalEmissiveRadiance += (bGlint * (vBottleMask * bShimmer * ${GLINT_GAIN.toFixed(3)}) + vec3(0.55, 1.0, 0.82) * (bRim * ${RIM_GAIN.toFixed(3)})) * (vBottleLook.y * vBottleLook.w * uExposureComp);
diffuseColor.a = min(1.0, diffuseColor.a + bRim * 0.45);`);
  };
  m.customProgramCacheKey = () => "messageBottleGlass:v2";
}

/**
 * Visitors' messages in bottles (spec "Seeing and reading bottles"): small
 * glass bottles with a rolled note, bobbing and turning slowly where they
 * were left. Two instanced draws, sharing one matrix buffer: the opaque note
 * and cork, then the blended glass. They shrink away with distance.
 *
 * Fly within BOTTLE_CARD_R and the HUD's BottleCard unrolls the nearest one's
 * note (bottleCardState, written here each frame; no React state). Each is
 * also a scannable, read by Scanner through bottleRegistry.
 *
 * Never part of flight: no collision, no tractor-beam target, no waypoint,
 * badge, logbook goal or jump. Mounted only while Show bottles is on
 * (GlobalCanvas's BottlesGate); unmounting removes the scannables and the card.
 * Allocates nothing per frame.
 */
export default function Bottles() {
  const beacons = useSpaceStore((s) => s.beacons);
  const own = useSpaceStore((s) => s.ownBeacons);
  const listRef = useRef<Bottle[]>([]);
  const ownSet = useRef<Set<string>>(new Set());
  const { scene } = useModel(assetUrl("/models/bottle.glb"));

  const { contents, glass, look } = useMemo(() => {
    const find = (name: string) => {
      const o = scene.getObjectByName(name);
      if (!(o instanceof THREE.Mesh)) throw new Error(`bottle.glb has no mesh ${name}`);
      return o;
    };
    const srcContents = find("Bottle_Contents"), srcGlass = find("Bottle_Glass");
    const gContents = bakeNodeTransform(srcContents);
    const gGlass = bakeNodeTransform(srcGlass);
    const mask = gGlass.getAttribute("color");
    if (!mask) throw new Error("bottle.glb glass has no COLOR_0 glint mask");
    gGlass.deleteAttribute("color");
    gGlass.setAttribute("bottleMask", mask);
    const lookAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    lookAttr.setUsage(THREE.DynamicDrawUsage);
    gGlass.setAttribute("bottleLook", lookAttr);
    const mContents = (srcContents.material as THREE.MeshStandardMaterial).clone();
    const mGlass = (srcGlass.material as THREE.MeshStandardMaterial).clone();
    patchGlassMaterial(mGlass);

    const c = new THREE.InstancedMesh(gContents, mContents, N);
    const g = new THREE.InstancedMesh(gGlass, mGlass, N);
    c.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One matrix buffer for both draws: written once a frame, uploaded once.
    g.instanceMatrix = c.instanceMatrix;
    c.name = "Bottles"; g.name = "BottlesGlass";
    // Spread across the whole system and bobbing: one bound would cover everything anyway.
    c.frustumCulled = false; g.frustumCulled = false;
    c.count = 0; g.count = 0;
    return { contents: c, glass: g, look: lookAttr };
  }, [scene]);
  useEffect(() => () => {
    contents.geometry.dispose(); glass.geometry.dispose();
    (contents.material as THREE.Material).dispose(); (glass.material as THREE.Material).dispose();
    contents.dispose(); glass.dispose();
  }, [contents, glass]);

  useEffect(() => {
    // Past the system radius the return burn is already pushing pilots back: no bottles out there.
    const shown = beacons.filter(bottleVisible);
    listRef.current = shown;
    ownSet.current = new Set(own);
    const la = look.array as Float32Array;
    shown.forEach((b, i) => {
      const mine = own.includes(b.id);
      const id = bottleScanId(b.id);
      bottleRegistry.set(id, { bottle: b, own: mine });
      setScannable(id, b.x, b.y, b.z, mine ? "YOUR BOTTLE" : "MESSAGE BOTTLE");
      la[i * 4] = phaseOf(b.id);
      la[i * 4 + 1] = 0;
      la[i * 4 + 2] = mine ? 1 : 0;
      la[i * 4 + 3] = 1;
    });
    contents.count = shown.length;
    glass.count = shown.length;
    look.needsUpdate = true;
    return () => {
      for (const b of shown) {
        bottleRegistry.delete(bottleScanId(b.id));
        removeScannable(bottleScanId(b.id));
      }
    };
  }, [beacons, own, contents, glass, look]);

  // Unmounted (Show bottles off, the classic résumé): no card may hang on.
  useEffect(() => () => {
    bottleCardState.bottle = null;
    bottleCardState.own = false;
    bottleCardState.scan = null;
  }, []);

  useFrame((state) => {
    const list = listRef.current;
    const elapsed = state.clock.getElapsedTime();
    const next = activeBottle(flight, list, bottleCardState.bottle, bottleCardState.scan, gameTime(elapsed));
    bottleCardState.bottle = next;
    bottleCardState.own = next !== null && ownSet.current.has(next.id);
    if (!list.length) return;
    const t = ambientTime(elapsed);
    bottleTime.value = t;
    const cam = state.camera.position;
    const la = look.array as Float32Array;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const ph = la[i * 4];
      const d = Math.hypot(cam.x - b.x, cam.y - b.y, cam.z - b.z);
      const fade = 1 - smooth01((d - FADE_NEAR) / (FADE_FAR - FADE_NEAR));
      la[i * 4 + 1] = fade;
      la[i * 4 + 3] = 1 + RANGE_BOOST * smooth01((d - BOOST_NEAR) / (BOOST_FAR - BOOST_NEAR));
      dummy.position.set(b.x, b.y + Math.sin(t * BOB_RATE + ph) * BOB, b.z);
      // Euler XYZ applies Z first: lay it over, turn it about the vertical, rock it.
      dummy.rotation.set(0.18 * Math.sin(t * 0.31 + ph * 1.7), t * SPIN + ph, TILT + 0.1 * Math.sin(t * 0.43 + ph));
      dummy.scale.setScalar(BOTTLE_SCALE * fade);
      dummy.updateMatrix();
      contents.setMatrixAt(i, dummy.matrix);
    }
    contents.instanceMatrix.needsUpdate = true;
    look.needsUpdate = true;
  });

  return (
    <>
      <primitive object={contents} />
      <primitive object={glass} />
    </>
  );
}
