import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { TRAIL_ARC, arcPoint } from "../src/data/careerTrail";
import { arcPlacement } from "../src/utils/trailGuide";

describe("arcPlacement", () => {
  it("lays a RingGeometry's local arc exactly over the trail arc", () => {
    const { position, quaternion } = arcPlacement(TRAIL_ARC);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const th = TRAIL_ARC.span * t;
      const local = new THREE.Vector3(Math.cos(th) * TRAIL_ARC.radius, Math.sin(th) * TRAIL_ARC.radius, 0);
      const world = local.applyQuaternion(quaternion).add(position);
      expect(world.distanceTo(new THREE.Vector3(...arcPoint(TRAIL_ARC, t)))).toBeLessThan(1e-6);
    }
  });
});
