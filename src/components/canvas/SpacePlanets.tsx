import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF, useTexture } from "@react-three/drei";
import PortalRing from "./PortalRing";
import Atmosphere, { LimbDarkening } from "./Atmosphere";
import CloudLayer from "./CloudLayer";
import {
  COSMIC_BOUNDS, PORTAL_POS, planets,
  ZONE_FACTOR, LOCK_ENGAGE_FACTOR, LOCK_RETAIN_FACTOR,
  PORTAL_ZONE_R, PORTAL_LOCK_R, PORTAL_RETAIN_R,
} from "../../constants";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { orbitPosition } from "../../utils/orbits";
import { ambientTime } from "../../utils/ambientTime";
import { toroidalDistance3 } from "../../utils/toroidal";
import { driftedHue } from "../../utils/nebulaHue";
import { setScannable } from "../../utils/scannables";
import { assetUrl } from "../../utils/assetUrl";

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

// Procedurally generated soft radial gradient sprite for gas clouds rendering
const nebulaTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.2, "rgba(255, 255, 255, 0.4)");
    grad.addColorStop(0.6, "rgba(255, 255, 255, 0.08)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
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
    float core = smoothstep(0.55, 0.0, r);
    vec3 col = mix(vec3(0.45, 0.05, 0.55), vec3(1.0, 0.25, 0.75), bands); // deep violet -> neon pink
    col = mix(col, vec3(1.0, 0.9, 0.6), core * (0.6 + bands * 0.4));       // white-hot center
    float alpha = (0.35 + bands * 0.5) * smoothstep(1.05, 0.8, r) + core * 0.5;
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
  const pointsCount = 45;
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
        size={size * 1.6} // Large soft overlapping particles
        transparent={true}
        opacity={opacity * 0.9} // Soft layering opacity
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

interface OrbitingMoonProps {
  distance: number; speed: number; inclination: number;
  size: number; color: string; phase?: number; spin?: number;
}

function OrbitingMoon({ distance, speed, inclination, size, color, phase = 0, spin = 0.15 }: OrbitingMoonProps) {
  const { scene } = useGLTF(assetUrl("/models/moon.glb"));
  const orbitRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, material } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.MeshStandardMaterial | undefined;
    scene.traverse((o) => {
      if (!g && o instanceof THREE.Mesh) { g = o.geometry; m = (o.material as THREE.MeshStandardMaterial).clone(); }
    });
    if (!g || !m) throw new Error("moon.glb contains no mesh");
    m.color.multiply(new THREE.Color(color)); // per-moon tint over the baked gray
    return { geometry: g, material: m };
  }, [scene, color]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    const t = ambientTime(state.clock.getElapsedTime());
    if (orbitRef.current) orbitRef.current.rotation.y = phase + t * speed;
    if (meshRef.current) meshRef.current.rotation.y = t * spin;
  });
  return (
    <group rotation={[inclination, 0, 0]}>
      <group ref={orbitRef}>
        <mesh ref={meshRef} position={[distance, 0, 0]} scale={size} geometry={geometry} material={material} />
      </group>
    </group>
  );
}

