import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SOLAR_BODIES } from "../../data/solarSystem";
import { bodies } from "../../store/spaceStore";
import { DOT_PX, dotColor, dotPosition, needsDot } from "../../utils/bodyDots";

const DEG = Math.PI / 180;

/**
 * Far bodies as dots (spec §6.2, utils/bodyDots.ts): one Points, one vertex
 * per body, DOT_PX across at any range (no size attenuation). Each frame the bodies under 2 px across are packed to the front of
 * the buffers, written in place, and only they are drawn. Mounted after
 * SolarBodies, so it reads this frame's positions.
 *
 * The dot is the body's light, not a HUD mark (ruling R25, the spec's "sunlit
 * colour"): its colour × the sunlight at its live distance from the Sun ×
 * the Lambert phase seen from the camera (utils/bodyDots.ts dotColor). Lit
 * matter, so the camera exposure acts on it as on the body: the composer's
 * pass exposes it, and in low-perf the renderer does (toneMapped). It is
 * depth-tested, so a nearer world hides it, and stands just off its body's
 * near limb (dotPosition), so its own sub-pixel sphere never does.
 */
export default function BodyDots() {
  const { points, positions, colors, tints } = useMemo(() => {
    const n = SOLAR_BODIES.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      size: DOT_PX, sizeAttenuation: false, vertexColors: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = "BodyDots";
    // The vertices move every frame and are not where the bounds say.
    points.frustumCulled = false;
    // Not a pick target: Points' default threshold picks a whole unit around each vertex.
    points.raycast = () => {};
    const tints = SOLAR_BODIES.map((b) => new THREE.Color(b.color));
    return { points, positions, colors, tints };
  }, []);
  useEffect(() => () => {
    points.geometry.dispose();
    (points.material as THREE.Material).dispose();
  }, [points]);

  const at = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const lit = useMemo(() => ({ r: 0, g: 0, b: 0 }), []);
  useFrame(({ camera, size }) => {
    const fov = (camera as THREE.PerspectiveCamera).fov * DEG;
    const c = camera.position;
    let k = 0;
    for (let i = 0; i < SOLAR_BODIES.length; i++) {
      const b = SOLAR_BODIES[i];
      const p = bodies[b.id];
      if (!needsDot(b.size, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z), fov, size.height)) continue;
      dotPosition(p, b.size, c, at);
      dotColor(tints[i], p, c, lit);
      positions[k * 3] = at.x; positions[k * 3 + 1] = at.y; positions[k * 3 + 2] = at.z;
      colors[k * 3] = lit.r; colors[k * 3 + 1] = lit.g; colors[k * 3 + 2] = lit.b;
      k++;
    }
    const g = points.geometry;
    g.setDrawRange(0, k);
    if (k > 0) {
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }
  });

  return <primitive object={points} dispose={null} />;
}
