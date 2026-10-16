import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF, useTexture } from "@react-three/drei";
import PortalRing from "./PortalRing";
import Atmosphere, { LimbDarkening } from "./Atmosphere";
import CloudLayer from "./CloudLayer";
import {
  COSMIC_BOUNDS, PORTAL_POS, planets, PROGRADE,
  ZONE_FACTOR, LOCK_RETAIN_FACTOR,
} from "../../constants";
import { DESTINATIONS } from "../../data/destinations";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { canCapture } from "../../utils/capture";
import { orbitPosition } from "../../utils/orbits";
import { ambientTime } from "../../utils/ambientTime";
import { toroidalDistance3 } from "../../utils/toroidal";
import { driftedHue } from "../../utils/nebulaHue";
import { setScannable } from "../../utils/scannables";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { makeGuideLineMaterial, makePlanetRingMaterial } from "./guideLine";
import { assetUrl } from "../../utils/assetUrl";
import { MOON_TINTS } from "../../data/moonTints";
import { MOONS, moonOrbitSpeed, type MoonSpec } from "../../data/moons";

/**
 * Orbit-ring breathe. Baseline 0.22 is the opacity the rings were authored with,
 * so at zero amplitude they look exactly as before. The x16 multiplier converts
 * each planet's orbital rate (periods of 420-600s) into a perceptible ~26-37s
 * pulse. Baked from animScale 4 and rebased: 0.22 ± 0.48 dipped negative, so
 * 0.35 ± 0.35 reproduces the same observed 0 .. 0.70 range with a valid floor.
 * The rings therefore fade fully out at the trough rather than just dimming.
 */
const ORBIT_RING_OPACITY = 0.35;
const ORBIT_RING_BREATH = 0.35;
const ORBIT_RING_BREATH_MULT = 16;

/**
 * Wispy gas sprite: 4-octave value-noise fBm under a soft radial falloff,
 * generated once at load. It replaced a smooth radial gradient, which needed
 * 45 stacked sprites per cloud to suggest any structure — and every one of
 * them is screen-sized additive overdraw when the camera is inside a cloud.
 * With the structure in the texture, far fewer sprites read as gas.
 */
const nebulaTexture = (() => {
  const N = 128;
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Seeded lattice so every load draws the same clouds.
    let seed = 1337;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const G = 32;
    const lattice = Array.from({ length: G * G }, rand);
    const at = (x: number, y: number) => lattice[((y % G + G) % G) * G + ((x % G + G) % G)];
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const noise = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const u = smooth(x - xi), v = smooth(y - yi);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let f = 0, amp = 0.5, freq = 4 / N;
        for (let o = 0; o < 4; o++) { f += noise(x * freq, y * freq) * amp; amp *= 0.5; freq *= 2; }
        const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
        const r = Math.min(1, Math.hypot(dx, dy) * 2);
        const fall = Math.pow(1 - r, 2);
        const alpha = fall * (0.25 + 0.75 * Math.pow(f, 1.6));
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  return new THREE.CanvasTexture(canvas);
})();

// Animated energy membrane for the stargate: spiral bands swirling into a hot
// core, replacing the GLB's static portal_glow texture.
const membraneVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const membraneFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    // three spiral arms drifting inward, plus a slow counter-swirl for depth
    float swirl = sin(a * 3.0 + r * 9.0 - uTime * 2.6) * 0.5 + 0.5;
    float counter = sin(a * 5.0 - r * 14.0 + uTime * 1.7) * 0.5 + 0.5;
    float bands = swirl * 0.7 + counter * 0.3;
    // edge0 < edge1 throughout: reversed smoothstep edges are undefined in GLSL
    float core = 1.0 - smoothstep(0.0, 0.55, r);
    vec3 col = mix(vec3(0.45, 0.05, 0.55), vec3(1.0, 0.25, 0.75), bands); // deep violet -> neon pink
    col = mix(col, vec3(1.0, 0.9, 0.6), core * (0.6 + bands * 0.4));       // white-hot center
    float alpha = (0.35 + bands * 0.5) * (1.0 - smoothstep(0.8, 1.05, r)) + core * 0.5;
    gl_FragColor = vec4(col * (0.8 + core), alpha);
  }