export default function SpacePlanets() {
  const saasPlanetRef = useRef<THREE.Mesh>(null);
  const videoPlanetRef = useRef<THREE.Mesh>(null);
  const agentPlanetRef = useRef<THREE.Mesh>(null);
  const planetGroupRefs = useRef<(THREE.Group | null)[]>([null, null, null]);
  const saasRingRef = useRef<THREE.Mesh>(null);
  /** Orbit-path ring materials, one per planet, for the opacity breathe. */
  const orbitRingMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const nebulaeGroupRef = useRef<THREE.Group>(null);
  const portalOuterAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerCoreRef = useRef<THREE.Mesh>(null);
  const portalFrameRef = useRef<THREE.Group>(null);

  // Load planet textures maps
  const [earthTex, jupiterTex, marsTex] = useTexture([
    assetUrl("/models/earth.webp"),
    assetUrl("/models/jupiter.webp"),
    assetUrl("/models/mars.webp")
  ]);

  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const tex of [earthTex, jupiterTex, marsTex]) {
      tex.anisotropy = maxAniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }, [earthTex, jupiterTex, marsTex, gl]);

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

  // Portal is static; planets are re-registered every frame (they orbit).
  useEffect(() => {
    setScannable("contact", PORTAL_POS[0], PORTAL_POS[1], PORTAL_POS[2], "PORTAL_SUN");
  }, []);

  // Proximity attraction logic
  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());

    // 0. Orbit drive: single writer of `bodies` (spec §3)
    planets.forEach((p, i) => {
      const pos = orbitPosition(p.orbit, time);
      const b = bodies[p.name];
      b.x = pos.x; b.y = pos.y; b.z = pos.z;
      const g = planetGroupRefs.current[i];
      if (g) g.position.set(pos.x, pos.y, pos.z);
      setScannable(p.name, pos.x, pos.y, pos.z, "PLANET_" + p.name.toUpperCase());
    });

    // 1. Slowly rotate planets
    if (saasPlanetRef.current) saasPlanetRef.current.rotation.y = time * 0.1;
    if (videoPlanetRef.current) videoPlanetRef.current.rotation.y = time * 0.3;
    if (agentPlanetRef.current) agentPlanetRef.current.rotation.y = time * 0.13;

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
      const mat = orbitRingMats.current[i];
      if (!mat) continue;
      const rate = planets[i].orbit.angularSpeed * ORBIT_RING_BREATH_MULT;
      mat.opacity = ORBIT_RING_OPACITY +
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
        if (dist < p.size * LOCK_ENGAGE_FACTOR && !isOrbitCooldown) lockActive = true;
      }
    });

    const portalDist = toroidalDistance3(flight.x, flight.z, flight.y, PORTAL_POS[0], PORTAL_POS[2], PORTAL_POS[1], COSMIC_BOUNDS);
    if (lockedNow && zoneNow === "contact") {
      if (portalDist < PORTAL_RETAIN_R) {
        activeZone = "contact";
        lockActive = true;
      }
    } else if (portalDist < PORTAL_ZONE_R) {
      activeZone = "contact";
      if (portalDist < PORTAL_LOCK_R && !isOrbitCooldown) lockActive = true;
    }

    setActiveZone(activeZone);
    setOrbitLocked(lockActive);
  });

  return (
    <group>
      {/* 1. SAAS PLANET (Neon Green, Rings) */}
      <group ref={(g) => { planetGroupRefs.current[0] = g; }}>
        {/* Planet Sphere */}
        <mesh ref={saasPlanetRef}>
          <sphereGeometry args={[planets[0].size, 32, 32]} />
          <meshStandardMaterial map={earthTex} roughness={0.5} metalness={0.0} />
        </mesh>
        <Atmosphere radius={planets[0].size} color="#6fd8ff" planetPos={bodies[planets[0].name]} intensity={1.2} />
        <CloudLayer radius={planets[0].size} tint="#ffffff" speed={0.168} />
        <OrbitingMoon distance={planets[0].size * 1.7} speed={0.4} inclination={0.45} size={0.5} color="#8fffc9" />

        {/* Glowing aura core */}
        <mesh scale={0.94}>
          <sphereGeometry args={[planets[0].size, 16, 16]} />
          <meshBasicMaterial color="#00ff87" transparent={true} opacity={0.06} />
        </mesh>

        {/* Orbit Grid Ring */}
        <mesh ref={saasRingRef} rotation={[Math.PI / 2.3, 0, 0]}>
          <ringGeometry args={[planets[0].size * 1.15, planets[0].size * 1.45, 64]} />
          <meshStandardMaterial color="#00ff87" emissive="#00ff87" emissiveIntensity={0.8} side={THREE.DoubleSide} transparent={true} opacity={0.35} />
        </mesh>

        {/* Proximity Gravity Field Dotted circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[planets[0].size * ZONE_FACTOR, planets[0].size * (ZONE_FACTOR + 0.04), 32]} />
          <meshBasicMaterial color="#00ff87" transparent={true} opacity={0.3} />
        </mesh>
        
        <pointLight color="#00ff87" intensity={0.6} distance={planets[0].size * 4.5} />
      </group>

      {/* 2. VIRAL VIDEO PLANET (Neon Cyan, Moon) */}
      <group ref={(g) => { planetGroupRefs.current[1] = g; }}>
        {/* Planet Sphere */}
        <mesh ref={videoPlanetRef}>
          <sphereGeometry args={[planets[1].size, 32, 32]} />
          <meshStandardMaterial map={jupiterTex} roughness={0.95} metalness={0.0} />
        </mesh>
        <LimbDarkening radius={planets[1].size} strength={0.8} />
        <Atmosphere radius={planets[1].size} color={planets[1].color} planetPos={bodies[planets[1].name]} intensity={0.55} thickness={1.06} />
        <OrbitingMoon distance={planets[1].size * 1.9} speed={-0.28} inclination={-0.3} size={0.42} color="#9be8ff" phase={2} />
        <OrbitingMoon distance={planets[1].size * 1.38} speed={0.5} inclination={0.1} size={0.55} color="#9be8ff" phase={4.2} />

        <mesh scale={0.94}>
          <sphereGeometry args={[planets[1].size, 16, 16]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.06} />
        </mesh>

        {/* Proximity Gravity Field Dotted circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[planets[1].size * ZONE_FACTOR, planets[1].size * (ZONE_FACTOR + 0.04), 32]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.3} />
        </mesh>

        <pointLight color="#00f0ff" intensity={0.6} distance={planets[1].size * 4.5} />
      </group>

      {/* 3. MULTI-AGENT PLANET (Neon Purple, Banded Grid Clouds) */}
      <group ref={(g) => { planetGroupRefs.current[2] = g; }}>
        {/* Planet Sphere */}
        <mesh ref={agentPlanetRef}>
          <sphereGeometry args={[planets[2].size, 32, 32]} />
          <meshStandardMaterial map={marsTex} roughness={0.95} metalness={0.0} />
        </mesh>
        <Atmosphere radius={planets[2].size} color="#e8b48a" planetPos={bodies[planets[2].name]} intensity={0.4} thickness={1.05} />
        <OrbitingMoon distance={planets[2].size * 1.6} speed={0.5} inclination={0.6} size={0.45} color="#e3b8ff" />
        <OrbitingMoon distance={planets[2].size * 2.1} speed={-0.22} inclination={-0.2} size={0.3} color="#caa2ff" phase={3.5} />

        <mesh scale={0.94}>
          <sphereGeometry args={[planets[2].size, 16, 16]} />
          <meshBasicMaterial color="#bd00ff" transparent={true} opacity={0.06} />
        </mesh>

        {/* Proximity Gravity Field Dotted circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[planets[2].size * ZONE_FACTOR, planets[2].size * (ZONE_FACTOR + 0.04), 32]} />
          <meshBasicMaterial color="#bd00ff" transparent={true} opacity={0.3} />
        </mesh>

        <pointLight color="#bd00ff" intensity={0.6} distance={planets[2].size * 4.5} />
      </group>

      {/* Faint orbit architecture: one inclined ring per planet (spec §3) */}
      {planets.map((p, i) => (
        <group key={`ring-${p.name}`} rotation={[0, p.orbit.node, 0]}>
          <group rotation={[p.orbit.inclination, 0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[p.orbit.radius - 0.15, p.orbit.radius + 0.15, 128]} />
              <meshBasicMaterial
                ref={(m: THREE.MeshBasicMaterial | null) => { orbitRingMats.current[i] = m; }}
                color={p.color} transparent={true} opacity={ORBIT_RING_OPACITY}
                side={THREE.DoubleSide} depthWrite={false} />
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
