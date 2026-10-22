import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import Atmosphere, { LimbDarkening } from "./Atmosphere";
import CloudLayer from "./CloudLayer";
import { AU } from "../../constants";
import { CLOSE_UP_HOURS_PER_SECOND } from "../../data/solarMoons";
import { SOLAR_BODIES, bodyById, type SolarBody } from "../../data/solarSystem";
import { bodies, useSpaceStore } from "../../store/spaceStore";
import { fitzDebug } from "../../debug/bridge";
import { ambientTime } from "../../utils/ambientTime";
import { meshScale, ringNormal, spinQuaternion } from "../../utils/bodySpin";
import { assetUrl } from "../../utils/assetUrl";
import { updateBodies } from "../../utils/bodyPositions";
import { displayAlbedoGain } from "../../utils/displayAlbedo";
import { hiResChoice } from "../../utils/hiResMaps";
import { ringIrradiance, ringRadii } from "../../utils/ringOptics";
import { makeSphereLOD } from "../../utils/sphereLod";
import { makeBodyRing, makeBodyRingMaterial, makeUranusRingStrip } from "./bodyRings";
import { noIbl } from "./noIbl";
import { guideViewportHeight, RING_NIGHT_FLOOR } from "./guideLine";
import { patchNightGlow } from "./nightGlow";
import { patchOceanGloss, SEA_ROUGHNESS, WATER_IOR } from "./oceanGloss";
import { OCCLUDER_COUNT, patchSunShadow, sunShadowDebug, sunShadowUniforms } from "./sunShadow";

/**
 * The nine real bodies (data/solarSystem.ts), one data-driven renderer
 * (real-solar-system spec §5): each body is one LOD sphere at its JPL position
 * for the orrery date (utils/bodyPositions.ts updateBodies, the one writer of
 * `bodies` and of the bodies' occluder slots), flattened, mapped or tinted,
 * lit, shadowed (sunShadow.ts "fragment" mode) and scanned. Each wears its
 * NASA/USGS public-domain map (or a seeded one where no true-colour global
 * map exists; spec §5.5, data/solarSystem.ts). Earth adds its clouds and
 * night lights, Saturn and Uranus their rings (bodyRings.ts), and `look` adds
 * the limb darkening and the atmosphere rims. No orbit lines are drawn in the
 * scene (owner, 2026-10-21): the logbook's system chart shows the true
 * ellipses instead. orbitRibbon.ts keeps the tested ribbon geometry should
 * they come back as a toggle.
 */


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
 * Earth's clouds turn a little faster than its surface (the Ocean World's
 * relation, 0.168 against 0.1 rad/s), on the same close-up clock.
 */
const CLOUD_SPIN_RATIO = 1.68;
const cloudSpin = (b: SolarBody) => (CLOUD_SPIN_RATIO * 2 * Math.PI * CLOSE_UP_HOURS_PER_SECOND) / b.rotationHours;

/**
 * Maps with a 4096-wide variant (`mapHiRes`: Mercury, Earth, Mars), drawn on
 * desktops (utils/hiResMaps.ts). Up close a body fills the screen and the
 * sharp 2048 texels show as blocks; the soft giants don't need it.
 */
const HI_RES_MAPS: ReadonlySet<string> = new Set(SOLAR_BODIES.filter((b) => b.mapHiRes).map((b) => b.map));
/** Earth's night lights (Black Marble 2016) and cloud cover (The Blue Marble's clouds). */
const EARTH = bodyById("earth");
const NIGHT_LIGHTS_MAP = EARTH.look.nightLights!;
const CLOUDS = EARTH.look.clouds!;
/** Saturn's ring strip (ringOptics.ts profile). */
const SATURN = bodyById("saturn");
const RING_MAP = `${SATURN.map}_ring`;
const [RING_INNER, RING_OUTER] = ringRadii(SATURN.size);
/** The ringed bodies' indices in SOLAR_BODIES (Saturn, Uranus), for the frame loop. */
const RINGED = SOLAR_BODIES.flatMap((b, i) => (b.look.rings ? [i] : []));

