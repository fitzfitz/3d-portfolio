import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF, useTexture } from "@react-three/drei";
import PortalRing from "./PortalRing";
import Atmosphere from "./Atmosphere";
import CloudLayer from "./CloudLayer";
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { toroidalDistance } from "../../utils/toroidal";

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

  // Animate the buffer geometry positions inside useFrame
  useFrame((state) => {
    const time = state.clock.getElapsedTime();
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
    }
  });

  const initialPositions = useMemo(() => new Float32Array(pointsCount * 3), []);

  return (
    <points position={position} ref={pointsRef}>
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

export default function SpacePlanets() {
  const saasPlanetRef = useRef<THREE.Mesh>(null);
  const videoPlanetRef = useRef<THREE.Mesh>(null);
  const agentPlanetRef = useRef<THREE.Mesh>(null);
  const videoMoonRef = useRef<THREE.Group>(null);
  const saasRingRef = useRef<THREE.Mesh>(null);
  const nebulaeGroupRef = useRef<THREE.Group>(null);
  const portalOuterAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerAuraRef = useRef<THREE.Mesh>(null);
  const portalInnerCoreRef = useRef<THREE.Mesh>(null);
  const portalFrameRef = useRef<THREE.Group>(null);
  const sunPlanetRef = useRef<THREE.Mesh>(null);

  // Load planet textures maps
  const [earthTex, jupiterTex, marsTex] = useTexture([
    "/models/earth.webp",
    "/models/jupiter.webp",
    "/models/mars.webp"
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
  const { scene: portalScene } = useGLTF("/models/portal_gateway.glb");

  // Proximity attraction logic
  useFrame((state) => {
    const time = state.clock.getElapsedTime();

    // 1. Slowly rotate planets & Sun
    if (saasPlanetRef.current) saasPlanetRef.current.rotation.y = time * 0.12;
    if (videoPlanetRef.current) videoPlanetRef.current.rotation.y = time * 0.08;
    if (agentPlanetRef.current) agentPlanetRef.current.rotation.y = time * 0.16;
    if (sunPlanetRef.current) sunPlanetRef.current.rotation.y = time * 0.03;

    // Spin Stargate Portal Frame infinitely
    if (portalFrameRef.current) {
      portalFrameRef.current.rotation.z = time * 0.08;
    }

    // Rotate accessories
    if (saasRingRef.current) saasRingRef.current.rotation.z = -time * 0.06;
    if (videoMoonRef.current) videoMoonRef.current.rotation.y = time * 0.5;
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

    // 2. Proximity: read mutable telemetry, write store only on change
    const { isOrbitCooldown, setActiveZone, setOrbitLocked } = useSpaceStore.getState();
    let activeZone: string | null = null;
    let lockActive = false;

    planets.forEach((p) => {
      const dist = toroidalDistance(flight.x, flight.z, p.pos[0], p.pos[2], COSMIC_BOUNDS);
      if (dist < p.size * 1.8) {
        activeZone = p.name;
        if (dist < p.size * 1.3 && !isOrbitCooldown) lockActive = true;
      }
    });

    const portalDist = toroidalDistance(flight.x, flight.z, PORTAL_POS[0], PORTAL_POS[2], COSMIC_BOUNDS);
    if (portalDist < 2.2) {
      activeZone = "contact";
      if (portalDist < 1.5 && !isOrbitCooldown) lockActive = true;
    }

    setActiveZone(activeZone);
    setOrbitLocked(lockActive);
  });

  return (
    <group>
      {/* 1. SAAS PLANET (Neon Green, Rings) */}
      <group position={planets[0].pos}>
        {/* Planet Sphere */}
        <mesh ref={saasPlanetRef} castShadow={true}>
          <sphereGeometry args={[planets[0].size, 32, 32]} />
          <meshStandardMaterial
            map={earthTex}
            roughness={0.25}
            metalness={0.8}
            emissive="#00ff87"
            emissiveIntensity={0.3}
          />
        </mesh>
        <Atmosphere radius={planets[0].size} color={planets[0].color} />
        <CloudLayer radius={planets[0].size} tint="#ffffff" speed={0.168} />

        {/* Glowing aura core */}
        <mesh scale={0.94}>
          <sphereGeometry args={[planets[0].size, 16, 16]} />
          <meshBasicMaterial color="#00ff87" transparent={true} opacity={0.2} />
        </mesh>

        {/* Orbit Grid Ring */}
        <mesh ref={saasRingRef} rotation={[Math.PI / 2.3, 0, 0]}>
          <ringGeometry args={[planets[0].size * 1.15, planets[0].size * 1.45, 64]} />
          <meshStandardMaterial color="#00ff87" emissive="#00ff87" emissiveIntensity={0.8} side={THREE.DoubleSide} transparent={true} opacity={0.35} />
        </mesh>

        {/* Proximity Gravity Field Dotted circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[planets[0].size * 1.8, planets[0].size * 1.84, 32]} />
          <meshBasicMaterial color="#00ff87" transparent={true} opacity={0.3} />
        </mesh>
        
        <pointLight color="#00ff87" intensity={2.5} distance={planets[0].size * 4.5} />
      </group>

      {/* 2. VIRAL VIDEO PLANET (Neon Cyan, Moon) */}
      <group position={planets[1].pos}>
        {/* Planet Sphere */}
        <mesh ref={videoPlanetRef} castShadow={true}>
          <sphereGeometry args={[planets[1].size, 32, 32]} />
          <meshStandardMaterial
            map={jupiterTex}
            roughness={0.3}
            metalness={0.7}
            emissive="#00f0ff"
            emissiveIntensity={0.3}
          />
        </mesh>
        <Atmosphere radius={planets[1].size} color={planets[1].color} />
        <CloudLayer radius={planets[1].size} tint="#bff5ff" speed={0.112} />

        <mesh scale={0.94}>
          <sphereGeometry args={[planets[1].size, 16, 16]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.25} />
        </mesh>

        {/* Orbital group for Moon */}
        <group ref={videoMoonRef}>
          <mesh position={[planets[1].size * 1.38, 0, 0]} castShadow={true}>
            <sphereGeometry args={[planets[1].size * 0.12, 8, 8]} />
            <meshStandardMaterial color="#00f0ff" emissive="#00f0ff" emissiveIntensity={0.8} />
          </mesh>
        </group>

        {/* Proximity Gravity Field Dotted circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[planets[1].size * 1.8, planets[1].size * 1.84, 32]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.3} />
        </mesh>

        <pointLight color="#00f0ff" intensity={2.5} distance={planets[1].size * 4.5} />
      </group>

      {/* 3. MULTI-AGENT PLANET (Neon Purple, Banded Grid Clouds) */}
      <group position={planets[2].pos}>
        {/* Planet Sphere */}
        <mesh ref={agentPlanetRef} castShadow={true}>
          <sphereGeometry args={[planets[2].size, 32, 32]} />
          <meshStandardMaterial
            map={marsTex}
            roughness={0.4}
            metalness={0.6}
            emissive="#bd00ff"
            emissiveIntensity={0.3}
          />
        </mesh>
        <Atmosphere radius={planets[2].size} color={planets[2].color} />
        <CloudLayer radius={planets[2].size} tint="#ffd9c2" speed={0.224} />

        <mesh scale={0.94}>
          <sphereGeometry args={[planets[2].size, 16, 16]} />
          <meshBasicMaterial color="#bd00ff" transparent={true} opacity={0.2} />
        </mesh>

        {/* Proximity Gravity Field Dotted circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[planets[2].size * 1.8, planets[2].size * 1.84, 32]} />
          <meshBasicMaterial color="#bd00ff" transparent={true} opacity={0.3} />
        </mesh>

        <pointLight color="#bd00ff" intensity={2.5} distance={planets[2].size * 4.5} />
      </group>

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

      {/* 5. CENTRAL SOL SUN (at 0, 0, 0) */}
      <group position={[0, 0, 0]}>
        {/* Core sphere */}
        <mesh ref={sunPlanetRef}>
          <sphereGeometry args={[2.5, 32, 32]} />
          <meshStandardMaterial color="#ff5500" emissive="#ff3300" emissiveIntensity={3.2} roughness={0.15} metalness={0.1} />
        </mesh>
        
        {/* Strong point light acting as solar light for system */}
        <pointLight color="#ffffff" intensity={4.8} distance={260} decay={0.8} castShadow={true} />
      </group>

      {/* 6. GASEOUS NEBULA DEEP SPACE CLOUDS (Parallax Atmosphere) */}
      <group ref={nebulaeGroupRef}>
        {/* Nebula Cloud 1: Purple */}
        <NebulaCluster position={[120, -10, -120]} color="#bd00ff" size={35} opacity={0.038} />
        
        {/* Nebula Cloud 2: Cyan */}
        <NebulaCluster position={[-130, 20, 110]} color="#00f0ff" size={40} opacity={0.038} />

        {/* Nebula Cloud 3: Pink */}
        <NebulaCluster position={[140, -30, 130]} color="#ec4899" size={45} opacity={0.035} />

        {/* Nebula Cloud 4: Green */}
        <NebulaCluster position={[-120, -20, -140]} color="#00ff87" size={30} opacity={0.035} />

        {/* Nebula Cloud 5: Golden orange */}
        <NebulaCluster position={[0, 30, -180]} color="#ffa500" size={55} opacity={0.04} />
      </group>
    </group>
  );
}
