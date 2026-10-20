import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { SOLAR_MOONS, type SolarMoon } from "../../data/solarMoons";
import { moonPositions } from "../../store/moonState";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { displayAlbedoGain } from "../../utils/displayAlbedo";
import { moonQuaternion, updateMoons } from "../../utils/moonOrbits";
import { makeSphereLOD } from "../../utils/sphereLod";
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
 */

const ROUND = SOLAR_MOONS.filter((m) => !m.shape);
const SHAPED = SOLAR_MOONS.filter((m) => m.shape);
const mapUrl = (m: SolarMoon) => assetUrl(`/models/${m.map}.webp`);
const glbUrl = (m: SolarMoon) => assetUrl(`/models/${m.shape}.glb`);

export default function SolarMoons() {
  const gl = useThree((s) => s.gl);
  const textures = useTexture(ROUND.map(mapUrl));
  const glbs = useGLTF(SHAPED.map(glbUrl));

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const tex of textures) {
      tex.anisotropy = maxAniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }, [textures, gl]);

  // Built here, not as JSX, so no re-render can re-apply onBeforeCompile over the patch.
  const round = useMemo(() => ROUND.map((m, i) => {
    const mat = new THREE.MeshStandardMaterial({ map: textures[i], roughness: 0.95, metalness: 0 });
    mat.color.setScalar(displayAlbedoGain(m.texelMedianLinear));
    patchSunShadow(mat, "fragment");
    return { moon: m, material: mat, object: makeSphereLOD(mat, m.size, { name: `Moon_${m.id}` }) as THREE.Object3D };
  }), [textures]);

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
  const groups = useRef<(THREE.Group | null)[]>(all.map(() => null));

  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());
    updateMoons(time, moonPositions);
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
  });

  return (
    <group>
      {all.map((a, i) => (
        <group key={a.moon.id} ref={(g) => { groups.current[i] = g; }}>
          <primitive object={a.object} dispose={null} />
        </group>
      ))}
    </group>
  );
}
