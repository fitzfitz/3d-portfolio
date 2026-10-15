import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { GodRaysEffect } from "postprocessing";
import { GOD_RAYS_SOURCE_FLAGS } from "../src/components/canvas/godRays";

describe("GOD_RAYS_SOURCE_FLAGS", () => {
  it("is exactly what GodRaysEffect forces onto its light source, so the sun's program is compiled at warm-up", () => {
    // The sun's core material is built with these flags. If GodRaysEffect
    // changed them after warm-up, the sun would compile a second program the
    // first time it is drawn (a race: it only happened when PostFX mounted
    // late). Applying the real effect must change nothing.
    const material = new THREE.ShaderMaterial({ ...GOD_RAYS_SOURCE_FLAGS });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1), material);
    const version = material.version;
    new GodRaysEffect(new THREE.PerspectiveCamera(), mesh);
    expect(material.transparent).toBe(GOD_RAYS_SOURCE_FLAGS.transparent);
    expect(material.depthWrite).toBe(GOD_RAYS_SOURCE_FLAGS.depthWrite);
    expect(material.version).toBe(version);
  });
});
