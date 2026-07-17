import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export default function HeroNodeNetwork() {
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  // Configuration parameters
  const particleCount = 60;
  const connectionDistance = 1.8;
  const mouseInfluenceRadius = 2.2;
  const mouseStrength = 0.6;

  // Generate initial node positions, original positions, and velocities
  const [positions, basePositions, velocities] = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const base = new Float32Array(particleCount * 3);
    const vel = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      // Create a sphere distribution or a box distribution
      const x = (Math.random() - 0.5) * 6;
      const y = (Math.random() - 0.5) * 5;
      const z = (Math.random() - 0.5) * 3;

      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;

      // Small random drift velocities
      vel[i * 3] = (Math.random() - 0.5) * 0.005;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.005;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.005;
    }

    return [pos, base, vel];
  }, []);

  // Set up lines buffers: max connections possible is N * (N - 1) / 2
  // We'll create a static size line geometry that we update dynamically
  const maxLineConnections = 150;
  const linePositions = useMemo(() => new Float32Array(maxLineConnections * 2 * 3), []);
  const lineColors = useMemo(() => new Float32Array(maxLineConnections * 2 * 3), []);

  useFrame((state) => {
    if (!pointsRef.current || !linesRef.current) return;

    const pointsGeometry = pointsRef.current.geometry;
    const pointsAttr = pointsGeometry.attributes.position;
    const time = state.clock.getElapsedTime();

    // Mouse coordinates in 3D space projection
    // We map state.pointer (-1 to 1) to a relative world space size
    const mouseX = state.pointer.x * 3.5;
    const mouseY = state.pointer.y * 2.5;
    const mouseVec = new THREE.Vector3(mouseX, mouseY, 0);

    // 1. Update node positions (drifting + floating + mouse interaction)
    for (let i = 0; i < particleCount; i++) {
      const idx = i * 3;

      // Apply periodic floating motion using sine/cosine
      const floatX = Math.sin(time * 0.5 + i) * 0.002;
      const floatY = Math.cos(time * 0.4 + i * 2) * 0.002;

      // Slowly update the base position with the drift velocity
      basePositions[idx] += velocities[idx];
      basePositions[idx + 1] += velocities[idx + 1];
      basePositions[idx + 2] += velocities[idx + 2];

      // Keep particles bounded
      if (Math.abs(basePositions[idx]) > 4) velocities[idx] *= -1;
      if (Math.abs(basePositions[idx + 1]) > 3) velocities[idx + 1] *= -1;
      if (Math.abs(basePositions[idx + 2]) > 2.5) velocities[idx + 2] *= -1;

      // Temporary Vector for calculation
      const currentPos = new THREE.Vector3(
        basePositions[idx] + floatX,
        basePositions[idx + 1] + floatY,
        basePositions[idx + 2]
      );

      // Mouse attraction / repulsion
      const distToMouse = currentPos.distanceTo(mouseVec);
      if (distToMouse < mouseInfluenceRadius) {
        const force = (1 - distToMouse / mouseInfluenceRadius) * mouseStrength;
        // Direction from node to mouse
        const dir = new THREE.Vector3().subVectors(mouseVec, currentPos).normalize();
        currentPos.addScaledVector(dir, force);
      }

      // Write back to geometry attribute
      pointsAttr.setXYZ(i, currentPos.x, currentPos.y, currentPos.z);
    }
    pointsAttr.needsUpdate = true;

    // 2. Re-calculate connection lines
    let lineIdx = 0;
    const positionsData = pointsAttr.array as Float32Array;

    for (let i = 0; i < particleCount && lineIdx < maxLineConnections; i++) {
      const p1 = new THREE.Vector3(
        positionsData[i * 3],
        positionsData[i * 3 + 1],
        positionsData[i * 3 + 2]
      );

      for (let j = i + 1; j < particleCount && lineIdx < maxLineConnections; j++) {
        const p2 = new THREE.Vector3(
          positionsData[j * 3],
          positionsData[j * 3 + 1],
          positionsData[j * 3 + 2]
        );

        const dist = p1.distanceTo(p2);

        if (dist < connectionDistance) {
          // Line start node
          linePositions[lineIdx * 6] = p1.x;
          linePositions[lineIdx * 6 + 1] = p1.y;
          linePositions[lineIdx * 6 + 2] = p1.z;

          // Line end node
          linePositions[lineIdx * 6 + 3] = p2.x;
          linePositions[lineIdx * 6 + 4] = p2.y;
          linePositions[lineIdx * 6 + 5] = p2.z;

          // Opacity of connection depends on distance (nearer = brighter)
          const alpha = 1.0 - dist / connectionDistance;

          // Color gradient: Neon Green (#00ff87) to Neon Cyan (#00f0ff)
          // Set start color
          lineColors[lineIdx * 6] = 0.0 * alpha; // R
          lineColors[lineIdx * 6 + 1] = 1.0 * alpha; // G
          lineColors[lineIdx * 6 + 2] = 0.5 * alpha; // B

          // Set end color
          lineColors[lineIdx * 6 + 3] = 0.0 * alpha;
          lineColors[lineIdx * 6 + 4] = 0.9 * alpha;
          lineColors[lineIdx * 6 + 5] = 1.0 * alpha;

          lineIdx++;
        }
      }
    }

    // Zero out unused connections so they don't render
    for (let k = lineIdx; k < maxLineConnections; k++) {
      for (let d = 0; d < 6; d++) {
        linePositions[k * 6 + d] = 0;
        lineColors[k * 6 + d] = 0;
      }
    }

    linesRef.current.geometry.attributes.position.needsUpdate = true;
    linesRef.current.geometry.attributes.color.needsUpdate = true;

    // Slow rotation of the whole setup
    pointsRef.current.rotation.y = time * 0.05;
    linesRef.current.rotation.y = time * 0.05;
  });

  return (
    <group>
      {/* Node Points */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
            count={particleCount}
            array={positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#00ff87"
          size={0.12}
          sizeAttenuation={true}
          transparent={true}
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Connection Lines */}
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
            count={maxLineConnections * 2}
            array={linePositions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[lineColors, 3]}
            count={maxLineConnections * 2}
            array={lineColors}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          vertexColors={true}
          transparent={true}
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          linewidth={1}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}
