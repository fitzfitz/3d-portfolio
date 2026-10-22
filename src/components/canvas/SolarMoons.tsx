import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useModels, useCompressedMaps } from "../../utils/sceneAssets";
import * as THREE from "three";
import { SOLAR_MOONS, type SolarMoon } from "../../data/solarMoons";
import { moonPositions } from "../../store/moonState";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { displayAlbedoGain } from "../../utils/displayAlbedo";
import { moonQuaternion, updateMoons } from "../../utils/moonOrbits";
import { ioGlowMask, IO_GLOW_SIZE } from "../../utils/ioGlow";
import { makeSphereLOD } from "../../utils/sphereLod";
import { irradianceVsAU } from "../../utils/sunLight";
import Atmosphere from "./Atmosphere";
import { eclipseGlow, patchNightGlow } from "./nightGlow";
import { noIbl } from "./noIbl";
import { occluders, patchSunShadow, sunShadowCoverage } from "./sunShadow";

/**
 * The nine major moons (real-solar-system spec §5.3), each system one
 * uniform inset about its planet: real distance ratios (the Galileans keep
 * the 1 : 2 : 4 Laplace resonance), real planes, Triton backwards, all
 * tidally locked (L11, L12). Where they are is utils/moonOrbits.ts; this
 * draws them and drives the frame (updateMoons: `moonPositions`, the
 * collider's and cruise's centres, and the moons' occluder slots 6-14).
 *
 * - The seven round moons are LOD spheres wearing their NASA/USGS maps (Titan
 *   its seeded haze), lit and shadowed exactly like the planets (the
 *   "fragment" patch, so they share the planets' program): a planet's shadow
 *   crosses a moon's disc, and a moon's crosses its planet's.
 * - Phobos and Deimos are their shape-model GLBs (scripts/blender/
 *   gen_mars_moons.py), long axis on Mars. They are under a unit across, so
 *   one CPU-measured sun factor each is enough ("object" mode).
 *
 * Each colour is the white (or the GLB's calibrated factor) times the
 * dark-surface display curve (displayAlbedo.ts, P3), as for the bodies.
 *
 * Titan wears its haze rim (look.atmosphere, the bodies' Atmosphere). Io's
 * hot spots glow (L33): its emissive map is the catalogued hot spots
 * (utils/ioGlow.ts), shown on the night side and, through its eclipse
 * uniform, while Jupiter's shadow covers it (nightGlow.ts, Earth's lights'
 * program).
 */

const ROUND = SOLAR_MOONS.filter((m) => !m.shape);
const SHAPED = SOLAR_MOONS.filter((m) => m.shape);
/** Titan's rim draws in the bodies' atmosphere slot of the transparent order (SolarBodies' BODY_RENDER_ORDER). */
const MOON_ATMOSPHERE_ORDER = -0.1;

/**
 * Io's glow: lava at ~1,300-1,600 K glows orange (Galileo SSI saw the hot
 * spots red-orange in eclipse). Its peak is held at IO_GLOW_PEAK of linear
 * luminance at 1 AU-equivalent light, about two thirds of Io's sunlit
 * surface (0.11 × 2.1/π ≈ 0.074): the emissive intensity is scaled by the
 * sunlight at Io each frame, so under the camera's full exposure adaptation
 * (F3) the glow keeps the same ratio to Io's day side at any distance. A
 * look, not a measurement.
 */
const IO_GLOW_COLOR = new THREE.Color("#ff7a26");
const IO_GLOW_PEAK = 0.05;
const IO_GLOW_INTENSITY = IO_GLOW_PEAK / (0.2126 * IO_GLOW_COLOR.r + 0.7152 * IO_GLOW_COLOR.g + 0.0722 * IO_GLOW_COLOR.b);

