import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useKeyboard } from "../../hooks/useKeyboard";

interface VehicleProps {
  vehicleType: "car" | "drone";
  onPositionUpdate: (pos: { x: number; z: number }) => void;
}

export default function Vehicle({ vehicleType, onPositionUpdate }: VehicleProps) {
  const keyboard = useKeyboard();
  
  // Physics Refs
  const pos = useRef(new THREE.Vector3(0, 0, 0));
  const velocity = useRef(0);
  const angle = useRef(0); // rotation angle around Y
  const verticalVelocity = useRef(0);
  const isJumping = useRef(false);

  // Mesh Refs
  const vehicleRef = useRef<THREE.Group>(null);
  const leftWheelRef = useRef<THREE.Mesh>(null);
  const rightWheelRef = useRef<THREE.Mesh>(null);

  // Configurations
  const maxSpeed = vehicleType === "drone" ? 0.22 : 0.16;
  const acceleration = vehicleType === "drone" ? 0.006 : 0.01;
  const friction = vehicleType === "drone" ? 0.96 : 0.88; // Drone drifts more
  const turnSpeed = vehicleType === "drone" ? 0.045 : 0.038;

  // Reset vehicle position when theme changes
  useEffect(() => {
    pos.current.set(0, 0, 0);
    velocity.current = 0;
    angle.current = 0;
    verticalVelocity.current = 0;
    isJumping.current = false;
  }, [vehicleType]);

  useFrame((state) => {
    if (!vehicleRef.current) return;

    // 1. Steering & Acceleration
    if (keyboard.forward) {
      velocity.current = Math.min(velocity.current + acceleration, maxSpeed);
    } else if (keyboard.backward) {
      velocity.current = Math.max(velocity.current - acceleration, -maxSpeed * 0.5);
    } else {
      // Apply sliding friction
      velocity.current *= friction;
    }

    if (keyboard.left) {
      angle.current += turnSpeed * (velocity.current >= 0 ? 1 : -1);
    }
    if (keyboard.right) {
      angle.current -= turnSpeed * (velocity.current >= 0 ? 1 : -1);
    }

    // 2. Jumping Physics
    if (keyboard.jump && !isJumping.current) {
      verticalVelocity.current = 0.15;
      isJumping.current = true;
    }

    if (isJumping.current) {
      verticalVelocity.current -= 0.008; // Gravity
      pos.current.y += verticalVelocity.current;

      // Hit the ground
      if (pos.current.y <= 0) {
        pos.current.y = 0;
        verticalVelocity.current = 0;
        isJumping.current = false;
      }
    } else if (vehicleType === "drone") {
      // Elegant hovering float bobbing
      const time = state.clock.getElapsedTime();
      pos.current.y = 0.35 + Math.sin(time * 3) * 0.08;
    }

    // 3. Move along steering vector
    const dx = Math.sin(angle.current) * velocity.current;
    const dz = Math.cos(angle.current) * velocity.current;

    pos.current.x += dx;
    pos.current.z += dz;

    // Workspace Boundaries: lock coordinates
    pos.current.x = Math.max(-18, Math.min(18, pos.current.x));
    pos.current.z = Math.max(-18, Math.min(18, pos.current.z));

    // Update physical mesh
    vehicleRef.current.position.copy(pos.current);
    vehicleRef.current.rotation.y = angle.current;

    // 4. Wheels rotation (if Toy Car)
    if (vehicleType === "car") {
      if (leftWheelRef.current && rightWheelRef.current) {
        const wheelRot = state.clock.getElapsedTime() * velocity.current * 10;
        leftWheelRef.current.rotation.x = wheelRot;
        rightWheelRef.current.rotation.x = wheelRot;
      }
    }

    // 5. Spring Follow Camera tracking
    const cameraDistance = vehicleType === "drone" ? 5.5 : 4.8;
    const cameraHeight = vehicleType === "drone" ? 3.0 : 2.2;
    
    // Position camera offset behind the vehicle facing direction
    const camOffset = new THREE.Vector3(
      -Math.sin(angle.current) * cameraDistance,
      cameraHeight,
      -Math.cos(angle.current) * cameraDistance
    );
    
    const targetCamPos = pos.current.clone().add(camOffset);
    state.camera.position.lerp(targetCamPos, 0.08);

    // Look slightly above the vehicle center
    const lookTarget = pos.current.clone().add(new THREE.Vector3(0, 0.5, 0));
    state.camera.lookAt(lookTarget);

    // Dispatch coordinates to DOM triggers
    onPositionUpdate({ x: pos.current.x, z: pos.current.z });
  });

  return (
    <group ref={vehicleRef}>
      {vehicleType === "car" ? (
        // ------------------ TOY CAR MESH ------------------
        <group>
          {/* Main Car Body Chassis */}
          <mesh castShadow={true}>
            <boxGeometry args={[0.8, 0.35, 1.2]} />
            <meshStandardMaterial color="#00ff87" roughness={0.2} metalness={0.1} />
          </mesh>

          {/* Cabin */}
          <mesh position={[0, 0.28, -0.1]} castShadow={true}>
            <boxGeometry args={[0.6, 0.25, 0.6]} />
            <meshPhysicalMaterial
              color="#00f0ff"
              transmission={0.6}
              opacity={0.8}
              transparent={true}
              roughness={0.1}
            />
          </mesh>

          {/* Front Headlights */}
          <mesh position={[0.25, -0.05, 0.605]}>
            <boxGeometry args={[0.15, 0.1, 0.02]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[-0.25, -0.05, 0.605]}>
            <boxGeometry args={[0.15, 0.1, 0.02]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>

          {/* Front headlights spotlights */}
          <spotLight
            position={[0, 0, 0.6]}
            angle={Math.PI / 6}
            penumbra={0.5}
            intensity={1.5}
            color="#ffffff"
            distance={6}
          />

          {/* Rolling Wheels (Left & Right hubs) */}
          <mesh ref={leftWheelRef} position={[-0.45, -0.12, 0.35]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.1, 16]} />
            <meshStandardMaterial color="#111115" roughness={0.8} />
          </mesh>
          <mesh ref={rightWheelRef} position={[0.45, -0.12, 0.35]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.1, 16]} />
            <meshStandardMaterial color="#111115" roughness={0.8} />
          </mesh>
          {/* Back Wheels */}
          <mesh position={[-0.45, -0.12, -0.35]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.1, 16]} />
            <meshStandardMaterial color="#111115" roughness={0.8} />
          </mesh>
          <mesh position={[0.45, -0.12, -0.35]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.1, 16]} />
            <meshStandardMaterial color="#111115" roughness={0.8} />
          </mesh>
        </group>
      ) : (
        // ------------------ ANTI-GRAVITY HOVER DRONE MESH ------------------
        <group>
          {/* Central Core Sphere */}
          <mesh castShadow={true}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial color="#bd00ff" emissive="#bd00ff" emissiveIntensity={0.2} metalness={0.8} roughness={0.1} />
          </mesh>

          {/* Flying Wings Side Rings */}
          <mesh position={[-0.48, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.22, 0.03, 8, 32]} />
            <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.8} wireframe={true} />
          </mesh>
          <mesh position={[0.48, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.22, 0.03, 8, 32]} />
            <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.8} wireframe={true} />
          </mesh>

          {/* Under-glow jet propulsion ring */}
          <mesh position={[0, -0.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0, 0.18, 16]} />
            <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.8} />
          </mesh>

          {/* Local spotlight beam */}
          <spotLight
            position={[0, -0.1, 0]}
            angle={Math.PI / 5}
            penumbra={0.8}
            intensity={2}
            color="#00f0ff"
            distance={3.5}
          />
        </group>
      )}
    </group>
  );
}
