import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../utils/sceneAssets";
import PortalRing from "./PortalRing";
import { PORTAL_POS } from "../../constants";
import { DESTINATIONS } from "../../data/destinations";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { ambientTime } from "../../utils/ambientTime";
import { driftedHue } from "../../utils/nebulaHue";
import { setScannable } from "../../utils/scannables";
import { assetUrl } from "../../utils/assetUrl";
import { backdropDim } from "../../utils/sunLight";
import { LOG_DEPTH_FRAG, LOG_DEPTH_FRAG_PARS, LOG_DEPTH_VERT, LOG_DEPTH_VERT_PARS } from "./logDepth";

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
  ${LOG_DEPTH_VERT_PARS}
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${LOG_DEPTH_VERT}
  }
`;
const membraneFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  ${LOG_DEPTH_FRAG_PARS}
  void main() {
    ${LOG_DEPTH_FRAG}
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
      // Re-tint the material color with drifted hue, toned like the rest of
      // the unlit backdrop (sunLight.ts backdropScale).
      const mat = pointsRef.current.material as THREE.PointsMaterial;
      mat.color.setHSL(driftedHue(baseHSL.h * 360, time) / 360, baseHSL.s, baseHSL.l).multiplyScalar(backdropDim.value);
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
 * The contact portal, its destinations' scannables and docking, and the
 * nebulae. The bodies are SolarBodies'.
 */
export default function SpacePlanets() {
  const nebulaeGroupRef = useRef<THREE.Group>(null);
  const portalOuterAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerCoreRef = useRef<THREE.Mesh>(null);
  const portalFrameRef = useRef<THREE.Group>(null);

  // Load custom stargate portal gateway model
  const { scene: portalScene } = useModel(assetUrl("/models/portal_gateway.glb"));

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

  // Destinations are static; the bodies are re-registered every frame (updateBodies).
  useEffect(() => {
    for (const d of DESTINATIONS) setScannable(d.id, d.pos[0], d.pos[1], d.pos[2], d.scanLabel);
  }, []);

  // Proximity attraction logic
  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());

    // Spin Stargate Portal Frame infinitely
    if (portalFrameRef.current) {
      portalFrameRef.current.rotation.z = time * 0.08;
    }
    membraneMaterial.uniforms.uTime.value = time;

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
    // Only the destinations dock: the planets are solid, scan-only bodies
    // (project probes, spec §4.4; Spaceship's SOLID_BODIES collider).
    // Hysteresis: once locked onto a destination, retain the zone/lock at a
    // wider radius than the one that engaged it, so the orbit ring (which
    // sits further out than the engage threshold) doesn't immediately break
    // the lock it just entered — see tests/orbitInvariant.test.ts.
    const { isOrbitCooldown, isOrbitLocked: lockedNow, activeZone: zoneNow, setActiveZone, setOrbitLocked, photoMode } = useSpaceStore.getState();
    // Photo mode freezes the ship but bodies/scannables above keep orbiting.
    // Skip only the zone/lock writes here, so nothing breaks a lock (and
    // Spaceship's escape push jolts the ship) mid-photo — mirrors
    // Scanner.tsx:22's self-gate.
    if (photoMode) return;
    let activeZone: string | null = null;
    let lockActive = false;

    // Destinations (src/data/destinations.ts): fixed points with their own
    // radii, checked exactly as the portal always was.
    for (const d of DESTINATIONS) {
      const dist = Math.hypot(flight.x - d.pos[0], flight.z - d.pos[2], flight.y - d.pos[1]);
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
