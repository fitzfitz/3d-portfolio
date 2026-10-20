import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import Atmosphere, { LimbDarkening } from "./Atmosphere";
import CloudLayer from "./CloudLayer";
import { AU, PROGRADE } from "../../constants";
import type { BodyId } from "../../data/bodyIds";
import { SOLAR_BODIES, bodyById, type SolarBody } from "../../data/solarSystem";
import { bodies, useSpaceStore } from "../../store/spaceStore";
import { fitzDebug } from "../../debug/bridge";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { updateBodies } from "../../utils/bodyPositions";
import { displayAlbedoGain } from "../../utils/displayAlbedo";
import { orbitShape } from "../../utils/ephemeris";
import { hiResChoice } from "../../utils/hiResMaps";
import { orreryJd } from "../../utils/orreryClock";
import { ringRadii } from "../../utils/ringOptics";
import { makeSphereLOD } from "../../utils/sphereLod";
import { irradianceVsAU } from "../../utils/sunLight";
import { guideViewportHeight, makeGuideLineMaterial, makePlanetRingMaterial, RING_NIGHT_FLOOR } from "./guideLine";
import {
  apsides, ORBIT_MIN_HALF_PX, ORBIT_RIBBON_HALF_WIDTH, ORBIT_RIBBON_SAMPLES, ORBIT_TICK_MIN_HALF_PX,
  orbitFrameQuaternion, orbitRibbonGeometry, perifocalEllipse,
} from "./orbitRibbon";
import { bodySlot, OCCLUDER_COUNT, patchSunShadow, sunShadowDebug, sunShadowUniforms } from "./sunShadow";

/**
 * The nine real bodies (data/solarSystem.ts), one data-driven renderer
 * (real-solar-system spec §5): each body is one LOD sphere at its JPL position
 * for the orrery date (utils/bodyPositions.ts updateBodies, the one writer of
 * `bodies` and of the bodies' occluder slots), flattened, mapped or tinted,
 * lit, shadowed (sunShadow.ts "fragment" mode) and scanned. Earth adds its
 * clouds and night lights, Saturn its rings, and `look` adds the limb
 * darkening and the atmosphere rims. Every orbit is drawn as its true ellipse.
 */

const DEG = Math.PI / 180;

/**
 * Draw order of a body's transparent layers, explicit rather than left to
 * distance sorting (their shells share a centre): limb darkening, then the
 * atmosphere over it, then the rings over both.
 *
 * renderOrder is a global key three sorts by before depth, so the values stay
 * between the stars (STAR_RENDER_ORDER, −1) and everything else (0): the ring
 * at 0 still depth-sorts against the other order-0 transparents (the ship's
 * plume, the guide lines), so one in front of the rings draws over them
 * rather than under. The shells sit just below 0, so a plume in front of one
 * is drawn after it, as it should be.
 */
const BODY_RENDER_ORDER = { limb: -0.2, atmosphere: -0.1, ring: 0 } as const;

/**
 * Interim spin (Task 13 replaces it with the IAU poles on the close-up clock):
 * each body's axis leans its NASA obliquity from the orbit normal, about X,
 * and turns at the rate its fictional predecessor turned (rad/s): Earth the
 * Ocean World's, Jupiter the Banded Giant's, Mars the Rust World's, the rest
 * their -TYPE world's. Venus is new, compressed like the worlds' (Saturn's
 * 10.66 h to 0.3 rad/s). The obliquity already carries the sense: past 90°
 * the axis points below the orbit, so a prograde turn about it reads
 * backwards (Venus, Uranus). Its sign is not applied twice.
 */
const INTERIM_SPIN: Readonly<Record<BodyId, number>> = {
  mercury: 0.15, venus: (0.3 * 10.656) / 5832.5, earth: 0.1, mars: 0.13, ceres: 0.35,
  jupiter: 0.3, saturn: 0.3, uranus: 0.19, neptune: 0.2,
};

/** Earth's clouds turn a little faster than its surface, as the Ocean World's did. */
const CLOUD_SPIN = 0.168;

/**
 * Maps with a 4096-wide variant (assets-src/4k/), drawn on desktops
 * (utils/hiResMaps.ts). Up close a body fills the screen and the hard-edged
 * 2048 texels show as blocks; the soft-banded giants don't need it.
 */