function makeIoGlowMap(): THREE.DataTexture {
  const [w, h] = IO_GLOW_SIZE;
  const mask = ioGlowMask();
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < mask.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = mask[i];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Every moon map ships as KTX2 (hiResMaps.ts KTX2_VARIANTS; tests/bodyMaps.test.ts holds it). */
const mapUrl = (m: SolarMoon) => assetUrl(`/models/${m.map}.ktx2`);
const glbUrl = (m: SolarMoon) => assetUrl(`/models/${m.shape}.glb`);

export default function SolarMoons() {
  const gl = useThree((s) => s.gl);
  const textures = useCompressedMaps(ROUND.map(mapUrl));
  const glbs = useModels(SHAPED.map(glbUrl));

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const tex of textures) {
      tex.anisotropy = maxAniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }, [textures, gl]);

  const ioGlowMap = useMemo(() => makeIoGlowMap(), []);
  const ioEclipse = useMemo(() => ({ value: 0 }), []);
  useEffect(() => () => ioGlowMap.dispose(), [ioGlowMap]);

  // Built here, not as JSX, so no re-render can re-apply onBeforeCompile over the patch.
  const round = useMemo(() => ROUND.map((m, i) => {
    const mat = new THREE.MeshStandardMaterial({ map: textures[i], roughness: 0.95, metalness: 0 });
    mat.color.setScalar(displayAlbedoGain(m.texelMedianLinear));
    if (m.id === "io") {
      mat.emissiveMap = ioGlowMap;
      mat.emissive.copy(IO_GLOW_COLOR);
      patchNightGlow(mat, ioEclipse);
    }
    patchSunShadow(mat, "fragment");
    return { moon: m, material: mat, object: makeSphereLOD(mat, m.size, { name: `Moon_${m.id}` }) as THREE.Object3D };
  }), [textures, ioGlowMap, ioEclipse]);
  const ioMat = useMemo(() => round.find((r) => r.moon.id === "io")!.material, [round]);

  const shaped = useMemo(() => SHAPED.map((m, i) => {
    let src: THREE.Mesh | undefined;
    glbs[i].scene.traverse((o) => { if (!src && o instanceof THREE.Mesh) src = o; });
    if (!src) throw new Error(`${m.shape}.glb contains no mesh`);
    const geometry = bakeNodeTransform(src);
    // Clone, then patch the clone (the instance that renders): clone() drops a patch.
    const mat = (src.material as THREE.MeshStandardMaterial).clone();
    mat.color.multiplyScalar(displayAlbedoGain(m.texelMedianLinear));
    const { sunVis } = patchSunShadow(mat, "object");
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = `Moon_${m.id}`;
    mesh.scale.setScalar(m.size);
    return { moon: m, material: mat, geometry, object: mesh as THREE.Object3D, sunVis: sunVis! };
  }), [glbs]);

  useEffect(() => () => {
    round.forEach((r) => r.material.dispose());
    shaped.forEach((s) => { s.material.dispose(); s.geometry.dispose(); });
  }, [round, shaped]);

  const all = useMemo(() => [...round, ...shaped], [round, shaped]);
  const materials = useMemo(() => all.map((a) => a.material), [all]);
  const groups = useRef<(THREE.Group | null)[]>(all.map(() => null));

  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());
    updateMoons(time, moonPositions);
    // Sunlit and ambient only: no studio IBL on a moon (noIbl.ts, L29).
    noIbl(materials, state.scene.environment);
    for (let i = 0; i < all.length; i++) {
      const { moon, object } = all[i];
      const p = moonPositions[moon.id];
      groups.current[i]?.position.set(p.x, p.y, p.z);
      moonQuaternion(moon, time, object.quaternion);
    }
    // Phobos and Deimos: the sun they see past every GPU slot but their own
    // (the self-skip), after this frame's slots are written.
    for (let i = 0; i < shaped.length; i++) {
      shaped[i].sunVis.value = sunShadowCoverage(moonPositions[shaped[i].moon.id], occluders);
    }
    // Io's glow: held to its day side's light, and on all over while Jupiter's
    // shadow covers it (Io is small against the umbra: one factor will do).
    const io = moonPositions.io;
    ioMat.emissiveIntensity = IO_GLOW_INTENSITY * irradianceVsAU(Math.hypot(io.x, io.y, io.z));
    ioEclipse.value = eclipseGlow(sunShadowCoverage(io, occluders));
  });

  return (
    <group>
      {all.map((a, i) => {
        const atm = a.moon.look?.atmosphere;
        return (
          <group key={a.moon.id} ref={(g) => { groups.current[i] = g; }}>
            <primitive object={a.object} dispose={null} />
            {atm && (
              <Atmosphere radius={a.moon.size} color={atm.color} planetPos={moonPositions[a.moon.id]} liveSunlight
                intensity={atm.intensity} thickness={atm.thickness} dusk={atm.dusk} renderOrder={MOON_ATMOSPHERE_ORDER} />
            )}
          </group>
        );
      })}
    </group>
  );
}