`;

interface NebulaClusterProps {
  position: [number, number, number];
  color: string;
  size: number;
  opacity: number;
}

// Renders a volumetric deep-space nebula by stacking multiple soft gradient particles
function NebulaCluster({ position, color, size, opacity }: NebulaClusterProps) {
  // 45 -> 22: the wispy texture carries the structure that stacking used to
  // fake, and each sprite removed is one fewer screen-sized additive layer
  // when flying through a cloud (overdraw roughly halved). Size and opacity
  // below compensate.
  const pointsCount = 22;
  const pointsRef = useRef<THREE.Points>(null);

  // Generate initial structural parameters for each particle
  const particlesData = useMemo(() => {
    const data = [];
    for (let i = 0; i < pointsCount; i++) {
      data.push({
        radius: Math.random() * (size * 0.95),
        initialTheta: Math.random() * Math.PI * 2,
        h: (Math.random() - 0.5) * (size * 0.45),
        // Random slow drift speeds
        orbitSpeed: (Math.random() * 0.015 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
        verticalSpeed: Math.random() * 0.08 + 0.02,
        verticalPhase: Math.random() * Math.PI * 2,
        verticalAmp: (Math.random() * 0.06 + 0.02) * size,
      });
    }
    return data;
  }, [size]);

  // Capture base HSL from color once
  const baseHSL = useMemo(() => {
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(color).getHSL(hsl);
    return hsl;
  }, [color]);

  // Animate the buffer geometry positions inside useFrame
  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());
    if (pointsRef.current) {
      const geo = pointsRef.current.geometry;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
      if (posAttr) {
        for (let i = 0; i < pointsCount; i++) {
          const p = particlesData[i];
          // Calculate swirling orbital coordinates
          const angle = p.initialTheta + time * p.orbitSpeed;
          const x = Math.sin(angle) * p.radius;
          const z = Math.cos(angle) * p.radius;
          const y = p.h + Math.sin(time * p.verticalSpeed + p.verticalPhase) * p.verticalAmp;

          posAttr.setXYZ(i, x, y, z);
        }
        posAttr.needsUpdate = true;
      }
      // Re-tint the material color with drifted hue
      const mat = pointsRef.current.material as THREE.PointsMaterial;
      mat.color.setHSL(driftedHue(baseHSL.h * 360, time) / 360, baseHSL.s, baseHSL.l);
    }
  });

  const initialPositions = useMemo(() => new Float32Array(pointsCount * 3), []);

  return (
    // NOTE: "NebulaCluster" is shared by all 5 sibling instances rendered
    // below (one per nebula cloud). Object3D.getObjectByName returns only the
    // first DFS match, so any future code (or e2e probe) reaching for that
    // method here will silently see 1 of 5, not all of them — traverse +
    // filter on name instead if you need every instance.
    <points name="NebulaCluster" position={position} ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[initialPositions, 3]}
          count={pointsCount}
          array={initialPositions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        map={nebulaTexture}
        color={color}
        size={size * 1.9} // Large soft overlapping particles
        transparent={true}
        opacity={opacity * 1.9} // Fewer layers, so each carries more
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/**
 * One moon from data/moons.ts. Tidally locked (docs/UNIVERSE-RULES.md L11): the
 * mesh has no spin of its own, so riding the orbit group keeps one face toward
 * the planet, as every large moon in the solar system does.
 */
function OrbitingMoon({ moon }: { moon: MoonSpec }) {
  const planetSize = planets[moon.planet].size;
  const distance = moon.distance * planetSize, size = moon.size * planetSize;
  const { inclination, phase, variant } = moon;
  const speed = moonOrbitSpeed(moon);
  const color = MOON_TINTS[moon.id];
  const { scene } = useGLTF(assetUrl("/models/moon.glb"));
  const orbitRef = useRef<THREE.Group>(null);

  const { geometry, material } = useMemo(() => {
    // Prefer the named variant (Moon_Rock / Moon_Ice / Moon_Volcanic); fall
    // back to the first mesh so a single-moon file still renders.
    let src: THREE.Mesh | undefined;
    let first: THREE.Mesh | undefined;
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      first ??= o;
      if (!src && o.name === `Moon_${variant}`) src = o;
    });
    src ??= first;
    if (!src) throw new Error("moon.glb contains no mesh");
    const g = bakeNodeTransform(src, { center: true });
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.color.multiply(new THREE.Color(color)); // per-moon tint over the baked gray
    return { geometry: g, material: m };
  }, [scene, color, variant]);
  useEffect(() => () => { material.dispose(); geometry.dispose(); }, [material, geometry]);

  useFrame((state) => {
    const t = ambientTime(state.clock.getElapsedTime());
    if (orbitRef.current) orbitRef.current.rotation.y = phase + t * speed;
  });
  return (
    <group rotation={[inclination, 0, 0]}>
      <group ref={orbitRef}>
        <mesh position={[distance, 0, 0]} scale={size} geometry={geometry} material={material} />
      </group>
    </group>
  );
}

/**
 * City lights only on the night side. three.js adds an emissive map on the
 * lit hemisphere too, which would put RuangRapi's settlement lights in broad
 * daylight. This injects a mask after the emissive map is applied: the sun
 * is a point light at the world origin, so its view-space position is
 * re-uploaded each frame and compared with the surface normal.
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
 * Sphere tessellation for the three planets. 32 faceted visibly on the limb at
 * lock distance, where a planet fills half the screen; 64 is smooth there and
 * costs ~18k triangles across all three, next to an 840k-triangle scene.
 */
const PLANET_SEGMENTS = 64;

/**
 * Maps with a 4096-wide variant (assets-src/4k/). In orbit lock the planet
 * fills the screen and the hard-edged worlds' 2048 texels show as blocks; the
 * soft-banded gas giant and the sparse city lights don't need it.
 */
const HI_RES_MAPS = new Set(["ruangrapi", "fuxx", "fuxx_glow"]);
const planetMap = (file: string, hiRes: boolean) => {
  const variant = hiRes && HI_RES_MAPS.has(file) ? `${file}_4k` : file;
  return assetUrl(`/models/${variant}.webp`);
};

/**
 * Desktop only: a 4096 map costs ~45MB of GPU memory, which is the bigger risk
 * on touch devices. Decided once at mount — swapping URLs mid-flight would
 * re-suspend the scene.
 */
const prefersHiResMaps = () =>
  !useSpaceStore.getState().isLowPerf && window.matchMedia?.("(pointer: fine)").matches === true;
/** Orbit-drive scratch: the frame loop reuses it instead of allocating. */
const orbitScratch = { x: 0, y: 0, z: 0 };

export default function SpacePlanets() {
  const saasPlanetRef = useRef<THREE.Mesh>(null);
  const videoPlanetRef = useRef<THREE.Mesh>(null);
  const agentPlanetRef = useRef<THREE.Mesh>(null);
  const planetGroupRefs = useRef<(THREE.Group | null)[]>([null, null, null]);
  const saasRingRef = useRef<THREE.Mesh>(null);
  /** Orbit-path ring materials, one per planet, for the opacity breathe. */
  // Thin dashed orbit paths that fade out near the camera (guideLine.ts).
  const orbitRingMats = useMemo(() => planets.map((p) => makeGuideLineMaterial({
    color: p.color, opacity: ORBIT_RING_OPACITY, dashes: 220, fadeIn: [10, 55],
  })), []);
  // Gravity-field circles: only shown on approach, faded in near and out far.
  const gravityMats = useMemo(() => planets.map((p) => makeGuideLineMaterial({
    color: p.color, opacity: 0.4, dashes: 48, fadeIn: [4, 9], fadeOut: [28, 55],
  })), []);
  const planetRingMat = useMemo(
    () => makePlanetRingMaterial("#7dffc0", planets[0].size * 1.15, planets[0].size * 1.6), []);
  useEffect(() => () => [...orbitRingMats, ...gravityMats, planetRingMat].forEach((m) => m.dispose()),
    [orbitRingMats, gravityMats, planetRingMat]);
  const nebulaeGroupRef = useRef<THREE.Group>(null);
  const portalOuterAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerCoreRef = useRef<THREE.Mesh>(null);
  const portalFrameRef = useRef<THREE.Group>(null);

  // Load planet textures maps
  // One original procedural world per project (scripts/textures/
  // gen_planets.mjs): an archipelago ocean world, a cyan gas giant, and a
  // violet world cut by glowing rifts. Glow maps carry RuangRapi's city
  // lights and fuxx's rift network.
  const [hiRes] = useState(prefersHiResMaps);
  const [ruangrapiTex, portfolioTex, fuxxTex, ruangrapiGlow, fuxxGlow] = useTexture(
    ["ruangrapi", "portfolio", "fuxx", "ruangrapi_glow", "fuxx_glow"].map((f) => planetMap(f, hiRes)),
  );
  const cityLights = useNightSideEmissive();

  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const tex of [ruangrapiTex, portfolioTex, fuxxTex, ruangrapiGlow, fuxxGlow]) {
      tex.anisotropy = maxAniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }, [ruangrapiTex, portfolioTex, fuxxTex, ruangrapiGlow, fuxxGlow, gl]);

  // Load custom stargate portal gateway model
  const { scene: portalScene } = useGLTF(assetUrl("/models/portal_gateway.glb"));

  // Swap the GLB's static membrane texture for the animated swirl shader.
  const membraneMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: membraneVertex,
        fragmentShader: membraneFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => {
    portalScene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith("PortalMembrane")) o.material = membraneMaterial;
    });
    return () => membraneMaterial.dispose();
  }, [portalScene, membraneMaterial]);

  // Destinations are static; planets are re-registered every frame (they orbit).
  useEffect(() => {
    for (const d of DESTINATIONS) setScannable(d.id, d.pos[0], d.pos[1], d.pos[2], d.scanLabel);
  }, []);

  // Proximity attraction logic
  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());

    // 0. Orbit drive: single writer of `bodies` (spec §3)
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const pos = orbitPosition(p.orbit, time, orbitScratch);
      const b = bodies[p.name];
      b.x = pos.x; b.y = pos.y; b.z = pos.z;
      const g = planetGroupRefs.current[i];
      if (g) g.position.set(pos.x, pos.y, pos.z);
      setScannable(p.name, pos.x, pos.y, pos.z, "PLANET_" + p.name.toUpperCase(), p.size);
    }

    // 1. Slowly rotate planets
    // Prograde, like their orbits (docs/UNIVERSE-RULES.md L9). They spun
    // backwards before, the way only Venus and Uranus do.
    if (saasPlanetRef.current) saasPlanetRef.current.rotation.y = PROGRADE * time * 0.1;
    if (videoPlanetRef.current) videoPlanetRef.current.rotation.y = PROGRADE * time * 0.3;
    if (agentPlanetRef.current) agentPlanetRef.current.rotation.y = PROGRADE * time * 0.13;

    // Spin Stargate Portal Frame infinitely
    if (portalFrameRef.current) {
      portalFrameRef.current.rotation.z = time * 0.08;
    }
    membraneMaterial.uniforms.uTime.value = time;

    // Ring precession. This used to write `rotation.z`, which was a no-op: the
    // ring is a flat, radially symmetric, single-colour annulus whose normal IS
    // local Z, so spinning it about that axis renders identically at every
    // angle — invisible at any speed, not merely slow. Driving `rotation.y`
    // instead swings the ring's normal, so its projected ellipse rotates and
    // the motion actually reads. The mount-time X tilt (Math.PI / 2.3, set in
    // JSX) is left alone, so the ring keeps its authored lean.
    if (saasRingRef.current) saasRingRef.current.rotation.y = time * 0.06;

    // Orbit-path rings breathe. These had no animation hook at all — three
    // static circles marking each orbital plane. The rate is derived from each
    // planet's own `angularSpeed`, so every ring differs naturally and no new
    // tuning constant is introduced, but multiplied by ORBIT_RING_BREATH_MULT
    // because the raw orbital periods are 420-600s and a 7-to-10-minute opacity
    // fade is imperceptible — the same mistake as the old star-shell rates.
    // At x16 the periods land around 26/32/37s: a slow, calm pulse that reads
    // without competing with a dossier for attention.
    for (let i = 0; i < planets.length; i++) {
      const rate = planets[i].orbit.angularSpeed * ORBIT_RING_BREATH_MULT;
      orbitRingMats[i].uniforms.uOpacity.value = ORBIT_RING_OPACITY +
        Math.sin(time * rate + planets[i].orbit.phase) * ORBIT_RING_BREATH;
    }
    if (nebulaeGroupRef.current) nebulaeGroupRef.current.rotation.y = time * 0.005;

    // Stargate Portal Aura animations (Organic high-frequency fire flicker)
    if (portalOuterAuraRef.current) {
      portalOuterAuraRef.current.rotation.z = time * 0.35;
      const outerScale = 1.0 + Math.sin(time * 2.8) * 0.09;
      portalOuterAuraRef.current.scale.set(outerScale, outerScale, 1);
      const mat = portalOuterAuraRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = 0.3 + (Math.sin(time * 18.0) * 0.08 + Math.cos(time * 29.0) * 0.04);
      }
    }
    if (portalInnerAuraRef.current) {
      portalInnerAuraRef.current.rotation.y = time * 1.8;
      portalInnerAuraRef.current.rotation.x = -time * 1.2;
      portalInnerAuraRef.current.rotation.z = time * 2.4;
      const innerScale = 0.95 + (Math.sin(time * 22.0) * 0.12 + Math.cos(time * 35.0) * 0.06);
      portalInnerAuraRef.current.scale.set(innerScale, innerScale, innerScale);
      const mat = portalInnerAuraRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = 0.28 + Math.sin(time * 32.0) * 0.08;
      }
    }
    if (portalInnerCoreRef.current) {
      const coreScale = 1.0 + (Math.sin(time * 28.0) * 0.15 + Math.cos(time * 42.0) * 0.05);
      portalInnerCoreRef.current.scale.set(coreScale, coreScale, coreScale);
    }

    // 2. Proximity: read mutable telemetry, write store only on change.
    // Hysteresis: once locked onto a body, retain the zone/lock at a wider
    // radius than the one that engaged it, so the orbit ring (which sits
    // further out than the engage threshold) doesn't immediately break the
    // lock it just entered — see tests/orbitInvariant.test.ts.
    const { isOrbitCooldown, isOrbitLocked: lockedNow, activeZone: zoneNow, setActiveZone, setOrbitLocked, photoMode } = useSpaceStore.getState();
    // Photo mode freezes the ship but bodies/scannables above keep orbiting; if we
    // let a moving planet drift past LOCK_RETAIN while frozen, the lock breaks and
    // Spaceship's escape-push effect (Spaceship.tsx:96-100) jolts the ship mid-photo.
    // Skip only the zone/lock writes here — mirrors Scanner.tsx:22's self-gate.
    if (photoMode) return;
    let activeZone: string | null = null;
    let lockActive = false;

    planets.forEach((p) => {
      const b = bodies[p.name];
      const dist = toroidalDistance3(flight.x, flight.z, flight.y, b.x, b.z, b.y, COSMIC_BOUNDS);
      if (lockedNow && zoneNow === p.name) {
        if (dist < p.size * LOCK_RETAIN_FACTOR) {
          activeZone = p.name;
          lockActive = true;
        }
      } else if (dist < p.size * ZONE_FACTOR) {
        activeZone = p.name;
        // A fast pass skims; a slow one (or one about to touch the surface) docks.
        if (canCapture(dist, p.size, flight.speed) && !isOrbitCooldown) lockActive = true;
      }
    });

    // Destinations (src/data/destinations.ts): fixed points with their own
    // radii, checked after the planets exactly as the portal always was.
    for (const d of DESTINATIONS) {
      const dist = toroidalDistance3(flight.x, flight.z, flight.y, d.pos[0], d.pos[2], d.pos[1], COSMIC_BOUNDS);
      if (lockedNow && zoneNow === d.id) {
        if (dist < d.retainR) {
          activeZone = d.id;
          lockActive = true;
        }
      } else if (dist < d.zoneR) {
        activeZone = d.id;
        if (dist < d.lockR && !isOrbitCooldown) lockActive = true;
      }
    }

    setActiveZone(activeZone);
    setOrbitLocked(lockActive);
  });

  return (
    <group>
      {/* 1. RUANGRAPI PLANET (Neon Green, Rings) */}
      <group ref={(g) => { planetGroupRefs.current[0] = g; }}>
        {/* Planet Sphere */}
        <mesh ref={saasPlanetRef}>
          <sphereGeometry args={[planets[0].size, PLANET_SEGMENTS, PLANET_SEGMENTS]} />
          <meshStandardMaterial map={ruangrapiTex} roughness={0.5} metalness={0.0}
            emissiveMap={ruangrapiGlow} emissive="#ffd9a0" emissiveIntensity={1.4}
            onBeforeCompile={cityLights} />
        </mesh>
        <Atmosphere radius={planets[0].size} color="#7dffd0" planetPos={bodies[planets[0].name]} orbitRadius={planets[0].orbit.radius} intensity={1.1} />
        <CloudLayer radius={planets[0].size} tint="#ffffff" speed={PROGRADE * 0.168} />
        {MOONS.filter((m) => m.planet === 0).map((m) => <OrbitingMoon key={m.id} moon={m} />)}

        {/* Planetary ring: banded, translucent, with a division (guideLine.ts) */}
        <mesh ref={saasRingRef} rotation={[Math.PI / 2.3, 0, 0]} material={planetRingMat}>
          <ringGeometry args={[planets[0].size * 1.15, planets[0].size * 1.6, 160, 1]} />
        </mesh>

        {/* Proximity gravity-field circle: dashed, shown only on approach */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={gravityMats[0]}>
          <ringGeometry args={[planets[0].size * ZONE_FACTOR, planets[0].size * (ZONE_FACTOR + 0.02), 192]} />
        </mesh>
      </group>

      {/* 2. PORTFOLIO PLANET (Neon Cyan, Moon) */}
      <group ref={(g) => { planetGroupRefs.current[1] = g; }}>
        {/* Planet Sphere */}
        <mesh ref={videoPlanetRef}>
          <sphereGeometry args={[planets[1].size, PLANET_SEGMENTS, PLANET_SEGMENTS]} />
          <meshStandardMaterial map={portfolioTex} roughness={0.95} metalness={0.0} />
        </mesh>
        <LimbDarkening radius={planets[1].size} strength={0.8} />
        <Atmosphere radius={planets[1].size} color={planets[1].color} planetPos={bodies[planets[1].name]} orbitRadius={planets[1].orbit.radius} intensity={0.55} thickness={1.06} />
        {MOONS.filter((m) => m.planet === 1).map((m) => <OrbitingMoon key={m.id} moon={m} />)}

        {/* Proximity gravity-field circle: dashed, shown only on approach */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={gravityMats[1]}>
          <ringGeometry args={[planets[1].size * ZONE_FACTOR, planets[1].size * (ZONE_FACTOR + 0.02), 192]} />
        </mesh>
      </group>

      {/* 3. FUXX PLANET (Neon Purple, Banded Grid Clouds) */}
      <group ref={(g) => { planetGroupRefs.current[2] = g; }}>
        {/* Planet Sphere */}
        <mesh ref={agentPlanetRef}>
          <sphereGeometry args={[planets[2].size, PLANET_SEGMENTS, PLANET_SEGMENTS]} />
          <meshStandardMaterial map={fuxxTex} roughness={0.9} metalness={0.0}
            emissiveMap={fuxxGlow} emissive="#e070ff" emissiveIntensity={1.2} />
        </mesh>
        <Atmosphere radius={planets[2].size} color="#c77dff" planetPos={bodies[planets[2].name]} orbitRadius={planets[2].orbit.radius} intensity={0.5} thickness={1.05} />
        {MOONS.filter((m) => m.planet === 2).map((m) => <OrbitingMoon key={m.id} moon={m} />)}

        {/* Proximity gravity-field circle: dashed, shown only on approach */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={gravityMats[2]}>
          <ringGeometry args={[planets[2].size * ZONE_FACTOR, planets[2].size * (ZONE_FACTOR + 0.02), 192]} />
        </mesh>
      </group>

      {/* Faint orbit architecture: one inclined ring per planet (spec §3) */}
      {planets.map((p, i) => (
        <group key={`ring-${p.name}`} rotation={[0, p.orbit.node, 0]}>
          <group rotation={[p.orbit.inclination, 0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} material={orbitRingMats[i]}>
              <ringGeometry args={[p.orbit.radius - 0.06, p.orbit.radius + 0.06, 512]} />
            </mesh>
          </group>
        </group>
      ))}

      {/* 4. CONTACT PORTAL SUN STAR (at 0, 0, -160) */}
      <group position={PORTAL_POS}>
        {/* 3D Custom Stargate Portal Gateway Frame */}
        <group ref={portalFrameRef}>
          <primitive object={portalScene} scale={0.85} rotation={[0, 0, 0]} />
        </group>

        {/* Glowing portal core */}
        <group scale={0.88}>
          <PortalRing />
        </group>

        {/* Outer solar flares gravity ring (Outer Aura) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} ref={portalOuterAuraRef}>
          <ringGeometry args={[2.0, 2.12, 32]} />
          <meshBasicMaterial color="#ff3300" transparent={true} opacity={0.35} depthWrite={false} />
        </mesh>

        {/* Inner Volumetric Shimmering Aura Shell (Inner Aura) */}
        <mesh ref={portalInnerAuraRef}>
          <sphereGeometry args={[0.75, 16, 16]} />
          <meshBasicMaterial color="#ff7700" transparent={true} opacity={0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>

        {/* Glowing Portal Horizon Core Beacon */}
        <mesh ref={portalInnerCoreRef}>
          <sphereGeometry args={[0.42, 16, 16]} />
          <meshBasicMaterial color="#ffe600" />
        </mesh>
      </group>

      {/* 6. GASEOUS NEBULA DEEP SPACE CLOUDS (Parallax Atmosphere) */}
      <group ref={nebulaeGroupRef}>
        {/* Nebula Cloud 1: Purple */}
        <NebulaCluster position={[120, 100, -120]} color="#bd00ff" size={35} opacity={0.038} />

        {/* Nebula Cloud 2: Cyan */}
        <NebulaCluster position={[-130, -95, 110]} color="#00f0ff" size={40} opacity={0.038} />

        {/* Nebula Cloud 3: Pink */}
        <NebulaCluster position={[140, -30, 130]} color="#ec4899" size={45} opacity={0.035} />

        {/* Nebula Cloud 4: Green */}
        <NebulaCluster position={[-120, 40, -140]} color="#00ff87" size={30} opacity={0.035} />

        {/* Nebula Cloud 5: Golden orange */}
        <NebulaCluster position={[0, 30, -180]} color="#ffa500" size={55} opacity={0.04} />
      </group>
    </group>
  );
}
