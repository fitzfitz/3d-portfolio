import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF, Trail } from "@react-three/drei";
import { COSMIC_BOUNDS } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";

// Per-second physics constants (converted from the old per-frame@60fps values)
const ACCEL = 25.2;         // was 0.007/frame
const MAX_SPEED = 10.8;     // was 0.18/frame
const WARP_SPEED = 39;      // was 0.65/frame
const TURN_SPEED = 2.4;     // rad/s, was 0.04/frame
const SPACE_DRAG = 0.982;   // per-frame decay basis
const BRAKE = 0.92;         // per-frame decay basis

// Frame-rate independent lerp: equivalent to lerp(a, b, k) once per frame at 60fps.
const frameLerp = (k: number, dt: number) => 1 - Math.pow(1 - k, dt * 60);

export default function Spaceship() {
  const { scene } = useGLTF("/models/spaceship.glb");
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);

  useMemo(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissiveIntensity = 0.08;
      }
    });
  }, [scene]);

  const pos = useRef(new THREE.Vector3(0, 0, 18));
  const vel = useRef(new THREE.Vector3(0, 0, 0)); // units/second
  const angle = useRef(0);
  const roll = useRef(0);
  const pitch = useRef(0);
  const turnVelocity = useRef(0); // rad/second

  useEffect(() => {
    if (!isOrbitLocked && pos.current.length() > 0.5) {
      const escapePush = new THREE.Vector3(
        -Math.sin(angle.current) * 2.8, 0, -Math.cos(angle.current) * 2.8
      );
      pos.current.add(escapePush);
      vel.current.set(0, 0, 0);
    }
  }, [isOrbitLocked]);

  const shipRef = useRef<THREE.Group>(null);
  const thrusterRef = useRef<THREE.Group>(null);

  const particleCount = 20;
  const [particleGeometry, particleVelocities] = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(particleCount * 3);
    const vArr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
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

  const streakCount = 60;
  const streakGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(streakCount * 2 * 3);
    for (let i = 0; i < streakCount; i++) {
      const x = (Math.random() - 0.5) * 8.0;
      const y = (Math.random() - 0.5) * 6.0;
      const z = (Math.random() - 0.5) * 10.0;
      posArr.set([x, y, z, x, y, z - 0.05], i * 6);
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    return geom;
  }, []);
  const streaksRef = useRef<THREE.LineSegments>(null);

  useFrame((state, delta) => {
    if (!shipRef.current) return;
    const dt = Math.min(delta, 0.05); // clamp tab-switch spikes
    const store = useSpaceStore.getState();
    const input = flight.input;

    if (isOrbitLocked) {
      vel.current.set(0, 0, 0);
      roll.current = THREE.MathUtils.lerp(roll.current, 0, frameLerp(0.1, dt));
      shipRef.current.rotation.z = roll.current;
      shipRef.current.position.y = Math.sin(state.clock.getElapsedTime() * 2) * 0.05;
      if (thrusterRef.current) thrusterRef.current.scale.setScalar(0.1);
      return;
    }

    // 1. Steering: keyboard is full-rate, touch joystick is analog
    const steerInput = input.left ? 1 : input.right ? -1 : -input.steer;
    if (steerInput !== 0) {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, TURN_SPEED * steerInput, frameLerp(0.07, dt));
      roll.current = THREE.MathUtils.lerp(roll.current, 0.42 * steerInput, frameLerp(0.07, dt));
    } else {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, 0, frameLerp(0.12, dt));
      roll.current = THREE.MathUtils.lerp(roll.current, 0, frameLerp(0.12, dt));
    }
    angle.current += turnVelocity.current * dt;

    // 2. Warp vs impulse. Touch thrust is analog (0..1 forward, <0 brakes).
    const warpActive = input.boost;
    store.setWarping(warpActive);
    const thrustInput = input.forward ? 1 : Math.max(0, input.thrust);
    const braking = input.backward || input.thrust < -0.2;

    const headingX = Math.sin(angle.current);
    const headingZ = Math.cos(angle.current);

    if (warpActive) {
      vel.current.set(headingX * WARP_SPEED, 0, headingZ * WARP_SPEED);
    } else if (thrustInput > 0) {
      vel.current.x += headingX * ACCEL * thrustInput * dt;
      vel.current.z += headingZ * ACCEL * thrustInput * dt;
      if (vel.current.length() > MAX_SPEED) vel.current.normalize().multiplyScalar(MAX_SPEED);
    } else if (braking) {
      vel.current.multiplyScalar(Math.pow(BRAKE, dt * 60));
    }
    vel.current.multiplyScalar(Math.pow(SPACE_DRAG, dt * 60));

    const time = state.clock.getElapsedTime();
    pitch.current = Math.sin(time * 2) * 0.03;

    pos.current.x += vel.current.x * dt;
    pos.current.z += vel.current.z * dt;

    // Toroidal boundary wrap
    const bounds = COSMIC_BOUNDS;
    let wrapOffsetX = 0, wrapOffsetZ = 0, didWrap = false;
    if (pos.current.x > bounds) { pos.current.x = -bounds + 3; wrapOffsetX = -bounds * 2 + 3; didWrap = true; }
    else if (pos.current.x < -bounds) { pos.current.x = bounds - 3; wrapOffsetX = bounds * 2 - 3; didWrap = true; }
    if (pos.current.z > bounds) { pos.current.z = -bounds + 3; wrapOffsetZ = -bounds * 2 + 3; didWrap = true; }
    else if (pos.current.z < -bounds) { pos.current.z = bounds - 3; wrapOffsetZ = bounds * 2 - 3; didWrap = true; }
    if (didWrap) {
      state.camera.position.x += wrapOffsetX;
      state.camera.position.z += wrapOffsetZ;
      store.triggerTeleportFlash();
    }

    shipRef.current.position.copy(pos.current);
    shipRef.current.rotation.set(pitch.current, angle.current, roll.current);

    // 3. Thruster scale
    if (thrusterRef.current) {
      const targetScale = warpActive ? 2.5 : thrustInput > 0 ? 1.4 : 0.4;
      thrusterRef.current.scale.y = THREE.MathUtils.lerp(thrusterRef.current.scale.y, targetScale, frameLerp(0.2, dt));
      thrusterRef.current.scale.x = THREE.MathUtils.lerp(thrusterRef.current.scale.x, warpActive ? 1.4 : 1.0, frameLerp(0.2, dt));
      thrusterRef.current.scale.z = thrusterRef.current.scale.x;
    }

    // 4. Exhaust particles (velocities were per-frame — scale by dt*60)
    if (particlesRef.current) {
      const attr = particlesRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;
      const step = dt * 60;
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        data[idx] += particleVelocities[idx] * step;
        data[idx + 1] += particleVelocities[idx + 1] * step;
        data[idx + 2] += particleVelocities[idx + 2] * step;
        if (data[idx + 2] < -2.2) {
          data[idx] = (Math.random() - 0.5) * 0.15;
          data[idx + 1] = (Math.random() - 0.5) * 0.15;
          data[idx + 2] = -0.4;
        }
      }
      attr.needsUpdate = true;
    }

    // 4.5. Local dust streaks
    if (streaksRef.current) {
      const attr = streaksRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;
      const speed = vel.current.length();
      const zSpeed = (warpActive ? 0.38 : 0.02 + (speed / 60) * 1.5) * dt * 60;
      const stretch = warpActive ? 2.2 : Math.min(0.6, 0.05 + speed * 0.04);
      for (let i = 0; i < streakCount; i++) {
        const head = i * 6;
        data[head + 2] += zSpeed;
        if (data[head + 2] > 5.0) {
          data[head] = (Math.random() - 0.5) * 8.0;
          data[head + 1] = (Math.random() - 0.5) * 6.0;
          data[head + 2] = -5.0;
        }
        data[head + 3] = data[head];
        data[head + 4] = data[head + 1];
        data[head + 5] = data[head + 2] - stretch;
      }
      attr.needsUpdate = true;
    }

    // 5. Camera follow + FOV
    const camDistance = warpActive ? 6.8 : 4.8;
    const camHeight = warpActive ? 2.8 : 1.8;
    const targetFov = warpActive ? 86 : 60;
    const perspCam = state.camera as THREE.PerspectiveCamera;
    if (Math.abs(perspCam.fov - targetFov) > 0.01) {
      perspCam.fov = THREE.MathUtils.lerp(perspCam.fov, targetFov, frameLerp(0.1, dt));
      perspCam.updateProjectionMatrix();
    }
    const camOffset = new THREE.Vector3(
      -Math.sin(angle.current) * camDistance, camHeight, -Math.cos(angle.current) * camDistance
    );
    const targetCamPos = pos.current.clone().add(camOffset);
    state.camera.position.lerp(targetCamPos, frameLerp(0.05, dt));
    const lookOffset = new THREE.Vector3(Math.sin(angle.current) * 1.5, 0.2, Math.cos(angle.current) * 1.5);
    state.camera.lookAt(pos.current.clone().add(lookOffset));

    // 6. Publish telemetry (mutable — no React involvement)
    flight.x = pos.current.x;
    flight.z = pos.current.z;
    flight.speed = vel.current.length();
    store.setNearSpawn(Math.abs(pos.current.x) < 0.6 && Math.abs(pos.current.z - 18) < 0.6);
  });

  return (
    <group ref={shipRef}>
      <primitive object={scene} scale={0.35} rotation={[0, Math.PI, 0]} position={[0, -0.05, 0]} />
      <group ref={thrusterRef}>
        <mesh position={[-0.14, -0.04, -0.62]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.04, 0.22, 8]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.35} />
        </mesh>
        <mesh position={[0.14, -0.04, -0.62]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.04, 0.22, 8]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.35} />
        </mesh>
      </group>
      <Trail
        width={1.4}
        length={5}
        color="#00f0ff"
        attenuation={(t) => t * t}
      >
        <mesh position={[0, -0.04, -0.6]}>
          <sphereGeometry args={[0.02, 4, 4]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </Trail>
      <points ref={particlesRef} geometry={particleGeometry}>
        <pointsMaterial color="#00f0ff" size={0.06} transparent={true} opacity={0.8}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <lineSegments ref={streaksRef} geometry={streakGeometry}>
        <lineBasicMaterial color="#00f0ff" transparent={true} opacity={0.5}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <pointLight position={[0, 0, -0.6]} color="#00f0ff" intensity={0.4} distance={1.2} />
    </group>
  );
}
