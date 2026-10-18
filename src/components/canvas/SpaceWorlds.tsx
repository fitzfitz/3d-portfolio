import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import Atmosphere, { LimbDarkening } from "./Atmosphere";
import { WORLDS } from "../../data/worlds";
import { bodies, useSpaceStore } from "../../store/spaceStore";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { ringRadii } from "../../utils/ringOptics";
import { irradianceVsAU } from "../../utils/sunLight";
import { worldMeshScale, worldSpinQuaternion } from "../../utils/worldSpin";
import { makePlanetRingMaterial, RING_NIGHT_FLOOR } from "./guideLine";
import { patchSunShadow, worldSlot } from "./sunShadow";
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

/**
 * Draw order of a world's transparent layers, explicit rather than left to
 * distance sorting (their shells share a centre): limb darkening, then the
 * atmosphere over it, then the rings over both.
 *
 * renderOrder is a global key three sorts by before depth, so the values stay
 * between the stars (STAR_RENDER_ORDER, −1) and everything else (0): the ring
 * at 0 still depth-sorts against the other order-0 transparents (the ship's
 * plume, the guide lines), so one in front of the rings draws over them
 * rather than under. The ice giants' shells sit just below 0, so a plume in
 * front of one is drawn after it, as it should be (one behind a shell's faint
 * halo draws over it too: the lesser error, and the order the brief asks for).
 */
const WORLD_RENDER_ORDER = { limb: -0.2, atmosphere: -0.1, ring: 0 } as const;

/**
 * The ringed giant's rings (L14): C ring inner edge to A ring outer edge,
 * 1.24–2.27 equatorial radii (ringOptics.ts), 256 segments around.
 */
const RINGED = WORLDS.findIndex((w) => w.id === "w-ringed");
const [RING_INNER, RING_OUTER] = ringRadii(WORLDS[RINGED].size);
const RING_SEGMENTS = 256;

/**
 * The ring plane's normal in world space: the ringed giant's spin axis, its
 * spin group's +Y, rewritten in place each frame. The ring shader takes its
 * own from its model matrix; the planet's ring-shadow patch reads this.
 */
const ringNormal = { value: new THREE.Vector3(0, 1, 0) };

const mapUrl = (file: string) => assetUrl(`/models/${file}.webp`);
const COLOR_URLS = WORLDS.map((w) => mapUrl(w.map));
const NORMAL_WORLDS = WORLDS.filter((w) => NORMAL_MAPPED.has(w.id));
const NORMAL_URLS = NORMAL_WORLDS.map((w) => mapUrl(`${w.map}_normal`));
const RING_URL = mapUrl(`${WORLDS[RINGED].map}_ring`);
const RING_TEX = COLOR_URLS.length + NORMAL_URLS.length;

export default function SpaceWorlds() {
  const textures = useTexture([...COLOR_URLS, ...NORMAL_URLS, RING_URL]);
  const gl = useThree((s) => s.gl);

  // The ring strip: colour in RGB (sRGB, decoded on sampling; alpha stays
  // linear), τ in A. Set before its first upload. No mipmaps: the strip runs
  // only along u, so near edge-on the radial derivative is huge and a mip
  // level would average τ across the Cassini division (and averaging τ before
  // the exp of the opacity is wrong anyway). Plain linear filtering keeps the
  // division sharp at any tilt; the cost is shimmer in the fine ringlets from
  // far away. Clamped, so u outside [0, 1] reads the end texels' τ = 0.
  const ringMap = useMemo(() => {
    const tex = textures[RING_TEX];
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }, [textures]);

  // Built here, not as JSX, so no re-render can re-apply an onBeforeCompile
  // over the shadow patch (as SpacePlanets does). Fragment mode skips the
  // world's own body by distance, so all share the planets' programs.
  const materials = useMemo(() => WORLDS.map((w, i) => {
    const n = NORMAL_WORLDS.indexOf(w);
    const m = new THREE.MeshStandardMaterial({
      map: textures[i], roughness: 0.95, metalness: 0,
      normalMap: n >= 0 ? textures[COLOR_URLS.length + n] : null,
    });
    // The ringed giant also takes its rings' shadow: one more program, its own.
    patchSunShadow(m, "fragment", i === RINGED
      ? { ringShadow: { normal: ringNormal, inner: RING_INNER, outer: RING_OUTER, map: ringMap } }
      : undefined);
    return m;
  }), [textures, ringMap]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  // Lit by the sunlight at its orbit (L19); in its planet's umbra through
  // that world's occluder slot (L20).
  const ringMat = useMemo(() => makePlanetRingMaterial("#ffffff", RING_INNER, RING_OUTER, worldSlot("w-ringed"), {
    ringMap, irradiance: irradianceVsAU(WORLDS[RINGED].orbit.radius),
  }), [ringMap]);
  useEffect(() => () => ringMat.dispose(), [ringMat]);
  // The umbra floor per tier, as Ruangrapi's ring (guideLine.ts RING_NIGHT_FLOOR).
  useEffect(() => {
    const apply = (lowPerf: boolean) => {
      ringMat.uniforms.uNightFloor.value = lowPerf ? RING_NIGHT_FLOOR.display : RING_NIGHT_FLOOR.linear;
    };
    apply(useSpaceStore.getState().isLowPerf);
    return useSpaceStore.subscribe((st) => st.isLowPerf, apply);
  }, [ringMat]);

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    textures.forEach((tex, i) => {
      if (i === RING_TEX) return; // set up with ringMap
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
    const r = spinGroups.current[RINGED];
    if (r) ringNormal.value.set(0, 1, 0).applyQuaternion(r.quaternion);
  });

  return (
    <group>
      {WORLDS.map((w, i) => (
        <group key={w.id} ref={(g) => { posGroups.current[i] = g; }}>
          <group ref={(g) => { spinGroups.current[i] = g; }}>
            <mesh name={`World_${w.id}`} scale={worldMeshScale(w)} material={materials[i]}>
              <sphereGeometry args={[w.size, WORLD_SEGMENTS, WORLD_SEGMENTS]} />
            </mesh>
            {/* In the equatorial plane: the spin group's XZ (RingGeometry's
                XY turned down). It turns with the planet, which a radially
                symmetric strip cannot show, and so the ring and the shadow's
                normal come from the one quaternion and cannot disagree. */}
            {i === RINGED && (
              <mesh name={`WorldRing_${w.id}`} rotation={[-Math.PI / 2, 0, 0]} material={ringMat}
                renderOrder={WORLD_RENDER_ORDER.ring}>
                <ringGeometry args={[RING_INNER, RING_OUTER, RING_SEGMENTS, 1]} />
              </mesh>
            )}
          </group>
          {w.type === "ice-giant" && (
            <>
              <LimbDarkening radius={w.size} strength={0.7} renderOrder={WORLD_RENDER_ORDER.limb} />
              <Atmosphere radius={w.size} color={ICE_GIANT_RIM[w.id]} planetPos={bodies[w.id]}
                orbitRadius={w.orbit.radius} intensity={0.5} thickness={1.04} dusk={ICE_GIANT_DUSK}
                renderOrder={WORLD_RENDER_ORDER.atmosphere} />
            </>
          )}
        </group>
      ))}
    </group>
  );
}
