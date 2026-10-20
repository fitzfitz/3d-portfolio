import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SOLAR_BODIES } from "../../data/solarSystem";
import { bodies } from "../../store/spaceStore";
import { DOT_PX, needsDot } from "../../utils/bodyDots";
import { exposureCompensation } from "../../utils/sunLight";

const DEG = Math.PI / 180;

/**
 * Far bodies as dots (spec §6.2, utils/bodyDots.ts): one Points, one vertex
 * per body, DOT_PX across at any range (no size attenuation), in the body's
 * colour. Each frame the bodies under 2 px across are packed to the front of
 * the buffers, written in place, and only they are drawn. Mounted after
 * SolarBodies, so it reads this frame's positions.
 *
 * The dot stands in for a disc too small to read, like the orbit lines it
 * sits on: an instrument mark, the same at every exposure (sunLight.ts
 * exposureCompensation, through the colour as for the Sun's glare sprites;
 * toneMapped false, so the low-perf renderer does not expose it either). It
 * is depth-tested, so a nearer world hides it.
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
      size: DOT_PX, sizeAttenuation: false, vertexColors: true, toneMapped: false,
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

  useFrame(({ camera, size }) => {
    const fov = (camera as THREE.PerspectiveCamera).fov * DEG;
    const c = camera.position;
    let k = 0;
    for (let i = 0; i < SOLAR_BODIES.length; i++) {
      const b = SOLAR_BODIES[i];
      const p = bodies[b.id];
      if (!needsDot(b.size, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z), fov, size.height)) continue;
      positions[k * 3] = p.x; positions[k * 3 + 1] = p.y; positions[k * 3 + 2] = p.z;
      colors[k * 3] = tints[i].r; colors[k * 3 + 1] = tints[i].g; colors[k * 3 + 2] = tints[i].b;
      k++;
    }
    const g = points.geometry;
    g.setDrawRange(0, k);
    if (k > 0) {
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }
    (points.material as THREE.PointsMaterial).color.setScalar(exposureCompensation.value);
  });

  return <primitive object={points} dispose={null} />;
}
