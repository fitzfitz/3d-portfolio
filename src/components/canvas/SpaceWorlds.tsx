import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import Atmosphere, { LimbDarkening } from "./Atmosphere";
import { WORLDS } from "../../data/worlds";
import { bodies } from "../../store/spaceStore";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { worldMeshScale, worldSpinQuaternion } from "../../utils/worldSpin";
import { patchSunShadow } from "./sunShadow";
import { updateWorlds } from "./worldDrive";

/**
 * The five worlds (data/worlds.ts): they orbit, spin on their tilted axes and
 * are lit, shadowed and scanned like the planets, but they are not planets.
 * No orbit lock, zone, dossier, jump key or waypoint, and no guide ring or
 * gravity circle. Always mounted; charting (worldVisibility) never mounts.
 */

/** Same tessellation as the planets (SpacePlanets' PLANET_SEGMENTS). */
const WORLD_SEGMENTS = 64;

/** The worlds with a surface normal map: the cratered rock and the dwarf. */
const NORMAL_MAPPED: ReadonlySet<string> = new Set(["w-rock", "w-dwarf"]);

/**
 * The ice giants' thin scattering shells. Methane absorbs red, so their
 * terminator band does not redden the way a nitrogen sky's does: it stays a
 * cool, deeper cyan-blue (atmosphereMaterial.ts's uDusk).
 */
export const ICE_GIANT_DUSK = "#4a86b8";
const ICE_GIANT_RIM: Readonly<Record<string, string>> = { "w-tilted": "#a6e6ec", "w-blue": "#5f8ff0" };

const mapUrl = (file: string) => assetUrl(`/models/${file}.webp`);
const COLOR_URLS = WORLDS.map((w) => mapUrl(w.map));
const NORMAL_WORLDS = WORLDS.filter((w) => NORMAL_MAPPED.has(w.id));
const NORMAL_URLS = NORMAL_WORLDS.map((w) => mapUrl(`${w.map}_normal`));

export default function SpaceWorlds() {
  const textures = useTexture([...COLOR_URLS, ...NORMAL_URLS]);
  const gl = useThree((s) => s.gl);

  // Built here, not as JSX, so no re-render can re-apply an onBeforeCompile
  // over the shadow patch (as SpacePlanets does). Fragment mode skips the
  // world's own body by distance, so all share the planets' programs.
  const materials = useMemo(() => WORLDS.map((w, i) => {
    const n = NORMAL_WORLDS.indexOf(w);
    const m = new THREE.MeshStandardMaterial({
      map: textures[i], roughness: 0.95, metalness: 0,
      normalMap: n >= 0 ? textures[COLOR_URLS.length + n] : null,
    });
    patchSunShadow(m, "fragment");
    return m;
  }), [textures]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    textures.forEach((tex, i) => {
      tex.anisotropy = maxAniso;
      // Normal maps are data, not colour: they stay linear.
      tex.colorSpace = i < COLOR_URLS.length ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
    });
  }, [textures, gl]);

  const posGroups = useRef<(THREE.Group | null)[]>(WORLDS.map(() => null));
  const spinGroups = useRef<(THREE.Group | null)[]>(WORLDS.map(() => null));

  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());
    updateWorlds(time, bodies);
    for (let i = 0; i < WORLDS.length; i++) {
      const b = bodies[WORLDS[i].id];
      posGroups.current[i]?.position.set(b.x, b.y, b.z);
      const s = spinGroups.current[i];
      if (s) worldSpinQuaternion(WORLDS[i], time, s.quaternion);
    }
  });

  return (
    <group>
      {WORLDS.map((w, i) => (
        <group key={w.id} ref={(g) => { posGroups.current[i] = g; }}>
          <group ref={(g) => { spinGroups.current[i] = g; }}>
            <mesh name={`World_${w.id}`} scale={worldMeshScale(w)} material={materials[i]}>
              <sphereGeometry args={[w.size, WORLD_SEGMENTS, WORLD_SEGMENTS]} />
            </mesh>
          </group>
          {w.type === "ice-giant" && (
            <>
              <LimbDarkening radius={w.size} strength={0.7} />
              <Atmosphere radius={w.size} color={ICE_GIANT_RIM[w.id]} planetPos={bodies[w.id]}
                orbitRadius={w.orbit.radius} intensity={0.5} thickness={1.04} dusk={ICE_GIANT_DUSK} />
            </>
          )}
        </group>
      ))}
    </group>
  );
}
