import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { gameTime } from "../../utils/ambientTime";

const POOL = 4;
const SPAWN_MIN = 4;   // seconds
const SPAWN_SPAN = 8;  // spawn interval = 4-12s
const MAX_CONCURRENT = 2;

interface Meteor {
  active: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
  ttl: number;
}

/** Pooled meteor streaks on the far sphere. Parent must gate on !isLowPerf. */
export default function ShootingStars() {
  const linesRef = useRef<THREE.LineSegments>(null);
  const nextSpawn = useRef(2);

  const { geometry, meteors } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POOL * 6), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(POOL * 6), 3));
    const m: Meteor[] = Array.from({ length: POOL }, () => ({
      active: false,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      speed: 0,
      age: 0,
      ttl: 0,
    }));
    return { geometry: geom, meteors: m };
  }, []);

  useFrame((state, delta) => {
    if (!linesRef.current) return;
    const dt = Math.min(delta, 0.05);
    // nextSpawn is an absolute deadline stored from an earlier frame, so it
    // must survive a THREE.Clock reset (Task 6's dossier freeze) the same way
    // Spaceship's warp suppression/impact debounce do — see
    // utils/ambientTime.ts's gameTime() doc comment.
    const t = gameTime(state.clock.getElapsedTime());

    // Spawner
    if (t > nextSpawn.current) {
      nextSpawn.current = t + SPAWN_MIN + Math.random() * SPAWN_SPAN;
      const activeCount = meteors.filter((m) => m.active).length;
      const slot = meteors.find((m) => !m.active);
      if (slot && activeCount < MAX_CONCURRENT) {
        // Random point on a far sphere around the camera, moving along a random tangent
        const dir = new THREE.Vector3().randomDirection();
        slot.pos.copy(state.camera.position).addScaledVector(dir, 190);
        slot.dir.copy(dir).cross(new THREE.Vector3().randomDirection()).normalize();
        slot.speed = 120 + Math.random() * 80;
        slot.age = 0;
        slot.ttl = 0.8 + Math.random() * 0.6;
        slot.active = true;
      }
    }

    // Update
    const posAttr = linesRef.current.geometry.attributes.position;
    const colAttr = linesRef.current.geometry.attributes.color;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;
    meteors.forEach((m, i) => {
      const o = i * 6;
      if (!m.active) {
        col.fill(0, o, o + 6); // black = invisible with additive blending
        return;
      }
      m.age += dt;
      if (m.age >= m.ttl) { m.active = false; return; }
      m.pos.addScaledVector(m.dir, m.speed * dt);
      const tailLen = 6 + m.speed * 0.06;
      pos[o] = m.pos.x; pos[o + 1] = m.pos.y; pos[o + 2] = m.pos.z;
      pos[o + 3] = m.pos.x - m.dir.x * tailLen;
      pos[o + 4] = m.pos.y - m.dir.y * tailLen;
      pos[o + 5] = m.pos.z - m.dir.z * tailLen;
      // Fade in fast, fade out over life: brightness IS alpha under additive blending
      const life = m.age / m.ttl;
      const bright = Math.min(1, life * 6) * (1 - life);
      col[o] = bright; col[o + 1] = bright; col[o + 2] = bright;         // white head
      col[o + 3] = 0; col[o + 4] = bright * 0.5; col[o + 5] = bright * 0.6; // teal tail
    });
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  return (
    <lineSegments ref={linesRef} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        vertexColors={true}
        transparent={true}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </lineSegments>
  );
}