const HI_RES_MAPS: ReadonlySet<string> = new Set(["ruangrapi"]);
/** Earth's night lights (Black Marble arrives in Task 12; the Ocean World's lights until then). */
const NIGHT_LIGHTS_MAP = "ruangrapi_glow";
/** The maps with a surface normal map: the cratered rock and the dwarf. */
const NORMAL_MAPPED: ReadonlySet<string> = new Set(["w-rock", "w-dwarf"]);
/** Saturn's ring strip (ringOptics.ts profile). */
const SATURN = bodyById("saturn");
const RING_MAP = `${SATURN.map}_ring`;
const [RING_INNER, RING_OUTER] = ringRadii(SATURN.size);
const RING_SEGMENTS = 256;

/** The distinct maps the bodies draw, in a fixed order; Venus has none (tint only). */
const MAPS: readonly string[] = [...new Set(SOLAR_BODIES.map((b) => b.map).filter((m) => m !== ""))];
const NORMALS: readonly string[] = MAPS.filter((m) => NORMAL_MAPPED.has(m));
/** One texture list: maps, then normal maps, then the night lights and the ring strip. */
const TEX_NORMAL0 = MAPS.length;
const TEX_NIGHT = TEX_NORMAL0 + NORMALS.length;
const TEX_RING = TEX_NIGHT + 1;
const mapUrl = (file: string, hiRes: boolean) => {
  const variant = hiRes && HI_RES_MAPS.has(file) ? `${file}_4k` : file;
  return assetUrl(`/models/${variant}.webp`);
};

/**
 * A body's material colour: the dark-surface display curve (displayAlbedo.ts,
 * P3) times its tint. A tint over a map keeps the map's luminance (it changes
 * the hue only: the interim maps are borrowed, Task 12 replaces them); a
 * body with no map (Venus) is its tint at the scene-scale albedo of its map
 * statistic (0.177 × geometric).
 */
function bodyColor(b: SolarBody): THREE.Color {
  const c = new THREE.Color(1, 1, 1);
  if (b.tint) {
    c.set(b.tint);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    c.multiplyScalar((b.map ? 1 : b.texelMedianLinear) / lum);
  }
  return c.multiplyScalar(displayAlbedoGain(b.texelMedianLinear));
}

/**
 * City lights only on the night side. three.js adds an emissive map on the
 * lit hemisphere too, which would put Earth's lights in broad daylight. This
 * injects a mask after the emissive map is applied: the sun is a point light
 * at the world origin, so its view-space position is re-uploaded each frame
 * and compared with the surface normal.
 */
