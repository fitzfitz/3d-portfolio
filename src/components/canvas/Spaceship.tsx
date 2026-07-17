import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useKeyboard } from "../../hooks/useKeyboard";
import { COSMIC_BOUNDS } from "../../App";

interface SpaceshipProps {
  onPositionUpdate: (pos: { x: number; z: number }) => void;
  onWarpStatus: (isWarping: boolean) => void;
  isOrbitLocked: boolean;
  onBoundaryWrap: () => void;
}

export default function Spaceship({
  onPositionUpdate,
  onWarpStatus,
  isOrbitLocked,
  onBoundaryWrap,
}: SpaceshipProps) {
  const { scene } = useGLTF("/models/spaceship.glb");
  
  // Programmatically lower the model's emissive strength to prevent blown-out white glows
  useMemo(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as any;
        if (mat.emissive) {
          mat.emissiveIntensity = 0.08;
        }
      }
    });
  }, [scene]);

  const keyboard = useKeyboard();
  
  // Physics states
  const pos = useRef(new THREE.Vector3(0, 0, 18));
  const vel = useRef(new THREE.Vector3(0, 0, 0));
  const angle = useRef(0); // Yaw angle
  const roll = useRef(0); // Roll angle for aesthetic bank turning
  const pitch = useRef(0); // Pitch angle for bobbing
  const turnVelocity = useRef(0);

  // Disengage orbit lock escape push
  useEffect(() => {
    if (!isOrbitLocked && pos.current.length() > 0.5) {
      // Push ship slightly backwards to escape the gravity well instantly
      const escapePush = new THREE.Vector3(
        -Math.sin(angle.current) * 2.8,
        0,
        -Math.cos(angle.current) * 2.8
      );
      pos.current.add(escapePush);
      vel.current.set(0, 0, 0);
    }
  }, [isOrbitLocked]);

  // Refs
  const shipRef = useRef<THREE.Group>(null);
  const thrusterRef = useRef<THREE.Mesh>(null);

  // Configuration settings
  const acceleration = 0.007;
  const maxSpeed = 0.18;
  const spaceDrag = 0.982; // Inertial space drift
  const turnSpeed = 0.04;
  const warpForce = 0.65;

  // Spawning local spark exhaust particles
  const particleCount = 20;
  const [particleGeometry, particleVelocities] = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(particleCount * 3);
    const vArr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      // Start in a cluster behind ship
      posArr[i * 3] = (Math.random() - 0.5) * 0.1;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
      posArr[i * 3 + 2] = -0.5 - Math.random() * 0.5;

      vArr[i * 3] = (Math.random() - 0.5) * 0.02;
      vArr[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      vArr[i * 3 + 2] = -0.05 - Math.random() * 0.05;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    return [geom, vArr];
  }, []);

  const particlesRef = useRef<THREE.Points>(null);
  const dustRef = useRef<THREE.Points>(null);

  // Space dust speed lines specks
  const dustCount = 80;
  const dustGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      posArr[i * 3] = (Math.random() - 0.5) * 8.0;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 6.0;
      posArr[i * 3 + 2] = (Math.random() - 0.5) * 10.0;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    return geom;
  }, []);

  useFrame((state) => {
    if (!shipRef.current) return;

    // If locked in orbit around a planet, disable piloting controls
    if (isOrbitLocked) {
      vel.current.set(0, 0, 0);
      roll.current = THREE.MathUtils.lerp(roll.current, 0, 0.1);
      shipRef.current.rotation.z = roll.current;
      
      // Let it orbit slowly
      const time = state.clock.getElapsedTime();
      shipRef.current.position.y = Math.sin(time * 2) * 0.05;
      
      // Scale down thruster glow
      if (thrusterRef.current) thrusterRef.current.scale.setScalar(0.1);
      return;
    }

    // 1. Steering & Banking Roll (Inertial turning physics)
    if (keyboard.left) {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, turnSpeed, 0.07);
      roll.current = THREE.MathUtils.lerp(roll.current, 0.42, 0.07); // bank left
    } else if (keyboard.right) {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, -turnSpeed, 0.07);
      roll.current = THREE.MathUtils.lerp(roll.current, -0.42, 0.07); // bank right
    } else {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, 0, 0.12);
      roll.current = THREE.MathUtils.lerp(roll.current, 0, 0.12); // level out
    }
    angle.current += turnVelocity.current;

    // 2. Warp Drive vs Forward Impulse
    const warpActive = keyboard.jump;
    onWarpStatus(warpActive);

    // Compute heading vector
    const headingX = Math.sin(angle.current);
    const headingZ = Math.cos(angle.current);

    if (warpActive) {
      // Warp speed burst
      vel.current.set(headingX * warpForce, 0, headingZ * warpForce);
    } else if (keyboard.forward) {
      // Standard thrust acceleration
      vel.current.x += headingX * acceleration;
      vel.current.z += headingZ * acceleration;
      
      // Cap max standard speed
      const speed = vel.current.length();
      if (speed > maxSpeed) {
        vel.current.normalize().multiplyScalar(maxSpeed);
      }
    } else if (keyboard.backward) {
      // Brake/reverse thrusters
      vel.current.multiplyScalar(0.92);
    }

    // Apply space friction
    vel.current.multiplyScalar(spaceDrag);

    // Apply pitch bobbing
    const time = state.clock.getElapsedTime();
    pitch.current = Math.sin(time * 2) * 0.03;

    // Apply velocity to positions
    pos.current.add(vel.current);

    // Cosmic boundary toroidal wrapping
    const bounds = COSMIC_BOUNDS;
    let didWrap = false;
    let wrapOffsetX = 0;
    let wrapOffsetZ = 0;

    if (pos.current.x > bounds) {
      pos.current.x = -bounds + 3;
      wrapOffsetX = -bounds * 2 + 3;
      didWrap = true;
    } else if (pos.current.x < -bounds) {
      pos.current.x = bounds - 3;
      wrapOffsetX = bounds * 2 - 3;
      didWrap = true;
    }

    if (pos.current.z > bounds) {
      pos.current.z = -bounds + 3;
      wrapOffsetZ = -bounds * 2 + 3;
      didWrap = true;
    } else if (pos.current.z < -bounds) {
      pos.current.z = bounds - 3;
      wrapOffsetZ = bounds * 2 - 3;
      didWrap = true;
    }

    if (didWrap) {
      // Instantly translate camera position to avoid glitched panning streaks
      state.camera.position.x += wrapOffsetX;
      state.camera.position.z += wrapOffsetZ;
      onBoundaryWrap();
    }

    // Write positions to mesh
    shipRef.current.position.copy(pos.current);
    shipRef.current.rotation.set(pitch.current, angle.current, roll.current);

    // 3. Scale thruster jet fire matching thrust levels
    if (thrusterRef.current) {
      const targetScale = warpActive ? 2.5 : keyboard.forward ? 1.4 : 0.4;
      thrusterRef.current.scale.y = THREE.MathUtils.lerp(thrusterRef.current.scale.y, targetScale, 0.2);
      thrusterRef.current.scale.x = THREE.MathUtils.lerp(thrusterRef.current.scale.x, warpActive ? 1.4 : 1.0, 0.2);
      thrusterRef.current.scale.z = thrusterRef.current.scale.x;
    }

    // 4. Animate exhaust particles
    if (particlesRef.current) {
      const attr = particlesRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        
        // Move particles backwards relative to velocities
        data[idx] += particleVelocities[idx];
        data[idx + 1] += particleVelocities[idx + 1];
        data[idx + 2] += particleVelocities[idx + 2];

        // If particle moves too far back, recycle it
        if (data[idx + 2] < -2.2) {
          data[idx] = (Math.random() - 0.5) * 0.15;
          data[idx + 1] = (Math.random() - 0.5) * 0.15;
          data[idx + 2] = -0.4;
        }
      }
      attr.needsUpdate = true;
    }

    // 4.5. Animate local space dust speed streaks
    if (dustRef.current) {
      const attr = dustRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;
      const speed = vel.current.length();
      
      // Speed factor along Z: if warp active, move super fast
      const zSpeed = warpActive ? 0.38 : 0.02 + speed * 1.5;

      for (let i = 0; i < dustCount; i++) {
        const idx = i * 3;
        // Move local particles backwards relative to spaceship heading
        // In local coordinates, positive Z is backwards
        data[idx + 2] += zSpeed;

        // If it drifts too far back (behind ship), recycle it in front
        if (data[idx + 2] > 5.0) {
          data[idx] = (Math.random() - 0.5) * 8.0;
          data[idx + 1] = (Math.random() - 0.5) * 6.0;
          data[idx + 2] = -5.0; // Reset way in front
        }
      }
      attr.needsUpdate = true;
    }
    const camDistance = warpActive ? 6.8 : isOrbitLocked ? 14.5 : 4.8;
    const camHeight = warpActive ? 2.8 : isOrbitLocked ? 5.2 : 1.8;
    const targetFov = warpActive ? 82 : isOrbitLocked ? 52 : 60;
    
    // Smoothly interpolate Camera FOV
    const perspCam = state.camera as THREE.PerspectiveCamera;
    if (perspCam.fov !== targetFov) {
      perspCam.fov = THREE.MathUtils.lerp(perspCam.fov, targetFov, 0.1);
      perspCam.updateProjectionMatrix();
    }

    const camOffset = new THREE.Vector3(
      -Math.sin(angle.current) * camDistance,
      camHeight,
      -Math.cos(angle.current) * camDistance
    );
    const targetCamPos = pos.current.clone().add(camOffset);
    state.camera.position.lerp(targetCamPos, 0.05);

    // Look slightly ahead of the ship
    const lookOffset = new THREE.Vector3(
      Math.sin(angle.current) * 1.5,
      0.2,
      Math.cos(angle.current) * 1.5
    );
    state.camera.lookAt(pos.current.clone().add(lookOffset));

    // Dispatch telemetry
    onPositionUpdate({ x: pos.current.x, z: pos.current.z });
  });

  return (
    <group ref={shipRef}>
      {/* 3D GLB Realistic Spaceship model */}
      <primitive object={scene} scale={0.35} rotation={[0, Math.PI, 0]} position={[0, -0.05, 0]} />

      {/* Twin Engine Thruster Cones (wrapped in single scaling group) */}
      <group ref={thrusterRef}>
        {/* Left Jet cone */}
        <mesh position={[-0.14, -0.04, -0.62]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.04, 0.22, 8]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.35} />
        </mesh>
        {/* Right Jet cone */}
        <mesh position={[0.14, -0.04, -0.62]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.04, 0.22, 8]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.35} />
        </mesh>
      </group>

      {/* Jet Sparks Exhaust particles */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <pointsMaterial
          color="#00f0ff"
          size={0.06}
          transparent={true}
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Ambient local space dust speed lines */}
      <points ref={dustRef} geometry={dustGeometry}>
        <pointsMaterial
          color="#00f0ff"
          size={0.038}
          transparent={true}
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Jet Core Light Source */}
      <pointLight position={[0, 0, -0.6]} color="#00f0ff" intensity={0.4} distance={1.2} />
    </group>
  );
}