/** The distinct maps the bodies draw, in a fixed order. */
const MAPS: readonly string[] = [...new Set(SOLAR_BODIES.map((b) => b.map))];
/** One texture list: maps, then the night lights, the ring strip and the cloud cover. */
const TEX_NIGHT = MAPS.length;
const TEX_RING = TEX_NIGHT + 1;
const TEX_CLOUDS = TEX_RING + 1;
const mapUrl = (file: string, hiRes: boolean) => {
  const variant = hiRes && HI_RES_MAPS.has(file) ? `${file}_4k` : file;
  return assetUrl(`/models/${variant}.webp`);
};

/**
 * A body's material colour: white times the dark-surface display curve
 * (displayAlbedo.ts, P3). Its map carries the colour and the honest albedo.
 */
function bodyColor(b: SolarBody): THREE.Color {
  return new THREE.Color(1, 1, 1).multiplyScalar(displayAlbedoGain(b.texelMedianLinear));
}

export default function SolarBodies() {
  // Desktop only, decided once per page and shared with the asset pack loader
  // (utils/hiResMaps.ts): swapping URLs mid-flight would re-suspend the scene,
  // and the other tier is not in this page's packs.
  const [hiRes] = useState(hiResChoice);
  // Resolved at render, not at import: in a build, assetUrl answers from the
  // asset pack, which can still be downloading while this module loads.
  const textures = useTexture([
    ...MAPS.map((m) => mapUrl(m, hiRes)),
    mapUrl(NIGHT_LIGHTS_MAP, false),
    mapUrl(RING_MAP, false),
    mapUrl(CLOUDS.map, false),
  ]);
  const gl = useThree((s) => s.gl);

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
      // Every map is display-encoded, the cloud cover too: it holds the
      // shell's opacity sRGB-encoded (process_body_maps.mjs
      // CLOUD_OPACITY_GAMMA), so the GPU's decode restores it with the dark
      // end's precision (CloudLayer.tsx).
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    });
  }, [textures, gl]);

  /**
   * The ring plane's normal in world space: Saturn's IAU pole, fixed in space
   * (the ring mesh sits in the pole frame below, so the two share one
   * quaternion). The ring shader takes its own from its model matrix; Saturn's
   * ring-shadow patch reads this.
   */
  const saturnRingNormal = useMemo(() => ({ value: ringNormal(SATURN, new THREE.Vector3()) }), []);

  // Built here, not as JSX, so no re-render can re-apply an onBeforeCompile
  // over the shadow patch. Fragment mode skips each body's own sphere by
  // distance, so all share the same programs.
  const materials = useMemo(() => SOLAR_BODIES.map((b) => {
    const map = textures[MAPS.indexOf(b.map)];
    // Every surface is matte but Earth's sea: water's F0 and its gloss where
    // the map's alpha says ocean (oceanGloss.ts), its own physical program.
    const m = b.id === "earth"
      ? new THREE.MeshPhysicalMaterial({ map, ior: WATER_IOR, roughness: SEA_ROUGHNESS, metalness: 0 })
      : new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
    m.color.copy(bodyColor(b));
    if (b.look.nightLights) {
      // City lights on the night side only (nightGlow.ts; Io's hot spots share the hook, not Earth's physical program).
      m.emissiveMap = textures[TEX_NIGHT];
      m.emissive.set("#ffd9a0");
      m.emissiveIntensity = 1.4;
      patchNightGlow(m);
    }
    if (m instanceof THREE.MeshPhysicalMaterial) patchOceanGloss(m);
    // Saturn also takes its rings' shadow: one more program, its own.
    patchSunShadow(m, "fragment", b.look.rings === "saturn"
      ? { ringShadow: { normal: saturnRingNormal, inner: RING_INNER, outer: RING_OUTER, map: ringMap } }
      : undefined);
    return m;
  }), [textures, ringMap, saturnRingNormal]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  // Detail by distance (sphereLod.ts), flattened along the pole (the LOD's local Y, turned onto it each frame). The
  // eclipse occluders and collisions use the equatorial size, never this scale.
  const lods = useMemo(() => SOLAR_BODIES.map((b, i) => {
    const lod = makeSphereLOD(materials[i], b.size, { name: `Body_${b.id}` });
    const [sx, sy, sz] = meshScale(b);
    lod.scale.multiply(new THREE.Vector3(sx, sy, sz));
    return lod;
  }), [materials]);

  // The rings (bodyRings.ts): Saturn's measured strip, Uranus's epsilon ring
  // built in code. Lit by the sunlight at their planet's live distance (L19,
  // §4.8: written each frame); in their planet's umbra through its occluder
  // slot (L20). One program for both.
  const uranusStrip = useMemo(() => makeUranusRingStrip(), []);
  useEffect(() => () => uranusStrip.dispose(), [uranusStrip]);
  const ringMats = useMemo(() => SOLAR_BODIES.map((b) => (b.look.rings
    ? makeBodyRingMaterial(b, b.look.rings === "saturn" ? ringMap : uranusStrip)
    : null)), [ringMap, uranusStrip]);
  const rings = useMemo(() => SOLAR_BODIES.map((b, i) => {
    const m = ringMats[i];
    return m ? makeBodyRing(b, m, BODY_RENDER_ORDER.ring) : null;
  }), [ringMats]);
  useEffect(() => () => {
    ringMats.forEach((m) => m?.dispose());
    rings.forEach((r) => r?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }));
  }, [ringMats, rings]);
  // The umbra floor is measured per tier (guideLine.ts): the PostFX buffer is
  // linear, the low-perf tier draws display-encoded colour.
  useEffect(() => {
    const apply = (lowPerf: boolean) => {
      for (const m of ringMats) if (m) m.uniforms.uNightFloor.value = lowPerf ? RING_NIGHT_FLOOR.display : RING_NIGHT_FLOOR.linear;
    };
    apply(useSpaceStore.getState().isLowPerf);
    return useSpaceStore.subscribe((st) => st.isLowPerf, apply);
  }, [ringMats]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.sunShadow = sunShadowUniforms;
    fitzDebug.sunShadowDebug = sunShadowDebug;
    return () => { fitzDebug.sunShadow = null; fitzDebug.sunShadowDebug = null; };
  }, []);

  const poleQuaternions = useMemo(() => SOLAR_BODIES.map((b) => spinQuaternion(b, 0, new THREE.Quaternion())), []);
  const posGroups = useRef<(THREE.Group | null)[]>(SOLAR_BODIES.map(() => null));

  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());
    updateBodies(time, bodies);
    // The orbit lines' screen-constant width is measured in CSS px of this view.
    guideViewportHeight.value = state.size.height;
    sunShadowUniforms.uOccluderCount.value = sunShadowDebug.countOverride >= 0 ? sunShadowDebug.countOverride : OCCLUDER_COUNT;
    // Sunlit and ambient only: no studio IBL on a body (noIbl.ts, L29).
    noIbl(materials, state.scene.environment);
    for (let i = 0; i < SOLAR_BODIES.length; i++) {
      const b = SOLAR_BODIES[i];
      const p = bodies[b.id];
      posGroups.current[i]?.position.set(p.x, p.y, p.z);
      spinQuaternion(b, time, lods[i].quaternion);
    }
    for (let k = 0; k < RINGED.length; k++) {
      const i = RINGED[k], p = bodies[SOLAR_BODIES[i].id];
      ringMats[i]!.uniforms.uIrradiance.value = ringIrradiance(Math.hypot(p.x, p.y, p.z) / AU);
    }
  });

  return (
    <group>
      {SOLAR_BODIES.map((b, i) => {
        const atm = b.look.atmosphere;
        return (
          <group key={b.id} ref={(g) => { posGroups.current[i] = g; }}>
            {/* The surface turns about the IAU pole (spinQuaternion, per frame). */}
            <primitive object={lods[i]} dispose={null} />
            {/* The pole frame: +Y on the pole, fixed in space; the clouds turn
                about it and the ring lies in it. */}
            <group quaternion={poleQuaternions[i]}>
              {b.look.clouds && (
                <CloudLayer radius={b.size} alphaMap={textures[TEX_CLOUDS]} linear={b.look.clouds.linear}
                  speed={cloudSpin(b)} sunShadow />
              )}
              {/* In the equatorial plane: the spin frame's XZ (bodyRings.ts
                  turns RingGeometry's XY down), so the ring and the shadow's
                  normal share the one pole and cannot disagree. */}
              {rings[i] && <primitive object={rings[i]} dispose={null} />}
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
    </group>
  );
}