const sunView = new THREE.Vector3();
function useNightSideEmissive() {
  const uniform = useMemo(() => ({ value: new THREE.Vector3() }), []);
  useFrame(({ camera }) => {
    sunView.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
    uniform.value.copy(sunView);
  });
  return useMemo(() => (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSunView = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSunView;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        vec3 toSun = normalize(uSunView + vViewPosition);
        totalEmissiveRadiance *= smoothstep(0.12, -0.2, dot(normal, toSun));`);
  }, [uniform]);
}

/**
 * Orbit lines: one ribbon per body, its true ellipse for the orrery date
 * (orbitRibbon.ts), in the body's HUD colour with the guide-line program,
 * never under 2 px wide from anywhere, with a solid tick across it at
 * perihelion and at aphelion (§6.2).
 * All nine are always visible: they are known orbits (charting keeps the
 * radar arrow and the chart as its reward). Steady, fainter than the old
 * planets' breathing rings at their peak.
 */
const ORBIT_LINE_OPACITY = 0.22;

export default function SolarBodies() {
  // Desktop only, decided once per page and shared with the asset pack loader
  // (utils/hiResMaps.ts): swapping URLs mid-flight would re-suspend the scene,
  // and the other tier is not in this page's packs.
  const [hiRes] = useState(hiResChoice);
  // Resolved at render, not at import: in a build, assetUrl answers from the
  // asset pack, which can still be downloading while this module loads.
  const textures = useTexture([
    ...MAPS.map((m) => mapUrl(m, hiRes)),
    ...NORMALS.map((m) => mapUrl(`${m}_normal`, false)),
    mapUrl(NIGHT_LIGHTS_MAP, false),
    mapUrl(RING_MAP, false),
  ]);
  const gl = useThree((s) => s.gl);
  const cityLights = useNightSideEmissive();

  // The ring strip: colour in RGB (sRGB, decoded on sampling; alpha stays
  // linear), τ in A. Set before its first upload. No mipmaps: the strip runs
  // only along u, so near edge-on the radial derivative is huge and a mip
  // level would average τ across the Cassini division (and averaging τ before
  // the exp of the opacity is wrong anyway). Plain linear filtering keeps the
  // division sharp at any tilt; the cost is shimmer in the fine ringlets from
  // far away. Clamped, so u outside [0, 1] reads the end texels' τ = 0.
  const ringMap = useMemo(() => {
    const tex = textures[TEX_RING];
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }, [textures]);

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    textures.forEach((tex, i) => {
      if (i === TEX_RING) return; // set up with ringMap
      tex.anisotropy = maxAniso;
      // Normal maps are data, not colour: they stay linear.
      tex.colorSpace = i >= TEX_NORMAL0 && i < TEX_NIGHT ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    });
  }, [textures, gl]);

  /**
   * The ring plane's normal in world space: Saturn's tilted axis. The ring
   * shader takes its own from its model matrix; Saturn's ring-shadow patch
   * reads this. Fixed while the interim tilt is (Task 13 makes it the pole).
   */
  const ringNormal = useMemo(() => ({
    value: new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), SATURN.obliquityDeg * DEG),
  }), []);

  // Built here, not as JSX, so no re-render can re-apply an onBeforeCompile
  // over the shadow patch. Fragment mode skips each body's own sphere by
  // distance, so all share the same programs.
  const materials = useMemo(() => SOLAR_BODIES.map((b) => {
    const mi = MAPS.indexOf(b.map);
    const ni = NORMALS.indexOf(b.map);
    const m = new THREE.MeshStandardMaterial({
      map: mi >= 0 ? textures[mi] : null,
      normalMap: ni >= 0 ? textures[TEX_NORMAL0 + ni] : null,
      // Earth's oceans take a sheen (the Ocean World's 0.5); every other surface is matte.
      roughness: b.id === "earth" ? 0.5 : 0.95, metalness: 0,
    });
    m.color.copy(bodyColor(b));
    if (b.look.nightLights) {
      m.emissiveMap = textures[TEX_NIGHT];
      m.emissive.set("#ffd9a0");
      m.emissiveIntensity = 1.4;
      m.onBeforeCompile = cityLights;
    }
    // Saturn also takes its rings' shadow: one more program, its own.
    patchSunShadow(m, "fragment", b.look.rings === "saturn"
      ? { ringShadow: { normal: ringNormal, inner: RING_INNER, outer: RING_OUTER, map: ringMap } }
      : undefined);
    return m;
  }), [textures, ringMap, ringNormal, cityLights]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  // Detail by distance (sphereLod.ts), flattened along the spin axis. The
  // eclipse occluders and collisions use the equatorial size, never this scale.
  const lods = useMemo(() => SOLAR_BODIES.map((b, i) => {
    const lod = makeSphereLOD(materials[i], b.size, { name: `Body_${b.id}` });
    lod.scale.y *= 1 - b.flattening;
    return lod;
  }), [materials]);

  // Lit by the sunlight at Saturn's live distance (L19, §4.8: written each
  // frame); in Saturn's umbra through its occluder slot (L20).
  const ringMat = useMemo(() => makePlanetRingMaterial("#ffffff", RING_INNER, RING_OUTER, bodySlot("saturn"), { ringMap }), [ringMap]);
  useEffect(() => () => ringMat.dispose(), [ringMat]);
  // The umbra floor is measured per tier (guideLine.ts): the PostFX buffer is
  // linear, the low-perf tier draws display-encoded colour.
  useEffect(() => {
    const apply = (lowPerf: boolean) => {
      ringMat.uniforms.uNightFloor.value = lowPerf ? RING_NIGHT_FLOOR.display : RING_NIGHT_FLOOR.linear;
    };
    apply(useSpaceStore.getState().isLowPerf);
    return useSpaceStore.subscribe((st) => st.isLowPerf, apply);
  }, [ringMat]);

  // One ellipse per body for the orrery date at mount: JPL's element rates
  // move an orbit by well under a degree in a long session's millennia.
  const orbits = useMemo(() => SOLAR_BODIES.map((b) => {
    const shape = orbitShape(b.orbit.el, orreryJd(0));
    const a = shape.a * AU;
    const geometry = orbitRibbonGeometry(perifocalEllipse(a, shape.e, ORBIT_RIBBON_SAMPLES), ORBIT_RIBBON_HALF_WIDTH, apsides(a, shape.e));
    const material = makeGuideLineMaterial({
      color: b.color, opacity: ORBIT_LINE_OPACITY, dashes: 220, fadeIn: [10, 55],
      minHalfPx: ORBIT_MIN_HALF_PX, tickHalfPx: ORBIT_TICK_MIN_HALF_PX,
    });
    return { geometry, material, quaternion: orbitFrameQuaternion(shape, new THREE.Quaternion()) };
  }), []);
  useEffect(() => () => orbits.forEach((o) => { o.geometry.dispose(); o.material.dispose(); }), [orbits]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.sunShadow = sunShadowUniforms;
    fitzDebug.sunShadowDebug = sunShadowDebug;
    return () => { fitzDebug.sunShadow = null; fitzDebug.sunShadowDebug = null; };
  }, []);

  const posGroups = useRef<(THREE.Group | null)[]>(SOLAR_BODIES.map(() => null));

  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());
    updateBodies(time, bodies);
    // The orbit lines' screen-constant width is measured in CSS px of this view.
    guideViewportHeight.value = state.size.height;
    sunShadowUniforms.uOccluderCount.value = sunShadowDebug.countOverride >= 0 ? sunShadowDebug.countOverride : OCCLUDER_COUNT;
    for (let i = 0; i < SOLAR_BODIES.length; i++) {
      const b = SOLAR_BODIES[i];
      const p = bodies[b.id];
      posGroups.current[i]?.position.set(p.x, p.y, p.z);
      lods[i].rotation.y = PROGRADE * INTERIM_SPIN[b.id] * time;
    }
    const s = bodies.saturn;
    ringMat.uniforms.uIrradiance.value = irradianceVsAU(Math.hypot(s.x, s.y, s.z));
  });

  return (
    <group>
      {SOLAR_BODIES.map((b, i) => {
        const atm = b.look.atmosphere;
        return (
          <group key={b.id} ref={(g) => { posGroups.current[i] = g; }}>
            {/* The spin frame: +Y is the axis, leaning its obliquity. */}
            <group rotation={[b.obliquityDeg * DEG, 0, 0]}>
              <primitive object={lods[i]} dispose={null} />
              {b.look.clouds && <CloudLayer radius={b.size} tint="#ffffff" speed={PROGRADE * CLOUD_SPIN} sunShadow />}
              {/* In the equatorial plane: the spin frame's XZ (RingGeometry's
                  XY turned down), so the ring and the shadow's normal share
                  the one tilt and cannot disagree. */}
              {b.look.rings === "saturn" && (
                <mesh name={`BodyRing_${b.id}`} rotation={[-Math.PI / 2, 0, 0]} material={ringMat}
                  renderOrder={BODY_RENDER_ORDER.ring}>
                  <ringGeometry args={[RING_INNER, RING_OUTER, RING_SEGMENTS, 1]} />
                </mesh>
              )}
            </group>
            {b.look.limb !== undefined && (
              <LimbDarkening radius={b.size} strength={b.look.limb} renderOrder={BODY_RENDER_ORDER.limb} />
            )}
            {atm && (
              <Atmosphere radius={b.size} color={atm.color} planetPos={bodies[b.id]} liveSunlight
                intensity={atm.intensity} thickness={atm.thickness} dusk={atm.dusk}
                renderOrder={BODY_RENDER_ORDER.atmosphere} />
            )}
          </group>
        );
      })}
      {/* Orbit lines: each in its own perifocal frame, the Sun at the origin. */}
      {SOLAR_BODIES.map((b, i) => (
        <mesh key={`orbit-${b.id}`} name={`BodyOrbit_${b.id}`} quaternion={orbits[i].quaternion}
          geometry={orbits[i].geometry} material={orbits[i].material} />
      ))}
    </group>
  );
}
