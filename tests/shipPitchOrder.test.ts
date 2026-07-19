import { describe, it, expect } from "vitest";
import * as THREE from "three";

// Regression: ship rotation must use YXZ euler order. With the default XYZ,
// pitch (rotation.x) stops lifting the nose as heading approaches ±90° and
// turns into roll instead — the ship visibly refuses to tilt up/down when
// flying east/west. Nose = local +Z (model is flipped 180° inside the group).
const NOSE = new THREE.Vector3(0, 0, 1);

describe("ship pitch euler order", () => {
  it("YXZ keeps pitch lifting the nose at 90-degree headings", () => {
    const noseUpPitch = -0.3; // climbing: rotation.x = -flight.pitch < 0
    const e = new THREE.Euler(noseUpPitch, Math.PI / 2, 0, "YXZ");
    const nose = NOSE.clone().applyEuler(e);
    expect(nose.y).toBeGreaterThan(0.25); // nose genuinely points up
  });
  it("documents why XYZ was wrong: pitch vanishes at 90-degree heading", () => {
    const e = new THREE.Euler(-0.3, Math.PI / 2, 0, "XYZ");
    const nose = NOSE.clone().applyEuler(e);
    expect(Math.abs(nose.y)).toBeLessThan(0.01); // the bug: no vertical tilt
  });
});
